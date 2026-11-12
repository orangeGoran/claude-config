
// theme: remembered per browser, defaults to system preference
const applyTheme = (t) => {
  document.documentElement.dataset.theme = t;
  document.getElementById('themeBtn').textContent = t === 'light' ? '🌙' : '☀️';
  if (window.monaco && typeof monoTheme === 'function') monoTheme();
  redrawMermaid();
};
let theme;
try { theme = localStorage.getItem('dash-theme'); } catch {}
theme = theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
applyTheme(theme);
document.getElementById('themeBtn').addEventListener('click', () => {
  theme = theme === 'light' ? 'dark' : 'light';
  try { localStorage.setItem('dash-theme', theme); } catch {}
  applyTheme(theme);
});
const STATUSES = ['ready', 'in-refinement', 'needs-validation', 'waiting-on-external', 'parked', 'done'];
const TAG_SUGGESTIONS = ['small', 'big', 'db-migration', 'frontend-needed', 'ai', 'risky', 'tech-debt'];
const BT = String.fromCharCode(96); // backtick, kept out of this template literal

// wts: the worktrees section's items, apart from plans so the run strip, alerts and queue never count them
let state = [], plans = [], wts = [], selected = null, logKey = null, logKind = 'log', planCache = {};
let CUR_ISSUES = '';
const picked = new Set(); // keys: "<project>/<slug>"
// collapsed project sections, remembered per browser
let collapsedProjects;
try { collapsedProjects = new Set(JSON.parse(localStorage.getItem('dash-collapsed') || '[]')); }
catch { collapsedProjects = new Set(); }
const saveCollapsed = () => {
  try { localStorage.setItem('dash-collapsed', JSON.stringify([...collapsedProjects])); } catch {}
};
const modes = {};         // per key: a mode id from the project's modes (pipeline) or launcher index (generic)
// per project: the last mode picked in this browser, so a new plan starts on it
let lastModes = {};
try { lastModes = JSON.parse(localStorage.getItem('dash-modes') || '{}'); } catch {}
const pickMode = (p, v) => {
  modes[p.key] = v;
  lastModes[p.project] = v;
  try { localStorage.setItem('dash-modes', JSON.stringify(lastModes)); } catch {}
};
// a run that was launched keeps its mode, so Resume continues the same way; otherwise
// the last pick for the project, then the project's default (--describe), then the first
const modeOf = (p) => {
  if (modes[p.key] != null) return modes[p.key];
  const last = lastModes[p.project];
  if (!p.hasPipeline) return last != null && +last < (p.launchers || []).length ? last : 0;
  const ms = p.modes || [];
  const known = (id) => ms.some((m) => m.id === id);
  return p.run && known(p.run.mode) ? p.run.mode : known(last) ? last
    : (ms.find((m) => m.default) || ms[0] || {}).id;
};
const esc = (x) => (x || '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
const byId = (i) => document.getElementById(i);
// A "Jump to bottom" button over the foot of a scrolling list, shown while the list is not at its end.
// It sits in a zero-height box right after the list, so a repaint of the list keeps it.
function jumpToBottom(L) {
  const wrap = document.createElement('div');
  wrap.className = 'jumpwrap';
  wrap.innerHTML = '<button class="jumpbtn" hidden title="Jump to the latest" aria-label="Jump to bottom">↓ Jump to bottom</button>';
  L.after(wrap);
  const b = wrap.firstChild;
  let queued = false;
  const update = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; b.hidden = L.scrollHeight - L.scrollTop - L.clientHeight < 80; });
  };
  b.addEventListener('click', () => L.scrollTo({ top: L.scrollHeight, behavior: 'smooth' }));
  L.addEventListener('scroll', update, { passive: true });
  new MutationObserver(update).observe(L, { childList: true, subtree: true, characterData: true });
  new ResizeObserver(update).observe(L);
  update();
}
// Every repaint assigns innerHTML, which replaces the nodes a selection is
// anchored in and so silently drops whatever the user had highlighted. These
// let a repaint hold off until the selection is released.
const selectionIn = (el) => {
  const s = window.getSelection();
  if (!el || !s || !s.rangeCount || s.isCollapsed) return false;
  return !!s.anchorNode && el.contains(s.anchorNode);
};
const selectionLive = () =>
  ['detail', 'side', 'logbody', 'runstrip'].some((id) => selectionIn(byId(id)));
