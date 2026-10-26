#!/system/bin/sh
# @file 看门狗：保活 wudaliansai，并每轮敲一次列表让缓存保持热。
#
# 检查逻辑（顺序很重要）：
#   1. 进程在不在 —— 不在就重启
#   2. 端口通不通 —— **进程在但不响应 == 卡死**，这种情况只看进程会漏，
#      必须打端口（这台设备没有 curl，用 nc -z 做纯 TCP 探测）
#   3. 每轮请求一次 /live.m3u，让服务自己的 90 秒缓存保持新鲜
#
# 启动方式（必须脱离会话，否则 adb 一断就死）：
#   adb shell "cd /data/local/tmp && setsid ./wdl-watchdog.sh >/dev/null 2>&1 &"
#
# 停止：
#   adb shell "pkill -f wdl-watchdog.sh"

BIN=/data/local/tmp/wudaliansai
SVC_LOG=/data/local/tmp/wdl.log
WD_LOG=/data/local/tmp/wdl-watchdog.log
PORT=18765
INTERVAL=20

log() {
  echo "$(date '+%m-%d %H:%M:%S') $*" >>"$WD_LOG"
}

restart() {
  log "重启：$1"
  pkill -9 wudaliansai 2>/dev/null
  sleep 2
  cd /data/local/tmp || return 1
  setsid "$BIN" >>"$SVC_LOG" 2>&1 &
  # 预热约 60 秒，给足时间再进入下一轮，避免误判连续重启
  sleep 60
}

log "看门狗启动 pid=$$，间隔 ${INTERVAL}s"

while true; do
  # 日志防涨：超过 256KB 就截断重来
  if [ -f "$WD_LOG" ] && [ "$(wc -c < "$WD_LOG")" -gt 262144 ]; then
    tail -200 "$WD_LOG" >"$WD_LOG.tmp" && mv "$WD_LOG.tmp" "$WD_LOG"
  fi

  if ! pgrep wudaliansai >/dev/null 2>&1; then
    restart "进程不在"
  elif ! nc -z -w 3 127.0.0.1 "$PORT" >/dev/null 2>&1; then
    restart "端口 $PORT 不通（进程在但不响应）"
  else
    # 缓存保温：请求一次列表，触发服务内部 90s TTL 的刷新路径
    # 用 nc 自带的 -w 超时（这台设备没有 timeout 命令）
    printf 'GET /live.m3u HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n' \
      | nc -w 5 127.0.0.1 "$PORT" >/dev/null 2>&1
  fi

  sleep "$INTERVAL"
done
