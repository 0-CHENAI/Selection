@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "BIN=%~dp0win32-x64\officecli.exe"
if not exist "%BIN%" (
  echo Selection's app-managed OfficeCLI binary is unavailable. 1>&2
  exit /b 127
)

set "BUN_BIN="
if exist "%~dp0..\..\vendor\bun\bun.exe" set "BUN_BIN=%~dp0..\..\vendor\bun\bun.exe"
if not defined BUN_BIN (
  echo Selection's bundled Bun runtime is unavailable; attribution verification failed closed. 1>&2
  exit /b 127
)
set "WRAPPER=%~dp0..\scripts\officecli-wrapper.js"
if not exist "%WRAPPER%" (
  echo Selection's reviewed OfficeCLI wrapper is unavailable. 1>&2
  exit /b 127
)

"%BUN_BIN%" "%WRAPPER%" "%BIN%" %*
exit /b %ERRORLEVEL%
