#!/data/data/com.termux/files/usr/bin/bash
# @file 看门狗：按状态文件对齐两个服务（网页 / 赛事），并做自动回收。
#
# 用法：nohup bash scripts/watchdog.sh >>~/watchdog.log 2>&1 &
#
# 状态文件（由 scripts/toggle.sh 改）：
#   ~/.local/state/iptv-hub/web.state   on / off
#   ~/.local/state/iptv-hub/live.state  on / off
#
# 四个关键点（都是在这台 vivo 上实测踩出来的）：
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
# 4. **赛事二进制的真实位置是 ~/.local/wudaliansai/wudaliansai（子目录里）**
#    历史事故：start_live 检查 ~/.local/wudaliansai（那是个目录），`-x` 对目录
#    恒为真，于是每次重启都去执行一个目录，报 "Is a directory"，赛事服务再也
#    起不来。现在用 `-f && -x` 双重确认，启动前再探一次健康，避免双实例。
#
# 自动回收：网页服务开着但一直没人访问（默认 30 分钟），就自己关掉。
# "有人访问"以 serve.mjs 记录的最近一次**真实页面访问**为准
# （看门狗自己的健康探测走 /api/，不计入，避免自我续命）。

PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$PATH"
IPTV_DIR="${IPTV_DIR:-$HOME/iptv-hub}"
cd "$IPTV_DIR" || exit 1

PORT="${SERVE_PORT:-18080}"
STATE_DIR="$HOME/.local/state/iptv-hub"
AUTO_CLOSE_MIN="${SERVE_AUTO_CLOSE_MIN:-30}"

# 赛事服务（wudaliansai）落点，与 termux-serve.sh / termux-update.sh 保持一致：
# 二进制、证书、缓存都在 ~/.local/wudaliansai/ 子目录里。
WDL_HOME="$HOME/.local/wudaliansai"
WDL_BIN="$WDL_HOME/wudaliansai"
WDL_CERT="$WDL_HOME/ca-certificates.crt"
WDL_CACHE="$WDL_HOME/cache"
WDL_LOG="$WDL_HOME/wdl.log"
WDL_PORT=18765

# 赛事上游本地代理（绕开二进制自带 DoH/TLS 栈连不上外网的问题）。
# 设 WDL_LOCAL_PROXY=off 可整体关闭（回退到二进制直连上游）。
USE_PROXY="${WDL_LOCAL_PROXY:-on}"
PROXY_PORT="${LIVE_PROXY_PORT:-18766}"
PROXY_LOG="$WDL_HOME/proxy.log"
WDL_DOMAIN="http://127.0.0.1:${PROXY_PORT}"
WDL_BASE_URL=""
WDL_DOMAIN_ENV=""

