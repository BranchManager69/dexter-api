# Repository Guidelines

## Project Layout
- `src/` hosts the Express server, agents, and HTTP routes.
- `supabase/` tracks the Dexter Supabase project (`config.toml` plus migrations); `.temp/` stays ignored because it is per-machine cache data.
- `scripts/`, `docs/`, and `tests/` hold CLI helpers, longer-form documentation, and the Vitest suites.
- Prisma schema and generated client live in `prisma/`; compiled output drops into `dist/`.

## Build & Test Commands
- `npm run dev` – boot the API with hot reload on http://127.0.0.1:3030.
- `npm run build` / `npm start` – compile TypeScript and serve from `dist/`.
- `npm test` – run the Vitest suite.
- `npm run lint` – invoke ESLint (warnings are tolerated but should be addressed before reviews).
- `npm run x402:test` – Coinbase x402 subscription smoke test.

## Environment & Secrets
- Copy `.env.example` to `.env`; the loader reads this file first, then falls back to `../dexter-ops/.env` for any gaps.
- Never commit `.env`, Supabase service keys, or PM2 log output. `.gitignore` and `supabase/.gitignore` already cover the common cases.
- Update `.env.example` whenever new required variables are introduced so fresh clones stay in sync.

## Supabase Workflow
- `dexter-api` owns the Supabase project. Capture schema changes with `supabase db pull <name>` and commit the resulting files under `supabase/migrations/`.
- Before pulling or pushing, verify the Supabase network restrictions allow your current IP; connection refusals are usually an allow-list issue.
- Leave `supabase/.temp/` untracked—those cache files regenerate automatically after `supabase link`.

## Operations & Logging
- PM2 manages processes here; the `pm2-logrotate` module is installed with `max_size=100M`, `retain=7`, and gzip compression so stdout/stderr logs rotate automatically.
- Use `pm2 flush` or manual truncation to clear legacy logs created before rotation was enabled.
- System logrotate templates for shared services live in `dexter-ops`; adjust them there rather than adding ad-hoc rotation scripts in this repo.

## Commit & PR Guidelines
- Follow the existing history: short, imperative subjects (`feat:`, `fix:`, `chore:`).
- Keep commits focused, call out env/auth impacts in the body, and document manual verification in PR descriptions.
- Run `npm run lint` / `npm test` before pushing meaningful changes and update `README.md` or `docs/` whenever setup steps or behaviour change.
