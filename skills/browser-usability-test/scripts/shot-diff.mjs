// Where two screenshots of the same view differ, as rectangles in image pixels, so the
// report can outline them. Runs in Chromium's canvas (the skill's own browser), so it
// needs no image package. Both shots come from the same viewport (stateDiff checks it),
// so pixels line up exactly and a plain per-pixel compare is enough.
// Usage: const marks = await diffShots([[beforeFile, afterFile], ...]);
//        marks.get(`${beforeFile}|${afterFile}`) → { width, height, beforeWidth, beforeHeight, boxes, share, grew }
//   boxes  [{ x, y, w, h }] in pixels of the shots, top to bottom
//   share  part of the view that changed (0–1); a high share usually means content moved
//   grew   the "after" shot is taller or wider: its extra part is one more box
import { readFileSync } from "node:fs";
import { chromium } from "./lib.mjs";

const b64 = (file) => readFileSync(file).toString("base64");

export async function diffShots(pairs) {
  const marks = new Map();
  if (!pairs.length) return marks;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [a, b] of pairs) {
      const key = `${a}|${b}`;
      if (marks.has(key)) continue;
      marks.set(key, await page.evaluate(compare, { a: b64(a), b: b64(b) }));
    }
  } finally {
    await browser.close();
  }
  return marks;
}

// Runs in the page. Pixels are grouped in 8 px cells; a cell counts as changed when at
// least 3 of its pixels differ clearly (drops anti-aliasing specks), and changed cells
// closer than 32 px join one box, so a changed button is one outline, not one per letter.
async function compare({ a, b }) {
  const load = async (src) => {
    const im = new Image();
    im.src = `data:image/png;base64,${src}`;
    await im.decode();
    return im;
  };
  const [ia, ib] = await Promise.all([load(a), load(b)]);
  const w = Math.min(ia.width, ib.width), h = Math.min(ia.height, ib.height);
  const pixels = (im) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(im, 0, 0);
    return x.getImageData(0, 0, w, h).data;
  };
  const da = pixels(ia), db = pixels(ib);
  const C = 8, GAP = 4, MIN = 3, LIMIT = 48, PAD = 6;
  const gw = Math.ceil(w / C), gh = Math.ceil(h / C);
  const count = new Uint16Array(gw * gh);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > LIMIT)
        count[((y / C) | 0) * gw + ((x / C) | 0)]++;
    }
  const hit = count.map((n) => (n >= MIN ? 1 : 0));
  let changed = 0;
  for (const v of hit) changed += v;
  // flood-fill over changed cells; neighbours within GAP cells belong to the same box
  const seen = new Uint8Array(gw * gh);
  const boxes = [];
  for (let s = 0; s < hit.length; s++) {
    if (!hit[s] || seen[s]) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const k = stack.pop(), cx = k % gw, cy = (k / gw) | 0;
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (let dy = -GAP; dy <= GAP; dy++)
        for (let dx = -GAP; dx <= GAP; dx++) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
          const n = ny * gw + nx;
          if (hit[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
        }
    }
    const x = Math.max(0, x0 * C - PAD), y = Math.max(0, y0 * C - PAD);
    boxes.push({ x, y, w: Math.min(w, (x1 + 1) * C + PAD) - x, h: Math.min(h, (y1 + 1) * C + PAD) - y });
  }
  // padded boxes that now overlap become one
  const overlap = (p, q) => p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
  for (let again = true; again; ) {
    again = false;
    for (let i = 0; i < boxes.length && !again; i++)
      for (let j = i + 1; j < boxes.length && !again; j++)
        if (overlap(boxes[i], boxes[j])) {
          const p = boxes[i], q = boxes.splice(j, 1)[0];
          const x = Math.min(p.x, q.x), y = Math.min(p.y, q.y);
          boxes[i] = { x, y, w: Math.max(p.x + p.w, q.x + q.w) - x, h: Math.max(p.y + p.h, q.y + q.h) - y };
          again = true;
        }
  }
  // a taller or wider "after": the extra part is new
  const grew = ib.height > ia.height || ib.width > ia.width;
  if (ib.height > ia.height) boxes.push({ x: 0, y: ia.height, w: ib.width, h: ib.height - ia.height });
  if (ib.width > ia.width) boxes.push({ x: ia.width, y: 0, w: ib.width - ia.width, h: ia.height });
  boxes.sort((p, q) => p.y - q.y || p.x - q.x);
  return { width: ib.width, height: ib.height, beforeWidth: ia.width, beforeHeight: ia.height, boxes, share: changed / (gw * gh), grew };
}