// navigator.clipboard exists only in a secure context. 127.0.0.1 and *.localhost
// qualify; a vanity domain like http://plans.test does not — and that is the URL
// this server prefers when /etc/hosts has it. Fall back to the legacy path there.
// the text a chat chip stands for: the selected lines that went (or go) with a message
document.addEventListener('click', (e) => {
  const chip = e.target.closest && e.target.closest('.cview[data-seltext]');
  if (!chip) return;
  e.preventDefault();
  const D = byId('seldlg');
  byId('seldlgt').textContent = (chip.querySelector('b') || chip).textContent.replace(/^⧉s*/, '').trim();
  byId('seldlgnote').hidden = true;
  byId('seldlgbody').textContent = chip.dataset.seltext;
  D.showModal();
});
byId('seldlgx').addEventListener('click', () => byId('seldlg').close());
byId('seldlg').addEventListener('click', (e) => { if (e.target.id === 'seldlg') e.currentTarget.close(); });
byId('seldlgcopy').addEventListener('click', async (e) => {
  const b = e.currentTarget, ok = await copyText(byId('seldlgbody').textContent);
  b.textContent = ok ? 'Copied' : 'Copy failed';
  setTimeout(() => { b.textContent = 'Copy'; }, 1400);
});
async function copyText(text) {
  try {
    if (window.isSecureContext && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
const find = (key) => plans.find((p) => p.key === key) || wts.find((w) => w.key === key);
// the server sets run.outcome: 'running' | 'needs-you' | 'failed'
const outOf = (p) => p.run ? p.run.outcome : null;
const OUT_CLASS = { 'needs-you': 'ok', failed: 'bad', running: 'warn' };

// --- tiny markdown renderer (headings, lists, tables, fences, links, #issues) ---
function inline(s) {
  s = esc(s);
  const codeRe = new RegExp(BT + '([^' + BT + ']+)' + BT, 'g');
  const parts = []; // protect inline code from further replacement
  s = s.replace(codeRe, (m, c) => { parts.push('<code>' + c + '</code>'); return '\u0000' + (parts.length - 1) + '\u0000'; });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
  s = s.replace(/(^|[^"'>=\w])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank">$2</a>');
  if (CUR_ISSUES) s = s.replace(/(^|[\s(>])#(\d{1,6})\b/g,
    '$1<a href="' + CUR_ISSUES + '$2" target="_blank">#$2</a>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => parts[+i]);
}
// breaks: a single newline is a line break, as GitHub shows PR and issue text
function md(src, breaks) {
  const fences = [];
  // four backslashes: this page is a template literal, and the regex needs \s, not s
  const fenceRe = new RegExp(BT + BT + BT + '([^\\n]*)\\n([\\s\\S]*?)' + BT + BT + BT, 'g');
  src = src.replace(fenceRe, (m, lang, code) => {
    // a mermaid block keeps its code here; drawMermaid puts the drawing above it
    fences.push(lang.trim().toLowerCase() === 'mermaid'
      ? '<div class="mmd"><pre><code>' + esc(code) + '</code></pre></div>'
      : '<pre><code>' + esc(code) + '</code></pre>');
    return '\u0001' + (fences.length - 1) + '\u0001';
  });
  const out = []; let list = null, para = [], tbl = null;
  const flushPara = () => {
    if (para.length) out.push('<p>' + (breaks ? para.map(inline).join('<br>') : inline(para.join(' '))) + '</p>');
    para = [];
  };
  const flushList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
  const flushTbl = () => {
    if (!tbl) return;
    const rows = tbl.filter((r) => !/^\s*\|?[\s:|-]+\|?\s*$/.test(r));
    out.push('<table>' + rows.map((r, i) => {
      const cells = r.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|');
      const tag = i === 0 ? 'th' : 'td';
      return '<tr>' + cells.map((c) => '<' + tag + '>' + inline(c.trim()) + '</' + tag + '>').join('') + '</tr>';
    }).join('') + '</table>');
    tbl = null;
  };
  for (const raw of src.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (/^\s*\|/.test(line)) { flushPara(); flushList(); (tbl = tbl || []).push(line); continue; }
    flushTbl();
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) {
      flushPara(); flushList();
      out.push('<h' + m[1].length + '>' + inline(m[2]) + '</h' + m[1].length + '>');
    } else if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { flushPara(); flushList(); out.push('<hr>');
    } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
      flushPara(); if (list !== 'ul') { flushList(); out.push('<ul>'); list = 'ul'; }
      out.push('<li>' + inline(m[1]) + '</li>');
    } else if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara(); if (list !== 'ol') { flushList(); out.push('<ol>'); list = 'ol'; }
      out.push('<li>' + inline(m[1]) + '</li>');
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flushPara(); flushList(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>');
    } else if (!line.trim()) { flushPara(); flushList();
    } else if (/^\u0001\d+\u0001$/.test(line.trim())) { flushPara(); flushList(); out.push(line.trim());
    } else { para.push(line.trim()); }
  }
  flushPara(); flushList(); flushTbl();
  return out.join('\n').replace(/\u0001(\d+)\u0001/g, (m, i) => fences[+i]);
}
// an answer still arriving: finish the marks it left open, so # or ** never show on the way
function mdLive(src) {
  const fence = BT + BT + BT;
  if ((src.split(fence).length - 1) % 2) return md(src + '\n' + fence);
  const cut = src.lastIndexOf('\n') + 1;
  let last = src.slice(cut);
  // only a mark so far: its text has not come yet
  if (new RegExp('^\\s*(#{1,4}|-{1,2}|\\*{1,2}|>|\\d+[.)]?|' + BT + '{1,2})\\s*$').test(last)) return md(src.slice(0, cut));
  // a closing fence with no newline after it yet is not an open inline code mark
  if (!last.trim().startsWith(fence) && (last.split(BT).length - 1) % 2) last += BT;
  const stars = () => (last.replace(new RegExp(BT + '[^' + BT + ']*' + BT, 'g'), '').split('**').length - 1) % 2;
  if (stars()) { last = last.replace(/\*+$/, ''); if (stars()) last += '**'; }
  return md(src.slice(0, cut) + last);
}

// --- rendering ---
const starting = (p) => !p.live && p.launch && p.launch.state === 'starting';
const notStarted = (p) => !p.live && p.launch && p.launch.state === 'failed';
const dotClass = (p) => p.live ? 'live'
  : starting(p) ? 'warn' : notStarted(p) ? 'bad'
  : !p.run ? '' : OUT_CLASS[outOf(p)];

// chats whose agent answered while you looked elsewhere; the mark stays until you open that chat
const chatAnswered = new Set();
try { for (const k of JSON.parse(localStorage.getItem('dash-chat-answered') || '[]')) chatAnswered.add(k); } catch {}
function markAnswered(key, on) {
  if (chatAnswered.has(key) === on) return;
  on ? chatAnswered.add(key) : chatAnswered.delete(key);
  try { localStorage.setItem('dash-chat-answered', JSON.stringify([...chatAnswered])); } catch {}
}
// what the plan's chat is doing, for the sidebar rows: asking beats working beats answered
const chatChip = (p) => p.chatWaits ? '<span class="chip bad" title="The agent waits for your permission">🔐 asks you</span>'
  : p.chatting ? '<span class="chip live cwk" title="The agent is working on your message">💬 working…</span>'
  : chatAnswered.has(p.key) ? '<span class="chip ok" title="The agent answered. Open the chat to read it.">💬 answered</span>' : '';

const autoChips = (p) => {
  let c = chatChip(p);
  if (p.live) c += '<span class="chip live">● running</span>';
  else if (starting(p)) c += '<span class="chip warn">⏳ starting…</span>';
  else if (notStarted(p)) c += '<span class="chip bad">⚠ didn’t start</span>';
  else if (p.run) c += '<span class="chip ' + OUT_CLASS[outOf(p)] +
    '">' + esc(String(p.run.status || outOf(p) || 'run').split(/[.—]/)[0].slice(0, 42)) + '</span>';
  if (p.validations) c += '<span class="chip ok">validated ×' + p.validations + '</span>';
  if (p.worktree) c += '<span class="chip">worktree</span>';
  if (p.archived) c += '<span class="chip">📦 archived</span>';
  if (p.pr) c += prChip(p.pr);
  return c;
};

const matchesQ = (p, q) => p.file.toLowerCase().includes(q) || p.title.toLowerCase().includes(q)
  || p.project.toLowerCase().includes(q) || p.client.toLowerCase().includes(q)
  || p.tags.some((t) => t.toLowerCase().includes(q));
function visiblePlans() {
  const q = byId('q').value.toLowerCase();
  return plans.filter((p) => !p.archived && (!q || matchesQ(p, q)));
}
// Archived plans stay out of the list until a search asks for them — nobody browses
// hundreds of finished plans, they look one up. An open one stays listed.
function archivedMatches() {
  const q = byId('q').value.toLowerCase();
  return plans.filter((p) => p.archived && (q ? matchesQ(p, q) : selected === p.key))
    .sort((a, b) => b.slug.localeCompare(a.slug));   // slugs start with their date: newest first
}
// Project look: every project gets a color and a short tag, so cards from different projects
// tell apart at a glance. Registry "color" / "short" win. Otherwise the color comes from PROJ_HUES in
// registry order (no red, yellow or green: those mean blocked, waiting and done), and the tag is the
// name minus the dash parts it shares with another project of the same client (galileon-solver-api → api).
const PROJ_HUES = [205, 320, 25, 170, 265, 290];
let projLookKey = null, projLookMap = {};
// the name minus the dash parts it shares with another project of the same client
function autoShort(name, client) {
  const parts = name.split('-');
  let shared = 0;
  for (const o of state) {
    if (o.name === name || o.client !== client) continue;
    const op = o.name.split('-');
    let k = 0;
    while (k < parts.length - 1 && op[k] === parts[k]) k++;
    shared = Math.max(shared, k);
  }
  return parts.slice(shared).join('-');
}
function projLook(name) {
  const key = state.map((s) => [s.name, s.client, s.color, s.short].join('|')).join(',');
  if (key !== projLookKey) {
    projLookKey = key; projLookMap = {};
    state.forEach((s, i) => {
      projLookMap[s.name] = { style: s.color ? '--pc:' + s.color : '--ph:' + PROJ_HUES[i % PROJ_HUES.length],
        short: s.short || autoShort(s.name, s.client) };
    });
  }
  return projLookMap[name] || { style: '--ph:210', short: name };
}
const projStyle = (name) => ' style="' + escA(projLook(name).style) + '"';
const projPill = (name) => '<span class="ppill pcx"' + projStyle(name) + ' title="' + escA(name) + '">' +
  esc(projLook(name).short) + '</span>';
const openMark = '<span class="openmk">▶ open</span>';
// the automatic project color as #rrggbb (a color input takes only hex); same hsl as the .pcx rule
function projAutoHex(name) {
  const m = /--ph:(\d+)/.exec(projLook(name).style);
  return hueHex(m ? +m[1] : 210);
}
function hueHex(hue) {
  const sat = theme === 'light' ? 0.45 : 0.40, lit = theme === 'light' ? 0.48 : 0.66;
  const a = sat * Math.min(lit, 1 - lit);
  const f = (n) => { const k = (n + hue / 30) % 12;
    return Math.round(255 * (lit - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return '#' + f(0) + f(8) + f(4);
}
let lastItemClick = {};
const itemHtml = (p, withProject) => `
    <div class="item ${selected === p.key ? 'sel' : ''} ${p.archived ? 'arch' : ''} ${dotClass(p)}" data-key="${p.key}"${selected === p.key ? ' aria-current="true"' : ''}>
      <input type="checkbox" aria-label="queue this plan" data-check="${p.key}" ${picked.has(p.key) ? 'checked' : ''}
             ${p.live || starting(p) || p.worktree || p.archived ? 'disabled' : ''}>
      <div class="t">
        <div class="name">${selected === p.key ? openMark : ''}${withProject ? projPill(p.project) : ''}${p.file}</div>
        <div class="chiprow">
          ${p.status ? '<span class="chip st">' + esc(p.status) + '</span>' : ''}
          ${p.tags.map((t) => '<span class="chip">' + esc(t) + '</span>').join('')}
          ${autoChips(p)}
          ${picked.has(p.key) ? '<span class="chip st">▶ ' + esc(modeLabel(p)) + '</span>' : ''}
        </div>
      </div>
      <div class="dot ${dotClass(p)}"></div>
    </div>`;
function modeLabel(p) {
  if (p.hasPipeline) return modeOf(p);
  const l = (p.launchers || [])[+modeOf(p)];
  return l ? (l.label || 'launcher ' + (+modeOf(p) + 1)) : 'no launcher';
}
// ---- worktrees section: worktrees a Claude Code session made itself, with their PR and sessions ----
const ago = (t) => {
  const s = Math.max(0, (Date.now() - new Date(t).getTime()) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + 'm ago' : s < 86400 ? Math.round(s / 3600) + 'h ago'
    : Math.round(s / 86400) + 'd ago';
};
function visibleWts() {
  const q = byId('q').value.toLowerCase();
  return wts.filter((w) => !q || [w.name, w.branch, w.title, w.project, w.client, w.pr ? '#' + w.pr.number : '']
    .some((s) => String(s || '').toLowerCase().includes(q)));
}
const agentChip = (w) => w.agent === 'working' ? '<span class="chip live">● agent working</span>'
  : w.agent === 'idle' ? '<span class="chip" title="the last session wrote ' + escA(new Date(w.lastActive).toLocaleString()) +
    '">agent idle · ' + ago(w.lastActive) + '</span>' : '';
const wtChips = (w) => agentChip(w) + (w.pr ? prChip(w.pr) : '<span class="chip">no PR</span>') +
  (w.dirty ? '<span class="chip warn" title="files changed and not committed">' + w.dirty + ' uncommitted</span>' : '');
const wtItemHtml = (w) => `
    <div class="item wtrow ${selected === w.key ? 'sel' : ''} ${w.agent === 'working' ? 'live' : ''}" data-key="${escA(w.key)}"${selected === w.key ? ' aria-current="true"' : ''}>
      <div class="t">
        <div class="name">${selected === w.key ? openMark : ''}${esc(w.name)}</div>
        <div class="sub" title="${escA(w.title)}">${esc(w.title)}</div>
        <div class="chiprow">${wtChips(w)}</div>
      </div>
      <div class="dot ${w.agent === 'working' ? 'live' : ''}"></div>
    </div>`;
const wtSectionHtml = (proj, list) => {
  if (!list.length) return '';
  const closed = collapsedProjects.has('wt:' + proj);
  const working = list.filter((w) => w.agent === 'working').length;
  return '<div class="wthead" data-wtfold="' + escA(proj) + '" title="Worktrees made outside the plans, with their PRs">' +
    '<span class="chev">' + (closed ? '▸' : '▾') + '</span>Worktrees' +
    (working ? '<span class="chip live">● ' + working + '</span>' : '') +
    '<span class="cnt">' + list.length + '</span></div>' + (closed ? '' : list.map(wtItemHtml).join(''));
};
// ---- favicon mood ring ----
// the 16px tab should answer "is the fleet working, or does it want me?" on its own.
// running/waiting = machine's turn; dead/done = your turn, most urgent first.
const MOODS = [['live', '🏃'], ['inflight', '⏳'], ['bad', '💀'],
               ['ready', '✅'], ['idle', '😴']];
let lastMood = '', baseTitle = 'Plans';
const unseen = [];   // alerts that rang while you were away, newest last
function setMood(counts) {
  const [key, face] = MOODS.find(([k]) => k === 'idle' || counts[k]);
  const n = counts[key] || 0;
  const mood = face + n;
  if (mood === lastMood) return;   // the 5s poll must not churn the DOM
  lastMood = mood;
  byId('favicon').href = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
    '<text x="32" y="46" font-size="56" text-anchor="middle">' + face + '</text></svg>');
  baseTitle = (n ? '(' + n + ') ' : '') + 'Plans';
  paintTitle();
}
// While you are in another app, each alert also goes in front of the tab title, so you can
// see which tab rang. Coming back to the tab clears it.
function paintTitle() {
  const last = unseen[unseen.length - 1];
  document.title = last ? '🔔 ' + (unseen.length > 1 ? '+' + (unseen.length - 1) + ' ' : '') + last + ' — ' + baseTitle : baseTitle;
}
function clearUnseen() { if (unseen.length) { unseen.length = 0; paintTitle(); } }
window.addEventListener('focus', clearUnseen);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && document.hasFocus()) clearUnseen(); });
function renderList() {
  // pinned "running now" strip + header counters — running must be unmissable
  const live = plans.filter((p) => p.live);
  // launched but between sessions: report/run exists, neither done nor failed, no live process
  const inflight = plans.filter((p) => !p.live && !p.launch && outOf(p) === 'running');
  const ready = plans.filter((p) => !p.live && !p.launch && outOf(p) === 'needs-you');
  const launching = plans.filter(starting);
  const failed = plans.filter(notStarted);
  const bad = plans.filter((p) => !p.live && !p.launch && outOf(p) === 'failed');
  setMood({ live: live.length, inflight: inflight.length, bad: bad.length, ready: ready.length });
  const rs = byId('runstrip');
  // the search box narrows the strip too; the header counters above keep the full counts
  const sq = byId('q').value.toLowerCase();
  const strip = (list) => sq ? list.filter((p) => matchesQ(p, sq)) : list;
  const sLive = strip(live), sInflight = strip(inflight), sReady = strip(ready),
    sLaunching = strip(launching), sFailed = strip(failed), sBad = strip(bad);
  rs.className = 'runstrip' +
    (sLive.length || sInflight.length || sReady.length || sBad.length || sLaunching.length || sFailed.length ? ' on' : '');
  let sh = '';
  const stripName = (p) => (p.key === selected ? openMark : '') + projPill(p.project) + p.file + chatChip(p);
  // one plan row: dot, name, the run's status line, then its buttons
  const stripRow = (p, dot, sub, acts) => '<div class="rp" data-go="' + p.key + '"><span class="dot ' + dot + '"></span>' +
    '<div class="t"><div class="n">' + stripName(p) + '</div>' +
    (sub ? '<div class="rst" title="' + escA(sub) + '">' + esc(sub) + '</div>' : '') +
    (acts ? '<div class="acts">' + acts + '</div>' : '') + '</div></div>';
  const stripGroup = (cls, cap, list, row) => list.length ? '<div class="cap ' + cls + '">' + cap + ' · ' + list.length + '</div>' +
    '<div class="sgrp ' + cls + '">' + list.map(row).join('') + '</div>' : '';
  const repBtn = (p) => '<button class="mini" data-rep="' + p.key + '">' + (p.hasPipeline ? '📋 report' : '📄 log') + '</button>';
  // the run's own status says what it waits for ("VERIFIED", "PR OPEN — 3 DECISIONS WAITING",
  // "BLOCKED: step 10 …"); a run that stopped blocked or failed needs you as much as a finished one
  const doneRow = (dot) => (p) => stripRow(p, dot, p.run.status || '',
    (p.run.links || []).map((l) => '<button class="mini" data-url="' + escA(l.url) + '">' +
      esc(l.label.replace(/^Ticket\s+(?=#)/i, '')) + '</button>').join('') + repBtn(p));
  sh += stripGroup('bc', '⚠ Didn’t start', sFailed, (p) => stripRow(p, 'bad', '', '<button class="mini" data-why="' + p.key + '">why?</button>'));
  sh += stripGroup('wc', '⏳ Starting', sLaunching, (p) => stripRow(p, 'warn', 'setting up…', ''));
  sh += stripGroup('', '● Running now', sLive, (p) => stripRow(p, 'live', '', '<button class="mini" data-log="' + p.key + '">📄 log</button>'));
  sh += stripGroup('wc', '⏳ Launched, in progress', sInflight, (p) => stripRow(p, 'warn', '', repBtn(p)));
  sh += stripGroup('bc', '✕ Stopped, blocked or failed', sBad, doneRow('bad'));
  sh += stripGroup('okc', '✓ Waiting on you', sReady, doneRow('ok'));
  rs.innerHTML = sh;
  rs.querySelectorAll('[data-go]').forEach((el) => {
    if (el.dataset.go === selected) { el.classList.add('sel'); el.setAttribute('aria-current', 'true'); }
    el.addEventListener('click', () => { selected = el.dataset.go; renderList(); renderDetail(true); });
  });
  rs.querySelectorAll('[data-why]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); showLaunchError(find(el.dataset.why)); }));
  rs.querySelectorAll('[data-log]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); openLog(el.dataset.log, 'log'); }));
  rs.querySelectorAll('[data-url]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation(); openRunLink(find(el.closest('[data-go]').dataset.go), el.dataset.url);
    }));
  rs.querySelectorAll('[data-rep]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const p = find(el.dataset.rep);
      openLog(el.dataset.rep, p && p.hasPipeline ? 'report' : 'log');
    }));
  const hd = byId('hdrun');
  hd.style.display = live.length ? '' : 'none';
  hd.textContent = '● ' + live.length + ' running';
  const ho = byId('hdok');
  ho.style.display = ready.length ? '' : 'none';
  ho.textContent = '✓ ' + ready.length + ' to review';
  // grouped list: client → project → plans; project sections collapse on header click
  const vis = visiblePlans();
  // Unfiltered, every registered project shows — an empty one included, so a project
  // added a moment ago doesn't look like it failed to register.
  const filtering = byId('q').value;
  const arch = archivedMatches();
  const visWts = visibleWts();
  const shownProjs = state.filter((s) => !filtering || vis.some((p) => p.project === s.name)
    || visWts.some((w) => w.project === s.name));
  const clients = [...new Set(shownProjs.map((s) => s.client))];
  byId('side').innerHTML = !state.length
    ? '<div class="emptyproj" style="padding:18px 16px">No projects on the dashboard yet.<br><br>' +
      '<button class="primary" data-guide="">Get started</button></div>'
    : clients.map((c) => {
    const projNames = shownProjs.filter((s) => s.client === c).map((s) => s.name);
    return '<div class="ghead">' + esc(c) + '</div>' + projNames.map((pr) => {
      const items = vis.filter((p) => p.project === pr);
      const closed = collapsedProjects.has(pr);
      const sp = state.find((s) => s.name === pr) || {};
      const hasLanes = sp.hasLanes;
      // run counters for the whole project (not just filtered-visible plans)
      const projPlans = plans.filter((p) => p.project === pr);
      const liveN = projPlans.filter((p) => p.live).length;
      const flightN = projPlans.filter((p) => !p.live && outOf(p) === 'running').length;
      const runBadges =
        (liveN ? '<span class="chip live">● ' + liveN + ' running</span>' : '') +
        (flightN ? '<span class="chip warn">⏳ ' + flightN + '</span>' : '');
      // one card per project: header, plans and worktrees end together at its bottom edge
      return '<div class="pgrp pcx"' + projStyle(pr) + '><div class="phead pcx" data-toggle="' + esc(pr) + '"' + projStyle(pr) + '><span class="chev">' +
        (closed ? '▸' : '▾') + '</span>' + esc(pr) +
        (hasLanes ? '<button class="pbtn" data-suggest="' + esc(pr) +
          '" title="Suggest a parallel launch batch" aria-label="Suggest a parallel launch batch">⚡</button>' : '') +
        '<button class="pbtn" data-pull="' + esc(pr) + '" title="Pull: git pull --ff-only in ' + escA(sp.root) +
          ' (the branch it is on, from its remote)" aria-label="Pull">📥</button>' +
        '<button class="pbtn" data-vscode="' + esc(pr) + '" title="Open ' + escA(sp.root) +
          ' in VS Code" aria-label="Open in VS Code">🖥</button>' + runBadges +
        (sp.setupLevel === 'red' ? '<span class="chip bad x" data-guide="' + escA(sp.root) +
          '" title="something required is missing — see what and how to fix it">needs setup</span>' : '') +
        '<span class="cnt">' + items.length + ' plan' + (items.length === 1 ? '' : 's') +
        '</span></div>' + (closed ? '' : (items.length ? items.map((p) => itemHtml(p)).join('')
          : filtering ? '' : '<div class="emptyproj">' + (projPlans.length ? 'All plans are archived.'
            : 'No plans yet — add a <code>.md</code> file to <code>' + esc(sp.plansDir) + '</code>.') + '</div>') +
          wtSectionHtml(pr, visWts.filter((w) => w.project === pr))) + '</div>';
    }).join('');
  }).join('') + (arch.length ? '<div class="ghead">📦 Archived' + (filtering ? ' — ' + arch.length + ' match' +
    (arch.length === 1 ? '' : 'es') : '') + '</div><div class="pgrp">' + arch.map((p) => itemHtml(p, true)).join('') + '</div>' : '');
  byId('side').querySelectorAll('[data-guide]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      if (el.dataset.guide) onbOpenCards.add(el.dataset.guide);
      openGuide(el.dataset.guide ? 1 : 0);
    }));
  byId('side').querySelectorAll('[data-suggest]').forEach((el) =>
    el.addEventListener('click', (e) => { e.stopPropagation(); openSuggest(el.dataset.suggest); }));
  byId('side').querySelectorAll('[data-pull]').forEach((el) =>
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      el.disabled = true; el.textContent = '⏳';
      await post('/api/pull', { project: el.dataset.pull }, true);
      el.disabled = false; el.textContent = '📥';
    }));
  byId('side').querySelectorAll('[data-vscode]').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      post('/api/vscode-project', { project: el.dataset.vscode });
    }));
  const allProjNames = state.map((s) => s.name);
  byId('collapseAll').textContent =
    allProjNames.length && allProjNames.every((n) => collapsedProjects.has(n))
      ? 'Expand all' : 'Collapse all';
  byId('side').querySelectorAll('.phead[data-toggle]').forEach((el) =>
    el.addEventListener('click', () => {
      const pr = el.dataset.toggle;
      collapsedProjects.has(pr) ? collapsedProjects.delete(pr) : collapsedProjects.add(pr);
      saveCollapsed(); renderList();
    }));
  byId('side').querySelectorAll('.wthead[data-wtfold]').forEach((el) =>
    el.addEventListener('click', () => {
      const k = 'wt:' + el.dataset.wtfold;
      collapsedProjects.has(k) ? collapsedProjects.delete(k) : collapsedProjects.add(k);
      saveCollapsed(); renderList();
    }));
  byId('side').querySelectorAll('.item.wtrow').forEach((el) =>
    el.addEventListener('click', () => { selected = el.dataset.key; renderList(); renderDetail(true); }));
  byId('side').querySelectorAll('.item:not(.wtrow)').forEach((el) =>
    el.addEventListener('click', (e) => {
      if (e.target.dataset.check) return;
      const key = el.dataset.key, now = Date.now();
      // double-click queues the plan, same as ticking its box. Timed by hand because
      // the first click re-renders the list, so the browser's dblclick never fires.
      if (lastItemClick.key === key && now - lastItemClick.at < 400) {
        lastItemClick = {};
        getSelection().removeAllRanges();
        if (el.querySelector('input[data-check]').disabled) return;
        picked.has(key) ? picked.delete(key) : picked.add(key);
        renderBar(); renderList();
        return;
      }
      lastItemClick = { key, at: now };
      selected = key; renderList(); renderDetail(true);
    }));
  byId('side').querySelectorAll('input[data-check]').forEach((el) =>
    el.addEventListener('change', () => {
      el.checked ? picked.add(el.dataset.check) : picked.delete(el.dataset.check);
      renderBar(); renderList();
    }));
}

// The address bar follows the open plan, tab and file, so a reload reopens them and Back
// goes to the previous plan or tab. A new plan or tab is a history entry; a file is not.
function syncUrl() {
  const q = new URLSearchParams(location.search);
  const want = { sel: selected, tab: selected && prTab[selected] !== 'plan' ? prTab[selected] : null,
    file: selected && prTab[selected] === 'files' ? prFile[selected] : null };
  const same = (k) => (q.get(k) || null) === (want[k] || null);
  if (same('sel') && same('tab') && same('file')) return;
  const push = !same('sel') || !same('tab');
  for (const [k, v] of Object.entries(want)) v ? q.set(k, v) : q.delete(k);
  const url = location.pathname + (q.toString() ? '?' + q : '');
  push ? history.pushState(null, '', url) : history.replaceState(null, '', url);
}
function readUrl() {
  const q = new URLSearchParams(location.search);
  selected = q.get('sel') || null;
  if (selected) {
    prTab[selected] = q.get('tab') || 'plan';
    if (q.get('file')) prFile[selected] = q.get('file');
  }
  lastPrDraw = null;
}
window.addEventListener('popstate', () => { readUrl(); renderList(); renderDetail(true); });
async function renderDetail(loadPlan) {
  syncUrl();
  const p = find(selected);
  if (!p) return renderEmptyDetail();
  markDetailProject(p.project);
  CUR_ISSUES = p.issuesUrl || '';
  let tab = prTab[p.key] || 'plan';
  // the Ask tab is now the chat panel: an old ?tab=ask link opens it beside the diff
  if (tab === 'ask') { prTab[p.key] = tab = p.pr ? 'files' : 'plan'; if (!chatOn) toggleChat(true); }
  if (tab === 'pr') prTab[p.key] = tab = 'plan';   // the plan and its PR are one tab
  if (tab !== 'plan' && !p.pr) tab = 'plan';
  autoChat(p);
  syncChat(p);
  drawHdTabs(p);
  if (tab !== 'plan') return renderPrTab(p, tab, loadPlan);
  lastPrDraw = null;
  if (p.kind === 'wt') return renderWtDetail(p, loadPlan);
  const launcherModes = !p.hasPipeline && !p.archived
    ? ((p.launchers || []).length ? `
    <div class="modes"><b>Launcher:</b>
      ${p.launchers.map((l, i) => '<label><input type="radio" name="m" value="' + i + '" ' +
        (String(modeOf(p)) === String(i) ? 'checked' : '') + '>' +
        esc(l.label || 'launcher ' + (i + 1)) + '</label>').join('')}
      <button id="editL">⚙ edit launchers</button></div>` : `
    <div class="modes"><b>No launcher configured for ${esc(p.project)} yet.</b>
      <button id="editL" class="primary">⚙ Set up launcher</button></div>`)
    : '';
  const pipelineModes = p.hasPipeline && !p.archived &&
    ((!p.run && !p.live) || (!p.live && outOf(p) === 'failed')) ? `
    <div class="modes"><b>Where to stop:</b>
      ${(p.modes || []).map((m) => '<label><input type="radio" name="m" value="' + escA(m.id) + '" ' +
        (modeOf(p) === m.id ? 'checked' : '') + '>' + esc(m.label) + '</label>').join('')}</div>` : '';
  const withPr = !!p.pr;
  const badges = '<div class="badges">' + autoChips(p) + '</div>';
  const lastStep = p.run && p.run.lastEvent ? '<div class="laststep">last: ' + esc(p.run.lastEvent.slice(0, 200)) + '</div>' : '';
  const planFold = '<details class="planfold" id="planfold" ' + (planOpen.has(p.key) ? 'open' : '') + '><summary>Show the full plan</summary>' +
    '<div class="planview"><div class="mdc" id="planmd">loading plan…</div></div></details>';
  byId('detail').innerHTML = `
    <div class="dhead"><div class="dtitle">
      <div class="crumb">${esc(p.client)} / ${projPill(p.project)}${esc(p.project)}</div>
      <h2 class="fname">${p.file}</h2>
      <div class="subtitle">${inline(p.title)}</div></div>
      <div class="btns" id="actions"></div></div>
    ${withPr ? '<div class="prtabsrow"><div class="prtabs">' + chatBtn(p) + '</div><span class="btns" id="ract"></span></div>' : prTabs(p, 'plan') + badges}
    <div id="morebox" ${moreOpen.has(p.key) ? '' : 'hidden'}>
    ${withPr ? badges + lastStep : ''}
    <div class="metabox"><b>Status:</b>
      <select id="stSel"><option value="">—</option>
        ${STATUSES.map((s) => '<option ' + (p.status === s ? 'selected' : '') + '>' + s + '</option>').join('')}
      </select>
      <b>Tags:</b><span id="tagRow" class="chiprow">
        ${p.tags.map((t) => '<span class="chip x" data-del="' + esc(t) + '">' + esc(t) + ' ✕</span>').join('')}</span>
      <input id="tagIn" list="tagOpts" placeholder="+ add tag ⏎" size="12">
      <datalist id="tagOpts">${TAG_SUGGESTIONS.map((t) => '<option>' + t + '</option>').join('')}</datalist>
    </div>
    <div id="sessbox"></div>
    ${withPr ? planFold : ''}
    </div>
    ${p.pr && p.pr.state === 'MERGED' ? '<div class="mergedline"><span>✓ PR #' + p.pr.number +
      ' was merged into <code>' + esc(p.pr.base || '?') + '</code>' + (p.pr.mergedAt ? ' on ' + esc(new Date(p.pr.mergedAt).toLocaleString()) : '') +
      '</span><a href="' + escA(p.pr.url) + '" target="_blank" rel="noopener">↗ GitHub</a></div>' : ''}
    ${p.summary ? '<div class="summary">💡 ' + esc(p.summary) + '</div>'
      : p.summarizing ? '<div class="summary dim">💭 plain-language summary is being generated…</div>' : ''}
    ${withPr ? '' : lastStep}
    ${p.live ? '' : launcherModes}${pipelineModes}
    ${!p.pr && p.prError ? '<div class="ghhint">PRs are not shown: ' + esc(p.prError) + '. Run <code>' +
      (/not installed/.test(p.prError) ? 'brew install gh &amp;&amp; gh auth login' : 'gh auth login') + '</code> in a terminal.</div>' : ''}
    ${withPr ? '<div id="prview" class="pvpr"></div>' : planFold}`;
  document.body.classList.remove('review');
  bindPrTabs(p);
  byId('planfold').addEventListener('toggle', () =>
    byId('planfold').open ? planOpen.add(p.key) : planOpen.delete(p.key));
  byId('stSel').addEventListener('change', () => saveMetaFor(p, byId('stSel').value || null, p.tags));
  byId('tagIn').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.value.trim())
      saveMetaFor(p, p.status, [...p.tags, e.target.value.trim()]);
  });
  byId('detail').querySelectorAll('[data-del]').forEach((el) =>
    el.addEventListener('click', () => saveMetaFor(p, p.status, p.tags.filter((t) => t !== el.dataset.del))));
  byId('detail').querySelectorAll('input[name=m]').forEach((el) =>
    el.addEventListener('change', () => { pickMode(p, el.value); renderBar(); renderList(); }));
  const editL = byId('editL');
  if (editL) editL.addEventListener('click', () => openLauncherSetup(p.project));
  // state-aware actions: primary buttons only; the rest behind "⋯ more"
  const A = byId('actions');
  const moreWrap = document.createElement('span');
  moreWrap.style.cssText = 'display:none;gap:8px;flex-wrap:wrap';
  const btn = (label, fn, cls, parent) => {
    const b = document.createElement('button');
    b.textContent = label; if (cls) b.className = cls;
    b.addEventListener('click', fn); (parent || A).appendChild(b);
    return b;
  };
  const stt = p.live ? 'live'
    : starting(p) ? 'starting'
    : p.run ? (outOf(p) === 'needs-you' ? 'review' : 'stuck')
    : 'fresh';
  const rep = () => openLog(p.key, 'report');
  const log = () => openLog(p.key, 'log');
  const vsc = () => post('/api/vscode', { project: p.project, slug: p.slug });
  const clean = () => p.hasPipeline ? cleanupRun(p) : clearRun(p);
  const launchNow = () => post('/api/launch-generic',
    { project: p.project, slug: p.slug, launcher: +modeOf(p) }, true);
  if (notStarted(p)) btn('⚠ Why it didn’t start', () => showLaunchError(p), 'danger');
  for (const l of (p.run && p.run.links) || []) {
    // the run's link to its own PR would open this tab: ↗ GitHub in the bar is the PR on the web
    if (p.pr && l.url.replace(/[/]+$/, '') === p.pr.url.replace(/[/]+$/, '')) continue;
    btn(l.label.replace(/^Ticket\s+(?=#)/i, ''), () => openRunLink(p, l.url), 'primary');
  }
  if (stt === 'starting') {
    btn('⏳ Starting… setting up the worktree', () => {}).disabled = true;
  } else if (p.archived) {
    btn('↩ Unarchive plan', () => post('/api/unarchive', { project: p.project, slug: p.slug }, true));
    btn('🖥 Open in VS Code', vsc, null, moreWrap);
  } else if (p.hasPipeline) {
    if (stt === 'live') {
      btn('📋 Report', rep); btn('📄 Log', log);
    } else if (stt === 'review') {
      btn('📋 Report', rep); btn('🖥 Open in VS Code', vsc);
      btn('📄 Log', log, null, moreWrap);
      btn('🗑 Clean up run', clean, 'danger', moreWrap);
    } else if (stt === 'stuck') {
      btn('📋 Report', rep); btn('📄 Log', log);
      btn('⟳ Resume', () => post('/api/resume', { project: p.project, slug: p.slug, mode: modeOf(p) }).then(afterLaunch));
      btn('🖥 Open in VS Code', vsc, null, moreWrap);
      btn('🗑 Clean up run', clean, 'danger', moreWrap);
    } else { // fresh: launch this one now, or queue it with others via the checkbox
      if (p.worktree) { btn('🖥 Open in VS Code', vsc); btn('🗑 Clean up run', clean, 'danger', moreWrap); }
      else {
        btn('▶ Launch now', () => {
          picked.delete(p.key); renderBar();
          post('/api/launch', { project: p.project, items: [{ slug: p.slug, mode: modeOf(p) }] }).then(afterLaunch);
        }, 'primary');
        btn('📦 Archive plan → done/', () => archive(p), 'danger', moreWrap);
      }
    }
  } else {
    if (stt === 'live') {
      btn('📄 Log', log);
    } else if (stt === 'review') {
      btn('📄 Log', log); btn('🖥 Open in VS Code', vsc);
      btn('🗑 Clear run record', clean, 'danger', moreWrap);
      btn('📦 Archive plan → done/', () => archive(p), 'danger', moreWrap);
    } else if (stt === 'stuck') {
      btn('📄 Log', log);
      if ((p.launchers || []).length) btn('▶ Launch again', launchNow);
      btn('🖥 Open in VS Code', vsc, null, moreWrap);
      btn('🗑 Clear run record', clean, 'danger', moreWrap);
    } else { // fresh
      if ((p.launchers || []).length) btn('▶ Launch now', launchNow, 'primary');
      btn('🖥 Open in VS Code', vsc, null, moreWrap);
      btn('📦 Archive plan → done/', () => archive(p), 'danger', moreWrap);
    }
  }
  // "⋯ more" also unfolds status, tags and session history: the plan tab opens on the summary
  const showMore = (on) => {
    moreWrap.style.display = on ? 'inline-flex' : 'none';
    byId('morebox').hidden = !on;
    mb.textContent = on ? '⋯ less' : '⋯ more';
  };
  const mb = btn('⋯ more', () => {
    moreOpen.has(p.key) ? moreOpen.delete(p.key) : moreOpen.add(p.key);
    showMore(moreOpen.has(p.key));
  });
  A.appendChild(moreWrap);
  showMore(moreOpen.has(p.key));
  // AI session history: reopen-the-chat + independent-evaluation commands
  if (p.sessions && p.sessions.length) {
    const box = document.createElement('div');
    box.className = 'metabox';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'stretch';
    const last = p.sessions[p.sessions.length - 1];
    const addCmd = (label, cmd) => addCopyRow(box, label, cmd);
    addCmd('Reopen the latest session with its full history (ask it why it did things):',
      'cd ' + p.wtPath + ' && claude --resume ' + last.id);
    addCmd('Independent evaluation of what it produced (fresh reviewer, diff + transcript cross-check):',
      'cd ' + p.wtPath + ' && claude "Critically evaluate the uncommitted work here, produced '
      + 'by an automated session for the plan ' + p.file + '. Review the full diff for correctness, '
      + 'convention compliance, and test honesty (do the claimed tests exist and pass?). Then '
      + 'cross-check the transcript at ' + p.transcriptDir + '/' + last.id + '.jsonl for skipped '
      + 'steps, unverified claims, or decisions that deviate from the plan. Report findings ranked by severity."');
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = '🧠 AI session history — ' + p.sessions.length + ' session(s), latest '
      + new Date(last.mtime).toLocaleString();
    det.appendChild(sum);
    det.appendChild(box);
    byId('sessbox').appendChild(det);
  }
  // the PR under the summary: what is loaded now, at once, so a repaint does not jump
  const prNow = () => selected === p.key && byId('prview') && (prTab[p.key] || 'plan') === 'plan';
  const prOld = withPr && (loadPlan || !prData[p.key] || prData[p.key].from !== JSON.stringify(p.pr));
  if (withPr && prData[p.key]) { drawBarAction(p, 'plan'); drawPr(p); }
  else if (withPr) byId('prview').innerHTML = '<div class="dim">loading PR #' + p.pr.number + '…</div>';
  if (prOld) {
    busy(true);
    loadPr(p).then(() => { if (prNow()) { drawBarAction(p, 'plan'); drawPr(p); } }).finally(() => busy(false));
  }
  // full plan, folded under "Show the full plan", rendered as markdown
  if (loadPlan || !planCache[p.key])
    planCache[p.key] = await (await fetch('/api/plan?project=' + p.project + '&slug=' + p.slug)).text();
  const pm = byId('planmd');   // gone when another plan or tab opened while the text loaded
  if (pm && selected === p.key) pm.innerHTML = md(planCache[p.key]);
}

// a label and a read-only command with a copy button, under it
function addCopyRow(box, label, cmd) {
  const l = document.createElement('div'); l.className = 'dim'; l.style.marginTop = '6px';
  l.textContent = label; box.appendChild(l);
  const row = document.createElement('div');
  row.style.display = 'flex'; row.style.gap = '8px';
  const inp = document.createElement('input');
  inp.readOnly = true; inp.value = cmd; inp.style.flex = '1';
  inp.style.font = '12px ui-monospace,monospace';
  inp.addEventListener('focus', () => inp.select());
  const b = document.createElement('button'); b.textContent = 'copy';
  b.addEventListener('click', async () => {
    const ok = await copyText(cmd);
    b.textContent = ok ? '✓' : 'press ⌘C';
    if (!ok) { inp.focus(); inp.select(); }   // leave it selected to copy by hand
    setTimeout(() => (b.textContent = 'copy'), 1600);
  });
  row.appendChild(inp); row.appendChild(b); box.appendChild(row);
}
// A worktree from the worktrees section: where it is, the agent that worked in it, and its PR
// (the same PR view and Files changed as a plan's). No plan text, status, tags or launch.
function renderWtDetail(p, loadPr0) {
  const withPr = !!p.pr;
  byId('detail').innerHTML = `
    <div class="dhead"><div class="dtitle">
      <div class="crumb">${esc(p.client)} / ${projPill(p.project)}${esc(p.project)} / worktree</div>
      <h2 class="fname">${esc(p.name)}</h2>
      <div class="subtitle">${inline(p.title)}</div></div>
      <div class="btns" id="actions"></div></div>
    ${withPr ? '<div class="prtabsrow"><div class="prtabs"></div><span class="btns" id="ract"></span></div>' : ''}
    <div class="badges">${wtChips(p)}</div>
    <div class="metabox" style="flex-direction:column;align-items:stretch;gap:4px">
      <div><b>Branch:</b> <code>${esc(p.branch || '(detached)')}</code></div>
      <div><b>Folder:</b> <code>${esc(p.path)}</code></div>
      ${p.subject ? '<div><b>Last commit:</b> ' + esc(p.subject) + (p.committedAt ? ' <span class="dim">· ' + ago(p.committedAt) + '</span>' : '') + '</div>' : ''}
      ${p.dirty ? '<div><b>Not committed:</b> ' + p.dirty + ' file' + (p.dirty === 1 ? '' : 's') + '</div>' : ''}
    </div>
    <div id="sessbox"></div>
    ${!withPr && p.prError ? '<div class="ghhint">PRs are not shown: ' + esc(p.prError) + '.</div>' : ''}
    ${withPr && p.pr.state === 'MERGED' ? '<div class="mergedline"><span>✓ PR #' + p.pr.number +
      ' was merged into <code>' + esc(p.pr.base || '?') + '</code>' + (p.pr.mergedAt ? ' on ' + esc(new Date(p.pr.mergedAt).toLocaleString()) : '') +
      '</span><a href="' + escA(p.pr.url) + '" target="_blank" rel="noopener">↗ GitHub</a></div>' : ''}
    ${withPr ? '<div id="prview" class="pvpr"></div>'
      : '<div class="summary dim">No PR for <code>' + esc(p.branch || p.name) + '</code> yet.</div>'}`;
  document.body.classList.remove('review');
  bindPrTabs(p);
  const A = byId('actions');
  const vs = document.createElement('button');
  vs.textContent = '🖥 Open in VS Code';
  vs.addEventListener('click', () => post('/api/vscode', { project: p.project, slug: p.slug }));
  A.appendChild(vs);
  if (p.sessions && p.sessions.length) {
    const box = document.createElement('div');
    box.className = 'metabox';
    box.style.flexDirection = 'column';
    box.style.alignItems = 'stretch';
    const last = p.sessions[p.sessions.length - 1];
    addCopyRow(box, 'Reopen the latest session with its full history:', 'cd ' + last.dir + ' && claude --resume ' + last.id);
    for (const s of p.sessions.slice(0, -1).reverse())
      addCopyRow(box, 'Older session, last written ' + new Date(s.mtime).toLocaleString() + ':',
        'cd ' + s.dir + ' && claude --resume ' + s.id);
    const det = document.createElement('details');
    const sum = document.createElement('summary');
    sum.textContent = '🧠 Agent sessions — ' + p.sessions.length + ', latest ' + new Date(last.mtime).toLocaleString();
    det.appendChild(sum); det.appendChild(box);
    byId('sessbox').appendChild(det);
  }
  if (!withPr) return;
  const prNow = () => selected === p.key && byId('prview') && (prTab[p.key] || 'plan') === 'plan';
  const prOld = loadPr0 || !prData[p.key] || prData[p.key].from !== JSON.stringify(p.pr);
  if (prData[p.key]) { drawBarAction(p, 'plan'); drawPr(p); }
  else byId('prview').innerHTML = '<div class="dim">loading PR #' + p.pr.number + '…</div>';
  if (prOld) {
    busy(true);
    loadPr(p).then(() => { if (prNow()) { drawBarAction(p, 'plan'); drawPr(p); } }).finally(() => busy(false));
  }
}

// --- pull request tabs: the PR on the plan's branch (auto/<slug>), its text and its diff ---
const prTab = {}, prData = {}, prDiff = {}, prFile = {}, prClosedDirs = {}, prFileQ = {}, prNotes = {};
const moreOpen = new Set(), planOpen = new Set();   // plan tab: what the user unfolded, kept across repaints
// a run report's link to its own PR opens the PR tab here; any other link opens on the web
function openRunLink(p, url) {
  const same = (a, b) => String(a).replace(/\/+$/, '') === String(b).replace(/\/+$/, '');
  if (p && p.pr && same(p.pr.url, url)) {
    selected = p.key; prTab[p.key] = 'pr'; lastPrDraw = null;
    renderList(); renderDetail(true);
  } else window.open(url, '_blank', 'noopener');
}
let mergeMethod = null;
try { mergeMethod = localStorage.getItem('dash-merge-method'); } catch {}
// what the PR tab was last drawn from: a 5s poll with nothing new for it must not
// throw away the open file and the scroll position
let lastPrDraw = null;
const PR_CHIP = { OPEN: 'ok', MERGED: 'merged', CLOSED: 'bad' };
const prChip = (pr) => {
  const draft = pr.isDraft && pr.state === 'OPEN';
  return '<span class="chip ' + (draft ? '' : PR_CHIP[pr.state] || '') + '">' + (pr.state === 'MERGED' ? '✓ ' : '') + 'PR #' + pr.number + ' · ' +
    (draft ? 'draft' : String(pr.state).toLowerCase()) + '</span>';
};
let prViewed = {};   // PR url -> { path: hash of its diff } — a file changed since is unviewed again
try { prViewed = JSON.parse(localStorage.getItem('dash-pr-viewed') || '{}'); } catch {}
const saveViewed = () => { try { localStorage.setItem('dash-pr-viewed', JSON.stringify(prViewed)); } catch {} };
const isViewed = (p, f) => (prViewed[p.pr.url] || {})[f.path] === f.hash;
// a third mark next to viewed: "recheck" (⚑), a file to come back to. One file is unmarked,
// viewed or to recheck: flagging takes the viewed tick off, ticking viewed takes the flag off.
let prRecheck = {};   // PR url -> { path: true }
try { prRecheck = JSON.parse(localStorage.getItem('dash-pr-recheck') || '{}'); } catch {}
const saveRecheck = () => { try { localStorage.setItem('dash-pr-recheck', JSON.stringify(prRecheck)); } catch {} };
const isRecheck = (p, f) => !!(prRecheck[p.pr.url] || {})[f.path];
const marksText = (p, files) => {
  const k = files.filter((x) => isRecheck(p, x)).length;
  return files.filter((x) => isViewed(p, x)).length + ' of ' + files.length + ' viewed' + (k ? ' · ⚑ ' + k + ' to recheck' : '');
};
let diffSplit = true, diffFull = true;
try { diffSplit = localStorage.getItem('dash-diff-split') !== '0'; } catch {}
try { diffFull = localStorage.getItem('dash-diff-full') !== '0'; } catch {}

// inBar: the review toolbar, where ‹ Plan is the way back, the viewed line has the file count and Chat sits with the actions;
// 'hd': the main header, laid out as the toolbar but with the file count (no viewed line there)
const prTabs = (p, tab, inBar) => !p.pr && !hasChat(p) ? '' : '<div class="prtabs">' + [
  // the plan and its PR are one tab; in the review bar it is the way back, beside ‹ Plan
  (!inBar || p.pr) && ['plan', (p.kind === 'wt' ? 'Worktree' : 'Plan') + (p.pr ? ' · PR <span class="n">#' + p.pr.number + '</span>' : '')],
  p.pr && ['files', 'Files changed' + (inBar === true ? '' : ((n) => n != null ? ' <span class="n">' + n + '</span>' : '')(
    prData[p.key] && prData[p.key].changedFiles != null ? prData[p.key].changedFiles
      : prDiff[p.key] && prDiff[p.key].files ? prDiff[p.key].files.length : null))],
].filter(Boolean).map(([id, label]) => '<button class="' + (id === tab ? 'on' : '') + '" data-tab="' + id + '">' + label + '</button>').join('') +
  (inBar ? '' : chatBtn(p)) + '</div>';
// the same switch in the main header, so the plan view has it where Files changed has it
function drawHdTabs(p) {
  const h = byId('hdtabs');
  if (!h) return;
  h.innerHTML = p && p.pr ? prTabs(p, 'plan', 'hd') : '';
  h.parentElement.classList.toggle('tabs', !!h.innerHTML);
  h.parentElement.style.setProperty('--tabsw', h.offsetWidth + 'px');
  h.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => {
    prTab[p.key] = el.dataset.tab; lastPrDraw = null; renderDetail(false);
  }));
}
function bindPrTabs(p) {
  byId('detail').querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => {
    prTab[p.key] = el.dataset.tab; lastPrDraw = null; renderDetail(false);
  }));
  byId('detail').querySelectorAll('[data-chat]').forEach((el) => el.addEventListener('click', () => toggleChat()));
}
// --- Chat panel: the Claude session that ran the plan, beside Files changed and the plan ---
// Like the VS Code extension's panel: the whole session (the run, then the chat) scrolls above
// the box, the answer streams in, an Allow / Deny card comes up when the agent needs a
// permission, / lists the session's skills and commands, @ the PR's files, and lines selected
// in the diff or the plan go with the next message. The panel lives outside #detail, so
// opening another file or tab does not touch it.
// a worktree item's sessions run outside the dashboard: they have resume commands, not the chat panel
const hasChat = (p) => !!(p && p.kind !== 'wt' && ((p.sessions && p.sessions.length) || p.asked));
// the modes are the server's; only their names on the picker are the page's
const CHAT_MODE_NAMES = { default: 'Ask before edits', acceptEdits: 'Edit automatically', plan: 'Plan mode', auto: 'Auto' };
const CHAT_MODES = /*@CHAT_MODES*/[].map((m) => [m, CHAT_MODE_NAMES[m] || m]);
let chatOn = false, chatW = 0, chatMode = 'default', chatModel = '';
try {
  chatOn = localStorage.getItem('dash-chat-open') === '1';
  chatW = +localStorage.getItem('dash-chat-w') || 0;
  chatMode = localStorage.getItem('dash-chat-mode') || 'default';
  chatModel = localStorage.getItem('dash-chat-model') || '';
} catch {}
let ch = null;        // the chat on screen: { p, key, items, first, total, session, st, es }
let chatLock = null;  // the lock on that chat: { key, release }
let chatSel = null;   // the lines that go with the next message
const chatDraft = {}, chatImgs = {}, chatMetas = {};   // plan key -> unsent text, unsent images; project -> commands and models
// sent messages, oldest first; ArrowUp on the first line steps back through them, like a terminal.
// chatHistList is fixed while you step: the dashboard's own sends, then this chat's messages from its log
let chatHist = [], chatHistAt = -1, chatHistDraft = '', chatHistList = [];
try { chatHist = JSON.parse(localStorage.getItem('dash-chat-hist') || '[]'); } catch {}
function chatHistPush(text) {
  chatHistAt = -1;
  if (chatHist[chatHist.length - 1] === text) return;
  chatHist.push(text);
  chatHist = chatHist.slice(-100);
  try { localStorage.setItem('dash-chat-hist', JSON.stringify(chatHist)); } catch {}
}
const chatBtn = (p) => hasChat(p) ? '<button class="chatbtn' + (chatOn ? ' on' : '') + '" data-chat="1" aria-pressed="' + chatOn +
  '" title="Chat with the agent that ran this plan">Chat' + (p.chatWaits ? ' <span class="n">!</span>' : '') + '</button>' : '';
let chatAutoFor = null;
function autoChat(p) {
  if (chatAutoFor === p.key) return;
  chatAutoFor = p.key;
  if (hasChat(p) && !chatOn) {
    chatOn = true;
    document.querySelectorAll('[data-chat]').forEach((b) => { b.classList.add('on'); b.setAttribute('aria-pressed', 'true'); });
  }
}
// the chat panel's width (and its divider), so the header switch centers over the same space as the review bar's
new ResizeObserver(() => document.body.style.setProperty('--chatw', (byId('chat').offsetWidth + byId('csplit').offsetWidth) + 'px'))
  .observe(byId('chat'));
