# ZapoBetterWorkPlace — Magazyn spożywczy

Nowoczesna aplikacja do kontroli stanów magazynowych, dziennych zapotrzebowań oraz terminów ważności produktów.

## Wymagania

- Node.js 24 lub nowszy ([pobierz Node.js](https://nodejs.org/)). Aplikacja używa wbudowanej obsługi SQLite — nie wymaga osobnego serwera bazy.

## Uruchomienie

Najprościej w Windows: kliknij dwukrotnie plik `uruchom-windows.cmd`. Zostaw otwarte jego okno, a następnie wejdź na [http://localhost:3000](http://localhost:3000).

Możesz też uruchomić ręcznie w folderze projektu:

```bash
npm install
npm start
```

Następnie otwórz w przeglądarce: [http://localhost:3000](http://localhost:3000)

## Co zawiera aplikacja

- dodawanie, edycja i usuwanie artykułów spożywczych;
- lokalną bazę SQLite (`zapobetterworkplace.db`), tworzoną automatycznie po pierwszym uruchomieniu;
- zwiększanie stanu przez dostawy oraz zmniejszanie go przez zapotrzebowanie lub odpis;
- historię każdej zmiany stanu;
- alerty dla produktów wygasających w ciągu 30 dni i dla niskich stanów;
- filtrowanie według kategorii, wyszukiwanie oraz sortowanie po najbliższym terminie;
- responsywny interfejs dla komputerów i telefonów.

## Kopia danych

Cała baza jest zapisywana w pliku `zapobetterworkplace.db` w folderze projektu. Aby wykonać kopię, zamknij aplikację i skopiuj ten plik w bezpieczne miejsce.
