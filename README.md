# Worker Relay Node

Run an approved Worker Relay worker from a Windows PC, Linux computer, or VPS. The node polls the coordinator over outbound HTTPS, claims only jobs matching its explicit capability allowlist, runs the selected AI provider, and returns the result.

Coordinator: `https://api-production-cc9f.up.railway.app`

## Fast installation

```bash
git clone https://github.com/NachoLLMJS/worker-relay-node.git
cd worker-relay-node
npm ci
cp .env.example .env
```

On Windows PowerShell, use:

```powershell
git clone https://github.com/NachoLLMJS/worker-relay-node.git
cd worker-relay-node
npm ci
Copy-Item .env.example .env
```

Open `.env`, paste the private `WORKER_ACCESS_TOKEN` supplied by the network operator, choose `WORKER_CAPABILITIES`, and add only the provider credentials needed by those capabilities.

Anonymous public jobs are disabled by default. Set `ACCEPT_PUBLIC_REQUESTS=true` only if you deliberately want those jobs to consume the capabilities, subscriptions, API credits, and local compute enabled on this worker.

Test one cycle:

```bash
npm run worker -- --once
```

Run continuously with the local Worker Command Center:

```bash
npm run dashboard
```

The command opens `http://127.0.0.1:4317` automatically. The Hermes-inspired local dashboard shows coordinator connectivity, live worker events, enabled models, completed jobs, and controls for starting/stopping polling or accepting anonymous public requests. It binds to loopback only and never sends provider credentials to the browser.

For a headless VPS or terminal-only process, use `npm run worker` instead.

The Identity page reserves the future wallet/worker-verification flow, but wallet connection, payments, token fees, and rewards remain disabled until contracts and accounting are deployed and audited.

## Supported services

Text and chat:

- `text.ollama` — local Ollama model; no hosted-model account required.
- `text.openai.chatgpt` — ChatGPT through OpenAI Responses API.
- `text.openai.sol` — OpenAI Sol.
- `text.openai.codex` — Codex CLI using the operator's local ChatGPT subscription login.
- `text.anthropic.fable` — Claude Fable through Anthropic Messages API.
- `text.deepseek.flash` — DeepSeek Flash through the official DeepSeek Chat API.
- `text.deepseek.v4-pro` — DeepSeek V4 Pro through the official DeepSeek Chat API.

Images:

- `image.openai.gpt-image-2` — GPT Image through the native OpenAI Images API.
- `image.higgsfield.nano-banana-2`
- `image.higgsfield.seedream-5-pro`
- `image.higgsfield.recraft-4.1`

Video through Higgsfield:

- `video.higgsfield.seedance-2.5`
- `video.higgsfield.genjutsu`
- `video.higgsfield.kling-3-turbo`

Example capability list:

```text
WORKER_CAPABILITIES=text.ollama,text.openai.sol,text.anthropic.fable,text.deepseek.flash,video.higgsfield.seedance-2.5
```

The node never enables a hosted provider automatically. Every capability must be explicitly listed. API-backed jobs can consume provider credits, while Codex jobs consume the locally authenticated ChatGPT plan's allowance. Provider terms, plan limits, and eligibility remain the worker operator's responsibility.

## Provider setup

### Ollama

Install Ollama, then:

```bash
ollama pull llama3.2
```

Keep `OLLAMA_BASE_URL=http://127.0.0.1:11434` and select the downloaded model with `OLLAMA_MODEL`.

### OpenAI

Set `OPENAI_API_KEY` in `.env`. The defaults can be overridden with `OPENAI_CHATGPT_MODEL`, `OPENAI_SOL_MODEL`, and `OPENAI_IMAGE_MODEL`. GPT Image uses OpenAI directly; it is not routed through Higgsfield.

For subscription-backed text jobs, install Codex, run `codex login`, confirm `codex login status` reports a ChatGPT login, set `SUBSCRIPTION_CLI_ENABLED=true`, and enable `text.openai.codex`. Codex runs in an empty temporary directory with shell, browser, computer-use, app, skill, and workspace tools disabled. On Windows, OpenAI currently recommends using Codex inside WSL.

### Anthropic

Set `ANTHROPIC_API_KEY` in `.env`. The default API model is `claude-fable-5`; override it with `ANTHROPIC_FABLE_MODEL` only when the current Anthropic account uses a different exact model ID. Claude consumer subscriptions and Claude Code login sessions are not used as network worker credentials.

### DeepSeek

Set `DEEPSEEK_API_KEY` in `.env`. The worker uses the official `https://api.deepseek.com/chat/completions` endpoint. Enable `text.deepseek.flash` or `text.deepseek.v4-pro`; their defaults can be overridden with `DEEPSEEK_FLASH_MODEL` and `DEEPSEEK_PRO_MODEL` when DeepSeek publishes a new exact invocation ID.

### Higgsfield

Install the official Higgsfield CLI and authenticate it:

```bash
curl -fsSL https://raw.githubusercontent.com/higgsfield-ai/cli/main/install.sh | sh
higgsfield auth login
higgsfield account status
```

Then set `HIGGSFIELD_ENABLED=true`. Genjutsu's invocation ID is discovered from the current authenticated CLI catalog and placed in `HIGGSFIELD_GENJUTSU_MODEL_ID`; the repository intentionally does not guess or hardcode an unverified ID.

## Documentation

- `docs/AI_AGENT_INSTALL.md` — hand this directly to ChatGPT, Claude, Hermes, Codex, or another coding agent.
- `docs/WINDOWS.md` — Windows setup and continuous operation.
- `docs/UBUNTU_VPS.md` — Ubuntu VPS and systemd service.
- `docs/CONFIGURATION.md` — all environment variables and capabilities.
- `SECURITY.md` — security and cost boundary.

## Safety boundary

- No inbound port is required.
- Never commit `.env` or paste credentials into chat, issues, screenshots, or logs.
- Use a dedicated OS account and a machine without wallets, SSH keys, unrelated repositories, or personal files.
- The worker executes approved adapters only. Codex subscription prompts are text-only: requester prompts are sent through stdin, sensitive worker environment variables are removed, and code/shell/file/browser tools are disabled. Anthropic jobs use `ANTHROPIC_API_KEY` through the Messages API.
- Start with Ollama or one low-risk capability and expand only after a successful `--once` run.

## Development verification

```bash
npm test
npm run typecheck
npm run build
npm audit
```

MIT licensed.
