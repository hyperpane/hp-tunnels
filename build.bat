@echo off
rem An author's helper on Windows: installs this plugin's dependencies and
rem checks it. It builds nothing: the app runs the package from its
rem TypeScript sources. The same as build.sh:
rem
rem   build.bat               install, type-check, validate plugin.json
rem   build.bat --test        and run the tests
rem   build.bat --no-install  only check
rem   build.bat --quiet       print only problems
rem
rem The SDK (types, tests) comes from %HYPERPANE_SDK% (a .tgz), the hyperpane
rem repo this is in, the app's resources, or else the release.

setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

set INSTALL=1
set TESTS=0
set QUIET=0
for %%A in (%*) do (
  if "%%~A"=="--no-install" (set INSTALL=0) else if "%%~A"=="--test" (set TESTS=1) else if "%%~A"=="--quiet" (set QUIET=1) else (
    echo Unknown option: %%~A ^(use --test, --no-install, --quiet^) 1>&2
    exit /b 2
  )
)

where node >nul 2>nul || goto :nonode
where npm >nul 2>nul || goto :nonode
for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set MAJOR=%%V
if !MAJOR! LSS 24 (
  echo Node is too old: plugins need Node 24 or newer ^(winget install OpenJS.NodeJS.LTS^). 1>&2
  exit /b 1
)

set VERSION=0.1.5
set NPMQ=
if "%QUIET%"=="1" set NPMQ=--silent

if "%INSTALL%"=="1" (
  if exist package.json (
    if "%QUIET%"=="0" echo Dev tools ^(npm install^)
    call npm install --ignore-scripts --no-audit --no-fund %NPMQ% || exit /b 1
  )
  call :sdk || exit /b 1
  if "%QUIET%"=="0" echo SDK: !TGZ!
  if exist node_modules\@hyperpane\sdk rmdir /s /q node_modules\@hyperpane\sdk
  mkdir node_modules\@hyperpane\sdk
  tar -xzf "!TGZ!" -C node_modules\@hyperpane\sdk --strip-components=1 || exit /b 1
  for %%P in (server client) do (
    if exist src\%%P\package.json (
      if "%QUIET%"=="0" echo src\%%P ^(npm install --omit=dev --omit=optional --ignore-scripts^)
      pushd src\%%P
      call npm install --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund %NPMQ%
      if errorlevel 1 (popd & exit /b 1)
      popd
    )
  )
)

if not exist node_modules\.bin\tsc.cmd (
  echo TypeScript isn't installed here: run build.bat without --no-install. 1>&2
  exit /b 1
)
set STATUS=0
for %%P in (server client) do (
  if exist src\%%P\tsconfig.json (
    if "%QUIET%"=="0" echo tsc --noEmit -p src\%%P
    call node_modules\.bin\tsc.cmd --noEmit -p src\%%P || set STATUS=1
  )
)
if "%QUIET%"=="0" echo plugin.json
if "%QUIET%"=="1" (
  node node_modules\@hyperpane\sdk\manifest\cli.js check . --quiet || set STATUS=1
) else (
  node node_modules\@hyperpane\sdk\manifest\cli.js check . || set STATUS=1
)
if "%TESTS%"=="1" if exist test (
  set FILES=
  for /r test %%F in (*.test.ts *.test.mjs *.test.js) do set FILES=!FILES! "%%F"
  if defined FILES (
    if "%QUIET%"=="0" echo node --test
    node --import ./node_modules/@hyperpane/sdk/register.mjs --test !FILES! || set STATUS=1
  )
)
exit /b %STATUS%

:sdk
if defined HYPERPANE_SDK (set "TGZ=%HYPERPANE_SDK%" & exit /b 0)
for %%F in ("..\..\sdk\js\dist\pack\hyperpane-sdk-%VERSION%.tgz" "%LOCALAPPDATA%\Programs\hyperpane\resources\sdk\hyperpane-sdk-%VERSION%.tgz") do (
  if exist %%F (set "TGZ=%%~F" & exit /b 0)
)
if not exist node_modules\.cache mkdir node_modules\.cache
set "TGZ=node_modules\.cache\hyperpane-sdk-%VERSION%.tgz"
if exist "%TGZ%" exit /b 0
curl -fsSL -o "%TGZ%" "https://github.com/astralyxdev/hyperpane/releases/download/v%VERSION%/hyperpane-sdk-%VERSION%.tgz"
if errorlevel 1 (
  del /q "%TGZ%" 2>nul
  echo Couldn't find the SDK: set HYPERPANE_SDK to hyperpane-sdk-%VERSION%.tgz ^(it comes with the app, in its resources\sdk^). 1>&2
  exit /b 1
)
exit /b 0

:nonode
echo Node 24 or newer, with npm, is needed: winget install OpenJS.NodeJS.LTS 1>&2
exit /b 1
