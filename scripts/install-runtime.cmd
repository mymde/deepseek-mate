@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-runtime.ps1"
set "WHALE_INSTALL_RESULT=%ERRORLEVEL%"
if not "%WHALE_INSTALL_RESULT%"=="0" echo Installation failed. See the message above.
pause
exit /b %WHALE_INSTALL_RESULT%
