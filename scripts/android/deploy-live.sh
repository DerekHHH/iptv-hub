#!/data/data/com.termux/files/usr/bin/bash
# @file 把仓库同步到最新并在手机本地重建赛事清单（结果写到 /sdcard 方便查看）
OUT=/sdcard/deploy-live.txt
exec >"$OUT" 2>&1
set -u

cd "$HOME/iptv-hub" || { echo "找不到 ~/iptv-hub"; exit 1; }

echo "=== 1. 同步代码 ==="
for i in 1 2 3 4 5; do
  if git fetch origin 2>&1 | tail -2; then break; fi
  echo "fetch 失败 $i，重试"
  sleep 10
done
git reset --hard origin/main 2>&1 | tail -1
git --no-pager log --oneline -1

echo "=== 2. 选基址：有 Wi-Fi 用 Wi-Fi IP，没有就用 127.0.0.1 ==="
# 手机只连蜂窝时没有局域网地址，产物里绝不能写别的机器的 IP
# （写错了手机自己都播不了，影视仓会全超时）
WIFI_IP=$(ip -4 addr show wlan0 2>/dev/null | grep -oE 'inet ([0-9.]+)' | head -1 | awk '{print $2}')
if [ -n "$WIFI_IP" ]; then
  BASE="http://$WIFI_IP:18765"
  echo "  Wi-Fi 已连：$BASE（手机和电视都能用）"
else
  BASE="http://127.0.0.1:18765"
  echo "  Wi-Fi 未连：$BASE（只有手机自己能播）"
fi

echo "=== 3. 重建赛事清单（手机直连赛程源，不需要代理）==="
WUDALIANSAI_PUBLIC_BASE="$BASE" npm run build:live 2>&1 | grep -E "赛程|写出|RESULT|error" | head -6

echo "=== 4. 产物里的地址（应当只有上面那个基址）==="
grep -oE 'http://[0-9.]+:[0-9]+' dist/live/live.txt | sort -u

echo "=== 5. 分组 ==="
grep "#genre#" dist/live/live.txt

echo "=== 6. 带时间的条目 ==="
grep -oE '^\[[^]]+\] [^,]+' dist/live/live.txt | grep -E '[0-9]{2}:[0-9]{2}' | head -8

echo "=== 7. 前 8 行 ==="
head -8 dist/live/live.txt
echo "=== 完成 ==="
