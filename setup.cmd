@echo off
setlocal enabledelayedexpansion
title RisingMaths - Firebase setup
cd /d "%~dp0"

REM Windows only adds a newly installed program to the PATH of windows opened
REM afterwards, so point at the usual places directly. This is what saves
REM having to close and reopen this window after each install.
set "PATH=%PATH%;%ProgramFiles%\nodejs;%ProgramFiles(x86)%\nodejs;%APPDATA%\npm;%ProgramFiles%\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd"

echo.
echo   ================================================
echo     RisingMaths - first time setup
echo   ================================================
echo.
echo   Installs what is needed, fetches the site, puts
echo   it live, then sets it up to deploy itself.
echo.
echo   You sign in twice along the way - once with
echo   Google, once with GitHub. A browser opens for
echo   each. Everything else is automatic.
echo.
pause
echo.

REM ---- Node.js ---------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo   Installing Node.js...
  echo.
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  set "PATH=!PATH!;%ProgramFiles%\nodejs;%APPDATA%\npm"
)
where node >nul 2>&1
if errorlevel 1 goto restart
echo   Node.js: ready.

REM ---- Git -------------------------------------------------------------------
where git >nul 2>&1
if errorlevel 1 (
  echo   Installing Git...
  echo.
  winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
  set "PATH=!PATH!;%ProgramFiles%\Git\cmd;%LOCALAPPDATA%\Programs\Git\cmd"
)
where git >nul 2>&1
if errorlevel 1 goto restart
echo   Git: ready.

REM ---- The site files --------------------------------------------------------
if not exist "firebase.json" (
  if exist "risingmaths\firebase.json" (
    cd risingmaths
  ) else (
    echo   Fetching the site from GitHub...
    git clone https://github.com/chrisrising/risingmaths
    if errorlevel 1 goto failed
    cd risingmaths
  )
)
echo   Site files: ready.

REM ---- Firebase command line tool ---------------------------------------------
where firebase >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Installing the Firebase tool. Takes a couple of minutes...
  echo.
  call npm install -g firebase-tools
  set "PATH=!PATH!;%APPDATA%\npm"
)
where firebase >nul 2>&1
if errorlevel 1 goto restart
echo   Firebase tool: ready.

REM ---- Sign in ------------------------------------------------------------------
echo.
echo   ================================================
echo     Signing in to Google - a browser will open.
echo     Answer anything it asks here in this window.
echo   ================================================
echo.
call firebase login
if errorlevel 1 goto failed

REM ---- The hosting site -----------------------------------------------------------
REM Nothing is hidden from here on. Firebase sometimes asks a question - to switch
REM an API on, for instance - and a hidden question looks exactly like a freeze.
echo.
echo   ================================================
echo     Setting up the hosting site.
echo.
echo     If it asks anything, answer it here. Press Y
echo     to any question about enabling an API.
echo     "already exists" is fine and expected.
echo   ================================================
echo.
call firebase hosting:sites:create risingmaths

REM ---- Put it live -----------------------------------------------------------------
echo.
echo   ================================================
echo     Putting the site live...
echo   ================================================
echo.
call firebase deploy --only hosting
if errorlevel 1 goto failed

REM ---- Auto deploy ---------------------------------------------------------------------
echo.
echo   ================================================
echo     Now the automatic deploys.
echo.
echo     Answer like this:
echo       Which GitHub repository   chrisrising/risingmaths
echo       Run a build script?       N
echo       Deploy when a PR merges?  Y
echo       Which branch?             main
echo.
echo     If it asks whether to OVERWRITE
echo     public/index.html, answer N.
echo   ================================================
echo.
pause
call firebase init hosting:github

REM ---- Save what it wrote ------------------------------------------------------------------
echo.
echo   Saving to GitHub...
git add -A
git commit -m "Auto-deploy to Firebase on push"
git push

echo.
echo   ================================================
echo     All done.
echo.
echo     Your site:  https://risingmaths.web.app
echo.
echo     Every push now deploys itself. To publish by
echo     hand instead, double-click deploy.cmd.
echo   ================================================
echo.
pause
exit /b

:restart
echo.
echo   ------------------------------------------------
echo     Something was just installed, and Windows
echo     needs a fresh window to see it.
echo.
echo     CLOSE this window and run setup.cmd again.
echo     It picks up where it left off.
echo   ------------------------------------------------
echo.
pause
exit /b

:failed
echo.
echo   That step did not work. Copy the message above
echo   and send it to Claude.
echo.
pause
exit /b 1
