@echo off
rem 双击开启 vivo 手机上的 wudaliansai 赛事服务
chcp 65001 >nul
cd /d "%~dp0"
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=bash"
"%BASH%" scripts/vivo-live.sh on
echo.
pause
