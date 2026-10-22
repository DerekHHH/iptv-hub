#!/data/data/com.termux/files/usr/bin/bash
# 在手机本地测活并生成电视源，然后把 dist/ 与 data/ 推回 GitHub 与 Gitee。
# 用法（在 Termux 里）：bash scripts/termux-update.sh
# 只需要网络与 Node：运行时零依赖，tsx 由 npx 临时下载。
# 两个远端互为备份：任一推送失败都不影响另一个，脚本仍会正常结束。
#
# ---- 赛事直播源（可选，脚本会自动把 wudaliansai 服务带起来）----
# 本仓库会顺带产出 dist/live/live.txt 与 live.m3u（足球/篮球/电竞赛事聚合源）。
# 服务连不上就自动跳过，只打一行 info，不影响主列表。
#
# 为什么不在 /data/local/tmp 里直接跑：那是 adb（shell 用户）推二进制的地方，
# Termux 属于 untrusted_app，Android 的 SELinux 一般不允许从那里执行程序。
# 所以首次运行会把二进制复制到 $HOME/.local/（Termux 自己的目录）再启动。
# 前提（只需做一次）：先用 adb 把二进制和证书推到 /data/local/tmp，见 wudaliansai 集成指南。
#
# 产物里的播放地址默认写成**手机当前的局域网 IP**（电视/盒子靠它直连手机），
# 可用环境变量覆盖：
#   WUDALIANSAI_BASE_URL     拉列表的地址（默认 http://127.0.0.1:18765）
#   WUDALIANSAI_PUBLIC_BASE  写进产物的地址（默认自动探测局域网 IP，探测不到退回 127.0.0.1）
# 注意：地址会随产物推到公开仓库，所以只肯写局域网/回环地址，公网地址会被忽略。
# 服务监听在 0.0.0.0:18765，同一 Wi-Fi 下的设备都能访问，别在公共 Wi-Fi 里开。
set -euo pipefail

# 仓库根目录从脚本自身位置推导，不写死路径。
# 之前写死 $HOME/iptv-hub，结果克隆到别的名字（比如 ~/iptv）时直接 cd 失败。
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIR="${IPTV_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
cd "$DIR"

# 赛事服务的本地落点（放 Termux 家目录才能被执行）
WDL_PORT=18765
WDL_HOME="$HOME/.local/wudaliansai"
WDL_BIN="$WDL_HOME/wudaliansai"
WDL_CERT="$WDL_HOME/ca-certificates.crt"
WDL_CACHE="$WDL_HOME/cache"
WDL_LOG="$WDL_HOME/wdl.log"

termux-wake-lock
trap 'termux-wake-unlock' EXIT

# 弱网下 HTTP/2 会出现 "Error in the HTTP2 framing layer"，固定用 HTTP/1.1
git config http.version HTTP/1.1

# 健康探针：用 node 内置 fetch，避免多装一个 curl 依赖
wdl_health() {
  node -e "fetch('http://127.0.0.1:$WDL_PORT/health',{signal:AbortSignal.timeout(3000)}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null
}

echo "==> 0/4 检查赛事服务"
if wdl_health; then
  echo "    服务已在运行，直接复用"
else
  # 首次运行：从 adb 推送的位置搬一份到 Termux 家目录
  if [ ! -x "$WDL_BIN" ] && [ -f /data/local/tmp/wudaliansai ]; then
    mkdir -p "$WDL_HOME"
    cp /data/local/tmp/wudaliansai "$WDL_BIN"
    cp /data/local/tmp/ca-certificates.crt "$WDL_CERT" 2>/dev/null || true
    chmod 755 "$WDL_BIN"
    echo "    已复制服务到 $WDL_BIN"
  fi
  if [ -x "$WDL_BIN" ]; then
    mkdir -p "$WDL_CACHE"
    (
      cd "$WDL_HOME"
      SSL_CERT_FILE="$WDL_CERT" WUDALIANSAI_CACHE_DIR="$WDL_CACHE" RUST_LOG=info \
        nohup ./wudaliansai > "$WDL_LOG" 2>&1 &
    )
    ok=no
    for _ in $(seq 1 30); do
      sleep 2
      if wdl_health; then
        ok=yes
        break
      fi
    done
    if [ "$ok" = yes ]; then
      echo "    服务已启动（预热完成）"
    else
      echo "    服务启动超时，本次赛事直播源会被跳过；日志：$WDL_LOG"
    fi
  else
    echo "    未找到 wudaliansai 二进制，本次跳过赛事直播源"
  fi
fi

echo "==> 1/4 拉取最新代码"
git pull --rebase --autostash || echo "！GitHub 拉取失败，继续用本地现有代码构建"

echo "==> 2/4 本地测活并生成产物（约 5-10 分钟，请保持 Termux 在前台）"
npx --yes tsx src/main.ts

echo "==> 3/4 检查将要提交的文件"
git add -A dist data
if git diff --cached --quiet; then
  echo "产物没有变化，跳过提交"
  exit 0
fi
git status --short

echo "==> 4/4 提交并推送到 GitHub 与 Gitee"
git commit -m "chore(data): 手机本地测活更新 $(date +'%Y-%m-%d %H:%M')"
git push origin main || echo "！GitHub 推送失败（可稍后重试，Gitee 不受影响）"

if git remote get-url gitee >/dev/null 2>&1; then
  git push gitee main || echo "！Gitee 推送失败（可稍后重试，GitHub 不受影响）"
else
  echo "！未配置 gitee 远端，已跳过。配置命令："
  echo "  git remote add gitee https://gitee.com/<你的Gitee用户名>/iptv-hub.git"
fi

echo
echo "完成：到影视仓里刷新一下直播源即可。"