function toggleChat(on) {
  chatOn = on == null ? !chatOn : on;
  try { localStorage.setItem('dash-chat-open', chatOn ? '1' : '0'); } catch {}
  document.querySelectorAll('[data-chat]').forEach((b) => { b.classList.toggle('on', chatOn); b.setAttribute('aria-pressed', String(chatOn)); });
  syncChat(find(selected));
  if (chatOn && byId('cin')) byId('cin').focus();
}
function setChatWidth(px, save) {
  const C = byId('chat');
  C.style.width = px ? Math.round(Math.max(320, Math.min(px, window.innerWidth * 0.7))) + 'px' : '';
  chatW = px ? C.offsetWidth : 0;
  if (save) try { chatW ? localStorage.setItem('dash-chat-w', chatW) : localStorage.removeItem('dash-chat-w'); } catch {}
}
// shown for the open plan when the panel is on and the plan has a session to talk to
function syncChat(p) {
  const show = chatOn && hasChat(p);
  byId('chat').hidden = byId('csplit').hidden = !show;
  if (!show) { if (ch) { ch.es.close(); ch = null; } holdChatLock(); return; }
  if (ch && ch.key === p.key) { ch.p = p; return; }
  chatBind(p);
  holdChatLock();
}
// a lock tells the other tabs that this tab has the chat open, so they leave its alerts to this tab.
// The browser drops the lock when the tab closes.
function holdChatLock() {
  const key = ch ? ch.key : null;
  if ((chatLock ? chatLock.key : null) === key) return;
  if (chatLock) chatLock.release();
  chatLock = null;
  if (!key || !navigator.locks) return;
  let release;
  const held = new Promise((r) => { release = r; });
  chatLock = { key, release };
  navigator.locks.request('dash-chat:' + key, { mode: 'shared' }, () => held).catch(() => {});
}
function chatBind(p) {
  if (ch) ch.es.close();
  const c = ch = { p, key: p.key, items: {}, first: 0, total: 0, session: null, st: {}, open: new Set(), sent: [] };
  if (chatAnswered.has(p.key)) { markAnswered(p.key, false); renderList(); }
  const C = byId('chat');
  if (chatW) C.style.width = chatW + 'px';
  C.innerHTML =
    '<div class="chead"><b>Chat</b>' + projPill(p.project) + '<span class="dim cwho" id="cwho"></span><span style="flex:1"></span>' +
      '<button id="cfork" title="The next message goes on in a copy of this session. The session so far stays as it is.">Fork</button>' +
      '<button id="cnew" hidden title="The next message starts again from the run’s latest session">New chat</button>' +
      '<button id="cclose" title="Close the chat" aria-label="Close the chat">✕</button></div>' +
    '<div class="clog" id="clog" aria-live="polite"><div class="dim cmore" id="cmore"></div><div id="citems"></div>' +
      '<div id="clive"></div></div>' +
    '<div id="cwaits"></div>' +
    '<div class="cbox"><div id="cmenu" class="cmenu" role="listbox" hidden></div><div id="csel"></div><div id="cimgs" class="cimgs"></div>' +
      '<textarea id="cin" rows="3" aria-label="Message for the agent" placeholder="Ask or tell the agent what to do. / for skills and commands, @ for a file. Enter sends, Shift+Enter starts a new line."></textarea>' +
      '<div class="crow"><select id="cmode" aria-label="Permission mode" title="What the agent may do without asking (Shift+Tab switches)">' +
        CHAT_MODES.map(([v, l]) => '<option value="' + v + '"' + (v === chatMode ? ' selected' : '') + '>' + l + '</option>').join('') + '</select>' +
        '<select id="cmodel" aria-label="Model"><option value="">Model: default</option></select>' +
        '<span class="cctx" id="cctx" hidden></span><span class="cidle" id="cidle" hidden></span><button id="ccompact">Compact</button>' +
        '<button id="csync" hidden>Fix conflicts</button>' +
        '<span style="flex:1"></span><button id="cstop" hidden>Stop</button><button id="cgo" class="primary">Send</button></div></div>';
  const inp = byId('cin');
  inp.value = chatDraft[p.key] || '';
  chatHistAt = -1;
  inp.addEventListener('input', () => { chatDraft[c.key] = inp.value; chatHistAt = -1; chatMenu(); });
  inp.addEventListener('click', chatMenu);
  inp.addEventListener('keydown', chatKey);
  // a pasted or dropped picture goes with the next message, as in the VS Code extension
  inp.addEventListener('paste', (e) => {
    const d = e.clipboardData, fs = [...(d ? d.files : [])].filter((f) => f.type.startsWith('image/'));
    if (!fs.length) return;
    if (!d.types.includes('text/plain')) e.preventDefault();
    chatAddImgs(fs);
  });
  const box = inp.closest('.cbox');
  box.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); });
  box.addEventListener('drop', (e) => {
    const fs = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'));
    if (!fs.length) return;
    e.preventDefault();
    chatAddImgs(fs);
  });
  paintImgs();
  inp.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== inp) byId('cmenu').hidden = true; }, 150));
  byId('cgo').addEventListener('click', () => chatSendMsg());
  byId('ccompact').addEventListener('click', (e) => {
    if (!confirm('Compact this chat?\n\nThe agent replaces the conversation so far with a summary. Details of earlier messages are lost to it.')) return;
    e.target.disabled = true; chatSendMsg('/compact').finally(paintContext);
  });
  byId('csync').addEventListener('click', (e) => {
    const d = prData[c.key];
    if (!d || !d.baseRefName) return;
    e.target.disabled = true;
    chatSendMsg('/merge-parent ' + d.baseRefName);
  });
  paintSync();
  byId('cstop').addEventListener('click', () => post('/api/chat/stop', { project: c.p.project, slug: c.p.slug }));
  byId('cclose').addEventListener('click', () => toggleChat(false));
  byId('cfork').addEventListener('click', () => post('/api/chat/fork', { project: c.p.project, slug: c.p.slug }));
  byId('cnew').addEventListener('click', () => post('/api/chat/new', { project: c.p.project, slug: c.p.slug }));
  byId('cmode').addEventListener('change', (e) => chatSetMode(e.target.value, chatModel));
  byId('cmodel').addEventListener('change', (e) => chatSetMode(chatMode, e.target.value));
  const L = byId('clog');
  L.addEventListener('click', async (e) => {
    const j = e.target.closest && e.target.closest('.cjump');
    if (j) { e.preventDefault(); return chatJump(find(c.key) || c.p, j.dataset.jump); }
    const b = e.target.closest && e.target.closest('.ccopy');
    if (!b) return;
    const it = b.dataset.copymsg != null ? c.items[+b.dataset.copymsg] : null;
    const ok = await copyText(it ? it.text : b.parentElement.querySelector('pre').textContent);
    b.textContent = ok ? 'Copied' : 'Copy failed';
    setTimeout(() => { b.textContent = 'Copy'; }, 1400);
  });
  L.addEventListener('scroll', () => { if (L.scrollTop < 150) chatLoad('old'); }, { passive: true });
  jumpToBottom(L);
  // a tool line keeps its open state when the list repaints
  L.addEventListener('toggle', (e) => {
    const i = e.target.dataset && e.target.dataset.i;
    if (i != null) e.target.open ? c.open.add(+i) : c.open.delete(+i);
  }, true);
  paintSel();
  chatLoad('init');
  chatMetaLoad(p);
  c.es = new EventSource('/api/chat/events?project=' + encodeURIComponent(p.project) + '&slug=' + encodeURIComponent(p.slug));
  c.es.addEventListener('state', (e) => { if (ch === c) { chatState(JSON.parse(e.data)); localSoon(); } });
  c.es.addEventListener('history', () => { if (ch === c) { chatLoad('new'); localSoon(); } });
  c.es.addEventListener('delta', (e) => {
    if (ch !== c) return;
    const d = JSON.parse(e.data);
    c.st.partial = d.reset ? '' : (c.st.partial || '') + d.text;
    if (d.landing) c.st.landing = d.landing;
    paintLive();
  });
}
async function chatMetaLoad(p) {
  let m = chatMetas[p.project];
  if (!m) {
    m = await fetch('/api/chat/meta?project=' + encodeURIComponent(p.project) + '&slug=' + encodeURIComponent(p.slug))
      .then((r) => r.json()).catch(() => null);
    if (m && m.ok) chatMetas[p.project] = m;
  }
  const S = byId('cmodel');
  if (!m || !S || !ch || ch.p.project !== p.project) return;
  S.innerHTML = (m.models.length ? m.models : [{ value: '', name: 'Model: default' }]).map((x) =>
    '<option value="' + escA(x.value === 'default' ? '' : x.value) + '" title="' + escA(x.description || '') + '">' + esc(x.name) + '</option>').join('');
  S.value = chatModel;
  if (S.value !== chatModel) S.value = '';
  paintContext();
}
// the context meter beside the pickers. The window size comes from the session, or before its
// first answer from the probe of that folder; without either it shows only the count.
function paintContext() {
  const c = ch, E = byId('cctx'), B = byId('ccompact');
  if (!c || !E || !B) return;
  B.disabled = !!c.st.busy;
  B.title = c.st.busy ? 'Wait for the agent to finish this step' : 'Run /compact: replace the earlier conversation with a summary, to free up context';
  const x = c.st.context, max = (x && x.max) || (chatMetas[c.p.project] || {}).contextMax || 0;
  E.hidden = !x;
  if (!x) return;
  const tok = (n) => n >= 1e6 ? +(n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n);
  const pct = max ? Math.round(x.used / max * 100) : null;
  E.className = 'cctx' + (pct >= 90 ? ' bad' : pct >= 70 ? ' warn' : '');
  E.title = 'Context used: ' + x.used.toLocaleString() + (max ? ' of ' + max.toLocaleString() : '') + ' tokens';
  E.setAttribute('aria-label', E.title);
  E.innerHTML = pct == null ? esc(tok(x.used)) + ' used'
    : '<span class="cctxbar"><i style="width:' + Math.min(pct, 100) + '%"></i></span>' + pct + '% of ' + esc(tok(max));
}
// the time since the session's last activity; past an hour the prompt cache has likely expired,
// so the next message reads the whole context again at full price
const CACHE_TTL_MS = 60 * 60 * 1000;
function paintIdle() {
  const c = ch, E = byId('cidle');
  if (!c || !E) return;
  const from = c.st.idleFrom;
  E.hidden = !from || !!c.st.busy;
  if (E.hidden) return;
  const ms = Math.max(0, Date.now() - from), m = Math.floor(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  const ago = d ? d + 'd ' + (h % 24) + 'h' : h ? h + 'h ' + (m % 60) + 'm' : m + 'm';
  const cold = ms >= CACHE_TTL_MS;
  E.className = 'cidle' + (cold ? ' warn' : '');
  E.textContent = 'idle ' + ago;
  E.title = cold ? 'Prompt cache likely expired (idle ' + ago + '). The next message reads the whole context again.'
    : 'Last activity ' + ago + ' ago. The prompt cache usually lasts 1 hour.';
  E.setAttribute('aria-label', E.title);
}
setInterval(paintIdle, 30000);
// "Fix conflicts" in the chat row: shown when the PR's base has commits the PR lacks, or GitHub
// reports conflicts. It sends /merge-parent <base>: merge the base in, fix, check, push.
function paintSync() {
  const B = byId('csync'), d = ch && prData[ch.key];
  if (!B) return;
  const conflicts = d && d.mergeable === 'CONFLICTING';
  B.hidden = !(d && d.state === 'OPEN' && d.baseRefName && (conflicts || d.behindBy > 0));
  if (B.hidden) return;
  B.disabled = false;
  B.title = (conflicts ? 'Conflicts with ' + d.baseRefName + '. ' : '') +
    (d.behindBy > 0 ? d.baseRefName + ' has ' + d.behindBy + ' commit' + (d.behindBy > 1 ? 's' : '') + ' this branch does not have. ' : '') +
    'Sends /merge-parent ' + d.baseRefName + ': the agent merges it in, fixes the conflicts, runs the checks and pushes.';
}
function chatSetMode(mode, model) {
  chatMode = mode; chatModel = model;
  try { localStorage.setItem('dash-chat-mode', mode); localStorage.setItem('dash-chat-model', model); } catch {}
  byId('cmode').value = mode;
  if (ch) post('/api/chat/mode', { project: ch.p.project, slug: ch.p.slug, mode, model: model || 'default' });
}
// 'init': the last page; 'old': the page before the first item shown; 'new': what changed at the end
async function chatLoad(how) {
  const c = ch;
  if (!c || (how === 'old' && (c.loadingOld || c.first <= 0))) return;
  // one reload of the end at a time: an older answer landing last would undo a newer one
  if (how !== 'old') {
    if (c.loading) { c.again = c.again === 'init' || how === 'init' ? 'init' : 'new'; return; }
    c.loading = true;
    try { await chatLoadEnd(c, how); } finally { c.loading = false; }
    if (ch === c && c.again) { const next = c.again; c.again = null; chatLoad(next); }
    return;
  }
  return chatLoadEnd(c, how);
}
async function chatLoadEnd(c, how) {
  let q = '';
  const was = { first: c.first, session: c.session };
  if (how === 'old') { c.loadingOld = true; q = '&before=' + c.first; }
  if (how === 'new' && c.session) {
    // from the first tool call still waiting for its result, else from the end
    let from = c.total;
    for (let i = Math.max(c.first, c.total - 300); i < c.total; i++)
      if (c.items[i] && c.items[i].k === 'tool' && !c.items[i].done) { from = i; break; }
    // a slash command's selection is written after the command, and the server puts it on the command's bubble
    let y = c.total - 1;
    while (y >= c.first && c.items[y] && c.items[y].k === 'note') y--;
    if (y >= c.first && c.items[y] && c.items[y].k === 'you' && !(c.items[y].sel || []).length
      && c.items[y].text.startsWith('/')) from = Math.min(from, y);
    q = '&from=' + from;
  }
  const r = await fetch('/api/chat/history?project=' + encodeURIComponent(c.p.project) + '&slug=' + encodeURIComponent(c.p.slug) + q)
    .then((x) => x.json()).catch(() => null);
  if (how === 'old') c.loadingOld = false;
  if (ch !== c || !r) return;
  if (how !== 'init' && r.session !== c.session) { if (how === 'old') chatLoad('init'); else c.again = 'init'; return; }
  if (how === 'old' && (c.first !== was.first || c.session !== was.session)) return;   // the list was redrawn meanwhile
  c.landed = Math.max(c.landed || 0, r.landed || 0);
  const L = byId('clog'), box = byId('citems');
  const atEnd = L.scrollHeight - L.scrollTop - L.clientHeight < 80;
  const html = (list) => list.map((it) => { c.items[it.i] = it; return chatItemHtml(it, c); }).join('');
  if (how === 'init') {
    c.session = r.session; c.items = {}; c.first = r.first; c.total = r.total;
    box.innerHTML = html(r.items);
    L.scrollTop = L.scrollHeight;
  } else if (how === 'old') {
    const h = L.scrollHeight;
    c.first = r.first;
    box.insertAdjacentHTML('afterbegin', html(r.items));
    L.scrollTop += L.scrollHeight - h;
  } else {
    box.querySelector('.askempty')?.remove();
    [...box.children].forEach((el) => { if (+el.dataset.i >= r.first) el.remove(); });
    for (let i = r.first; i < c.total; i++) delete c.items[i];
    box.insertAdjacentHTML('beforeend', html(r.items));
    c.total = r.total;
    if (atEnd) L.scrollTop = L.scrollHeight;
  }
  box.querySelectorAll('.amsg.agent pre:not([data-cp])').forEach((pre) => {
    pre.dataset.cp = '1';
    const w = document.createElement('div');
    w.className = 'cpre';
    pre.replaceWith(w);
    w.append(pre);
    w.insertAdjacentHTML('beforeend', '<button class="ccopy" data-copycode="1" title="Copy this block">Copy</button>');
  });
  byId('cmore').textContent = c.first > 0 ? 'Scroll up for earlier messages' : '';
  if (!c.total) box.innerHTML = '<div class="dim askempty">No messages in this session yet.</div>';
  // a sent message leaves the live area once the session log has it; when the agent is idle, it has read them all
  const said = Object.values(c.items).filter((it) => it.k === 'you');
  c.sent = c.sent.filter((s) => !(s.ok && !c.st.busy) && !said.some((it) => it.i >= s.from && it.text.trim() === s.text));
  paintLive();
}
const chatTime = (at) => at ? new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
// the hover time of an answer, a tool or a note: seconds, and the day only when it is not today
const clock = (at) => {
  const d = new Date(at), today = d.toDateString() === new Date().toDateString();
  return d.toLocaleString([], { ...(today ? {} : { month: 'short', day: 'numeric' }), hour: '2-digit', minute: '2-digit', second: '2-digit' });
};
const took = (ms) => ms < 60000 ? Math.floor(ms / 1000) + 's' : ms < 3600000 ? Math.floor(ms / 60000) + 'm ' + Math.floor(ms % 60000 / 1000) + 's'
  : Math.floor(ms / 3600000) + 'h ' + Math.floor(ms % 3600000 / 60000) + 'm';
const atTitle = (it) => !it.at ? '' : ' title="' + escA(it.end && it.end !== it.at
  ? 'Started ' + clock(it.at) + ', finished ' + clock(it.end) + ' (' + took(new Date(it.end) - new Date(it.at)) + ')' : clock(it.at)) + '"';
// a click on the chip opens the text that went with the message
const selChip = (label, text) => text
  ? '<button type="button" class="cchip cview" data-seltext="' + escA(text) + '" title="Show the text that went with this message">⧉ ' + esc(label) + '</button>'
  : '<span class="cchip">⧉ ' + esc(label) + '</span>';
function chatItemHtml(it, c) {
  const open = c.open.has(it.i) ? ' open' : '';
  if (it.k === 'you') return '<div class="cyou" data-i="' + it.i + '">' + (it.at ? '<div class="ctime">' + esc(chatTime(it.at)) + '</div>' : '') +
    '<div class="amsg you">' + (it.sel || []).map((s, n) => selChip(s, (it.selText || [])[n])).join('') +
    (it.urls && it.urls.length ? '<div class="cimgs">' + it.urls.map((u) => '<span class="cimg"><img src="' + escA(u) + '" alt="Pasted image"></span>').join('') + '</div>'
      : it.img ? '<div class="cimgs">' + Array.from({ length: it.imgs }, (_, n) => '<span class="cimg"><img loading="lazy" src="/api/chat/image?project=' +
        encodeURIComponent(c.p.project) + '&slug=' + encodeURIComponent(c.p.slug) + '&uuid=' + it.img + '&n=' + n + '" alt="Pasted image ' + (n + 1) + '"></span>').join('') + '</div>'
      : it.imgs ? '<span class="cchip">🖼 ' + (it.imgs === 1 ? 'image' : it.imgs + ' images') + '</span>' : '') +
    (it.text ? (/^\/[\w:-]+/.test(it.text) ? '<code>' + esc(it.text.split(' ')[0]) + '</code> ' + esc(it.text.split(' ').slice(1).join(' ')) : esc(it.text)) : '') + '</div></div>';
  if (it.k === 'agent') return '<div class="amsg agent mdc" data-i="' + it.i + '">' + md(it.text) +
    (it.at ? '<span class="cat">' + esc(clock(it.at)) + '</span>' : '') + '<button class="ccopy cmsg" data-copymsg="' + it.i + '" title="Copy the whole answer as Markdown">Copy</button></div>';
  if (it.k === 'think') return '<details class="cnote" data-i="' + it.i + '"' + open + '><summary' + atTitle(it) + '>Thinking</summary><div class="mdc">' + md(it.text) + '</div></details>';
  if (it.k === 'tool') return '<details class="ctool' + (it.err ? ' err' : '') + '" data-i="' + it.i + '"' + open + '><summary' + atTitle(it) + '>' + (it.sub ? '<i class="dim">subagent</i> ' : '') + '<b>' + esc(it.name) + '</b> ' +
    '<span>' + esc(it.sum) + '</span>' + (it.done ? '' : ' <i class="dim">running…</i>') +
    (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(it.name) && it.sum && it.sum[0] !== '/' && c.p.pr
      ? '<button class="cjump" data-jump="' + escA(it.sum) + '" title="Open this file in Files changed">view in diff</button>' : '') + '</summary>' +
    (it.input ? '<pre>' + esc(it.input) + '</pre>' : '') + (it.out ? '<pre class="out">' + esc(it.out) + '</pre>' : '') + '</details>';
  if (it.report) return '<details class="cnote report" data-i="' + it.i + '"' + open + '><summary' + atTitle(it) + '>' + esc(it.text) + '</summary><div class="mdc">' + md(it.body) + '</div></details>';
  const err = it.err ? ' err' : '';
  return it.body ? '<details class="cnote' + err + '" data-i="' + it.i + '"' + open + '><summary' + atTitle(it) + '>' + esc(it.text) + '</summary><pre>' + esc(it.body) + '</pre></details>'
    : '<div class="cnote' + err + '" data-i="' + it.i + '"' + atTitle(it) + '>' + esc(it.text) + '</div>';
}
function chatState(st) {
  const c = ch, was = c.st;
  c.st = st;
  const short = (id) => String(id || '').slice(0, 8);
  // the first 8 characters of the session id tell the chats apart; the full id is in the tooltip
  byId('cwho').textContent = (st.live ? '● ' : '') + (st.session ? short(st.session) : '') +
    (st.fork ? ' · next message: a copy' : st.current && st.current.copy ? ' · copy of ' + short(st.current.base) : '');
  byId('cwho').title = 'Session ' + (st.session || 'not started yet') + '. ' +
    (st.live ? 'The session is open. It closes after 15 minutes without a message.' : 'The next message opens the session.');
  byId('cnew').hidden = !(st.current && st.current.id !== st.latest);
  byId('cfork').disabled = !!st.fork;
  byId('cgo').textContent = st.busy ? 'Queue' : 'Send';
  byId('cgo').title = st.busy ? 'The agent reads it when it finishes this step' : '';
  byId('cstop').hidden = !st.busy;
  if (st.mode && st.mode !== chatMode) { chatMode = st.mode; byId('cmode').value = st.mode; }
  if (st.session !== c.session && c.session != null) chatLoad('init');
  else if (was.busy && !st.busy) chatLoad('new');
  paintLive();
  paintContext();
  paintIdle();
  paintWaits(st.waits || []);
  if (c.p) { const p = find(c.key); if (p) p.chatWaits = (st.waits || []).length; }
}
function paintLive() {
  const c = ch, st = c.st, V = byId('clive');
  if (!V) return;
  const L = byId('clog'), atEnd = L.scrollHeight - L.scrollTop - L.clientHeight < 80;
  const sentHtml = (list) => list.map((s) => chatItemHtml({ k: 'you', i: '', text: s.text, sel: s.sel, selText: s.selText, urls: s.urls }, c)
    .replace('>', '><div class="ctime">' + (!s.ok ? 'sending…' : s.queued ? 'queued: the agent reads it after this step' : 'sent') + '</div>')).join('');
  // the answer being written comes after a message sent to an idle agent, and before one that waits in the queue
  const cut = c.sent.findLastIndex((s) => !s.queued) + 1;
  V.innerHTML = sentHtml(c.sent.slice(0, cut)) +
    (st.landing || []).filter((l) => l.id > (c.landed || 0)).map((l) => '<div class="amsg agent mdc live">' + md(l.text) + '</div>').join('') +
    (st.partial ? '<div class="amsg agent mdc live">' + mdLive(st.partial) + '</div>' : '') +
    sentHtml(c.sent.slice(cut)) +
    (st.busy && !(st.waits || []).length ? '<div class="aend cwork">working…</div>' : '') +
    (st.error ? '<div class="aend bad">' + esc(st.error) + '</div>' : '') +
    (!st.busy && st.last && !st.last.ok ? '<div class="aend bad">' + (st.last.subtype === 'error_during_execution' ? 'Stopped'
      : esc(st.last.subtype || 'Stopped')) + '</div>' : '');
  if (atEnd) L.scrollTop = L.scrollHeight;
}
function paintWaits(waits) {
  const W = byId('cwaits'), c = ch;
  const sig = waits.map((w) => w.id).join();
  if (W.dataset.sig === sig) return;
  W.dataset.sig = sig;
  W.innerHTML = waits.map((w) => w.ask ? askHtml(w) : '<div class="cwait" data-w="' + escA(w.id) + '">' +
    (w.plan ? '<b>The agent has a plan and asks to start:</b><div class="mdc cplan">' + md(w.detail) + '</div>'
      : '<b>Allow ' + esc(w.tool) + '?</b>' + (w.description ? '<div class="dim">' + esc(w.description) + '</div>' : '') +
        (w.what && !(w.description && w.what.endsWith(w.description)) ? '<code>' + esc(w.what) + '</code>' : '') + (w.detail ? '<pre>' + esc(w.detail) + '</pre>' : '')) +
    '<div class="crow"><button class="primary" data-a="1">' + (w.plan ? 'Approve the plan' : 'Allow') + '</button>' +
      (w.always && !w.plan ? '<button data-a="2" title="Allow this command for the rest of this chat">Allow for this chat</button>' : '') +
      (w.edits && !w.plan ? '<button data-a="3" title="The agent edits files in this folder without asking until the chat closes. The mode picker shows Edit automatically.">Allow all edits in this chat</button>' : '') +
      '<button data-a="0">' + (w.plan ? 'Keep planning' : 'Deny') + '</button>' +
      '<span class="dim">' + (w.plan ? '' : 'To say what to do instead, type it below and click Deny.') + '</span></div></div>').join('');
  W.querySelectorAll('.cask').forEach((Q) => {
    const multi = Q.dataset.multi === '1', other = Q.querySelector('.cother');
    Q.querySelectorAll('.copt').forEach((o) => o.addEventListener('click', () => {
      if (!multi) { Q.querySelectorAll('.copt').forEach((x) => x !== o && x.classList.remove('on')); other.value = ''; }
      o.classList.toggle('on');
      askReady(Q.closest('[data-w]'));
    }));
    other.addEventListener('input', () => {
      if (!multi && other.value.trim()) Q.querySelectorAll('.copt').forEach((x) => x.classList.remove('on'));
      askReady(Q.closest('[data-w]'));
    });
  });
  W.querySelectorAll('[data-a]').forEach((b) => b.addEventListener('click', () => {
    const id = b.closest('[data-w]').dataset.w, a = +b.dataset.a, inp = byId('cin');
    if (a === 4) {
      W.querySelectorAll('button').forEach((x) => (x.disabled = true));
      post('/api/chat/answer', { project: c.p.project, slug: c.p.slug, id, allow: true, answers: askAnswers(b.closest('[data-w]')) })
        .then((r) => { if (!r.ok) { W.dataset.sig = ''; paintWaits(waits); } });
      return;
    }
    const message = a === 0 && inp.value.trim() ? inp.value.trim() : undefined;
    if (message) { inp.value = ''; delete chatDraft[c.key]; }
    W.querySelectorAll('button').forEach((x) => (x.disabled = true));
    post('/api/chat/answer', { project: c.p.project, slug: c.p.slug, id, allow: a > 0, always: a === 2, edits: a === 3, message });
  }));
  if (waits.length) byId('clog').scrollTop = byId('clog').scrollHeight;
}
// AskUserQuestion: each question with its options as buttons (one or several, as the agent
// allows) and a box for an answer of your own. Send answers is ready when every question has one.
function askHtml(w) {
  return '<div class="cwait" data-w="' + escA(w.id) + '"><b>The agent asks you' + (w.ask.length > 1 ? ' ' + w.ask.length + ' questions' : '') + ':</b>' +
    w.ask.map((q) => '<div class="cask" data-q="' + escA(q.question) + '" data-multi="' + (q.multi ? 1 : 0) + '">' +
      '<div>' + (q.header ? '<span class="chip">' + esc(q.header) + '</span> ' : '') + esc(q.question) +
        (q.multi ? ' <span class="dim">(pick one or more)</span>' : '') + '</div>' +
      q.options.map((o) => '<button class="copt" data-o="' + escA(o.label) + '"><b>' + esc(o.label) + '</b>' +
        (o.description ? '<span class="dim">' + esc(o.description) + '</span>' : '') + '</button>').join('') +
      '<input class="cother" placeholder="Other: type your own answer">' +
    '</div>').join('') +
    '<div class="crow"><button class="primary" data-a="4" disabled>Send answers</button><button data-a="0">Deny</button>' +
      '<span class="dim">To stop and say something else, type it below and click Deny.</span></div></div>';
}
function askAnswers(card) {
  const out = {};
  card.querySelectorAll('.cask').forEach((Q) => {
    const picked = [...Q.querySelectorAll('.copt.on')].map((o) => o.dataset.o), own = Q.querySelector('.cother').value.trim();
    if (own) picked.push(own);
    if (picked.length) out[Q.dataset.q] = picked.join(', ');
  });
  return out;
}
function askReady(card) {
  card.querySelector('[data-a="4"]').disabled = Object.keys(askAnswers(card)).length < card.querySelectorAll('.cask').length;
}
// a command from a button goes as it is: the draft and the selected lines stay for the next message
async function chatSendMsg(command) {
  const c = ch, inp = byId('cin'), text = command || inp.value.trim();
  const imgs = command || !c ? [] : chatImgs[c.key] || [];
  if (!c || (!text && !imgs.length)) return;
  byId('cmenu').hidden = true;
  const s = command ? null : chatSel;
  // shown at once; the session log has it only when the agent reads it
  const mine = { text, from: c.total, queued: !!c.st.busy,
    sel: s ? [(s.file ? s.file.slice(s.file.lastIndexOf('/') + 1) : 'selected text') +
      (s.start ? ':' + s.start + (s.end > s.start ? '-' + s.end : '') : '') + (s.side === 'old' ? ' (before)' : '')] : [],
    selText: s ? [s.text] : [], urls: imgs.map((x) => x.url) };
  c.sent.push(mine);
  paintLive();
  byId('clog').scrollTop = byId('clog').scrollHeight;
  const r = await post('/api/chat/send', { project: c.p.project, slug: c.p.slug, text, mode: chatMode, model: chatModel || 'default',
    selection: s ? { file: s.file, side: s.side, start: s.start, end: s.end, text: s.text } : null,
    images: imgs.map((x) => ({ media_type: x.media_type, data: x.data })) });
  if (!r.ok) c.sent = c.sent.filter((x) => x !== mine);
  else mine.ok = true;
  if (ch === c) paintLive();
  if (!r.ok || ch !== c) return;
  if (!command) {
    if (text) chatHistPush(text);
    inp.value = ''; delete chatDraft[c.key];
    delete chatImgs[c.key];
    if (ch === c) paintImgs();
    setChatSel(null);
  }
  c.st.partial = ''; c.st.busy = true; c.st.error = '';
  paintLive();
  paintIdle();
}
// --- the / and @ menu above the box ---
let chatMenuItems = [], chatMenuAt = 0, chatMenuPick = 0;
function chatMenu() {
  const inp = byId('cin'), M = byId('cmenu');
  const before = inp.value.slice(0, inp.selectionStart);
  const meta = chatMetas[ch.p.project] || { commands: [] };
  let m;
  chatMenuItems = [];
  // a / at the start of any line or after a space, so a skill can be named on a later line too
  if ((m = /(^|\s)\/([^\s]*)$/.exec(before))) {
    const f = m[2].toLowerCase();
    chatMenuItems = meta.commands.filter((x) => x.name.toLowerCase().includes(f))
      .sort((a, b) => (b.name.toLowerCase().startsWith(f) - a.name.toLowerCase().startsWith(f)))
      .slice(0, 60).map((x) => ({ ins: '/' + x.name + ' ', label: '/' + x.name, hint: x.hint, desc: x.description }));
    chatMenuAt = before.length - m[2].length - 1;
  } else if ((m = /(^|\s)@([^\s]*)$/.exec(before))) {
    const f = m[2].toLowerCase(), df = prDiff[ch.key];
    chatMenuItems = ((df && df.files) || []).map((x) => x.path).filter((x) => x.toLowerCase().includes(f))
      .slice(0, 60).map((x) => ({ ins: '@' + x + ' ', label: x.slice(x.lastIndexOf('/') + 1), desc: x }));
    chatMenuAt = before.length - m[2].length - 1;
  }
  if (!chatMenuItems.length) { M.hidden = true; return; }
  chatMenuPick = Math.min(chatMenuPick, chatMenuItems.length - 1);
  M.innerHTML = chatMenuItems.map((x, n) => '<div class="cmi' + (n === chatMenuPick ? ' on' : '') + '" role="option" data-n="' + n + '">' +
    '<b>' + esc(x.label) + '</b>' + (x.hint ? ' <span class="dim">' + esc(x.hint) + '</span>' : '') +
    (x.desc ? '<div class="dim">' + esc(x.desc) + '</div>' : '') + '</div>').join('');
  M.hidden = false;
  M.querySelectorAll('[data-n]').forEach((el) => el.addEventListener('mousedown', (e) => { e.preventDefault(); chatMenuUse(+el.dataset.n); }));
  const on = M.querySelector('.on');
  if (on) on.scrollIntoView({ block: 'nearest' });
}
function chatMenuUse(n) {
  const inp = byId('cin'), x = chatMenuItems[n];
  if (!x) return;
  const pos = inp.selectionStart;
  inp.value = inp.value.slice(0, chatMenuAt) + x.ins + inp.value.slice(pos).replace(/^\S*\s?/, '');
  const at = chatMenuAt + x.ins.length;
  inp.setSelectionRange(at, at);
  chatDraft[ch.key] = inp.value;
  chatMenuPick = 0;
  byId('cmenu').hidden = true;
  inp.focus();
}
function chatKey(e) {
  const M = byId('cmenu');
  if (!M.hidden && chatMenuItems.length) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      chatMenuPick = (chatMenuPick + (e.key === 'ArrowDown' ? 1 : -1) + chatMenuItems.length) % chatMenuItems.length;
      return chatMenu();
    }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); return chatMenuUse(chatMenuPick); }
    if (e.key === 'Escape') { e.preventDefault(); M.hidden = true; return; }
  }
  if (e.key === 'Tab' && e.shiftKey) {
    e.preventDefault();
    const i = CHAT_MODES.findIndex(([v]) => v === chatMode);
    return chatSetMode(CHAT_MODES[(i + 1) % CHAT_MODES.length][0], chatModel);
  }
  if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
    const inp = e.target, v = inp.value, a = inp.selectionStart, b = inp.selectionEnd, nl = String.fromCharCode(10);
    const up = e.key === 'ArrowUp';
    // only on the first line (up) or the last line (down), so the arrows still move inside a long message
    if (a !== b || (up ? v.lastIndexOf(nl, a - 1) !== -1 : v.indexOf(nl, b) !== -1)) return;
    if (up && chatHistAt === -1) {
      const said = Object.values(ch.items || {}).filter((it) => it.k === 'you' && it.text.trim())
        .sort((x, y) => x.i - y.i).map((it) => it.text.trim());
      chatHistList = [...chatHist.filter((t) => !said.includes(t)), ...said]
        .filter((t, n, all) => t !== all[n - 1]);
    }
    if (up ? !chatHistList.length || chatHistAt === 0 : chatHistAt === -1) return;
    e.preventDefault();
    if (up && chatHistAt === -1) { chatHistDraft = v; chatHistAt = chatHistList.length; }
    chatHistAt += up ? -1 : 1;
    if (chatHistAt >= chatHistList.length) chatHistAt = -1;
    inp.value = chatHistAt === -1 ? chatHistDraft : chatHistList[chatHistAt];
    chatDraft[ch.key] = inp.value;
    const at = up ? 0 : inp.value.length;
    inp.setSelectionRange(at, at);
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); chatSendMsg(); }
}
// --- pasted images: scaled to at most 2000 px on the long side, so each stays under the API's 5 MB ---
async function chatImgLoad(file) {
  const url = await new Promise((r) => { const f = new FileReader(); f.onload = () => r(f.result); f.onerror = () => r(''); f.readAsDataURL(file); });
  if (!url) return null;
  let type = file.type, out = url;
  if (type !== 'image/gif') {
    const img = new Image();
    img.src = url;
    try { await img.decode(); } catch { return null; }
    const big = Math.max(img.naturalWidth, img.naturalHeight), k = big > 2000 ? 2000 / big : 1;
    if (k < 1 || url.length > 5e6 || !['image/png', 'image/jpeg', 'image/webp'].includes(type)) {
      const cv = document.createElement('canvas'), g = cv.getContext('2d');
      cv.width = Math.round(img.naturalWidth * k); cv.height = Math.round(img.naturalHeight * k);
      g.drawImage(img, 0, 0, cv.width, cv.height);
      out = cv.toDataURL('image/png'); type = 'image/png';
      if (out.length > 5e6) {
        g.globalCompositeOperation = 'destination-over'; g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
        out = cv.toDataURL('image/jpeg', 0.85); type = 'image/jpeg';
      }
    }
  }
  if (out.length > 6.9e6) return null;
  return { media_type: type, data: out.slice(out.indexOf(',') + 1), url: out };
}
async function chatAddImgs(files) {
  const c = ch;
  if (!c) return;
  const got = (await Promise.all(files.map(chatImgLoad)));
  if (got.includes(null)) alert('⚠️ An image could not be read, or it is larger than 5 MB. It is not attached.');
  const list = chatImgs[c.key] = [...(chatImgs[c.key] || []), ...got.filter(Boolean)];
  if (list.length > 10) { list.length = 10; alert('⚠️ One message takes at most 10 images. The rest are not attached.'); }
  if (ch === c) paintImgs();
}
function paintImgs() {
  const S = byId('cimgs');
  if (!S || !ch) return;
  S.innerHTML = (chatImgs[ch.key] || []).map((x, n) => '<span class="cimg"><img src="' + escA(x.url) + '" alt="Pasted image ' + (n + 1) + '" title="Goes with the next message">' +
    '<button data-imgx="' + n + '" aria-label="Do not send image ' + (n + 1) + '" title="Do not send this image">✕</button></span>').join('');
  S.querySelectorAll('[data-imgx]').forEach((b) => b.addEventListener('click', () => {
    chatImgs[ch.key].splice(+b.dataset.imgx, 1);
    paintImgs();
    byId('cin').focus();
  }));
}
// --- selected lines: from VS Code's diff view, the table diff or the plan text ---
function setChatSel(s) { chatSel = s; paintSel(); }
function paintSel() {
  const S = byId('csel');
  if (!S) return;
  const s = chatSel;
  if (!s) { S.innerHTML = ''; return; }
  const name = s.file ? s.file.slice(s.file.lastIndexOf('/') + 1) : 'selected text';
  const n = s.start ? s.end - s.start + 1 : s.text.split('\n').length;
  S.innerHTML = '<span class="cchip csel cview" data-seltext="' + escA(s.text) + '" title="Goes with the next message. Click to see all of it.">⧉ <b>' + esc(name) +
    (s.start ? ':' + s.start + (s.end > s.start ? '-' + s.end : '') : '') + '</b>' + (s.side === 'old' ? ' (before)' : '') +
    '<span class="dim">' + n + ' line' + (n === 1 ? '' : 's') + ' selected</span>' +
    '<button id="cselx" aria-label="Do not send the selected lines" title="Do not send the selected lines">✕</button></span>';
  byId('cselx').addEventListener('click', (e) => { e.stopPropagation(); setChatSel(null); });
}
function chatPickFromEditor(e, side, file, s) {
  if (s.isEmpty()) { if (chatSel && chatSel.from === 'mono') setChatSel(null); return; }
  let end = s.endLineNumber;
  if (s.endColumn === 1 && end > s.startLineNumber) end--;
  setChatSel({ from: 'mono', file, side, start: s.startLineNumber, end, text: e.getModel().getValueInRange(s) });
}
document.addEventListener('mouseup', (e) => {
  if (!ch || !e.target.closest || !e.target.closest('#detail') || e.target.closest('.monaco-editor')) return;
  setTimeout(() => {
    const s = window.getSelection(), t = s ? String(s) : '';
    if (!t.trim()) { if (chatSel && chatSel.from === 'dom') setChatSel(null); return; }
    const n = s.anchorNode && (s.anchorNode.nodeType === 1 ? s.anchorNode : s.anchorNode.parentElement);
    const inPlan = n && n.closest('#planmd'), inDiff = n && n.closest('.pdbody');
    setChatSel({ from: 'dom', side: inPlan ? 'plan' : inDiff ? 'new' : 'text',
      file: inPlan ? ch.p.file : inDiff ? prFile[ch.key] || '' : '', text: t.slice(0, 20000) });
  });
});
byId('csplit').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  const bar = e.currentTarget;
  const move = (ev) => setChatWidth(window.innerWidth - ev.clientX);
  document.body.classList.add('dragging'); bar.classList.add('on');
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', () => {
    document.removeEventListener('pointermove', move);
    document.body.classList.remove('dragging'); bar.classList.remove('on');
    setChatWidth(chatW, true);
  }, { once: true });
});
byId('csplit').addEventListener('dblclick', () => setChatWidth(0, true));
byId('csplit').addEventListener('keydown', (e) => {
  if (!/^Arrow(Left|Right)$/.test(e.key)) return;
  e.preventDefault();
  setChatWidth(byId('chat').offsetWidth + (e.key === 'ArrowLeft' ? 40 : -40), true);
});
async function loadPr(p) {
  const r = await (await fetch('/api/pr?project=' + p.project + '&number=' + p.pr.number)).json();
  prData[p.key] = r.ok ? { ...r.pr, from: JSON.stringify(p.pr) } : { error: r.output || r.error, from: JSON.stringify(p.pr) };
  paintSync();
}
async function renderPrTab(p, tab, force) {
  // a new PR or a new commit redraws the tab; a state change (draft, ready, merged) only the bar
  // and the PR text, so Ready for review does not reload the diff
  const sig = p.key + tab + p.pr.number + p.pr.head;
  if (!force && lastPrDraw === sig && byId('prview')) {
    if (prData[p.key] && prData[p.key].from !== JSON.stringify(p.pr)) {
      // after an action here the tab already shows the new state: draw only what GitHub changed since
      const was = JSON.stringify({ ...prData[p.key], from: 0 });
      await loadPr(p);
      if (lastPrDraw !== sig || JSON.stringify({ ...prData[p.key], from: 0 }) === was) return;
      drawBarAction(p, tab);
      if (tab === 'pr' && byId('prbody')) drawPr(p);
    }
    return;
  }
  lastPrDraw = sig;
  // ⟳ on the tab already open: keep it on screen while GitHub answers, instead of a blank "loading"
  const pv = byId('prview'), again = force && pv && pv.dataset.of === p.key + tab;
  // only Files changed needs the whole window; the Pull request tab keeps the normal layout
  const review = tab === 'files';
  document.body.classList.toggle('review', review);
  if (!again) byId('detail').innerHTML = (review ? `
    <div class="rbar">
      <div class="rleft"><button id="rback" title="Back to the plan and the plan list (Esc)">‹ Plan</button>
        ${projPill(p.project)}<span class="rname" title="${escA((p.title || p.slug) + '\n' + p.client + ' / ' + p.project + ' / ' + p.file)}">${inline(p.title || p.slug)}</span></div>
      ${prTabs(p, tab, true)}
      <div class="rright"><span class="seen" id="rseen"></span>${chatBtn(p)}<span class="btns" id="ract"></span></div></div>` : `
    <div class="crumb">${esc(p.client)} / ${projPill(p.project)}${esc(p.project)}</div>
    <h2 class="fname">${p.file}</h2>
    <div class="subtitle">${inline(p.title)}</div>
    <div class="prtabsrow">${prTabs(p, tab)}<span class="btns" id="ract"></span></div>
    ${p.summary ? '<div class="summary prsum">💡 ' + esc(p.summary) + '</div>' : ''}`) + `
    <div id="prview" class="dim" style="padding:16px 24px" data-of="${escA(p.key + tab)}">loading PR #${p.pr.number}…</div>`;
  if (!again) {
    if (review) byId('rback').addEventListener('click', () => { prTab[p.key] = 'plan'; renderDetail(false); });
    bindPrTabs(p);
  }
  const d = prData[p.key];
  busy(true);
  try {
    if (force || !d || d.from !== JSON.stringify(p.pr)) await loadPr(p);
    if (lastPrDraw !== sig) return;   // another plan or tab was opened meanwhile
    drawBarAction(p, tab);
    if (tab === 'pr') drawPr(p);
    else await drawFiles(p, force);
  } finally { busy(false); }
}
// the one next step, always on the right of the bar: Ready for review, then Merge
function drawBarAction(p, tab) {
  const d = prData[p.key], R = byId('ract');
  if (!R || !d || d.error) return;
  // the PR's state when it is not simply open, then GitHub, then the one next step
  R.innerHTML = (d.state === 'OPEN' && !d.isDraft ? '' : prChip(d)) + '<a class="ghbtn" href="' + escA(d.url) + '" target="_blank" rel="noopener" ' +
    'title="Open the PR on GitHub">↗ GitHub</a>';
  // Files changed has no header with the plan's actions: the worktree in VS Code is here
  if (tab === 'files') {
    const vs = document.createElement('button');
    vs.textContent = 'VS Code'; vs.className = 'rfbtn vsbtn'; vs.title = 'Open the plan’s worktree in VS Code';
    vs.addEventListener('click', () => post('/api/vscode', { project: p.project, slug: p.slug }));
    R.insertBefore(vs, R.querySelector('.ghbtn'));
  }
  // the PR list is read once a minute; after a push this reads it, the PR and the diff now
  const rf = document.createElement('button');
  rf.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>';
  rf.className = 'rfbtn'; rf.title = 'Reload the PR from GitHub, for example after a push';
  rf.setAttribute('aria-label', 'Reload the PR from GitHub');
  rf.addEventListener('click', async () => {
    rf.disabled = true; busy(true);
    await fetch('/api/pr-refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: p.project, slug: p.slug }) }).catch(() => {});
    while (ticking) await new Promise((r) => setTimeout(r, 100));
    const before = lastPrDraw;
    await refresh();   // a new head commit redraws the tab from here already
    if (lastPrDraw === before) { lastPrDraw = null; await renderDetail(true); }
    busy(false);
  });
  R.appendChild(rf);
  if (d.state !== 'OPEN') return;
  const b = document.createElement('button');
  if (d.isDraft) {
    b.textContent = 'Ready for review'; b.className = 'primary';
    b.addEventListener('click', () => { b.disabled = true; prAct(p, { action: 'ready' }); });
  } else {
    b.textContent = 'Merge…'; b.className = 'merge';
    b.addEventListener('click', () => {
      const go = () => { const m = byId('mbox'); if (m) { if (!byId('mgo')) byId('mstat').open = true; m.scrollIntoView({ block: 'center' }); m.classList.add('flash'); byId('mmethod')?.focus(); } };
      if (tab === 'plan') return go();
      prTab[p.key] = 'plan'; lastPrDraw = null;
      renderDetail(false).then(go);
    });
  }
  R.appendChild(b);
}
// what GitHub said when it refused, shown in the PR tab until the next action
const prErr = {};
// a PR never goes away (closed ones stay listed), so a poll without it is a gap in the list,
// not news: the plan keeps the last PR it had instead of falling back to the plan tab
const knownPr = {};
// a thin bar under the header while the page waits for GitHub or the server
let busyN = 0;
const busy = (on) => { busyN = Math.max(0, busyN + (on ? 1 : -1)); document.body.classList.toggle('busy', busyN > 0); };
const LABEL_BUSY = { ready: 'Marking ready…', draft: 'Back to draft…', close: 'Closing…', merge: 'Merging…', task: 'Saving…' };
async function prAct(p, data) {
  busy(true);
  const label = LABEL_BUSY[data.action];
  document.querySelectorAll('#ract button:not(.rfbtn)').forEach((b) => { b.disabled = true; if (label) b.textContent = label; });
  let r;
  try {
    r = await (await fetch('/api/pr-action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: p.project, slug: p.slug, number: p.pr.number, ...data }) })).json();
  } catch (e) { r = { output: String((e && e.message) || e) }; }
  prErr[p.key] = r.ok ? null : { action: data.action, text: r.output || r.error || 'no message from gh' };
  if (!r.ok && !byId('prbody')) alert('⚠️ GitHub refused: ' + prErr[p.key].text);
  if (r.notes) prNotes[p.key] = r.notes;
  await loadPr(p);
  drawBarAction(p, prTab[p.key] || 'plan');
  if (byId('prbody')) drawPr(p);
  busy(false);
  refresh();
  // the merge worked but the main checkout did not move: say so wherever you are now
  const notPulled = (r.notes || []).find((n) => n.startsWith('Not pulled'));
  if (notPulled) {
    await alertUser('Merged, but not pulled', p.project + ' / ' + p.file, p.key, 'pr');
    setTimeout(() => alert('⚠️ PR #' + p.pr.number + ' is merged. ' + notPulled), 100);   // after the merged page has painted
  }
}
async function closePr(p) {
  const d = prData[p.key];
  if (!confirm('Close PR #' + d.number + ' without merging?\n\n' + d.title)) return;
  const deleteBranch = p.worktree
    ? (alert('The branch ' + d.headRefName + ' stays: ' + (p.kind === 'wt' ? 'the worktree ' + p.name + ' still uses it.'
      : 'the run\u2019s worktree still uses it. Clean up run removes both.')), false)
    : confirm('Also delete the branch ' + d.headRefName + ' on GitHub and on this Mac?\n\nOK = delete · Cancel = keep the branch');
  await prAct(p, { action: 'close', deleteBranch });
}
// the PR description in three parts, by the decision sheet's markers (the sheet's contract, not
// its headings): the first ## section of the sheet (your decisions), and what came before and after
// it. No sheet: all of it is "rest", and the fold opens by itself.
function splitPrBody(body) {
  const s = body.indexOf('<!-' + '- decision-sheet:start');
  if (s < 0) return { pre: body, dec: '', post: '' };
  const e = body.indexOf('<!-' + '- decision-sheet:end', s);
  const sheet = e < 0 ? body.slice(s) : body.slice(s, e), after = e < 0 ? '' : body.slice(e);
  const h = sheet.search(/^## /m);
  if (h < 0) return { pre: body, dec: '', post: '' };
  const next = sheet.slice(h + 3).search(/^## /m);
  const cut = next < 0 ? sheet.length : h + 3 + next;
  return { pre: body.slice(0, s), dec: sheet.slice(0, cut), post: sheet.slice(cut) + after };
}
// PR tab: what was unfolded, kept across repaints (plan key -> open)
const prMoreOpen = {}, prStatusOpen = new Set();
function drawPr(p) {
  const d = prData[p.key], v = byId('prview');
  if (!v) return;
  if (d.error) { v.innerHTML = '<div class="metabox">⚠️ ' + esc(d.error) + '</div>'; return; }
  const open = d.state === 'OPEN', c = d.checks;
  v.className = 'pvpr';
  v.style.padding = '';
  // what GitHub checks before a merge: one line each, folded under one status line.
  // why: the short reasons on the status line; warns: what the merge confirm repeats
  const lines = [], warns = [], why = [];
  const line = (cls, ic, html, warn, short) => {
    lines.push('<div class="mline ' + cls + '"><span class="ic">' + ic + '</span><span>' + html + '</span></div>');
    if (warn) warns.push(warn);
    if (short) why.push(short);
  };
  if (open) {
    if (d.isDraft) line('warn', '!', '<b>Draft</b> · mark it ready for review first', null, 'draft');
    if (c.failed.length) line('bad', '✕', '<b>' + c.failed.length + ' check' + (c.failed.length > 1 ? 's' : '') + ' failed:</b> ' +
      esc(c.failed.join(', ')) + (c.passed ? ' <span class="dim">· ' + c.passed + ' passed</span>' : ''), c.failed.join(', ') + ' failed',
      c.failed.length + ' check' + (c.failed.length > 1 ? 's' : '') + ' failed');
    else if (c.running) line('warn', '●', '<b>' + c.running + ' check' + (c.running > 1 ? 's' : '') + ' still running</b>' +
      (c.passed ? ' <span class="dim">· ' + c.passed + ' passed</span>' : ''), c.running + ' checks still running', 'checks running');
    else if (c.passed) line('ok', '✓', 'All ' + c.passed + ' checks passed');
    if (d.reviewDecision === 'APPROVED') line('ok', '✓', 'Approved');
    else if (d.reviewDecision === 'CHANGES_REQUESTED') line('bad', '✕', '<b>Changes requested</b>', 'changes were requested', 'changes requested');
    else if (d.reviewDecision === 'REVIEW_REQUIRED') line('warn', '!', '<b>Review required</b> <span class="dim">· nobody has approved yet</span>', 'nobody has approved', 'review required');
    if (d.mergeable === 'CONFLICTING') line('bad', '✕', '<b>Conflicts with ' + esc(d.baseRefName) + '</b> · resolve them in the worktree, then push', null, 'conflicts');
    else if (d.mergeable === 'MERGEABLE') line('ok', '✓', 'No conflicts with <code>' + esc(d.baseRefName) + '</code>');
    else line('dim', '…', 'GitHub is still checking for conflicts', null, 'checking conflicts');
  }
  // GitHub's own verdict: BLOCKED means a branch rule is not met (usually a required approval)
  const rules = open && !d.isDraft && d.mergeable !== 'CONFLICTING' && d.mergeStateStatus === 'BLOCKED';
  const admin = !!(d.merge && d.merge.admin);
  if (rules) line('bad', '✕', '<b>GitHub blocks the merge</b> · ' + (d.reviewDecision === 'REVIEW_REQUIRED'
    ? 'the branch rules need an approving review' : c.failed.length || c.running ? 'the branch rules need the checks to pass'
    : 'a branch rule is not met yet') + (admin ? '' : '. Ask someone to approve it on GitHub.'), null, 'blocked by branch rules');
  const blocked = d.isDraft || d.mergeable === 'CONFLICTING';
  const canMerge = open && !blocked && !(rules && !admin);
  const methods = (d.merge && d.merge.methods.length) ? d.merge.methods : ['merge'];
  const pick = methods.includes(mergeMethod) ? mergeMethod : methods.includes(d.merge && d.merge.default) ? d.merge.default : methods[0];
  const LABEL = { merge: 'Merge commit', squash: 'Squash and merge', rebase: 'Rebase and merge' };
  const notes = prNotes[p.key], err = prErr[p.key];
  // the status line: ready or not, and why, in a few words; the full list unfolds under it
  const head = canMerge
    ? (why.length ? ['warn', '!', '<b>Ready to merge</b> <span class="dim">· ' + esc(why.join(' · ')) + '</span>']
      : ['ok', '✓', '<b>Ready to merge</b>'])
    : ['bad', '✕', '<b>Not ready to merge:</b> ' + esc(why.join(' · '))];
  const parts = splitPrBody(d.body || '');
  const moreOpen = prMoreOpen[p.key] != null ? prMoreOpen[p.key] : !parts.dec;
  v.innerHTML =
    (err ? '<div class="merr" role="alert"><b>GitHub refused' + (err.action === 'merge' ? ' the merge' : '') + ':</b> ' +
      esc(err.text) + '</div>' : '') +
    (d.state === 'MERGED' && notes ? '<div class="mergednote"><b>Merged into ' + esc(d.baseRefName) + '.</b>' +
      notes.map((n) => '<div' + (n.startsWith('Not pulled') ? ' class="notpulled"' : '') + '>' + esc(n) + '</div>').join('') + '</div>' : '') +
    (open ? '<div class="mbox" id="mbox"><details id="mstat"' + (prStatusOpen.has(p.key) ? ' open' : '') + '>' +
      '<summary class="mline mhead ' + head[0] + '"><span class="ic">' + head[1] + '</span><span>' + head[2] + '</span>' +
        '<span style="flex:1"></span><span class="dim mtoggle">details</span></summary>' + lines.join('') + '</details>' +
      (canMerge ? '<div class="mfoot">' +
        '<select id="mmethod" aria-label="merge method">' + methods.map((m) => '<option value="' + m + '"' + (m === pick ? ' selected' : '') + '>' + LABEL[m] + '</option>').join('') + '</select>' +
        '<label><input type="checkbox" id="mdel" checked> Delete the branch on GitHub</label><span style="flex:1"></span>' +
        (rules ? '<label title="You are an admin of this repo: gh pr merge --admin"><input type="checkbox" id="madmin"> Merge as admin, past the branch rules</label>' : '') +
        '<button class="merge" id="mgo"' + (rules ? ' disabled' : '') + '>Merge into ' + esc(d.baseRefName) + '</button></div>' : '') +
      '</div>' : '') +
    (parts.dec ? '<div class="mdc prbody prdec" id="prdec"></div>' : '') +
    '<details class="prmore" id="prmore"' + (moreOpen ? ' open' : '') + '><summary>' +
      (parts.dec ? 'Full PR description' : 'PR description') +
      ' <span class="dim">· <code>' + esc(d.baseRefName) + '</code> ← <code>' + esc(d.headRefName) + '</code> · </span>' +
      '<span class="add">+' + d.additions + '</span> <span class="del">−' + d.deletions + '</span>' +
      ' <span class="dim">· ' + d.changedFiles + ' files · ' + d.commits + ' commits</span></summary>' +
      '<div class="prmeta"><b class="prtitle">' + esc(d.title) + '</b> <span class="dim">#' + d.number + '</span>' +
        '<span style="flex:1"></span><span class="btns" id="practs"></span></div>' +
      '<div class="mdc prbody" id="prbody"></div></details>';
  byId('mstat')?.addEventListener('toggle', (e) => e.target.open ? prStatusOpen.add(p.key) : prStatusOpen.delete(p.key));
  byId('prmore').addEventListener('toggle', (e) => { prMoreOpen[p.key] = e.target.open; });
  const A = byId('practs');
  if (open) {
    const btn = (label, fn, cls) => {
      const b = document.createElement('button');
      b.textContent = label; if (cls) b.className = cls;
      b.addEventListener('click', () => { A.querySelectorAll('button').forEach((x) => (x.disabled = true)); fn(); });
      A.appendChild(b);
    };
    if (!d.isDraft) btn('Back to draft', () => prAct(p, { action: 'draft' }));
    btn('Close PR', () => closePr(p).then(() => drawPr(p)), 'danger');
  }
  const go = byId('mgo'), adm = byId('madmin');
  if (adm) adm.addEventListener('change', () => { go.disabled = !adm.checked; });
  if (go) go.addEventListener('click', async () => {
    const method = byId('mmethod').value, del = byId('mdel').checked, asAdmin = !!(adm && adm.checked);
    if (!confirm('Merge PR #' + d.number + ' into ' + d.baseRefName + ' (' + LABEL[method].toLowerCase() + ')' +
      (asAdmin ? ' as admin, past the branch rules' : '') + '?' +
      (warns.length ? '\n\nWarnings: ' + warns.join('; ') + '.' : '') +
      '\n\nAfter the merge, ' + d.baseRefName + ' is pulled in ' + p.project + ' (fast-forward only, not in the worktree).')) return;
    mergeMethod = method;
    try { localStorage.setItem('dash-merge-method', method); } catch {}
    go.disabled = true; go.textContent = 'Merging…';
    await prAct(p, { action: 'merge', method, deleteBranch: del, head: d.headRefOid, admin: asAdmin });
  });
  // GitHub task lists: each box writes the description back, like ticking it on github.com.
  // The boxes are numbered in the order of the description, as the server counts them.
  let n = 0;
  const render = (src) => {
    src = src.replace(/<!-{2}[\s\S]*?-{2}>/g, '');   // drop HTML comments, e.g. the decision-sheet markers
    return src.trim() ? md(src, true).replace(/<li>\[([ xX])\] /g, (m, x) => '<li class="task"><input type="checkbox" aria-label="I agree" data-task="' + (n++) + '"' +
      (x === ' ' ? '' : ' checked') + (open ? '' : ' disabled') + '>') : '';
  };
  const pre = render(parts.pre), dec = render(parts.dec), post = render(parts.post);
  if (byId('prdec')) byId('prdec').innerHTML = dec;
  byId('prbody').innerHTML = pre + post || '<p class="dim">No description.</p>';
  v.querySelectorAll('[data-task]').forEach((el) => el.addEventListener('change', () => {
    v.querySelectorAll('[data-task]').forEach((x) => (x.disabled = true));
    prAct(p, { action: 'task', index: +el.dataset.task, count: n, was: !el.checked });
  }));
}
// unified diff (gh pr diff) -> [{ path, st: M|A|D|R, hunks: [{ head, lines: [[kind, old, new, text]] }] }]
function parseDiff(txt) {
  const files = []; let f = null, h = null, o = 0, nn = 0, body = [];
  const done = () => { if (f) { f.hash = hashStr(body.join('\n')); body = []; } };
  for (const line of txt.split('\n')) {
    if (line.startsWith('diff --git ')) {
      done();
      f = { path: line.slice(line.lastIndexOf(' b/') + 3), st: 'M', hunks: [], add: 0, del: 0, n: 0 };
      files.push(f); h = null; continue;
    }
    if (!f) continue;
    if (!h) {
      if (line.startsWith('new file mode')) f.st = 'A';
      else if (line.startsWith('deleted file mode')) f.st = 'D';
      else if (line.startsWith('rename to ')) { f.st = 'R'; f.path = line.slice(10); }
      else if (line.startsWith('Binary files')) f.binary = true;
    }
    const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (m) { h = { head: line, lines: [], o: +m[1], n: +m[2] }; f.hunks.push(h); o = +m[1]; nn = +m[2]; body.push(line); continue; }
    if (!h) continue;
    const k = line[0];
    if (k === '+') { h.lines.push(['+', null, nn++, line.slice(1)]); f.add++; }
    else if (k === '-') { h.lines.push(['-', o++, null, line.slice(1)]); f.del++; }
    else if (k === ' ') h.lines.push([' ', o++, nn++, line.slice(1)]);
    else continue;   // "\ No newline at end of file"
    f.n++; body.push(line);
  }
  done();
  return files;
}
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
const KIND = { '+': 'a', '-': 'd', ' ': '' };
// the whole file: the head version's unchanged lines around the hunks, as one hunk with no header
function fullHunks(f, text) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const out = [];
  let nn = 1, delta = 0;   // delta = old line number minus new, for unchanged lines
  const same = (upTo) => { for (; nn < upTo; nn++) out.push([' ', nn + delta, nn, lines[nn - 1]]); };
  for (const hk of f.hunks) {
    // a side with 0 lines ("-10,0" or "+12,0") names the line before the change, not the first one
    const oldN = hk.lines.filter((l) => l[1] != null).length, newN = hk.lines.filter((l) => l[2] != null).length;
    same(newN ? hk.n : hk.n + 1);
    out.push(...hk.lines);
    nn = newN ? hk.n + newN : hk.n + 1;
    delta = (oldN ? hk.o + oldN : hk.o + 1) - nn;
  }
  same(lines.length + 1);
  return [{ head: null, lines: out }];
}
function diffHtml(f) {
  const cell = (cls, num, t) => '<td class="ln ' + cls + '">' + (num == null ? '' : num) + '</td><td class="' + cls + '">' +
    esc(t == null ? '' : t) + '</td>';
  // fixed layout takes its widths from the first row, a colspan hunk header — so set them here
  let h = (diffSplit ? '<div class="dwrap">' : '') +
    '<table class="dtab' + (diffSplit ? ' split' : '') + '"><colgroup>' +
    (diffSplit ? '<col class="lnc"><col class="dlc"><col class="lnc"><col>' : '<col class="lnc"><col class="lnc"><col>') + '</colgroup>';
  for (const hk of f.hunks) {
    if (hk.head) h += '<tr class="hk"><td colspan="' + (diffSplit ? 4 : 3) + '">' + esc(hk.head) + '</td></tr>';
    if (!diffSplit) {
      for (const [k, o, nw, t] of hk.lines)
        h += '<tr><td class="ln ' + KIND[k] + '">' + (o == null ? '' : o) + '</td>' + cell(KIND[k], nw, t) + '</tr>';
      continue;
    }
    // side by side: a run of removed lines sits next to the run of added lines after it
    let dels = [], adds = [];
    const flush = () => {
      for (let j = 0; j < Math.max(dels.length, adds.length); j++) {
        const a = dels[j], b = adds[j];
        h += '<tr>' + (a ? cell('d', a[1], a[3]) : cell('e')) + (b ? cell('a', b[2], b[3]) : cell('e')) + '</tr>';
      }
      dels = []; adds = [];
    };
    for (const l of hk.lines) {
      if (l[0] === '-') { if (adds.length) flush(); dels.push(l); }
      else if (l[0] === '+') adds.push(l);
      else { flush(); h += '<tr>' + cell('', l[1], l[3]) + cell('', l[2], l[3]) + '</tr>'; }
    }
    flush();
  }
  return h + '</table>' + (diffSplit ? '<div class="dsplit" role="separator" aria-orientation="vertical" tabindex="0" ' +
    'aria-label="Divider between the two sides" title="Drag to resize the two sides. Double-click: equal halves."></div></div>' : '');
}
// Two dividers in Files changed, both dragged, both remembered in this browser: the file
// list's right edge (its width in px) and the line between the two sides of a diff (the
// share of the width the old side gets, in Monaco and in the table). A fixed-layout table ignores a calc() column
// width, so the diff's columns are sized in px here and again whenever its box resizes.
let diffRatio = 0.5, treeWidth = 0;
const clampRatio = (r) => Math.min(0.9, Math.max(0.1, r));   // the range Monaco accepts
try { diffRatio = clampRatio(+localStorage.getItem('dash-diff-ratio') || 0.5); } catch {}
try { treeWidth = +localStorage.getItem('dash-tree-w') || 0; } catch {}
const layoutSplit = (w) => {
  const ln = w.querySelector('td.ln'), col = w.querySelector('col.dlc'), bar = w.querySelector('.dsplit');
  if (!col || !bar) return;
  const g = ln ? ln.offsetWidth : 46, room = w.clientWidth - 2 * g;
  col.style.width = Math.round(room * diffRatio) + 'px';
  bar.style.left = Math.round(g + room * diffRatio) + 'px';
};
const splitObs = new ResizeObserver((es) => es.forEach((e) => layoutSplit(e.target)));
new MutationObserver(() => document.querySelectorAll('.dwrap:not([data-obs])').forEach((w) => {
  w.dataset.obs = '1'; splitObs.observe(w);
})).observe(document.body, { childList: true, subtree: true });
const setDiffRatio = (r, save) => {
  diffRatio = Math.round(clampRatio(r) * 1000) / 1000;
  document.querySelectorAll('.dwrap').forEach(layoutSplit);
  if (save) try { localStorage.setItem('dash-diff-ratio', diffRatio); } catch {}
};
const setTreeWidth = (px, save) => {
  const t = byId('ptree');
  if (!t) return;
  t.style.width = px ? Math.round(Math.max(200, Math.min(px, window.innerWidth * 0.6))) + 'px' : '';
  treeWidth = px ? t.offsetWidth : 0;
  if (save) try { treeWidth ? localStorage.setItem('dash-tree-w', treeWidth) : localStorage.removeItem('dash-tree-w'); } catch {}
};
const dividerOf = (el) => el && el.closest && el.closest('.dsplit, .tsplit');
document.addEventListener('pointerdown', (e) => {
  const bar = dividerOf(e.target);
  if (!bar) return;
  e.preventDefault();
  const diff = bar.classList.contains('dsplit');
  const move = diff ? (ev) => {
    const w = bar.parentElement, r = w.getBoundingClientRect(), ln = w.querySelector('td.ln');
    const g = ln ? ln.offsetWidth : 46;
    setDiffRatio((ev.clientX - r.left - g) / (r.width - 2 * g));
  } : (ev) => setTreeWidth(ev.clientX - byId('ptree').getBoundingClientRect().left);
  const up = () => {
    document.removeEventListener('pointermove', move);
    document.body.classList.remove('dragging'); bar.classList.remove('on');
    diff ? setDiffRatio(diffRatio, true) : setTreeWidth(treeWidth, true);
  };
  document.body.classList.add('dragging'); bar.classList.add('on');
  document.addEventListener('pointermove', move);
  document.addEventListener('pointerup', up, { once: true });
});
document.addEventListener('dblclick', (e) => {
  const bar = dividerOf(e.target);
  if (bar) bar.classList.contains('dsplit') ? setDiffRatio(0.5, true) : setTreeWidth(0, true);
});
document.addEventListener('keydown', (e) => {
  const bar = dividerOf(e.target);
  if (!bar || !/^Arrow(Left|Right)$/.test(e.key)) return;
  e.preventDefault();
  const d = e.key === 'ArrowLeft' ? -1 : 1;
  bar.classList.contains('dsplit') ? setDiffRatio(diffRatio + d * 0.05, true)
    : setTreeWidth(byId('ptree').offsetWidth + d * 40, true);
});
async function drawFiles(p, force) {
  const sig = lastPrDraw;
  let df = prDiff[p.key];
  if (force || !df || df.from !== JSON.stringify(p.pr)) {
    const r = await (await fetch('/api/pr-diff?project=' + p.project + '&number=' + p.pr.number)).json();
    df = prDiff[p.key] = r.ok ? { files: parseDiff(r.diff), from: JSON.stringify(p.pr) }
      : { error: r.output || r.error, from: JSON.stringify(p.pr) };
  }
  if (lastPrDraw !== sig) return;
  drawFilesView(p);
  // the local layer comes after: a slow git (a fetch) must not keep the PR's files off the screen
  if (await loadLocal(p) && lastPrDraw === sig && byId('prview')) drawFilesView(p);
}
// --- Not pushed yet: the worktree's own changes (the chat's agent edits, commits and merges
// there), read every few seconds while Files changed is open and at once when the chat says a
// tool ran. They sit above the PR's files until Push sends them to GitHub.
const prLocal = {};   // plan key -> { sig, d: the server's answer, pr: files vs the PR head, base: files vs the base, fresh }
let localCmp = 'pr', localShow = 'all';
try { localCmp = localStorage.getItem('dash-local-cmp') === 'base' ? 'base' : 'pr'; } catch {}
try { localShow = localStorage.getItem('dash-local-show') || 'all'; } catch {}
// the parts of the file list folded away, remembered per browser
let closedGroups = new Set();
try { closedGroups = new Set(JSON.parse(localStorage.getItem('dash-closed-groups') || '[]')); } catch {}
const FRESH_MS = 10000;   // a file the agent changed this recently has a yellow edge
async function loadLocal(p) {
  if (!p.worktree || !p.pr) return false;
  const L = prLocal[p.key];
  let r;
  try {
    r = await (await fetch('/api/local?project=' + encodeURIComponent(p.project) + '&slug=' + encodeURIComponent(p.slug) +
      '&since=' + (L ? L.sig : ''))).json();
  } catch { return false; }
  if (r.same) return false;
  const live = r.ok && !r.none;
  const pr = live ? parseDiff(r.vsPr) : [], base = live ? parseDiff(r.vsBase) : [];
  for (const f of [...pr, ...base]) {
    f.src = 'local';
    // a submodule is a folder on disk: its diff is the whole story, there is no file to read
    if (f.hunks.length && f.hunks.every((h) => h.lines.every((l) => l[3].startsWith('Subproject commit')))) { f.full = null; f.fullErr = ''; }
  }
  const fresh = L ? L.fresh : {}, before = {};
  if (L) for (const f of L.pr) before[f.path] = f.hash;
  if (L) for (const f of pr) if (before[f.path] !== f.hash) fresh[f.path] = Date.now();
  prLocal[p.key] = { sig: r.sig, d: r, pr, base, fresh };
  return true;
}
const localCmpOf = (L) => (L.d.baseError ? 'pr' : localCmp);   // no base to compare with: vs PR
const localOn = (L) => !!(L && L.d.ok && !L.d.none && (L.d.ahead || L.d.dirty || L.pr.length));
// where each file's changes are: 'local' (only here), 'both' (in the PR, changed again here), 'pr'
function viewFiles(p, df) {
  const L = prLocal[p.key];
  if (!localOn(L)) { for (const f of df.files) f.where = null; return df.files; }
  const inPr = new Set(df.files.map((f) => f.path)), inLocal = new Set(L.pr.map((f) => f.path));
  const where = (f) => { f.where = inLocal.has(f.path) ? (inPr.has(f.path) ? 'both' : 'local') : 'pr'; return f; };
  // Only PR is what GitHub has: a file changed again here still shows the PR's own diff
  if (localShow === 'pr') return df.files.map(where);
  const list = (localCmpOf(L) === 'base' ? L.base : [...L.pr, ...df.files.filter((f) => !inLocal.has(f.path))]).map(where);
  return localShow === 'local' ? list.filter((f) => f.where !== 'pr') : list;
}
const plural = (k, one, many) => k + ' ' + (k === 1 ? one : many);
function localStrip(p) {
  const L = prLocal[p.key];
  if (!L || L.d.none) return '';
  const d = L.d;
  if (!d.ok) return '<div class="lstrip"><span class="lwarn">⚠️ Could not read the worktree: ' + esc(d.output || d.error || '') + '</span></div>';
  const has = localOn(L), off = d.branch !== d.wanted;
  if (!has && !d.behind && !off) return '';
  const working = d.agentBusy || p.live;
  const parts = [d.ahead && plural(d.ahead, 'commit', 'commits'), d.dirty && plural(d.dirty, 'file', 'files') + ' not committed'].filter(Boolean);
  let h = '<div class="lstrip"><span class="ldot' + (working ? ' live' : '') + '"></span><span><b>Not pushed yet:</b> ' +
    esc(parts.join(' + ') || 'nothing') + (working ? ' <span class="dim">· the agent is working</span>' : '') + '</span>';
  if (off) h += '<span class="lwarn">⚠️ The worktree is on ' + esc(d.branch) + ', not ' + esc(d.wanted) + '.</span>';
  if (d.behind) h += '<span class="lwarn">⚠️ The PR has ' + plural(d.behind, 'commit', 'commits') + ' that the worktree does not have. GitHub will refuse a push.</span>';
  h += '<span style="flex:1"></span>';
  if (!has) return h + '</div>';
  // an option with a reason it cannot be picked is shown, greyed out, with that reason
  const seg = (attr, cur, opts) => '<span class="lseg">' + opts.map(([v, l, t, off]) => '<button data-' + attr + '="' + v + '" class="' +
    (v === cur ? 'on' : '') + '" title="' + escA(off || t) + '"' + (off ? ' disabled' : '') + '>' + l + '</button>').join('') + '</span>';
  h += '<span class="dim">Show:</span>' + seg('lshow', localShow, [['all', 'All', 'Every changed file'],
    ['local', 'Only local', 'Only files changed in the worktree'], ['pr', 'Only PR', 'Only files the PR on GitHub changes']]) +
    seg('lcmp', localCmpOf(L), [['pr', 'vs PR (only new)', 'A local file shows only what changed after the last push'],
      ['base', 'vs ' + esc(prData[p.key] && prData[p.key].baseRefName || 'base') + ' (whole)', 'Every file shows the whole change, as reviewers will see it after the push', d.baseError]]);
  const why = working ? 'Wait until the agent stops.' : off ? 'The worktree is on another branch.'
    : d.behind ? 'The PR has commits the worktree does not have. Ask the agent to pull them first.'
    : !d.ahead ? 'Nothing is committed yet. Ask the agent to commit first.' : '';
  h += '<button id="ldiscard"' + (working ? ' disabled title="Wait until the agent stops."'
    : ' title="Put the worktree back to the PR\u2019s head commit. Unpushed commits, edits and new files are deleted."') + '>↶ Discard local changes</button>';
  h += '<button id="lpush" class="lpush"' + (why ? ' disabled title="' + escA(why) + '"'
    : ' title="' + escA('git push to ' + d.wanted + (d.dirty ? '. Edits that are not committed stay in the worktree.' : '')) + '"') +
    '>⬆ ' + (d.ahead ? 'Push ' + plural(d.ahead, 'commit', 'commits') + ' to PR #' + d.number
      : d.dirty ? 'Commit first, then push' : 'Nothing to push') + '</button>';
  return h + '</div>';
}
function bindStrip(p, v) {
  v.querySelectorAll('[data-lshow]').forEach((el) => el.addEventListener('click', () => {
    localShow = el.dataset.lshow;
    try { localStorage.setItem('dash-local-show', localShow); } catch {}
    drawFilesView(p);
  }));
  v.querySelectorAll('[data-lcmp]').forEach((el) => el.addEventListener('click', () => {
    localCmp = el.dataset.lcmp;
    try { localStorage.setItem('dash-local-cmp', localCmp); } catch {}
    drawFilesView(p);
  }));
  const push = byId('lpush'), discard = byId('ldiscard');
  if (push) push.addEventListener('click', () => localAct(p, 'push', push, 'Pushing…'));
  if (discard) discard.addEventListener('click', () => {
    const d = prLocal[p.key].d;
    if (!confirm('Discard everything that is not pushed in ' + d.wanted + '?\n\n' +
      [d.ahead && plural(d.ahead, 'commit', 'commits'), d.dirty && plural(d.dirty, 'file', 'files') + ' with edits or new'].filter(Boolean).join(', ') +
      ' will be deleted. The worktree goes back to PR #' + d.number + ' as it is on GitHub. This cannot be undone.')) return;
    localAct(p, 'discard', discard, 'Discarding…');
  });
}
async function localAct(p, what, btn, label) {
  const d = prLocal[p.key].d;
  busy(true);
  document.querySelectorAll('.lstrip button').forEach((b) => { b.disabled = true; });
  btn.textContent = label;
  let r;
  try {
    r = await (await fetch('/api/local-' + what, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project: p.project, slug: p.slug, head: d.head, prHead: d.prHead, sig: prLocal[p.key].sig }) })).json();
  } catch (e) { r = { output: String((e && e.message) || e) }; }
  if (!r.ok) alert('⚠️ ' + (r.output || r.error || 'failed'));
  prLocal[p.key].sig = '';
  if (what === 'push' && r.ok) {
    // the PR has a new head now: read the state, then the PR and its diff, as ⟳ does
    while (ticking) await new Promise((res) => setTimeout(res, 100));
    const before = lastPrDraw;
    await refresh();
    if (lastPrDraw === before) { lastPrDraw = null; await renderDetail(true); }
  } else {
    await loadLocal(p);
    drawFilesView(p);
  }
  busy(false);
}
let localTicking = false, localTimer = null;
async function localTick() {
  const p = selected && find(selected), v = byId('prview');
  if (localTicking || monoDragging || document.hidden || !p || !p.worktree || !p.pr || prTab[p.key] !== 'files'
    || !v || !v.classList.contains('pvfiles') || selectionLive()) return;
  localTicking = true;
  try {
    const df = prDiff[p.key];
    if (await loadLocal(p) && selected === p.key && prTab[p.key] === 'files' && df && !df.error) drawFilesView(p);
  } finally { localTicking = false; }
}
const localSoon = () => { clearTimeout(localTimer); localTimer = setTimeout(localTick, 400); };
setInterval(localTick, 3000);
// "view in diff" on a chat tool line: that file in Files changed
function chatJump(p, file) {
  if (!p || !p.pr) return;
  prFile[p.key] = file;
  if (localShow !== 'all') localShow = 'all';
  if (selected === p.key && prTab[p.key] === 'files' && byId('prview')) return drawFilesView(p);
  selected = p.key; prTab[p.key] = 'files'; lastPrDraw = null;
  renderList(); renderDetail(false);
}
// --- Mermaid: a block fenced as mermaid is drawn above its code, which folds under "Mermaid
// code". The library loads from a CDN the first time a page has one, like Monaco. The chat
// and the plan view redraw their HTML often, so drawings are kept by theme and source.
const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs';
let mermaidLoad = null, mermaidN = 0;
const mermaidSvg = new Map(); // theme + source -> svg, or '' when it does not parse
const loadMermaid = () => mermaidLoad || (mermaidLoad = import(MERMAID).then((m) => m.default,
  (e) => { mermaidLoad = null; throw e; }));
async function drawMermaid() {
  const todo = [...document.querySelectorAll('.mmd:not([data-drawn])')];
  if (!todo.length) return;
  todo.forEach((el) => { el.dataset.drawn = '1'; });
  let mermaid;
  try { mermaid = await loadMermaid(); } catch { todo.forEach((el) => { delete el.dataset.drawn; }); return; }
  const theme = document.documentElement.dataset.theme === 'light' ? 'default' : 'dark';
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme });
  for (const el of todo) {
    const src = el.querySelector('code')?.textContent || '';
    const key = theme + '\n' + src;
    if (!mermaidSvg.has(key)) {
      let svg = '';
      // a diagram still arriving in the chat does not parse yet: its code shows until it does
      try {
        if (await mermaid.parse(src, { suppressErrors: true })) svg = (await mermaid.render('mmd' + ++mermaidN, src)).svg;
      } catch { document.getElementById('dmmd' + mermaidN)?.remove(); }
      mermaidSvg.set(key, svg);
    }
    const svg = mermaidSvg.get(key);
    if (!svg || !el.isConnected) continue;
    const code = document.createElement('details');
    code.innerHTML = '<summary>Mermaid code</summary>';
    code.append(...el.childNodes);
    el.innerHTML = '<div class="mmdsvg" role="button" tabindex="0" title="Open full screen: drag to move, scroll or pinch to zoom">' + svg + '</div>';
    el.append(code);
  }
}
// full screen: a copy of the drawing in its own layer, so a chat redraw under it does not close
// it. Drag moves it; scroll pans; pinch or Ctrl/⌘ + scroll zooms at the pointer; + − 0 and the
// arrow keys do the same from the keyboard.
function openMermaidFull(svgHtml) {
  const box = document.createElement('div');
  box.className = 'mmdfull';
  box.innerHTML = '<div class="mmdstage"><div class="mmdpan">' + svgHtml + '</div></div>' +
    '<div class="mmdbar"><button data-z="out" title="Zoom out (−)">−</button><span class="mmdpct"></span>' +
    '<button data-z="in" title="Zoom in (+)">+</button><button data-z="fit" title="Fit to the screen (0)">Fit</button>' +
    '<button data-z="close" title="Close (Esc)">✕</button></div>';
  const stage = box.querySelector('.mmdstage'), pan = box.querySelector('.mmdpan'), svg = pan.querySelector('svg');
  // the drawing at its own size; the view scales it
  const vb = svg.viewBox && svg.viewBox.baseVal;
  const w = vb && vb.width || svg.getBoundingClientRect().width || 800, h = vb && vb.height || svg.getBoundingClientRect().height || 600;
  svg.removeAttribute('style'); svg.setAttribute('width', w); svg.setAttribute('height', h);
  let s = 1, tx = 0, ty = 0;
  const draw = () => {
    pan.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + s + ')';
    box.querySelector('.mmdpct').textContent = Math.round(s * 100) + '%';
  };
  const fit = () => {
    const r = stage.getBoundingClientRect();
    s = Math.min(r.width / w, r.height / h) * 0.95;
    tx = (r.width - w * s) / 2; ty = (r.height - h * s) / 2;
    draw();
  };
  // zoom by f, keeping the point (px, py) of the stage where it is
  const zoom = (f, px, py) => {
    const r = stage.getBoundingClientRect();
    if (px == null) { px = r.width / 2; py = r.height / 2; }
    const n = Math.min(20, Math.max(0.05, s * f));
    tx = px - (px - tx) * n / s; ty = py - (py - ty) * n / s; s = n;
    draw();
  };
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    // a pinch sends small steps, a mouse wheel ~100 per notch: at most ×1.65 per step
    if (e.ctrlKey || e.metaKey) zoom(Math.exp(-Math.max(-50, Math.min(50, e.deltaY)) * 0.01), e.clientX - r.left, e.clientY - r.top);
    else { tx -= e.deltaX; ty -= e.deltaY; draw(); }
  }, { passive: false });
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    drag = { x: e.clientX - tx, y: e.clientY - ty };
    stage.setPointerCapture(e.pointerId); stage.classList.add('drag');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    tx = e.clientX - drag.x; ty = e.clientY - drag.y; draw();
  });
  const endDrag = () => { drag = null; stage.classList.remove('drag'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('dblclick', (e) => {
    const r = stage.getBoundingClientRect();
    zoom(e.shiftKey ? 0.5 : 2, e.clientX - r.left, e.clientY - r.top);
  });
  const close = () => {
    document.removeEventListener('keydown', onKey, true);
    if (document.fullscreenElement === box) document.exitFullscreen().catch(() => {});
    box.remove();
  };
  const onKey = (e) => {
    const k = e.key, step = 60;
    if (k === 'Escape') close();
    else if (k === '+' || k === '=') zoom(1.25);
    else if (k === '-' || k === '_') zoom(0.8);
    else if (k === '0') fit();
    else if (k === 'ArrowLeft') { tx += step; draw(); } else if (k === 'ArrowRight') { tx -= step; draw(); }
    else if (k === 'ArrowUp') { ty += step; draw(); } else if (k === 'ArrowDown') { ty -= step; draw(); }
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  box.querySelector('.mmdbar').addEventListener('click', (e) => {
    const z = e.target.closest('button')?.dataset.z;
    if (z === 'in') zoom(1.25); else if (z === 'out') zoom(0.8); else if (z === 'fit') fit(); else if (z === 'close') close();
  });
  // Esc in browser full screen only leaves full screen: close the layer with it
  box.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) close(); else fit(); });
  document.addEventListener('keydown', onKey, true);
  document.body.append(box);
  fit();
  // the fixed layer already fills the window; browser full screen is a bonus where allowed
  box.requestFullscreen?.().catch(() => {});
}
// a click (or Enter) on a drawing opens it full screen
const mermaidOpen = (e) => {
  const d = e.target.closest('.mmdsvg');
  if (!d || (e.type === 'keydown' && e.key !== 'Enter')) return;
  const svg = d.querySelector('svg');
  if (!svg || (e.type === 'click' && String(getSelection()))) return;
  e.preventDefault(); e.stopPropagation();
  openMermaidFull(svg.outerHTML);
};
document.addEventListener('click', mermaidOpen);
document.addEventListener('keydown', mermaidOpen);
let mermaidTimer = null;
new MutationObserver(() => {
  if (mermaidTimer || !document.querySelector('.mmd:not([data-drawn])')) return;
  mermaidTimer = setTimeout(() => { mermaidTimer = null; drawMermaid(); }, 200);
}).observe(document.body, { childList: true, subtree: true });
// a theme switch draws them again in the new colours
function redrawMermaid() {
  document.querySelectorAll('.mmd[data-drawn]').forEach((el) => {
    const code = el.querySelector('details');
    if (!code) return;
    el.replaceChildren(...[...code.childNodes].filter((n) => n.nodeName !== 'SUMMARY'));
    delete el.dataset.drawn;
  });
}
// --- VS Code's diff view: Monaco, the editor inside VS Code, loaded from a CDN the first time
// Files changed opens. It gets the whole file at both sides, rebuilt from the head version and
// the diff (fullHunks), so no second gh call. Offline it fails once and the table above stays.
const MONACO = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.2/min';
let monaco = null, monacoLoad = null, monacoFailed = false, monoEd = null, monoDragging = false;
function loadMonaco() {
  if (monacoLoad) return monacoLoad;
  // the workers come from the CDN too; a data: URL lets them start from this page's origin
  window.MonacoEnvironment = { getWorkerUrl: () => 'data:text/javascript;charset=utf-8,' + encodeURIComponent(
    'self.MonacoEnvironment={baseUrl:"' + MONACO + '/"};importScripts("' + MONACO + '/vs/base/worker/workerMain.js");') };
  monacoLoad = new Promise((resolve, reject) => {
    setTimeout(() => reject(new Error('timeout')), 20000);
    const sc = document.createElement('script');
    sc.src = MONACO + '/vs/loader.js';
    sc.onerror = reject;
    sc.onload = () => {
      window.require.config({ paths: { vs: MONACO + '/vs' } });
      window.require(['vs/editor/editor.main'], () => resolve(window.monaco), reject);
    };
    document.head.appendChild(sc);
  }).then((m) => {
    monaco = m;
    // a lone file has no project around it: type errors would be false alarms
    for (const d of [m.languages.typescript.typescriptDefaults, m.languages.typescript.javascriptDefaults])
      d.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true });
    monoTheme();
    return m;
  }, (e) => { monacoFailed = true; throw e; });
  return monacoLoad;
}
// VS Code's Dark+ / Light+ colours on the dashboard's own background
function monoTheme() {
  const css = getComputedStyle(document.documentElement), light = document.documentElement.dataset.theme === 'light';
  const bg = css.getPropertyValue('--codebg').trim();
  monaco.editor.defineTheme('dash', { base: light ? 'vs' : 'vs-dark', inherit: true, rules: [],
    colors: bg ? { 'editor.background': bg, 'editorGutter.background': bg } : {} });
  monaco.editor.setTheme('dash');
}
const monoLang = (file) => {
  const name = file.slice(file.lastIndexOf('/') + 1).toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : '';
  const l = monaco.languages.getLanguages().find((x) =>
    (x.filenames || []).some((f) => f.toLowerCase() === name) || (ext && (x.extensions || []).includes(ext)));
  return l ? l.id : 'plaintext';
};
function mountMonaco(cur, keepTop) {
  const rows = (cur.full || cur.hunks).flatMap((h) => h.lines);
  const text = (skip) => rows.filter((l) => l[0] !== skip).map((l) => l[3]).join('\n');
  const lang = monoLang(cur.path);
  const models = [monaco.editor.createModel(text('+'), lang), monaco.editor.createModel(text('-'), lang)];
  const fs = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fs')) || 1;
  const ed = monaco.editor.createDiffEditor(byId('mono'), {
    readOnly: true, originalEditable: false, automaticLayout: true, renderSideBySide: diffSplit, splitViewDefaultRatio: diffRatio,
    useInlineViewWhenSpaceIsLimited: false, hideUnchangedRegions: { enabled: !diffFull },
    wordWrap: 'on', diffWordWrap: 'on', scrollBeyondLastLine: false, fontSize: Math.round(12 * fs),
    minimap: { enabled: true }, renderOverviewRuler: true, ignoreTrimWhitespace: false,
  });
  ed.setModel({ original: models[0], modified: models[1] });
  monoEd = { dispose: () => ed.dispose(), models, getModifiedEditor: () => ed.getModifiedEditor() };
  // a repaint builds a new editor: the line dragged between the two sides is kept in diffRatio,
  // which the next editor opens with. Monaco's double-click goes back to the ratio it opened with,
  // so double-click is told to mean equal halves, as on the table's divider.
  const onSash = (e) => e.target.closest && e.target.closest('.monaco-sash.vertical');
  byId('mono').addEventListener('pointerdown', (e) => {
    if (!onSash(e)) return;
    monoDragging = true;
    window.addEventListener('pointerup', () => requestAnimationFrame(() => {
      monoDragging = false;
      const box = ed.getModifiedEditor().getContainerDomNode().getBoundingClientRect();
      const left = box.left - byId('mono')?.getBoundingClientRect().left;
      if (box.width && left > 0) setDiffRatio(left / (left + box.width), true);
    }), { capture: true, once: true });
  }, true);
  byId('mono').addEventListener('dblclick', (e) => {
    if (!onSash(e)) return;
    setDiffRatio(0.5, true);
    ed.updateOptions({ splitViewDefaultRatio: 0.5 });
  }, true);
  // lines selected on either side go with the next chat message, as in the VS Code extension
  for (const [e, side] of [[ed.getModifiedEditor(), 'new'], [ed.getOriginalEditor(), 'old']])
    e.onDidChangeCursorSelection((ev) => chatPickFromEditor(e, side, cur.path, ev.selection));
  // first diff: a new file opens at its first change, a repaint where it was
  const once = ed.onDidUpdateDiff(() => {
    once.dispose();
    const m = ed.getModifiedEditor();
    if (keepTop != null) return m.setScrollTop(keepTop);
    const c = (ed.getLineChanges() || [])[0];
    if (c) m.revealLineNearTop(Math.max(1, c.modifiedStartLineNumber || c.modifiedEndLineNumber || 1));
  });
}
// Overview ruler at the right of a diff, like VS Code's scrollbar: a mark for every run of
// removed (left half) and added (right half) lines at its place in the file, and a box for
// the part on screen. Click or drag on it to scroll there.
const diffShown = {};   // plan key -> the file and layout last opened, so a repaint keeps the scroll
const diffHeld = {};    // plan key -> { view, top }: the place kept while the whole file is read again
const rulerObs = new ResizeObserver((es) => es.forEach((e) => e.target._ruler && e.target._ruler()));
function bindRuler(body, ruler) {
  const tab = body.querySelector('.dtab');
  const view = document.createElement('div');
  view.className = 'dview';
  const paint = () => {
    if (!ruler.isConnected) return;
    const H = ruler.clientHeight, total = body.scrollHeight;
    const t0 = body.getBoundingClientRect().top - body.scrollTop;   // where the content's top is now
    const marks = [];
    let last = {};
    for (const td of tab.querySelectorAll('td.ln.a, td.ln.d')) {
      const side = td.classList.contains('a') ? 'a' : 'd';
      const r = td.getBoundingClientRect();
      const top = (r.top - t0) / total * H, h = Math.max(2, r.height / total * H);
      const m = last[side];
      if (m && top <= m.top + m.h + 1) m.h = Math.max(m.h, top + h - m.top);
      else marks.push(last[side] = { side, top, h });
    }
    ruler.innerHTML = marks.map((m) => '<i class="' + m.side + '" style="top:' + m.top.toFixed(1) + 'px;height:' +
      m.h.toFixed(1) + 'px"></i>').join('');
    ruler.appendChild(view);
    place();
  };
  const place = () => {
    const H = ruler.clientHeight, total = body.scrollHeight;
    view.style.top = (body.scrollTop / total * H) + 'px';
    view.style.height = Math.max(8, body.clientHeight / total * H) + 'px';
  };
  const go = (e) => {
    const r = ruler.getBoundingClientRect();
    body.scrollTop = (e.clientY - r.top) / r.height * body.scrollHeight - body.clientHeight / 2;
  };
  body.addEventListener('scroll', place, { passive: true });
  ruler.addEventListener('pointerdown', (e) => {
    e.preventDefault(); go(e);
    ruler.setPointerCapture(e.pointerId);
    const mv = (ev) => go(ev);
    ruler.addEventListener('pointermove', mv);
    ruler.addEventListener('pointerup', () => ruler.removeEventListener('pointermove', mv), { once: true });
  });
  tab._ruler = paint; body._ruler = paint;
  rulerObs.observe(tab); rulerObs.observe(body);
  paint();
}
function drawFilesView(p) {
  const v = byId('prview'), df = prDiff[p.key];
  if (!v || !df) return;
  v.className = 'pvfiles';
  v.style.padding = '';
  if (df.error) {
    v.innerHTML = '<div class="metabox">⚠️ ' + esc(df.error) + '</div>';
    return;
  }
  const L = prLocal[p.key], files = viewFiles(p, df), strip = localStrip(p);
  const cur = files.find((f) => f.path === prFile[p.key]) || files[0];
  if (!cur) {
    v.innerHTML = strip + '<div class="dim" style="padding:14px">No changed files' + (localShow !== 'all' ? ' in this filter' : '') + '.</div>';
    bindStrip(p, v);
    return;
  }
  prFile[p.key] = cur.path;
  syncUrl();
  const treeTop = byId('ptree') ? byId('ptree').scrollTop : 0;
  const treeW = byId('ptree') ? byId('ptree').style.width : '';   // a width dragged by hand
  // folder tree like VS Code's: folders first, a folder with one subfolder and no files
  // shares its row ("domains/ai"), and a folder's box ticks every file under it
  const closed = prClosedDirs[p.key] = prClosedDirs[p.key] || new Set();
  // the search box: every word typed must be somewhere in the file's path
  const fileQ = () => (prFileQ[p.key] || '').trim().toLowerCase();
  const fileShown = (f) => fileQ().split(' ').filter(Boolean).every((w) => f.path.toLowerCase().includes(w));
  const rootOf = (list) => {
    const root = { dirs: {}, files: [] };
    for (const f of list) {
      const parts = f.path.split('/');
      let node = root;
      for (const d of parts.slice(0, -1)) node = node.dirs[d] = node.dirs[d] || { dirs: {}, files: [] };
      node.files.push(f);
    }
    return root;
  };
  // with local changes the list has two parts: not pushed yet, then the rest of the PR
  const groups = localShow === 'all' && files.some((f) => f.where) ? [
    ['Not pushed yet', files.filter((f) => f.where !== 'pr'), 'local'], ['In PR #' + p.pr.number, files.filter((f) => f.where === 'pr'), 'pr'],
  ].filter((g) => g[1].length) : [[null, files]];
  const fresh = (f) => f.where && f.where !== 'pr' && Date.now() - (L.fresh[f.path] || 0) < FRESH_MS;
  const LTAG = { local: '<span class="ltag local" title="Changed only in the worktree, not pushed">local</span>',
    both: '<span class="ltag both" title="In the PR, then changed again in the worktree">PR+local</span>' };
  const under = (node) => [...node.files, ...Object.values(node.dirs).flatMap(under)];
  let tree;
  const walk = (node, prefix, depth) => {
    for (let name of Object.keys(node.dirs).sort()) {
      let d = node.dirs[name];
      while (!d.files.length && Object.keys(d.dirs).length === 1) {
        const only = Object.keys(d.dirs)[0];
        name += '/' + only; d = d.dirs[only];
      }
      const full = prefix + name, all = under(d), nSeen = all.filter((f) => isViewed(p, f)).length;
      tree += '<div class="pf" tabindex="0" style="--d:' + depth + '" data-dir="' + escA(full) + '">' +
        '<span class="chev">' + (!fileQ() && closed.has(full) ? '▸' : '▾') + '</span>' +
        '<input type="checkbox" tabindex="-1" aria-label="mark the folder as viewed" data-seendir="' + escA(full) + '"' + (nSeen === all.length ? ' checked' : '') +
        (nSeen && nSeen < all.length ? ' data-some="1"' : '') + ' title="mark everything in this folder as viewed">' +
        '<span class="nm">' + esc(name) + '</span></div>';
      if (fileQ() || !closed.has(full)) walk(d, full + '/', depth + 1);
    }
    for (const f of node.files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
      const seen = isViewed(p, f);
      tree += '<div class="pf ' + f.st + (f === cur ? ' on' : '') + (isRecheck(p, f) ? ' rk' : '') + (fresh(f) ? ' fresh' : '') + '" tabindex="0" style="--d:' + depth + '" data-file="' +
        escA(f.path) + '" title="' + escA(f.path) + '"><span class="chev"></span>' +
        '<input type="checkbox" tabindex="-1" aria-label="viewed" data-seen="' + escA(f.path) + '"' + (seen ? ' checked' : '') + ' title="viewed">' +
        '<span class="nm">' + esc(f.path.slice(f.path.lastIndexOf('/') + 1)) + '</span>' +
        '<button class="flag" tabindex="-1" data-flag="' + escA(f.path) + '" aria-pressed="' + isRecheck(p, f) + '" ' +
          'title="Recheck this file later (F)" aria-label="recheck later">⚑</button>' + (LTAG[f.where] || '') +
        '<span class="fst ' + f.st + '">' + f.st + '</span></div>';
    }
  };
  const treeHtml = () => {
    tree = '';
    for (const [label, list, grp] of groups) {
      const hits = list.filter(fileShown), shut = !fileQ() && closedGroups.has(grp);
      if (!hits.length) continue;
      if (label) tree += '<div class="pf pgrp" tabindex="0" role="button" aria-expanded="' + !shut + '" data-grp="' + grp + '" title="' + (shut ? 'Show' : 'Hide') + ' these files">' +
        '<span class="chev">' + (shut ? '▸' : '▾') + '</span><span class="nm">' + esc(label) + ' · ' + hits.length + '</span></div>';
      if (!label || !shut) walk(rootOf(hits), '', 0);
    }
    return tree || '<div class="dim" style="padding:8px 12px">No file matches this search.</div>';
  };
  treeHtml();
  const countText = () => fileQ() ? files.filter(fileShown).length + ' of ' + files.length : '';
  const nSeen = files.filter((f) => isViewed(p, f)).length;
  // VS Code's diff view (Monaco) when it loads; our own table is the fallback (offline, binary)
  const mono = !monacoFailed && !cur.binary && cur.hunks.length > 0 && !(cur.full === null && cur.fullErr);
  if (mono && !monaco) loadMonaco().then(() => {}, () => {}).then(() => { if (prFile[p.key] === cur.path && byId('ptree')) drawFilesView(p); });
  const big = !mono && cur.n > 3000 && !cur.show;
  // whole file: added and deleted files are whole in the diff already; others need the head version
  const wantFull = (mono || diffFull) && cur.hunks.length && !big && (cur.st === 'M' || cur.st === 'R');
  if (wantFull && cur.full === undefined && !cur.loading) {
    cur.loading = true;
    fetch(cur.src === 'local'
      ? '/api/local-file?project=' + encodeURIComponent(p.project) + '&slug=' + encodeURIComponent(p.slug) + '&path=' + encodeURIComponent(cur.path)
      : '/api/pr-file?project=' + p.project + '&sha=' + p.pr.head + '&path=' + encodeURIComponent(cur.path))
      .then((r) => r.json()).catch((e) => ({ output: String(e) })).then((r) => {
        cur.loading = false;
        cur.full = r.ok ? fullHunks(cur, r.text) : null;
        cur.fullErr = r.ok ? '' : r.output || r.error;
        if (prFile[p.key] === cur.path && byId('ptree')) drawFilesView(p);
      });
  }
  if (byId('rseen')) byId('rseen').textContent = marksText(p, files);
  // a repaint of the same view keeps the diff where it was; a new file opens at its first change
  const view = cur.path + '|' + diffSplit + '|' + (wantFull && !!cur.full) + '|' + diffFull;
  const oldBody = v.querySelector('.pdbody');
  const topNow = monoEd ? monoEd.getModifiedEditor().getScrollTop() : oldBody ? oldBody.scrollTop : null;
  // the PR moved, so the whole file is read again: the Loading paint must not lose the place
  const loadingFull = wantFull && cur.full === undefined, fullView = cur.path + '|' + diffSplit + '|true|' + diffFull;
  const held = diffHeld[p.key];
  if (!loadingFull) delete diffHeld[p.key];
  else if (diffShown[p.key] === fullView && !(held && held.view === fullView)) diffHeld[p.key] = { view: fullView, top: topNow };
  const keepTop = held && held.view === view ? held.top : diffShown[p.key] !== view ? null : topNow;
  const showMono = mono && monaco && !(wantFull && cur.full === undefined);
  const rowKey = (r) => r.dataset.file || r.dataset.dir || r.dataset.grp;
  const focusKey = document.activeElement && document.activeElement.closest && document.activeElement.closest('.pf')
    ? rowKey(document.activeElement.closest('.pf')) : null;
  const caret = document.activeElement && document.activeElement.id === 'pfq' ? document.activeElement.selectionStart : null;
  v.innerHTML = strip + '<div class="prfiles"><div class="ptree" id="ptree">' +
    '<div class="pfsearch"><input id="pfq" autocomplete="off" spellcheck="false" placeholder="search files…" aria-label="Search the changed files" ' +
      'title="Type parts of a file name or folder. Esc clears." value="' + escA(prFileQ[p.key] || '') + '">' +
      '<span id="pfcount" role="status">' + countText() + '</span></div>' +
    '<div id="ptrows">' + tree + '</div></div>' +
    '<div class="tsplit" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Divider between the file list and the diff" ' +
    'title="Drag to resize the file list. Double-click: default width."></div>' +
    '<div class="pdiff"><div class="pdhead"><span class="pdpath" title="' + escA(cur.path) + '">' + esc(cur.path) + '</span>' +
      '<span class="add">+' + cur.add + '</span><span class="del">−' + cur.del + '</span>' +
      '<button data-full title="Click to show ' + (diffFull ? 'only the changes' : 'the whole file') + '">' +
        (diffFull ? 'Whole file' : 'Changes only') + '</button>' +
      '<button data-split title="Click to show ' + (diffSplit ? 'one column' : 'side by side') + '">' +
        (diffSplit ? 'Side by side' : 'One column') + '</button>' +
      '<button class="flagbtn" data-flag="' + escA(cur.path) + '" aria-pressed="' + isRecheck(p, cur) + '" title="Come back to this file later (F)">⚑ Recheck</button>' +
      '<label><input type="checkbox" data-seen="' + escA(cur.path) + '"' + (isViewed(p, cur) ? ' checked' : '') + '> Viewed</label></div>' +
    '<div class="pdmain"><div class="pdbody' + (showMono ? ' monoon' : '') + '" tabindex="0" aria-label="diff">' +
      (showMono ? '<div class="mono" id="mono"></div>'
      : cur.binary ? '<div class="dim">Binary file — no diff to show.</div>'
      : !cur.hunks.length ? '<div class="dim">' + (cur.st === 'R' ? 'Renamed, no content changes.' : 'No content changes.') + '</div>'
      : mono && !monaco ? '<div class="dim">Loading VS Code’s diff view…</div>'
      : big ? '<div class="dim">Large diff (' + cur.n + ' lines). <button id="showbig">Show it</button></div>'
      : wantFull && cur.full === undefined ? '<div class="dim">Loading the whole file…</div>'
      : (wantFull && cur.fullErr ? '<div class="dim">⚠️ Could not load the whole file (' + esc(cur.fullErr) +
          '). Showing the changes only.</div>' : '') +
        diffHtml(wantFull && cur.full ? { hunks: cur.full } : cur)) + '</div>' +
      (showMono ? '' : '<div class="druler" aria-hidden="true" title="Where the changes are. Click or drag to move there."></div>') + '</div></div></div>';
  if (monoEd) { monoEd.dispose(); monoEd.models.forEach((m) => m.dispose()); monoEd = null; }
  if (showMono) { mountMonaco(cur, keepTop); diffShown[p.key] = view; }
  byId('ptree').style.width = treeW || (treeWidth ? treeWidth + 'px' : '');
  const body = v.querySelector('.pdbody'), tab = body.querySelector('.dtab');
  // size the two sides now: done later by the observer, the rewrap moves the lines after the jump
  body.querySelectorAll('.dwrap').forEach((w) => { w.dataset.obs = '1'; splitObs.observe(w); layoutSplit(w); });
  if (tab) {
    if (keepTop != null) body.scrollTop = keepTop;
    else {
      diffShown[p.key] = view;
      const first = tab.querySelector('td.a, td.d');
      if (first) body.scrollTop += first.getBoundingClientRect().top - body.getBoundingClientRect().top - body.clientHeight / 4;
    }
    bindRuler(body, v.querySelector('.druler'));
  }
  byId('ptree').scrollTop = treeTop;
  // keyboard: ↑/↓ move, Enter opens a file or folds a folder, Space marks it viewed
  const back = focusKey && [...v.querySelectorAll('.pf')].find((r) => rowKey(r) === focusKey);
  if (back) back.focus({ preventScroll: true });
  const search = byId('pfq');
  // a repaint (a new local change, a file opened) must not take the box away from the typing
  if (caret != null) { search.focus({ preventScroll: true }); search.setSelectionRange(caret, caret); }
  // searching repaints only the tree: the open diff stays as it is
  const searchFiles = (text) => {
    prFileQ[p.key] = text;
    const rowsBox = byId('ptrows');
    rowsBox.innerHTML = treeHtml();
    bindRows(rowsBox);
    byId('pfcount').textContent = countText();
    byId('ptree').scrollTop = 0;
  };
  search.addEventListener('input', () => searchFiles(search.value));
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && search.value) {   // only a second Esc leaves Files changed
      e.stopPropagation();
      search.value = '';
      searchFiles('');
    } else if (e.key === 'Enter') {
      const first = byId('ptrows').querySelector('[data-file]');
      if (first) first.click();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();   // the tree's own handler would move one row further
      const first = byId('ptrows').querySelector('.pf');
      if (first) first.focus();
    }
  });
  byId('ptree').addEventListener('keydown', (e) => {
    const rows = [...byId('ptree').querySelectorAll('.pf')];
    const i = rows.indexOf(document.activeElement);
    if (i < 0) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const r = rows[i + (e.key === 'ArrowDown' ? 1 : -1)];
      if (r) r.focus();
      else if (e.key === 'ArrowUp') byId('pfq').focus();
    } else if (e.key === 'Enter') { e.preventDefault(); rows[i].click(); }
    else if (e.key === ' ') {
      e.preventDefault();
      const cb = rows[i].querySelector('input');
      if (!cb) { rows[i].click(); return; }
      cb.checked = !cb.checked; cb.dispatchEvent(new Event('change'));
    } else if ((e.key === 'f' || e.key === 'F') && rows[i].dataset.file) {
      e.preventDefault(); rows[i].querySelector('.flag').click();
    }
  });
  const markSeen = (list, on) => {
    const m = prViewed[p.pr.url] = prViewed[p.pr.url] || {}, r = prRecheck[p.pr.url] = prRecheck[p.pr.url] || {};
    for (const f of list) { if (on) { m[f.path] = f.hash; delete r[f.path]; } else delete m[f.path]; }
    saveViewed(); saveRecheck(); paintMarks();
  };
  const markRecheck = (f, on) => {
    const m = prViewed[p.pr.url] = prViewed[p.pr.url] || {}, r = prRecheck[p.pr.url] = prRecheck[p.pr.url] || {};
    if (on) { r[f.path] = true; delete m[f.path]; } else delete r[f.path];
    saveViewed(); saveRecheck(); paintMarks();
  };
  // only the marks and the count change: rebuilding the tree and the diff made the screen flicker
  const paintMarks = () => {
    v.querySelectorAll('[data-flag]').forEach((b) => {
      const f = files.find((x) => x.path === b.dataset.flag), on = !!f && isRecheck(p, f);
      b.setAttribute('aria-pressed', String(on));
      if (b.classList.contains('flag')) b.closest('.pf').classList.toggle('rk', on);
    });
    v.querySelectorAll('[data-seen]').forEach((cb) => {
      const f = files.find((x) => x.path === cb.dataset.seen);
      if (f) cb.checked = isViewed(p, f);
    });
    v.querySelectorAll('[data-seendir]').forEach((cb) => {
      const all = files.filter((x) => x.path.startsWith(cb.dataset.seendir + '/') && fileShown(x)), n = all.filter((x) => isViewed(p, x)).length;
      cb.checked = n === all.length; cb.indeterminate = n > 0 && n < all.length;
    });
    if (byId('rseen')) byId('rseen').textContent = marksText(p, files);
  };
  // scope is the whole view on a full paint, only the tree when a folder folds
  const bindRows = (scope) => {
    scope.querySelectorAll('[data-file]').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.matches('input')) return;
      prFile[p.key] = el.dataset.file; drawFilesView(p);
    }));
    scope.querySelectorAll('[data-flag]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      const f = files.find((x) => x.path === el.dataset.flag);
      if (f) markRecheck(f, !isRecheck(p, f));
    }));
    scope.querySelectorAll('[data-seen]').forEach((el) => el.addEventListener('change', () =>
      markSeen(files.filter((x) => x.path === el.dataset.seen), el.checked)));
    scope.querySelectorAll('[data-seendir]').forEach((el) => {
      el.indeterminate = !!el.dataset.some;
      el.addEventListener('change', () =>
        markSeen(files.filter((x) => x.path.startsWith(el.dataset.seendir + '/') && fileShown(x)), el.checked));
    });
    // folding a folder or a group repaints only the tree: the open diff stays as it is
    const repaintTree = (attr, key) => {
      const pt = byId('ptree'), top = pt.scrollTop;
      const rowsBox = byId('ptrows');
      rowsBox.innerHTML = treeHtml();
      bindRows(rowsBox);
      pt.scrollTop = top;
      const row = [...pt.querySelectorAll('[data-' + attr + ']')].find((r) => r.dataset[attr] === key);
      if (row) row.focus({ preventScroll: true });
    };
    scope.querySelectorAll('[data-dir]').forEach((el) => el.addEventListener('click', (e) => {
      if (e.target.matches('input') || fileQ()) return;   // a search keeps every folder open
      const d = el.dataset.dir;
      closed.has(d) ? closed.delete(d) : closed.add(d);
      repaintTree('dir', d);
    }));
    scope.querySelectorAll('[data-grp]').forEach((el) => el.addEventListener('click', () => {
      if (fileQ()) return;
      const g = el.dataset.grp;
      closedGroups.has(g) ? closedGroups.delete(g) : closedGroups.add(g);
      try { localStorage.setItem('dash-closed-groups', JSON.stringify([...closedGroups])); } catch {}
      repaintTree('grp', g);
    }));
  };
  bindRows(v);
  bindStrip(p, v);
  if (v.querySelector('.pf.fresh')) setTimeout(() => v.querySelectorAll('.pf.fresh').forEach((r) => r.classList.remove('fresh')), FRESH_MS);
  v.querySelectorAll('[data-split]').forEach((el) => el.addEventListener('click', () => {
    diffSplit = !diffSplit;
    try { localStorage.setItem('dash-diff-split', diffSplit ? '1' : '0'); } catch {}
    drawFilesView(p);
  }));
  v.querySelectorAll('[data-full]').forEach((el) => el.addEventListener('click', () => {
    diffFull = !diffFull;
    try { localStorage.setItem('dash-diff-full', diffFull ? '1' : '0'); } catch {}
    drawFilesView(p);
  }));
  if (byId('showbig')) byId('showbig').addEventListener('click', () => { cur.show = true; drawFilesView(p); });
}

