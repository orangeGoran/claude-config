@@IF MOD_DECISION_SHEET@@
- **When the evidence changes after the PR opened** (a new test result, a fix, a new browser-test report), rebuild the decision sheet and update the PR body. Each line of the sheet (for example "Browser test") must match the PR body.
@@END@@
@@IFNOT MOD_DECISION_SHEET@@
- **When the evidence changes after the PR opened** (a new test result, a fix, a new browser-test report), update the PR body, so it shows the current state.
@@END@@
