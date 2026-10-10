# Security policy

## Supported use

This repository is for a private, invite-only Worker Relay beta. Report vulnerabilities privately to the repository owner rather than opening a public issue containing exploit details or credentials.

## Trust boundary

- The coordinator sends text prompts and either one service ID or a service ID list.
- The worker claims only service IDs currently verified by automatic local detection. The persisted `WORKER_CAPABILITIES` value is generated, not operator-selected.
- Anonymous public jobs are rejected unless the operator explicitly sets `ACCEPT_PUBLIC_REQUESTS=true`.
- Provider credentials remain on the worker machine.
- The worker receives no PostgreSQL credentials, Railway administration credential, wallet key, or contract key.
- The node makes outbound HTTPS requests and requires no inbound port.
- Prompts are data. The worker does not execute shell commands or arbitrary code from prompts.
- The Codex subscription adapter runs in a new empty temporary directory for every job, receives prompts through stdin, inherits only an environment allowlist, and has command/code/file/browser tools disabled. Anthropic jobs use an API key through the Messages API; Claude consumer subscription sessions are not supported.
- Higgsfield is invoked with `spawn(..., { shell: false })`; prompt text is passed as one argument rather than interpreted by a shell.

## Operator rules

1. Use a dedicated OS account and preferably a dedicated machine or VPS.
2. Keep wallets, seed phrases, SSH keys, personal documents, and unrelated repositories off that machine.
3. Set restrictive permissions on `.env`.
4. Never commit or share `.env`.
5. Configure only providers the operator intends to fund; the worker auto-detects every ready service for those configured providers.
6. Treat API capabilities as potentially billable and subscription CLI capabilities as consuming plan allowance and rate limits.
7. Configure provider-side budgets, alerts, and rate limits before continuous operation.
8. Test one job with `--once` before enabling a background service.
9. Stop immediately if the coordinator origin or TLS identity changes unexpectedly.
10. Update with `git pull --ff-only`, then rerun tests and build before restarting.

## Current limitations

- The private beta uses a shared worker bearer credential rather than per-device cryptographic enrollment.
- A worker assigned a prompt can read that prompt.
- Generated media URLs may be hosted by the selected provider and may expire.
- The coordinator does not currently meter provider cost or reimburse worker owners.
- Do not process secrets, regulated data, confidential source repositories, or personal documents.
- Codex subscription support is limited to text responses. It does not grant requesters access to the operator's filesystem or an interactive coding workspace.
