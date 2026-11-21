@echo off
setlocal enabledelayedexpansion
title RisingMaths - Firebase setup
cd /d "%~dp0"
color 0B

echo.
echo   ================================================
echo     RisingMaths - first time setup
echo   ================================================
echo.
echo   This installs what is needed, fetches the site,
echo   puts it live, and sets it up to deploy itself
echo   from then on. Run it from anywhere - it will
echo   make a risingmaths folder here if needed.
echo.
echo   You will be asked to sign in twice along the way:
echo   once with Google, once with GitHub. A browser
echo   window opens for each.
echo.
pause
echo.

REM ---- Node.js -------------------------------------------------------------
where node >nul 2>&1
if errorlevel 1 (
  echo   Node.js is not installed. Installing it now...
  echo.
  winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  echo.
  echo   ------------------------------------------------
  echo     Node.js is installed.
  echo     CLOSE this window, then run setup.cmd again.
  echo   ------------------------------------------------
  echo.
  pause
  exit /b
)
echo   Node.js: found.

REM ---- Git (only needed to save the workflow file afterwards) ---------------
where git >nul 2>&1
if errorlevel 1 (
  echo   Git is not installed. Installing it now...
  winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements
  echo.
  echo   ------------------------------------------------
  echo     Git is installed.
  echo     CLOSE this window, then run setup.cmd again.
  echo   ------------------------------------------------
  echo.
  pause
  exit /b
)
echo   Git: found.

REM ---- The site files ---------------------------------------------------------
if not exist "firebase.json" (
  if exist "risingmaths\firebase.json" (
    cd risingmaths
  ) else (
    echo.
    echo   Fetching the site files from GitHub...
    git clone https://github.com/chrisrising/risingmaths
    if errorlevel 1 goto failed
    cd risingmaths
  )
)
echo   Site files: ready.

REM ---- Firebase command line tool -------------------------------------------
where firebase >nul 2>&1
if errorlevel 1 (
  echo.
  echo   Installing the Firebase tool. This takes a couple of minutes...
  echo.
  call npm install -g firebase-tools
  if errorlevel 1 goto failed
) else (
  echo   Firebase tool: found.
)

REM ---- Sign in ---------------------------------------------------------------
echo.
echo   ------------------------------------------------
echo     Signing in to Google. A browser will open.
echo   ------------------------------------------------
echo.
call firebase login
if errorlevel 1 goto failed

REM ---- Make sure the hosting site exists --------------------------------------
echo.
echo   Checking the hosting site...
call firebase hosting:sites:create risingmaths >nul 2>&1
if errorlevel 1 (
  echo   Hosting site already set up - carrying on.
) else (
  echo   Hosting site created.
)

REM ---- Put it live -------------------------------------------------------------
echo.
echo   ------------------------------------------------
echo     Putting the site live...
echo   ------------------------------------------------
echo.
call firebase deploy --only hosting
if errorlevel 1 goto failed

REM ---- Auto deploy from GitHub --------------------------------------------------
echo.
echo   ------------------------------------------------
echo     Now setting up automatic deploys.
echo.
echo     Answer the questions like this:
echo.
echo       Which GitHub repository    chrisrising/risingmaths
echo       Run a build script?        N
echo       Deploy when a PR merges?   Y
echo       Which branch?              main
echo.
echo     If it ever asks whether to OVERWRITE
echo     public/index.html, answer N.
echo   ------------------------------------------------
echo.
pause
call firebase init hosting:github

REM ---- Save the workflow it just wrote -------------------------------------------
echo.
echo   Saving the new workflow to GitHub...
git add -A
git commit -m "Auto-deploy to Firebase on push"
git push

echo.
echo   ================================================
echo     All done.
echo.
echo     Your site:  https://risingmaths.web.app
echo.
echo     From now on, anything pushed to the repo
echo     deploys itself. To publish a change by hand,
echo     double-click deploy.cmd instead.
echo   ================================================
echo.
pause
exit /b

:failed
echo.
echo   Something went wrong above. Copy the red text and send it to Claude.
echo.
pause
exit /b 1
