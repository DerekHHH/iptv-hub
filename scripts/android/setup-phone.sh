#!/data/data/com.termux/files/usr/bin/bash
# @file 一次性把「赛事服务 + 看门狗 + 自动启动」装进 Termux。
#
# 在 Termux 里执行一行：
#   bash /data/local/tmp/setup-phone.sh
#
# 做完之后：
#   · 打开 Termux 就自动保证服务和看门狗在跑（.bashrc 里加的钩子）
#   · 装了 Termux:Boot 的话，**开机自动跑**，连 Termux 都不用点
#   · 电脑完全不需要参与
#
# 两个关键点（都是实测踩出来的）：
#   1. **二进制必须复制进 Termux 家目录**。SELinux 禁止 untrusted_app 执行
#      /data/local/tmp 里的 shell_data_file，权限位是 755 也照样被拒。
#   2. **判活只能用端口**（/system/bin/nc），不能用 pgrep —— Android 的 /proc
#      隔离让 Termux 看不到别的 uid 的进程，pgrep 会误判成"没在跑"。

set -u

HOME_DIR=/data/data/com.termux/files/home
BIN="$HOME_DIR/bin"
BOOT="$HOME_DIR/.termux/boot"
SRC=/data/local/tmp

echo "=== 1. 把二进制复制进 Termux 家目录 ==="
# 关键：Android 的 SELinux 禁止 untrusted_app 执行 /data/local/tmp 里的
# shell_data_file（即使权限位是 755，执行也会被拒）。
# 复制到自己家目录后属主是 Termux，才能正常执行。
#
# 坑：目标路径历史上被误建成了**同名目录**，这时 cp 会把文件塞进目录里，
# 而 [ -x 目录 ] 也返回 true —— 表现为「二进制不存在/不可执行」。
# 所以必须用 -f 判断，并先清掉同名目录。
mkdir -p "$HOME_DIR/.local"
BIN_TARGET="$HOME_DIR/.local/wudaliansai"
if [ -d "$BIN_TARGET" ]; then
  echo "  发现同名目录（历史遗留），清理掉"
  rm -rf "$BIN_TARGET"
fi
if [ -f "$BIN_TARGET" ] && [ -x "$BIN_TARGET" ]; then
  echo "  已存在，跳过（想强制刷新先删掉它）"
else
  if cp "$SRC/wudaliansai" "$BIN_TARGET" 2>/dev/null; then
    chmod 755 "$BIN_TARGET"
    echo "  ~/.local/wudaliansai（$(wc -c <"$BIN_TARGET") 字节）"
  else
    echo "  复制失败：读不到 $SRC/wudaliansai"
  fi
fi

echo "=== 2. 装开关脚本到 ~/bin ==="
mkdir -p "$BIN"
for f in wdl-on.sh wdl-off.sh wdl-watchdog.sh; do
  if [ ! -f "$SRC/$f" ]; then
    echo "  缺少 $SRC/$f，跳过"
    continue
  fi
  cp "$SRC/$f" "$BIN/$f"
  chmod 755 "$BIN/$f"
  echo "  ~/bin/$f"
done

# 单入口：wdl on|off|status
cat >"$BIN/wdl.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# 赛事服务开关：wdl on | off | status
# 判据用端口和心跳文件，不用 pgrep —— Termux 看不到别的 uid 的进程
BIN_DIR=/data/data/com.termux/files/home/bin
NC=/system/bin/nc

port_open() { "$NC" -z -w 2 127.0.0.1 18765 >/dev/null 2>&1; }

watchdog_alive() {
  # 心跳文件可能在两个位置（看门狗的身份不同），都查
  for beat in "$HOME/.local/wdl-watchdog.beat" /data/local/tmp/wdl-watchdog.beat; do
    [ -f "$beat" ] || continue
    age=$(( $(date +%s) - $(cat "$beat" 2>/dev/null || echo 0) ))
    [ "$age" -lt 90 ] && return 0
  done
  return 1
}

case "${1:-status}" in
  on)
    bash "$BIN_DIR/wdl-on.sh"
    # 顺带保证看门狗在跑（掉了自动回来 + 缓存保温）
    if ! watchdog_alive; then
      setsid bash "$BIN_DIR/wdl-watchdog.sh" >/dev/null 2>&1 &
      sleep 2
      if watchdog_alive; then echo "看门狗 已启动"; else echo "看门狗 启动失败"; fi
    else
      echo "看门狗 已在运行"
    fi
    ;;
  off) bash "$BIN_DIR/wdl-off.sh" ;;
  status)
    if port_open; then echo "服务   运行中（端口 18765 已监听）"; else echo "服务   未运行"; fi
    if watchdog_alive; then echo "看门狗 运行中"; else echo "看门狗 未运行"; fi
    ;;
  *) echo "用法: wdl on|off|status" ;;
esac
EOF
chmod 755 "$BIN/wdl.sh"
echo "  ~/bin/wdl.sh（wdl on / off / status）"

echo "=== 3. 写开机脚本（供 Termux:Boot 调用）==="
mkdir -p "$BOOT"
cat >"$BOOT/start-iptv.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# 开机时由 Termux:Boot 执行
BIN_DIR=/data/data/com.termux/files/home/bin
bash "$BIN_DIR/wdl-on.sh" >/dev/null 2>&1
sleep 2
pgrep -f '[w]dl-watchdog' >/dev/null 2>&1 \
  || setsid bash "$BIN_DIR/wdl-watchdog.sh" >/dev/null 2>&1 &
EOF
chmod 755 "$BOOT/start-iptv.sh"
echo "  ~/.termux/boot/start-iptv.sh"

echo "=== 4. 挂钩 .bashrc（打开 Termux 就自动跑）==="
touch "$HOME_DIR/.bashrc"
# 先删掉旧块（带标记），再写新的，保证重复执行能更新
if grep -q 'iptv-autostart-begin' "$HOME_DIR/.bashrc" 2>/dev/null; then
  awk '/iptv-autostart-begin/{skip=1; next} /iptv-autostart-end/{skip=0; next} !skip{print}' \
    "$HOME_DIR/.bashrc" >"$HOME_DIR/.bashrc.tmp" && mv "$HOME_DIR/.bashrc.tmp" "$HOME_DIR/.bashrc"
fi
cat >>"$HOME_DIR/.bashrc" <<'EOF'
# iptv-autostart-begin
# 打开 Termux 就确保赛事服务和看门狗在跑（后台静默）
pgrep -f '[w]dl-watchdog' >/dev/null 2>&1 \
  || setsid bash "$HOME/bin/wdl-watchdog.sh" >/dev/null 2>&1 &
# iptv-autostart-end
EOF
echo "  已写入（带 begin/end 标记，可重复执行）"

echo
echo "=== 完成，当前状态 ==="
bash "$BIN/wdl.sh" status
echo
echo "以后在 Termux 里：wdl on / wdl off / wdl status"
echo "重启后：装了 Termux:Boot 就全自动；没装的话打开一次 Termux 即可。"
