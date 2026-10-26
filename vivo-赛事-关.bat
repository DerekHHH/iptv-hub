@echo off
rem 双击关闭 vivo 手机上的 wudaliansai 赛事服务（连看门狗一起停）
chcp 65001 >nul
cd /d "%~dp0"
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=bash"
"%BASH%" scripts/vivo-live.sh off
echo.
pause
