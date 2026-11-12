# claude-config (this repo only)

- **Apply dashboard changes to plans.test.** After editing `scripts/plans-dashboard.mjs`, the page files in `scripts/plans-dashboard/` (`page.html`, `app.css`, `app.js`), or anything it imports, restart the login service so https://plans.test serves the new code: `npm run restart` (chats keep running through it: each chat's `claude` runs under `scripts/chat-relay.mjs`, and the new server connects to it again). Then tell me to reload the page.
