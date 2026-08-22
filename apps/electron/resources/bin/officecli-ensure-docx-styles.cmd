@echo off
setlocal
set "BIN=%~1"
set "FILE=%~2"
set "OFFICECLI_NO_AUTO_RESIDENT=1"
if not defined BIN exit /b 0
if not defined FILE exit /b 0
if not exist "%BIN%" exit /b 0
if not exist "%FILE%" exit /b 0

"%BIN%" get "%FILE%" /styles/Heading1 >nul 2>&1
if %ERRORLEVEL%==0 exit /b 0

call :seed --prop id=Heading1 --prop type=paragraph --prop name=Heading1 --prop outlineLvl=0 --prop size=18pt --prop bold=true
call :seed --prop id=Heading2 --prop type=paragraph --prop name=Heading2 --prop outlineLvl=1 --prop size=14pt --prop bold=true
call :seed --prop id=Heading3 --prop type=paragraph --prop name=Heading3 --prop outlineLvl=2 --prop size=12pt --prop bold=true
call :seed --prop id=Title --prop type=paragraph --prop name=Title --prop size=24pt --prop bold=true
call :seed --prop id=TOCHeading --prop type=paragraph --prop name=TOCHeading --prop size=16pt --prop bold=true
exit /b 0

:seed
"%BIN%" add "%FILE%" /styles --type style %* >nul 2>&1
exit /b 0
