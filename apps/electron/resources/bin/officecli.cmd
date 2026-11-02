@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "BIN=%~dp0win32-x64\officecli.exe"
if not exist "%BIN%" (
  echo Selection does not include bundled OfficeCLI for this platform. Repair or reinstall Selection. 1>&2
  exit /b 127
)

set "OFFICECLI_SKIP_UPDATE=1"

set "BUN_BIN=%~dp0..\..\vendor\bun\bun.exe"
set "WRAPPER=%~dp0..\scripts\officecli-wrapper.ts"
if not exist "%BUN_BIN%" (
  echo Selection's bundled runtime is unavailable for Word Heading compatibility. 1>&2
  exit /b 127
)
if not exist "%WRAPPER%" (
  echo Selection's OfficeCLI launcher is unavailable. 1>&2
  exit /b 127
)

if not "%SELECTION_WINDOWS_SANDBOX%"=="1" goto selection_run_officecli
if not exist "%SELECTION_OFFICECLI_WRAPPER%" (
  echo Selection's writable OfficeCLI launcher is unavailable in the isolated worker. 1>&2
  exit /b 127
)
set "WRAPPER=%SELECTION_OFFICECLI_WRAPPER%"

:selection_run_officecli
"%BUN_BIN%" "%WRAPPER%" "%BIN%" %*
exit /b %ERRORLEVEL%
