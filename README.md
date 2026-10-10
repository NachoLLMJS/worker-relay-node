# Worker Relay Node

Run an approved Worker Relay worker from a Windows PC, Linux computer, or VPS. The node auto-detects ready local providers, polls the coordinator over outbound HTTPS, claims only matching jobs, runs every service selected by the lease, and returns a single or composite result.

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

For the easiest setup, run the local Worker Command Center first:

```bash
npm run dashboard
```

The command creates `.env` from `.env.example` if needed, enrolls a private worker identity automatically, and opens `http://127.0.0.1:4317`. No invitation code or manually issued worker token is required. Set a friendly `WORKER_NAME`, save provider credentials/model preferences, enable optional CLI providers, and start/stop polling. The generated `WORKER_ID` and token stay in the local `.env`; capabilities are detected automatically and cannot be selected manually.

Anonymous public jobs are disabled by default. Enable `ACCEPT_PUBLIC_REQUESTS` only if you deliberately want those jobs to consume the capabilities, subscriptions, API credits, and local compute enabled on this worker.

After saving configuration, test one cycle from the terminal if desired:

```bash
npm run worker -- --once
```

For a headless VPS or terminal-only process, edit `.env` directly and use `npm run worker` instead.

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

Capabilities are read-only detection results in the dashboard. Ollama is available only when `/api/tags` responds with an installed model; hosted API services require their locally stored credentials to pass an authenticated models-endpoint probe; Codex requires explicit subscription opt-in plus a valid ChatGPT login; Higgsfield requires explicit opt-in plus a successful CLI account probe. `WORKER_CAPABILITIES` remains as a generated compatibility field and is overwritten by detection. API-backed jobs can consume provider credits, while Codex jobs consume the locally authenticated ChatGPT plan's allowance.

## Provider setup

### Ollama

Install Ollama, then:

```bash
ollama pull llama3.2
```

Keep `OLLAMA_BASE_URL=http://127.0.0.1:11434`. If `OLLAMA_MODEL` is not installed, detection selects and persists the first model returned by Ollama.

### OpenAI

Set `OPENAI_API_KEY` in `.env`. The defaults can be overridden with `OPENAI_CHATGPT_MODEL`, `OPENAI_SOL_MODEL`, and `OPENAI_IMAGE_MODEL`. GPT Image uses OpenAI directly; it is not routed through Higgsfield.

For subscription-backed text jobs, install Codex, run `codex login`, confirm `codex login status` reports a ChatGPT login, and set `SUBSCRIPTION_CLI_ENABLED=true`. Keep the portable default `CODEX_COMMAND=codex`: the worker auto-detects Codex from `PATH` and common per-user, Hermes, and npm-prefix locations, so usernames and home directories do not need to be hard-coded. An absolute command path remains available only as a manual override. Codex runs in an empty temporary directory with shell, browser, computer-use, app, skill, and workspace tools disabled. On Windows, OpenAI currently recommends using Codex inside WSL.

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
