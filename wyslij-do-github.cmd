@echo off
setlocal
echo Wysylanie aktualnej wersji do GitHub...
git push origin main
if errorlevel 1 (
  echo.
  echo Wysylka nie udala sie. Zaloguj sie do GitHub w GitHub Desktop lub terminalu i uruchom ten plik ponownie.
) else (
  echo.
  echo Gotowe. Railway rozpocznie automatyczne wdrozenie za chwile.
)
pause
