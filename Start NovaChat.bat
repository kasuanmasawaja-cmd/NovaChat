@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed.
  echo Install Node.js LTS, then run this file again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing required packages...
  call npm install
  if errorlevel 1 (
    echo npm install failed.
    pause
    exit /b 1
  )
)
echo Starting NovaChat...
start "NovaChat Browser" http://localhost:3000
call npm start
pause