async function saveMetaFor(p, status, tags) {
  p.status = status; p.tags = [...new Set(tags)];
  await post('/api/meta', { project: p.project, slug: p.slug, status: p.status, tags: p.tags });
  renderList(); renderDetail(false);
}
function renderBar() {
  byId('selcount').textContent = picked.size + ' queued';
  byId('selmodes').textContent = [...picked].map((k) => {
    const p = find(k);
    return (p ? p.slug.slice(0, 18) : k.slice(0, 18)) + '…(' + (p ? modeLabel(p) : '?') + ')';
  }).join('  ');
}
async function post(url, data, thenRefresh) {
  const r = await (await fetch(url, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })).json();
  if (r.output) alert((r.ok ? '✅ ' : '⚠️ ') + r.output);
  if (thenRefresh) setTimeout(refresh, 1200);
  return r;
}
byId('launchbtn').addEventListener('click', async () => {
  if (!picked.size) return alert('Tick at least one plan in the left list.');
  const byProj = {};
  for (const k of picked) { const p = find(k); if (p) (byProj[p.project] = byProj[p.project] || []).push(p); }
  for (const [proj, items] of Object.entries(byProj)) {
    if (items[0].hasPipeline)
      await post('/api/launch', { project: proj,
        items: items.map((p) => ({ slug: p.slug, mode: modeOf(p) })) });
    else
      for (const p of items) {
        if (!(p.launchers || []).length) { alert('No launcher configured for ' + proj + ' — set one up first.'); continue; }
        await post('/api/launch-generic', { project: proj, slug: p.slug, launcher: +modeOf(p) });
      }
  }
  picked.clear(); renderBar();
  afterLaunch();
});
// show the launch at once, then check every second while anything is still starting
let fastUntil = 0;
function afterLaunch() { fastUntil = Date.now() + 15000; refresh(); }
function showLaunchError(p) {
  if (!p || !p.launch) return;
  logKey = null;
  setBack(null);
  byId('logtitle').textContent = '⚠ didn’t start — ' + p.slug;
  byId('logpane').classList.add('open');
  byId('logbody').textContent = p.launch.output +
    '\n\n(the launcher’s full output is in ' + p.project + '/.plans/auto-runs/_dashboard.log)';
}
async function cleanupRun(p) {
  if (!confirm('Clean up "' + p.slug + '"?\n\nRemoves its worktree and auto/ branch.\n(Automatically refused if the worktree has uncommitted changes or the branch is unmerged — nothing can be lost.)')) return;
  const artifacts = confirm('Also delete its breadcrumbs — report, log and settings in auto-runs/?\n\nOK = delete too · Cancel = keep for history');
  await post('/api/cleanup', { project: p.project, slug: p.slug, artifacts }, true);
}
async function clearRun(p) {
  if (!confirm('Clear the run record and log for "' + p.slug + '"?\n\nThe repo itself is untouched — this only deletes the dashboard\u2019s tracking of this run.')) return;
  await post('/api/clear-run', { project: p.project, slug: p.slug }, true);
}
async function archive(p) {
  if (!confirm('Archive "' + p.slug + '" to done/ ?\n\nThe plan file moves out of the active list. You commit the move yourself if the folder is tracked.')) return;
  await post('/api/archive', { project: p.project, slug: p.slug }, true);
  if (selected === p.key) selected = null;
}
// drawer back-navigation: set when a drawer view was opened from another one
let drawerBack = null;
const setBack = (fn) => {
  drawerBack = fn || null;
  byId('backBtn').style.display = drawerBack ? '' : 'none';
};
byId('backBtn').addEventListener('click', () => { const f = drawerBack; if (f) f(); });
function openLog(key, kind) {
  setBack(null);
  logKey = key; logKind = kind; lg = null; byId('logbody')._raw = null; byId('logpane').classList.add('open'); loadLog();
}
function closeLog() { setBack(null); logKey = null; lg = null; byId('logpane').classList.remove('open'); }
async function loadLog() {
  const p = find(logKey);
  if (!p) return;
  byId('logtitle').textContent = logKind + ': [' + p.project + '] ' + p.slug;
  if (logKind === 'log') return loadLogItems(p);
  const t = await (await fetch('/api/' + logKind + '?project=' + p.project + '&slug=' + p.slug)).text();
  const el = byId('logbody');
  if (el._raw === t || selectionIn(el)) return;
  const stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  el._raw = t;
  // a run report is a Markdown file: show it formatted, like the plan
  if (logKind === 'report' && !/^(no report yet)$/.test(t.trim())) {
    const top = el.scrollTop;
    el.innerHTML = '<div class="mdc logmd">' + md(t) + '</div>';
    el.scrollTop = top;   // reports are read from the top; a 5 s reload keeps the place
  } else {
    el.textContent = t;
    if (stick) el.scrollTop = el.scrollHeight;
  }
}
// --- the log: a run's steps as chat rows; finished tool calls in a row fold into one line ---
let lg = null;   // { key, p, items, first, total, open, loading, wantOld, painted }
const logFolds = (it) => it.k === 'think' || (it.k === 'tool' && it.done && !it.err) || (it.k === 'note' && it.sub);
const logItemHtml = (it, c) => it.k === 'raw' ? '<pre class="lograw">' + esc(it.text) + '</pre>' : chatItemHtml(it, c);
function logListHtml(c) {
  let h = '', run = [];
  const flush = () => {
    const tools = run.filter((it) => it.k === 'tool');
    if (tools.length < 2) h += run.map((it) => logItemHtml(it, c)).join('');
    else {
      const names = {};
      tools.forEach((it) => { names[it.name] = (names[it.name] || 0) + 1; });
      const g = 'g' + run[0].i;
      h += '<details class="ctool cgroup" data-g="' + g + '"' + (c.open.has(g) ? ' open' : '') + '><summary><b>' + tools.length + ' tool calls</b> <span>' +
        esc(Object.entries(names).map(([n, k]) => n + (k > 1 ? ' ×' + k : '')).join(', ')) + '</span></summary>' +
        run.map((it) => logItemHtml(it, c)).join('') + '</details>';
    }
    run = [];
  };
  for (let i = c.first; i < c.total; i++) {
    const it = c.items[i];
    if (!it) continue;
    if (logFolds(it)) run.push(it);
    else { flush(); h += logItemHtml(it, c); }
  }
  flush();
  return h;
}
function paintLog(c, older) {
  const el = byId('logbody');
  const stick = !c.painted || el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
  const top = el.scrollTop, height = el.scrollHeight;
  el.innerHTML = c.total ? '<div class="logitems">' +
    (c.first > 0 ? '<button class="logmore" data-older="1">Load earlier (' + c.first + ' earlier steps)</button>' : '') +
    logListHtml(c) + '</div>' : 'No output yet.';
  el.scrollTop = older ? top + el.scrollHeight - height : stick ? el.scrollHeight : top;
  c.painted = true;
}
async function loadLogItems(p, older) {
  const el = byId('logbody');
  if (!lg) lg = { key: logKey, p: {}, items: {}, first: 0, total: null, open: new Set() };
  const c = lg;
  if (c.loading) { if (older) c.wantOld = true; return; }
  if (!older && selectionIn(el)) return;
  let q = '';
  if (older) q = '&before=' + c.first;
  else if (c.total) {
    // from the first tool call still waiting for its result, else the last row: plain output grows
    let from = c.total - 1;
    for (let i = Math.max(c.first, c.total - 300); i < c.total; i++)
      if (c.items[i] && c.items[i].k === 'tool' && !c.items[i].done) { from = i; break; }
    q = '&from=' + from;
  }
  c.loading = true;
  const r = await fetch('/api/log?project=' + encodeURIComponent(p.project) + '&slug=' + encodeURIComponent(p.slug) + q)
    .then((x) => x.json()).catch(() => null);
  c.loading = false;
  if (lg !== c || !r || !r.items) return;
  if (c.total != null && r.total < c.total) { lg = null; return loadLogItems(p); }   // the file was replaced
  const changed = !c.painted || older || r.total !== c.total || r.items.some((it) => JSON.stringify(c.items[it.i]) !== JSON.stringify(it));
  if (older || c.total == null) c.first = r.first;
  r.items.forEach((it) => { c.items[it.i] = it; });
  c.total = r.total;
  if (changed) paintLog(c, older);
  if (c.wantOld) { c.wantOld = false; if (c.first > 0) loadLogItems(p, true); }
}
byId('logbody').addEventListener('click', async (e) => {
  if (!lg || !e.target.closest) return;
  if (e.target.closest('[data-older]')) { const p = find(logKey); if (p) loadLogItems(p, true); return; }
  const b = e.target.closest('.ccopy');
  if (!b || b.dataset.copymsg == null) return;
  const ok = await copyText(lg.items[+b.dataset.copymsg].text);
  b.textContent = ok ? 'Copied' : 'Copy failed';
  setTimeout(() => { b.textContent = 'Copy'; }, 1400);
});
// rows and groups keep their open state when the list repaints
byId('logbody').addEventListener('toggle', (e) => {
  const d = e.target.dataset;
  const k = d && (d.g || (d.i != null ? +d.i : null));
  if (!lg || k == null) return;
  e.target.open ? lg.open.add(k) : lg.open.delete(k);
}, true);
// --- launcher setup dialog (generic projects): pick a skill/script or write a command ---
// back: where ‹ Back and a save return to (the settings panel, the setup guide), or null
async function openLauncherSetup(projName, back) {
  logKey = null;
  setBack(back || null);
  byId('logtitle').textContent = '⚙ launchers — ' + projName;
  byId('logpane').classList.add('open');
  byId('logbody').innerHTML = '<div class="setup">scanning ' + esc(projName) + ' .claude folder…</div>';
  const d = await (await fetch('/api/discover?project=' + projName)).json();
  const proj = state.find((s) => s.name === projName) || { launchers: [] };
  const HEADLESS = ' --permission-mode acceptEdits --verbose --output-format stream-json';
  const tplSkill = (s) => 'claude -p "/' + s + ' {plan}"' + HEADLESS;
  const tplScript = (s) => s === 'run-skill.sh' ? 'bash .claude/scripts/run-skill.sh implement {plan}'
    : (s.endsWith('.sh') ? 'bash' : 'node') + ' .claude/scripts/' + s + ' {plan}';
  const tplGeneric = 'claude -p "Read the plan at {plan} and implement it in this repository. '
    + 'Follow the repo conventions and existing patterns. Run the relevant tests. '
    + 'Do not push, do not create PRs." ' + HEADLESS.trim();
  let h = '<div class="setup">';
  h += '<p class="hint"><b>What is a launcher?</b> The exact shell command the ▶ Launch button runs ' +
    'for a plan of this project — nothing runs until you launch a plan. Picking an option below only ' +
    '<b>pre-fills the command box</b> at the bottom; review or edit it there, give it a label, then save. ' +
    'You can save several (e.g. “Implement only”, “Implement + test”) and choose one per plan at launch time.</p>';
  if (d.hasPipeline)
    h += '<p style="border:1px solid var(--warn);border-radius:9px;padding:8px 12px;color:var(--warn)">' +
      '⚡ <b>This project has auto-pipeline.sh</b> — its plans launch through the pipeline ' +
      '(in the modes the script offers), and launchers here are <b>ignored</b>. ' +
      'You only need launchers for projects without the pipeline.</p>';
  h += '<p style="margin-top:10px"><b>Existing launchers</b> — what ▶ Launch currently offers (✕ deletes immediately):</p>';
  h += (proj.launchers || []).length
    ? (proj.launchers || []).map((l, i) =>
        '<div class="lrow"><span class="chip x" data-dl="' + i + '">✕</span><b>' +
        esc(l.label || 'launcher ' + (i + 1)) + '</b> — ' + esc(l.cmd) + '</div>').join('')
    : '<p class="dim">none yet — plans of this project cannot be launched until one is saved</p>';
  h += '<p style="margin-top:14px"><b>Add a launcher</b> — pick a starting point, then edit the command:</p>';
  const opt = (val, lab, desc) => '<div class="opt"><input type="radio" name="tpl" value="' +
    esc(val).replace(/"/g, '&quot;') + '" id="o' + (oid++) + '"><label for="o' + (oid - 1) + '">' + lab +
    (desc ? '<br><span class="dim" style="font-size:11px">' + desc + '</span>' : '') + '</label></div>';
  let oid = 0;
  if ((d.skills || []).length) {
    h += '<p class="dim">Skills in this repo — each runs headless as <code>claude -p "/skill {plan}"</code>:</p>';
    for (const s of d.skills) h += opt(tplSkill(s.name), '<code>/' + esc(s.name) + '</code>', esc(s.desc));
  }
  if ((d.scripts || []).length) {
    h += '<p class="dim">Scripts in this repo — run directly with the plan path as argument:</p>';
    for (const s of d.scripts) h += opt(tplScript(s.name), '<code>' + esc(s.name) + '</code>', esc(s.desc));
  }
  h += '<p class="dim">Or, for a repo with no skills at all:</p>';
  h += opt(tplGeneric, 'Generic headless Claude',
    'Plain claude session: reads the plan, implements it following repo conventions, runs tests, never pushes.');
  h += '<p style="margin-top:10px" class="dim">Command ({plan} = absolute plan path, {root} = repo root, {slug} = plan name):</p>';
  h += '<textarea id="lcmd"></textarea>';
  h += '<p style="margin-top:8px"><input type="text" id="llabel" placeholder="label, e.g. Implement headless" size="30"> ';
  h += '<button class="primary" id="lsave">💾 Save launcher</button></p>';
  h += '</div>';
  byId('logbody').innerHTML = h;
  byId('logbody').querySelectorAll('input[name=tpl]').forEach((el) =>
    el.addEventListener('change', () => { byId('lcmd').value = el.value; }));
  byId('logbody').querySelectorAll('[data-dl]').forEach((el) =>
    el.addEventListener('click', async () => {
      const ls = (proj.launchers || []).filter((_, i) => i !== +el.dataset.dl);
      await post('/api/launchers', { project: projName, launchers: ls });
      await refresh(); openLauncherSetup(projName, back);
    }));
  byId('lsave').addEventListener('click', async () => {
    const cmd = byId('lcmd').value.trim();
    if (!cmd) return alert('Pick a template or write a command first.');
    const ls = [...(proj.launchers || []),
      { label: byId('llabel').value.trim() || 'launcher', cmd }];
    await post('/api/launchers', { project: projName, launchers: ls });
    await refresh();
    if (back) back();
    else { closeLog(); renderDetail(false); }
  });
}
// --- settings panel: edit the project registry from the app ---
const escA = (x) => esc(x).replace(/"/g, '&quot;');
async function openSettings() {
  logKey = null;
  setBack(null);
  byId('logtitle').textContent = '⚙ settings — projects';
  byId('logpane').classList.add('open');
  byId('logbody').innerHTML = '<div class="setup">loading registry…</div>';
  const reg = await (await fetch('/api/registry')).json();
  // _orig remembers the saved name so "Edit launchers" works even mid-rename
  const rows = reg.map((e) => ({ ...e, _orig: e.name }));
  const savedRows = JSON.stringify(rows);
  const render = () => {
    let h = '<div class="setup">';
    h += '<p class="hint">Stored in <code>~/.claude/pipeline-projects.json</code> · paths may start with ~ · ' +
      'changes appear in the list within seconds.</p>';
    h += '<p class="hint"><b>How launching works:</b> if a repo contains ' +
      '<code>.claude/scripts/auto-pipeline.sh</code>, the dashboard detects it automatically and launches ' +
      'that project\u2019s plans through it (⚡ the script\u2019s own modes, worktrees, reports) — nothing to ' +
      'configure. Repos without it launch plans via the launcher commands you set up per project ' +
      '(⚙ Edit launchers below).</p>';
    rows.forEach((e, i) => {
      const ln = (e.launchers || []).length;
      h += '<div class="pcard">';
      h += '<div class="pcard-head">' +
        '<input type="text" data-f="name" data-i="' + i + '" value="' + escA(e.name || '') +
          '" placeholder="Project name" size="20" aria-label="project name">' +
        '<input type="text" data-f="client" data-i="' + i + '" value="' + escA(e.client || '') +
          '" placeholder="Client" size="12" aria-label="client">' +
        '<button class="rmbtn" data-rm="' + i + '">Remove</button></div>';
      h += '<div class="pcard-body">' +
        '<span class="flabel">Repo root</span>' +
        '<input type="text" class="mono" data-f="root" data-i="' + i + '" value="' + escA(e.root || '') +
          '" placeholder="~/Workspace/client/repo">' +
        '<span class="flabel">Plans folder</span>' +
        '<input type="text" class="mono" data-f="plansDir" data-i="' + i + '" value="' + escA(e.plansDir || '') +
          '" placeholder="default: &lt;repo root&gt;/.plans">' +
        '<span class="flabel">Done folder</span>' +
        '<input type="text" class="mono" data-f="doneDir" data-i="' + i + '" value="' + escA(e.doneDir || '') +
          '" placeholder="default: &lt;plans folder&gt;/done">' +
        // color + tag on the plan cards; empty means automatic (see projLook)
        '<span class="flabel">Look</span><span class="plook">' +
          '<input type="color" data-col="' + i + '" value="' + escA(e.color || projAutoHex(e._orig || '')) +
            '" aria-label="project color" title="project color on cards and the plan header">' +
          '<input type="text" data-f="short" data-i="' + i + '" value="' + escA(e.short || '') + '" maxlength="12"' +
            ' placeholder="' + escA(e._orig ? projLook(e._orig).short : 'tag') + '" aria-label="short tag">' +
          (e.color ? '<button class="pbtn" data-colauto="' + i + '" title="go back to the automatic color">↺ auto</button>'
            : '<span class="dim">auto</span>') + '</span>' +
        '</div>';
      h += '<div class="pcard-foot">' +
        (e._hasPipeline
          ? '⚡ launches via its own auto-pipeline.sh, in the modes it offers — launchers not needed'
          : ln + ' launcher' + (ln === 1 ? '' : 's') +
            (e._orig ? ' · <button class="pbtn" data-lset="' + escA(e._orig) + '">⚙ Edit launchers</button>'
                     : ' · save the project first, then configure launchers')) + '</div>';
      h += '</div>';
    });
    h += '<div class="setupbar"><button id="addProj" title="find repos on this machine and add them, with readiness checks">' +
      '＋ Add project</button><button class="pbtn" id="addManual" title="a blank project card: type name, client and paths yourself">' +
      'or type the paths</button>' +
      '<span style="flex:1"></span><button class="primary" id="saveReg">Save changes</button></div></div>';
    byId('logbody').innerHTML = h;
    byId('logbody').querySelectorAll('input[data-f]').forEach((el) =>
      el.addEventListener('input', () => { rows[+el.dataset.i][el.dataset.f] = el.value; }));
    byId('logbody').querySelectorAll('input[data-col]').forEach((el) =>
      el.addEventListener('change', () => { rows[+el.dataset.col].color = el.value; render(); }));
    byId('logbody').querySelectorAll('[data-colauto]').forEach((el) =>
      el.addEventListener('click', () => { delete rows[+el.dataset.colauto].color; render(); }));
    byId('logbody').querySelectorAll('[data-rm]').forEach((el) =>
      el.addEventListener('click', () => {
        const nm = rows[+el.dataset.rm].name || 'this project';
        if (!confirm('Remove "' + nm + '" from the dashboard?\n\nThe repo and its plans are untouched — only the registry entry goes away.')) return;
        rows.splice(+el.dataset.rm, 1); render();
      }));
    // the same window as the top-bar "＋ Add project"; unsaved edits here would be lost, so ask first
    byId('addProj').addEventListener('click', () => {
      if (JSON.stringify(rows) !== savedRows && !confirm('Leave settings without saving your changes?')) return;
      closeLog(); openGuide(1);
    });
    byId('addManual').addEventListener('click', () => {
      rows.push({ name: '', client: '', root: '', plansDir: '', launchers: [] }); render();
    });
    byId('logbody').querySelectorAll('[data-lset]').forEach((el) =>
      el.addEventListener('click', () => openLauncherSetup(el.dataset.lset, openSettings)));
    byId('saveReg').addEventListener('click', async () => {
      const r = await post('/api/registry', { projects: rows });
      if (r.ok) { closeLog(); refresh(); }
    });
  };
  render();
}
byId('settingsbtn').addEventListener('click', openSettings);
byId('dashCodeBtn').addEventListener('click', () => post('/api/vscode-dash', {}));
// suggest-batch: deterministic lane analysis (plan-lanes.mjs), rendered in the drawer as grouped lists.
// The last run per scope ('*' = all projects, else a project name) stays in localStorage together with
// the plans you ticked (none by default), so reopening shows it at once. Re-run fetches a fresh analysis and clears the ticks.
let lanesRuns = {};
try { lanesRuns = JSON.parse(localStorage.getItem('dash-lanes') || '{}'); } catch {}
const saveLanes = () => { try { localStorage.setItem('dash-lanes', JSON.stringify(lanesRuns)); } catch {} };
const lanesTitle = (scope) => '⚡ suggested launch batch — ' + (scope === '*' ? 'all projects' : scope);
// inline() turns #123 into a link to the repo of the plan opened last, and a link inside the
// clickable subtitle would also unfold it: the subtitle shows the text only
function noLinks(html) {
  const d = document.createElement('div');
  d.innerHTML = html;
  d.querySelectorAll('a').forEach((a) => a.replaceWith(a.textContent));
  return d.innerHTML;
}
// one plan of a recommended batch; plans started or archived since the run can no longer be ticked
function laneRowHtml(projName, b, run) {
  const k = projName + '/' + b.slug, pl = find(k), v = b.validation || {};
  const gone = !pl ? 'no longer listed' : pl.live || pl.worktree ? 'already started' : '';
  const areas = b.areas || [];
  // the skill takes the plan file as its argument, so bake it into the copied command
  const vcmd = '/skill-auto-validate-plan ' + (b.file || '.plans/' + b.slug + '.md');
  return '<div class="lrow' + (gone ? ' gone' : '') + '">' +
    '<input type="checkbox" aria-label="queue this plan" data-bpick="' + escA(k) + '" data-bproj="' + escA(projName) + '"' +
    (!gone && (run.on || []).includes(k) ? ' checked' : '') + (gone ? ' disabled' : '') + '>' +
    '<div class="t">' + (gone ? '<span class="lname">' : '<span class="plink lname" data-open="' + escA(k) + '">') + esc(b.slug) + '</span>' +
    // the title as a one-line subtitle; a click unfolds the full title and the summary
    (pl && (pl.title || pl.summary) ? '<div class="lsubt" role="button" tabindex="0" aria-expanded="false" data-lexp>' +
      (pl.title ? noLinks(inline(pl.title)) : 'details') + '</div>' : '') +
    (pl && pl.summary ? '<div class="ldesc">' + esc(pl.summary) + '</div>' : '') +
    '<div class="lmeta">' +
    (gone ? '<span class="chip live">' + gone + '</span>'
      : (v.claude || v.codex)
        ? '<span class="chip ok">✓ validated ' + (v.claude || 0) + '× claude · ' + (v.codex || 0) + '× codex</span>'
        : '<span class="chip warn copycmd" data-copy="' + escA(vcmd) + '" title="click to copy: ' + escA(vcmd) + '">not validated · copy command</span>') +
    '<span class="lareas" title="' + escA(areas.join(', ')) + '">' +
    esc(areas.slice(0, 3).join(' · ') || 'no areas') + (areas.length > 3 ? ' +' + (areas.length - 3) + ' more' : '') + '</span>' +
    '</div></div></div>';
}
// one project as a grouped card: header with a select-all tick, the batch rows, then folded extras
function laneCardHtml(p, run) {
  const look = escA(projLook(p.name).style);
  if (p.error) return '<div class="lcard pcx" style="' + look + '"><div class="lhead"><b>' + esc(p.name) + '</b></div>' +
    '<div class="lnote">⚠️ ' + esc(p.error) + '</div></div>';
  const batch = p.recommendedBatch || [];
  const multi = (p.lanes || []).filter((l) => (l.members || []).length > 1);
  const fl = p.inFlight || [];
  const link = (s) => '<span class="plink" data-open="' + escA(p.name + '/' + s) + '">' + esc(s) + '</span>';
  let h = '<div class="lcard pcx" style="' + look + '"><div class="lhead">' +
    (batch.length ? '<input type="checkbox" aria-label="select all plans of ' + escA(p.name) + '" data-ball="' + escA(p.name) + '">' : '') +
    '<div class="lhtx"><b>' + esc(p.name) + '</b><span class="lstat">' + p.schedulableCount + ' ready · ' + p.laneCount +
    ' lanes · up to ' + p.maxParallel + ' in parallel</span></div></div>';
  h += batch.length ? batch.map((b) => laneRowHtml(p.name, b, run)).join('') : '<div class="lnote">Nothing to start right now.</div>';
  if (multi.length)
    h += '<details class="lmore" open><summary>One at a time — same files (' + multi.length + ')</summary><ul>' +
      multi.map((l) => '<li><span class="dim">' + esc(l.label || 'lane ' + l.lane) + ':</span> ' +
        (l.members || []).map((m) => link(m.slug || m)).join(' → ') + '</li>').join('') + '</ul></details>';
  if (fl.length)
    h += '<details class="lmore"><summary>In flight / awaiting review (' + fl.length + ')</summary><ul>' +
      fl.map((f) => '<li>' + link(f.slug) + ' <span class="dim">— ' +
        esc((f.autoRunStatus || '').split(/[.—]/)[0].trim()) + '</span></li>').join('') + '</ul></details>';
  return h + '</div>';
}
function renderLanes(scope) {
  const run = lanesRuns[scope];
  const idle = [];
  let cards = '';
  for (const p of run.projects) {
    const empty = !p.error && !(p.recommendedBatch || []).length && !(p.inFlight || []).length &&
      !(p.lanes || []).some((l) => (l.members || []).length > 1);
    if (empty && scope === '*') idle.push(p.name);
    else cards += laneCardHtml(p, run);
  }
  byId('logbody').innerHTML = '<div class="lanes">' +
    '<div class="lbar"><div class="lsum"><b id="lcount"></b><span class="lsub">analyzed ' + ago(run.at) + '</span></div>' +
    '<button id="lrerun" title="Analyze the backlog again. Your ticks are cleared.">↻ Re-run</button>' +
    '<button class="primary" id="queueAll"></button></div>' +
    cards + (idle.length ? '<p class="lidle">Nothing to start in ' + idle.map(esc).join(', ') + '.</p>' : '') + '</div>';
  wireLanes(scope);
}
// queues the ticked plans (keys "<project>/<slug>") and closes the drawer
function queueBatches(keys) {
  for (const k of keys) {
    const pl = find(k);
    if (pl && !pl.live && !pl.worktree) picked.add(pl.key);
  }
  renderBar(); renderList(); closeLog();
}
// clicks inside the drawer: open a plan, copy a command, tick plans, queue the ticked ones, re-run
function wireLanes(scope) {
  const run = lanesRuns[scope], body = byId('logbody');
  const boxes = [...body.querySelectorAll('[data-bpick]')].filter((el) => !el.disabled);
  const relabel = () => {
    const n = boxes.filter((el) => el.checked).length, all = byId('queueAll');
    byId('lcount').textContent = boxes.length ? n + ' of ' + boxes.length + ' plans selected' : 'No plans can start now';
    all.textContent = n && n === boxes.length && n > 1 ? '✓ Queue all ' + n : '✓ Queue ' + n;
    all.disabled = !n;
    body.querySelectorAll('[data-ball]').forEach((el) => {
      const mine = boxes.filter((b) => b.dataset.bproj === el.dataset.ball), on = mine.filter((b) => b.checked).length;
      el.disabled = !mine.length;
      el.checked = !!mine.length && on === mine.length;
      el.indeterminate = on > 0 && on < mine.length;
    });
  };
  const remember = () => {
    const on = new Set(run.on || []);
    for (const el of boxes) el.checked ? on.add(el.dataset.bpick) : on.delete(el.dataset.bpick);
    run.on = [...on]; saveLanes(); relabel();
  };
  boxes.forEach((el) => el.addEventListener('change', remember));
  body.querySelectorAll('[data-ball]').forEach((el) => el.addEventListener('change', () => {
    for (const b of boxes) if (b.dataset.bproj === el.dataset.ball) b.checked = el.checked;
    remember();
  }));
  body.querySelectorAll('[data-lexp]').forEach((el) => {
    const flip = () => el.setAttribute('aria-expanded', el.closest('.lrow').classList.toggle('open'));
    el.addEventListener('click', flip);
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); flip(); } });
  });
  body.querySelectorAll('[data-open]').forEach((el) =>
    el.addEventListener('click', () => {
      const k = el.dataset.open;
      if (!find(k)) return; // e.g. archived plans no longer listed
      selected = k; renderList(); renderDetail(true); // drawer stays open for browsing
    }));
  body.querySelectorAll('[data-copy]').forEach((el) =>
    el.addEventListener('click', async () => {
      if (el.dataset.busy) return;
      const was = el.textContent, cmd = el.dataset.copy;
      el.dataset.busy = '1';
      const ok = await copyText(cmd);
      if (ok) el.textContent = '✓ copied';
      else {
        el.textContent = cmd;               // show the real command so ⌘C grabs it
        const r = document.createRange(); r.selectNodeContents(el);
        const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      }
      setTimeout(() => { el.textContent = was; delete el.dataset.busy; }, 1600);
    }));
  byId('queueAll').addEventListener('click', () => queueBatches(boxes.filter((el) => el.checked).map((el) => el.dataset.bpick)));
  byId('lrerun').addEventListener('click', () => openLanes(scope, true));
  relabel();
}
// opens the drawer for one project or for all ('*'). Shows the remembered run unless fresh is set.
// For all projects the server refuses until each project has a lane checker; then a dialog gives the prompt that adds them.
// Plans in different repos never share files, so the batches of all projects just add up.
async function openLanes(scope, fresh) {
  logKey = null;
  setBack(null);
  const title = lanesTitle(scope);
  byId('logtitle').textContent = title;
  byId('logpane').classList.add('open');
  if (lanesRuns[scope] && !fresh) return renderLanes(scope);
  byId('logbody').textContent = 'analyzing plan backlog…';
  const btn = byId('suggestAll');
  if (scope === '*') { btn.disabled = true; btn.textContent = '⚡ …'; }
  let d;
  try { d = await (await fetch(scope === '*' ? '/api/lanes-all' : '/api/lanes?project=' + encodeURIComponent(scope))).json(); }
  catch (e) { d = { error: String(e) }; }
  finally { if (scope === '*') { btn.disabled = false; btn.textContent = '⚡ All'; } }
  // the drawer may show something else by now: then keep a good result, show nothing
  const here = byId('logtitle').textContent === title && byId('logpane').classList.contains('open');
  if (d.missing) {
    if (!here) return;
    closeLog();
    byId('seldlgt').textContent = '⚠️ Can’t suggest a batch for all projects';
    const note = byId('seldlgnote');
    note.textContent = d.missing.map((m) => m.name).join(', ') + (d.missing.length === 1 ? ' has' : ' have') +
      ' no lane checker (.claude/scripts/plan-lanes.mjs), so the dashboard can’t tell which plans can run in parallel. ' +
      'Copy this prompt into Claude Code to add ' + (d.missing.length === 1 ? 'it' : 'them') + ', then click ⚡ All again.';
    note.hidden = false;
    byId('seldlgbody').textContent = d.prompt;
    return byId('seldlg').showModal();
  }
  if (d.error) { if (here) byId('logbody').textContent = '⚠️ ' + d.error; return; }
  lanesRuns[scope] = { at: Date.now(), projects: scope === '*' ? d.projects : [{ ...d, name: scope }], on: [] };
  saveLanes();
  if (here) renderLanes(scope);
}
const openSuggest = (projName) => projName && openLanes(projName);
const openSuggestAll = () => { if (!byId('suggestAll').disabled) openLanes('*'); };
document.addEventListener('keydown', (e) => {
  if (tourStep >= 0) {
    if (e.key === 'Escape') endTour();
    else if (e.key === 'ArrowRight') tourGo(1);
    else if (e.key === 'ArrowLeft') tourGo(-1);
    return;
  }
  if (byId('demohost') && byId('onb').classList.contains('open') && /^Arrow(Left|Right)$/.test(e.key)) {
    demoScene = Math.min(2, Math.max(0, demoScene + (e.key === 'ArrowRight' ? 1 : -1)));
    return paintDemo();
  }
  if (e.key !== 'Escape') return;
  if (e.target.closest && e.target.closest('.monaco-editor') && document.querySelector('.monaco-editor .find-widget.visible')) return;
  if (byId('onb').classList.contains('open')) return closeGuide();
  if (e.target.closest && e.target.closest('#chat')) return;   // Esc in the chat closes only its menu
  // Files changed fills the window; Esc goes back to the plan, as ‹ Plan does
  if (document.body.classList.contains('review') && !byId('logpane').classList.contains('open'))
    return byId('rback')?.click();
  if (byId('logpane').classList.contains('open')) return drawerBack ? drawerBack() : closeLog();
  // nothing else is open: Esc closes the open plan (not while typing in a box)
  if (selected && !(e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]'))) goHome();
});
// a click on a picture in a chat message shows it full size; a click or Esc closes it
document.addEventListener('click', (e) => {
  const im = e.target.closest && e.target.closest('.amsg .cimg img');
  if (!im) return;
  e.preventDefault(); e.stopPropagation();
  const v = document.createElement('div');
  v.className = 'imgview';
  v.innerHTML = '<img alt="' + escA(im.alt) + '">';
  v.firstChild.src = im.src;
  const close = () => { v.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (k) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); close(); } };
  v.addEventListener('click', close);
  document.addEventListener('keydown', onKey, true);
  document.body.appendChild(v);
}, true);
// the empty home screen: no plan open, no drawer
function goHome() { closeLog(); selected = null; renderList(); renderDetail(false); }
byId('home').addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;   // a new tab opens the page as a link does
  e.preventDefault(); goHome();
});
byId('q').addEventListener('input', renderList);
byId('suggestAll').addEventListener('click', openSuggestAll);
byId('collapseAll').addEventListener('click', () => {
  const names = state.map((s) => s.name);
  if (names.every((n) => collapsedProjects.has(n))) collapsedProjects.clear();
  else names.forEach((n) => collapsedProjects.add(n));
  saveCollapsed(); renderList();
});
// --- setup guide: what it does (demo) → pick a project; then a tour of the real screen ---
// Machine checks stay out of sight unless one fails: a list of green ticks is a screen
// with nothing to do on it.
const ONB_STEPS = ['How it works', 'Pick a project'];
let onbStep = 0, onbData = null, onbScan = null, onbScanDir = '', onbScanErr = '', onbCopies = [];
let demoScene = 0, onbPaintedStep = -1;
const onbOpenCards = new Set();   // project roots whose row is expanded
const CHECK_SVG = '<svg viewBox="0 0 16 16"><path d="M3 8.5l3.2 3.2L13 4.5" fill="none" stroke="currentColor" ' +
  'stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const mark = (c) => '<span class="mk ' + (c.ok ? 'ok' : c.required ? 'bad' : 'warn') + '">' + (c.ok ? CHECK_SVG : '') + '</span>';
