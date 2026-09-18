@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\sync-s3-from-tencent.ps1"
if errorlevel 1 (
  echo.
  echo Sync failed. Review the message above.
  pause
  exit /b 1
)
echo.
echo S3 sync completed.
pause
