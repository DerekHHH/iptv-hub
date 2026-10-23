#!/data/data/com.termux/files/usr/bin/bash
# @file 本机网页服务开关（安装后可直接敲 `web.sh`）。
#
#   web.sh          确保开启，并自动打开浏览器（重复执行不会误关）
#   web.sh off      关闭
#   web.sh status   看状态
#
# 安装：scripts/install-commands.sh（会装到 $PREFIX/bin，那个目录本来就在 PATH 里）

PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$HOME/bin:$PATH"
DIR="${IPTV_DIR:-$HOME/iptv-hub}"
PORT="${SERVE_PORT:-18080}"

case "${1:-}" in
  off)
    bash "$DIR/scripts/toggle.sh" web off
    ;;
  status)
    bash "$DIR/scripts/toggle.sh" status
    ;;
  *)
    bash "$DIR/scripts/toggle.sh" web on
    # 等服务真的起来再开浏览器（看门狗最多 8 秒对齐一次）
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      if curl -sS -m 2 "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then break; fi
      sleep 1
    done
    am start -a android.intent.action.VIEW -d "http://127.0.0.1:${PORT}" >/dev/null 2>&1
    echo "已打开 http://127.0.0.1:${PORT}"
    ;;
esac
