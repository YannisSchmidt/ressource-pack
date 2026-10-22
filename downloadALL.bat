@echo off
rem ===========================================================================
rem  ATELIER RESOURCE PACK - downloadALL.bat
rem  Telecharge et prepare TOUT ce qui est necessaire :
rem    1. Node.js 22+ (si absent) dans .tools\node  (aucun droit admin requis)
rem    2. les dependances npm du projet
rem    3. le moteur Electron (application de bureau)
rem    4. les ressources de demonstration
rem    5. la compilation de l'application
rem  Ce script ne modifie ni ne supprime aucun fichier de vos ressources.
rem ===========================================================================
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>nul
title Atelier Resource Pack - Telechargement des ressources
cd /d "%~dp0"
color 0B

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"
set "TOOLS=%ROOT%\.tools"
set "NODE_DIR=%TOOLS%\node"
set "NODE_EXE="
set "NPM_CMD="
set "NODE_VER="
set "AUTO=0"
if /i "%~1"=="/auto" set "AUTO=1"

echo.
echo  ============================================================
echo   ATELIER RESOURCE PACK  -  installation en un clic
echo  ============================================================
echo   Ce script prepare tout ce qui est necessaire :
echo     1. Node.js (telecharge dans .tools\node si absent)
echo     2. les dependances npm du projet
echo     3. le moteur Electron (application de bureau)
echo     4. les ressources de demonstration
echo     5. la compilation de l'application
echo.
echo   Aucun droit administrateur n'est necessaire.
echo   Dossier du projet : %ROOT%
echo.

rem ---------------------------------------------------------------- 1. Node.js
call :detect_node
if defined NODE_EXE goto :node_ready
echo       Node.js 22+ introuvable : installation automatique...
call :install_node
:node_ready
if not defined NODE_EXE goto :fatal_node
echo.
echo  [1/5] Node.js : !NODE_VER!  (!NODE_EXE!)
echo.

rem ------------------------------------------------------------ 2. dependances
echo  [2/5] Installation des dependances npm (cela peut prendre quelques minutes)...
call :install_deps
if errorlevel 1 goto :fatal_npm
echo        Dependances installees.
echo.

rem ---------------------------------------------------------------- 3. Electron
echo  [3/5] Verification du moteur Electron...
if exist "%ROOT%\node_modules\electron\dist\electron.exe" goto :electron_ready
if "%ELECTRON_SKIP_BINARY_DOWNLOAD%"=="1" (
  echo        ATTENTION : ELECTRON_SKIP_BINARY_DOWNLOAD=1 est defini dans votre environnement.
  echo        Le moteur Electron ne sera pas telecharge ; l'application de bureau ne pourra pas demarrer.
)
if not exist "%ROOT%\node_modules\electron\install.js" goto :fatal_electron
echo        Telechargement du moteur Electron (environ 100 Mo)...
pushd "%ROOT%"
call "%NODE_EXE%" node_modules\electron\install.js
if errorlevel 1 (
  popd
  goto :fatal_electron
)
popd
if not exist "%ROOT%\node_modules\electron\dist\electron.exe" goto :fatal_electron
:electron_ready
echo        Moteur Electron present.
echo.

rem -------------------------------------------------------------------- 4. demo
echo  [4/5] Generation des ressources de demonstration...
pushd "%ROOT%"
call "%NPM_CMD%" run demo:assets
if errorlevel 1 (
  popd
  goto :fatal_demo
)
popd
echo        Ressources de demonstration generees.
echo.

rem ------------------------------------------------------------------ 5. build
echo  [5/5] Compilation de l'application...
pushd "%ROOT%"
call "%NPM_CMD%" run build
if errorlevel 1 (
  popd
  goto :fatal_build
)
popd
if not exist "%ROOT%\dist\renderer\index.html" goto :fatal_build
if not exist "%ROOT%\dist\electron\main\main.js" goto :fatal_build
if not exist "%ROOT%\node_modules\electron\dist\electron.exe" goto :fatal_electron

if not exist "%TOOLS%" mkdir "%TOOLS%"
> "%TOOLS%\install-ok.txt" echo Installation terminee le %DATE% a %TIME%
>> "%TOOLS%\install-ok.txt" echo Node.js : !NODE_VER!
>> "%TOOLS%\install-ok.txt" echo Dossier : %ROOT%

