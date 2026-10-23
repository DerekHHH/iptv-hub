#!/data/data/com.termux/files/usr/bin/bash
# @file 本机服务的开关。
#
# 用法：
#   bash scripts/toggle.sh web      # 切换网页服务（开→关 / 关→开）
#   bash scripts/toggle.sh live     # 切换赛事服务
#   bash scripts/toggle.sh status   # 查看当前状态
#   bash scripts/toggle.sh web on   # 明确置为开启
#   bash scripts/toggle.sh live off # 明确置为关闭
#
# 设计：开关只负责改一个**状态文件**（~/.local/state/iptv-hub/*.state），
# 真正的启停由看门狗（scripts/watchdog.sh）按状态对齐。
# 这样不会出现"命令说关了、进程其实还在"的情况，进程状态永远是实际状态。

PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$PATH"
STATE_DIR="$HOME/.local/state/iptv-hub"
PORT="${SERVE_PORT:-18080}"
DIR="${IPTV_DIR:-$HOME/iptv-hub}"
mkdir -p "$STATE_DIR"

get_state() {
  local file="$STATE_DIR/$1.state"
  if [ -f "$file" ]; then cat "$file"; else echo "off"; fi
}
set_state() {
  echo "$2" >"$STATE_DIR/$1.state"
}

# 真实在跑吗（问服务自己，不猜进程）
is_running() {
  case "$1" in
    web)  curl -sS -m 5 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 ;;
    live) curl -sS -m 5 "http://127.0.0.1:18765/health" >/dev/null 2>&1 ;;
    *)    return 1 ;;
  esac
}

label_of() {
  case "$1" in
    web)  echo "网页服务" ;;
    live) echo "赛事服务" ;;
    *)    echo "$1" ;;
  esac
}

# 看门狗是 Termux 会话的子进程：会话一旦重启（强杀 Termux、应用被系统回收），
# 它就没了，此时光改状态文件没人执行。开关命令必须自己保证它在跑。
ensure_watchdog() {
  if pgrep -f "scripts/watchdog.sh" >/dev/null 2>&1; then
    return 0
  fi
  local script="$DIR/scripts/watchdog.sh"
  if [ ! -f "$script" ]; then
    return 1
  fi
  nohup bash "$script" >>"$HOME/watchdog.log" 2>&1 &
  sleep 2
  return 0
}

show_status() {
  printf '%-8s 状态=%-4s 实际运行=%s\n' "网页" "$(get_state web)" "$(is_running web && echo 是 || echo 否)"
  printf '%-8s 状态=%-4s 实际运行=%s\n' "赛事" "$(get_state live)" "$(is_running live && echo 是 || echo 否)"
  local last="$STATE_DIR/web.last"
  if [ -f "$last" ]; then
    local age=$(( ($(date +%s) - $(stat -c %Y "$last" 2>/dev/null || echo 0)) / 60 ))
    echo "网页最近一次访问：${age} 分钟前"
  fi
}

case "${1:-status}" in
  web|live)
    target="$1"
    want="${2:-toggle}"
    if [ "$want" = "toggle" ]; then
      if [ "$(get_state "$target")" = "on" ]; then want="off"; else want="on"; fi
    fi
    set_state "$target" "$want"
    if ensure_watchdog; then
      echo "$(label_of "$target") 已设为 $want（看门狗会在几秒内对齐）"
    else
      echo "$(label_of "$target") 已设为 $want，但看门狗没起来：请手动执行 scripts/watchdog.sh" >&2
    fi
    ;;
  status)
    show_status
    ;;
  *)
    echo "用法: bash scripts/toggle.sh {web|live} [on|off|status]" >&2
    exit 1
    ;;
esac
