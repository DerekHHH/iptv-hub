#!/data/data/com.termux/files/usr/bin/bash
# @file 看门狗：保活服务 **且** 保证产物不过期（这两件事同样重要）。
#
# 管四件事：
#   0. 上游代理 18766 不通 → 拉起 live-proxy.mjs
#   1. 网页服务 18080 不通 → 拉起 serve.mjs
#   2. 赛事服务 18765 不通 → 重启 wudaliansai
#   3. **产物超过 STALE_MIN 分钟没更新 → 触发重建**
#
# 第 3 条是血泪教训：serve.mjs 的定时器只跑 `git pull`，**根本不会重建赛事清单**
# （重建要走 POST /api/live/refresh）。于是出现「端口全通、服务全绿，产物却是三天前的」
# —— 用户打开播放器全是过期比赛和死链，体感就是"又不行了"。
#
# ## 单实例（重要）
# 用 PID 锁。早期靠 `.bashrc` 里 `pgrep -f '[w]dl-watchdog' || setsid ...` 守卫，
# 但 `A || B &` 会把整个列表放后台，并发开多个 Termux 会话时全部判成"没有"，
# 结果起了 5 个看门狗同一秒互相踢服务（日志里同一秒 4 条"重启"）。
#
# 判活只能用端口，不能用 pgrep —— Android 的 /proc 隔离让 Termux 看不到别的 uid 的进程。

# 二进制选择：Termux 里只能用复制到家目录的那份
# （SELinux 禁止 untrusted_app 执行 /data/local/tmp 的 shell_data_file）
if [ -f "$HOME/.local/wudaliansai" ] && [ -x "$HOME/.local/wudaliansai" ]; then
  BIN="$HOME/.local/wudaliansai"
  LOGDIR="$HOME/.local"
else
  BIN=/data/local/tmp/wudaliansai
  LOGDIR=/data/local/tmp
fi

WEB_DIR="$HOME/iptv-hub"
TXT="$WEB_DIR/dist/live/live.txt"
PORT=18765
WEB_PORT=18080
# 上游转发代理（scripts/live-proxy.mjs）。二进制自带的 DoH/TLS 栈在某些网络下
# 连不上任何上游候选域名（日志 "no domain passed API health check"），表现为
# /health 里 live_items 恒为 0、/live.m3u 返回 502。代理走手机系统网络绕开它。
PROXY_PORT=18766
INTERVAL=20
NC=/system/bin/nc

SVC_LOG="$LOGDIR/wdl.log"
WD_LOG="$LOGDIR/wdl-watchdog.log"
BEAT="$LOGDIR/wdl-watchdog.beat"
LOCKDIR="$LOGDIR/wdl-watchdog.lock.d"

# 产物多久没更新就重建（分钟）
STALE_MIN="${WDL_STALE_MIN:-30}"
# 两次重建的最小间隔（分钟），避免重建一直失败时每轮狂打
REBUILD_COOLDOWN_MIN=5
# 写进产物的对外基址。
# **默认自动探测 Wi-Fi IP**：影视仓这类播放器在取流时可能拒绝 127.0.0.1
# （列表能加载、点开播不了，就是这个现象）。用局域网 IP 最保险，
# 而且手机自己访问自己的 Wi-Fi IP 也是通的。探测不到才退回回环。
if [ -n "${WDL_PUB_BASE:-}" ]; then
  PUB_BASE="$WDL_PUB_BASE"
