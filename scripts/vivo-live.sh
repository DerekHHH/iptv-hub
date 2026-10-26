#!/usr/bin/env bash
# @file vivo 手机上 wudaliansai 赛事服务的开关（走 USB/adb，不依赖 Termux）。
#
# 用法：
#   bash scripts/vivo-live.sh on          开启
#   bash scripts/vivo-live.sh off         关闭（连看门狗一起停）
#   bash scripts/vivo-live.sh restart     重启
#   bash scripts/vivo-live.sh status      看状态（进程 / 端口 / 健康 / 看门狗）
#   bash scripts/vivo-live.sh watchdog on|off|status
#
# 为什么走 adb：这台 vivo 上 Termux 没跑，但 /data/local/tmp/wudaliansai 是
# shell 属主且 755，可以直接由 adb shell 拉起；用 setsid 脱离会话后，adb 断开
# 进程也不会死。

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$SCRIPT_DIR/android"
ADB="${ADB:-adb}"
PORT=18765

# 手机端脚本清单：本地文件 → 设备路径
PHONE_SCRIPTS=("wdl-on.sh" "wdl-off.sh" "wdl-watchdog.sh")

die() {
  echo "错误：$*" >&2
  exit 1
}

device_ready() {
  "$ADB" get-state 2>/dev/null | grep -q device
}

# 把手机端脚本推上去（每次都推，保证设备与仓库一致）
sync_scripts() {
  for name in "${PHONE_SCRIPTS[@]}"; do
    local src="$ANDROID_DIR/$name"
    [ -f "$src" ] || die "缺少 $src"
    # 注意：这里必须用**相对/Windows 风格**的本地临时路径。
    # 调用方常带 MSYS_NO_PATHCONV=1（防止 adb 的手机路径被转换），
    # 这时 /tmp/xxx 不会被翻译成 Windows 路径，adb 会把它当成手机上的路径 → 推送失败。
    local tmp="$ANDROID_DIR/.push-$name"
    # 去掉 Windows 的 CRLF，否则 /system/bin/sh 会报 ^M
    sed 's/\r$//' "$src" >"$tmp" 2>/dev/null || cp "$src" "$tmp"
    # adb 是 Windows 程序：给它 /c/Users/... 这种 MSYS 绝对路径它读不了，
    # 必须转成 C:\Users\... （相对路径也能用，但绝对路径更稳）
    local push_src
    push_src=$(cygpath -w "$tmp" 2>/dev/null || echo "$tmp")
    "$ADB" push "$push_src" "/data/local/tmp/$name" >/dev/null 2>&1 \
      || { rm -f "$tmp"; die "推送 $name 失败"; }
    rm -f "$tmp"
    "$ADB" shell "chmod 755 /data/local/tmp/$name" >/dev/null 2>&1
  done
}

run_phone() {
  "$ADB" shell "sh /data/local/tmp/$1" 2>&1 | tr -d '\r'
}

watchdog_running() {
  "$ADB" shell "pgrep -f '[w]dl-watchdog' >/dev/null 2>&1 && echo yes || echo no" 2>/dev/null | tr -d '\r'
}

