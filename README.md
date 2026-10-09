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

Test one cycle:

```bash
npm run worker -- --once
```

Run continuously:

```bash
npm run worker
```

## Supported services

Text and chat:

- `text.ollama` — local Ollama model; no hosted-model account required.
- `text.openai.chatgpt` — ChatGPT through OpenAI Responses API.
- `text.openai.sol` — OpenAI Sol.
- `text.anthropic.fable` — Claude Fable through Anthropic Messages API.

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
WORKER_CAPABILITIES=text.ollama,text.openai.sol,text.anthropic.fable,video.higgsfield.seedance-2.5
```

The node never enables a hosted provider automatically. Every capability must be explicitly listed. Hosted OpenAI, Anthropic, and Higgsfield jobs can consume the worker owner's account credits even though the private beta does not charge requesters.

## Provider setup

### Ollama

Install Ollama, then:

```bash
ollama pull llama3.2
```

Keep `OLLAMA_BASE_URL=http://127.0.0.1:11434` and select the downloaded model with `OLLAMA_MODEL`.

### OpenAI

Set `OPENAI_API_KEY` in `.env`. The defaults can be overridden with `OPENAI_CHATGPT_MODEL`, `OPENAI_SOL_MODEL`, and `OPENAI_IMAGE_MODEL`. GPT Image uses OpenAI directly; it is not routed through Higgsfield.

### Anthropic

Set `ANTHROPIC_API_KEY` in `.env`. Override Fable with `ANTHROPIC_FABLE_MODEL` only when the current account uses a different exact model ID.

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
- The worker executes approved adapters only. It does not execute code contained in user prompts.
- Start with Ollama or one low-risk capability and expand only after a successful `--once` run.

## Development verification

```bash
npm test
npm run typecheck
npm run build
npm audit
```

MIT licensed.
