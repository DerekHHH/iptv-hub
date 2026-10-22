#!/data/data/com.termux/files/usr/bin/bash
# 在手机本地测活并生成电视源，然后把 dist/ 与 data/ 推回 GitHub 与 Gitee。
# 用法（在 Termux 里）：bash scripts/termux-update.sh
# 只需要网络与 Node：运行时零依赖，tsx 由 npx 临时下载。
# 两个远端互为备份：任一推送失败都不影响另一个，脚本仍会正常结束。
#
# ---- 赛事直播源（可选，需要 wudaliansai 服务在跑）----
# 本仓库会顺带产出 dist/live/live.txt 与 live.m3u（足球/篮球/电竞赛事聚合源）。
# 它连不上 http://127.0.0.1:18765 就自动跳过，只打一行 info，不影响主列表。
# 想用就先在另一个 Termux 会话里把服务起起来（手动启动，无自启）：
#   cd /data/local/tmp && SSL_CERT_FILE=/data/local/tmp/ca-certificates.crt \
#     WUDALIANSAI_CACHE_DIR=/data/local/tmp/wdl-cache RUST_LOG=info \
#     nohup ./wudaliansai > /data/local/tmp/wdl.log 2>&1 &
# 排查用：curl -sS http://127.0.0.1:18765/health
#
# 产物里的播放地址默认写成**手机当前的局域网 IP**（电视/盒子靠它直连手机），
# 可用环境变量覆盖：
#   WUDALIANSAI_BASE_URL     拉列表的地址（默认 http://127.0.0.1:18765）
#   WUDALIANSAI_PUBLIC_BASE  写进产物的地址（默认自动探测局域网 IP，探测不到退回 127.0.0.1）
# 注意：地址会随产物推到公开仓库，所以只肯写局域网/回环地址，公网地址会被忽略。
# 服务监听在 0.0.0.0:18765，同一 Wi-Fi 下的设备都能访问，别在公共 Wi-Fi 里开。
set -euo pipefail

DIR="$HOME/iptv-hub"
cd "$DIR"

termux-wake-lock
trap 'termux-wake-unlock' EXIT

# 弱网下 HTTP/2 会出现 "Error in the HTTP2 framing layer"，固定用 HTTP/1.1
git config http.version HTTP/1.1

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
