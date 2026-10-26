#!/system/bin/sh
# @file 停止 wudaliansai（含看门狗，避免它刚关掉又被拉起来）
#
# 先停看门狗，再停服务——顺序反了会出现"关了又活了"。

if pgrep -f '[w]dl-watchdog' >/dev/null 2>&1; then
  pkill -f '[w]dl-watchdog' 2>/dev/null
  echo "看门狗已停"
fi

if pgrep wudaliansai >/dev/null 2>&1; then
  pkill wudaliansai 2>/dev/null
  sleep 1
  # 1 秒还没退就强杀
  if pgrep wudaliansai >/dev/null 2>&1; then
    pkill -9 wudaliansai 2>/dev/null
    sleep 1
  fi
fi

if pgrep wudaliansai >/dev/null 2>&1; then
  echo "FAIL 还在运行 pid=$(pgrep wudaliansai | head -1)"
  exit 1
fi
echo "OK 已停止"