show_status() {
  echo "=========== vivo 赛事服务 ==========="
  "$ADB" shell '
    pid=$(pgrep wudaliansai | head -1)
    if [ -n "$pid" ]; then
      echo "进程     运行中 (pid=$pid)"
    else
      echo "进程     未运行"
    fi
    if nc -z -w 2 127.0.0.1 18765 >/dev/null 2>&1; then
      echo "端口     18765 通"
    else
      echo "端口     18765 不通"
    fi
  ' 2>&1 | tr -d '\r'
  echo "看门狗   $( [ "$(watchdog_running)" = "yes" ] && echo 运行中 || echo 未运行 )"

  # 健康接口（走 adb forward，只在本机可见）
  "$ADB" forward --remove tcp:$PORT >/dev/null 2>&1
  if "$ADB" forward tcp:$PORT tcp:$PORT >/dev/null 2>&1; then
    local body
    body=$(curl -sS -m 10 --noproxy '*' "http://127.0.0.1:$PORT/health" 2>/dev/null)
    if [ -n "$body" ]; then
      echo "健康     $body"
    else
      echo "健康     无响应（服务可能还在预热，约 60 秒）"
    fi
    "$ADB" forward --remove tcp:$PORT >/dev/null 2>&1
  fi

  # 网络：决定电视/影视仓能不能用
  local net
  net=$("$ADB" shell 'ip route get 1.1.1.1 2>/dev/null | head -1' 2>/dev/null | tr -d '\r')
  case "$net" in
    *ccmni*|*rmnet*) echo "网络     蜂窝数据（无局域网地址，电视访问不到）" ;;
    *wlan*)          echo "网络     已连 Wi-Fi" ;;
    *)               echo "网络     未知：$net" ;;
  esac
  local wlan
  wlan=$("$ADB" shell 'ip -4 addr show wlan0 2>/dev/null | grep "inet "' 2>/dev/null | tr -d '\r')
  if [ -n "$wlan" ]; then
    local ip
    ip=$(echo "$wlan" | grep -oE '([0-9]{1,3}\.){3}[0-9]{1,3}' | head -1)
    echo "局域网   http://$ip:$PORT/live.m3u"
  fi
  echo "====================================="
}

main() {
  local cmd="${1:-status}"
  device_ready || die "没有检测到 adb 设备。确认 USB 已连接、USB 调试已开、且已允许本机授权（adb devices）"

  case "$cmd" in
    on)
      sync_scripts
      run_phone wdl-on.sh
      # 顺带把看门狗也拉起来 —— 这才是"一直刷新/掉了自己回来"的关键，
      # 否则服务被杀掉就得人工发现。想只开服务不要保活，可随后执行 watchdog off。
      if [ "$(watchdog_running)" = "yes" ]; then
        echo "看门狗 已在运行"
      else
        "$ADB" shell "cd /data/local/tmp; (setsid ./wdl-watchdog.sh </dev/null >/dev/null 2>&1 &); exit 0" >/dev/null 2>&1
        sleep 2
        echo "看门狗 $( [ "$(watchdog_running)" = "yes" ] && echo 已启动 || echo 启动失败 )"
      fi
      ;;
    off)
      sync_scripts
      run_phone wdl-off.sh
      ;;
    restart)
      sync_scripts
      run_phone wdl-off.sh
      run_phone wdl-on.sh
      ;;
    status)
      show_status
      ;;
    watchdog)
      local sub="${2:-status}"
      case "$sub" in
        on)
          sync_scripts
          # 已在跑就不重复起
          if [ "$(watchdog_running)" = "yes" ]; then
            echo "看门狗已在运行"
          else
          # 关键：必须 ( ... & ); exit 0 这种写法。
          # 直接 `&` 时 adb shell 会被后台子进程拖住不返回（实测卡住 2 分钟以上）；
          # 加 </dev/null 断开 stdin、再显式 exit 0，2 秒就返回，子进程靠 setsid 存活。
          "$ADB" shell "cd /data/local/tmp; (setsid ./wdl-watchdog.sh </dev/null >/dev/null 2>&1 &); exit 0" >/dev/null 2>&1
            sleep 2
            echo "看门狗已启动（$( [ "$(watchdog_running)" = "yes" ] && echo 确认在跑 || echo 未确认 )）"
          fi
          ;;
        off)
          "$ADB" shell "pkill -f '[w]dl-watchdog'" >/dev/null 2>&1
          echo "看门狗已停"
          ;;
        status)
          echo "看门狗 $( [ "$(watchdog_running)" = "yes" ] && echo 运行中 || echo 未运行 )"
          "$ADB" shell 'tail -5 /data/local/tmp/wdl-watchdog.log 2>/dev/null' 2>&1 | tr -d '\r'
          ;;
        *)
          die "用法：$0 watchdog on|off|status"
          ;;
      esac
      ;;
    *)
      echo "用法：bash scripts/vivo-live.sh {on|off|restart|status|watchdog on|off|status}" >&2
      exit 1
      ;;
  esac
}

main "$@"
