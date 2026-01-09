#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT/.dev_fast.pids"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No PID file found at $PID_FILE. Nothing to stop."
  exit 0
fi

while IFS= read -r pid; do
  if [[ -n "$pid" ]]; then
    kill "$pid" >/dev/null 2>&1 || true
  fi
done <"$PID_FILE"

rm -f "$PID_FILE"
echo "Stopped dev processes."
