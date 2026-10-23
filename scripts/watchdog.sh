#!/data/data/com.termux/files/usr/bin/bash
# 看门狗：保活「赛事服务」与「网页服务」，并防止手机把 Termux 冻住。
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
# 用法：nohup bash scripts/watchdog.sh &

PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$PATH"
cd "${IPTV_DIR:-$HOME/iptv-hub}" || exit 1
PORT="${SERVE_PORT:-18080}"

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

while true; do
  # 0) 重新申请 wakelock：息屏后被冻结会让它变成 DISABLED
  termux-wake-lock >/dev/null 2>&1 || true

  # 1) 赛事服务自愈
  if ! probe "http://127.0.0.1:18765/health"; then
    if [ -x "$HOME/.local/wudaliansai" ]; then
      ( cd "$HOME/.local" && ./wudaliansai >>"$HOME/.local/wdl.log" 2>&1 & )
      sleep 10
    fi
  fi

  # 2) 网页服务：进程在但不响应 == 卡死 == 重启
  if ! probe "http://127.0.0.1:${PORT}/api/health"; then
    pkill -f "scripts/serve.mjs" 2>/dev/null
    sleep 2
  fi

  # 3) 保证服务在跑
  pgrep -f "scripts/serve.mjs" >/dev/null 2>&1 || {
    nohup node scripts/serve.mjs >>"$HOME/serve.log" 2>&1 &
    sleep 3
  }

  sleep 8
done
