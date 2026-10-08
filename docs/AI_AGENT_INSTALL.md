# Instructions for an AI installation agent

Your task is to install and verify this Worker Relay node on the current computer or VPS. Do not expose, print, summarize, or commit any credential value.

## Required information

Ask the human operator for only these missing items:

1. The private `WORKER_ACCESS_TOKEN` through a secure local secret-entry method, not normal chat.
2. A unique `WORKER_NAME` containing letters, numbers, `_`, or `-`.
3. Which capability IDs the operator explicitly approves.
4. Provider credentials only for approved hosted capabilities.

The coordinator is:

```text
https://api-production-cc9f.up.railway.app
```

## Installation procedure

1. Verify Node.js 22 or newer and Git are installed.
2. Clone `https://github.com/NachoLLMJS/worker-relay-node.git`.
3. Run `npm ci`.
4. Copy `.env.example` to `.env` without deleting the template.
5. Ensure `.env` remains ignored by Git.
6. Put the coordinator URL, worker name, worker access credential, and exact approved capabilities in `.env`.
7. Configure only the selected provider:
   - Ollama: install it, pull the approved model, and verify its local API.
   - OpenAI: add the credential locally and never echo it.
   - Anthropic: add the credential locally and never echo it.
   - Higgsfield: install the official CLI, authenticate interactively, verify `higgsfield account status`, and set `HIGGSFIELD_ENABLED=true`.
8. Run `npm test`, `npm run typecheck`, `npm run build`, and `npm audit`.
9. Run exactly one coordinator cycle with `npm run worker -- --once`.
10. Report only sanitized status: installed/not installed, tests passed/failed, capability IDs, and whether the one-cycle result was idle or completed.
11. Enable continuous operation only after the one-cycle test succeeds.

## Fail-closed rules

- Never invent or normalize a capability ID, model ID, credential, coordinator URL, or worker name.
- Never enable a capability not explicitly approved by the human.
- Never put a provider credential in a command argument, Git remote, issue, log, or response.
- Never open an inbound firewall port for this worker.
- Never run the worker as root or Administrator for continuous operation.
- Never run it on a machine containing wallets, signing keys, personal documents, or unrelated production credentials.
- Stop if TLS validation fails, the coordinator origin differs, provider authentication is rejected, or the repository has unexpected uncommitted executable changes.
- Higgsfield generation can consume credits. Require explicit `HIGGSFIELD_ENABLED=true` plus explicit Higgsfield capability IDs.
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
