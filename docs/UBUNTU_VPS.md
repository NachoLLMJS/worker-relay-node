# Ubuntu VPS setup

Use a dedicated unprivileged account. Do not run the worker as root.

## Install

```bash
sudo adduser --disabled-password --gecos '' workerrelay
sudo -iu workerrelay
git clone https://github.com/NachoLLMJS/worker-relay-node.git
cd worker-relay-node
npm ci
cp .env.example .env
chmod 600 .env
```

Edit `.env` locally. Configure only approved capabilities and provider credentials.

For subscription capabilities, install the selected official CLI while logged in as `workerrelay`, then let the human complete its browser/device login:

```bash
npm install -g @openai/codex @anthropic-ai/claude-code
codex login
codex login status
claude auth login
claude auth status
```

Enable only the CLI the operator actually authenticated. Do not copy OAuth files from another account or machine.

Verify:

```bash
npm test
npm run typecheck
npm run build
npm run worker -- --once
```

The Hermes-inspired dashboard is intended for a local PC. On a VPS, keep the headless worker shown below. If an operator deliberately runs the dashboard, it remains bound to `127.0.0.1`; access it only through an SSH tunnel and never expose port 4317 publicly.

## systemd

As root, create `/etc/systemd/system/worker-relay.service`:

```ini
[Unit]
Description=Worker Relay AI Node
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=workerrelay
WorkingDirectory=/home/workerrelay/worker-relay-node
ExecStart=/usr/bin/npm run start:worker
Restart=on-failure
RestartSec=10
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/home/workerrelay/worker-relay-node

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now worker-relay
sudo systemctl status worker-relay --no-pager
```

View sanitized operational logs with:

```bash
sudo journalctl -u worker-relay -n 100 --no-pager
```

The application never logs credential values. Still avoid sharing full logs publicly.

## Update

```bash
sudo systemctl stop worker-relay
sudo -iu workerrelay bash -lc 'cd ~/worker-relay-node && git pull --ff-only && npm ci && npm test && npm run typecheck && npm run build && npm run worker -- --once'
sudo systemctl start worker-relay
```
