@echo off
setlocal EnableExtensions
set "BIN=%~1"
set "FILE=%~2"
set "JSON=%~dp0officecli-ensure-docx-styles.json"
set "OFFICECLI_NO_AUTO_RESIDENT=1"
if not defined BIN exit /b 0
if not defined FILE exit /b 0
if not exist "%BIN%" exit /b 0
if not exist "%FILE%" exit /b 0

set "SCAN=%TEMP%\officecli-styles-%RANDOM%.txt"
"%BIN%" get "%FILE%" /styles --depth 2 > "%SCAN%" 2>nul

findstr /c:"styleId=Heading1" "%SCAN%" >nul && findstr /c:"styleId=Heading2" "%SCAN%" >nul && findstr /c:"styleId=Heading3" "%SCAN%" >nul && findstr /c:"outlineLvl=0" "%SCAN%" >nul && findstr /c:"outlineLvl=1" "%SCAN%" >nul && findstr /c:"outlineLvl=2" "%SCAN%" >nul && goto done

findstr /c:"styleId=Heading1" "%SCAN%" >nul
if errorlevel 1 (
  if exist "%JSON%" (
    "%BIN%" batch "%FILE%" --best-effort --input "%JSON%" >nul 2>&1
    goto done
  )
)

call :ensure_heading Heading1 0 18pt
call :ensure_heading Heading2 1 14pt
call :ensure_heading Heading3 2 12pt
call :ensure_named Title 24pt
call :ensure_named TOCHeading 16pt

:done
if exist "%SCAN%" del /q "%SCAN%" >nul 2>&1
exit /b 0

:ensure_heading
set "ONE=%TEMP%\officecli-style-%~1-%RANDOM%.txt"
"%BIN%" get "%FILE%" /styles/%~1 > "%ONE%" 2>nul
if errorlevel 1 (
  "%BIN%" add "%FILE%" /styles --type style --prop id=%~1 --prop type=paragraph --prop name=%~1 --prop outlineLvl=%~2 --prop size=%~3 --prop bold=true >nul 2>&1
  if exist "%ONE%" del /q "%ONE%" >nul 2>&1
  exit /b 0
)
findstr /c:"outlineLvl=" "%ONE%" >nul
if errorlevel 1 (
  "%BIN%" set "%FILE%" /styles/%~1 --prop outlineLvl=%~2 >nul 2>&1
)
if exist "%ONE%" del /q "%ONE%" >nul 2>&1
exit /b 0

:ensure_named
"%BIN%" get "%FILE%" /styles/%~1 >nul 2>&1
if errorlevel 1 (
  "%BIN%" add "%FILE%" /styles --type style --prop id=%~1 --prop type=paragraph --prop name=%~1 --prop size=%~2 --prop bold=true >nul 2>&1
)
exit /b 0
