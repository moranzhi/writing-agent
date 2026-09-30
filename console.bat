@echo off
chcp 65001 >nul
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Writing Agent
set "PS=powershell -NoProfile -ExecutionPolicy Bypass -File"
set "CTL=%~dp0console.ps1"

call :ensure
if errorlevel 1 (
  echo.
  echo 启动失败。
  pause
  goto :menu
)
start "" "http://127.0.0.1:23337/"

:menu
cls
echo.
echo ========================================
echo   Writing Agent  本机
echo   http://localhost:23337
echo   不走隧道，也不在服务机上跑。
echo   不监视文件。改完代码后输入 update。
echo ========================================
echo.
echo   start      启动服务并打开页面
echo   stop       停止服务
echo   restart    重启服务
echo   update     用当前代码重启服务
echo   open       打开页面
echo   status     端口和 git 状态
echo   pull       git pull --ff-only
echo   push       git push
echo   log        最近日志
echo   help
echo   exit       退出控制台，服务继续运行
echo.
set "LINE="
set /p "LINE=指令: "
if not defined LINE goto :menu
call :dispatch "%LINE%"
if "%ERRORLEVEL%"=="2" goto :eof
goto :menu

:dispatch
set "RAW=%~1"
set "CHK=%RAW:&=%"
if not "%CHK%"=="%RAW%" goto :bad
set "CHK=%RAW:|=%"
if not "%CHK%"=="%RAW%" goto :bad
set "CHK=%RAW:>=%"
if not "%CHK%"=="%RAW%" goto :bad
set "CHK=%RAW:<=%"
if not "%CHK%"=="%RAW%" goto :bad
set "CMD="
for /f "tokens=1" %%A in ("%RAW%") do set "CMD=%%A"
if /i "%CMD%"=="exit" exit /b 2
if /i "%CMD%"=="quit" exit /b 2
if /i "%CMD%"=="help" goto :show
if /i "%CMD%"=="start" goto :do_start
if /i "%CMD%"=="stop" goto :do_stop
if /i "%CMD%"=="restart" goto :do_update
if /i "%CMD%"=="update" goto :do_update
if /i "%CMD%"=="open" goto :do_open
if /i "%CMD%"=="status" goto :do_status
if /i "%CMD%"=="pull" goto :do_pull
if /i "%CMD%"=="push" goto :do_push
if /i "%CMD%"=="log" goto :do_log
goto :bad

:show
echo.
echo   update  重启进程以加载当前代码，不监视文件。
echo   pull    快进拉取，不自动重启。拉取后需要 update。
echo   push    推送当前分支，不提交、不强制推送。
echo   exit    只关这个窗口。
echo.
pause
exit /b 0

:do_start
echo.
%PS% "%CTL%" -Action start
if errorlevel 1 goto :held
start "" "http://127.0.0.1:23337/"
echo.
pause
exit /b 0

:do_stop
echo.
%PS% "%CTL%" -Action stop
echo.
pause
exit /b 0

:do_update
echo.
%PS% "%CTL%" -Action restart
if errorlevel 1 goto :held
echo 已用当前代码重启，没有开启文件监视。
echo.
pause
exit /b 0

:do_open
start "" "http://127.0.0.1:23337/"
exit /b 0

:do_status
echo.
%PS% "%CTL%" -Action status
echo.
pause
exit /b 0

:do_pull
echo.
git pull --ff-only
echo.
echo 代码已更新到磁盘后，输入 update 才会重启服务。
echo.
pause
exit /b 0

:do_push
echo.
git push
echo.
pause
exit /b 0

:do_log
echo.
%PS% "%CTL%" -Action log
echo.
pause
exit /b 0

:ensure
set "MODE="
for /f "delims=" %%A in ('%PS% "%CTL%" -Action query') do set "MODE=%%A"
if /i "!MODE!"=="web" exit /b 0
echo.
echo 正在启动服务（不监视文件）...
%PS% "%CTL%" -Action start
if errorlevel 1 exit /b 1
exit /b 0

:bad
echo.
echo 不认识这条指令。输入 help 查看。
echo.
pause
exit /b 0

:held
echo.
pause
exit /b 0
