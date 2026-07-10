@echo off
if "%~1"=="" (
  start "" wscript.exe "%~dp0start-app-hidden.vbs"
  exit /b 0
)

chcp 65001 >nul
title Writing Agent - 桌面版
set PORT=23337

cd /d "%~dp0"

echo.
echo  Writing Agent - 桌面版 (Electron)
echo  --------------------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装: https://nodejs.org/
  if not "%~1"=="_hidden" pause
  exit /b 1
)

if not exist "node_modules\electron\" (
  echo [提示] 首次运行，正在安装依赖（含 Electron，可能较慢）...
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败
    if not "%~1"=="_hidden" pause
    exit /b 1
  )
  echo.
)

echo [信息] 检查端口 %PORT% ...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%PORT% " ^| findstr "LISTENING"') do (
  echo [信息] 结束占用端口的旧进程 PID=%%a
  taskkill /F /PID %%a >nul 2>&1
)

if exist ".env" (
  echo [信息] 将加载 .env（由服务端读取）
) else if exist ".env.example" (
  echo [提示] 未找到 .env，可复制 .env.example 并填入 API Key
)

echo [信息] 启动桌面窗口 http://localhost:%PORT%
echo [信息] 调试: F12 或 Ctrl+Shift+I 打开开发者工具
echo [信息] 自动打开 DevTools: set WRITING_AGENT_ELECTRON_DEV=1 ^&^& npm run electron
echo [信息] 关闭窗口即停止服务
echo.

call npm run electron

if not "%~1"=="_hidden" pause
