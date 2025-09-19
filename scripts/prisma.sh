#!/usr/bin/env bash
set -euo pipefail

# Resolve repo root (script may be called from any directory)
SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO_ROOT=$(cd "${SCRIPT_DIR}/.." && pwd)

cd "${REPO_ROOT}"

if [[ ! -f ../dexter-ops/.env ]]; then
  echo "[prisma.sh] Missing ../dexter-ops/.env; cannot load shared environment" >&2
  exit 1
fi

# Load shared secrets (pm2 setup keeps them here)
set -a
source ../dexter-ops/.env
set +a

# Use dedicated session pooler for migrations when available
BASE_SESSION_URL="${DATABASE_URL_SESSION:-${DATABASE_URL:-}}"

if [[ -z "${BASE_SESSION_URL}" ]]; then
  echo "[prisma.sh] DATABASE_URL or DATABASE_URL_SESSION not defined after loading ../dexter-ops/.env" >&2
  exit 1
fi

if [[ "${BASE_SESSION_URL}" == *":6543"* ]]; then
  echo "[prisma.sh] DATABASE_URL_SESSION is not configured. The transaction pooler cannot run Prisma migrations." >&2
  echo "Set DATABASE_URL_SESSION to the Supabase session pooler URI (port 5432)." >&2
  exit 1
fi

append_param() {
  local url="$1"
  local param="$2"
  if [[ "$url" == *"?"* ]]; then
    echo "${url}&${param}"
  else
    echo "${url}?${param}"
  fi
}

export DATABASE_URL="$(append_param "${BASE_SESSION_URL}" "sslmode=require")"

ENGINE_PATH="${REPO_ROOT}/node_modules/.prisma/client/libquery_engine-debian-openssl-3.0.x.so.node"
if [[ ! -f "${ENGINE_PATH}" ]]; then
  echo "[prisma.sh] Prisma engine missing at ${ENGINE_PATH} (run npm install?)" >&2
  exit 1
fi
export PRISMA_QUERY_ENGINE_LIBRARY="${ENGINE_PATH}"

exec npx prisma "$@"