// the open plan's project color as a band on top of the detail pane
function markDetailProject(name) {
  const d = byId('detail');
  d.classList.toggle('pcx', !!name);
  d.style.removeProperty('--ph'); d.style.removeProperty('--pc');
  if (name) { const [k, v] = projLook(name).style.split(':'); d.style.setProperty(k, v); }
}
function renderEmptyDetail() {
  syncUrl();
  markDetailProject(null);
  syncChat(null);
  drawHdTabs(null);
  document.body.classList.remove('review');
  byId('detail').innerHTML = state.length ? '<span class="dim">Select a plan on the left.</span>'
    : '<div class="welcome"><h2>Hand off the work. Review the result.</h2><p>Describe a change in a plan ' +
      'file. Claude Code implements and tests it in the background. You come back to a diff.</p>' +
      '<button class="primary" data-guide="">Get started</button></div>';
  byId('detail').querySelectorAll('[data-guide]').forEach((el) => el.addEventListener('click', () => openGuide(0)));
}
function openGuide(step) {
  onbStep = step || 0; onbPaintedStep = -1;
  demoScene = 0;
  byId('onb').classList.add('open');
  renderGuide();
  loadGuide(false);
}
function closeGuide() {
  byId('onb').classList.remove('open');
  try { sessionStorage.setItem('dash-guide-closed', '1'); } catch {}
  refresh();
}
// quiet: a background re-check — repaint only when a check changed, and never while
// the user is typing in one of the guide's inputs
async function loadGuide(rescan, quiet) {
  const scanUrl = '/api/scan' + (onbScanDir ? '?dir=' + encodeURIComponent(onbScanDir) : '');
  const before = JSON.stringify([onbData, onbScan, onbScanErr]);
  try {
    const [o, sc] = await Promise.all([
      fetch('/api/onboarding').then((r) => r.json()),
      rescan || !onbScan ? fetch(scanUrl).then((r) => r.json()) : null,
    ]);
    onbData = o;
    if (sc && sc.error) onbScanErr = sc.error;
    else if (sc) { onbScan = sc; onbScanErr = ''; }
  } catch (e) { if (!quiet) onbScanErr = 'Could not reach the server: ' + e; }
  if (!byId('onb').classList.contains('open')) return;
  if (quiet && (before === JSON.stringify([onbData, onbScan, onbScanErr])
    || byId('onbbody').contains(document.activeElement) && document.activeElement.tagName === 'INPUT')) return;
  renderGuide();
}
// A fix made in another window (a pasted prompt, an edited settings.json) has to show
// up here without a click on "Check again".
let guideBusy = false;
async function recheckGuide() {
  if (guideBusy || onbStep !== 1 || document.hidden || !byId('onb').classList.contains('open')) return;
  guideBusy = true;
  try { await loadGuide(true, true); } finally { guideBusy = false; }
}
setInterval(recheckGuide, 5000);
addEventListener('focus', recheckGuide);
// every copyable string goes through an index, so no text has to survive an attribute
const cp = (t) => { onbCopies.push(t); return onbCopies.length - 1; };
const cmdRow = (t) => '<div class="cmdrow"><code>' + esc(t) + '</code><button class="sm" data-cp="' + cp(t) + '">Copy</button></div>';
function checkHtml(c, projName, root) {
  let h = '<div class="ck">' + mark(c) + '<div class="bd"><span class="lb">' + esc(c.label) + '</span>' +
    (c.required ? '' : '<span class="opt-tag">optional</span>') +
    (c.detail ? '<span class="dt">' + esc(c.detail) + '</span>' : '');
  if (!c.ok) {
    h += '<div class="why">' + esc(c.why || '') + '</div><div class="fix">';
    if (c.fixCmd) h += cmdRow(c.fixCmd);
    if (c.fixPrompt) h += '<details class="pr" data-pk="' + escA((root || '') + '|' + c.label) + '"><summary>Prompt for Claude Code, run in this repo ' +
      '<button class="sm" data-cp="' + cp(c.fixPrompt) + '">Copy prompt</button></summary>' +
      '<div class="promptbox">' + esc(c.fixPrompt) + '</div></details>';
    if (c.action === 'launchers' && projName)
      h += '<button class="sm" data-lset="' + escA(projName) + '">Set up a launcher by hand</button>';
    h += '</div>';
  }
  return h + '</div></div>';
}
function projRow(p, registered) {
  const open = onbOpenCards.has(p.root);
  const missing = p.checks.filter((c) => !c.ok);
  const req = missing.filter((c) => c.required);
  const stateTxt = p.level === 'green' ? 'Ready'
    : p.level === 'amber' ? 'Ready · ' + missing.length + ' tip' + (missing.length === 1 ? '' : 's')
    : 'Needs ' + req.length + ' thing' + (req.length === 1 ? '' : 's');
  let h = '<div class="prow"><div class="prow-head" data-card="' + escA(p.root) + '">' +
    '<div style="flex:1;min-width:0"><div class="prow-name">' + esc(p.name) + '</div>' +
    '<div class="prow-path">' + esc(p.display) + '</div></div>' +
    '<span class="prow-state ' + p.level + '">' + (p.level === 'green' ? CHECK_SVG.replace('<svg', '<svg width="13" height="13"') : '') +
    stateTxt + '</span>' +
    (registered ? '<span class="dim" style="font-size:12px">added</span>'
      : '<button class="sm ' + (p.level === 'red' ? '' : 'primary') + '" data-add="' + escA(p.root) + '">Add</button>') +
    '<span class="dim" style="width:12px">' + (open ? '−' : '+') + '</span></div>';
  if (!open) return h + '</div>';
  h += '<div class="prow-body">' + p.checks.map((c) => checkHtml(c, registered ? p.name : null, p.root)).join('');
  h += '<div class="prow-actions">';
  if (!registered)
    h += '<input data-nm="' + escA(p.root) + '" value="' + escA(p.name) + '" aria-label="project name" title="project name">' +
      '<input data-cl="' + escA(p.root) + '" value="' + escA(p.client) + '" aria-label="client" title="client — groups projects in the sidebar">' +
      // the color it would get as the next project; sent only when changed, so it stays automatic otherwise
      '<input type="color" data-gc="' + escA(p.root) + '" value="' + hueHex(PROJ_HUES[state.length % PROJ_HUES.length]) +
        '" aria-label="project color" title="project color on cards and the plan header">' +
      '<input data-gs="' + escA(p.root) + '" maxlength="12" size="8" placeholder="' + escA(autoShort(p.name, p.client)) +
        '" aria-label="short tag" title="short tag on the plan cards — empty means automatic">';
  if (p.fixAll)
    h += '<button class="sm" data-cp="' + cp(p.fixAll) + '" title="one prompt covering every item above that Claude can fix">' +
      'Copy one prompt that fixes all of it</button>';
  if (registered) h += '<button class="sm" data-recheck="1">Check again</button>';
  return h + '</div></div></div>';
}
const DEMO = [
  ['You write a plan', 'A markdown file in the repo that says what to change and how to check it.'],
  ['Claude does the work', 'In the background: it edits, runs the tests and reviews itself. No prompts, no babysitting.'],
  ['You review the diff', 'You come back to finished code, ready for you to check and commit.'],
];
const demoHtml = () =>
  '<div class="demo"><div><div class="win s' + demoScene + '"><div class="win-bar">' +
  ['.plans/rate-limit-login.md', 'rate-limit-login', 'rate-limit-login'][demoScene] +
  '<span class="st"><i></i>' + ['draft', 'running', 'ready for review'][demoScene] + '</span></div>' +
  '<div class="scene' + (demoScene === 0 ? ' on' : '') + '">' +
    '<div class="ln h"># Plan: Rate-limit the login endpoint</div>' +
    '<div class="ln m">## Goal</div><div class="ln">Five attempts per minute per IP, then 429.</div>' +
    '<div class="ln m">## Steps</div><div class="ln">1. Add a guard in src/auth/</div>' +
    '<div class="ln">2. Apply it to POST /login</div><div class="ln">3. Test the 6th attempt fails</div></div>' +
  '<div class="scene' + (demoScene === 1 ? ' on' : '') + '">' +
    '<div class="ln m">reading the plan</div><div class="ln">create  src/auth/rate-limit.guard.ts</div>' +
    '<div class="ln">edit    src/auth/login.controller.ts</div><div class="ln">create  test/auth/rate-limit.spec.ts</div>' +
    '<div class="ln">run     pnpm test <span class="pass">48 passed</span></div>' +
    '<div class="ln">review  <span class="pass">no findings</span></div></div>' +
  '<div class="scene' + (demoScene === 2 ? ' on' : '') + '">' +
    '<div class="ln m">src/auth/login.controller.ts</div>' +
    '<div class="ln del">-  @Post("login")</div><div class="ln add">+  @Post("login") @UseGuards(RateLimitGuard)</div>' +
    '<div class="ln m">src/auth/rate-limit.guard.ts  (new)</div>' +
    '<div class="ln add">+  const LIMIT = 5, WINDOW_MS = 60_000;</div>' +
    '<div class="ln add">+  if (hits(ip) > LIMIT) throw new TooManyRequests();</div></div>' +
  '</div><div class="demo-nav"><button class="sm" data-scene="' + (demoScene + 2) % 3 + '"' +
    (demoScene === 0 ? ' disabled' : '') + ' aria-label="previous">‹</button>' + (demoScene + 1) + ' of 3' +
    (demoScene < 2 ? '<button class="sm nx" data-scene="' + (demoScene + 1) + '">Next: ' +
      DEMO[demoScene + 1][0] + ' ›</button>' : '') + '</div>' +
  '</div><div class="caps">' + DEMO.map((d, i) => '<button data-scene="' + i + '" class="' +
    (i === demoScene ? 'on' : '') + '"><b>' + (i + 1) + '. ' + d[0] + '</b><span>' + d[1] + '</span></button>').join('') +
  '</div></div>';
