#!/system/bin/sh
# @file 启动 wudaliansai（幂等，重复执行不会起第二个）
#
# 这台 vivo 上 Termux 没跑，但二进制在 /data/local/tmp 且是 shell 属主，
# 可以直接由 adb shell 拉起，不需要 Termux。
#
# 关键：用 setsid 把进程脱离当前会话，这样 adb shell 断开后它依然存活
# （实测跨 adb 会话可查）。

BIN=/data/local/tmp/wudaliansai
LOG=/data/local/tmp/wdl.log
PORT=18765

if [ ! -x "$BIN" ]; then
  echo "FAIL 二进制不存在或不可执行：$BIN"
  exit 1
fi

if pgrep wudaliansai >/dev/null 2>&1; then
  echo "ALREADY 已在运行 pid=$(pgrep wudaliansai | head -1)"
  exit 0
fi

# 日志超过 1MB 就轮转，避免无限增长
if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 1048576 ]; then
  mv "$LOG" "$LOG.1"
fi

cd /data/local/tmp || exit 1
setsid "$BIN" >>"$LOG" 2>&1 &
sleep 2

if pgrep wudaliansai >/dev/null 2>&1; then
  echo "OK 已启动 pid=$(pgrep wudaliansai | head -1)（预热约 60 秒）"
else
  echo "FAIL 启动失败，看日志：$LOG"
  exit 1
fi
