**Validation round:** 3

## Plan validation: 20261126-125107-fast-api-state.md

**Verdict:** APPROVE WITH CHANGES

TLDR: The round-2 changes hold. The `finally` on the handler's `try` covers every non-GET route. The fake `pgrep` on the test server's PATH reaches `pipelineLive()`. Tests 4, 5 and 7 fail without the feature. No blocking issue is left. Six small gaps remain: the exec bit of the fake `pgrep`, `FAKE_GH_DIR` for the second server, in-memory changes that are not cleared, the doc row wording, the end of a `load` run, and a test that can pass for the wrong reason.

### Focus checks asked for in this round

- **`finally` covers every non-GET route: confirmed.**
  - The handler is `apps/dashboard/server.mjs:3251-3493`. The `try` starts at `:3261` and its `catch` is at `:3490`.
  - Only these run before the `try`: the loopback 403 (`:3252-3254`), the `crossSiteReason` 403 (`:3255-3256`) and the URL parse (`:3257-3260`). None of them changes state.
  - Every POST route is inside the `if (req.method === 'POST')` block (`:3394-3488`), inside the `try`. A PUT or DELETE falls through to the 404 at `:3489`, also inside the `try`.
  - The server has no `upgrade` or second `request` listener (`server.on(` gives only `:3827`, `'error'`).
  - The `reportServer` POSTs (`/reveal` `:3781`, `/copy-file` `:3795`) are on the other port (4898) and change no dashboard state.
  - `changes` is declared before the `try`, so the `finally` can read it.
- **The fake `pgrep` reaches `pipelineLive()`: confirmed.**
  - `execFile('pgrep', …)` at `:411` gives no `env` option, so the child gets the server's `process.env.PATH`, with `<box>/bin` first.
  - The fake exits 1, so the callback also runs `chatActiveIn()` → `claudeProcessCwds()` (`:385-393`). That is a real `lsof` with `execFileSync`. The fake does not touch it, and it is cached for 4 s. No break.
  - The other `pgrep` caller is `:2442` (`pgrep -lP`, the chat shell check). The cache test opens no chat, so it never runs. Even if it ran, a fake with no output gives `false`.
  - `gh`, `bash` and `claude` children use `ENV` (`:149-159`), whose PATH starts with `process.env.PATH`. So they also find `<box>/bin` first and then `ghDir/bin`. The fake `gh` and the fake `claude` are found, and the real ones are not.
  - The main test server (`start()`, `dashboard.test.mjs:166`) does not get `<box>/bin`, so its pgrep is real, as today.
- **New tests fail without the feature: confirmed for tests 4, 5 and 7.**
  - Test 4, sub-case 1: today there is no `X-State-Build` header, so `/^\d+$/` fails. With a cache that does not share a running build, the values are different.
  - Test 4, sub-case 2: with no result cache, `cache-two` is in the list.
  - Test 4, sub-case 3: with no clear on POST, `cache-two` is missing for 60 s.
  - Test 5: there is no header today.
  - Test 7: the script does not exist today.
  - Tests 1–3 pass on today's code. They guard against a cache with wrong keys. Round 1 settled this (F17), so it is not raised again.

### Blocking issues

None.

### Non-blocking concerns

- [Tests] Step 8 does not say that the fake `pgrep` must be executable — evidence: the existing fakes are written with `{ mode: 0o755 }` (`apps/dashboard/test/dashboard.test.mjs:203-204`). Without the exec bit, `execvp` skips the file and runs the real `pgrep`. The 0.5 s wait is then gone, and test 4 depends on timing again but still passes, so nobody notices. — Suggestion: write `<box>/bin/pgrep` with `{ mode: 0o755 }`, the same as `FAKE_GH`.
- [Tests] The env that step 8 copies from the docs-media test (`dashboard.test.mjs:1670-1672`) has no `FAKE_GH_DIR`. Step 8 still puts `ghDir/bin` on the PATH. The fake `gh` then runs `path.join(undefined, 'calls.log')` and throws (`dashboard.test.mjs:31-32`) on each `refreshPrList()` that `prsFor()` starts (`server.mjs:1457-1460`). The test still passes, but each build ends with a crashed child process and stderr noise. Do not use the shared `ghDir` for this value: other tests read its `calls.log` (`dashboard.test.mjs:1238-1245`). — Suggestion: set `FAKE_GH_DIR` to a folder in the box, for example `<box>/gh`.
- [Contracts / Breaking changes] Breaking changes names only file changes and non-GET requests. Some state that `/api/state` shows changes in memory, with no request:
  - the `child.on('exit')` callback of `runLauncher()` sets `launches` to `failed` or deletes the entry (`server.mjs:686-699`);
  - the chat flags `busy`, `bg` and `waits` change (`server.mjs:539-540`);
  - the summary queue changes.
  These changes clear no cache. They show at most one build plus `STATE_CACHE_MS` later, which is the same bound as a file change. — Suggestion: write "a file change or an in-memory change (a launcher that exits, a chat turn)" in Breaking changes, so code review does not read it as a missed invalidation.
