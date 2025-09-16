# Dexter API (Alpha)

TypeScript API that orchestrates OpenAI Agents with hosted MCP tools, and mints ephemeral Realtime tokens for the browser.

## Endpoints
- GET `/health` → `{ ok: true }`
- POST `/realtime/session` → Realtime ephemeral session payload (for browser WebRTC)
- POST `/agent/run` → Run an Agent (model: `o4-mini`) with hosted MCP tools
- GET `/mcp/health` → Pass-through to the configured MCP server

## Config
Copy `.env.example` to `.env` and set:
- `OPENAI_API_KEY` (required)
- `OPENAI_REALTIME_MODEL` (default: `gpt-realtime`)
- `TEXT_MODEL` (default: `gpt-5-mini`) — override per request with `{"model":"gpt-5"}`
- `MCP_URL` (default: `https://dexter.cash/mcp`)
- `PORT` (default: `3030`)
- `ALLOWED_ORIGINS` (default: `*`)

## Dev
```
npm ci
npm run dev
# http://127.0.0.1:3030/health
```

## Tests
```
npm test
```
- Includes a production-like check that hits `https://dexter.cash/mcp/health`.

## Notes
- Uses `@openai/agents` hosted MCP tools to avoid duplicating tool code.
- Ephemeral token endpoint hits `POST https://api.openai.com/v1/realtime/sessions`.
