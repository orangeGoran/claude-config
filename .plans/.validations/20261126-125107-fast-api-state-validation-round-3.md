# Validation round 3: 20261126-125107-fast-api-state.md

- Claude: ON (`-validation-claude-3.md`, APPROVE WITH CHANGES, no blocking issue)
- Codex: ON (`-validation-codex-3.md`, NEEDS REWORK)
- Regressions from round 2 (diff `pre-round-2` → `pre-round-3`): none found in the citation, cross-reference and propagation checks. The round-1 choice "cache window from the build end" (round 1, F10) did not hold against the owner's one-poll rule after round 2 moved the default to 1 s; F1 below reverses it with new evidence.

## Findings

| ID | Validator | Finding | Verdict | Evidence | Plan change |
| --- | --- | --- | --- | --- | --- |
| F1 | Codex B1 | A window from the build end lets a change wait for the rest of the build plus 1 s, which is longer than one 1 s poll | VALID (new evidence: the 1 s default from round 2) | The owner's rule "never stale longer than one poll"; the 1 s fast poll in `app.js` | Window from the build start (`at`); the in-flight build still holds the load at one build at a time: Contracts, Reference (Mirror, deviation), Breaking changes, step 4 |
| F2 | Codex B2 | `body()` never settles when the client aborts, so the `finally` never runs | INVALID | With no body, the POST makes no change; the cache was already cleared at the start of the request (step 6) | No change |
| F3 | Codex B3 | A free port before the start does not prove whose PID is on it later | PARTIALLY VALID | A background start gives no PID; a `ps -p <pid> -o command=` check shows the owner of the PID | Hard rules, How to verify (`ps` check before each `kill`, `/api/usage` start check) |
| F4 | Codex B4 | `compare` paths and the run report can carry project names and paths into a PR of a public repo | PARTIALLY VALID | `/api/state` rows hold `key`, `title`, `root`; the run report is gitignored, but the PR is public | Step 9 (field names and counts only, `--verbose` for local paths), step 14 (numbers only), Hard rules, How to verify, Tests 7 |
| F5 | Codex S1 | Test a disconnect during an async action and during a body read | RAISED BEFORE (round 2, F1: Harness constraints) | No new evidence | No change |
| F6 | Codex S2 | The two measurement servers both take the QA reports port 4898 | VALID | `QA_REPORTS_PORT` default 4898 in `server.mjs` | How to verify (4921, 4922, checked free) |
| F7 | Claude 1 | The fake `pgrep` must be executable, or the real one runs and the test still passes | VALID | Existing fakes use `{ mode: 0o755 }` in `before()` | Step 8 |
| F8 | Claude 2 | The second server needs its own `FAKE_GH_DIR` | VALID | The fake `gh` reads `FAKE_GH_DIR`; other tests read the shared `calls.log` | Step 8 |
| F9 | Claude 3 | In-memory state (launcher exit, chat flags, summary queue) clears no cache | VALID (document) | `server.mjs` launch exit handler, `chats` | Breaking changes |
| F10 | Claude 4 | The docs row says "Each POST", step 6 says each non-GET | VALID | Step 6 and step 10 | Step 10 |
| F11 | Claude 5 | `load` does not say how a run ends; `execFileSync` needs a timeout | VALID | Step 9, Tests 7 | Step 9 (end rule), Tests 7 (`timeout: 60000`) |
| F12 | Claude 6 | The `--max-state-ms=0` case can fail on the usage limit instead | VALID | Default `--max-usage-ms=100` | Tests 7 |

Found by one validator only: F1, F2, F3, F4, F5, F6 (Codex); F7–F12 (Claude). Raised before: F5.

## Validation response

```text
Round 3 of .plans/20261126-125107-fast-api-state.md: 12 findings. 10 applied, F2 rejected (an aborted body makes no change, and the cache is cleared at the request start), F5 raised before (round 2, F1). Main changes: the cache window starts at the build start again, so a change shows within one 1 s poll; ps checks before each kill and separate QA ports for the measurement servers; state-load.mjs prints only numbers and field names; executable fake pgrep and own FAKE_GH_DIR for the cache test; the load run's end rule and test timeouts.
```
