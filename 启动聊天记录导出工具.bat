@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "NODE_EXE=%ProgramFiles%\nodejs\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
"%NODE_EXE%" scripts\start.mjs
if errorlevel 1 pause
