**Validation round:** 4

## Plan validation: 20261122-152506-move-apps-out-of-scripts.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The round-3 edits fit together. Step 14, step 13, Hard rules → Restart, Context and the Tests section now agree. Nothing is blocking. Two older lines (Affected files line 60 and Breaking changes line 78) still tell every Mac to run the scout install, and they do not match the round-3 rule "only where `~/.claude/scout.json` exists". Step 2 has two small wording gaps.

### Blocking issues
- None.

### Non-blocking concerns
- [Consistency / scout install scope] Round 3 limited the scout install to Macs where the scout is set up (Context line 14, Hard rules line 23 item 4, step 13 line 99, step 14 line 100). Two lines still say every Mac. Affected files line 60: the release note says "after this pull, run `scripts/setup-macos.sh` and `node apps/scout/scout.mjs --install` on each Mac". Breaking changes line 78: "run `scripts/setup-macos.sh` and `node apps/scout/scout.mjs --install` once per Mac". Line 60 also leaves out the `pgrep` check and `npm run restart`, which step 13 puts into the `summary`. A run that writes the release note from Affected files can tell a Mac without `~/.claude/scout.json` to install the scout job. That Mac then gets a daily job that fails (`scripts/scout.mjs:555` throws "No ~/.claude/scout.json"). `scripts/setup.sh:74` makes the same check. Suggestion: on lines 60 and 78, say "the order in Hard rules → Restart (the scout install only where `~/.claude/scout.json` exists)".
- [Consistency / step 2 comment list] Step 2 (line 88) says to change "the comments that name ... `scripts/page-versions.mjs`". That file stays in `scripts/` (Context line 16). The comment `(scripts/page-versions.mjs)` at `scripts/plans-dashboard.mjs:3121` is still correct after the move, and so is `scripts/artifact-copies.mjs` at `:2955`. An implementer who follows step 2 word for word could rewrite a correct comment. Suggestion: take `scripts/page-versions.mjs` out of that list, or say "keep the `scripts/` prefix, because the file stays".
- [Consistency / step 2 help text] Step 2 fixes the header comment "next to this file" (`scripts/plans-dashboard.mjs:10`). The `--help` text has a second copy of the same claim: "see pipeline-projects.example.json next to this script" (`:86`). Step 2 changes only `node server.mjs` in the usage text. After the move, line 86 is wrong, and `test/old-paths.test.mjs` does not find it because it has no old-path pattern. Suggestion: in step 2, also change `:86` to name `scripts/pipeline-projects.example.json`.

### Edge cases the plan should address
- None new. The round-3 edge cases are in the plan now: the same `--domain`/`--port` on re-run (line 23), the time between pull and setup (line 23), and the temp copy that the test deletes in `finally` (line 109).

### Checklist
- [x] All referenced files, lines, sections and symbols exist as stated
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done)
- [x] Wiring & registration matches the code (declared, exported, imported, registered)
- [x] Scope stays inside the goal; no open decision is taken silently
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

Evidence for the checked items:
- `git grep -I -E "scripts/plans-dashboard|scripts/scout\.mjs|scripts/chat-relay|scripts/test/|restart-dashboard|plans-dashboard\.mjs"`, without `.plans` and `changelog.d`: a step covers every hit. Step 0 covers `.claude/bootstrap.json:16,17,41,42,44,117,130,134` and the rendered files. Steps 2-12 cover the rest. `.github/workflows` has no hit. `docs/setup.md` has no hit.
- Step 11 quotes the sentence at `docs/plans-dashboard.md:47` word for word.
- `scripts/setup-macos.sh:68` (`$HERE/plans-dashboard.mjs`) and `:72-90` (bootout and bootstrap when the plist changes) support the Hard rules order. Running `npm run restart` first would start the old plist path.
- In `scripts/scout.mjs`, `install()` at `:567-582` has `here` (used only at `:574`), and the main-module check is at `:624`. Step 4 and step 10 match both.
- `scripts/docs-media.mjs`: the top-level exits are at `:27-28`, the exit handler at `:32`, `newHome()` at `:43-53` (the `docs/` copy at `:50`), and the run at `:571-578`. Step 10 names each one. `CHROME` is not read by the server or the dashboard test, so `process.env.CHROME = '/nonexistent'` has no side effect on them.
- `git mv*` and `mkdir*` are in the allow list (`.claude/scripts/auto-pipeline.sh:215,218`). `node --test*` is allowed in `.claude/settings.json:24`.
- `changelog-validate.mjs:173` accepts `.yml` and `.yaml`.
- `git ls-files --cached --others --exclude-standard` lists only ASCII paths, so path quoting does not break the old-paths test. The binary files are the PNGs and `docs/demo.mp4`, which the NUL-byte rule skips.

Commands that touched a service or the database: none.

```
Update the plan at .plans/20261122-152506-move-apps-out-of-scripts.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In Affected files (the changelog.d line) and in Breaking changes (the first bullet), replace "run scripts/setup-macos.sh and node apps/scout/scout.mjs --install on each Mac / once per Mac" with "the order in Hard rules → Restart (the scout install only where ~/.claude/scout.json exists)", to match Context, Hard rules, step 13 and step 14 (evidence: plan lines 60, 78; scripts/scout.mjs:555; scripts/setup.sh:74).
2. In step 2, remove scripts/page-versions.mjs from the comments to change, or say that comments which name scripts/artifact-copies.mjs and scripts/page-versions.mjs stay as they are, because both files stay in scripts/ (evidence: scripts/plans-dashboard.mjs:2955, :3121).
3. In step 2, also change the --help line "see pipeline-projects.example.json next to this script" so that it names scripts/pipeline-projects.example.json (evidence: scripts/plans-dashboard.mjs:86).

ADD THESE EDGE CASES:
- None.

Do not change anything the validation did not flag.
```
