@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Ghasaq dev server
if not exist node_modules (
  echo Installing dependencies for the first run...
  call npm install
)
echo Starting Ghasaq at http://localhost:5173
call npm run dev
