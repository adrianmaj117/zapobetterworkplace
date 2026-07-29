@echo off
setlocal
where node >nul 2>nul
if %errorlevel%==0 (
  node server.js
  goto :end
)

set "CODEX_NODE=C:\Users\sinax\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if exist "%CODEX_NODE%" (
  "%CODEX_NODE%" server.js
  goto :end
)

echo.
echo Nie znaleziono Node.js.
echo Zainstaluj Node.js 24 lub nowszy z https://nodejs.org/ i uruchom ten plik ponownie.
pause
:end
