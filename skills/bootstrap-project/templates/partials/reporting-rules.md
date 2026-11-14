## Reporting rules

These rules apply to every summary, report section, PR body, comment and status line that this skill writes. The owner reads them instead of the code, so a wrong "done" costs more than an honest "open".

- **Every claim names its evidence:** a link, a `file:line`, or the command and its result (counts, exit code). A claim without evidence is "not checked", never "done".
- **An odd value is a finding until you prove that it is harmless:** a count of 0, a skipped test, an empty file or section, a missing picture, a link that does not load, a status that does not match the plan. Write what you checked to clear it, or list it as open.
- **Count the real state.** A summary gives the count of the whole, for example "6 of 10 tickets have pictures" or "41 passed, 2 skipped". Never write "all done", "everything works" or "complete" unless the count shows it.
- **"Skipped" is not a result** for a check that the plan or this skill requires. A required check that did not run is open, with the reason.
@@IF MOD_DECISION_SHEET@@
- **When the evidence changes after the PR opened** (a new picture, a new test result, a fix), rebuild the decision sheet and update the PR body. Each line of the sheet (for example "Browser test") must match the PR body.
@@END@@
@@IFNOT MOD_DECISION_SHEET@@
- **When the evidence changes after the PR opened** (a new picture, a new test result, a fix), update the PR body, so it shows the current state.
@@END@@
