@echo off
setlocal EnableExtensions
if defined CRAFT_OFFICECLI if exist "%CRAFT_OFFICECLI%" (
  set "BIN=%CRAFT_OFFICECLI%"
) else (
  set "CAND=%~dp0win32-x64\officecli.exe"
  if exist "%CAND%" (
    set "BIN=%CAND%"
  ) else (
    echo officecli is not bundled in this Selection build. Rebuild the app or set CRAFT_OFFICECLI. 1>&2
    exit /b 127
  )
)

set "ENSURE=%~dp0officecli-ensure-docx-styles.cmd"
set "VERB="
set "DOCX="
set "ENSURE_BEFORE=0"
set "ENSURE_AFTER=0"
set "PREV="
set "I=1"

:parse
call set "ARG=%%~%I%"
if not defined ARG goto parsed
if /i "%ARG%"=="create" if not defined VERB (
  set "VERB=create"
  set "ENSURE_AFTER=1"
)
if /i "%ARG%"=="add" if not defined VERB set "VERB=add"
if /i "%ARG%"=="set" if not defined VERB set "VERB=set"
echo.%ARG%| findstr /i /e /c:".docx" /c:".docm" >nul && if not defined DOCX set "DOCX=%ARG%"
echo.%ARG%| findstr /i /c:"style=Heading" /c:"style=Title" /c:"style=TOCHeading" /c:"--type=toc" >nul && set "ENSURE_BEFORE=1"
echo.%ARG%| findstr /i /c:"id=Heading" /c:"id=Title" /c:"id=TOCHeading" >nul && set "ENSURE_AFTER=1"
if /i "%PREV%"=="--type" if /i "%ARG%"=="toc" set "ENSURE_BEFORE=1"
set "PREV=%ARG%"
set /a I+=1
goto parse

:parsed
if /i "%VERB%"=="create" goto do_create
if "%ENSURE_BEFORE%"=="1" goto do_write
if "%ENSURE_AFTER%"=="1" goto do_write
"%BIN%" %*
exit /b %ERRORLEVEL%

:do_create
"%BIN%" %*
set "ERR=%ERRORLEVEL%"
if %ERR% EQU 0 call :ensure
exit /b %ERR%

:do_write
if "%ENSURE_BEFORE%"=="1" call :ensure
"%BIN%" %*
set "ERR=%ERRORLEVEL%"
if %ERR% EQU 0 if "%ENSURE_AFTER%"=="1" call :ensure
exit /b %ERR%

:ensure
if not defined DOCX exit /b 0
if not exist "%ENSURE%" exit /b 0
if not exist "%DOCX%" exit /b 0
call "%ENSURE%" "%BIN%" "%DOCX%"
exit /b 0