function paintDemo() {
  const host = byId('demohost');
  if (!host) return;
  host.innerHTML = demoHtml();
  host.querySelectorAll('[data-scene]').forEach((el) => el.addEventListener('click', () => {
    demoScene = +el.dataset.scene; paintDemo();
  }));
}
// the reader moves the demo on — an autoplay kept turning the page before it was read
function startDemo() { paintDemo(); }
function renderGuide() {
  onbCopies = [];
  byId('onbsteps').innerHTML = ONB_STEPS.map((t, i) => '<span data-step="' + i + '" class="' +
    (i === onbStep ? 'on' : i < onbStep ? 'done' : '') + '"><b>' + (i + 1) + '</b>' + t + '</span>').join('');
  const d = onbData;
  const regd = d ? d.projects : [];
  let h = '', next = 'Continue', nextOff = false;
  if (onbStep === 0) {
    h += '<h2>Hand off the work. Review the result.</h2><p class="lead">Plans runs your Claude Code setup ' +
      'without you at the keyboard. You write down what to change, it does the work in the background, ' +
      'and you come back to code that is ready for review.</p><div id="demohost"></div>';
    const bad = d ? d.system.filter((c) => !c.ok) : [];
    if (bad.length) {
      const hard = bad.some((c) => c.required);
      h += '<div class="alert' + (hard ? '' : ' soft') + '"><p><b>' +
        (hard ? 'Fix this before your first run' : 'Optional, but worth doing') + '</b></p>' +
        bad.map((c) => checkHtml(c)).join('') + '</div>';
    }
    next = 'Get started';
  } else if (onbStep === 1) {
    h += '<h2>Which repo should Claude work in?</h2><p class="lead">These are the repos found next to this ' +
      'one. <b>Ready</b> ones can run plans now. For the others, open the row: each missing piece comes ' +
      'with a prompt you paste into Claude Code, and it sets it up for you.</p>';
    if (regd.length) h += '<h3>Added</h3>' + regd.map((p) => projRow(p, true)).join('');
    h += '<h3>Found in ' + (onbScan ? esc(onbScan.roots.join(', ')) : '…') + '</h3>';
    if (onbScanErr) h += '<p style="color:var(--bad)">' + esc(onbScanErr) + '</p>';
    if (!onbScan) h += '<p class="dim">Looking for repos…</p>';
    else if (!onbScan.candidates.length) h += '<p class="dim">Nothing new here.</p>';
    else h += onbScan.candidates.map((p) => projRow(p, false)).join('');
    h += '<div class="scanrow"><input id="scandir" placeholder="Look somewhere else, e.g. ~/code" value="' +
      escA(onbScanDir) + '"><button class="sm" id="scanbtn">Look</button></div>';
    nextOff = !regd.length;
    next = 'Show me around';
  }
  // a repaint must not close an open prompt, drop a typed name or jump the scroll
  const B0 = byId('onbbody'), top = onbStep === onbPaintedStep ? B0.scrollTop : 0;
  const openPk = new Set([...B0.querySelectorAll('details[open][data-pk]')].map((x) => x.dataset.pk));
  const typed = ['data-nm', 'data-cl'].flatMap((a) =>
    [...B0.querySelectorAll('[' + a + ']')].map((x) => [a, x.getAttribute(a), x.value]));
  B0.innerHTML = h;
  B0.querySelectorAll('details[data-pk]').forEach((x) => { if (openPk.has(x.dataset.pk)) x.open = true; });
  typed.forEach(([a, k, v]) => {
    const x = [...B0.querySelectorAll('[' + a + ']')].find((i) => i.getAttribute(a) === k);
    if (x) x.value = v;
  });
  B0.scrollTop = top;
  onbPaintedStep = onbStep;
  byId('onbback').style.visibility = onbStep ? '' : 'hidden';
  byId('onbnext').textContent = next;
  byId('onbnext').disabled = nextOff;
  byId('onbnext').title = nextOff ? 'Add a repo first' : '';
  if (onbStep === 0) startDemo();
  const B = byId('onbbody');
  B.querySelectorAll('[data-cp]').forEach((el) => el.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const was = el.textContent, ok = await copyText(onbCopies[+el.dataset.cp]);
    el.textContent = ok ? 'Copied' : 'Copy failed — select it by hand';
    setTimeout(() => (el.textContent = was), 1600);
  }));
  B.querySelectorAll('input[data-gc]').forEach((el) => el.addEventListener('input', () => { el.dataset.touched = '1'; }));
  B.querySelectorAll('[data-card]').forEach((el) => el.addEventListener('click', () => {
    const k = el.dataset.card;
    onbOpenCards.has(k) ? onbOpenCards.delete(k) : onbOpenCards.add(k);
    renderGuide();
  }));
  B.querySelectorAll('[data-add]').forEach((el) => el.addEventListener('click', async (e) => {
    e.stopPropagation();   // the button sits in the row header, which toggles on click
    const root = el.dataset.add;
    const cand = onbScan.candidates.find((c) => c.root === root);
    // a collapsed row has no inputs — add it under the suggested name and client
    const val = (attr, dflt) => {
      const inp = [...B.querySelectorAll('[' + attr + ']')].find((x) => x.getAttribute(attr) === root);
      return inp ? inp.value.trim() : dflt;
    };
    el.disabled = true; el.textContent = 'Adding…';
    const r = await (await fetch('/api/add-project', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ root, name: val('data-nm', cand.name), client: val('data-cl', cand.client),
        plansDir: cand.plansDir, short: val('data-gs', ''),
        color: B.querySelector('[data-gc="' + CSS.escape(root) + '"][data-touched]')?.value || '' }) })).json();
    if (!r.ok) { alert(r.output); el.disabled = false; el.textContent = 'Add'; return; }
    onbScan.candidates = onbScan.candidates.filter((c) => c.root !== root);
    await loadGuide(false);
    refresh();
  }));
  B.querySelectorAll('[data-lset]').forEach((el) => el.addEventListener('click', () => {
    byId('onb').classList.remove('open');
    openLauncherSetup(el.dataset.lset, () => { closeLog(); openGuide(onbStep); });
  }));
  B.querySelectorAll('[data-recheck]').forEach((el) => el.addEventListener('click', () => loadGuide(true)));
  const sb = byId('scanbtn');
  if (sb) {
    const go = () => { onbScanDir = byId('scandir').value.trim(); onbScan = null; renderGuide(); loadGuide(true); };
    sb.addEventListener('click', go);
    byId('scandir').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
  }
}
byId('onbsteps').addEventListener('click', (e) => {
  const s = e.target.closest('[data-step]');
  if (s) { onbStep = +s.dataset.step; renderGuide(); }
});
byId('onbback').addEventListener('click', () => { onbStep = Math.max(0, onbStep - 1); renderGuide(); });
byId('onbnext').addEventListener('click', () => {
  if (onbStep === ONB_STEPS.length - 1) { closeGuide(); return startTour(); }
  onbStep++; renderGuide();
});
byId('onbskip').addEventListener('click', closeGuide);
byId('onb').addEventListener('click', (e) => { if (e.target === byId('onb')) closeGuide(); });
// returning users come to add a repo: open on "Pick a project" (step 1 "How it works" is one click back)
byId('guidebtn').addEventListener('click', () => openGuide(1));
// --- tour: after the guide, spotlight the real screen one region at a time ---
// What to do next stays the user's call; the tour only says what each part is for.
const TOUR = [
  { el: () => document.querySelector('aside'), title: 'Your plans',
    body: 'Every .md file in each repo’s plans folder, grouped by client and project. Click one to open it. ' +
      'Plans that are running, or finished and waiting for your review, pin to the top of this list.' },
  { el: () => byId('detail'), title: 'The open plan',
    body: 'A plain-language summary, its status and tags, the controls to launch it, and the full plan text. ' +
      'A launched plan runs in the background; you can close the tab.' },
  { el: () => document.querySelector('.launchbar'), title: 'Run several at once',
    body: 'Tick plans in the list (or double-click them) and they queue down here. One press starts them all.' },
  { el: () => [byId('guidebtn'), byId('settingsbtn')], title: 'Guide and Settings',
    body: 'Guide brings back the walkthrough and the list of repos found on this machine. ' +
      'Settings is where you rename projects, change folders and edit launchers.' },
];
let tourStep = -1;
function startTour() {
  // open a plan first, so the plan pane shows something real rather than "Select a plan"
  if (!selected) {
    const first = plans.find((p) => !p.archived);
    if (first) { selected = first.key; renderList(); renderDetail(true); }
  }
  tourStep = 0;
  byId('tour').classList.add('open');
  setTimeout(paintTour, 150);
}
function endTour() {
  tourStep = -1;
  byId('tour').classList.remove('open');
}
function paintTour() {
  if (tourStep < 0) return;
  const s = TOUR[tourStep];
  const els = [].concat(s.el()).filter(Boolean);
  if (!els.length) return endTour();
  const rs = els.map((e) => e.getBoundingClientRect());
  const pad = 6;
  const r = { left: Math.min(...rs.map((x) => x.left)) - pad, top: Math.min(...rs.map((x) => x.top)) - pad,
              right: Math.max(...rs.map((x) => x.right)) + pad, bottom: Math.max(...rs.map((x) => x.bottom)) + pad };
  const hole = byId('tourhole');
  hole.style.left = Math.max(0, r.left) + 'px'; hole.style.top = Math.max(0, r.top) + 'px';
  hole.style.width = (Math.min(innerWidth, r.right) - Math.max(0, r.left)) + 'px';
  hole.style.height = (Math.min(innerHeight, r.bottom) - Math.max(0, r.top)) + 'px';
  const pop = byId('tourpop');
  pop.innerHTML = '<div class="tp-count">' + (tourStep + 1) + ' of ' + TOUR.length + '</div><b>' + s.title +
    '</b><p>' + esc(s.body) + '</p><div class="tp-foot"><button class="linkbtn" id="tourskip">' +
    (tourStep === TOUR.length - 1 ? '' : 'Skip tour') + '</button><span style="flex:1"></span>' +
    (tourStep ? '<button class="sm" id="tourprev">Back</button>' : '') +
    '<button class="sm primary" id="tournext">' + (tourStep === TOUR.length - 1 ? 'Done' : 'Next') + '</button></div>';
  // beside the region if it fits (right, left, below, above), else inside its top-left corner
  const pw = pop.offsetWidth, ph = pop.offsetHeight, gap = 14, W = innerWidth, H = innerHeight;
  const spots = [
    [r.right + gap, r.top], [r.left - gap - pw, r.top],
    [r.right - pw, r.bottom + gap], [r.right - pw, r.top - gap - ph],
  ];
  const fits = ([x, y]) => x >= 8 && x + pw <= W - 8 && y + ph <= H - 8 && y >= 8;
  let [x, y] = spots.find(fits) || [r.left + 24, r.top + 24];
  x = Math.min(Math.max(8, x), W - pw - 8); y = Math.min(Math.max(8, y), H - ph - 8);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
  byId('tourskip').addEventListener('click', endTour);
  byId('tournext').addEventListener('click', () => tourGo(1));
  if (byId('tourprev')) byId('tourprev').addEventListener('click', () => tourGo(-1));
  byId('tournext').focus();
}
function tourGo(d) {
  const n = tourStep + d;
  if (n >= TOUR.length) return endTour();
  tourStep = Math.max(0, n);
  paintTour();
}
addEventListener('resize', paintTour);
let lastStateRaw = '', firstPaint = false, ticking = false;
const connMsg = (m) => {
  const el = byId('connmsg');
  el.textContent = m || '';
  el.style.display = m ? '' : 'none';
};
// A cold /api/state builds every plan in every project and can take ~9s — far longer
// than the 5s tick. Without this guard the ticks pile up and their responses can land
// out of order, repainting the list from a stale payload.
// --- alerts: a sound, and a desktop notification when this tab is not in front, when a run
// stops (needs you, failed, finished), or the chat agent answers or asks for permission. Off until 🔔 is clicked,
// which is also the click the browser wants before it allows sound and notifications.
let alertsOn = false, audio = null;
try { alertsOn = localStorage.getItem('dash-alerts') === '1'; } catch {}
const wasBusy = {};   // plan key -> run / chat / waiting flags at the last state
function paintAlertBtn() {
  const b = byId('alertBtn');
  b.textContent = alertsOn ? '🔔' : '🔕';
  b.setAttribute('aria-pressed', String(alertsOn));
  b.title = alertsOn ? 'Alerts on: sound and notification when a run stops or the agent answers. Click to turn off.'
    : 'Alerts off. Click for a sound and a notification when a run stops or the agent answers.';
}
function chime() {
  try {
    audio = audio || new AudioContext();
    if (audio.state === 'suspended') audio.resume();
    const t = audio.currentTime;
    [[660, 0], [880, 0.16]].forEach(([f, at]) => {
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.25, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35);
      o.connect(g).connect(audio.destination);
      o.start(t + at); o.stop(t + at + 0.4);
    });
  } catch {}
}
// With several tabs open, one tab rings: the tab with the plan's chat open, else the tab used last.
// The last used tab holds this lock; the other tabs wait in line, so closing it passes the lock on.
let alertLead = false, alertLeadWait = null;
function claimAlertLead(steal) {
  if (!navigator.locks || alertLead) return;
  if (steal && alertLeadWait) alertLeadWait.abort();
  const wait = alertLeadWait = steal ? null : new AbortController();
  navigator.locks.request('dash-alert-lead', steal ? { steal: true } : { signal: wait.signal },
    () => { alertLead = true; return new Promise(() => {}); })
    .catch(() => {
      if (wait && wait.signal.aborted) return;
      alertLead = false;   // another tab took it
      claimAlertLead(false);
    });
}
claimAlertLead(document.hasFocus());
window.addEventListener('focus', () => claimAlertLead(true));
async function ringsHere(key) {
  if (!navigator.locks || (ch && ch.key === key)) return true;
  try {
    const { held } = await navigator.locks.query();
    if (held.some((l) => l.name === 'dash-chat:' + key)) return false;
  } catch { return true; }
  return alertLead;
}
function openFromAlert(key, tab) {
  selected = key;
  if (tab === 'chat') { chatOn = false; toggleChat(true); } else if (tab) prTab[key] = tab;
  lastPrDraw = null; renderList(); renderDetail(true);
}
// A card in the page for each alert, so you see it while you read another plan, without the 🔔
// and without leaving what you do. A card stays open until you hide it with the – button; it never
// hides by itself. Hidden cards wait behind the 🔔 pill at the bottom right; a click on the pill
// shows them again. Only a click on the card (it opens the plan) or × removes it. The list is kept
// in the browser, so a reload or a dashboard restart keeps it. A newer card for the same plan and
// event replaces the older one.
let alertCards = [], trayOpen = false;
try { alertCards = JSON.parse(localStorage.getItem('dash-alert-cards') || '[]'); } catch {}
function saveCards() {
  alertCards = alertCards.slice(-30);
  try { localStorage.setItem('dash-alert-cards', JSON.stringify(alertCards)); } catch {}
}
function setCard(id, change) {
  const c = alertCards.find((x) => x.id === id);
  if (!c) return;
  if (change === 'remove') alertCards = alertCards.filter((x) => x !== c); else Object.assign(c, change);
  saveCards(); paintCards();
}
function paintCards() {
  const list = byId('toastList'), pill = byId('toastPill');
  const hidden = alertCards.filter((c) => !c.open);
  if (!hidden.length) trayOpen = false;
  const shown = alertCards.filter((c) => c.open || trayOpen);
  list.innerHTML = shown.map((c) => {
    const at = new Date(c.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return '<div class="toast ' + escA(c.kind) + '" data-id="' + escA(c.id) + '"><div class="tt"><b>' + esc(c.title) +
      '<span class="tm">' + at + '</span></b><div class="tb">' + esc(c.body) + '</div></div>' +
      (c.open ? '<button class="th" title="Hide. It waits behind the 🔔 pill." aria-label="Hide">–</button>' : '') +
      '<button class="tx" title="Close" aria-label="Close">×</button></div>';
  }).join('');
  pill.hidden = !hidden.length;
  pill.innerHTML = trayOpen ? 'Hide ' + hidden.length + ' <span class="clr" data-clear>Clear all</span>'
    : '🔔 ' + hidden.length + ' hidden alert' + (hidden.length > 1 ? 's' : '');
  pill.title = trayOpen ? 'Hide these alerts again' : 'Show the alerts you hid or did not get to';
}
byId('toastList').addEventListener('click', (e) => {
  const el = e.target.closest('.toast');
  if (!el) return;
  const c = alertCards.find((x) => x.id === el.dataset.id);
  if (!c) return;
  if (e.target.closest('.th')) return setCard(c.id, { open: false });
  setCard(c.id, 'remove');
  if (!e.target.closest('.tx')) openFromAlert(c.key, c.tab);
});
byId('toastPill').addEventListener('click', (e) => {
  if (e.target.closest('[data-clear]')) { alertCards = alertCards.filter((c) => c.open); saveCards(); }
  else trayOpen = !trayOpen;
  paintCards();
});
// the list is one list across tabs
window.addEventListener('storage', (e) => {
  if (e.key !== 'dash-alert-cards') return;
  try { alertCards = JSON.parse(e.newValue || '[]'); } catch { alertCards = []; }
  paintCards();
});
function toast(title, body, key, tab, kind) {
  const id = key + '|' + title;
  alertCards = alertCards.filter((c) => c.id !== id);
  alertCards.push({ id, title, body, key, tab, kind, at: Date.now(), open: true });
  saveCards(); paintCards();
}
paintCards();
async function alertUser(title, body, key, tab, kind = 'ok') {
  if (!await ringsHere(key)) return;
  if (!document.hasFocus()) { unseen.push(title + ' · ' + body.split(' / ')[0]); paintTitle(); }
  // no card for an answer you are looking at: the plan's chat is open on screen
  if (!(tab === 'chat' && ch && ch.key === key && !document.hidden)) toast(title, body, key, tab, kind);
  if (!alertsOn) return;
  chime();
  if (document.hasFocus() || !('Notification' in window) || Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, tag: key + title });
  n.onclick = () => { window.focus(); n.close(); openFromAlert(key, tab); };
}
function checkAlerts() {
  for (const p of plans) {
    const run = !!(p.live || starting(p)), ask = !!p.chatting, waits = p.chatWaits || 0, was = wasBusy[p.key];
    if (was && was.run && !run) {
      const o = outOf(p);
      alertUser(o === 'failed' ? 'Run failed' : o === 'needs-you' ? 'Run needs you' : 'Run finished',
        p.project + ' / ' + p.file, p.key, null, o === 'failed' ? 'bad' : o === 'needs-you' ? 'warn' : 'ok');
    }
    if (was && was.ask && !ask) {
      alertUser('The agent answered', p.project + ' / ' + p.file, p.key, 'chat');
      if (!(ch && ch.key === p.key)) markAnswered(p.key, true);   // not marked when its chat is on screen
    }
    if (ask) markAnswered(p.key, false);
    if (was && waits > was.waits) alertUser('The agent asks for permission', p.project + ' / ' + p.file, p.key, 'chat', 'warn');
    wasBusy[p.key] = { run, ask, waits };
  }
}
byId('alertBtn').addEventListener('click', async () => {
  alertsOn = !alertsOn;
  try { localStorage.setItem('dash-alerts', alertsOn ? '1' : '0'); } catch {}
  paintAlertBtn();
  if (alertsOn) {
    chime();   // a sample, and it unlocks sound for this tab
    if ('Notification' in window && Notification.permission === 'default') await Notification.requestPermission();
    if ('Notification' in window && Notification.permission === 'denied')
      alert('Notifications are blocked for this site, so you will only hear the sound. Allow them in the browser’s site settings.');
  }
});
// the 🔔 is one setting across tabs, so the tab that rings never has an old value
window.addEventListener('storage', (e) => { if (e.key === 'dash-alerts') { alertsOn = e.newValue === '1'; paintAlertBtn(); } });
// a browser keeps sound locked until the page gets a click; the first click anywhere unlocks it
document.addEventListener('pointerdown', () => { if (alertsOn && !audio) { try { audio = new AudioContext(); } catch {} } }, { once: true });
paintAlertBtn();
async function refresh() {
  if (ticking) return;
  ticking = true;
  try { await refreshOnce(); } finally { ticking = false; }
}
async function refreshOnce() {
  // This used to be a bare unguarded await on fetch('/api/state'). A rejected
  // fetch (the server restarts under launchd --watch) or any non-200 made the very
  // first refresh() throw, so renderList() never ran even once and the page sat on
  // its static markup — an empty sidebar that looks exactly like "no plans".
  let raw;
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    raw = await res.text();
  } catch (e) {
    connMsg('⚠️ reconnecting… ' + String((e && e.message) || e));
    if (!firstPaint) byId('side').innerHTML =
      '<div class="dim" style="padding:14px">waiting for the server…</div>';
    return; // leave lastStateRaw alone: a failed tick must not suppress the next good one
  }
  byId('clock').textContent = new Date().toLocaleTimeString();
  // Most ticks carry a byte-identical payload, and repainting one of those is
  // pure destruction: it rebuilds the whole list and detail pane and throws away
  // the user's selection. Repaint only on a real change, and if something is
  // selected right now, leave it alone and take the change on a later tick.
  // The very first paint always goes through — there is nothing to protect yet,
  // and a stray selection must not be able to leave the dashboard blank.
  if (raw !== lastStateRaw && (!firstPaint || !selectionLive())) {
    let next;
    try {
      next = JSON.parse(raw);
      if (!Array.isArray(next)) throw new Error('expected an array of projects');
    } catch (e) {
      // e.g. the 500 path returning {error}. Report it and keep lastStateRaw unset,
      // so a later good payload still repaints instead of being deduped away.
      connMsg('⚠️ bad /api/state payload — ' + String((e && e.message) || e));
      return;
    }
    state = next;
    plans = state.flatMap((proj) => proj.plans.map((p) => ({
      ...p, pr: p.pr || knownPr[proj.name + '/' + p.slug] || null, project: proj.name, client: proj.client,
      hasPipeline: proj.hasPipeline, modes: proj.modes, launchers: proj.launchers, issuesUrl: proj.issuesUrl,
      prError: proj.prError,
    })));
    // a worktree item looks like a plan to the PR tabs: key, slug ("wt.<name>"), file, title, pr
    wts = state.flatMap((proj) => (proj.worktrees || []).map((w) => {
      const key = proj.name + '/' + w.slug;
      return { ...w, kind: 'wt', key, file: w.name, title: w.pr ? w.pr.title : w.branch || w.name,
        pr: w.pr || knownPr[key] || null, worktree: true, wtPath: w.path, tags: [], status: null,
        project: proj.name, client: proj.client, issuesUrl: proj.issuesUrl, prError: proj.prError };
    }).sort((a, b) => (b.agent === 'working') - (a.agent === 'working')   // working first, then the latest active
      || (Date.parse(b.lastActive || b.committedAt) || 0) - (Date.parse(a.lastActive || a.committedAt) || 0)));
    for (const p of [...plans, ...wts]) if (p.pr) knownPr[p.key] = p.pr;
    // don't clobber the pane (and steal focus) while the user is typing in it
    const typing = byId('detail').contains(document.activeElement)
      && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    checkAlerts();
    renderList();
    if (selected && !typing) renderDetail(false);
    else if (!selected) renderEmptyDetail();
    if (!firstPaint && !state.length && !byId('onb').classList.contains('open')) {
      let closed = null;
      try { closed = sessionStorage.getItem('dash-guide-closed'); } catch {}
      if (!closed) openGuide(0);
    }
    renderBar();
    lastStateRaw = raw;   // only once a full repaint has actually landed
    firstPaint = true;
  }
  connMsg('');
  if (logKey) loadLog();
}
readUrl();
byId('side').innerHTML = '<div class="dim" style="padding:14px">loading plans…</div>';
refresh();
let lastTick = Date.now();
setInterval(() => {
  const fast = Date.now() < fastUntil || plans.some(starting);
  if (!fast && Date.now() - lastTick < 5000) return;
  lastTick = Date.now(); refresh();
}, 1000);
if (new URLSearchParams(location.search).get('settings')) openSettings();
if (new URLSearchParams(location.search).get('tour')) {
  const tourWhenPainted = () => (firstPaint ? startTour() : setTimeout(tourWhenPainted, 200));
  tourWhenPainted();
}
if (new URLSearchParams(location.search).get('guide')) openGuide(+new URLSearchParams(location.search).get('guide') - 1 || 0);
jumpToBottom(byId('logbody'));
