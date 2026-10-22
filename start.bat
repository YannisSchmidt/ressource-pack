@echo off
rem ===========================================================================
rem  ATELIER RESOURCE PACK - start.bat
rem  Demarre l'application de bureau. Si l'installation est incomplete,
rem  lance automatiquement downloadALL.bat (Node.js, dependances, Electron,
rem  ressources de demonstration, compilation).
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>nul
title Atelier Resource Pack
cd /d "%~dp0"

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "INSTALL_TRIES=0"

:check
rem Node.js local (.tools\node), utilise seulement s'il est present.
if exist "%ROOT%\.tools\node\node.exe" set "PATH=%ROOT%\.tools\node;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto :needs_install
set "NODE_VER="
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_VER=%%v"
set "NODE_MAJOR="
for /f "tokens=1 delims=." %%a in ("!NODE_VER!") do set "NODE_MAJOR=%%a"
if not defined NODE_MAJOR goto :needs_install
echo !NODE_MAJOR!| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 goto :needs_install
if !NODE_MAJOR! LSS 22 goto :needs_install
if not exist "%ROOT%\node_modules\electron\dist\electron.exe" goto :needs_install
if not exist "%ROOT%\node_modules\yauzl" goto :needs_install

:check_build
if not exist "%ROOT%\dist\renderer\index.html" goto :build
if not exist "%ROOT%\dist\electron\main\main.js" goto :build
goto :run

:needs_install
set /a INSTALL_TRIES+=1
if !INSTALL_TRIES! GTR 1 (
  echo.
  echo  L'installation a deja ete tentee mais l'application reste incomplete.
  echo  Relancez downloadALL.bat et lisez le message d'erreur affiche.
  goto :fail
)
echo.
echo  Installation ou mise a jour des ressources necessaires...
echo  (Node.js, dependances, moteur Electron, ressources de demonstration)
echo.
call "%ROOT%\downloadALL.bat" /auto
if errorlevel 1 goto :fail
echo.
echo  Installation terminee, demarrage de l'application...
goto :check

:build
echo.
echo  Compilation de l'application...
call npm run build
if errorlevel 1 goto :fail
goto :run

:run
echo.
echo  Demarrage d'Atelier Resource Pack...
echo  (fermez cette fenetre noire pour quitter l'application)
echo.
call npm run run:desktop
if errorlevel 1 goto :fail
echo.
echo  Application fermee. A bientot !
exit /b 0

:fail
echo.
echo  ============================================================
echo   L'APPLICATION N'A PAS PU DEMARRER
echo  ============================================================
echo   Solutions :
echo     - relancez downloadALL.bat et lisez le message d'erreur ;
echo     - verifiez que Node.js 22+ est installe (commande : node -v) ;
echo     - verifiez votre connexion Internet lors de la premiere installation.
echo   Documentation : README.md et docs/USER-GUIDE.md
echo.
pause
exit /b 1
