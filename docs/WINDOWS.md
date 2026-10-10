# Windows setup

## Requirements

- Windows 10 or 11
- Git
- Node.js 22 or newer
- A dedicated standard Windows account
- Ollama and/or approved hosted-provider access

## Install

Open PowerShell as the dedicated user, not as Administrator:

```powershell
git clone https://github.com/NachoLLMJS/worker-relay-node.git
cd worker-relay-node
npm ci
Copy-Item .env.example .env
notepad .env
```

Set the private worker credential, unique worker name, and explicit capabilities. Keep `.env` local.

For Ollama:

```powershell
ollama pull llama3.2
ollama list
```

For Codex subscription support, OpenAI currently recommends WSL. Install and run this worker inside the same WSL distribution, then install Codex and complete `codex login` there. Anthropic capabilities require `ANTHROPIC_API_KEY`; Claude consumer subscription login is not supported.

Verify the node:

```powershell
npm test
npm run typecheck
npm run build
npm run worker -- --once
```

Run continuously in the foreground with the local Worker Command Center:

```powershell
npm run dashboard
```

The dashboard opens automatically at `http://127.0.0.1:4317`. It remains local to the PC and shows coordinator connectivity, enabled models, the live process feed, and completed jobs. Use its controls to start or stop polling and to opt in or out of anonymous public requests.

After it remains stable, create a Windows Task Scheduler task under the dedicated standard account. Configure it to start at login, use the repository as `Start in`, run `npm.cmd run dashboard`, and choose `Do not start a new instance` if one is already running. Do not embed credentials in the scheduled command; the worker reads the ignored `.env` file.

## Updating

Stop the worker, then:

```powershell
git pull --ff-only
npm ci
npm test
npm run typecheck
npm run build
npm run worker -- --once
```

Restart continuous operation only when all checks pass.
