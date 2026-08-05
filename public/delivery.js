/* Grupowe przyjmowanie dostaw. Pozycje trafiają do magazynu dopiero po potwierdzeniu. */
(() => {
  const dialog = document.querySelector('#deliveryDialog');
  const itemDialog = document.querySelector('#deliveryItemDialog');
  const manualDialog = document.querySelector('#deliveryManualItemDialog');
  const historyDialog = document.querySelector('#deliveryHistoryDialog');
  const linesBox = document.querySelector('#deliveryLines');
  const historyBox = document.querySelector('#deliveryHistoryList');
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const today = () => new Date().toISOString().slice(0, 10);
  const formatDate = value => value ? new Intl.DateTimeFormat('pl-PL').format(new Date(value)) : 'brak daty';
  const productBrand = product => product.brand || (product.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const productWeight = product => product.weight_value ? `${product.weight_value} ${product.weight_unit}` : 'bez gramatury';
  const defaultImage = 'assets/category-foods.png';
  const comparable = value => String(value || '').toLocaleLowerCase('pl-PL').replace(/[ąćęłńóśźż]/g, letter => ({ ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' }[letter] || letter)).replace(/[^a-z0-9]+/g, ' ').trim();
  const canonicalCategory = value => {
    const normalized = comparable(value);
    if (normalized === 'owoce') return 'Owoce i Warzywa';
    if (normalized === 'soki') return 'Soki i Napoje';
    if (normalized === 'bulki z katowic') return 'Bułki z KATOWIC';
    return String(value || '').trim();
  };
  const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'pl'));
  let deliveryItems = [];
  let pendingProduct = null;
  const draftKey = 'zapo-delivery-draft-v1';
  let draftRestored = false;

  function saveDraft() {
    const supplier = document.querySelector('#deliverySupplier').value;
    const received_date = document.querySelector('#deliveryReceived').value;
    const note = document.querySelector('#deliveryNote').value;
    if (!supplier.trim() && !note.trim() && !deliveryItems.length) { sessionStorage.removeItem(draftKey); return; }
    const items = deliveryItems.map(item => ({ product:item.product, draft:item.draft || null, quantity:item.quantity, expiration_date:item.expiration_date, image_data:item.image_data || '' }));
    try { sessionStorage.setItem(draftKey, JSON.stringify({ supplier, received_date, note, items })); }
    catch (_) {
      try { sessionStorage.setItem(draftKey, JSON.stringify({ supplier, received_date, note, items:items.map(item => ({ ...item, image_data:'', product:{ ...item.product, image_data:'' }, draft:item.draft ? { ...item.draft, image_data:'' } : null })) })); } catch (_) {}
    }
  }
  function clearDraft() { sessionStorage.removeItem(draftKey); draftRestored = false; }
  function restoreDraft() {
    if (draftRestored) return deliveryItems.length || Boolean(document.querySelector('#deliverySupplier').value || document.querySelector('#deliveryNote').value);
    draftRestored = true;
    try {
      const draft = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
      if (!draft) return false;
      document.querySelector('#deliverySupplier').value = draft.supplier || '';
      document.querySelector('#deliveryReceived').value = draft.received_date || today();
      document.querySelector('#deliveryNote').value = draft.note || '';
      deliveryItems = Array.isArray(draft.items) ? draft.items.filter(item => item?.product).map(item => ({ ...item, product:all.find(product => Number(product.id) === Number(item.product.id)) || item.product })) : [];
      return true;
    } catch (_) { clearDraft(); return false; }
  }

  function setOptions(id, values) {
    document.querySelector(`#${id}`).innerHTML = unique(values).map(value => `<option value="${escapeHtml(value)}"></option>`).join('');
  }

  function fillManualSuggestions() {
    const additionalCategories = [
      ...(Array.isArray(window.cats) ? window.cats : []),
      ...(Array.isArray(window.paths) ? window.paths.filter(path => path.level === 'category').map(path => path.category) : [])
    ];
    setOptions('deliveryCategoryOptions', [...all.map(product => product.category), ...additionalCategories]);
    const category = canonicalCategory(document.querySelector('#deliveryManualCategory').value);
    setOptions('deliveryBrandOptions', all.filter(product => !category || canonicalCategory(product.category) === category).map(productBrand));
  }

  function renderLines() {
    const confirm = document.querySelector('#confirmDelivery');
    confirm.disabled = !deliveryItems.length;
    linesBox.innerHTML = deliveryItems.length ? deliveryItems.map((item, index) => `
      <article class="delivery-line">
        <img src="${item.image_data || defaultImage}" alt="${escapeHtml(item.product.name)}">
        <div><p>${escapeHtml(item.product.category)} · ${escapeHtml(productBrand(item.product))} · ${escapeHtml(productWeight(item.product))}${item.draft ? '<span class="delivery-draft">nowy</span>' : ''}</p><h4>${escapeHtml(item.product.name)}</h4><small>Termin: <b>${formatDate(item.expiration_date)}</b></small></div>
        <strong>${item.quantity}<small>${escapeHtml(item.product.unit)}</small></strong>
        <button type="button" class="delivery-line-remove" data-delivery-remove="${index}" aria-label="Usuń z dostawy">×</button>
      </article>`).join('') : '<div class="delivery-empty"><b>Brak produktów w tej dostawie.</b><span>Zeskanuj kod lub dodaj pozycję ręcznie — magazyn jeszcze się nie zmieni.</span></div>';
    saveDraft();
  }

  document.querySelector('#deliverySupplier').addEventListener('input', saveDraft);
  document.querySelector('#deliveryReceived').addEventListener('input', saveDraft);
  document.querySelector('#deliveryNote').addEventListener('input', saveDraft);
  dialog.addEventListener('close', saveDraft);

  function openDelivery() {
    if (!restoreDraft()) {
      deliveryItems = [];
      document.querySelector('#deliveryForm').reset();
      document.querySelector('#deliveryReceived').value = today();
    }
    renderLines();
    dialog.showModal();
  }

  async function productImage(product) {
    let image = product.image_data || '';
    if (!image && product.has_image) {
      try { image = (await api(`/api/products/${product.id}/image`)).image_data || ''; } catch (_) { /* obraz to dodatek */ }
    }
    return image;
  }

  async function showDeliveryItem(product) {
    pendingProduct = product;
    pendingProduct.delivery_image = await productImage(product);
    document.querySelector('#deliveryItemPreview').innerHTML = `<img src="${pendingProduct.delivery_image || defaultImage}" alt="${escapeHtml(product.name)}"><div><p>${escapeHtml(product.category)} · ${escapeHtml(productBrand(product))} · ${escapeHtml(productWeight(product))}</p><h3>${escapeHtml(product.name)}</h3><small>Obecny stan: <b>${product.quantity} ${escapeHtml(product.unit)}</b></small></div>`;
    document.querySelector('#deliveryItemQuantity').value = '';
    document.querySelector('#deliveryItemExpiry').value = product.expiration_date || '';
    itemDialog.showModal();
    document.querySelector('#deliveryItemQuantity').focus();
  }

  function requireSupplier() {
    if (document.querySelector('#deliverySupplier').value.trim()) return true;
    const field = document.querySelector('#deliverySupplier');
    if (!dialog.open) dialog.showModal();
    field.setCustomValidity('Najpierw wpisz nazwę dostawy lub dostawcy.');
    field.reportValidity();
    field.focus();
    return false;
  }

  function openManualDeliveryItem(barcode = '') {
    if (!requireSupplier()) return;
    const form = document.querySelector('#deliveryManualItemForm');
    form.reset();
    document.querySelector('#deliveryManualBarcode').value = barcode || '';
    document.querySelector('#deliveryManualExpiry').value = '';
    fillManualSuggestions();
    manualDialog.showModal();
    document.querySelector('#deliveryManualCategory').focus();
  }

  async function openHistory() {
    historyBox.innerHTML = '<p class="delivery-empty">Wczytuję historię dostaw…</p>';
    historyDialog.showModal();
    try {
      const deliveries = await api('/api/deliveries');
      historyBox.innerHTML = deliveries.length ? deliveries.map(delivery => `<article class="delivery-history-card">
        <header><div><p>DOSTAWA</p><h3>${escapeHtml(delivery.supplier)}</h3><small>Przyjęto: ${formatDate(delivery.received_date)}${delivery.note ? ` · ${escapeHtml(delivery.note)}` : ''}</small></div><b>${delivery.items.length} ${delivery.items.length === 1 ? 'produkt' : 'produktów'}</b></header>
        <div class="delivery-history-items">${delivery.items.map(item => `<button type="button" class="delivery-history-item" data-delivery-product="${item.product_id || ''}"><img src="${item.image_data || defaultImage}" alt=""><span><b>${escapeHtml(item.name || 'Usunięty produkt')}</b><small>${escapeHtml(item.category || '')} · ${escapeHtml(item.brand || 'Pozostałe')} · ${item.weight_value ? `${item.weight_value} ${escapeHtml(item.weight_unit)}` : 'bez gramatury'}</small><small>Termin: ${formatDate(item.expiration_date)}</small></span><strong>${item.quantity}<small>${escapeHtml(item.unit || 'szt.')}</small></strong></button>`).join('')}</div>
      </article>`).join('') : '<div class="delivery-empty"><b>Nie ma jeszcze zatwierdzonych dostaw.</b><span>Po pierwszym przyjęciu produktów pojawią się tutaj szczegóły.</span></div>';
    } catch (error) {
      historyBox.innerHTML = `<p class="delivery-empty">${escapeHtml(error.message)}</p>`;
    }
  }

  function isSameProduct(product, { name, category, brand, weightValue, weightUnit }) {
    return comparable(product.name) === comparable(name)
      && canonicalCategory(product.category) === canonicalCategory(category)
      && comparable(productBrand(product)) === comparable(brand || 'Pozostałe')
      && Number(product.weight_value || 0) === Number(weightValue || 0)
      && String(product.weight_unit || '').toLowerCase() === String(weightUnit || '').toLowerCase();
  }

  window.openGroupedDeliveryItem = showDeliveryItem;
  window.openManualDeliveryItem = openManualDeliveryItem;
  window.resumeGroupedDelivery = () => { if (!dialog.open) dialog.showModal(); };
  window.openDeliveryForProduct = id => {
    const product = all.find(item => Number(item.id) === Number(id));
    if (!product) return;
    openDelivery();
    dialog.close();
    showDeliveryItem(product);
  };

  document.querySelector('#delivery').addEventListener('click', openDelivery);
  document.querySelector('#deliveryHistory').addEventListener('click', openHistory);
  document.querySelector('#deliverySupplier').addEventListener('input', event => event.target.setCustomValidity(''));
  document.querySelector('#scanDeliveryProduct').addEventListener('click', () => {
    if (!requireSupplier()) return;
    dialog.close();
    if (window.openBarcodeForGroupedDelivery) window.openBarcodeForGroupedDelivery();
    else alert('Skaner nie jest jeszcze gotowy. Odśwież stronę i spróbuj ponownie.');
  });
  document.querySelector('#manualDeliveryProduct').addEventListener('click', () => openManualDeliveryItem());
  document.querySelector('#deliveryManualCategory').addEventListener('input', fillManualSuggestions);

  document.querySelector('#deliveryItemForm').addEventListener('submit', event => {
    event.preventDefault();
    const quantity = Number(document.querySelector('#deliveryItemQuantity').value);
    const expiration = document.querySelector('#deliveryItemExpiry').value;
    if (!pendingProduct || !Number.isFinite(quantity) || quantity <= 0 || !expiration) return;
    deliveryItems.push({ product: pendingProduct, image_data: pendingProduct.delivery_image || '', quantity, expiration_date: expiration });
    pendingProduct = null;
    itemDialog.close();
    renderLines();
    dialog.showModal();
  });

  document.querySelector('#deliveryManualItemForm').addEventListener('submit', async event => {
    event.preventDefault();
    const category = canonicalCategory(document.querySelector('#deliveryManualCategory').value);
    const brand = document.querySelector('#deliveryManualBrand').value.trim();
    const name = document.querySelector('#deliveryManualName').value.trim();
    const barcode = document.querySelector('#deliveryManualBarcode').value.trim();
    const weightValue = Number(document.querySelector('#deliveryManualWeightValue').value || 0);
    const weightUnit = document.querySelector('#deliveryManualWeightUnit').value.trim().toLowerCase();
    const quantity = Number(document.querySelector('#deliveryManualQuantity').value);
    const unit = document.querySelector('#deliveryManualUnit').value;
    const expiration = document.querySelector('#deliveryManualExpiry').value;
    if (!category || !name || !Number.isFinite(quantity) || quantity <= 0 || !expiration) return;
    if (weightUnit && !['g', 'kg', 'ml', 'l'].includes(weightUnit)) return alert('Wybierz gramaturę: g, kg, ml albo l.');
    const matching = all.find(product => isSameProduct(product, { name, category, brand, weightValue, weightUnit }));
    const file = document.querySelector('#deliveryManualImage').files[0];
    const image = file ? await read(file) : '';
    if (matching) {
      const existingImage = image || await productImage(matching);
      deliveryItems.push({ product: matching, image_data: existingImage, quantity, expiration_date: expiration });
    } else {
      const product = { name, category, brand, barcode, quantity: 0, unit, weight_value: weightValue || null, weight_unit: weightUnit || '', image_data: image };
      deliveryItems.push({ product, draft: { name, category, brand, barcode, unit, weight_value: weightValue || null, weight_unit: weightUnit || '', image_data: image }, image_data: image, quantity, expiration_date: expiration });
    }
    manualDialog.close();
    renderLines();
    dialog.showModal();
  });

  linesBox.addEventListener('click', event => {
    const button = event.target.closest('[data-delivery-remove]');
    if (!button) return;
    deliveryItems.splice(Number(button.dataset.deliveryRemove), 1);
    renderLines();
  });

  document.querySelector('#deliveryForm').addEventListener('submit', async event => {
    event.preventDefault();
    const supplier = document.querySelector('#deliverySupplier').value.trim();
    if (!supplier || !deliveryItems.length) return;
    const confirm = document.querySelector('#confirmDelivery');
    confirm.disabled = true;
    confirm.textContent = 'Zapisuję dostawę…';
    try {
      await api('/api/deliveries', { method: 'POST', body: JSON.stringify({
        supplier,
        received_date: document.querySelector('#deliveryReceived').value,
        note: document.querySelector('#deliveryNote').value,
        items: deliveryItems.map(item => ({ product_id: item.draft ? null : item.product.id, new_product: item.draft || null, quantity: item.quantity, expiration_date: item.expiration_date }))
      }) });
      deliveryItems = [];
      document.querySelector('#deliveryForm').reset();
      clearDraft();
      dialog.close();
      await load();
      await openHistory();
    } catch (error) {
      alert(error.message);
    } finally {
      confirm.textContent = 'Potwierdź dostawę';
      renderLines();
    }
  });

  document.querySelector('#closeDelivery').addEventListener('click', () => dialog.close());
  document.querySelector('#cancelDelivery').addEventListener('click', () => {
    deliveryItems = [];
    document.querySelector('#deliveryForm').reset();
    clearDraft();
    dialog.close();
  });
  ['closeDeliveryItem', 'cancelDeliveryItem'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => {
    itemDialog.close(); pendingProduct = null; if (!dialog.open) dialog.showModal();
  }));
  ['closeDeliveryManualItem', 'cancelDeliveryManualItem'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => {
    manualDialog.close(); if (!dialog.open) dialog.showModal();
  }));
  ['closeDeliveryHistory', 'closeDeliveryHistoryBottom'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => historyDialog.close()));
  historyBox.addEventListener('click', event => {
    const button = event.target.closest('[data-delivery-product]');
    if (!button || !button.dataset.deliveryProduct) return;
    historyDialog.close();
    window.openProductDetails?.(Number(button.dataset.deliveryProduct));
  });
})();
