(() => {
  'use strict';
  const dialog = document.querySelector('#quickFillDialog');
  const open = document.querySelector('#quickFillOpen');
  const list = document.querySelector('#quickFillList');
  const count = document.querySelector('#quickFillCount');
  const fields = {
    expiry: document.querySelector('#quickExpiry'),
    barcode: document.querySelector('#quickBarcode'),
    photo: document.querySelector('#quickPhoto')
  };
  if (!dialog || !open || !list) return;

  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
  const selected = () => Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.checked]));
  const incomplete = product => {
    const needs = selected();
    return (needs.expiry && !product.expiration_date) || (needs.barcode && !product.barcode) || (needs.photo && !product.has_image);
  };
  const missingBadges = product => {
    const needs = selected();
    return [needs.expiry && !product.expiration_date ? 'brak terminu' : '', needs.barcode && !product.barcode ? 'brak kodu' : '', needs.photo && !product.has_image ? 'brak zdjęcia' : ''].filter(Boolean);
  };
  const categoryName = product => product.category || 'Inne';

  function render() {
    const products = all.filter(incomplete).sort((a, b) => categoryName(a).localeCompare(categoryName(b), 'pl') || a.name.localeCompare(b.name, 'pl'));
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
      ? `<label>Kod<div class="quick-fill-barcode"><input id="quickBarcode-${product.id}" name="barcode" inputmode="numeric" autocomplete="off" placeholder="Zeskanuj lub wpisz"><button type="button" class="small-btn" data-scan-barcode-for="quickBarcode-${product.id}">▥ Skanuj</button></div></label>` : '';
    return `<form class="quick-fill-row" data-id="${product.id}"><div class="quick-fill-product"><b>${esc(product.name)}</b><small>${esc(product.brand || 'Pozostałe')} · ${product.weight_value ? `${product.weight_value} ${esc(product.weight_unit)}` : 'bez gramatury'}</small><div class="quick-fill-badges">${badges}</div></div><div class="quick-fill-fields">${wants.expiry && !product.expiration_date ? '<label>Termin<input name="expiry" type="date" required></label>' : ''}${barcodeField}${wants.photo && !product.has_image ? '<label>Zdjęcie<input name="photo" type="file" accept="image/*"></label>' : ''}</div><button type="submit" class="quick-fill-approve" aria-label="Zatwierdź i zapisz" title="Zatwierdź i zapisz">✓</button></form>`;
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
    const photo = data.get('photo');
    if (fields.expiry.checked && !product.expiration_date && !expiry) return window.alert('Wpisz termin ważności.');
    if (fields.barcode.checked && !product.barcode && !barcode) return window.alert('Wpisz lub zeskanuj kod kreskowy.');
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
      if (photo && photo.size) await api(`/api/products/${product.id}/image`, { method: 'POST', body: JSON.stringify({ image_data: await read(photo) }) });
      await load();
      render();
    } catch (error) {
      window.alert(error.message || 'Nie udało się zapisać danych.');
      button.disabled = false; button.textContent = '✓';
    }
  }
  open.addEventListener('click', () => { render(); dialog.showModal(); });
  ['closeQuickFill', 'closeQuickFillBottom'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.close()));
  Object.values(fields).forEach(input => input.addEventListener('change', render));
  list.addEventListener('submit', save);
})();
