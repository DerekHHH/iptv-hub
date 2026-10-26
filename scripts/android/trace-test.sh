#!/data/data/com.termux/files/usr/bin/bash
# @file 一次性实验：用 RUST_LOG=trace 跑二进制，看上游数据里有没有开赛时间。
#
# 结果写到 /sdcard/trace-result.txt（adb 能直接读，不用截图）。
# 跑完自动把服务恢复回去。

OUT=/sdcard/trace-result.txt
exec >"$OUT" 2>&1

cd "$HOME/.local" || exit 1

echo "=== 准备：停掉现有服务和看门狗 ==="
pkill -f '[w]dl-watchdog' 2>/dev/null
pkill wudaliansai 2>/dev/null
sleep 2
echo "剩余进程: $(pgrep -c wudaliansai 2>/dev/null || echo 0)"

echo "=== 以 RUST_LOG=trace 启动 ==="
rm -f trace.log
RUST_LOG=trace setsid ./wudaliansai >trace.log 2>&1 &
sleep 75

echo "=== trace.log 大小 ==="
ls -l trace.log | awk '{print $5, "字节"}'

echo "=== 含 time/date 等字段的行（前 15 条）==="
grep -oiE '"[a-z_]*(time|date|clock|start|begin)[a-z_]*"[[:space:]]*:[[:space:]]*"?[^",}]{0,30}' trace.log | sort | uniq -c | sort -rn | head -15

echo "=== 上游原始响应片段（找 JSON 结构）==="
grep -oE '\{"[^}]{80,600}' trace.log | head -2

echo "=== 恢复服务 + 看门狗 ==="
pkill wudaliansai 2>/dev/null
sleep 2
setsid ./wudaliansai >>wdl.log 2>&1 &
sleep 2
setsid bash "$HOME/bin/wdl-watchdog.sh" >/dev/null 2>&1 &
sleep 2
echo "服务: $(pgrep -c wudaliansai 2>/dev/null || echo 0) 个进程"
echo "看门狗: $(pgrep -cf '[w]dl-watchdog' 2>/dev/null || echo 0) 个"
echo "=== 完成 ==="