- [Docs] The row in step 10 says "Each POST clears the answer". Step 6 clears the answer on every request that is not a GET. — Suggestion: write "Each request that is not a GET clears the answer", or limit step 6 to POST. Either works, but the doc and the code must say the same thing.
- [Steps / Tests] Step 9 `load` does not say how a run ends. A loop "waits until 5 s have passed since its last start". With `seconds=1` or `3` (test 7), the plan does not say whether the script waits out those 5 s or stops at `seconds`. It also does not say whether a loop can start a new request after the end. — Suggestion: add "No request starts after `seconds`. The script ends when the requests that run have ended." Also give each `execFileSync` in test 7 a `timeout` (for example 60000), so a hang fails the test and does not block `npm test`.
- [Tests] Test 7, case `load <port> 1 1 --max-state-ms=0`, also runs with the default `--max-usage-ms=100`. So an exit 1 can come from the usage limit and not from the state limit. — Suggestion: also pass `--max-usage-ms=60000`, and check that the output names `/api/state` as the endpoint that failed.

### Edge cases the plan should address

- A launch that fails after its POST answered (`runLauncher` exit callback, `server.mjs:686-699`). It shows one build plus 1 s later. That is acceptable, but write it down (see above).
- A `HEAD` or `OPTIONS` request on `/api/state` counts as a change and clears the cache. This is harmless, and no client sends one today. One sentence in step 6 is enough.
- `docs-media.mjs` runs with the default 1 s cache. Its page clicks are POSTs, which clear the cache, and it waits 500 ms or more before each screenshot (`scripts/docs-media.mjs:288`). This is fine. When a frame shows old data, the cache is the first suspect.

### Checklist

- [x] All referenced files, lines, sections and symbols exist as stated (`VALIDATOR_REPORT`/`hasText`/`validationRounds` `server.mjs:329-341`, `sessionIdCache` `:476`, `claudeCwds` `:384`, `pipelineLive` `:407`, `fullState` `:574`, `enqueueMissingSummaries` `:648`, handler `:3251`, `json` `:3235`, `WATCH_MS` `:1725`, `--help` `DASH_WATCH_MS` `:82`, `start()` `dashboard.test.mjs:162`, docs-media test `:1642`, `envFor` `watcher.test.mjs:83`, `restart.mjs:48`, `docs-media.mjs:227`, roadmap Page line `docs/roadmap.md:17`, Environment row `docs/plans-dashboard.md:331`, the allow-rule form `.claude/settings.json:23`, `performance` kind `changelog-validate.mjs:33`)
- [x] Reference implementation mirrored, deviations justified
- [x] Breaking changes for changed symbols listed (consumer search done; `skills/bootstrap-project/references/contracts.md:139` only documents body fields, and the body does not change)
- [x] Wiring & registration matches the code (no new wiring)
- [x] Scope stays inside the goal; no open decision is taken silently (1A and 2A respected)
- [x] Tests cover the endpoint (local only, no auth, roles or tenants; the reason is given)
- [x] Restart after dashboard changes respected
- [x] No npm dependencies respected
- [x] Public repo: no private data respected
- [x] Global rules affect every project respected
- [x] Never stop processes by name respected
- [x] Tests for logic changes respected
- [x] Docs: current state only respected (one wording mismatch, non-blocking)
- [x] Contracts respected
- [x] "How to verify" commands are real and can fail

```
Update the plan at .plans/20261126-125107-fast-api-state.md. A validation found the issues below. Fix every blocking item and keep the same sections.

BLOCKING:
None.

SHOULD FIX:
1. In step 8, write the fake pgrep with { mode: 0o755 }, the same as FAKE_GH. Without the exec bit, the real pgrep runs and the 0.5 s wait is silently gone. (evidence: apps/dashboard/test/dashboard.test.mjs:203-204)
2. In step 8, add FAKE_GH_DIR to the second server's env. Point it to a folder in the box, not the shared ghDir. Without it, the fake gh throws on path.join(undefined). The shared ghDir has a calls.log that other tests read. (evidence: apps/dashboard/test/dashboard.test.mjs:31-32, :1238-1245, :1670-1672)
3. In Breaking changes, say that in-memory changes with no request also show at most one build plus STATE_CACHE_MS later: a launcher that exits, a chat turn, the summary queue. (evidence: apps/dashboard/server.mjs:686-699, :539-540)
4. Make the docs row in step 10 match step 6: "Each request that is not a GET clears the answer" (or limit step 6 to POST). (evidence: plan step 6 vs step 10)
5. In step 9, say how a load run ends: no request starts after `seconds`, and the script ends when the requests that run have ended. In test 7, give each execFileSync a timeout (for example 60000). (evidence: plan step 9 "waits until 5 s have passed since its last start")
6. In test 7, run the `--max-state-ms=0` case with `--max-usage-ms=60000` too, and check that the output names /api/state as the endpoint that failed. Then the usage limit cannot make the case pass. (evidence: plan Tests 7)

ADD THESE EDGE CASES:
- A HEAD or OPTIONS request also clears the cache (harmless; one sentence in step 6).
- A launch that fails after its POST answered shows one build plus 1 s later.

Do not change anything the validation did not flag.
```
