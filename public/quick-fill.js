(() => {
  'use strict';

  const dialog = document.querySelector('#quickFillDialog');
  const open = document.querySelector('#quickFillOpen');
  const list = document.querySelector('#quickFillList');
  const count = document.querySelector('#quickFillCount');
  const search = document.querySelector('#quickFillSearch');
  const searchStatus = document.querySelector('#quickFillSearchStatus');
  const saveAllButton = document.querySelector('#saveAllQuickFill');
  const fields = {
    expiry: document.querySelector('#quickExpiry'),
    barcode: document.querySelector('#quickBarcode'),
    backupBarcode: document.querySelector('#quickBackupBarcode'),
    photo: document.querySelector('#quickPhoto')
  };
  if (!dialog || !open || !list) return;

  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
  const selected = () => Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.checked]));
  const categoryName = product => product.category || 'Inne';
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').replace(/[^a-z0-9]+/g, ' ').trim();
  const cleanBarcode = value => String(value || '').trim().replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
  let searchText = '';
  let closingInProgress = false;
  let batchSaving = false;

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

  const excludedCategory = product => {
    const category = normalize(categoryName(product));
    return category === 'inne'
      || category === 'pozostale'
      || (category.includes('bulki') && category.includes('katowic'))
      || category.includes('owoce')
      || category.includes('warzywa');
  };

  function row(product) {
    const wants = selected();
    const badges = missingBadges(product).map(badge => `<span>${badge}</span>`).join('');
    const barcodeField = wants.barcode && !product.barcode
      ? `<label>Kod główny<div class="quick-fill-barcode"><input id="quickBarcode-${product.id}" name="barcode" inputmode="numeric" autocomplete="off" placeholder="Zeskanuj lub wpisz"><button type="button" class="small-btn" data-scan-barcode-for="quickBarcode-${product.id}">▥ Skanuj</button></div></label>`
      : '';
    const backupBarcodeField = wants.backupBarcode && Number(product.package_barcode_count || 0) < 1
      ? `<div class="quick-fill-package-fields"><label>Kod opakowania zbiorczego<div class="quick-fill-barcode"><input id="quickBackupBarcode-${product.id}" name="backup_barcode" inputmode="numeric" autocomplete="off" placeholder="Zeskanuj kod kartonu lub paczki"><button type="button" class="small-btn" data-scan-barcode-for="quickBackupBarcode-${product.id}">▥ Skanuj</button></div></label><label>Sztuk w jednym opakowaniu<input name="package_multiplier" type="number" min="2" step="1" placeholder="np. 20"></label></div>`
      : '';
    return `<form class="quick-fill-row" data-id="${product.id}" data-dirty="false"><div class="quick-fill-product"><b>${esc(product.name)}</b><small>${esc(product.brand || 'Pozostałe')} · ${product.weight_value ? `${product.weight_value} ${esc(product.weight_unit)}` : 'bez gramatury'}</small><div class="quick-fill-badges">${badges}</div></div><div class="quick-fill-fields">${wants.expiry && !product.expiration_date ? '<label>Termin<input name="expiry" type="date" required></label>' : ''}${barcodeField}${backupBarcodeField}${wants.photo && !product.has_image ? '<label>Zdjęcie<input name="photo" type="file" accept="image/*"></label>' : ''}</div><button type="submit" class="quick-fill-approve" aria-label="Zatwierdź i zapisz" title="Zatwierdź i zapisz"><span>✓</span><b>Zapisz</b></button><p class="quick-fill-saved" role="status" hidden>✓ Zapisano</p></form>`;
  }

  function render() {
    const query = normalize(searchText);
    const products = all
      .filter(product => !excludedCategory(product) && incomplete(product) && (!query || normalize(`${product.name} ${product.brand || ''} ${product.barcode || ''}`).includes(query)))
      .sort((a, b) => categoryName(a).localeCompare(categoryName(b), 'pl') || a.name.localeCompare(b.name, 'pl'));
    count.textContent = products.length ? `Do uzupełnienia: ${products.length} produktów.` : 'Wszystkie wybrane dane są już uzupełnione.';
    if (!products.length) {
      list.innerHTML = '<div class="quick-fill-empty">✓ Gotowe — nie ma braków w wybranych polach.</div>';
      return;
    }
    const groups = new Map();
    products.forEach(product => {
      const key = categoryName(product);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(product);
    });
    list.innerHTML = [...groups].map(([category, entries]) => `<section class="quick-fill-group"><h3>${esc(category)} <small>${entries.length}</small></h3>${entries.map(product => row(product)).join('')}</section>`).join('');
  }

  const dirtyRows = () => [...list.querySelectorAll('.quick-fill-row[data-dirty="true"]')];

  function setDirty(form) {
    form.dataset.dirty = 'true';
    form.classList.add('is-dirty');
  }

  function updateRemainingCount() {
    const rows = list.querySelectorAll('.quick-fill-row');
    count.textContent = rows.length ? `Do uzupełnienia: ${rows.length} produktów.` : 'Wszystkie wybrane dane są już uzupełnione.';
    list.querySelectorAll('.quick-fill-group').forEach(group => {
      const groupRows = group.querySelectorAll('.quick-fill-row');
      if (!groupRows.length) group.remove();
      else {
        const badge = group.querySelector('h3 small');
        if (badge) badge.textContent = groupRows.length;
      }
    });
    if (!list.querySelector('.quick-fill-row')) list.innerHTML = '<div class="quick-fill-empty">✓ Gotowe — nie ma braków w wybranych polach.</div>';
  }

  async function persistForm(form, { validateAll = true } = {}) {
    const product = all.find(item => item.id === Number(form.dataset.id));
    if (!product) return false;
    const data = new FormData(form);
    const enteredExpiry = String(data.get('expiry') || '');
    const enteredBarcode = String(data.get('barcode') || '').trim();
    const backupBarcode = String(data.get('backup_barcode') || '').trim();
    const packageMultiplierText = String(data.get('package_multiplier') || '').trim();
    const packageMultiplier = Number(packageMultiplierText || 0);
    const photo = data.get('photo');
    const hasPhoto = Boolean(photo && photo.size);
    const hasAnyChange = Boolean(enteredExpiry || enteredBarcode || backupBarcode || packageMultiplierText || hasPhoto);
    if (!hasAnyChange) return false;

    if (validateAll && fields.expiry.checked && !product.expiration_date && !enteredExpiry) throw new Error('Wpisz termin ważności.');
    if (validateAll && fields.barcode.checked && !product.barcode && !enteredBarcode) throw new Error('Wpisz lub zeskanuj główny kod kreskowy.');
    if (validateAll && fields.backupBarcode.checked && Number(product.package_barcode_count || 0) < 1 && !backupBarcode) throw new Error('Wpisz lub zeskanuj kod opakowania zbiorczego.');
    if (validateAll && fields.photo.checked && !product.has_image && !hasPhoto) throw new Error('Wybierz zdjęcie produktu.');
    if ((backupBarcode && !packageMultiplierText) || (!backupBarcode && packageMultiplierText)) throw new Error('Kod opakowania i liczba sztuk muszą być podane razem.');
    if (backupBarcode && (!Number.isInteger(packageMultiplier) || packageMultiplier < 2)) throw new Error('Podaj, ile pełnych sztuk znajduje się w jednym opakowaniu.');

    const finalBarcode = enteredBarcode || product.barcode || '';
    if (backupBarcode && cleanBarcode(backupBarcode) === cleanBarcode(finalBarcode)) throw new Error('Kod opakowania musi być inny niż kod pojedynczej sztuki.');

    form.classList.add('is-saving');
    const button = form.querySelector('button[type="submit"]');
    if (button) { button.disabled = true; button.textContent = 'Zapisywanie…'; }
    try {
      await api(`/api/products/${product.id}`, { method: 'PUT', body: JSON.stringify({
        name: product.name,
        category: product.category,
        brand: product.brand || '',
        quantity: product.quantity,
        unit: product.unit,
        min_quantity: product.min_quantity || 0,
        weight_value: product.weight_value,
        weight_unit: product.weight_unit,
        received_date: product.received_date,
        expiration_date: enteredExpiry || product.expiration_date || null,
        notes: product.notes || '',
        barcode: finalBarcode
      }) });
      if (backupBarcode) {
        await api(`/api/products/${product.id}/barcodes`, { method: 'POST', body: JSON.stringify({
          barcode: backupBarcode,
          quantity_multiplier: packageMultiplier,
          package_name: `Opakowanie zbiorcze ${packageMultiplier} szt.`
        }) });
      }
      if (hasPhoto) await api(`/api/products/${product.id}/image`, { method: 'POST', body: JSON.stringify({ image_data: await read(photo) }) });

      if (enteredExpiry) product.expiration_date = enteredExpiry;
      if (enteredBarcode) product.barcode = enteredBarcode;
      if (backupBarcode) product.package_barcode_count = Number(product.package_barcode_count || 0) + 1;
      if (hasPhoto) product.has_image = true;
      form.dataset.dirty = 'false';
      form.classList.remove('is-dirty');
      const saved = form.querySelector('.quick-fill-saved');
      if (saved) saved.hidden = false;
      if (button) button.hidden = true;
      return true;
    } finally {
      form.classList.remove('is-saving');
      if (button) button.disabled = false;
    }
  }

  async function save(event) {
    const form = event.target.closest('.quick-fill-row');
    if (!form) return;
    event.preventDefault();
    try {
      const saved = await persistForm(form, { validateAll: true });
      if (!saved) return window.showAppAlert?.('Najpierw uzupełnij wybrane dane produktu.');
      // Nie odświeżamy całej listy: pozostałe wpisane pozycje pozostają nietknięte.
      window.setTimeout(() => { form.remove(); updateRemainingCount(); }, 350);
    } catch (error) {
      window.showAppAlert?.(error.message || 'Nie udało się zapisać danych.');
      const button = form.querySelector('button[type="submit"]');
      if (button) { button.hidden = false; button.disabled = false; button.innerHTML = '<span>✓</span><b>Zapisz</b>'; }
    }
  }

  async function saveAllChanges({ notifyWhenEmpty = true } = {}) {
    if (batchSaving) return false;
    const forms = dirtyRows();
    if (!forms.length) {
      if (notifyWhenEmpty) window.showAppAlert?.('Nie ma niezapisanych zmian.');
      return true;
    }
    batchSaving = true;
    if (saveAllButton) { saveAllButton.disabled = true; saveAllButton.textContent = 'Zapisywanie…'; }
    let savedCount = 0;
    try {
      for (const form of forms) {
        try {
          if (await persistForm(form, { validateAll: false })) savedCount += 1;
        } catch (error) {
          form.scrollIntoView({ behavior: 'smooth', block: 'center' });
          throw error;
        }
      }
      await load();
      render();
      if (notifyWhenEmpty) window.showAppAlert?.(`Zapisano zmiany w ${savedCount} ${savedCount === 1 ? 'produkcie' : 'produktach'}.`);
      return true;
    } catch (error) {
      window.showAppAlert?.(error.message || 'Nie udało się zapisać wszystkich zmian.');
      return false;
    } finally {
      batchSaving = false;
      if (saveAllButton) { saveAllButton.disabled = false; saveAllButton.textContent = '✓ Zapisz wszystkie zmiany'; }
    }
  }

  async function requestClose() {
    if (closingInProgress || batchSaving) return;
    closingInProgress = true;
    try {
      const unsaved = dirtyRows().length;
      if (!unsaved) {
        if (await window.showAppConfirm('Zamknąć szybkie uzupełnianie? Nie ma niezapisanych zmian.')) dialog.close();
        return;
      }
      if (await window.showAppConfirm(`Masz niezapisane zmiany w ${unsaved} ${unsaved === 1 ? 'produkcie' : 'produktach'}. Zapisać wszystkie przed zamknięciem?`)) {
        if (await saveAllChanges({ notifyWhenEmpty: false })) dialog.close();
        return;
      }
      if (await window.showAppConfirm('Zamknąć bez zapisywania tych zmian?')) dialog.close();
    } finally {
      closingInProgress = false;
    }
  }

  function updateSearch() {
    searchText = search?.value || '';
    const code = cleanBarcode(searchText);
    const scanned = code && all.find(product => cleanBarcode(product.barcode) === code);
    if (searchStatus) {
      if (scanned && excludedCategory(scanned)) {
        searchStatus.hidden = false;
        searchStatus.textContent = `„${scanned.name}” należy do kategorii pominiętej w szybkim uzupełnianiu.`;
      } else if (scanned) {
        searchStatus.hidden = false;
        searchStatus.textContent = `Znaleziono: ${scanned.name}.`;
      } else {
        searchStatus.hidden = true;
        searchStatus.textContent = '';
      }
    }
    render();
    if (scanned && !excludedCategory(scanned)) requestAnimationFrame(() => {
      const productRow = list.querySelector(`[data-id="${scanned.id}"]`);
      productRow?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      productRow?.querySelector('input:not([type="file"])')?.focus({ preventScroll: true });
    });
  }

  open.addEventListener('click', () => {
    if (search) search.value = '';
    searchText = '';
    if (searchStatus) searchStatus.hidden = true;
    render();
    dialog.showModal();
  });
  ['closeQuickFill', 'closeQuickFillBottom'].forEach(id => document.querySelector(`#${id}`)?.addEventListener('click', requestClose));
  dialog.addEventListener('cancel', event => { event.preventDefault(); requestClose(); });
  Object.values(fields).forEach(input => input.addEventListener('change', render));
  search?.addEventListener('input', updateSearch);
  list.addEventListener('input', event => { const form = event.target.closest('.quick-fill-row'); if (form) setDirty(form); });
  list.addEventListener('change', event => { const form = event.target.closest('.quick-fill-row'); if (form) setDirty(form); });
  list.addEventListener('submit', save);
  saveAllButton?.addEventListener('click', () => saveAllChanges());
})();
