# Configuration reference

The worker loads `.env` from the repository root through `dotenv`. `.env` is ignored by Git. Never commit it.

## Coordinator

- `COORDINATOR_URL` — exact HTTPS Worker Relay coordinator URL.
- `WORKER_ACCESS_TOKEN` — private network credential supplied by the operator.
- `WORKER_NAME` — unique ID matching `[A-Za-z0-9_-]{3,64}`.
- `WORKER_CAPABILITIES` — comma-separated explicit allowlist.
- `ACCEPT_PUBLIC_REQUESTS` — defaults to `false`; set to `true` only to let anonymous requests use this worker's enabled capabilities.

## Ollama

- `OLLAMA_BASE_URL` — default `http://127.0.0.1:11434`.
- `OLLAMA_MODEL` — default `llama3.2`; it must already be downloaded.

Capability: `text.ollama`.

## OpenAI

- `OPENAI_API_KEY` — required for any enabled OpenAI capability.
- `OPENAI_BASE_URL` — optional; default is the official OpenAI API origin.
- `OPENAI_CHATGPT_MODEL` — default `gpt-5.4-mini`.
- `OPENAI_SOL_MODEL` — default `openai-sol-2026-07-20`.
- `OPENAI_IMAGE_MODEL` — default `gpt-image-2`; used by the native OpenAI Images API.

Capabilities: `text.openai.chatgpt`, `text.openai.sol`, `image.openai.gpt-image-2`.

## ChatGPT subscription through Codex

- `SUBSCRIPTION_CLI_ENABLED` — must be exactly `true` before any subscription CLI capability starts.
- `CODEX_COMMAND` — default `codex`.
- `CODEX_MODEL` — optional Codex model override; blank uses the authenticated plan's default.

Install and authenticate locally:

```text
npm install -g @openai/codex
codex login
codex login status
```

Capability: `text.openai.codex`.

The startup check requires Codex to report `Logged in using ChatGPT`. Jobs run ephemerally in an empty temporary directory with model-generated shell and other external tools disabled. On Windows, run the worker and Codex together inside WSL.

## Anthropic

- `ANTHROPIC_API_KEY` — required for Fable. Use an Anthropic Console API key; a Claude consumer subscription login is not accepted.
- `ANTHROPIC_BASE_URL` — optional; default is the official Anthropic API origin.
- `ANTHROPIC_FABLE_MODEL` — default `claude-fable-5`.

Capability: `text.anthropic.fable`.

## DeepSeek

- `DEEPSEEK_API_KEY` — required for any enabled DeepSeek capability.
- `DEEPSEEK_BASE_URL` — optional; default `https://api.deepseek.com`.
- `DEEPSEEK_FLASH_MODEL` — default `deepseek-flash`.
- `DEEPSEEK_PRO_MODEL` — default `deepseek-v4-pro`.

Capabilities: `text.deepseek.flash`, `text.deepseek.v4-pro`.

## Higgsfield

- `HIGGSFIELD_ENABLED` — must be exactly `true` before any Higgsfield capability starts.
- `HIGGSFIELD_COMMAND` — default `higgsfield`.
- `HIGGSFIELD_GENJUTSU_MODEL_ID` — exact current account-visible invocation ID, required only for Genjutsu.

Image capabilities:

- `image.openai.gpt-image-2` — OpenAI, not Higgsfield.
- `image.higgsfield.nano-banana-2`
- `image.higgsfield.seedream-5-pro`
- `image.higgsfield.recraft-4.1`

Video capabilities:

- `video.higgsfield.seedance-2.5`
- `video.higgsfield.genjutsu`
- `video.higgsfield.kling-3-turbo`

The worker uses the authenticated Higgsfield CLI. Run `higgsfield account status` before starting. Model availability, account credits, and provider terms remain the worker owner's responsibility.

## Examples

Local-only:

```text
WORKER_CAPABILITIES=text.ollama
```

Hosted text:

```text
WORKER_CAPABILITIES=text.openai.chatgpt,text.openai.sol,text.anthropic.fable,text.deepseek.flash,text.deepseek.v4-pro
```

Codex subscription plus API-backed providers:

```text
SUBSCRIPTION_CLI_ENABLED=true
WORKER_CAPABILITIES=text.openai.codex,text.openai.chatgpt,text.anthropic.fable
```

Image and video:

```text
WORKER_CAPABILITIES=image.openai.gpt-image-2,image.higgsfield.nano-banana-2,video.higgsfield.seedance-2.5
HIGGSFIELD_ENABLED=true
```

Unknown capability IDs are rejected. Missing API credentials, disabled Codex opt-in, an unavailable Codex CLI, and missing local ChatGPT login all fail at startup before a job is claimed.
