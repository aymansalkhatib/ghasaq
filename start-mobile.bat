@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Ghasaq on your local network
if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install
)
echo.
echo Open the "Network" address below on your phone (same Wi-Fi as this PC).
echo.
call npm run dev:mobile
