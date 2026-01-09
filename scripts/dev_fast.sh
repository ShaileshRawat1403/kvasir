#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/logs"
PID_FILE="$ROOT/.dev_fast.pids"

mkdir -p "$LOG_DIR"

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Missing .env. Copy .env.example and fill it in."
  exit 1
fi

if [[ ! -x "$ROOT/.venv/bin/python" ]]; then
  echo "Missing .venv. Run: make install"
  exit 1
fi

set -a
source "$ROOT/.env"
set +a

if [[ -z "${PY_API_PORT:-}" ]]; then
  PY_API_PORT=8000
fi

if [[ -n "${NVM_DIR:-}" && -s "$NVM_DIR/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  set +e
  . "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null
  set -e
elif [[ -s "$HOME/.nvm/nvm.sh" ]]; then
  # shellcheck source=/dev/null
  set +e
  . "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null
  set -e
fi

start_proc() {
  local name="$1"
  shift
  local log="$LOG_DIR/$name.log"
  "$@" >"$log" 2>&1 &
  echo $!
}

python_pid=$(start_proc "python-api" "$ROOT/.venv/bin/python" -m uvicorn python_api:app --host 0.0.0.0 --port "$PY_API_PORT")
node_pid=$(start_proc "node-proxy" node "$ROOT/server.js")
frontend_pid=$(start_proc "frontend" npm --prefix "$ROOT/frontend" run dev)

printf "%s\n" "$python_pid" "$node_pid" "$frontend_pid" >"$PID_FILE"

echo "Started:"
echo "  python-api PID: $python_pid (log: $LOG_DIR/python-api.log)"
echo "  node-proxy PID: $node_pid (log: $LOG_DIR/node-proxy.log)"
echo "  frontend  PID: $frontend_pid (log: $LOG_DIR/frontend.log)"
echo "Stop with: scripts/dev_stop.sh"
