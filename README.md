# Terminal AI

A self-hosted, mobile-first SSH terminal with a built-in AI coding assistant. Connect to any server from your phone or browser, chat with an LLM about what's on screen, run commands via an agent, browse files over SFTP, and hear responses spoken aloud via server-side TTS.

---

## Feature Overview

| Feature | Description |
|---|---|
| **SSH Terminal** | Full xterm.js terminal, keyboard shortcuts, mobile key bar |
| **AI Chat** | Persistent chat with any OpenAI-compatible LLM |
| **Agent Mode** | AI proposes → confirms → executes shell commands via SSH |
| **Live Voice** | Hold-to-speak mic input; server-side Piper TTS reads responses |
| **SFTP Browser** | Browse, upload, download, and edit files in-browser |
| **Snippets** | Save and one-click-run command snippets |
| **Saved Connections** | Store SSH credentials in PostgreSQL |
| **GitHub Memory** | AI memory and session logs backed to a GitHub repo |
| **Auto-reconnect** | Exponential backoff reconnect; immediate reconnect on app resume |

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                     Browser / Phone                  │
│                                                      │
│   artifacts/terminal-ai   (Vite + React)             │
│   ┌──────────────────────────────────────────────┐   │
│   │  main.tsx          — all app state & logic   │   │
│   │  components/                                 │   │
│   │    file-editor.tsx — SFTP in-browser editor  │   │
│   │    memory-panel.tsx— GitHub memory viewer    │   │
│   │    layout.tsx      — shell chrome            │   │
│   │  hooks/            — shared React hooks      │   │
│   └──────────────────────────────────────────────┘   │
└──────────────┬──────────────────┬───────────────────┘
               │ REST /api/*      │ WebSocket /api/ssh/ws
               ▼                  ▼
┌─────────────────────────────────────────────────────┐
│   artifacts/api-server   (Express 5, Node.js)        │
│                                                      │
│   routes/                                            │
│     health.ts          GET  /api/healthz             │
│     ssh-connections.ts CRUD /api/ssh-connections     │
│     snippets.ts        CRUD /api/snippets            │
│     ai-settings.ts     GET/PUT /api/ai-settings      │
│     chat.ts            POST /api/chat  (+ agent)     │
│     sftp.ts            GET/POST /api/sftp/*          │
│     memory.ts          GET/PUT /api/memory           │
│     tts.ts             POST /api/tts  (Piper/espeak) │
│                                                      │
│   ssh-ws.ts            WebSocket SSH bridge          │
│   sftp-helper.ts       SFTP stream helpers           │
│   lib/logger.ts        pino structured logger        │
│   services/github.ts   read/write GitHub files       │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│   Shared Libraries  (lib/)                           │
│                                                      │
│   lib/db               Drizzle ORM + schema          │
│   lib/api-spec         OpenAPI 3 spec (source of     │
│                        truth for codegen)            │
│   lib/api-zod          Zod request/response schemas  │
│   lib/api-client-react React Query hooks (generated) │
└──────────────┬───────────────────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────────────────┐
│   PostgreSQL                                         │
│                                                      │
│   ssh_connections   saved server credentials         │
│   snippets          command snippets                 │
│   ai_settings       LLM config + GitHub token        │
│   chat_messages     persistent chat history          │
└─────────────────────────────────────────────────────┘
```

### Request routing (production)

```
Internet → Cloudflare Tunnel → nginx :80
                                  ├─ /api/*          → Express :3001
                                  └─ /               → Vite static build
```

WebSocket (`/api/ssh/ws`) is proxied by nginx with `Upgrade` headers and handled by the same Express process via the `ws` package.

---

## Database Schema

```
ssh_connections
  id, name, host, port, username
  auth_type  ("password" | "key")
  password, private_key, passphrase
  created_at, updated_at

snippets
  id, title, command, description, category
  created_at

ai_settings          (single-row table)
  id, api_key, endpoint_url, model_name
  system_prompt, github_token, github_repo
  updated_at

chat_messages
  id, role, content
  command              (agent-mode command, if any)
  terminal_context     (terminal snapshot sent with message)
  created_at
```

---

## Monorepo Layout

```
.
├── artifacts/
│   ├── terminal-ai/          Frontend (React + Vite)
│   │   └── src/
│   │       ├── pages/main.tsx      ← main app (SSH, chat, voice, SFTP)
│   │       ├── components/
│   │       │   ├── file-editor.tsx ← in-browser file editor
│   │       │   ├── memory-panel.tsx← GitHub memory UI
│   │       │   └── layout.tsx
│   │       ├── hooks/
│   │       └── lib/utils.ts
│   └── api-server/           Backend (Express 5)
│       └── src/
│           ├── app.ts              ← Express app setup
│           ├── index.ts            ← HTTP server + WS init
│           ├── ssh-ws.ts           ← WebSocket SSH bridge
│           ├── sftp-helper.ts
│           ├── lib/logger.ts
│           ├── services/github.ts
│           └── routes/
│               ├── index.ts        ← route registration
│               ├── health.ts
│               ├── ssh-connections.ts
│               ├── snippets.ts
│               ├── ai-settings.ts
│               ├── chat.ts         ← AI chat + agent mode
│               ├── sftp.ts
│               ├── memory.ts
│               └── tts.ts          ← Piper TTS
├── lib/
│   ├── db/                   Drizzle ORM + schema + migrations
│   ├── api-spec/             OpenAPI 3 spec (YAML)
│   ├── api-zod/              Zod schemas (generated from spec)
│   └── api-client-react/     React Query hooks (generated from spec)
├── scripts/                  Shared utility scripts
├── install.sh                Fresh server install (Ubuntu/Debian)
├── update.sh                 Pull + rebuild + PM2 reload
├── pnpm-workspace.yaml
└── README.md
```

---

## Environment Variables

Set in `/opt/terminal-ai/.env` on the server. Loaded by PM2 via `ecosystem.config.cjs`.

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `SESSION_SECRET` | Yes | Express session signing secret |
| `PORT` | Yes | API server port (default `3001`) |
| `PIPER_BINARY` | No | Path to piper binary (default `/usr/local/bin/piper`) |
| `PIPER_MODEL` | No | Path to `.onnx` voice model |
| `NODE_ENV` | Yes | `production` on server |

---

## Self-Host Install (Fresh Server)

Requires Ubuntu 22.04+ or Debian 12+. Run as root or sudo user.

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR/REPO/main/install.sh | bash
```

Or clone then run:

```bash
git clone https://github.com/YOUR/REPO.git /tmp/terminal-ai-src
bash /tmp/terminal-ai-src/install.sh
```

The script will ask for: GitHub repo URL, install directory, domain/IP, DB credentials. It installs Node.js, pnpm, PostgreSQL, nginx, PM2, builds the app, and sets up nginx + Cloudflare tunnel.

---

## Updating a Running Server

```bash
bash /opt/terminal-ai/update.sh
```

This runs `git pull`, `pnpm install`, rebuilds both artifacts, runs DB migrations, and reloads PM2 — zero downtime.

If you cannot push from development to Git, use the `APPLY.sh` method:

```bash
# On your local machine
scp terminal-ai-update.tar.gz ubuntu@YOUR_SERVER:/tmp/

# On the server
cd /tmp && tar -xzf terminal-ai-update.tar.gz
bash terminal-ai-update/APPLY.sh /opt/terminal-ai
```

---

## Development (Replit / Local)

```bash
# Install deps
pnpm install

# Run API server
pnpm --filter @workspace/api-server run dev

# Run frontend
pnpm --filter @workspace/terminal-ai run dev

# Typecheck everything
pnpm run typecheck

# Run DB migrations
pnpm --filter @workspace/db run migrate
```

> Never run `pnpm dev` at the workspace root — there is no root dev script by design.

### Adding an API route

1. Add the endpoint to `lib/api-spec/` (OpenAPI YAML).
2. Run `pnpm --filter @workspace/api-spec run codegen` to regenerate Zod schemas and React Query hooks.
3. Add route handler in `artifacts/api-server/src/routes/`.
4. Register it in `artifacts/api-server/src/routes/index.ts`.

### Adding a DB table

1. Add the table definition to `lib/db/src/schema/index.ts`.
2. Generate and run the migration:
   ```bash
   pnpm --filter @workspace/db run generate
   pnpm --filter @workspace/db run migrate
   ```

---

## PM2 Cheat Sheet

```bash
pm2 list                        # show all processes
pm2 logs terminal-ai-api        # tail live logs
pm2 logs terminal-ai-api --lines 200   # last 200 log lines
pm2 reload terminal-ai-api      # zero-downtime reload
pm2 restart terminal-ai-api     # hard restart
pm2 stop terminal-ai-api        # stop
pm2 delete terminal-ai-api      # remove from PM2
pm2 save                        # persist process list across reboots
pm2 startup                     # print systemd enable command
```

Restart with fresh env vars (e.g. after editing `.env`):

```bash
pm2 delete terminal-ai-api
cd /opt/terminal-ai && pm2 start ecosystem.config.cjs
pm2 save
```

---

## nginx Cheat Sheet

```bash
nginx -t                        # test config syntax
systemctl reload nginx          # reload without dropping connections
systemctl restart nginx         # full restart
systemctl status nginx
cat /etc/nginx/sites-available/terminal-ai   # view config
journalctl -u nginx -n 50       # nginx system logs
```

---

## PostgreSQL Cheat Sheet

```bash
sudo -u postgres psql terminalai           # open DB shell
\dt                                        # list tables
\d ssh_connections                         # describe table
SELECT * FROM ai_settings;                 # check AI config
SELECT id, name, host FROM ssh_connections;
TRUNCATE chat_messages;                    # clear chat history
\q                                         # quit
```

---

## Piper TTS Cheat Sheet

```bash
# Test piper directly
echo "Hello world." | piper \
  --model /opt/piper/en_US-lessac-medium.onnx \
  --output_file /tmp/test.wav
ls -lh /tmp/test.wav            # should be >1 KB

# Test TTS API endpoint
curl -s -X POST http://localhost:80/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"Voice is working."}' \
  --output /tmp/api_test.wav
ls -lh /tmp/api_test.wav

# Check piper binary location
which piper
echo $PIPER_BINARY              # should be set in .env / PM2 env
```

If Piper is not installed, the TTS route falls back to `espeak-ng` (robotic voice).  
Install espeak-ng as a stopgap: `sudo apt install espeak-ng`

---

## WebSocket SSH Cheat Sheet

The SSH session runs over a single WebSocket at `/api/ssh/ws`.

Message types the client sends:

| type | payload | description |
|---|---|---|
| `connect` | `{ connectionId: number }` | Open SSH session using saved creds |
| `data` | `{ data: string }` | Keystrokes / terminal input |
| `resize` | `{ cols, rows }` | Terminal resize event |
| `disconnect` | — | Close session |
| `ping` | — | Keepalive (server ignores) |

Message types the server sends:

| type | payload | description |
|---|---|---|
| `data` | `{ data: string }` | Terminal output |
| `status` | `{ data: "connected" \| "disconnected" }` | Session state change |
| `error` | `{ data: string }` | Error message |

---

## SSH Auto-reconnect Behaviour

The frontend reconnects automatically on unexpected disconnects:

| Attempt | Delay |
|---|---|
| 1 | 2 s |
| 2 | 4 s |
| 3 | 8 s |
| 4 | 16 s |
| 5 | 30 s |

After 5 failures it stops and prints a message to reconnect manually.

- Clicking **Disconnect** suppresses reconnect permanently (until next manual connect).
- Switching to another app on mobile triggers an immediate reconnect via the `visibilitychange` event when you return.
- A keepalive ping is sent every **20 seconds** to prevent Cloudflare / nginx from timing out idle connections.

---

## AI / LLM Configuration

Settings are stored in the `ai_settings` DB table and editable in-app via the settings panel.

| Setting | Description |
|---|---|
| **Endpoint URL** | Any OpenAI-compatible base URL (OpenAI, Ollama, LM Studio, etc.) |
| **Model name** | e.g. `gpt-4o`, `llama3`, `mistral` |
| **API key** | Stored encrypted-at-rest in PostgreSQL |
| **System prompt** | Custom instructions prepended to every conversation |
| **GitHub token** | Personal access token for memory persistence |
| **GitHub repo** | `owner/repo` — memory and session logs go here |

### GitHub Memory layout (in your chosen repo)

```
memory.md          — persistent facts the AI remembers across sessions
sessions/
  2026-05-03T....md  — auto-saved session summaries
```

The AI auto-writes `[MEMORY: ...]` tags in its responses; these are extracted and appended to `memory.md` on GitHub every 5 assistant turns.

---

## Troubleshooting

### App is unreachable

```bash
# Check all services are up
pm2 list
systemctl status nginx

# Check ports are listening
ss -tlnp | grep -E '3001|80|443'

# Test API directly (bypasses nginx)
curl http://localhost:3001/api/healthz

# Test through nginx
curl http://localhost:80/api/healthz
```

### WebSocket / SSH not connecting

```bash
# Check nginx has the WebSocket upgrade block
grep -A5 'proxy_pass.*3001' /etc/nginx/sites-available/terminal-ai

# Required nginx directives:
#   proxy_http_version 1.1;
#   proxy_set_header Upgrade $http_upgrade;
#   proxy_set_header Connection "upgrade";

# Check Cloudflare → WAF may block WebSocket — set tunnel to No TLS Verify
# and ensure WebSockets are enabled in Cloudflare Network tab
```

### Cloudflare blocks POST /api/ssh-connections from browser

This is a Cloudflare WAF rule. Workaround — create connections directly on the server:

```bash
curl -s -X POST http://localhost:80/api/ssh-connections \
  -H "Content-Type: application/json" \
  -d '{"name":"My Server","host":"1.2.3.4","port":22,"username":"ubuntu","authType":"password","password":"SECRET"}'
```

### TTS returns empty audio or 500

1. Check piper is installed: `which piper && piper --version`
2. Check model file exists: `ls -lh /opt/piper/*.onnx`
3. Check env vars: `pm2 env terminal-ai-api | grep PIPER`
4. Tail logs: `pm2 logs terminal-ai-api --lines 50`
5. Test fallback: `sudo apt install espeak-ng && espeak-ng "test" --stdout > /tmp/e.wav`

### Chat / AI not responding

```bash
# Check settings are saved
sudo -u postgres psql terminalai -c "SELECT endpoint_url, model_name, left(api_key,4) FROM ai_settings;"

# Test the endpoint directly
curl -s https://api.openai.com/v1/models \
  -H "Authorization: Bearer YOUR_KEY" | jq '.data[0].id'

# Check API server logs for LLM errors
pm2 logs terminal-ai-api --lines 100 | grep -i error
```

### DB migration errors after update

```bash
cd /opt/terminal-ai
pnpm --filter @workspace/db run migrate
pm2 reload terminal-ai-api
```

### Frontend shows blank / stale page

```bash
# Force rebuild frontend
cd /opt/terminal-ai
NODE_ENV=production PORT=1 BASE_PATH=/ \
  pnpm --filter @workspace/terminal-ai run build

# Check nginx is serving the right dist folder
grep root /etc/nginx/sites-available/terminal-ai
```

### PM2 process crashes on startup

```bash
pm2 logs terminal-ai-api --lines 50 --err
# Common causes:
#   - DATABASE_URL not set or wrong password
#   - Port 3001 already in use: lsof -i :3001
#   - Missing .env file: ls -la /opt/terminal-ai/.env
```

---

## Key Files Quick-Reference

| File | What to edit here |
|---|---|
| `artifacts/terminal-ai/src/pages/main.tsx` | All frontend logic: SSH, chat, voice, agent, reconnect |
| `artifacts/terminal-ai/src/components/file-editor.tsx` | In-browser SFTP file editor |
| `artifacts/terminal-ai/src/components/memory-panel.tsx` | GitHub memory viewer/editor UI |
| `artifacts/api-server/src/routes/chat.ts` | AI chat, agent mode, memory injection |
| `artifacts/api-server/src/routes/tts.ts` | Text-to-speech (Piper / espeak-ng) |
| `artifacts/api-server/src/routes/sftp.ts` | SFTP file browser API |
| `artifacts/api-server/src/routes/ssh-connections.ts` | Saved SSH connection CRUD |
| `artifacts/api-server/src/routes/ai-settings.ts` | LLM config API |
| `artifacts/api-server/src/ssh-ws.ts` | WebSocket SSH bridge |
| `artifacts/api-server/src/services/github.ts` | GitHub read/write for memory |
| `lib/db/src/schema/index.ts` | Database table definitions |
| `lib/api-spec/` | OpenAPI spec (source of truth — edit before adding routes) |
| `install.sh` | Fresh server install script |
| `update.sh` | Update deployed server |

---

## Adding a New Feature (Checklist)

- [ ] If it's a new API endpoint: add to `lib/api-spec/` first, then run codegen
- [ ] Add route handler in `artifacts/api-server/src/routes/`
- [ ] Register route in `artifacts/api-server/src/routes/index.ts`
- [ ] If it needs DB storage: add table to `lib/db/src/schema/index.ts`, generate + run migration
- [ ] Add UI in `artifacts/terminal-ai/src/pages/main.tsx` or a new component
- [ ] Use generated React Query hooks from `@workspace/api-client-react` for data fetching
- [ ] Test locally in Replit preview, then run `update.sh` on server
- [ ] Do **not** use `console.log` in server code — use `req.log` in routes, `logger` elsewhere
