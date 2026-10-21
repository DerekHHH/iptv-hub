#!/data/data/com.termux/files/usr/bin/bash
# Termux 一次性初始化：换国内镜像、装 Node/git、克隆仓库、配置提交身份。
# 用法（在 Termux 里）：bash scripts/termux-setup.sh
set -euo pipefail

REPO_URL="https://github.com/DerekHHH/iptv-hub.git"
DIR="$HOME/iptv-hub"

echo "==> 1/4 切换 Termux 软件源到清华镜像"
sed -i 's@packages.termux.dev@mirrors.tuna.tsinghua.edu.cn/termux@g' "$PREFIX/etc/apt/sources.list" || true

echo "==> 2/4 安装 Node.js LTS 与 git"
pkg update -y
pkg install -y nodejs-lts git

echo "==> 3/4 配置 npm 国内镜像"
npm config set registry https://registry.npmmirror.com

echo "==> 4/4 克隆仓库并配置提交身份"
if [ ! -d "$DIR/.git" ]; then
  git clone --depth 1 "$REPO_URL" "$DIR"
else
  git -C "$DIR" pull --rebase --autostash
fi
git -C "$DIR" config user.name "DerekHHH"
git -C "$DIR" config user.email "DerekHHH@users.noreply.github.com"
git -C "$DIR" config credential.helper store

echo
echo "初始化完成。以后更新电视源请运行："
echo "  bash $DIR/scripts/termux-update.sh"
