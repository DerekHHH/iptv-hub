#!/data/data/com.termux/files/usr/bin/bash
# 在手机本地测活并生成电视源，然后把 dist/ 与 data/ 推回 GitHub。
# 用法（在 Termux 里）：bash scripts/termux-update.sh
# 只需要网络与 Node：运行时零依赖，tsx 由 npx 临时下载。
set -euo pipefail

DIR="$HOME/iptv-hub"
cd "$DIR"

termux-wake-lock
trap 'termux-wake-unlock' EXIT

echo "==> 1/4 拉取最新代码"
git pull --rebase --autostash

echo "==> 2/4 本地测活并生成产物（约 5-10 分钟，请保持 Termux 在前台）"
npx --yes tsx src/main.ts

echo "==> 3/4 检查将要提交的文件"
git add -A dist data
if git diff --cached --quiet; then
  echo "产物没有变化，跳过提交"
  exit 0
fi
git status --short

echo "==> 4/4 提交并推送到 GitHub"
git commit -m "chore(data): 手机本地测活更新 $(date +'%Y-%m-%d %H:%M')"
git push

echo
echo "完成：到影视仓里刷新一下直播源即可。"
