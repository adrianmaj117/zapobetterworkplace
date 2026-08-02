/* Zapotrzebowanie z wklejonego opisu: każdy wiersz jest zawsze możliwy do poprawienia przed odjęciem. */
(() => {
  const dialog = document.querySelector('#demandTextDialog');
  const input = document.querySelector('#demandTextInput');
  const status = document.querySelector('#demandTextStatus');
  const preview = document.querySelector('#demandTextPreview');
  const rows = document.querySelector('#demandTextRows');
  const apply = document.querySelector('#applyDemandText');
  const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  // Kanapki i pieczywo z Katowic przyjeżdżają osobno — nie są częścią stanów ani zakupów.
  const ignoredDemandLine = value => {
    const text = normalize(value);
    return text.includes('office box') || ['bajgiel', 'bagiel', 'bulka', 'ciabatta', 'bagietka', 'kanapk'].some(word => text.includes(word));
  };
  const excludedFromShopping = (category, text = '') => {
    const group = normalize(category);
    return group === 'inne' || group.includes('owoce') || group.includes('bulki z katowic') || ignoredDemandLine(`${category} ${text}`);
  };
  const productBrand = item => item.brand || (item.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const productSize = item => item.weight_value ? `${item.weight_value} ${item.weight_unit}` : 'bez gramatury';
  const productLabel = item => `${item.name} — ${productBrand(item)} · ${productSize(item)} (stan: ${item.quantity} ${item.unit})`;
  const categoryOptions = selected => [...new Set([...cats, ...all.map(item => item.category), 'Nabiał', 'Owoce i Warzywa', 'Zioła', 'Bułki z KATOWIC', 'Inne'])].sort((a, b) => a.localeCompare(b, 'pl')).map(category => `<option ${category === selected ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('');
  function suggestedCategory(line) {
    const value = normalize(line);
    const rules = [
      ['Bułki z KATOWIC', ['bulka', 'bulki', 'katowic']], ['Soki i Napoje', ['sok', 'pomidorow']],
      ['Owoce i Warzywa', ['owoce', 'banan', 'winogron', 'kiwi', 'cytryn', 'jablko', 'gruszk', 'pomarancz']], ['Zioła', ['ziola', 'bazyl', 'mieta', 'pietruszk', 'kolendr', 'koperek', 'rozmaryn']],
      ['Nabiał', ['mleko', 'jogurt', 'ser ', 'masl', 'smiet']],
      ['Smoothie', ['smoothie', 'rokitnik', 'moringa', 'baobab']], ['Bakalie', ['orzech', 'migd', 'daktyl', 'zurawin', 'bakal']],
      ['Płatki / Musli / Granola', ['platki', 'musli', 'granola', 'corn flakes']], ['Ciastka i batony', ['baton', 'ciastk', 'crunchy']],
      ['Słodycze', ['czekolad', 'knoppers', 'haribo', 'bounty']], ['Kawa', ['kawa', 'arabica', 'robusta']],
      ['Herbaty', ['herbat', 'tea', 'earl grey']], ['Miody', ['miod']], ['Hummusy i produkty wegańskie', ['hummus', 'pasztet', 'smalczyk', 'lovege']],
      ['Masła orzechowe i pasty', ['maslo orzech', 'pasta orzech']]
    ];
    return rules.find(([, words]) => words.some(word => value.includes(word)))?.[0] || 'Inne';
  }
  const proposedName = line => String(line || '').replace(/(?:\s|^)(\d+(?:[,.]\d+)?)(?:\s*(?:szt\.?|opak\.?|op\.?|x))?\s*$/i, '').trim() || 'Nowy produkt';
  const productOptions = (selected, filterCategory = '') => {
    const categories = [...new Set(all.filter(item => !filterCategory || item.category === filterCategory).map(item => item.category))].sort((a, b) => a.localeCompare(b, 'pl'));
    return `<option value="">Dopasuj produkt z magazynu…</option>${categories.map(category => `<optgroup label="${escapeHtml(category)}">${all.filter(item => item.category === category).sort((a, b) => a.name.localeCompare(b.name, 'pl')).map(item => `<option value="${item.id}" ${Number(selected) === item.id ? 'selected' : ''}>${escapeHtml(productLabel(item))}</option>`).join('')}</optgroup>`).join('')}`;
  };
  function addRow(productId = '', quantity = '', source = '') {
    const missing = !productId && source;
    const selectedProduct = all.find(item => item.id === Number(productId));
    const selectedCategory = selectedProduct?.category || suggestedCategory(source);
    const row = document.createElement('div'); row.className = `demand-row${missing ? ' is-missing' : ''}`;
    const quickAdd = missing ? `<div class="missing-product-panel"><strong>Brak produktu w bazie</strong><span>Wybierz kategorię i dodaj go ze stanem 0.</span><input class="missing-name" value="${escapeHtml(proposedName(source))}" aria-label="Nazwa nowego produktu"><select class="missing-category" aria-label="Kategoria nowego produktu">${categoryOptions(selectedCategory)}</select><button type="button" class="small-btn add-missing-product">＋ Dodaj do bazy</button></div>` : '';
    row.innerHTML = `<input class="demand-raw" aria-label="Wiersz opisu" value="${escapeHtml(source)}" placeholder="Wiersz z opisu"><select class="demand-category" aria-label="Kategoria">${categoryOptions(selectedCategory)}</select><select class="demand-product" aria-label="Produkt">${productOptions(productId, selectedCategory)}</select><input class="demand-quantity" aria-label="Ilość" type="number" min="0.01" step="any" value="${escapeHtml(quantity)}" placeholder="Ilość"><button type="button" class="demand-remove" title="Usuń pozycję" aria-label="Usuń pozycję">×</button>${quickAdd}`;
    rows.append(row);
  }
  function score(line, item) {
    const text = normalize(line), name = normalize(item.name); if (!text || !name) return 0;
    if (text.includes(name)) return 100;
    const words = name.split(' ').filter(word => word.length > 2);
    return words.filter(word => text.includes(word)).length / Math.max(words.length, 1) * 80;
  }
  function quantityFrom(line) {
    const values = [...line.matchAll(/(?:^|\s)(\d+(?:[,.]\d+)?)(?:\s*(?:szt\.?|opak\.?|op\.?|x))?(?=\s|$)/gi)];
    return values.length ? Number(values[values.length - 1][1].replace(',', '.')) : '';
  }
  function comparison() {
    const grouped = new Map();
    [...rows.querySelectorAll('.demand-row')].forEach(row => {
      const product = all.find(item => item.id === Number(row.querySelector('.demand-product').value));
      const quantity = Number(row.querySelector('.demand-quantity').value);
      if (!Number.isFinite(quantity) || quantity <= 0) return;
      const name = product?.name || row.querySelector('.missing-name')?.value.trim() || proposedName(row.querySelector('.demand-raw').value);
      const category = product?.category || row.querySelector('.demand-category')?.value || row.querySelector('.missing-category')?.value || suggestedCategory(row.querySelector('.demand-raw').value);
      if (excludedFromShopping(category, `${row.querySelector('.demand-raw').value} ${name}`)) return;
      const key = product ? `product:${product.id}` : `missing:${normalize(name)}:${category}`;
      const entry = grouped.get(key) || { product_id:product?.id || null, name, category, brand:product ? productBrand(product) : '', weight:product ? productSize(product) : '', unit:product?.unit || 'szt.', required_quantity:0, available_quantity:product?.quantity || 0 };
      entry.required_quantity += quantity; grouped.set(key, entry);
    });
    return [...grouped.values()].map(item => ({ ...item, missing_quantity:Math.max(0, item.required_quantity - item.available_quantity) })).filter(item => item.missing_quantity > 0).sort((a, b) => (a.category === 'Owoce i Warzywa' ? 0 : 1) - (b.category === 'Owoce i Warzywa' ? 0 : 1) || a.category.localeCompare(b.category, 'pl') || a.name.localeCompare(b.name, 'pl'));
  }
  function renderShortages() {
    const box = document.querySelector('#demandShortages'), create = document.querySelector('#createShoppingList'), items = comparison();
    box.hidden = false; create.hidden = false; create.textContent = '↻ Odśwież listę zakupów';
    if (!items.length) { box.className = 'demand-shortages is-clear'; box.innerHTML = '<strong>✓ Stany wystarczają do realizacji podanych pozycji.</strong>'; return; }
    box.className = 'demand-shortages';
    box.innerHTML = `<strong>Brakuje ${items.length} ${items.length === 1 ? 'produktu' : 'produktów'} do realizacji zapotrzebowania</strong><div>${items.map(item => `<article><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.category)}${item.brand ? ` · ${escapeHtml(item.brand)}` : ''}${item.weight ? ` · ${escapeHtml(item.weight)}` : ''}</small></span><span>stan: ${item.available_quantity} ${escapeHtml(item.unit)}<b>brakuje: ${item.missing_quantity} ${escapeHtml(item.unit)}</b></span></article>`).join('')}</div>`;
  }
  function renderShoppingList(list) {
    const content = document.querySelector('#shoppingListContent'), print = document.querySelector('#printShoppingList');
    if (!list) { content.innerHTML = '<p class="demand-status">Nie ma jeszcze porównanego zapotrzebowania. Wklej nowy opis, aby utworzyć listę.</p>'; print.hidden = true; return; }
    if (!list.items?.length) { content.innerHTML = `<p class="shopping-list-date">Na dzień: ${escapeHtml(list.list_date || list.created_at || '')}</p><p class="demand-status">✓ W bieżącym zapotrzebowaniu nie ma produktów do kupienia.</p>`; print.hidden = true; return; }
    content.innerHTML = `<p class="shopping-list-date">Na dzień: ${escapeHtml(list.list_date || list.created_at || '')}</p>${list.items.map(item => `<article><span><b>${escapeHtml(item.name)}</b><small>${escapeHtml(item.category)}${item.brand ? ` · ${escapeHtml(item.brand)}` : ''}${item.weight ? ` · ${escapeHtml(item.weight)}` : ''}</small></span><span>stan: ${item.available_quantity} ${escapeHtml(item.unit)}<b>do kupienia: ${item.missing_quantity} ${escapeHtml(item.unit)}</b></span><button type="button" class="shopping-remove" data-shopping-remove="${item.id}" title="Usuń z tej listy" aria-label="Usuń ${escapeHtml(item.name)} z listy zakupów">×</button></article>`).join('')}`;
    print.hidden = false; print.dataset.list = JSON.stringify(list);
  }
  function printShoppingList(list) {
    const win = window.open('', '_blank'); if (!win) return alert('Przeglądarka zablokowała okno wydruku. Zezwól na wyskakujące okna i spróbuj ponownie.');
    const rowsForPrint = list.items.map(item => `<tr><td>${escapeHtml(item.category)}</td><td>${escapeHtml(item.name)}${item.brand ? `<br><small>${escapeHtml(item.brand)}${item.weight ? ` · ${escapeHtml(item.weight)}` : ''}</small>` : ''}</td><td>${item.available_quantity} ${escapeHtml(item.unit)}</td><td><b>${item.missing_quantity} ${escapeHtml(item.unit)}</b></td></tr>`).join('');
    const logo = `${window.location.origin}/assets/daily-fruits-logo.png`;
    win.document.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>Lista zakupów — ZapoBetterWorkPlace</title><style>@page{size:A4;margin:15mm}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#173b2e;margin:0;background:#fff}.print-sheet{max-width:900px;margin:0 auto}.print-brand{text-align:center;border-bottom:2px solid #d9e8dd;padding:4px 0 19px;margin-bottom:20px}.print-brand img{width:158px;height:158px;object-fit:contain;border-radius:18px;display:block;margin:0 auto 10px}.print-brand strong{font-size:20px;letter-spacing:.1px}.print-brand p{margin:6px 0 0;color:#61766b;font-size:13px}.print-title{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:14px}.print-title h1{font-family:Georgia,serif;font-size:31px;margin:0}.print-date{margin:0;color:#536b60;font-size:14px}table{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #ccdcd2;border-radius:12px;overflow:hidden;font-size:14px}th,td{border-bottom:1px solid #dfe8e2;text-align:left;padding:11px;vertical-align:top}tr:last-child td{border-bottom:0}th{background:#eaf3ed;color:#244637;font-size:12px;text-transform:uppercase;letter-spacing:.35px}td:nth-child(3),td:nth-child(4){white-space:nowrap}td:last-child b{color:#a3322d}small{color:#5d7168;line-height:1.5}.print-footer{text-align:center;color:#718178;font-size:11px;margin-top:22px}@media print{.print-sheet{max-width:none}.print-brand img{width:145px;height:145px}tr{break-inside:avoid}}</style></head><body><main class="print-sheet"><header class="print-brand"><img src="${logo}" alt="Daily Fruits by BetterWorkPlace"><strong>ZapoBetterWorkPlace</strong><p>Lista zakupów · magazyn spożywczy</p></header><section class="print-title"><h1>Lista zakupów</h1><p class="print-date">Na dzień: ${escapeHtml(list.list_date || list.created_at || '')}</p></section><table><thead><tr><th>Kategoria</th><th>Produkt</th><th>Stan</th><th>Do kupienia</th></tr></thead><tbody>${rowsForPrint}</tbody></table><p class="print-footer">Wygenerowano z systemu Magazyn BetterWorkPlace</p></main></body></html>`);
    win.document.close(); win.focus(); setTimeout(() => win.print(), 250);
  }
  function buildPreview(text) {
    const enteredLines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const ignoredLines = enteredLines.filter(ignoredDemandLine);
    const lines = enteredLines.filter(line => !ignoredDemandLine(line));
    rows.innerHTML = ''; let matched = 0;
    lines.forEach(line => {
      const best = all.map(item => ({ item, score:score(line, item) })).sort((a, b) => b.score - a.score)[0];
      const productId = best?.score >= 55 ? best.item.id : '';
      if (productId) matched += 1;
      addRow(productId, quantityFrom(line), line);
    });
    if (!lines.length) addRow();
    preview.hidden = false; apply.disabled = false; renderShortages();
    status.textContent = lines.length ? `Odczytano ${lines.length} ${lines.length === 1 ? 'wiersz' : 'wierszy'} od góry do dołu. Dopasowano automatycznie: ${matched}.${ignoredLines.length ? ` Pominięto ${ignoredLines.length} pozycji kanapkowych/pieczywa z Katowic.` : ''} Popraw każdą pozycję przed zatwierdzeniem.` : (ignoredLines.length ? 'Pominięto pozycje kanapkowe/pieczywo z Katowic — nie są potrzebne do porównania.' : 'Wklej przynajmniej jeden wiersz opisu.');
  }
  let timer;
  document.querySelector('#demandText').addEventListener('click', () => { input.value = ''; rows.innerHTML = ''; preview.hidden = true; document.querySelector('#demandShortages').hidden = true; document.querySelector('#createShoppingList').hidden = true; apply.disabled = true; status.textContent = 'Wklej opis, aby rozpocząć.'; document.querySelector('#demandTextDate').value = localDate(); document.querySelector('#demandTextPassword').value = ''; dialog.showModal(); input.focus(); });
  ['closeDemandText', 'cancelDemandText'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.close()));
  ['closeShoppingList', 'closeShoppingListBottom'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => document.querySelector('#shoppingListDialog').close()));
  document.querySelector('#shoppingList').addEventListener('click', async () => { try { renderShoppingList(await api('/api/shopping-lists/latest')); document.querySelector('#shoppingListDialog').showModal(); } catch (error) { alert(error.message); } });
  document.querySelector('#shoppingListContent').addEventListener('click', async event => {
    const button = event.target.closest('[data-shopping-remove]');
    if (!button) return;
    try {
      await api(`/api/shopping-lists/items/${button.dataset.shoppingRemove}`, { method:'DELETE' });
      renderShoppingList(await api('/api/shopping-lists/latest'));
    } catch (error) { alert(error.message); }
  });
  document.querySelector('#openDemandTextFromShopping').addEventListener('click', () => { document.querySelector('#shoppingListDialog').close(); document.querySelector('#demandText').click(); });
  document.querySelector('#printShoppingList').addEventListener('click', event => { const list = JSON.parse(event.currentTarget.dataset.list || 'null'); if (list) printShoppingList(list); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => buildPreview(input.value), 250); });
  function addManualDemandRow() {
    addRow();
    const row = rows.lastElementChild;
    row.scrollIntoView({ behavior:'smooth', block:'nearest' });
    row.querySelector('.demand-category')?.focus();
  }
  document.querySelectorAll('#addDemandTextRow, #addDemandTextRowBottom').forEach(button => button.addEventListener('click', addManualDemandRow));
  document.querySelector('#createShoppingList').addEventListener('click', async () => {
    const items = comparison();
    const button = document.querySelector('#createShoppingList'); button.disabled = true;
    try { renderShoppingList(await api('/api/shopping-lists', { method:'POST', body:JSON.stringify({ items, source_text:input.value, list_date:document.querySelector('#demandTextDate').value }) })); document.querySelector('#shoppingListDialog').showModal(); }
    catch (error) { alert(error.message); } finally { button.disabled = false; }
  });
  function clearMissing(row) { row.classList.remove('is-missing'); row.querySelector('.missing-product-panel')?.remove(); }
  rows.addEventListener('input', event => { if (event.target.closest('.demand-quantity')) renderShortages(); });
  rows.addEventListener('change', event => {
    const row = event.target.closest('.demand-row');
    if (event.target.closest('.demand-category')) {
      row.querySelector('.demand-product').innerHTML = productOptions('', event.target.value);
      const missingCategory = row.querySelector('.missing-category');
      if (missingCategory) missingCategory.innerHTML = categoryOptions(event.target.value);
    }
    const product = event.target.closest('.demand-product');
    if (product?.value) {
      const found = all.find(item => item.id === Number(product.value));
      if (found) row.querySelector('.demand-category').value = found.category;
      clearMissing(row);
    }
    renderShortages();
  });
  rows.addEventListener('click', async event => {
    if (event.target.closest('.demand-remove')) { event.target.closest('.demand-row').remove(); renderShortages(); return; }
    const button = event.target.closest('.add-missing-product'); if (!button) return;
    const row = button.closest('.demand-row'), name = row.querySelector('.missing-name').value.trim(), category = row.querySelector('.missing-category').value;
    if (!name) return alert('Wpisz nazwę produktu, który chcesz dodać.');
    const existing = all.find(item => normalize(item.name) === normalize(name) && item.category === category);
    if (existing) { row.querySelector('.demand-category').value = existing.category; row.querySelector('.demand-product').innerHTML = productOptions(existing.id, existing.category); clearMissing(row); renderShortages(); return; }
    button.disabled = true; button.textContent = 'Dodawanie…';
    try {
      const created = await api('/api/products', { method:'POST', body:JSON.stringify({ name, category, quantity:0, unit:'szt.', min_quantity:0, notes:'Dodano z zapotrzebowania: brak w magazynie' }) });
      all.push(created); row.querySelector('.demand-category').value = created.category; row.querySelector('.demand-product').innerHTML = productOptions(created.id, created.category); clearMissing(row); renderShortages();
      status.textContent = `Dodano „${created.name}” do kategorii „${created.category}” ze stanem 0. Możesz teraz kontynuować zapotrzebowanie.`;
    } catch (error) { alert(error.message); button.disabled = false; button.textContent = '＋ Dodaj do bazy'; }
  });
  document.querySelector('#demandTextForm').addEventListener('submit', async event => {
    event.preventDefault();
    const items = [...rows.querySelectorAll('.demand-row')].map(row => ({ product_id:Number(row.querySelector('.demand-product').value), quantity:Number(row.querySelector('.demand-quantity').value) })).filter(item => Number.isInteger(item.product_id) && Number.isFinite(item.quantity) && item.quantity > 0);
    if (!items.length) return alert('Wybierz przynajmniej jeden produkt i podaj jego ilość.');
    const password = document.querySelector('#demandTextPassword').value; if (!password) return alert('Wpisz hasło zatwierdzające.');
    if (!confirm(`Odjąć ze stanów ${items.length} ${items.length === 1 ? 'pozycję' : 'pozycje'}?`)) return;
    apply.disabled = true;
    try {
      const result = await api('/api/demand/apply', { method:'POST', body:JSON.stringify({ items, password, demand_date:document.querySelector('#demandTextDate').value, source_name:'Opis ręczny zapotrzebowania', recognized_text:input.value }) });
      dialog.close(); alert(result.shortages?.length ? `Zapotrzebowanie zatwierdzone. Odjęto dostępne produkty, a ${result.shortages.length} brakujące pozycje dodano do listy zakupów.` : `Zapotrzebowanie zatwierdzone. Odjęto ${result.applied} ${result.applied === 1 ? 'produkt' : 'produkty'}.`); await load();
    } catch (error) { alert(error.message); } finally { apply.disabled = false; }
  });
})();
