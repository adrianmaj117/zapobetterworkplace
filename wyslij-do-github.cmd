@echo off
setlocal
title ZapoBetterWorkPlace - wysylanie zmian
echo.
echo =============================================
echo  ZapoBetterWorkPlace - wysylanie zmian
echo =============================================
echo.
echo Wysylanie aktualnej wersji na strone...
git push origin main
if errorlevel 1 (
  echo.
  echo Wysylka nie udala sie. Uruchom GitHub Desktop, zaloguj sie i kliknij ten plik ponownie.
) else (
  echo.
  echo Gotowe. Strona zaktualizuje sie automatycznie za chwile.
  echo Nie musisz niczego wpisywac w Railway.
)
echo.
pause
