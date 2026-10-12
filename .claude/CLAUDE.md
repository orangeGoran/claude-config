# claude-config (this repo only)

- **Apply dashboard changes to plans.test.** After editing `scripts/plans-dashboard.mjs` (or anything it imports), restart the login service so https://plans.test serves the new code: `launchctl kickstart -k gui/$(id -u)/com.plans-dashboard`. Then tell me to reload the page.
