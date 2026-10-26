#!/data/data/com.termux/files/usr/bin/bash
# @file 红米手机「接手 wudaliansai」前置体检。
#
# 用途：迁移前先跑一次，把红米的真实状态一次性摸清，输出到 /sdcard/preflight.txt。
# 家里那台 WorkBuddy（或人）读这个文件就知道该改什么，不用来回猜。
#
# 用法：在 Termux 里执行
#   bash /data/local/tmp/preflight.sh
#
# 只读不写（除了把结果写到 /sdcard），不改任何配置。

OUT=/sdcard/preflight.txt
exec >"$OUT" 2>&1

echo "================ 红米体检报告 ================"
echo "时间: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo

echo "--- 1. 机型与系统 ---"
getprop ro.product.model 2>/dev/null
getprop ro.build.version.release 2>/dev/null | sed 's/^/Android /'
echo "ABI: $(getprop ro.product.cpu.abi 2>/dev/null)"
echo

echo "--- 2. 网络（决定产物里能写什么地址）---"
echo "Wi-Fi IP: $(ip -4 addr show wlan0 2>/dev/null | grep -oE 'inet ([0-9.]+)' | awk '{print $2}' | head -1)"
echo "网关: $(ip route 2>/dev/null | grep default | head -1)"
echo "出口: $(ip route get 1.1.1.1 2>/dev/null | head -1 | grep -oE 'dev [a-z0-9]+' )"
echo

echo "--- 3. Termux 运行时 ---"
echo "node: $(node -v 2>/dev/null || echo '未安装')"
echo "npm:  $(npm -v 2>/dev/null || echo '未安装')"
echo "bash: $BASH_VERSION"
echo

echo "--- 4. 仓库状态 ---"
cd "$HOME/iptv-hub" 2>/dev/null || { echo "!! $HOME/iptv-hub 不存在"; }
if [ -d "$HOME/iptv-hub/.git" ]; then
  echo "HEAD: $(git --no-pager log --oneline -1 2>&1)"
  echo "分支: $(git branch --show-current 2>&1)"
  echo "本地改动: $(git status --porcelain 2>/dev/null | wc -l) 个文件"
  echo "远程: $(git remote -v 2>/dev/null | head -1)"
  echo "node_modules: $([ -d node_modules ] && echo 已安装 || echo '未安装（需 npm install）')"
else
  echo "!! 不是 git 仓库"
fi
echo

echo "--- 5. wudaliansai 二进制在哪 ---"
for p in "$HOME/.local/wudaliansai" "$HOME/iptv-hub/wudaliansai" /data/local/tmp/wudaliansai; do
  if [ -e "$p" ]; then
    echo "$p → $([ -d "$p" ] && echo '目录（有问题！）' || echo "文件 $(wc -c <"$p" 2>/dev/null) 字节")"
  fi
done
echo "（上面没列出来的就是不存在）"
echo

echo "--- 6. 端口与服务 ---"
for port in 18765 18080; do
  if /system/bin/nc -z -w 2 127.0.0.1 $port 2>/dev/null; then
    echo "  $port 通"
  else
    echo "  $port 不通"
  fi
done
echo "node 进程: $(pgrep -c node 2>/dev/null || echo 0) 个"
echo "wudaliansai 进程: $(pgrep -c wudaliansai 2>/dev/null || echo 0) 个"
echo

echo "--- 7. 旧机制（10-24 那套）还在不在 ---"
echo "  scripts/watchdog.sh 运行中: $(pgrep -cf '[s]cripts/watchdog.sh' 2>/dev/null || echo 0)"
echo "  web.state: $(cat "$HOME/.local/state/iptv-hub/web.state" 2>/dev/null || echo 无)"
echo "  live.state: $(cat "$HOME/.local/state/iptv-hub/live.state" 2>/dev/null || echo 无)"
echo "  \$PREFIX/bin 里的开关: $(ls "$PREFIX/bin" 2>/dev/null | grep -E '^(web|live)\.sh$' | tr '\n' ' ')"
echo

echo "--- 8. 新机制（今天这套）在不在 ---"
echo "  ~/bin/wdl: $([ -x "$HOME/bin/wdl" ] && echo 有 || echo 无)"
echo "  看门狗运行中: $(pgrep -cf '[w]dl-watchdog' 2>/dev/null || echo 0)"
echo "  boot 脚本: $(ls "$HOME/.termux/boot/" 2>/dev/null | tr '\n' ' ')"
echo "  Termux:Boot 装了没: $(pm list packages 2>/dev/null | grep -q 'com.termux.boot' && echo 装了 || echo 没装)"
echo "  .bashrc 里的钩子:"
grep -n 'iptv-autostart\|wdl' "$HOME/.bashrc" 2>/dev/null | sed 's/^/    /' || echo "    （无）"
echo

echo "--- 9. 产物现状 ---"
for f in dist/live/live.txt dist/live/live.m3u dist/live/config.json; do
  if [ -f "$f" ]; then
    echo "  $f → $(wc -c <"$f") 字节, 最后改于 $(date -r "$f" '+%m-%d %H:%M' 2>/dev/null)"
  else
    echo "  $f → 不存在"
  fi
done
echo "  产物里的地址: $(grep -ohE 'http://[0-9.]+:[0-9]+' dist/live/live.txt 2>/dev/null | sort -u | tr '\n' ' ')"
echo

echo "--- 10. 电池与省电（常开的关键）---"
dumpsys deviceidle 2>/dev/null | grep -m1 'mScreenOn\|mForceIdle' | sed 's/^/  /'
echo "  Termux 是否被禁止后台: 需手动在「设置-电池-后台耗电管理」里确认"
echo

echo "================ 报告结束 ================"
echo "把这行结果发回来：/sdcard/preflight.txt"
