(() => {
  'use strict';
  const dialog = document.querySelector('#quickFillDialog');
  const open = document.querySelector('#quickFillOpen');
  const list = document.querySelector('#quickFillList');
  const count = document.querySelector('#quickFillCount');
  const search = document.querySelector('#quickFillSearch');
  const searchStatus = document.querySelector('#quickFillSearchStatus');
  const fields = {
    expiry: document.querySelector('#quickExpiry'),
    barcode: document.querySelector('#quickBarcode'),
    backupBarcode: document.querySelector('#quickBackupBarcode'),
    photo: document.querySelector('#quickPhoto')
  };
  if (!dialog || !open || !list) return;

  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
  const selected = () => Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.checked]));
  const incomplete = product => {
    const needs = selected();
    return (needs.expiry && !product.expiration_date)
      || (needs.barcode && !product.barcode)
      || (needs.backupBarcode && Number(product.package_barcode_count || 0) < 1)
      || (needs.photo && !product.has_image);
  };
  const missingBadges = product => {
    const needs = selected();
    return [
      needs.expiry && !product.expiration_date ? 'brak terminu' : '',
      needs.barcode && !product.barcode ? 'brak kodu głównego' : '',
      needs.backupBarcode && Number(product.package_barcode_count || 0) < 1 ? 'brak kodu opakowania' : '',
      needs.photo && !product.has_image ? 'brak zdjęcia' : ''
    ].filter(Boolean);
  };
  const categoryName = product => product.category || 'Inne';
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();
  // Kategorie obsługiwane poza stanem magazynowym nie trafiają do tej listy.
  // Sprawdzamy też odmiany nazw, np. samo „Owoce” albo „Warzywa”.
  const excludedCategory = product => {
    const category = normalize(categoryName(product));
    return category === 'inne'
      || (category.includes('bulki') && category.includes('katowic'))
      || category.includes('owoce')
      || category.includes('warzywa');
  };
  const cleanBarcode = value => String(value || '').trim().replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
  let searchText = '';

  function render() {
    const query = normalize(searchText);
    const products = all.filter(product => !excludedCategory(product) && incomplete(product) && (!query || normalize(`${product.name} ${product.brand || ''} ${product.barcode || ''}`).includes(query))).sort((a, b) => categoryName(a).localeCompare(categoryName(b), 'pl') || a.name.localeCompare(b.name, 'pl'));
    count.textContent = products.length ? `Do uzupełnienia: ${products.length} produktów.` : 'Wszystkie wybrane dane są już uzupełnione.';
    if (!products.length) { list.innerHTML = '<div class="quick-fill-empty">✓ Gotowe — nie ma braków w wybranych polach.</div>'; return; }
    const groups = new Map();
    products.forEach(product => { const key = categoryName(product); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(product); });
    list.innerHTML = [...groups].map(([category, entries]) => `<section class="quick-fill-group"><h3>${esc(category)} <small>${entries.length}</small></h3>${entries.map(product => row(product)).join('')}</section>`).join('');
  }
  function row(product) {
    const wants = selected();
    const badges = missingBadges(product).map(badge => `<span>${badge}</span>`).join('');
    const barcodeField = wants.barcode && !product.barcode
      ? `<label>Kod główny<div class="quick-fill-barcode"><input id="quickBarcode-${product.id}" name="barcode" inputmode="numeric" autocomplete="off" placeholder="Zeskanuj lub wpisz"><button type="button" class="small-btn" data-scan-barcode-for="quickBarcode-${product.id}">▥ Skanuj</button></div></label>` : '';
    const backupBarcodeField = wants.backupBarcode && Number(product.package_barcode_count || 0) < 1
      ? `<div class="quick-fill-package-fields"><label>Kod opakowania zbiorczego<div class="quick-fill-barcode"><input id="quickBackupBarcode-${product.id}" name="backup_barcode" inputmode="numeric" autocomplete="off" placeholder="Zeskanuj kod kartonu lub paczki"><button type="button" class="small-btn" data-scan-barcode-for="quickBackupBarcode-${product.id}">▥ Skanuj</button></div></label><label>Sztuk w jednym opakowaniu<input name="package_multiplier" type="number" min="2" step="1" placeholder="np. 20"></label></div>` : '';
    return `<form class="quick-fill-row" data-id="${product.id}"><div class="quick-fill-product"><b>${esc(product.name)}</b><small>${esc(product.brand || 'Pozostałe')} · ${product.weight_value ? `${product.weight_value} ${esc(product.weight_unit)}` : 'bez gramatury'}</small><div class="quick-fill-badges">${badges}</div></div><div class="quick-fill-fields">${wants.expiry && !product.expiration_date ? '<label>Termin<input name="expiry" type="date" required></label>' : ''}${barcodeField}${backupBarcodeField}${wants.photo && !product.has_image ? '<label>Zdjęcie<input name="photo" type="file" accept="image/*"></label>' : ''}</div><button type="submit" class="quick-fill-approve" aria-label="Zatwierdź i zapisz" title="Zatwierdź i zapisz"><span>✓</span><b>Zapisz</b></button><p class="quick-fill-saved" role="status" hidden>✓ Zapisano</p></form>`;
  }
  async function save(event) {
    const form = event.target.closest('.quick-fill-row');
    if (!form) return;
    event.preventDefault();
    const product = all.find(item => item.id === Number(form.dataset.id));
    if (!product) return;
    const data = new FormData(form);
    const expiry = String(data.get('expiry') || product.expiration_date || '');
    const barcode = String(data.get('barcode') || product.barcode || '').trim();
    const backupBarcode = String(data.get('backup_barcode') || '').trim();
    const packageMultiplier = Number(data.get('package_multiplier') || 0);
    const photo = data.get('photo');
    if (fields.expiry.checked && !product.expiration_date && !expiry) return window.alert('Wpisz termin ważności.');
    if (fields.barcode.checked && !product.barcode && !barcode) return window.alert('Wpisz lub zeskanuj główny kod kreskowy.');
    if (fields.backupBarcode.checked && Number(product.package_barcode_count || 0) < 1 && !backupBarcode) return window.alert('Wpisz lub zeskanuj kod opakowania zbiorczego.');
    if (backupBarcode && (!Number.isInteger(packageMultiplier) || packageMultiplier < 2)) return window.alert('Podaj, ile pełnych sztuk znajduje się w jednym opakowaniu.');
    if (backupBarcode && cleanBarcode(backupBarcode) === cleanBarcode(barcode)) return window.alert('Kod opakowania musi być inny niż kod pojedynczej sztuki.');
    if (fields.photo.checked && !product.has_image && (!photo || !photo.size)) return window.alert('Wybierz zdjęcie produktu.');
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = '…';
    try {
      await api(`/api/products/${product.id}`, { method: 'PUT', body: JSON.stringify({
        name: product.name, category: product.category, brand: product.brand || '', quantity: product.quantity,
        unit: product.unit, min_quantity: product.min_quantity || 0, weight_value: product.weight_value,
        weight_unit: product.weight_unit, received_date: product.received_date, expiration_date: expiry || null,
        notes: product.notes || '', barcode
      }) });
      if (backupBarcode) await api(`/api/products/${product.id}/barcodes`, { method:'POST', body:JSON.stringify({ barcode:backupBarcode, quantity_multiplier:packageMultiplier, package_name:`Opakowanie zbiorcze ${packageMultiplier} szt.` }) });
      if (photo && photo.size) await api(`/api/products/${product.id}/image`, { method: 'POST', body: JSON.stringify({ image_data: await read(photo) }) });
      const saved = form.querySelector('.quick-fill-saved');
      if (saved) { saved.hidden = false; button.hidden = true; }
      await new Promise(resolve => setTimeout(resolve, 450));
      await load();
      render();
    } catch (error) {
      window.alert(error.message || 'Nie udało się zapisać danych.');
      button.disabled = false; button.innerHTML = '<span>✓</span><b>Zapisz</b>';
    }
  }
  function updateSearch() {
    searchText = search?.value || '';
    const code = cleanBarcode(searchText);
    const scanned = code && all.find(product => cleanBarcode(product.barcode) === code);
    if (searchStatus) {
      if (scanned && excludedCategory(scanned)) { searchStatus.hidden = false; searchStatus.textContent = `„${scanned.name}” należy do kategorii pominiętej w szybkim uzupełnianiu.`; }
      else if (scanned) { searchStatus.hidden = false; searchStatus.textContent = `Znaleziono: ${scanned.name}.`; }
      else { searchStatus.hidden = true; searchStatus.textContent = ''; }
    }
    render();
    if (scanned && !excludedCategory(scanned)) requestAnimationFrame(() => {
      const row = list.querySelector(`[data-id="${scanned.id}"]`);
      row?.scrollIntoView({ behavior:'smooth', block:'center' });
      // Po skanowaniu od razu ustawiamy kursor na pierwszym brakującym polu.
      // Dzięki temu telefon nie kończy tylko na wyszukaniu produktu.
      row?.querySelector('input:not([type="file"])')?.focus({ preventScroll:true });
    });
  }
  open.addEventListener('click', () => { if (search) search.value = ''; searchText = ''; if (searchStatus) searchStatus.hidden = true; render(); dialog.showModal(); });
  ['closeQuickFill', 'closeQuickFillBottom'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.close()));
  Object.values(fields).forEach(input => input.addEventListener('change', render));
  search?.addEventListener('input', updateSearch);
  list.addEventListener('submit', save);
})();
