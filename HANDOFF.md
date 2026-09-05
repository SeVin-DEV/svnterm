# HANDOFF — Terminal AI (svnterm)

A self-hosted, mobile-first SSH terminal with a built-in AI coding assistant. Connect to any server from a phone or browser, chat with an LLM about what's on screen, run commands through an agent, browse files over SFTP, and get spoken responses via server-side TTS.

## Architecture

pnpm monorepo, three layers:

- **Frontend** — `artifacts/terminal-ai` (Vite + React 19 + Tailwind 4). All app state and logic live in `src/pages/main.tsx` (SSH, chat, voice, SFTP). Components: `file-editor.tsx` (in-browser SFTP editor), `memory-panel.tsx` (GitHub memory UI), `layout.tsx` (shell chrome). Shared React hooks in `src/hooks/`.
- **Backend** — `artifacts/api-server` (Express 5 + Node, ESM, esbuild-bundled to `dist/index.mjs`). REST under `/api/*`, WebSocket SSH bridge at `/api/ssh/ws` (same process via `ws`). Routes: `health`, `ssh-connections`, `snippets`, `ai-settings`, `chat` (AI + agent mode), `sftp`, `memory`, `tts`. `ssh-ws.ts` is the WS SSH bridge; `services/github.ts` reads/writes GitHub files for memory.
- **Shared libs** — `lib/db` (Drizzle ORM + schema), `lib/api-spec` (OpenAPI 3 YAML, source of truth), `lib/api-zod` (Zod schemas generated from spec), `lib/api-client-react` (React Query hooks generated from spec).

## Key modules

- `artifacts/api-server/src/app.ts` — Express app setup; `index.ts` — HTTP server + WS init.
- `artifacts/api-server/src/routes/chat.ts` — AI chat + agent mode (propose → confirm → execute via SSH).
- `artifacts/api-server/src/ssh-ws.ts` — WebSocket SSH bridge (xterm.js on the client).
- `artifacts/api-server/src/services/github.ts` — GitHub memory / session-log backing.
- `artifacts/api-server/src/lib/logger.ts` — pino structured logger.

## Database (PostgreSQL, Drizzle)

- `ssh_connections` — saved server credentials (password or key auth).
- `snippets` — command snippets.
- `ai_settings` — single-row: LLM config (api_key, endpoint_url, model_name), system_prompt, GitHub token/repo.
- `chat_messages` — persistent chat history with optional agent-mode `command` and `terminal_context`.

## Build / test / run

- Package manager: **pnpm** (root `preinstall` hard-fails on npm/yarn). `minimumReleaseAge: 1440` in `pnpm-workspace.yaml` blocks packages <1 day old — a deliberate supply-chain defense, do not disable.
- Build: `pnpm build` (root) = typecheck + `pnpm -r --if-present run build`. API server: `node ./build.mjs` (esbuild), run with `node --enable-source-maps ./dist/index.mjs`.
- Dev (api-server): `pnpm dev` = build then start.
- Env vars (in `/opt/terminal-ai/.env`, loaded by PM2 via `ecosystem.config.cjs`): `DATABASE_URL`, `SESSION_SECRET`, `PORT` (default 3001), `PIPER_BINARY` (default `/usr/local/bin/piper`), `PIPER_MODEL`, `NODE_ENV=production`.
- Fresh server install: `install.sh` (Ubuntu 22.04+/Debian 12; installs Node, pnpm, PostgreSQL, nginx, PM2, builds, sets up Cloudflare tunnel). Update: `update.sh` (git pull + pnpm install + rebuild + migrate + PM2 reload). Offline apply: `APPLY.sh`.

## Production routing

Internet → Cloudflare Tunnel → nginx :80 → `/api/*` to Express :3001, `/` to Vite static build. WS proxied with `Upgrade` headers.

## Landmines / gotchas

- **pnpm only** — root `preinstall` exits 1 on any non-pnpm package manager.
- **`minimumReleaseAge: 1440`** — brand-new npm releases won't install; add to `minimumReleaseAgeExclude` only for trusted publishers, and remove once the window passes.
- **react / react-dom pinned to 19.1.0** — exact versions required by expo; do not bump casually.
- **esbuild pinned 0.27.3** via overrides (drizzle-kit uses an older vulnerable esbuild internally; `@esbuild-kit/esm-loader` overridden to `tsx`).
- **linux-x64 only** — esbuild/lightningcss/rollup/tailwind-oxide/ngrok platform binaries for other arches are overridden to `-`; cross-platform builds will break.
- **No test suite** — root scripts define build/typecheck only; no test runner is configured.

## Unfinished / notes

- `replit.md`, `PIPER_INSTALL.md`, `APPLY.sh`, and a stray `Gemini_Generated_Image_*.png` sit at repo root; `scripts/src/hello.ts` is a stub.
- `lib/api-client-react` and `lib/api-zod` are codegen outputs — regenerate from `lib/api-spec/openapi.yaml`, don't hand-edit.
