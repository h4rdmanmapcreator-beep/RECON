@echo off
setlocal

REM Build the standalone Windows GUI: cncstats-gui.exe
REM   -s -w           strip debug info (smaller binary)
REM   -H windowsgui   make it a GUI app (no console window flashes)
REM
REM Double-click this file in Explorer to rebuild, or run from a shell.

cd /d "%~dp0"

where go >nul 2>&1
if errorlevel 1 (
    echo Go is not on PATH. Install it from https://go.dev/dl/ and try again.
    pause
    exit /b 1
)

echo Building cncstats-gui.exe...
echo.

go build -ldflags="-s -w -H windowsgui" -o cncstats-gui.exe .\cmd\gui
if errorlevel 1 (
    echo.
    echo BUILD FAILED. See the messages above.
    pause
    exit /b 1
)

echo.
echo Build OK.
for %%I in (cncstats-gui.exe) do echo %%~zI bytes  ^|  %%~tI  ^|  %%~nxI
echo.
pause
