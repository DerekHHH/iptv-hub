#!/data/data/com.termux/files/usr/bin/bash
# 在手机上启动本机服务：浏览器打开 http://127.0.0.1:18080 就能用，不再依赖 github.io。
#
# 用法（Termux 里）：
#   bash scripts/termux-serve.sh
#
# 想让它后台常驻，用 tmux（推荐，关掉 Termux 窗口也不会断）：
#   tmux new -s iptv
#   bash scripts/termux-serve.sh
#   # 按 Ctrl+B 再按 D 脱离；回来用 tmux attach -t iptv
#
# 开机自启（可选）：
#   在 ~/.termux/boot/ 里建一个文件，内容就一行：
#     bash ~/iptv/scripts/termux-serve.sh
#   然后在系统设置里允许 Termux 自启动。
#
# 端口被占用就换一个：
#   SERVE_PORT=18081 bash scripts/termux-serve.sh
#
# 注意：本服务只绑 127.0.0.1，只有这台手机打得开。
# 电视要看赛事走的是另一个进程（wudaliansai 自己的 0.0.0.0:18765），互不影响。

set -euo pipefail

# 仓库根目录从脚本自身位置推导，不写死路径。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${IPTV_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$DIR"

PORT="${SERVE_PORT:-18080}"

# 防止系统休眠把服务杀掉（需要 termux-api 组件，没装就跳过）。
termux-wake-lock 2>/dev/null || true

# ---- 赛事服务（可选）--------------------------------------------------
# wudaliansai 是跑在本机的闭源服务：/live.m3u 给赛事列表，/play/{key} 302 到
# 带时效签名的真实流（auth_key 约 90 秒），所以它必须常驻，赛事源才有效。
# 首次运行需要先用 adb 把二进制推到 /data/local/tmp。
WDL_HOME="$HOME/.local/wudaliansai"
WDL_BIN="$WDL_HOME/wudaliansai"
WDL_CERT="$WDL_HOME/ca-certificates.crt"

if [ ! -x "$WDL_BIN" ] && [ -f /data/local/tmp/wudaliansai ]; then
    mkdir -p "$WDL_HOME"
    cp /data/local/tmp/wudaliansai "$WDL_BIN"
    cp /data/local/tmp/ca-certificates.crt "$WDL_CERT" 2>/dev/null || true
    chmod 755 "$WDL_BIN"
    echo "[serve] 已把赛事服务复制到 $WDL_BIN"
fi

if [ -x "$WDL_BIN" ]; then
    if curl -sS -m 3 "http://127.0.0.1:18765/health" >/dev/null 2>&1; then
        echo "[serve] 赛事服务已在运行"
    else
        echo "[serve] 启动赛事服务…"
        ( cd "$WDL_HOME" && ./wudaliansai >/dev/null 2>&1 & )
        sleep 3
        curl -sS -m 5 "http://127.0.0.1:18765/health" 2>/dev/null \
            && echo "[serve] 赛事服务就绪" \
            || echo "[serve] 赛事服务没起来，赛事刷新会失败，主列表不受影响"
    fi
else
    echo "[serve] 没找到赛事服务二进制，赛事刷新不可用（主列表不受影响）"
fi

# ---- 本机服务 ----------------------------------------------------------
# 只补缺的部分：`dist/` 是入库的（Actions 每 2 小时更新并提交），
# 所以正常情况下不需要重跑主列表那 4~6 分钟的全量构建。
if [ ! -f site/index.html ]; then
    echo "[serve] 构建网页…"
    npm run web:build
fi

if [ ! -f dist/stats.json ]; then
    echo "[serve] 没有产物，跑一次全量构建（约 4~6 分钟）…"
    npm run build || echo "[serve] 构建失败，先用已有产物"
fi

npm run pages:assemble

echo "[serve] 浏览器打开： http://127.0.0.1:${PORT}"
exec env SERVE_PORT="$PORT" node scripts/serve.mjs