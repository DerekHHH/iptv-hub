#!/data/data/com.termux/files/usr/bin/bash
# @file 看门狗：保活「赛事服务（18765）」和「网页服务（18080）」，并让缓存保持热。
#
# 两个服务都要管：
#   18765 = wudaliansai 抓来的上游直播清单
#   18080 = 我们自己构建的产物（带联赛分组/状态/开赛时间），影视仓订阅的是这份
#
# 判据统一用**端口**，不用 pgrep：
# Android 有 /proc 隔离，Termux（uid 10xxx）看不到 shell（uid 2000）起的进程，
# 用 pgrep 会误判「没在跑」然后重复启动，撞 EADDRINUSE。
# 端口是唯一跨 uid 成立、且真正代表「服务可用」的判据
# （进程在但事件循环停摆的情况，也只是端口不通 —— 一并覆盖）。
#
# 启动（必须脱离会话）：
#   setsid bash ~/bin/wdl-watchdog.sh >/dev/null 2>&1 &
# 停止：
#   pkill -f '[w]dl-watchdog'

# 二进制选择：Termux 里只能用复制到家目录的那份
# （SELinux 禁止 untrusted_app 执行 /data/local/tmp 的 shell_data_file）
if [ -f "$HOME/.local/wudaliansai" ] && [ -x "$HOME/.local/wudaliansai" ]; then
  BIN="$HOME/.local/wudaliansai"
  RUNDIR="$HOME/.local"
  LOGDIR="$HOME/.local"
else
  BIN=/data/local/tmp/wudaliansai
  RUNDIR=/data/local/tmp
  LOGDIR=/data/local/tmp
fi
SVC_LOG="$LOGDIR/wdl.log"
WD_LOG="$LOGDIR/wdl-watchdog.log"
WD_BEAT="$LOGDIR/wdl-watchdog.beat"
PORT=18765
WEB_PORT=18080
WEB_DIR="$HOME/iptv-hub"
INTERVAL=20
NC=/system/bin/nc

log() {
  echo "$(date '+%m-%d %H:%M:%S') $*" >>"$WD_LOG"
}

port_open() {
  "$NC" -z -w 3 127.0.0.1 "$PORT" >/dev/null 2>&1
}

restart() {
  log "重启：$1"
  # 只能杀自己 uid 的进程；别 uid 的杀了会静默失败，下面靠端口复核
  pkill -9 wudaliansai 2>/dev/null
  sleep 2
  if port_open; then
    log "端口仍被占用（可能是别的 uid 起的服务），本轮放弃重启"
    return 1
  fi
  cd "$RUNDIR" || return 1
  setsid "$BIN" >>"$SVC_LOG" 2>&1 &
  # 预热约 60 秒，给足时间再进入下一轮，避免误判成连续重启
  sleep 60
}

log "看门狗启动 pid=$$，间隔 ${INTERVAL}s"

while true; do
  # 心跳：写一个时间戳文件。这样「看门狗还活着吗」也能跨 uid 判断
  # （Termux 看不到 shell 起的进程，pgrep 会误报未运行）
  date +%s >"$WD_BEAT" 2>/dev/null

  # 日志防涨：超过 256KB 就截断重来
  if [ -f "$WD_LOG" ] && [ "$(wc -c <"$WD_LOG")" -gt 262144 ]; then
    tail -200 "$WD_LOG" >"$WD_LOG.tmp" && mv "$WD_LOG.tmp" "$WD_LOG"
  fi

  # 网页服务（18080）也要保活：影视仓订阅的带分类/时间的那份列表由它提供。
  # 它跑的是 node scripts/serve.mjs，和赛事服务是两条独立进程，要分别看。
  if ! "$NC" -z -w 3 127.0.0.1 "$WEB_PORT" >/dev/null 2>&1; then
    if [ -f "$WEB_DIR/scripts/serve.mjs" ]; then
      log "网页服务不通，拉起 serve.mjs"
      ( cd "$WEB_DIR" && setsid node scripts/serve.mjs >>"$LOGDIR/serve.log" 2>&1 & )
      sleep 3
    fi
  fi

  if ! port_open; then
    restart "端口 $PORT 不通"
  else
    # 缓存保温：请求一次列表，触发服务内部 90s TTL 的刷新路径
    # 用 nc 自带的 -w 超时（这台设备没有 timeout 命令）
    printf 'GET /live.m3u HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n' \
      | "$NC" -w 5 127.0.0.1 "$PORT" >/dev/null 2>&1
  fi

  sleep "$INTERVAL"
done
