#!/usr/bin/env bash
# 用法:
#   ./service.sh start    启动前后端
#   ./service.sh stop     停止前后端
#   ./service.sh restart  重启前后端
#   ./service.sh status   查看运行状态

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$SCRIPT_DIR/rag-evaluation-backend"
FRONTEND_DIR="$SCRIPT_DIR/rag-evaluation-frontend"
VENV_DIR="$SCRIPT_DIR/.venv"

BACKEND_PID_FILE="$SCRIPT_DIR/.backend.pid"
FRONTEND_PID_FILE="$SCRIPT_DIR/.frontend.pid"
BACKEND_LOG="$SCRIPT_DIR/backend.log"
FRONTEND_LOG="$SCRIPT_DIR/frontend.log"

# 激活虚拟环境
activate_venv() {
  if [ ! -f "$VENV_DIR/bin/activate" ]; then
    echo "错误：未找到虚拟环境 $VENV_DIR"
    echo "请先运行: python3 -m venv .venv && source .venv/bin/activate && pip install -r rag-evaluation-backend/requirements.txt"
    exit 1
  fi
  source "$VENV_DIR/bin/activate"
}

start_backend() {
  if [ -f "$BACKEND_PID_FILE" ] && kill -0 "$(cat "$BACKEND_PID_FILE")" 2>/dev/null; then
    echo "后端已在运行 (PID: $(cat "$BACKEND_PID_FILE"))"
    return
  fi
  echo "启动后端..."
  activate_venv
  cd "$BACKEND_DIR"
  nohup uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload \
    >> "$BACKEND_LOG" 2>&1 &
  echo $! > "$BACKEND_PID_FILE"
  echo "后端已启动 (PID: $(cat "$BACKEND_PID_FILE")，日志: $BACKEND_LOG)"
}

start_frontend() {
  if [ -f "$FRONTEND_PID_FILE" ] && kill -0 "$(cat "$FRONTEND_PID_FILE")" 2>/dev/null; then
    echo "前端已在运行 (PID: $(cat "$FRONTEND_PID_FILE"))"
    return
  fi
  echo "启动前端..."
  cd "$FRONTEND_DIR"
  nohup npm run dev >> "$FRONTEND_LOG" 2>&1 &
  echo $! > "$FRONTEND_PID_FILE"
  echo "前端已启动 (PID: $(cat "$FRONTEND_PID_FILE")，日志: $FRONTEND_LOG)"
}

stop_service() {
  local name=$1
  local pid_file=$2
  if [ -f "$pid_file" ]; then
    local pid
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid"
      echo "$name 已停止 (PID: $pid)"
    else
      echo "$name 未在运行"
    fi
    rm -f "$pid_file"
  else
    echo "$name 未在运行"
  fi
}

show_status() {
  for entry in "后端:$BACKEND_PID_FILE" "前端:$FRONTEND_PID_FILE"; do
    local name="${entry%%:*}"
    local pid_file="${entry##*:}"
    if [ -f "$pid_file" ] && kill -0 "$(cat "$pid_file")" 2>/dev/null; then
      echo "$name：运行中 (PID: $(cat "$pid_file"))"
    else
      echo "$name：已停止"
    fi
  done
}

case "${1:-}" in
  start)
    start_backend
    start_frontend
    ;;
  stop)
    stop_service "后端" "$BACKEND_PID_FILE"
    stop_service "前端" "$FRONTEND_PID_FILE"
    ;;
  restart)
    stop_service "后端" "$BACKEND_PID_FILE"
    stop_service "前端" "$FRONTEND_PID_FILE"
    sleep 1
    start_backend
    start_frontend
    ;;
  status)
    show_status
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status}"
    exit 1
    ;;
esac
