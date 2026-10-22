#!/data/data/com.termux/files/usr/bin/bash
# 在手机本地测活并生成电视源，然后把 dist/ 与 data/ 推回 GitHub 与 Gitee。
# 用法（在 Termux 里）：bash scripts/termux-update.sh
# 只需要网络与 Node：运行时零依赖，tsx 由 npx 临时下载。
# 两个远端互为备份：任一推送失败都不影响另一个，脚本仍会正常结束。
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
