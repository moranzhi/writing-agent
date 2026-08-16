@echo off
chcp 65001 >nul
title Writing Agent - 浏览器版
set PORT=23337

cd /d "%~dp0"

echo.
echo  Writing Agent - 浏览器版
echo  --------------------------------
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 Node.js，请先安装: https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [提示] 首次运行，正在安装依赖...
  call npm install
  if errorlevel 1 (
    echo [错误] npm install 失败
    pause
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

echo [信息] 启动服务 http://localhost:%PORT%
echo [信息] 改 src 或 skills 后后端会自动重启
echo [信息] 后端日志在本窗口，文件在 %USERPROFILE%\.writing-agent\logs\runtime.log
echo [信息] 浏览器按 F12 打开开发者工具
echo [信息] 桌面窗口请用 start-app.bat
echo [信息] 按 Ctrl+C 停止
echo.

start "" "http://localhost:%PORT%"

call npm run web:watch

pause
