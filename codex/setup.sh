#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! command -v npm >/dev/null 2>&1; then
  echo "npm >= 20 is required to bootstrap dexter-api" >&2
  exit 1
fi

pushd "$ROOT_DIR" >/dev/null

npm install

if [ -f prisma/schema.prisma ]; then
  npx prisma generate || true
fi

cat <<'NOTE'
Environment variables and secrets are not written locally.
Use Codex Cloud (dashboard or `codex env set` / `codex secrets set` when available)
to provide SUPABASE_*, DATABASE_URL*, TOKEN_AI_* and related configuration before running the API.
NOTE

popd >/dev/null
