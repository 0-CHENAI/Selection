@echo off
setlocal
if defined CRAFT_OFFICECLI if exist "%CRAFT_OFFICECLI%" (
  "%CRAFT_OFFICECLI%" %*
  exit /b %ERRORLEVEL%
)
set "CAND=%~dp0win32-x64\officecli.exe"
if exist "%CAND%" (
  "%CAND%" %*
  exit /b %ERRORLEVEL%
)
echo officecli is not bundled in this Selection build. Rebuild the app or set CRAFT_OFFICECLI. 1>&2
exit /b 127
