@echo off
setlocal
cd /d "%~dp0"
title ZapoBetterWorkPlace - wysylanie zmian
echo.
echo =============================================
echo  ZapoBetterWorkPlace - wysylanie zmian
echo =============================================
echo.
where git >nul 2>&1
if errorlevel 1 (
  echo Git nie jest dostepny na tym komputerze.
  echo Otworz GitHub Desktop, a potem uruchom ten plik ponownie.
  echo.
  pause
  exit /b 1
)

echo Przygotowuje zmiany do wyslania...
rem Baza danych zostaje na komputerze/Railway i nigdy nie jest wysylana przez ten skrót.
git add -A -- . ":(exclude)zapobetterworkplace.db"
if errorlevel 1 (
  echo.
  echo Nie udalo sie przygotowac zmian.
  pause
  exit /b 1
)

git diff --cached --quiet
if errorlevel 1 (
  git commit -m "Aktualizacja ZapoBetterWorkPlace"
  if errorlevel 1 (
    echo.
    echo Nie udalo sie zapisac aktualizacji.
    pause
    exit /b 1
  )
) else (
  echo Nie ma nowych plikow do wyslania.
)

echo Wysylam do GitHuba...
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
