#!/data/data/com.termux/files/usr/bin/bash
# @file 看门狗：按状态文件对齐两个服务（网页 / 赛事），并做自动回收。
#
# 用法：nohup bash scripts/watchdog.sh >>~/watchdog.log 2>&1 &
#
# 状态文件（由 scripts/toggle.sh 改）：
#   ~/.local/state/iptv-hub/web.state   on / off
#   ~/.local/state/iptv-hub/live.state  on / off
#
# 三个关键点（都是在这台 vivo 上实测踩出来的）：
#
# 1. **健康检查，而不是看进程存活**
#    出现过进程还在、事件循环却停摆的情况：连接能建立但服务一个字节都不回，
#    浏览器报 ERR_TIMED_OUT。只看进程存活会漏掉，必须打健康接口。
#
# 2. **心跳**（serve.mjs 里每 10 秒一次）
#    应用退到后台后，空闲进程会被厂商降级调度；保持周期性活动可以避免。
#
# 3. **termux-wake-lock**
#    息屏后 Android 的应用冻结器会冻结 Termux，wakelock 随之变成 DISABLED，
#    CPU 停摆。每轮重新申请一次即可把它拉回来。
#
# 自动回收：网页服务开着但一直没人访问（默认 30 分钟），就自己关掉。
# "有人访问"以 serve.mjs 记录的最近一次**真实页面访问**为准
# （看门狗自己的健康探测走 /api/，不计入，避免自我续命）。

PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$PATH"
cd "${IPTV_DIR:-$HOME/iptv-hub}" || exit 1

PORT="${SERVE_PORT:-18080}"
STATE_DIR="$HOME/.local/state/iptv-hub"
AUTO_CLOSE_MIN="${SERVE_AUTO_CLOSE_MIN:-30}"
mkdir -p "$STATE_DIR"

get_state() {
  local file="$STATE_DIR/$1.state"
  if [ -f "$file" ]; then cat "$file"; else echo "default"; fi
}

set_state() {
  echo "$2" >"$STATE_DIR/$1.state"
}

# 赛事服务：没设置过时默认开启。
# 理由：它是原生二进制，不受 Termux 冻结影响，也不怎么耗电，
# 而电视上的赛事直播依赖它。网页服务则默认关闭（那才是耗电和折腾的大头）。
if [ "$(get_state live)" = "default" ]; then
  set_state live on
fi

# 用 node 探测（不依赖 curl）
probe() {
  node -e "
    const url = process.argv[1];
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 5000);
    fetch(url, { signal: ctl.signal })
      .then((r) => r.text())
      .then(() => { clearTimeout(t); process.exit(0); })
      .catch(() => { clearTimeout(t); process.exit(1); });
  " "$1" >/dev/null 2>&1
}

start_web() {
  pgrep -f "scripts/serve.mjs" >/dev/null 2>&1 || {
    nohup node scripts/serve.mjs >>"$HOME/serve.log" 2>&1 &
    sleep 3
  }
}

stop_web() {
  pkill -f "scripts/serve.mjs" 2>/dev/null
}

start_live() {
  local dir="$HOME/.local"
  if [ ! -x "$dir/wudaliansai" ]; then return 1; fi
  ( cd "$dir" && ./wudaliansai >>"$dir/wdl.log" 2>&1 & )
  sleep 8
}

stop_live() {
  pkill -f "wudaliansai" 2>/dev/null
}

while true; do
  # 息屏后 wakelock 会变成 DISABLED，重新申请一次
  termux-wake-lock >/dev/null 2>&1 || true

  # ---- 赛事服务 ----
  if [ "$(get_state live)" = "on" ]; then
    if ! probe "http://127.0.0.1:18765/health"; then
      start_live
    fi
  else
    stop_live
  fi

  # ---- 网页服务 ----
  if [ "$(get_state web)" = "on" ]; then
    if ! probe "http://127.0.0.1:${PORT}/api/health"; then
      # 进程在但不响应 == 卡死 == 重启
      stop_web
      sleep 2
      start_web
    fi
    # 自动回收：太久没人用就自己关
    last="$STATE_DIR/web.last"
    if [ -f "$last" ]; then
      mtime=$(stat -c %Y "$last" 2>/dev/null || echo 0)
      age=$(( ($(date +%s) - mtime) / 60 ))
      if [ "$age" -gt "$AUTO_CLOSE_MIN" ]; then
        set_state web off
        echo "$(date '+%F %T') 网页服务闲置 ${age} 分钟，自动关闭" >>"$HOME/watchdog.log"
      fi
    fi
  else
    stop_web
  fi

  sleep 8
done
