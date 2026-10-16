# Test plan template

Fill one line per check: **what you do → what you expect**. Drop checks that don't apply and say why in one phrase. Keep it short enough to read in a minute.

```
Test plan — <route> as <account> (<role>, <tenant>)

A. First view / empty state
   - Open <route> as a new-ish user → <what should be visible>; next step obvious?
   - Empty state (mocked empty list) → helpful text + call to action, no blank area

B. Core flows
   - Each button / filter / select / pagination control → <expected result>
   - Deep link <route>/<id> → opens the right item
   - Back / forward after filtering → filters survive (URL or state)?
   - Reload mid-flow → state restored or sensibly reset

C. Data correctness
   - <number/list on screen> vs GET <endpoint> vs SQL <table> → equal

D. Isolation / security   (quote the guard before claiming anything)
   - Other tenant's <id> → 404
   - Lower role on admin route/endpoint → 403
   - Lists contain only rows whose tenant column = <tenant>

E. Errors
   - Invalid id / malformed URL → clear message, way back
   - API 500 / down (mocked) → error message, retry, no crash
   - Slow response (mocked delay) → loading state, no double submit

F. Accessibility
   - axe on each state (default, empty, error, dialog open)
   - Keyboard: Tab order, visible focus, Enter/Escape on dialogs
   - Labels on inputs/icon buttons; contrast in light and dark

G. Responsive
   - 390, 1100, 1440, 2555 px → no sideways scroll, readable text, nothing clipped

H. Console / network
   - No console errors, no failed or duplicate requests, no unexpected 4xx/5xx

I. Consistency with similar features   (siblings confirmed by the user)
   - Sibling list: <route / component, why similar> × 2–4
   - Code: same shared component, tokens, i18n key style, loading/empty/error states
   - Screen: fingerprint diff per sibling (size, spacing, font, icon, colour tokens), same theme + width
   - States: hover, disabled, loading look the same as in the siblings

AI features (add when the page talks to an AI)
   - Ground-truth questions (answer known from DB) → correct answer
   - Hallucination check → no invented numbers, names, case ids
   - Wrong refusals → answers what it should, refuses what it should
   - Latency → time to first token / full answer
   - Follow-up question → keeps context of the previous turn
```
