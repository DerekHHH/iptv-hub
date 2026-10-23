#!/data/data/com.termux/files/usr/bin/bash
# @file 赛事服务开关（安装后可直接敲 `live.sh`）。
#
#   live.sh          确保开启，并打开健康检查页看结果
#   live.sh off      关闭
#   live.sh status   看状态
#
# 赛事服务是电视看球用的那个（wudaliansai，监听 0.0.0.0:18765），
# 影视仓里填 http://<手机局域网IP>:18765/live.m3u。

PREFIX=/data/data/com.termux/files/usr
export PATH="$PREFIX/bin:$HOME/bin:$PATH"
DIR="${IPTV_DIR:-$HOME/iptv-hub}"

case "${1:-}" in
  off)
    bash "$DIR/scripts/toggle.sh" live off
    ;;
  status)
    bash "$DIR/scripts/toggle.sh" status
    ;;
  *)
    bash "$DIR/scripts/toggle.sh" live on
    for _ in 1 2 3 4 5 6 7 8 9 10 11 12; do
      if curl -sS -m 2 "http://127.0.0.1:18765/health" >/dev/null 2>&1; then break; fi
      sleep 1
    done
    am start -a android.intent.action.VIEW -d "http://127.0.0.1:18765/health" >/dev/null 2>&1
    echo "赛事服务已就绪，影视仓填 http://<手机局域网IP>:18765/live.m3u"
    ;;
esac
