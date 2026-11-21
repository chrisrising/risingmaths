@echo off
REM  Puts the current contents of the public folder live.
REM  Run this any time you change a page.
cd /d "%~dp0"
call firebase deploy --only hosting
echo.
pause
