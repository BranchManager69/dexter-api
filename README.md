<p align="center">
  <img src="https://docs.dexter.cash/previews/dexter-stack-wordmark.svg" alt="Dexter Stack wordmark" width="360">
</p>

<p align="center">
  <strong>Dexter API</strong>
  · <a href="https://github.com/BranchManager69/dexter-fe">Dexter FE</a>
  · <a href="https://github.com/BranchManager69/dexter-mcp">Dexter MCP</a>
  · <a href="https://github.com/BranchManager69/dexter-ops">Dexter Ops</a>
  · <a href="https://github.com/BranchManager69/pumpstreams">PumpStreams</a>
</p>

<h1 align="center">Dexter API</h1>

<p align="center">
  <a href="https://img.shields.io/badge/node-%3E=20-43853d.svg?logo=node.js&logoColor=white"><img src="https://img.shields.io/badge/node-%3E=20-43853d.svg?logo=node.js&logoColor=white" alt="Node.js >=20"></a>
  <a href="#"><img src="https://img.shields.io/badge/status-alpha-orange.svg" alt="Alpha"></a>
  <a href="https://github.com/openai/openai-agents-js"><img src="https://img.shields.io/badge/openai-agents-blue.svg" alt="OpenAI Agents"></a>
</p>

Dexter API orchestrates OpenAI Agents, hosted MCP tools, and Coinbase x402 billing into a single TypeScript service. It powers the Dexter browser clients by minting ephemeral realtime tokens, proxying Model Context Protocol tooling, and wiring Supabase identity into wallets and pro tiers.

---

## Highlights
- **Hosted MCP + Agents** – builds specialist agents on top of `@openai/agents` and forwards MCP tool traffic so we never duplicate tool code.
- **Realtime tokens for the browser** – mints ephemeral WebRTC sessions against OpenAI's Realtime API with minimal client surface area.
- **Supabase-backed auth glue** – surfaces `/auth/config`, wallet resolution, and connector OAuth flows that plug directly into the Supabase project.
- **Coinbase x402 gating** – `POST /pro/subscribe` settles Solana payments, persists the subscription in Postgres, and marks users as `tier: pro`.
- **Docs-ready** – long-form guides live in `docs/` (GitBook build); the README stays high-signal for day-to-day development.

## Preview

<p align="center">
  <video src="https://docs.dexter.cash/previews/dexter-beta.webm"
         poster="https://docs.dexter.cash/previews/dexter-beta.png"
         width="960"
         autoplay
         loop
         muted
         playsinline>
  </video>
</p>

## Dexter Stack

| Repo | Role |
|------|------|
| [`dexter-fe`](https://github.com/BranchManager69/dexter-fe) | Next.js client for realtime voice + chat |
| [`dexter-mcp`](https://github.com/BranchManager69/dexter-mcp) | Hosted MCP transport powering tool access |
| [`dexter-ops`](https://github.com/BranchManager69/dexter-ops) | Shared operations scripts, PM2 config, nginx templates |
| [`pumpstreams`](https://github.com/BranchManager69/pumpstreams) | Pump.fun reconnaissance & analytics (adjacent tooling) |

## Quick Start
1. Install dependencies and copy the local env template:
   ```bash
   npm ci
   cp .env.example .env
   ```
2. Update the secrets you actually use (OpenAI keys, Supabase project, MCP endpoint, optional x402 settings). **Connector OAuth requires `CONNECTOR_CODE_SALT` to be a long random string**—set it in `.env` and in `dexter-ops/.env` if you lean on the preload shim. The loader in `src/env.ts` also backfills values from sibling repos when present, but an explicit `.env` is preferred for clarity.
3. Boot the API:
   ```bash
   npm run dev
   # Server: http://127.0.0.1:3030
   ```

## Key Endpoints
- `GET /health` → `{ ok: true, service, mcp }` probe for readiness and configured MCP base URL.
- `POST /realtime/sessions` → ephemeral session payload for browser WebRTC clients (defaults to `env.OPENAI_REALTIME_MODEL`).
- `POST /chat` → runs the primary agent through the OpenAI Agents runner and returns the final text/output.
- `GET /chat/stream` → server-sent event stream for live chat completions.
- `GET /mcp/health` → pass-through health check for the configured MCP server.
- `GET /tools` and `GET /api/tools` → list MCP tools via the hosted transport (honors `TOKEN_AI_MCP_TOKEN`).
- `GET /auth/config` → exposes Supabase URL + anon key for the client.
- `GET /api/wallets/resolver` → resolves the caller's managed wallets (requires Supabase auth).
- `POST /pro/subscribe` → Coinbase x402 payment hook that activates the `tier: pro` subscription.
- Connector OAuth helper routes live under `/api/connector/oauth/*` (authorize, request, exchange, token) for Claude/ChatGPT integration.

## Core Scripts
- `npm run dev` – start the local server with hot reload (`tsx`).
- `npm run build` / `npm start` – compile with TypeScript and serve the output in `dist/`.
- `npm test` – run the Vitest suite, including the production-like MCP health probe.
- `npm run lint` – lint source files (warnings do not fail the command).
- `npm run x402:test` – Solana payment smoke test against the Coinbase x402 facilitator.
- `npm run probe:oauth` – end-to-end connector OAuth probe (creates a disposable Supabase user, steps through authorize → exchange → token → userinfo, then cleans up).

## Docs & References
- `docs/` contains the GitBook sources (`SUMMARY.md`, integration plans, etc.). Keep the deep-dives there and link from the README when context is missing.
- `docs/x402-integration-plan.md` outlines the full subscription flow and how wallet tiers unlock MCP tooling.
