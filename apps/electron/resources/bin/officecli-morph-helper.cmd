@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "BIN=%~dp0win32-x64\officecli.exe"
set "BUN_BIN=%~dp0..\..\vendor\bun\bun.exe"
set "HELPER=%~dp0..\scripts\officecli-morph-helper.ts"
if not exist "%BIN%" (
  echo Selection does not include bundled OfficeCLI for this platform. Repair or reinstall Selection. 1>&2
  exit /b 127
)
if not exist "%BUN_BIN%" (
  echo Selection's bundled Morph helper runtime is unavailable. Repair or reinstall Selection. 1>&2
  exit /b 127
)
if not exist "%HELPER%" (
  echo Selection's bundled Morph helper is unavailable. Repair or reinstall Selection. 1>&2
  exit /b 127
)
"%BUN_BIN%" "%HELPER%" "%BIN%" %*
exit /b %ERRORLEVEL%
