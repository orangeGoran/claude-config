# Report template

Use this structure. Plain words, concrete examples (real values, real ids).

````markdown
## Usability test — <route> (<date>, <account role>, <tenant>)

**TLDR:** <2–3 plain sentences: does it work, the worst problem, what to do first.>

**Page to share:** [<date>-<route>-findings.html](file://<absolute path that compare.mjs printed>)

**Tested:** <one line per plan section: what you actually ran — states, widths, themes, number of AI questions, etc.>
**Not tested:** <anything skipped and why>

### What works

- <short bullets with evidence where useful>

### Findings

| #   | Problem (plain words + concrete example)                                           | Severity | Cause                                                                               | Fix                           |
| --- | ---------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------- | ----------------------------- |
| 1   | Filtering by "Failed" then pressing Back shows all rows again — the filter is lost | Medium   | Filter kept in useState, not URL — [page.tsx:88](src/app/.../page.tsx#L88) | Store filter in search params |
| 2   | ...                                                                                | ...      | Backend: GET /v1/... returns `total` ignoring the filter (API 12 vs DB 3)           | See backend block             |

Severity: **High** = wrong data, data leak, blocks the task. **Medium** = confusing or broken secondary flow. **Low** = polish.

Evidence: [Open evidence folder](file://<absolute QA_DIR path>/) — <file names of the screenshots / JSON for the key findings>

### Consistency with similar features

Compared with: <sibling 1 (file:line)>, <sibling 2 (file:line)> — or "not tested: <why>"

| #   | Difference (concrete)                      | New feature                                 | Sibling                                                                      | Fix                      |
| --- | ------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------ |
| C1  | AI button is smaller and uses another icon | 32 px, `lucide-sparkles`, `--brand-accent` | 36 px, `lucide-brain`, `--brand-accent` ([D8…tsx:40](src/...#L40)) | Use the shared component |

**Design decisions** (the siblings disagree, so there is no standard yet):

- <what differs> — option A: <pattern> (<n> places, e.g. file:line) · option B: <pattern> (<n> places). Which one is the standard?

### Missing from backend

```
<Written for the backend team. Self-contained, no frontend jargon. For each item: endpoint, what happens now (request + response example), what we need, why (user impact).>
```

### Recommended fixes

1. <fix> — <small & safe | needs design decision | backend>
2. ...

Want me to apply the small, safe ones (#…)? After the fixes I'll retake the finding screenshots and give you one before/after HTML file to share.
````
