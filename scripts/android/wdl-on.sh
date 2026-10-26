#!/data/data/com.termux/files/usr/bin/bash
# @file 启动 wudaliansai（幂等，重复执行不会起第二个）
#
# 判断"是否已在跑"用**端口**而不是 pgrep：
# Android 有 /proc 隔离，Termux（uid 10xxx）看不到 shell（uid 2000）起的进程，
# 用 pgrep 会误判成"没在跑"然后重复启动，撞 EADDRINUSE。
# 端口是唯一跨 uid 都成立、且真正代表"服务能用"的判据。
#
# 用 /system/bin/nc 而不是裸 nc：Termux 里未必装了 nc，但 /system/bin/nc 两边都能执行。

# 二进制的选择（重要）：
# Android 的 SELinux 禁止 untrusted_app 执行 /data/local/tmp 下的 shell_data_file，
# 即使权限位是 755 也会被拒。所以 Termux 里必须用复制到家目录的那份；
# 从 adb（shell 身份）执行时才用 /data/local/tmp 的原件。
# 日志目录也要跟着身份走：/data/local/tmp 对 Termux 只读（dir 是 drwxrwx--x，
# 能穿过不能用），往那儿重定向会 Permission denied 导致进程根本起不来。
if [ -f "$HOME/.local/wudaliansai" ] && [ -x "$HOME/.local/wudaliansai" ]; then
  BIN="$HOME/.local/wudaliansai"
  RUNDIR="$HOME/.local"
  LOGDIR="$HOME/.local"
else
  BIN=/data/local/tmp/wudaliansai
  RUNDIR=/data/local/tmp
  LOGDIR=/data/local/tmp
fi
LOG="$LOGDIR/wdl.log"
PORT=18765
NC=/system/bin/nc

port_open() {
  "$NC" -z -w 2 127.0.0.1 "$PORT" >/dev/null 2>&1
}

if [ ! -x "$BIN" ]; then
  echo "FAIL 找不到可执行的二进制（$BIN）"
  echo "     请先在 Termux 里跑：bash /data/local/tmp/setup-phone.sh"
  exit 1
fi

if port_open; then
  echo "ALREADY 服务已在运行（端口 $PORT 已监听）"
  exit 0
fi

# 日志超过 1MB 就轮转，避免无限增长
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG")" -gt 1048576 ]; then
  mv "$LOG" "$LOG.1"
fi

cd "$RUNDIR" || exit 1
setsid "$BIN" >>"$LOG" 2>&1 &
sleep 3

if port_open; then
  echo "OK 已启动（预热约 60 秒，届时 /health 才会有数据）"
else
  echo "已拉起进程，但端口还没监听（预热中，约 60 秒）"
fi
