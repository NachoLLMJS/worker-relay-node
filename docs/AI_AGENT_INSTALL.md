# Instructions for an AI installation agent

Your task is to install and verify this Worker Relay node on the current computer or VPS. Do not expose, print, summarize, or commit any credential value.

## Required information

Ask the human operator for only these missing items:

1. The assigned `workerId` and private `WORKER_ACCESS_TOKEN` pair through a secure local secret-entry method, not normal chat.
2. Use the assigned `workerId` exactly as `WORKER_NAME`; do not invent or rename it. It contains letters, numbers, `_`, or `-`.
3. Which capability IDs the operator explicitly approves.
4. Provider credentials only for approved hosted capabilities.

The coordinator is:

```text
https://api-production-cc9f.up.railway.app
```

## Installation procedure

1. Verify Node.js 22 or newer and Git are installed.
2. Clone `https://github.com/NachoLLMJS/worker-relay-node.git`.
3. Run `npm ci`; if the current npm/platform rejects optional cross-platform packages, run `npm install --no-package-lock` as the fallback and report that fallback.
4. Start the local dashboard with `npm run dashboard`.
5. The dashboard creates `.env` from `.env.example` if missing and opens `http://127.0.0.1:4317`.
6. Direct the human operator to the Configuration page for the few values that cannot be invented: the assigned worker token, its matching worker ID as the exact worker name, provider credentials, and explicit Codex/Higgsfield spending opt-ins. Do not ask repeated chat questions when the dashboard can collect the value locally.
7. The Models page is read-only. Saving configuration and starting the worker auto-detect ready capabilities and persist the generated compatibility list.
8. Configure only selected providers:
   - Ollama: install it, pull the approved model, and verify its local API.
   - OpenAI: add the credential in the dashboard or `.env`; never echo it.
   - Anthropic: add `ANTHROPIC_API_KEY` locally and never echo it. Do not configure a Claude consumer subscription or Claude Code login as a worker credential.
   - Codex subscription: install the official Codex CLI, have the human complete `codex login`, verify `codex login status`, and set `SUBSCRIPTION_CLI_ENABLED=true` only with operator approval.
   - DeepSeek: add `DEEPSEEK_API_KEY` locally and never echo the credential; both catalog services are detected automatically.
   - Higgsfield: install the official CLI, authenticate interactively, verify `higgsfield account status`, and set `HIGGSFIELD_ENABLED=true`.
9. Run `npm test`, `npm run typecheck`, `npm run build`, and `npm audit`.
10. Run exactly one coordinator cycle with `npm run worker -- --once` after the token is saved.
11. Report only sanitized status: installed/not installed, tests passed/failed, capability IDs, and whether the one-cycle result was idle or completed.
12. Enable continuous operation with the dashboard Start worker control only after the one-cycle test succeeds, unless the operator explicitly wants dashboard-managed startup first.

## Fail-closed rules

- Never invent or normalize a capability ID, model ID, credential, coordinator URL, or worker name.
- Never configure a billable provider or subscription opt-in not explicitly approved by the human.
- Never put a provider credential in a command argument, Git remote, issue, log, or response.
- Never open an inbound firewall port for this worker.
- Never run the worker as root or Administrator for continuous operation.
- Never run it on a machine containing wallets, signing keys, personal documents, or unrelated production credentials.
- Never copy OAuth tokens, browser cookies, CLI credential files, or subscription sessions into `.env` or chat. The human authenticates directly with the official CLI.
- Set `SUBSCRIPTION_CLI_ENABLED=true` only after the operator explicitly approves ChatGPT plan usage and Codex reports a valid local login.
- Stop if TLS validation fails, the coordinator origin differs, provider authentication is rejected, or the repository has unexpected uncommitted executable changes.
- Higgsfield generation can consume credits. Require explicit `HIGGSFIELD_ENABLED=true`; account readiness and service availability are then detected automatically.
- For Genjutsu, discover the exact current model ID from the authenticated Higgsfield model list. Do not guess it.

## Verification output format

```text
Worker Relay installation: PASS|FAIL
Node version: <version>
Repository commit: <sha>
Approved capabilities: <ids only>
Tests: PASS|FAIL
Typecheck: PASS|FAIL
Build: PASS|FAIL
Audit: PASS|FAIL
One-cycle result: idle|completed|failed
Continuous service: enabled|not enabled
```

Do not include secret values.
