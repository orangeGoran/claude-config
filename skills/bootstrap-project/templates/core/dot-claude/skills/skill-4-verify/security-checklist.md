# Security pass — checklist for the security subagent

`/skill-4-verify` Step 2 gives this file to a read-only subagent. The subagent reads the **Rules** section, the **Checklists** that the parent names, and the **Output** section. It reviews only the changed files and the code that they call.

The candidate gate and the three verdicts follow the Cloudflare security-audit skill (https://github.com/cloudflare/security-audit-skill, MIT).

## Rules

### The candidate gate

A finding is real only when you can name all six items:

1. **Attacker** — the principal with less trust: a user of another tenant or account, a user without the right, a caller who is not signed in, the author of an uploaded file or text.
2. **Input** — the request, body field, path id, file or text that the attacker controls.
3. **Control** — the guard, scope filter, permission check or validation that must stop the attacker. Cite its `file:line`.
4. **Gap** — the path that skips the control or disagrees with it. Cite each `file:line` from the entry point to the sink.
5. **Victim** — the other principal, tenant, account or shared resource.
6. **Result** — the read, write or action that the attacker gets.

When you cannot name the result, it is not a finding. These are **not** findings:

- A missing best practice with no victim (a missing header, a missing rate limit, "add defense in depth").
- An action that a user does to their own data with their own rights.
- Prompt injection alone, without a code path that gives the injected text more authority or the data of another user.
- A claim that another layer blocks the attack, before you read that layer. Read the global guards and middleware first, and quote them.

### Three verdicts

- **confirmed** — the trace in the source is complete, and no visible layer stops it. Give a severity and the smallest fix at the last trusted decision point.
- **needs_validation** — the deciding fact is outside the repo: a proxy, a load balancer, a bucket policy, a cloud setting, a value in a server `.env` file, the behavior of an external service. Name the exact missing fact and the person or check that can answer it. Do **not** guess, and do **not** give a severity.
- **rejected** — the source disproves the claim. Do not report it.

### Severity scale (confirmed only)

- **critical** — a caller who is not signed in gets code execution, full database access, or the takeover of any account.
- **high** — a full bypass of a real control: an auth bypass, a read or write in another tenant or account, a right that the role does not give, a token that stays valid after revocation.
- **medium** — a real boundary violation with a small blast radius or unusual preconditions.
- **low** — the disclosure of internals that are not secret, or an effect that needs much effort for little gain.

The test for high or medium: does the result fully defeat the control, or only make it weaker? When you cannot state the damage, the severity is lower.

## Checklists

### A. Data isolation

Use it when the change touches a query, a repository, a cache key, a background job, an export, a delete or a purge.

- An owner column (tenant, account, user) is not isolation by itself. Find the filter that uses the owner of the request on **each** read and write path: list, count, get by id, update, delete, bulk.
- A path id resolves inside its parent resource. A body id that points to another table is checked against the scope of the request.
- A cache key, an event channel, a storage object key and a job id include the owner when two owners can produce the same value.
- A background job has no request context. The job payload carries the owner, and the job scopes every query with it.
- Derived copies keep the scope of the source: search indexes, embeddings, exports, translations.
- A delete or a purge reaches every copy. A queued job or a retry does not create the data again.
- A count, a filter, a unique constraint or an error message does not tell owner A that a record of owner B exists.

### B. AI and model output

Use it when the change touches a prompt, a retrieval query, or code that acts on model output.

- Retrieval for user X returns only content that user X can read. The filter is in the retrieval query itself.
- Text from one principal (an uploaded file, a comment, a record field) can enter the prompt of another principal. Then find what that prompt can do: which tools, which writes, which data.
- Model output is untrusted input. Trace each field of a parsed model result to its sink: a database write, an id lookup, an email, an HTML render. An id from the model is checked against the scope of the requester before use.
- A long-running model job checks the access of the requester again when it starts, and its result is returned only to its owner.
- A prompt does not contain secrets or the data of another owner.
- A loop of model calls or tool calls has a limit per request.

### C. Authentication and access

Use it when the change touches sign-in, sessions, tokens, cookies, an access check, a middleware, or a rate limit.

- Every new entry point has the correct access check. A public entry point does its own check in the code it calls. Quote that check.
- A token is verified for signature, type and expiry before its claims are used.
- Sign-out, a password change and a disabled account revoke the tokens and sessions of that user.
- Invite, reset and one-time tokens are random, bound to one user and one action, expire, and work one time. They are stored as a hash.
- A state change that a cookie authenticates checks a CSRF token. When the CSRF check lives in the shared HTTP setup, a route or a test app that skips that setup also skips the check: a test that passes there proves nothing about CSRF.
- A link in an email comes from config, never from a `Host`, `X-Forwarded-*` or `Origin` header or a body field that an attacker can choose.
- A limit per IP address depends on the proxy setup. The real proxy count is outside the repo, so a claim about it is `needs_validation`.

### D. Injection and files

Use it when the change builds a shell command, a raw query, a file path, a URL that the server fetches, or HTML.

- A value from the request goes into a raw query only as a bound parameter.
- A value from the request goes into a shell command only as a separate argument, never through a shell string.
- A file path from the request cannot leave its base folder (`..`, an absolute path, a symbolic link).
- A URL that the server fetches cannot point to an internal address when a user chooses it.
- HTML output escapes user text.

## Output

Return one block, with no other text:

```
SECURITY PASS — <n> confirmed, <n> needs_validation, <n> rejected
Checklists used: <A/B/C/D>
Files reviewed: <list>

CONFIRMED
1. [<severity>] <title>
   Attacker → Victim: <who> → <whom>
   Trace: <entry file:line> → <file:line> → <sink file:line>
   Control skipped: <file:line of the control that should apply>
   Result: <what the attacker gets>
   Fix: <smallest change, file:line> + <regression test to add>

NEEDS VALIDATION
1. <title>
   Trace: <file:line> → <file:line>
   Missing fact: <the exact fact outside the repo>
   Who can answer: <the person or the check>

REJECTED (one line each)
- <claim> — disproved by <file:line>
```

When nothing passes the gate, write `SECURITY PASS — clean` and list the files and checklists that you reviewed.
