**Validation round:** 4

## Plan validation: 20261126-125107-fast-api-state.md

**Verdict:** APPROVE WITH CHANGES

The round-3 edits propagated almost everywhere. Step 4 (window from `at`, or a build that still runs) and Contracts agree. But three prose places still describe the window as "from the build start" only and leave out the in-flight rule of step 4. The other findings are small precision points. No blocking issue.

### Blocking issues

None.

### Non-blocking concerns

- [Discrepancy / propagation of round 3 F1] Reference (deviation), Breaking changes and the second Breaking-changes bullet say that a request 1 s or more after the build start gets a new build. Step 4 says it gets the shared promise while `!stateBuild.done`. — Plan line 71 "A request more than `STATE_CACHE_MS` after the start of the last build gets a new build"; line 103 "A file change shows on the first request that comes `STATE_CACHE_MS` (1 s) or more after the start of the build in use"; line 104 "It shows on the first request 1 s or more after the start of the build in use"; against step 4 line 116 "either `!stateBuild.done` (the build still runs) or `Date.now() - stateBuild.at < STATE_CACHE_MS`". Contracts line 43 has it right. On the real data (builds of 2.57–2.78 s, Context line 14), a request 1–2.7 s after the start joins the running build and gets data from its start. So in the 1 s fast mode a change can show one poll later than lines 71/103 claim (the page guard in `app.js:4065-4067` and the 1 s tick at `app.js:5361-5365`). The code in step 4 is the intended behaviour (round 3 F1). Only the description is wrong. — Suggestion: in lines 71, 103 and 104 write "the first request that comes after the build in use has ended and 1 s or more after its start".
- [Docs wording] The docs row (step 10) and the roadmap sentence say the server "keeps" the answer for 1 s. The window counts from the build start, so after a build of 1 s or more the server keeps no answer. — Plan lines 144 and 146; step 4 line 116. — Suggestion: "how long after the start of a build the server gives its answer to all clients, in milliseconds (default `1000`)".
- [Step 8 PATH] The PATH is "`<box>/bin` first, then `ghDir/bin`", with no mention of the system PATH. The fake `pgrep` calls `sleep`, the fake `gh` is `#!/usr/bin/env node`, and `pipelineLive()` → `chatActiveIn()` → `claudeProcessCwds()` runs `lsof` (`server.mjs:388`, `server.mjs:411-413`). If the system PATH is missing, `sleep` is not found and the fake `pgrep` exits at once. Then the "always during the build" guarantee of Tests 4 is gone, but the test can still pass. — Plan line 126; `dashboard.test.mjs:166` (`path.join(ghDir, 'bin') + ':' + process.env.PATH`). — Suggestion: write `PATH: <box>/bin + ':' + ghDir/bin + ':' + process.env.PATH`, and keep `...process.env` as the docs-media test does (`dashboard.test.mjs:1670`).
- [Never stop by name / How to verify] `ps -p <pid> -o command=` for the 4911 server shows `node apps/dashboard/server.mjs`, a relative path. It cannot prove "of this worktree", because another dashboard started from another cwd shows the same text. — Plan lines 225, 231-232. — Suggestion: start the 4911 server with the absolute worktree path (`node <worktree>/apps/dashboard/server.mjs`), as line 227 already does for the main checkout.
- [Consumers list] The consumer search command in Contracts also matches `skills/bootstrap-project/references/contracts.md:139`, which documents the `/api/state` fields `bootstrapRun` and `bootstrapHash`. The body does not change, so no edit is needed, but the list says it is the result of that grep. — Plan lines 46-53. — Suggestion: add "`skills/bootstrap-project/references/contracts.md`: a doc of two body fields; the body does not change".
- [Non-GET scope] `req.method !== 'GET'` also clears the cache for `HEAD` and `OPTIONS`. That is harmless, because a clear only costs one build, but the docs row says "Each request that is not a GET (for example a POST)". This is consistent. No change is needed. Only note that a client that sends HEAD in a loop turns the cache off.
- [Commands rule] AGENTS.md "Add it here (and to `.claude/settings.json` `permissions.allow`) in the same change". Step 12 moves the allow rule to the owner, by hand, under Open items. — Plan line 148; `AGENTS.md` Commands paragraph. — Suggestion: say that the owner adds it to the same PR before the merge, so the rule "same change" still holds. The claim "the headless run cannot write `.claude/`" is not verified here.
- [Tests 7 private-data check] The output check only looks for `demo-plan`. — Plan line 180. — Suggestion: also check that the output has no project name `demo` as a word and no part of the temp folder path (`tmp`).

