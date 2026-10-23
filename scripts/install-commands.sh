#!/data/data/com.termux/files/usr/bin/bash
# @file 安装开关命令，让 `web.sh` / `live.sh` 可以直接敲。
#
# 关键：**装到 $PREFIX/bin**（Termux 默认就在 PATH 里）。
# 之前只放在 ~/bin，而 Termux 的 PATH 不含 ~/bin → 敲 web.sh 会报
# "No command web.sh found"。这里两处都放，并把 ~/bin 加进 ~/.bashrc。
#
# 用法：bash scripts/install-commands.sh

PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$PATH"
DIR="${IPTV_DIR:-$HOME/iptv-hub}"
SRC="$DIR/scripts"

for name in web live; do
  if [ ! -f "$SRC/$name.sh" ]; then
    echo "缺少 $SRC/$name.sh，跳过" >&2
    continue
  fi
  # $PREFIX/bin：本来就在 PATH 里，装完当前这个终端就能用
  cp "$SRC/$name.sh" "$PREFIX/bin/$name.sh"
  chmod 755 "$PREFIX/bin/$name.sh"
  # ~/bin：习惯位置
  mkdir -p "$HOME/bin"
  cp "$SRC/$name.sh" "$HOME/bin/$name.sh"
  chmod 755 "$HOME/bin/$name.sh"
done

# 确保 ~/bin 在 PATH 里（对新开的终端生效）
if ! grep -q 'HOME/bin' "$HOME/.bashrc" 2>/dev/null; then
  echo 'export PATH="$HOME/bin:$PATH"' >>"$HOME/.bashrc"
fi

# 通知栏快捷方式（下拉通知栏就能点）
mkdir -p "$HOME/.termux/shortcuts"
cat > "$HOME/.termux/shortcuts/网页服务.sh" <<'SH'
#!/data/data/com.termux/files/usr/bin/bash
/data/data/com.termux/files/usr/bin/web.sh
SH
cat > "$HOME/.termux/shortcuts/赛事服务.sh" <<'SH'
#!/data/data/com.termux/files/usr/bin/bash
/data/data/com.termux/files/usr/bin/live.sh
SH
chmod 755 "$HOME/.termux/shortcuts/"*.sh

echo "已安装："
command -v web.sh
command -v live.sh
