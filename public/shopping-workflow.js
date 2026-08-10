/* Trwała lista zakupów: ręczne pozycje, zakup, anulowanie i zwarty wydruk. */
(() => {
  const dialog = document.querySelector('#shoppingListDialog');
  const content = document.querySelector('#shoppingListContent');
  const printButton = document.querySelector('#printShoppingList');
  const manualForm = document.querySelector('#manualShoppingItemForm');
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const number = value => Number(value || 0);
  const remaining = item => Math.max(0, number(item.missing_quantity) - number(item.purchased_quantity));
  const isCompleted = item => item.status === 'purchased' || remaining(item) <= 0;
  let activeList = null;

  const productBrand = item => item.brand || (item.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const productWeight = item => item.weight || (item.weight_value ? `${item.weight_value} ${item.weight_unit}` : 'bez gramatury');
  const currentDate = () => new Date().toISOString().slice(0, 10);
  const excludedShoppingCategory = value => {
    const category = String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    return category === 'inne'
      || category.includes('owoce')
      || category.includes('warzywa')
      || (category.includes('bulki') && category.includes('katowic'));
  };

  function categoryChoices() {
    const values = [...new Set([...cats, ...all.map(item => item.category), 'Nabiał', 'Owoce i Warzywa', 'Zioła', 'Bułki z KATOWIC', 'Inne'])]
      .filter(value => value && !excludedShoppingCategory(value)).sort((a, b) => a.localeCompare(b, 'pl'));
    document.querySelector('#manualShoppingCategories').innerHTML = values.map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  }

  function render(list) {
    activeList = list || null;
    const items = [...(list?.items || [])].filter(item => item.status !== 'dismissed');
    const pending = items.filter(item => !isCompleted(item));
    const done = items.filter(isCompleted);
    if (!list) {
      content.innerHTML = '<div class="shopping-empty"><b>Lista zakupów jest pusta.</b><span>Pozycje z braków i dodane ręcznie będą czekały tutaj, aż je kupisz albo usuniesz.</span></div>';
      printButton.hidden = true;
      return;
    }
    const itemsHtml = group => group.map(item => {
      const left = remaining(item), completed = isCompleted(item);
      return `<article class="shopping-workflow-item ${completed ? 'is-purchased' : ''}">
        <div><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.category || 'Inne')} · ${escapeHtml(productBrand(item))} · ${escapeHtml(productWeight(item))}</small></div>
        <div class="shopping-item-numbers"><span>stan: ${number(item.available_quantity)} ${escapeHtml(item.unit || 'szt.')}</span><strong>${completed ? `✓ Kupione: ${number(item.purchased_quantity || item.missing_quantity)} ${escapeHtml(item.unit || 'szt.')}` : `brakuje: ${left} ${escapeHtml(item.unit || 'szt.')}`}</strong></div>
        ${completed ? '<span class="shopping-purchased-label">Kupione</span>' : `<button type="button" class="shopping-complete" data-shopping-complete="${item.id}" title="Oznacz jako kupione" aria-label="Oznacz zakup: ${escapeHtml(item.name)}">✓</button>`}
        <button type="button" class="shopping-remove" data-shopping-remove="${item.id}" title="Usuń / pomiń pozycję" aria-label="Usuń ${escapeHtml(item.name)} z listy zakupów">×</button>
      </article>`;
    }).join('');
    content.innerHTML = `<div class="shopping-list-summary"><span>Na dzień: ${escapeHtml(list.list_date || list.created_at || '')}</span><b>${pending.length ? `Do kupienia: ${pending.length} ${pending.length === 1 ? 'pozycja' : 'pozycje'}` : '✓ Wszystkie pozycje zostały oznaczone'}</b></div>${pending.length ? `<section class="shopping-pending"><h3>Do kupienia</h3>${itemsHtml(pending)}</section>` : ''}${done.length ? `<section class="shopping-completed"><h3>Kupione</h3>${itemsHtml(done)}</section>` : ''}`;
    printButton.hidden = !pending.length;
    printButton.dataset.list = JSON.stringify({ ...list, items: pending });
  }

  async function refresh({ open = false } = {}) {
    render(await api('/api/shopping-lists/latest'));
    if (open && !dialog.open) dialog.showModal();
  }

  function compactPrint(list) {
    const items = (list?.items || []).filter(item => !isCompleted(item));
    if (!items.length) return alert('Nie ma pozycji oczekujących na zakup.');
    const win = window.open('', '_blank');
    if (!win) return alert('Przeglądarka zablokowała okno wydruku. Zezwól na wyskakujące okna i spróbuj ponownie.');
    const logo = `${window.location.origin}/assets/daily-fruits-logo.png`;
    // Ten sam kod, który widoczny jest w karcie SELGROS w aplikacji.
    // Dzięki temu karta na wydruku pozostaje skanowalna.
    let selgrosBarcode = document.querySelector('#selgrosCardDisplay')?.innerHTML || '';
    if (!/<(?:rect|path|line|g)\b/i.test(selgrosBarcode) && window.JsBarcode) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      window.JsBarcode(svg, '8112402006', { format:'CODE128', displayValue:true, fontSize:22, height:105, margin:18, lineColor:'#000', background:'#fff' });
      selgrosBarcode = svg.outerHTML;
    }
    // Karta używa dokładnie tego samego kodu widocznego w aplikacji i trafia
    // pod tabelę, więc nie może zakryć żadnego produktu na wydruku.
    let selgrosCard = `<aside class="print-selgros" style="position:static;margin:12px 0 0 auto" aria-label="Karta SELGROS"><strong>SELGROS</strong>${selgrosBarcode}<span>NIP: 6793077034</span></aside>`;
    const rows = items.map(item => `<tr><td>${escapeHtml(item.category || 'Inne')}</td><td><b>${escapeHtml(item.name)}</b>${item.brand ? `<small>${escapeHtml(productBrand(item))}${productWeight(item) !== 'bez gramatury' ? ` · ${escapeHtml(productWeight(item))}` : ''}</small>` : ''}</td><td>${number(item.available_quantity)} ${escapeHtml(item.unit || 'szt.')}</td><td><b>${remaining(item)} ${escapeHtml(item.unit || 'szt.')}</b></td></tr>`).join('');
    win.document.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Lista zakupów – ZapoBetterWorkPlace</title><style>@page{size:A4;margin:7mm}*{box-sizing:border-box}body{margin:0;color:#173b2e;font:10.5px/1.25 Arial,sans-serif}.brand{display:flex;align-items:center;gap:11px;border-bottom:1px solid #b8d0c1;padding:0 0 6px;margin-bottom:7px}.brand img{width:46px;height:46px;object-fit:contain;border-radius:9px}.brand h1{font:700 19px Georgia,serif;margin:0}.brand small{display:block;margin-top:2px;color:#607469}.title{display:flex;justify-content:space-between;align-items:end;margin:6px 0}.title h2{font:700 17px Georgia,serif;margin:0}.title p{margin:0;color:#526d5e}table{width:100%;border-collapse:collapse}th,td{border:1px solid #cddbd2;padding:4px 5px;text-align:left;vertical-align:top}th{background:#edf5ef;font-size:9px;text-transform:uppercase;letter-spacing:.2px}td:nth-child(1){width:19%}td:nth-child(3){width:12%;white-space:nowrap}td:nth-child(4){width:14%;white-space:nowrap;color:#9d2e29}td small{display:block;color:#5b7062;font-size:9px;margin-top:1px}tr{break-inside:avoid}.footer{margin:6px 0 0;text-align:right;font-size:8.5px;color:#78877f}</style></head><body><header class="brand"><img src="${logo}" alt="Daily Fruits"><div><h1>ZapoBetterWorkPlace</h1><small>Magazyn · lista zakupów</small></div></header><section class="title"><h2>Lista zakupów</h2><p>Na dzień: ${escapeHtml(list.list_date || list.created_at || '')}</p></section><table><thead><tr><th>Kategoria</th><th>Produkt</th><th>Stan</th><th>Do kupienia</th></tr></thead><tbody>${rows}</tbody></table><p class="footer">Wygenerowano z Magazynu BetterWorkPlace</p></body></html>`);
    // Karta jest dodawana do tego samego dokumentu wydruku, w prawym górnym
    // rogu pierwszej strony. Nie zmniejsza przez to tabeli z zakupami.
    const cardHost = win.document.createElement('div');
    cardHost.innerHTML = `<style>.print-selgros{width:208px;margin:12px 0 0 auto;border:1px solid #d9e2dc;border-radius:8px;overflow:hidden;background:#fff;text-align:center}.print-selgros strong{display:block;background:#e30613;color:#fff;padding:6px;font-size:12px;letter-spacing:.08em}.print-selgros svg{display:block;width:100%;height:auto;margin:4px auto}.print-selgros img{display:block;width:100%;height:104px;object-fit:contain;background:#fff}.print-selgros span{display:block;border-top:1px solid #e3e9e5;padding:4px 6px;font-size:9px;font-weight:700;letter-spacing:.03em}</style>${selgrosCard}`;
    (win.document.querySelector('.footer') || win.document.body).before(cardHost);
    win.document.close();
    const print = () => { try { win.focus(); win.print(); } catch (_) { /* blokada wyskakującego okna */ } };
    // Czekamy na logo, ale nie zatrzymujemy wydruku, gdy przeglądarka nie
    // wyśle zdarzenia load dla nowego okna.
    win.addEventListener('load', () => setTimeout(print, 80), { once:true });
    setTimeout(print, 1400);
  }

  async function completeItem(id) {
    const item = activeList?.items?.find(entry => Number(entry.id) === Number(id));
    if (!item) return;
    const left = remaining(item);
    const answer = prompt(`Ile faktycznie kupiono produktu „${item.name}”?\nDo uzupełnienia zapotrzebowania pozostało: ${left} ${item.unit || 'szt.'}.`, String(left));
    if (answer === null) return;
    const bought = Number(String(answer).replace(',', '.'));
    if (!Number.isFinite(bought) || bought <= 0) return alert('Wpisz prawidłową ilość.');
    let expiration = '';
    if (bought > left && String(item.category || '').toLocaleLowerCase('pl-PL').includes('nabiał')) {
      expiration = prompt(`Nadwyżka ${bought - left} ${item.unit || 'szt.'} trafi do magazynu. Wpisz jej termin ważności RRRR-MM-DD (możesz pominąć).`) || '';
    }
    await api(`/api/shopping-lists/items/${item.id}/complete`, { method: 'POST', body: JSON.stringify({ purchased_quantity: bought, purchased_date: currentDate(), received_date: currentDate(), expiration_date: expiration || null }) });
    await refresh();
    if (bought > left) await load();
  }

  document.addEventListener('click', async event => {
    const button = event.target.closest('#shoppingList');
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try { categoryChoices(); await refresh({ open: true }); } catch (error) { alert(error.message); }
  }, true);

  content.addEventListener('click', async event => {
    const complete = event.target.closest('[data-shopping-complete]');
    const remove = event.target.closest('[data-shopping-remove]');
    if (!complete && !remove) return;
    event.preventDefault(); event.stopImmediatePropagation();
    try {
      if (complete) await completeItem(complete.dataset.shoppingComplete);
      else {
        const item = activeList?.items?.find(entry => Number(entry.id) === Number(remove.dataset.shoppingRemove));
        if (item && !await window.showAppConfirm(`Usunąć „${item.name}” z listy zakupów? Powiązany brak w Historii dnia przestanie być oznaczony na czerwono.`)) return;
        await api(`/api/shopping-lists/items/${remove.dataset.shoppingRemove}`, { method: 'DELETE' });
        await refresh();
      }
    } catch (error) { alert(error.message); }
  }, true);

  document.addEventListener('click', event => {
    const button = event.target.closest('#printShoppingList');
    if (!button) return;
    event.preventDefault(); event.stopImmediatePropagation();
    compactPrint(JSON.parse(button.dataset.list || 'null'));
  }, true);

  document.querySelector('#addManualShoppingItem').addEventListener('click', () => {
    categoryChoices(); manualForm.hidden = false; document.querySelector('#manualShoppingName').focus();
  });
  document.querySelector('#cancelManualShoppingItem').addEventListener('click', () => { manualForm.reset(); manualForm.hidden = true; });
  manualForm.addEventListener('submit', async event => {
    event.preventDefault();
    const body = {
      name: document.querySelector('#manualShoppingName').value.trim(),
      category: document.querySelector('#manualShoppingCategory').value.trim() || 'Inne',
      brand: document.querySelector('#manualShoppingBrand').value.trim(),
      weight: document.querySelector('#manualShoppingWeight').value.trim(),
      quantity: Number(document.querySelector('#manualShoppingQuantity').value),
      unit: document.querySelector('#manualShoppingUnit').value,
      list_date: currentDate()
    };
    if (!body.name || !Number.isFinite(body.quantity) || body.quantity <= 0) return;
    try {
      await api('/api/shopping-lists/items', { method: 'POST', body: JSON.stringify(body) });
      manualForm.reset(); manualForm.hidden = true; await refresh();
    } catch (error) { alert(error.message); }
  });

  // Po utworzeniu braków z wklejonego opisu odśwież listę w tym samym oknie.
  document.querySelector('#createShoppingList')?.addEventListener('click', () => {
    // Zestawienie zapotrzebowania zapisuje się asynchronicznie. Kilka lekkich
    // odświeżeń sprawia, że otwarte okno listy zawsze pokaże również nowe braki.
    [350, 1000, 2200].forEach(delay => setTimeout(() => {
      if (dialog.open) refresh().catch(() => {});
    }, delay));
  });
})();
