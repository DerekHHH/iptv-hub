#!/data/data/com.termux/files/usr/bin/bash
# 一键：起本机服务 + 用手机浏览器打开。
#
# 用法（Termux 里）：
#   bash scripts/open-local.sh
#
# ⚠️ 前提：Termux 必须保持在前台。
#    vivo / 小米 / OPPO 等会在应用退到后台后限制 CPU 调度，Node 的事件循环随之停摆，
#    表现为浏览器一直转圈然后报 ERR_TIMED_OUT。看门狗也救不了（它同样在被限流的应用里）。
#    需要 24 小时常驻的赛事播放请用 wudaliansai（原生二进制，不受此限制）。

set -euo pipefail

PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$PATH"
PORT="${SERVE_PORT:-18080}"
DIR="${IPTV_DIR:-$HOME/iptv-hub}"
cd "$DIR"

# 服务没在跑就拉起来
if ! pgrep -f "scripts/serve.mjs" >/dev/null 2>&1; then
    echo "[open] 启动本机服务…"
    nohup node scripts/serve.mjs >>"$HOME/serve.log" 2>&1 &
    sleep 3
fi

# 打开浏览器（用系统默认的，Chrome / 夸克 / UC 都行）
am start -a android.intent.action.VIEW -d "http://127.0.0.1:${PORT}" >/dev/null 2>&1

echo "[open] 已打开 http://127.0.0.1:${PORT}"
echo "[open] 记得别切走 Termux，切走服务就会僵住。"