echo.
echo  ============================================================
echo   INSTALLATION TERMINEE AVEC SUCCES
echo  ============================================================
echo   Node.js   : !NODE_VER!
echo   Application compilee dans dist\
echo.
echo   Double-cliquez maintenant sur start.bat pour demarrer
echo   l'application, ou lancez-la depuis ce dossier.
echo.
if "%AUTO%"=="0" pause
exit /b 0

rem ===========================================================================
rem  Sous-programmes
rem ===========================================================================

:detect_node
rem 1) Un Node.js 22+ est-il deja disponible sur le systeme ?
where node >nul 2>nul
if errorlevel 1 goto :detect_local
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_VER=%%v"
call :major_ok "!NODE_VER!"
if errorlevel 1 goto :detect_local
set "NODE_EXE=node"
set "NPM_CMD=npm"
exit /b 0

:detect_local
set "NODE_VER="
rem 2) Une installation locale (.tools\node) est-elle utilisable ?
if not exist "%NODE_DIR%\node.exe" exit /b 0
set "PATH=%NODE_DIR%;!PATH!"
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_VER=%%v"
call :major_ok "!NODE_VER!"
if errorlevel 1 (
  echo        L'installation locale de Node.js est trop ancienne : elle sera remplacee.
  set "NODE_VER="
  exit /b 0
)
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CMD=%NODE_DIR%\npm.cmd"
exit /b 0

:major_ok
rem Retourne 0 si la version (majeure) permet d'executer le projet.
set "PV=%~1"
if not defined PV exit /b 1
for /f "tokens=1 delims=." %%a in ("%PV%") do set "PV=%%a"
echo %PV%| findstr /r "^[0-9][0-9]*$" >nul
if errorlevel 1 exit /b 1
if %PV% LSS 22 exit /b 1
exit /b 0

:install_node
if not exist "%TOOLS%" mkdir "%TOOLS%"
set "ARCH=win-x64"
if /i "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "ARCH=win-arm64"
if /i "%PROCESSOR_ARCHITEW6432%"=="ARM64" set "ARCH=win-arm64"
echo        Architecture detectee : %ARCH%
call :try_channel latest-v24.x "%ARCH%"
if defined NODE_EXE exit /b 0
call :try_channel latest-v22.x "%ARCH%"
if defined NODE_EXE exit /b 0
exit /b 1

