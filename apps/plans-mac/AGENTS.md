# apps/plans-mac

Shipyard, the Mac app of the plans dashboard: a Swift window (`src/main.swift`) around the dashboard page, and `build.mjs`, which builds, signs and installs it. User docs: `docs/plans-dashboard.md` → "Mac app".

## Rules

- Plain AppKit and WebKit only. No SwiftUI, no Swift packages, no Xcode project.
- Build only with `npm run build-app` (`node apps/plans-mac/build.mjs`). Tests use `--out <tmp> --no-install`.
- The app calls the page only through the `window.dashboard` hooks in `apps/dashboard/page/app.js`. A new hook needs a page entry and a line in the hook contract test (`test/build.test.mjs`).
- Each menu item is one `NSMenuItem(title:action:keyEquivalent:)` line, and each menu action is one `@objc func … { call("…") }` (or `{ setZoom(…) }`) line: the key tests read them.
- The header title bar is the app's own script (`headerScript` in `src/main.swift`), not page code. It reads only `header.mainhd`, its layout boxes and the `--asw` / `--hdl` sizes (the title bar test checks that the page still has them), and posts `"header"`, `"drag"` and `"zoom"` to the `plans` message handler. The app takes them only from the main frame of its origin.
- Links to other origins open in the default browser. The menu calls go only to a page of the app's origin, and only while the window is visible.
- Closing the window hides it. It never stops a run or a chat. A page `alert()` or `confirm()` shows the hidden window first (`showForPanel()`), so the page never waits on a sheet that nobody sees.
- An API newer than macOS 13 needs `#if compiler(…)` around its `if #available` block, so the app still builds with an older SDK.
- The app and `build.mjs` never stop processes. A new build is used after the owner quits the app (⌘Q) and opens it again.
