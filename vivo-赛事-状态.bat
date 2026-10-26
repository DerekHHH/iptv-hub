@echo off
rem 双击查看 vivo 手机赛事服务的状态
chcp 65001 >nul
cd /d "%~dp0"
set "BASH=%ProgramFiles%\Git\bin\bash.exe"
if not exist "%BASH%" set "BASH=bash"
"%BASH%" scripts/vivo-live.sh status
echo.
pause
