@echo off
setlocal

REM Build recon.exe — the standalone Windows GUI
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

echo Building recon.exe        (browser mode)...
go build -ldflags="-s -w -H windowsgui" -o recon.exe .\cmd\gui
if errorlevel 1 ( echo BUILD FAILED & pause & exit /b 1 )

echo Building recon-window.exe  (WebView2 native window)...
go build -tags window -ldflags="-s -w -H windowsgui" -o recon-window.exe .\cmd\gui
if errorlevel 1 ( echo BUILD FAILED & pause & exit /b 1 )

echo.
echo Build OK.
for %%I in (recon.exe)        do echo %%~zI bytes  ^|  %%~tI  ^|  %%~nxI
for %%I in (recon-window.exe) do echo %%~zI bytes  ^|  %%~tI  ^|  %%~nxI
echo.
echo recon.exe        - opens replay analysis in your default browser
echo recon-window.exe - opens in a native window (requires Edge WebView2 Runtime)
echo.
pause
