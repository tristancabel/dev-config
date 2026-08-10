#!/usr/bin/env bash
set -euo pipefail

# Launch the oMLX OpenAI-compatible server for Pi.

HOST="${OMLX_HOST:-127.0.0.1}"
PORT="${OMLX_PORT:-8000}"
MODEL_DIR="${OMLX_MODEL_DIR:-$HOME/.omlx/models}"
LOG_DIR="${OMLX_LOG_DIR:-$HOME/.omlx/logs}"
LOG_FILE="${LOG_DIR}/pi-omlx.log"
CACHE_DIR="${OMLX_PAGED_SSD_CACHE_DIR:-$HOME/.omlx/cache}"
CACHE_MAX_SIZE="${OMLX_PAGED_SSD_CACHE_MAX_SIZE:-100GB}"
HOT_CACHE_MAX_SIZE="${OMLX_HOT_CACHE_MAX_SIZE:-8GB}"

mkdir -p "$LOG_DIR"

if curl -fsS "http://${HOST}:${PORT}/health" >/dev/null 2>&1; then
  exit 0
fi

if ! command -v omlx >/dev/null 2>&1; then
  echo "omlx command not found" >>"$LOG_FILE"
  exit 1
fi

nohup omlx serve \
  --host "$HOST" \
  --port "$PORT" \
  --model-dir "$MODEL_DIR" \
  --paged-ssd-cache-dir "$CACHE_DIR" \
  --paged-ssd-cache-max-size "$CACHE_MAX_SIZE" \
  --hot-cache-max-size "$HOT_CACHE_MAX_SIZE" \
  >>"$LOG_FILE" 2>&1 &