### Edge cases the plan should address

- A request that comes 1 s or more after the start of a build that still runs: it shares the build (step 4), so it gets data from the build start. Lines 71/103/104 must say this, because the owner's one-poll rule is judged on it.
- `load` with `clients=0` or `seconds=0`: step 9 lists only a missing mode and a bad port as exit 2. `clients=0` ends with zero `/api/state` samples (exit 1), which is acceptable, but a usage error (exit 2) is clearer.
- The cache test's FAKE_GH_DIR folder must exist before the start (the fake `gh` does `appendFileSync` into it, `dashboard.test.mjs:32`). Step 8 says "an empty folder in the box", so make sure the step creates it.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`hasText`/`validationRounds`/`VALIDATOR_REPORT` `server.mjs:325-341`, `sessionIdCache` `:475-490`, `claudeCwds` `:384-393`, `pipelineLive` `:407-414`, `listPlans` `:505-572`, `fullState` `:574-602`, `enqueueMissingSummaries` `:648-662`, `WATCH_MS` `:1725`, `json` `:3235`, handler `:3251-3493`, `/api/state` route `:3268-3271`, POST block `:3394`, `--help` `DASH_WATCH_MS` `:82`; `start()` `dashboard.test.mjs:162-181`, docs-media test `:1642-1689`, `envFor()` `watcher.test.mjs:83-88`; `restart.mjs:48`; `docs-media.mjs:227`; docs Environment row `plans-dashboard.md:331`; roadmap Page line `roadmap.md:17`)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done; one doc-only match not listed, see above)
- [x] Wiring & registration matches the code (no new wiring; the `npm test` glob does not match `state-load.mjs`)
- [x] Scope stays inside the goal; no open decision is taken silently (1A, 2A respected; `roadmap.md:40` "None at the repo level")
- [x] Tests cover success / validation error / 401-403 / 404 / another scope: not applicable (local-only, no auth or tenants); the success, cache, clear and bad-argument cases are covered
- [x] Restart after dashboard changes respected (plan line 25)
- [x] No npm dependencies respected
- [x] Public repo: no private data respected (step 9 output, step 14, How to verify line 241)
- [x] Global rules affect every project respected (not touched)
- [x] Never stop processes by name respected (`ps` check before each `kill`; see the relative-path note)
- [x] Tests for logic changes respected
- [x] Docs: current state only respected (see the "keeps" wording note)
- [x] Contracts respected (no contract source; the changelog `kind`/`audience` values match `changelog-validate.mjs:33-34`)
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261126-125107-fast-api-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In Reference implementation (deviation "The cache window starts when the build starts") and Breaking changes (the `/api/state` bullet and the in-memory state bullet), say that a request gets a new build only when the build in use has ended and 1 s or more has passed since its start. A request that comes while the build still runs shares it, also when 1 s has passed (step 4: `!stateBuild.done || Date.now() - stateBuild.at < STATE_CACHE_MS`). (evidence: plan lines 71, 103, 104 against line 116)
2. In step 10, write the docs row and the roadmap sentence so that they say the time counts from the start of a build, not "keeps the answer for 1 s". (evidence: plan lines 144, 146, 116)
3. In step 8, write the PATH of the second server as `<box>/bin`, then `ghDir/bin`, then `process.env.PATH`, so that `sleep`, `node` and `lsof` are found. (evidence: plan line 126; apps/dashboard/test/dashboard.test.mjs:166; apps/dashboard/server.mjs:388)
4. In How to verify block 2, start the 4911 server with the absolute worktree path, so that the `ps -p <pid> -o command=` check can prove that the PID is the server of this run. (evidence: plan lines 225, 231-232)
5. In Contracts, add `skills/bootstrap-project/references/contracts.md` to the grep result as a doc of two body fields that needs no change. (evidence: skills/bootstrap-project/references/contracts.md:139)
6. In step 12, say that the owner adds the allow rule to the same PR before the merge (AGENTS.md: "in the same change"). (evidence: plan line 148; AGENTS.md Commands paragraph)
7. In Tests 7, also check that the `compare` output has no project name of the fixture and no temp folder path. (evidence: plan line 180)

ADD THESE EDGE CASES:
- A request that comes 1 s or more after the start of a build that still runs shares that build and gets data from its start.
- `load` with `clients=0` or `seconds=0` prints the usage and exits 2.
- Step 8 creates the `<box>/gh` folder before the server starts (the fake gh appends to `calls.log` in it).

Do not change anything the validation did not flag.
```