:try_channel
rem %1 = canal nodejs.org (ex. latest-v24.x) ; %2 = architecture Windows
set "CHANNEL=%~1"
set "ARCH=%~2"
set "SHASUMS=%TOOLS%\SHASUMS256-%CHANNEL%.txt"
set "NODE_HASH="
set "NODE_ZIP="
set "ACTUAL_HASH="
set "NODE_VER="
echo        Recuperation de la liste officielle %CHANNEL%...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;try{Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/%CHANNEL%/SHASUMS256.txt' -OutFile '%SHASUMS%'}catch{exit 1}"
if errorlevel 1 (
  echo        Impossible de contacter nodejs.org (%CHANNEL%).
  exit /b 1
)
if not exist "%SHASUMS%" exit /b 1

for /f "tokens=1,*" %%a in ('findstr /i /c:"-%ARCH%.zip" "%SHASUMS%"') do (
  set "NODE_HASH=%%a"
  set "NODE_ZIP=%%b"
)
if not defined NODE_ZIP (
  echo        Aucune archive %ARCH% trouvee pour %CHANNEL%.
  exit /b 1
)
echo        Archive officielle : !NODE_ZIP!
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ProgressPreference='SilentlyContinue';[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12;try{Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/%CHANNEL%/!NODE_ZIP!' -OutFile '%TOOLS%\!NODE_ZIP!'}catch{exit 1}"
if errorlevel 1 (
  echo        Echec du telechargement de l'archive Node.js.
  exit /b 1
)

rem Verification d'integrite SHA-256 avec la somme publiee par nodejs.org.
for /f "delims=" %%h in ('powershell -NoProfile -ExecutionPolicy Bypass -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '%TOOLS%\!NODE_ZIP!' ^| Select-Object -ExpandProperty Hash)"') do set "ACTUAL_HASH=%%h"
if /i not "!ACTUAL_HASH!"=="!NODE_HASH!" (
  echo        ERREUR : la somme SHA-256 de l'archive ne correspond pas. Fichier supprime.
  del /q "%TOOLS%\!NODE_ZIP!" >nul 2>nul
  exit /b 1
)
echo        Integrite verifiee (SHA-256).

echo        Extraction de Node.js...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try{Expand-Archive -LiteralPath '%TOOLS%\!NODE_ZIP!' -DestinationPath '%TOOLS%' -Force; exit 0}catch{exit 1}"
if errorlevel 1 (
  echo        Echec de l'extraction de l'archive.
  exit /b 1
)
if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%" >nul 2>nul
for /d %%d in ("%TOOLS%\node-v*") do (
  move "%%d" "%NODE_DIR%" >nul
)
del /q "%TOOLS%\!NODE_ZIP!" >nul 2>nul
del /q "%SHASUMS%" >nul 2>nul

if not exist "%NODE_DIR%\node.exe" (
  echo        node.exe introuvable apres extraction.
  exit /b 1
)
set "PATH=%NODE_DIR%;!PATH!"
set "NODE_EXE=%NODE_DIR%\node.exe"
set "NPM_CMD=%NODE_DIR%\npm.cmd"
for /f "delims=" %%v in ('node -p "process.versions.node" 2^>nul') do set "NODE_VER=%%v"
if not defined NODE_VER (
  echo        Node.js installe mais non execable.
  set "NODE_EXE="
  set "NPM_CMD="
  exit /b 1
)
call :major_ok "!NODE_VER!"
if errorlevel 1 (
  echo        Version de Node.js inattendue : !NODE_VER!
  set "NODE_EXE="
  set "NPM_CMD="
  exit /b 1
)
echo        Node.js !NODE_VER! installe dans .tools\node
exit /b 0

:install_deps
rem Installation deterministe au premier lancement, puis incrementale :
rem cela evite de re-telecharger le moteur Electron a chaque execution.
pushd "%ROOT%"
if exist "%ROOT%\node_modules\electron\package.json" goto :deps_incremental
echo        Premiere installation : npm ci (versions verrouillees)...
call "%NPM_CMD%" ci --no-audit --no-fund
if errorlevel 1 goto :deps_ci_fallback
goto :deps_check
:deps_incremental
echo        Mise a jour incrementale : npm install...
call "%NPM_CMD%" install --no-audit --no-fund
if errorlevel 1 goto :deps_ci_fallback
goto :deps_check
:deps_ci_fallback
echo        Nouvelle tentative avec npm ci...
call "%NPM_CMD%" ci --no-audit --no-fund
if errorlevel 1 (
  popd
  exit /b 1
)
:deps_check
popd
if not exist "%ROOT%\node_modules\pngjs" exit /b 1
if not exist "%ROOT%\node_modules\yauzl" exit /b 1
if not exist "%ROOT%\node_modules\yazl" exit /b 1
if not exist "%ROOT%\node_modules\tsx" exit /b 1
if not exist "%ROOT%\node_modules\electron\package.json" exit /b 1
exit /b 0

rem ===========================================================================
rem  Erreurs
rem ===========================================================================

:fatal_node
echo.
echo  [ERREUR] Node.js 22+ n'a pas pu etre installe automatiquement.
echo           Causes possibles : pas de connexion Internet, proxy, antivirus.
echo           Solution : installez Node.js 22 ou plus depuis
echo                      https://nodejs.org/fr/download
echo           puis relancez downloadALL.bat.
goto :end_fail

:fatal_npm
echo.
echo  [ERREUR] L'installation des dependances npm a echoue.
echo           Verifiez votre connexion Internet puis relancez downloadALL.bat.
echo           Si le probleme persiste, executez manuellement :
echo             npm install --no-audit --no-fund
goto :end_fail

:fatal_electron
echo.
echo  [ERREUR] Le moteur Electron est absent.
echo           Causes possibles : proxy d'entreprise, antivirus, telechargement interrompu.
echo           Solution : relancez downloadALL.bat, ou executez manuellement :
echo             node node_modules\electron\install.js
echo           Derriere un proxy, definissez ELECTRON_MIRROR puis relancez le script.
goto :end_fail

:fatal_demo
echo.
echo  [ERREUR] La generation des ressources de demonstration a echoue.
echo           Relancez downloadALL.bat ; verifiez que le disque n'est pas plein.
goto :end_fail

:fatal_build
echo.
echo  [ERREUR] La compilation de l'application a echoue.
echo           Verifiez que Node.js 22+ est bien utilise (node -v) puis relancez
echo           downloadALL.bat. Les messages ci-dessus indiquent la cause exacte.
goto :end_fail

:end_fail
echo.
if "%AUTO%"=="0" pause
exit /b 1
