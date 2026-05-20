#!/usr/bin/env bash
#
# start-mlx-server.sh — Launch the MLX local model server for Pi
#
# TODO: Fill in the variables below with your actual model path and settings.
#
set -e

# ── Configuration (TODO: customize) ────────────────────────────────

# Path to the MLX model directory
# TODO: Replace with your actual model path
MLX_MODEL="unsloth/Qwen3.6-27B-MLX-8bit"

# Server bind address
MLX_HOST="127.0.0.1"

# Server port
MLX_PORT="8080"

# Path to the MLX server binary or script
# TODO: Replace with your actual server command (e.g., mlx_server, python -m mlx_server, etc.)
MLX_SERVER_CMD="mlx_lm.server"

# ── Pre-flight checks ─────────────────────────────────────────────

# Check if the server is already running
if curl -s "http://${MLX_HOST}:${MLX_PORT}/v1/models" >/dev/null 2>&1; then
  echo "MLX server is already running on ${MLX_HOST}:${MLX_PORT}"
  exit 0
fi


# ── Launch ─────────────────────────────────────────────────────────

echo "Starting MLX server..."
echo "  Model: $MLX_MODEL"
echo "  Host:  $MLX_HOST"
echo "  Port:  $MLX_PORT"

# TODO: Adjust the command below to match your actual MLX server invocation.
# Example patterns:
#   nohup mlx_server --model "$MLX_MODEL" --host "$MLX_HOST" --port "$MLX_PORT" &
#   nohup python -m mlx_server serve "$MLX_MODEL" --host "$MLX_HOST" --port "$MLX_PORT" &
cd ~/Tools/mlx
source .venv/bin/activate

nohup "$MLX_SERVER_CMD" \
  --model "$MLX_MODEL" \
  --host "$MLX_HOST" \
  --port "$MLX_PORT" \
  >/dev/null 2>&1 &

SERVER_PID=$!
echo "Server PID: $SERVER_PID"

# ── Wait for ready ─────────────────────────────────────────────────

MAX_RETRIES=30
RETRY_INTERVAL=2

for i in $(seq 1 $MAX_RETRIES); do
  if curl -s "http://${MLX_HOST}:${MLX_PORT}/v1/models" >/dev/null 2>&1; then
    echo "MLX server is ready on ${MLX_HOST}:${MLX_PORT}"
    exit 0
  fi
  sleep "$RETRY_INTERVAL"
done

echo "ERROR: MLX server did not become ready after $((MAX_RETRIES * RETRY_INTERVAL))s"
exit 1
