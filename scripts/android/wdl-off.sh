#!/data/data/com.termux/files/usr/bin/bash
# @file 停止 wudaliansai（先停看门狗，否则它会把服务拉回来）
#
# 注意：Android 上只能杀**自己 uid** 的进程。
# 如果服务是被 adb（shell, uid 2000）起的，Termux 里执行本脚本杀不掉——
# 这时会明确提示，而不是假装成功。

PORT=18765
NC=/system/bin/nc

port_open() {
  "$NC" -z -w 2 127.0.0.1 "$PORT" >/dev/null 2>&1
}

# 1) 先停看门狗
if pgrep -f '[w]dl-watchdog' >/dev/null 2>&1; then
  pkill -f '[w]dl-watchdog' 2>/dev/null
  sleep 1
  echo "看门狗已停"
fi

# 2) 再停服务
if pgrep wudaliansai >/dev/null 2>&1; then
  pkill wudaliansai 2>/dev/null
  sleep 2
  pgrep wudaliansai >/dev/null 2>&1 && pkill -9 wudaliansai 2>/dev/null
  sleep 1
fi

# 3) 以端口为准判断结果（跨 uid 唯一可靠的判据）
if port_open; then
  echo "FAIL 端口 $PORT 仍在监听：服务可能是别的 uid 起的（例如 adb），当前身份杀不掉。"
  echo "     办法：电脑上 adb shell pkill wudaliansai，之后再从 Termux 里 wdl on。"
  exit 1
fi
echo "OK 已停止"
