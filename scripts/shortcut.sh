#!/data/data/com.termux/files/usr/bin/bash
# @file 手机桌面快捷方式：切换开关，并把结果直接显示出来。
#
# Termux 会把 ~/.termux/shortcuts/ 下的每个脚本变成桌面上的一个快捷方式图标。
# 点一下 = 切换开关 + 打开对应地址：
#   · 网页服务 → 打开 http://127.0.0.1:18080 ，页面能打开就是"开"，打不开就是"关"
#   · 赛事服务 → 打开 http://127.0.0.1:18765/health ，返回 JSON 就说明在跑
#
# 装法：把本文件复制成 ~/.termux/shortcuts/<名字>.sh 并 chmod +x，
# 然后在手机桌面「长按空白处 → 快捷方式 → Termux → 选它」。

PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$PATH"
DIR="${IPTV_DIR:-$HOME/iptv-hub}"
TARGET="${1:-web}"

bash "$DIR/scripts/toggle.sh" "$TARGET"

case "$TARGET" in
  web)  URL="http://127.0.0.1:${SERVE_PORT:-18080}" ;;
  live) URL="http://127.0.0.1:18765/health" ;;
  *)    URL="http://127.0.0.1:18765/health" ;;
esac

# 给看门狗一点时间把服务启停到位
sleep 4

am start -a android.intent.action.VIEW -d "$URL" >/dev/null 2>&1
