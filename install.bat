@echo off
echo Installing ZClaw dependencies...
call pnpm install

echo Building ZClaw...
call pnpm run build

echo.
echo ============================================
echo   Installation Complete!
echo ============================================
echo.
echo To configure, run:
echo   pnpm start -- setup
echo.
echo To use, run:
echo   pnpm start
echo.
pause
