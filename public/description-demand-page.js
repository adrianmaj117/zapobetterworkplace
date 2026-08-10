(() => {
  'use strict';

  const token = localStorage.getItem('zapoToken');
  if (!token) { window.location.replace('/'); return; }

  const $ = selector => document.querySelector(selector);
  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[char]));
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const api = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers:{ 'Content-Type':'application/json', 'x-session-token':token, ...(options.headers || {}) } });
    if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || 'Nie udało się zapisać danych.');
    return response.status === 204 ? null : response.json();
  };

  const source = $('#sourceText');
  const dateInput = $('#demandDate');
  const prepare = $('#prepareDemand');
  const status = $('#parseStatus');
  const review = $('#reviewSection');
  const reviewRows = $('#reviewRows');
  const shortagePanel = $('#shortagePanel');
  const password = $('#approvalPassword');
  const apply = $('#applyDemand');
  const imageCache = new Map();
  let products = [];
  let rawTimer;
  let productsReady = false;

  const ignoredWords = new Set(['szt', 'sztuka', 'sztuk', 'opakowanie', 'opak', 'produkt', 'office', 'box', 'bez', 'z', 'na', 'do', 'i', 'oraz', 'ml', 'kg', 'g', 'l']);
  const ignoredDemandLine = value => {
    const text = normalize(value);
    return text.includes('office box') || ['bajgiel', 'bagiel', 'bulka', 'ciabatta', 'bagietka', 'kanapk'].some(word => text.includes(word));
  };
  // Owoce, warzywa, „Inne” oraz pieczywo z Katowic są dostarczane osobno.
  // Są częścią zapotrzebowania, ale nigdy nie tworzą braków zakupowych.
  const excludedFromShopping = productOrCategory => {
    const category = normalize(typeof productOrCategory === 'string' ? productOrCategory : productOrCategory?.category);
    return category === 'inne'
      || category.includes('owoce')
      || category.includes('warzywa')
      || (category.includes('bulki') && category.includes('katowic'));
  };
  const proposedName = line => String(line || '').replace(/(?:\s|^)(\d+(?:[,.]\d+)?)(?:\s*(?:szt\.?|sztuk(?:a|i)?|opak\.?|opakowanie|op\.?|x|kg|kilogram(?:y|ow)?|l\b|lit(?:r|ry|row)?))?\s*$/i, '').replace(/[—–:-]\s*$/, '').trim() || 'Nowy produkt';
  const tokens = value => normalize(value).split(' ').filter(word => word.length > 1 && !/^\d+$/.test(word) && !ignoredWords.has(word));
  const brand = product => product.brand || (product.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const weight = product => product.weight_value ? `${product.weight_value} ${product.weight_unit}` : 'bez gramatury';
  const label = product => `${product.name} — ${brand(product)} · ${weight(product)} · stan: ${product.quantity} ${product.unit}`;

  function categoryOptions(selected = '') {
    const categories = [...new Set(products.map(product => product.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
    return categories.map(category => `<option value="${esc(category)}" ${category === selected ? 'selected' : ''}>${esc(category)}</option>`).join('');
  }
  function productOptions(category, selected = '') {
    const choices = products.filter(product => !category || product.category === category).sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    return `<option value="">Wybierz produkt z magazynu…</option>${choices.map(product => `<option value="${product.id}" ${Number(selected) === Number(product.id) ? 'selected' : ''}>${esc(label(product))}</option>`).join('')}`;
  }
  function suggestedCategory(line) {
    const text = normalize(line);
    const rules = [
      ['Soki i Napoje', ['sok', 'pomidorow', 'napoj', 'cola', 'sprite', 'lemoniada']],
      ['Owoce i Warzywa', ['owoce', 'banan', 'winogron', 'kiwi', 'cytryn', 'jablko', 'gruszk', 'pomarancz', 'arbuz', 'awokado', 'brzoskwin', 'warzyw']],
      ['Zioła', ['ziola', 'bazyl', 'mieta', 'pietruszk', 'kolendr', 'koperek', 'rozmaryn']],
      ['Nabiał', ['mleko', 'jogurt', 'ser ', 'masl', 'smiet']],
      ['Smoothie', ['smoothie', 'rokitnik', 'moringa', 'baobab']],
      ['Bakalie', ['orzech', 'migd', 'daktyl', 'zurawin', 'bakal', 'sliwk', 'morel']],
      ['Płatki / Musli / Granola', ['platki', 'musli', 'granola', 'corn flakes']],
      ['Ciastka, batony i Chipsy', ['baton', 'ciastk', 'crunchy', 'chips']],
      ['Słodycze', ['czekolad', 'knoppers', 'haribo', 'bounty', 'michalk']],
      ['Kawa', ['kawa', 'arabica', 'robusta']], ['Herbaty', ['herbat', 'tea', 'earl grey']],
      ['Miody', ['miod']], ['Hummusy i produkty wegańskie', ['hummus', 'pasztet', 'smalczyk', 'lovege']], ['Masła orzechowe i pasty', ['maslo orzech', 'pasta orzech']]
    ];
    return rules.find(([, words]) => words.some(word => text.includes(word)))?.[0] || 'Inne';
  }
  function quantityFrom(line) {
    const marked = [...String(line || '').matchAll(/(\d+(?:[,.]\d+)?)\s*(?:szt\.?|sztuk(?:a|i)?|opak\.?|opakowanie|op\.?|x\b|kg|kilogram(?:y|ow)?|l\b|lit(?:r|ry|row)?)/gi)];
    if (marked.length) return Number(marked[marked.length - 1][1].replace(',', '.'));
    const atEnd = String(line || '').match(/(?:[-–—:]\s*|\s)(\d+(?:[,.]\d+)?)\s*$/);
    return atEnd ? Number(atEnd[1].replace(',', '.')) : '';
  }
  function score(line, product) {
    const sourceText = normalize(line);
    const name = normalize(product.name);
    if (!sourceText || !name) return 0;
    const asked = tokens(sourceText);
    const nameTokens = tokens(product.name);
    const fullTokens = tokens(`${product.name} ${brand(product)} ${weight(product)} ${product.category}`);
    if (!asked.length || !nameTokens.length) return 0;
    const commonName = nameTokens.filter(word => asked.includes(word));
    const commonFull = fullTokens.filter(word => asked.includes(word));
    const weighted = commonName.reduce((sum, word) => sum + (word.length >= 6 ? 2 : 1), 0);
    const available = nameTokens.reduce((sum, word) => sum + (word.length >= 6 ? 2 : 1), 0);
    let result = weighted / Math.max(available, 1) * 70 + commonFull.length / Math.max(asked.length, 1) * 26;
    if (sourceText.includes(name) || name.includes(normalize(proposedName(line)))) result += 64;
    if (product.weight_value && sourceText.includes(String(product.weight_value)) && sourceText.includes(normalize(product.weight_unit))) result += 18;
    const brandTokens = tokens(brand(product));
    if (brandTokens.some(word => asked.includes(word))) result += 15;
    if (normalize(product.category).split(' ').some(word => word.length > 3 && asked.includes(word))) result += 8;
    return result;
  }
  function matchesFor(line) {
    return products.map(product => ({ product, score:score(line, product) })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score);
  }
  function bestMatch(line) {
    const ranked = matchesFor(line);
    const first = ranked[0], second = ranked[1];
    if (!first || first.score < 48) return null;
    if (second && first.score < 115 && first.score - second.score < 10) return null;
    return first.product;
  }
  function getProduct(card) { return products.find(product => Number(product.id) === Number(card.querySelector('.review-product')?.value)); }
  function setCardPhoto(card, product) {
    const image = card.querySelector('.review-photo img');
    if (!image) return;
    image.src = 'assets/category-foods.png';
    image.alt = product ? `Zdjęcie produktu ${product.name}` : 'Zdjęcie poglądowe produktu';
    if (!product?.has_image) return;
    if (imageCache.has(product.id)) { image.src = imageCache.get(product.id); return; }
    api(`/api/products/${product.id}/image`).then(data => {
      if (data?.image_data) { imageCache.set(product.id, data.image_data); image.src = data.image_data; }
    }).catch(() => {});
  }
  function updateCard(card, options = {}) {
    const raw = card.querySelector('.review-raw').value;
    const category = card.querySelector('.review-category');
    const productSelect = card.querySelector('.review-product');
    const product = getProduct(card);
    const meta = card.querySelector('.review-meta');
    const note = card.querySelector('.match-note');
    card.classList.remove('is-match', 'is-mismatch', 'is-missing');
    if (product) {
      category.value = product.category;
      setCardPhoto(card, product);
      const proposal = proposedName(raw);
      const direct = normalize(proposal) === normalize(product.name) || score(raw, product) >= 100;
      card.classList.add(direct ? 'is-match' : 'is-mismatch');
      meta.innerHTML = `<b>Stan: ${esc(product.quantity)} ${esc(product.unit)}</b><span>${esc(product.category)} · ${esc(brand(product))} · ${esc(weight(product))}</span>`;
      note.textContent = direct ? '✓ Dopasowano do produktu w magazynie' : 'Sprawdź dopasowanie — możesz zmienić produkt z listy.';
    } else {
      setCardPhoto(card, null);
      card.classList.add('is-missing');
      meta.textContent = 'Nie wybrano produktu z magazynu';
      note.textContent = 'Nie znaleziono pewnego dopasowania — wybierz produkt z listy.';
    }
    if (!options.skipShortages) renderShortages();
  }
  function makeCard({ raw = '', quantity = '', productId = '' } = {}) {
    const matched = productId ? products.find(product => Number(product.id) === Number(productId)) : bestMatch(raw);
    const category = matched?.category || suggestedCategory(raw);
    const card = document.createElement('article');
    card.className = 'review-row';
    card.innerHTML = `<div class="review-photo"><img src="assets/category-foods.png" alt="Zdjęcie poglądowe produktu"></div><div class="review-main"><input class="review-raw" value="${esc(raw)}" aria-label="Wiersz opisu" placeholder="Nazwa z opisu"><div class="review-selects"><select class="review-category" aria-label="Kategoria">${categoryOptions(category)}</select><select class="review-product" aria-label="Produkt">${productOptions(category, matched?.id || '')}</select></div><div class="review-meta"></div><p class="match-note"></p></div><label class="quantity-box">Ilość<input class="review-quantity" type="number" min="0.001" step="any" value="${esc(quantity)}" placeholder="0"></label><button type="button" class="review-remove" aria-label="Usuń pozycję">×</button>`;
    reviewRows.append(card);
    updateCard(card, { skipShortages:true });
  }
  function selectedRows() {
    return [...reviewRows.querySelectorAll('.review-row')].map(card => ({ card, product:getProduct(card), quantity:Number(card.querySelector('.review-quantity').value) })).filter(entry => Number.isFinite(entry.quantity) && entry.quantity > 0);
  }
  function renderShortages() {
    if (!reviewRows.children.length) { shortagePanel.hidden = true; return; }
    const entries = selectedRows();
    const unresolved = [...reviewRows.querySelectorAll('.review-row')].filter(card => !getProduct(card));
    const grouped = new Map();
    entries.forEach(({ product, quantity }) => {
      if (!product) return;
      const entry = grouped.get(product.id) || { product, requested:0 };
      entry.requested += quantity; grouped.set(product.id, entry);
    });
    const shortages = [...grouped.values()]
      .map(entry => ({ ...entry, missing:Math.max(0, entry.requested - Number(entry.product.quantity || 0)) }))
      .filter(entry => entry.missing > 0 && !excludedFromShopping(entry.product));
    shortagePanel.hidden = false;
    // Produkty dostarczane zewnętrznie zostają w zapotrzebowaniu, ale nie są
    // brakami zakupowymi i nie mogą otrzymać czerwonego oznaczenia.
    if (!shortages.length) {
      shortagePanel.className = 'shortage-panel is-clear';
      shortagePanel.innerHTML = `<h3>✓ Braków do zakupienia nie ma.</h3>${unresolved.length ? `<p>Wybierz produkt dla ${unresolved.length} ${unresolved.length === 1 ? 'wiersza' : 'wierszy'} przed zatwierdzeniem.</p>` : ''}`;
      return;
    }
    shortagePanel.className = 'shortage-panel';
    shortagePanel.innerHTML = `<h3>${shortages.length ? `Brakuje ${shortages.length} ${shortages.length === 1 ? 'produktu' : 'produktów'} — po zatwierdzeniu trafią do listy zakupów.` : 'Braków w stanach nie ma.'}</h3>${unresolved.length ? `<p>Wybierz produkt dla ${unresolved.length} ${unresolved.length === 1 ? 'wiersza' : 'wierszy'} przed zatwierdzeniem.</p>` : ''}<div class="shortage-list">${shortages.map(entry => `<div class="shortage-item"><b>${esc(entry.product.name)}</b><small>${esc(entry.product.category)} · stan ${entry.product.quantity} ${esc(entry.product.unit)}</small><strong>Brakuje: ${entry.missing} ${esc(entry.product.unit)}</strong></div>`).join('')}</div>`;
  }
  function buildReview() {
    const lines = source.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const skipped = lines.filter(ignoredDemandLine);
    const usable = lines.filter(line => !ignoredDemandLine(line));
    reviewRows.innerHTML = '';
    usable.forEach(line => makeCard({ raw:line, quantity:quantityFrom(line) }));
    if (!usable.length) makeCard();
    review.hidden = false;
    const matched = [...reviewRows.querySelectorAll('.review-row')].filter(card => getProduct(card)).length;
    status.className = 'parse-status';
    status.textContent = `Odczytano ${usable.length} ${usable.length === 1 ? 'wiersz' : 'wierszy'}. Pewnie dopasowano: ${matched}.${skipped.length ? ` Pominięto ${skipped.length} pozycji kanapkowych/pieczywa z Katowic.` : ''}`;
    renderShortages();
    review.scrollIntoView({ behavior:'smooth', block:'start' });
  }
  async function addMissing(card) {
    const name = card.querySelector('.missing-name').value.trim();
    const category = card.querySelector('.missing-category').value;
    if (!name) throw Error('Wpisz nazwę produktu.');
    const existing = products.find(product => normalize(product.name) === normalize(name) && product.category === category);
    const product = existing || await api('/api/products', { method:'POST', body:JSON.stringify({ name, category, quantity:0, unit:'szt.', min_quantity:0, notes:'Dodano z zapotrzebowania z opisu' }) });
    if (!existing) products.push(product);
    card.querySelector('.review-category').value = product.category;
    card.querySelector('.review-product').innerHTML = productOptions(product.category, product.id);
    updateCard(card);
  }
  async function applyDemand() {
    const unresolved = [...reviewRows.querySelectorAll('.review-row')].filter(card => !getProduct(card));
    if (unresolved.length) { unresolved[0].scrollIntoView({ behavior:'smooth', block:'center' }); throw Error('Wybierz produkt dla każdej pozycji albo dodaj brakujący produkt do bazy.'); }
    const items = selectedRows().map(({ product, quantity }) => ({ product_id:product.id, quantity }));
    if (!items.length) throw Error('Wpisz co najmniej jedną ilość większą od zera.');
    if (!password.value) throw Error('Wpisz hasło zatwierdzające.');
    apply.disabled = true; apply.textContent = 'Zapisywanie…';
    const result = await api('/api/demand/apply', { method:'POST', body:JSON.stringify({ items, password:password.value, demand_date:dateInput.value, source_name:'Zapotrzebowanie z opisu', recognized_text:source.value }) });
    const notice = document.createElement('p'); notice.className = 'review-success';
    notice.textContent = result.shortages?.length ? `Zapisano zapotrzebowanie. ${result.shortages.length} brakujące pozycje dodano do listy zakupów.` : `Zapisano zapotrzebowanie — odjęto ${result.applied} pozycji.`;
    review.append(notice); password.value = '';
    apply.textContent = '✓ Zapisano';
    setTimeout(() => { window.location.href = 'magazyn.html'; }, 1500);
  }

  prepare.addEventListener('click', () => {
    if (!productsReady) { status.className = 'parse-status is-warning'; status.textContent = 'Poczekaj chwilę — wczytuję produkty z magazynu.'; return; }
    if (!source.value.trim()) { status.className = 'parse-status is-warning'; status.textContent = 'Wklej najpierw opis zapotrzebowania.'; source.focus(); return; }
    sessionStorage.setItem('zapo-demand-source', source.value);
    buildReview();
  });
  source.addEventListener('input', () => { clearTimeout(rawTimer); rawTimer = setTimeout(() => sessionStorage.setItem('zapo-demand-source', source.value), 250); });
  $('#addReviewRow').addEventListener('click', () => { makeCard(); reviewRows.lastElementChild?.scrollIntoView({ behavior:'smooth', block:'center' }); reviewRows.lastElementChild?.querySelector('.review-raw')?.focus(); });
  reviewRows.addEventListener('input', event => {
    const card = event.target.closest('.review-row'); if (!card) return;
    if (event.target.matches('.review-quantity')) return renderShortages();
    if (event.target.matches('.review-raw')) { clearTimeout(rawTimer); rawTimer = setTimeout(() => { const matched = bestMatch(event.target.value); if (matched) { const category = card.querySelector('.review-category'); category.value = matched.category; card.querySelector('.review-product').innerHTML = productOptions(matched.category, matched.id); } updateCard(card); }, 350); }
  });
  reviewRows.addEventListener('change', event => {
    const card = event.target.closest('.review-row'); if (!card) return;
    if (event.target.matches('.review-category')) card.querySelector('.review-product').innerHTML = productOptions(event.target.value, '');
    updateCard(card);
  });
  reviewRows.addEventListener('click', async event => {
    const card = event.target.closest('.review-row'); if (!card) return;
    if (event.target.closest('.review-remove')) { card.remove(); renderShortages(); return; }
    if (!event.target.closest('.add-missing')) return;
    const button = event.target.closest('.add-missing'); button.disabled = true; button.textContent = 'Dodawanie…';
    try { await addMissing(card); } catch (error) { window.alert(error.message); button.disabled = false; button.textContent = 'Dodaj do bazy'; }
  });
  apply.addEventListener('click', async () => { try { await applyDemand(); } catch (error) { window.alert(error.message); apply.disabled = false; apply.textContent = '✓ Zatwierdź i odejmij'; } });

  dateInput.value = localDate();
  source.value = sessionStorage.getItem('zapo-demand-source') || '';
  prepare.disabled = true;
  prepare.textContent = 'Wczytywanie magazynu…';
  api('/api/products?sort=name').then(items => {
    products = items;
    productsReady = true;
    prepare.disabled = false;
    prepare.textContent = 'Przygotuj porównanie →';
    status.textContent = source.value.trim() ? 'Lista produktów jest gotowa. Kliknij „Przygotuj porównanie”.' : 'Wklej opis, aby rozpocząć.';
  }).catch(() => { window.location.replace('/'); });
})();
