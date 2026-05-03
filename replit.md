# Terminal AI

## Overview

A full-stack SSH terminal + AI coding assistant web app. Features an xterm.js SSH terminal, AI chat panel, credential manager, and command snippet library — all in a dark terminal aesthetic.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite + Tailwind CSS (artifact: terminal-ai at `/`)
- **API framework**: Express 5 (artifact: api-server at `/api`)
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **SSH**: ssh2 library with WebSocket relay at `/api/ssh/ws`
- **Terminal**: xterm.js + xterm-addon-fit

## Key Features

- **SSH Terminal**: Connect to servers via SSH (password or private key), full xterm.js terminal
- **AI Chat**: Simultaneous AI chat with terminal context awareness; AI can suggest and run commands
- **Connections Manager**: Save/edit/delete SSH server credentials
- **Snippets**: Quick command snippets with categories, one-click run in terminal
- **AI Settings**: Configure API key, endpoint URL (OpenAI-compatible), and model name
- **Mobile Keyboard**: Special keyboard bar on mobile with Ctrl+C, Tab, arrow keys, etc.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Architecture

- Frontend pages: `/` (terminal+chat), `/connections`, `/snippets`, `/settings`
- WebSocket for SSH: connects at `wss://<host>/api/ssh/ws`
- AI chat proxies to user's configured LLM endpoint (OpenAI-compatible)
- All credentials stored in PostgreSQL (passwords/keys encrypted at rest by DB)

## DB Schema Tables

- `ssh_connections` — saved SSH server credentials (host, port, username, auth)
- `snippets` — saved command snippets with title, command, category
- `ai_settings` — LLM API key, endpoint URL, model name, system prompt
- `chat_messages` — chat history with terminal context

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