# 计算输出 M3U 的播放链接基址（WUDALIANSAI_BASE_URL）。
# 不设时二进制会自动识别成 127.0.0.1，电视/盒子连不上；这里取 wlan0 的局域网 IP，
# 让 M3U 里的 /play/... 指向手机在局域网里的地址。每次启动二进制前重算，
# 这样开关 WiFi / IP 变化后能自动跟上（手机切移动数据时退回任意非回环 IP）。
refresh_base_url() {
  local ip
  # 用 node 枚举网卡（Termux 里未必有 ip 命令）：优先 wlan0 的局域网地址，
  # 没有就取第一个非回环 IPv4（例如切移动数据时的蜂窝地址）。
  ip=$(node -e '
    const os=require("os");const n=os.networkInterfaces();
    const pick=(k)=>{const l=n[k]||[];const a=l.find(x=>x.family==="IPv4"&&!x.internal);return a&&a.address;};
    let ip=pick("wlan0");
    if(!ip){for(const k of Object.keys(n)){const a=pick(k);if(a){ip=a;break;}}}
    process.stdout.write(ip||"");
  ' 2>/dev/null)
  WDL_BASE_URL=""
  [ -n "$ip" ] && WDL_BASE_URL="http://${ip}:${WDL_PORT}"
  # 上游只认 WUDALIANSAI_DOMAIN（KGQ_DOMAIN 实测被忽略，二进制仍直连 OSS）
  WDL_DOMAIN_ENV=""
  if [ "$USE_PROXY" = "on" ]; then
    WDL_DOMAIN_ENV="WUDALIANSAI_DOMAIN=$WDL_DOMAIN"
  fi
  if [ -n "$WDL_BASE_URL" ]; then
    WDL_DOMAIN_ENV="$WDL_DOMAIN_ENV WUDALIANSAI_BASE_URL=$WDL_BASE_URL"
  fi
}
refresh_base_url

mkdir -p "$STATE_DIR" "$WDL_CACHE"

# 单实例守卫：已有看门狗在跑就直接退出，避免多个实例互相抢着拉起/杀掉服务。
WD_LOCK="$STATE_DIR/watchdog.pid"
if [ -f "$WD_LOCK" ]; then
  OLD_WD=$(cat "$WD_LOCK" 2>/dev/null)
  if [ -n "$OLD_WD" ] && [ "$OLD_WD" != "$$" ] && kill -0 "$OLD_WD" 2>/dev/null \
     && grep -qa "watchdog.sh" "/proc/$OLD_WD/cmdline" 2>/dev/null; then
    echo "$(date '+%F %T') 已有看门狗在运行（pid $OLD_WD），本实例退出" >>"$HOME/watchdog.log"
    exit 0
  fi
fi
echo $$ > "$WD_LOCK"

get_state() {
  local file="$STATE_DIR/$1.state"
  if [ -f "$file" ]; then cat "$file"; else echo "default"; fi
}

set_state() {
  echo "$2" >"$STATE_DIR/$1.state"
}

logline() {
  echo "$(date '+%F %T') $*" >>"$HOME/watchdog.log"
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

# 赛事二进制是否真的可用：-f 挡掉"目录"，-x 挡掉"没有执行位"
wdl_bin_ok() {
  [ -f "$WDL_BIN" ] && [ -x "$WDL_BIN" ]
}

# 赛事进程是否存活。用 pgrep -f（按完整命令行）而不是 -x：
# -x 按进程名精确匹配，在本机对 wudaliansai 有假阴性（进程在跑却查不到），
# 会导致看门狗以为"没进程"而反复重复拉起。
wdl_alive() {
  pgrep -f "wudaliansai" >/dev/null 2>&1
}

# 本地上游代理是否已在跑
proxy_ok() {
  pgrep -f "live-proxy.mjs" >/dev/null 2>&1
}

# 拉起本地上游代理（仅 127.0.0.1）。日志写到 /sdcard/Download 方便回读。
start_proxy() {
  if proxy_ok; then
    return 0
  fi
  if [ -f "$IPTV_DIR/scripts/live-proxy.mjs" ]; then
    LIVE_PROXY_LOG="/sdcard/Download/wdl-proxy.log" \
      LIVE_PROXY_PORT="$PROXY_PORT" \
      nohup node "$IPTV_DIR/scripts/live-proxy.mjs" >>"$PROXY_LOG" 2>&1 &
    sleep 1
    logline "赛事上游代理已启动（127.0.0.1:${PROXY_PORT}）"
  else
    logline "赛事上游代理脚本缺失（$IPTV_DIR/scripts/live-proxy.mjs），跳过"
  fi
}

stop_proxy() {
  pkill -f "live-proxy.mjs" 2>/dev/null
}

# 已在跑的二进制是否带上了上游代理域名（同 UID 可读 /proc/<pid>/environ）
wdl_has_domain() {
  local pid env
  pid=$(pgrep -f "wudaliansai" | head -1)
  [ -n "$pid" ] || return 1
  env=$(tr '\0' '\n' < "/proc/$pid/environ" 2>/dev/null)
  echo "$env" | grep -qa "WUDALIANSAI_DOMAIN=$WDL_DOMAIN" || return 1
  if [ -n "$WDL_BASE_URL" ]; then
    echo "$env" | grep -qa "WUDALIANSAI_BASE_URL=$WDL_BASE_URL" || return 1
  fi
  return 0
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
  if ! wdl_bin_ok; then
    logline "赛事服务二进制不可用（$WDL_BIN 不是可执行文件），本次跳过"
    return 1
  fi
  # 每次尝试启动前重算局域网基址，保证 WiFi/IP 变化后自动跟上
  refresh_base_url
  # 本地上游代理：二进制自带 DoH/TLS 栈连不上外网，改走系统网络转发
  if [ "$USE_PROXY" = "on" ]; then
    start_proxy
  fi

  if wdl_alive; then
    if probe "http://127.0.0.1:${WDL_PORT}/health"; then
      # 健康且在跑：若已带代理域名就别动
      if [ "$USE_PROXY" = "off" ] || wdl_has_domain; then
        return 0
      fi
      logline "赛事实例未走本地代理，重启以套用新配置"
    else
      # 进程在跑但还没就绪：二进制初始化要十几秒（等 pool-sg 超时 + 健康探测），
      # 这里必须耐心等，绝不能重复拉起（否则多实例抢端口，永远起不来）
      local i
      for i in $(seq 1 30); do
        sleep 2
        if probe "http://127.0.0.1:${WDL_PORT}/health"; then
          logline "赛事服务已就绪（第 ${i} 次探测）"
          return 0
        fi
      done
      logline "赛事进程存活但 60 秒未就绪，重启"
    fi
    pkill -f "wudaliansai" 2>/dev/null
    sleep 2
  fi

  logline "赛事服务启动 $WDL_BIN（上游 $WDL_DOMAIN${WDL_BASE_URL:+；输出基址 $WDL_BASE_URL}）"
  # 用 exec 让启动子 shell 直接变成二进制本身（经 env 注入变量），
  # 不再残留一个"bash scripts/watchdog.sh"子进程冒充第二个看门狗。
  (
    cd "$WDL_HOME" || exit 1
    exec env SSL_CERT_FILE="$WDL_CERT" WUDALIANSAI_CACHE_DIR="$WDL_CACHE" RUST_LOG=info \
      ${WDL_DOMAIN_ENV} \
      nohup ./wudaliansai >>"$WDL_LOG" 2>&1
  ) &
  # 首次启动要拉域名列表 + 健康探测，给足 60 秒
  local i
  for i in $(seq 1 30); do
    sleep 2
    if probe "http://127.0.0.1:${WDL_PORT}/health"; then
      logline "赛事服务已就绪（第 ${i} 次探测）"
      return 0
    fi
  done
  logline "赛事服务 60 秒未就绪；wdl.log 尾部：$(tail -3 "$WDL_LOG" 2>/dev/null | tr '\n' ' | ')"
  return 1
}

stop_live() {
  pkill -f "wudaliansai" 2>/dev/null
}

while true; do
  # 息屏后 wakelock 会变成 DISABLED，重新申请一次
  termux-wake-lock >/dev/null 2>&1 || true

  # ---- 赛事服务 ----
  if [ "$(get_state live)" = "on" ]; then
    if [ "$USE_PROXY" = "on" ]; then
      start_proxy
    fi
    # 每轮按当前网络重算基址；若运行中的二进制配置已变（例如 WiFi 切换导致
    # 局域网 IP 变化），自动重启套用新地址，避免 M3U 里一直是旧 IP。
    refresh_base_url
    if ! probe "http://127.0.0.1:${WDL_PORT}/health"; then
      start_live
    elif [ "$USE_PROXY" = "on" ] && ! wdl_has_domain; then
      logline "赛事配置已变（基址/域名），重启套用"
      pkill -f "wudaliansai" 2>/dev/null
      sleep 2
      start_live
    fi
  else
    stop_live
    stop_proxy
  fi

  # ---- 网页服务 ----
  if [ "$(get_state web)" = "on" ]; then
    if ! probe "http://127.0.0.1:${PORT}/api/health"; then
      # 进程在但不响应 == 卡死 == 重启
      logline "网页服务无响应，重启"
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
        logline "网页服务闲置 ${age} 分钟，自动关闭"
      fi
    fi
  else
    stop_web
  fi

  sleep 8
done