else
  # **不能用 `ip` 命令**：Termux 里根本没装（command not found），
  # Android 自带的 /system/bin/ip 又报 "Cannot bind netlink socket: Permission denied"。
  # Node 的 os.networkInterfaces() 反而能正常读到网卡，所以借它来探测。
  WIFI_IP=$(cd "$WEB_DIR" 2>/dev/null && node -e "
const os = require('os');
const list = os.networkInterfaces().wlan0 || [];
const v4 = list.find((a) => a.family === 'IPv4' && !a.internal);
process.stdout.write(v4 ? v4.address : '');
" 2>/dev/null)
  if [ -n "$WIFI_IP" ]; then
    PUB_BASE="http://$WIFI_IP:18765"
  else
    PUB_BASE="http://127.0.0.1:18765"
  fi
fi

log() {
  echo "$(date '+%m-%d %H:%M:%S') $*" >>"$WD_LOG"
}

port_open() {
  "$NC" -z -w 3 127.0.0.1 "$1" >/dev/null 2>&1
}

# ---------- 单实例锁（必须原子 + 防"空 pid 窗口"）----------
# 只用 mkdir 还不够：A 建好目录但还没写 pid 的那一瞬间，B 会读不到 pid、
# 误判成"陈旧锁"然后把 A 的锁删掉，结果两个都跑起来（实测 4 个起来剩 2 个）。
#
# 所以：拿到目录后立刻写 pid，等 0.3 秒回读确认是自己的；竞争方在 pid 为空时
# **先等 1 秒再判**，只有连续两次都读不到 pid 才认定是陈旧锁。
acquire_lock() {
  tries=0
  while [ "$tries" -lt 4 ]; do
    if mkdir "$LOCKDIR" 2>/dev/null; then
      printf '%s' "$$" >"$LOCKDIR/pid"
      sleep 0.3
      if [ "$(cat "$LOCKDIR/pid" 2>/dev/null)" = "$$" ]; then
        return 0
      fi
      return 1
    fi
    other=$(cat "$LOCKDIR/pid" 2>/dev/null)
    if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
      OTHER_PID="$other"
      return 1
    fi
    # 可能是别人刚建目录、还没写 pid，等一下再看
    sleep 1
    other=$(cat "$LOCKDIR/pid" 2>/dev/null)
    if [ -n "$other" ] && kill -0 "$other" 2>/dev/null; then
      OTHER_PID="$other"
      return 1
    fi
    # 连续两次都拿不到 pid → 判定陈旧锁，清掉重抢
    rm -rf "$LOCKDIR" 2>/dev/null
    tries=$((tries + 1))
  done
  return 1
}

if ! acquire_lock; then
  echo "已有看门狗在跑${OTHER_PID:+（pid=$OTHER_PID）}，本实例退出"
  exit 0
fi
trap 'rm -rf "$LOCKDIR"' EXIT INT TERM

# ---------- 重建 ----------
last_rebuild=0
# 重启后到什么时候为止不再查赛事端口（等预热）
SKIP_UNTIL=0

rebuild() {
  reason="$1"
  now=$(date +%s)
  if [ $((now - last_rebuild)) -lt $((REBUILD_COOLDOWN_MIN * 60)) ]; then
    return 0
  fi
  last_rebuild=$now
  log "重建：$reason"
  (
    cd "$WEB_DIR" || exit 1
    IPTV_ALLOW_LOOPBACK_BASE=1 WUDALIANSAI_PUBLIC_BASE="$PUB_BASE" \
      npm run build:live >>"$LOGDIR/rebuild.log" 2>&1
  )
  if [ -f "$TXT" ]; then
    log "重建完成，产物 $(date -r "$TXT" '+%m-%d %H:%M') / $(wc -c <"$TXT") 字节"
  else
    log "重建结束但产物不存在，看 $LOGDIR/rebuild.log"
  fi
}

# ---------- 重启赛事服务 ----------
restart_service() {
  log "重启赛事服务：$1"
  pkill -9 wudaliansai 2>/dev/null
  sleep 2
  if port_open "$PORT"; then
    log "端口仍被占用（可能是别的 uid 起的），本轮放弃"
    return 1
  fi
  cd "$LOGDIR" || return 1
  # **必须带 http://**：只写 `127.0.0.1:18766` 会被二进制当成域名走 TLS，
  # 连到 HTTP 代理上必然握手失败（实测 /health 里 live_items 仍是 0）。
  WUDALIANSAI_DOMAIN="http://127.0.0.1:$PROXY_PORT" \
  KGQ_DOMAIN="http://127.0.0.1:$PROXY_PORT" \
    setsid "$BIN" >>"$SVC_LOG" 2>&1 &
  # 预热约 60 秒。**不能在这里 sleep 60**：bash 在等前台子进程时不会立刻响应
  # SIGTERM，导致 `pkill` 杀不掉正在 sleep 的看门狗，它们睡醒后继续抢服务
  # （实测因此同时存在 5 个）。改成设一个跳过窗口，主循环保持可响应。
  SKIP_UNTIL=$(( $(date +%s) + 60 ))
}

log "看门狗启动 pid=$$，间隔 ${INTERVAL}s，产物过期阈值 ${STALE_MIN} 分钟，基址 $PUB_BASE"

while true; do
  # 心跳：让「看门狗是否活着」也能跨 uid 判断
  date +%s >"$BEAT" 2>/dev/null

  # 日志防涨
  if [ -f "$WD_LOG" ] && [ "$(wc -c <"$WD_LOG")" -gt 262144 ]; then
    tail -200 "$WD_LOG" >"$WD_LOG.tmp" && mv "$WD_LOG.tmp" "$WD_LOG"
  fi

  # 0) 上游代理（没有它，赛事服务会 502、live_items 恒为 0）
  if ! port_open "$PROXY_PORT"; then
    if [ -f "$WEB_DIR/scripts/live-proxy.mjs" ]; then
      log "上游代理不通，拉起 live-proxy.mjs"
      ( cd "$WEB_DIR" && setsid node scripts/live-proxy.mjs >>"$LOGDIR/proxy.log" 2>&1 & )
      sleep 2
    fi
  fi

  # 1) 网页服务（影视仓订阅的产物由它提供）
  if ! port_open "$WEB_PORT"; then
    if [ -f "$WEB_DIR/scripts/serve.mjs" ]; then
      log "网页服务不通，拉起 serve.mjs"
      # SERVE_HOST=0.0.0.0：让同一局域网里的电视也能取列表；
      # 本机用 127.0.0.1 访问依然有效。
      ( cd "$WEB_DIR" && SERVE_HOST=0.0.0.0 \
          IPTV_ALLOW_LOOPBACK_BASE=1 WUDALIANSAI_PUBLIC_BASE="$PUB_BASE" \
          setsid node scripts/serve.mjs >>"$LOGDIR/serve.log" 2>&1 & )
      sleep 3
    fi
  fi

  # 2) 赛事服务（刚重启过就先让子弹飞一会儿，别在预热期误判）
  if [ "$(date +%s)" -lt "$SKIP_UNTIL" ]; then
    :
  elif ! port_open "$PORT"; then
    restart_service "端口 $PORT 不通"
  else
    # 缓存保温：请求一次列表，触发服务内部 90s TTL 的刷新路径
    printf 'GET /live.m3u HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n' \
      | "$NC" -w 5 127.0.0.1 "$PORT" >/dev/null 2>&1
  fi

  # 3) 产物新鲜度（最容易漏、也最影响体验的一条）
  if [ -f "$TXT" ]; then
    mtime=$(stat -c %Y "$TXT" 2>/dev/null || echo 0)
    age_min=$(( ($(date +%s) - mtime) / 60 ))
    if [ "$age_min" -ge "$STALE_MIN" ]; then
      rebuild "产物已 ${age_min} 分钟未更新（阈值 ${STALE_MIN}）"
    fi
  else
    rebuild "产物不存在"
  fi

  sleep "$INTERVAL"
done
