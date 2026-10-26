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
# 服务二进制仍留在 /data/local/tmp/wudaliansai（Termux 有执行权限，不用复制）。

set -u

HOME_DIR=/data/data/com.termux/files/home
BIN="$HOME_DIR/bin"
BOOT="$HOME_DIR/.termux/boot"
SRC=/data/local/tmp

echo "=== 1. 装开关脚本到 ~/bin ==="
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

# 再放一个更顺手的单入口：wdl on|off|status
cat >"$BIN/wdl.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/bash
# 赛事服务开关：wdl on | off | status
case "${1:-status}" in
  on)     bash "$HOME/bin/wdl-on.sh" ;;
  off)    bash "$HOME/bin/wdl-off.sh" ;;
  status)
    pid=$(pgrep wudaliansai | head -1)
    [ -n "$pid" ] && echo "服务   运行中 (pid=$pid)" || echo "服务   未运行"
    pgrep -f '[w]dl-watchdog' >/dev/null 2>&1 && echo "看门狗 运行中" || echo "看门狗 未运行"
    ;;
  *) echo "用法: wdl on|off|status" ;;
esac
EOF
chmod 755 "$BIN/wdl.sh"
echo "  ~/bin/wdl.sh（wdl on / off / status）"

echo "=== 2. 写开机脚本（供 Termux:Boot 调用）==="
mkdir -p "$BOOT"
cat >"$BOOT/start-iptv.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
# 开机时由 Termux:Boot 执行
pgrep wudaliansai >/dev/null 2>&1 || setsid /data/local/tmp/wudaliansai >>/data/local/tmp/wdl.log 2>&1 &
sleep 1
pgrep -f '[w]dl-watchdog' >/dev/null 2>&1 || setsid sh /data/local/tmp/wdl-watchdog.sh >/dev/null 2>&1 &
EOF
chmod 755 "$BOOT/start-iptv.sh"
echo "  ~/.termux/boot/start-iptv.sh"

echo "=== 3. 挂钩 .bashrc（打开 Termux 就自动跑）==="
touch "$HOME_DIR/.bashrc"
if grep -q 'iptv-autostart' "$HOME_DIR/.bashrc" 2>/dev/null; then
  echo "  已存在，跳过"
else
  cat >>"$HOME_DIR/.bashrc" <<'EOF'

# iptv-autostart：打开 Termux 就确保赛事服务和看门狗在跑
pgrep wudaliansai >/dev/null 2>&1 || setsid /data/local/tmp/wudaliansai >>/data/local/tmp/wdl.log 2>&1 &
pgrep -f '[w]dl-watchdog' >/dev/null 2>&1 || setsid sh /data/local/tmp/wdl-watchdog.sh >/dev/null 2>&1 &
EOF
  echo "  已写入"
fi

echo
echo "=== 完成，当前状态 ==="
bash "$BIN/wdl.sh" status
echo
echo "以后在 Termux 里：wdl on / wdl off / wdl status"
echo "重启后：装了 Termux:Boot 就全自动；没装的话打开一次 Termux 即可。"
