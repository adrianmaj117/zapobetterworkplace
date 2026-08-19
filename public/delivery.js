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
  let scanEvents = [];
  let pendingProduct = null;
  let pendingScan = null;
  let manualSelectedProductId = 0;
  const draftKey = 'zapo-delivery-draft-v1';
  let draftRestored = false;

  function saveDraft() {
    const supplier = document.querySelector('#deliverySupplier').value;
    const received_date = document.querySelector('#deliveryReceived').value;
    const note = document.querySelector('#deliveryNote').value;
    if (!supplier.trim() && !note.trim() && !deliveryItems.length) { sessionStorage.removeItem(draftKey); return; }
    const items = deliveryItems.map(item => ({ product:item.product, draft:item.draft || null, quantity:item.quantity, expiration_date:item.expiration_date, image_data:item.image_data || '' }));
    try { sessionStorage.setItem(draftKey, JSON.stringify({ supplier, received_date, note, items, scanEvents })); }
    catch (_) {
      try { sessionStorage.setItem(draftKey, JSON.stringify({ supplier, received_date, note, scanEvents, items:items.map(item => ({ ...item, image_data:'', product:{ ...item.product, image_data:'' }, draft:item.draft ? { ...item.draft, image_data:'' } : null })) })); } catch (_) {}
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
      scanEvents = Array.isArray(draft.scanEvents) ? draft.scanEvents : [];
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

  function renderManualProductSuggestions() {
    const box = document.querySelector('#deliveryManualSuggestions');
    const input = document.querySelector('#deliveryManualName');
    const query = comparable(input.value);
    if (query.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
    const words = query.split(' ').filter(Boolean);
    const matches = all.map(product => {
      const text = comparable(`${product.name} ${product.brand} ${product.weight_value || ''} ${product.weight_unit || ''}`);
      const score = (text.includes(query) ? 50 : 0) + words.reduce((sum, word) => sum + (text.includes(word) ? 8 : 0), 0);
      return { product, score };
    }).filter(entry => entry.score >= 8).sort((a, b) => b.score - a.score || a.product.name.localeCompare(b.product.name, 'pl')).slice(0, 5);
    if (!matches.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<p>Podobne produkty z magazynu — wybierz, aby dodać do tej dostawy:</p>${matches.map(({ product }) => `<button type="button" class="delivery-manual-suggestion" data-manual-product="${product.id}"><span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(product.category)} · ${escapeHtml(productBrand(product))} · ${escapeHtml(productWeight(product))} · stan: ${product.quantity} ${escapeHtml(product.unit)}</small></span><span>Wybierz</span></button>`).join('')}`;
  }

  async function loadManualBarcodes(product) {
    const field = document.querySelector('#deliverySavedBarcodeField');
    const select = document.querySelector('#deliverySavedBarcode');
    field.hidden = true;
    select.innerHTML = '<option value="">Wybierz kod produktu…</option>';
    if (!product?.id) return;
    try {
      const codes = await api(`/api/products/${product.id}/barcodes`);
      if (!codes.length) return;
      select.innerHTML += codes.map(code => `<option value="${escapeHtml(code.barcode)}" data-multiplier="${Number(code.quantity_multiplier || 1)}" data-package="${escapeHtml(code.package_name || 'Sztuka')}">${escapeHtml(code.package_name || 'Sztuka')} · ${escapeHtml(code.barcode)} · +${Number(code.quantity_multiplier || 1)} szt.</option>`).join('');
      field.hidden = false;
    } catch (_) { /* ręczne wpisanie kodu nadal jest dostępne */ }
  }

  async function chooseManualProduct(product) {
    if (!product) return;
    manualSelectedProductId = Number(product.id);
    document.querySelector('#deliveryManualName').value = product.name;
    document.querySelector('#deliveryManualCategory').value = product.category;
    document.querySelector('#deliveryManualBrand').value = product.brand || '';
    document.querySelector('#deliveryManualWeightValue').value = product.weight_value || '';
    document.querySelector('#deliveryManualWeightUnit').value = product.weight_unit || '';
    document.querySelector('#deliveryManualUnit').value = product.unit || 'szt.';
    if (!document.querySelector('#deliveryManualBarcode').value.trim()) document.querySelector('#deliveryManualBarcode').value = product.barcode || '';
    document.querySelector('#deliveryManualSuggestions').hidden = true;
    fillManualSuggestions();
    await loadManualBarcodes(product);
  }

  function addToDelivery(item) {
    const sameProduct = entry => !entry.draft && !item.draft && Number(entry.product.id) === Number(item.product.id)
      && String(entry.expiration_date || '') === String(item.expiration_date || '');
    const existing = deliveryItems.find(sameProduct);
    if (existing) existing.quantity = Number(existing.quantity) + Number(item.quantity);
    else deliveryItems.push(item);
  }

  function addScanEvent(product, scan, quantity, packageCount = null) {
    if (!scan?.barcode) return;
    const multiplier = Number(scan.quantity_multiplier || 1);
    const packages = Number(packageCount || (multiplier > 1 ? Number(quantity) / multiplier : 1));
    scanEvents.push({
      product_id: product.id,
      product_name: product.name,
      barcode: scan.barcode,
      package_name: scan.package_name || 'Sztuka',
      quantity: Number(quantity),
      quantity_multiplier: multiplier,
      package_count: Number.isFinite(packages) && packages > 0 ? packages : 1,
      time: new Date().toLocaleTimeString('pl-PL', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    });
  }

  // Pierwszy skan produktu pozwala podać termin partii. Gdy w bieżącej dostawie
  // istnieje już tylko jedna partia tego produktu, następne skany są natychmiast
  // sumowane do niej — bez dodatkowego klikania.
  function addRepeatedScan(product, scan) {
    if (!scan?.barcode) return false;
    // Kod opakowania zawsze otwiera kalkulator liczby paczek. Dzięki temu
    // jeden skan może przyjąć np. 10 kartonów po 20 sztuk, a nie tylko 20 sztuk.
    if (Number(scan.quantity_multiplier || 1) > 1) return false;
    const productLines = deliveryItems.filter(entry => !entry.draft && Number(entry.product.id) === Number(product.id));
    if (productLines.length !== 1) return false;
    const quantity = Number(scan.quantity_multiplier || 1);
    productLines[0].quantity = Number(productLines[0].quantity || 0) + quantity;
    addScanEvent(product, scan, quantity);
    renderLines();
    return true;
  }

  function renderLines() {
    const confirm = document.querySelector('#confirmDelivery');
    confirm.disabled = !deliveryItems.length;
    const total = deliveryItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
    const scanHistory = scanEvents.length ? `<details class="delivery-scan-history"><summary>Historia skanów (${scanEvents.length})</summary><ul>${scanEvents.map(event => { const multiplier=Number(event.quantity_multiplier || 1); const packages=Number(event.package_count || 1); const calculation=multiplier>1 ? `${packages} opak. × ${multiplier} szt. = <b>+${Number(event.quantity)} szt.</b>` : `<b>+${Number(event.quantity)} szt.</b>`; return `<li>${escapeHtml(event.time || '')} · ${escapeHtml(event.product_name || '')} · ${escapeHtml(event.package_name || 'Sztuka')} · ${calculation}</li>`; }).join('')}</ul></details>` : '';
    linesBox.innerHTML = deliveryItems.length ? `<div class="delivery-lines-summary"><b>Różne produkty: ${deliveryItems.length}</b><b>Łącznie: ${total}</b></div>${deliveryItems.map((item, index) => `
      <article class="delivery-line">
        <img src="${item.image_data || defaultImage}" alt="${escapeHtml(item.product.name)}">
        <div><p>${escapeHtml(item.product.category)} · ${escapeHtml(productBrand(item.product))} · ${escapeHtml(productWeight(item.product))}${item.draft ? '<span class="delivery-draft">nowy</span>' : ''}</p><h4>${escapeHtml(item.product.name)}</h4><small>Termin: <b>${formatDate(item.expiration_date)}</b></small></div>
        <div class="delivery-line-controls"><button type="button" class="delivery-line-adjust" data-delivery-adjust="-1" data-delivery-index="${index}" aria-label="Odejmij jedną sztukę">−</button><input class="delivery-line-quantity" data-delivery-quantity="${index}" type="number" min="0.001" step="any" value="${item.quantity}" aria-label="Ilość ${escapeHtml(item.product.name)}"><button type="button" class="delivery-line-adjust" data-delivery-adjust="1" data-delivery-index="${index}" aria-label="Dodaj jedną sztukę">+</button></div>
        <button type="button" class="delivery-line-remove" data-delivery-remove="${index}" aria-label="Usuń z dostawy">×</button>
      </article>`).join('')}${scanHistory}` : '<div class="delivery-empty"><b>Brak produktów w tej dostawie.</b><span>Zeskanuj kod lub dodaj pozycję ręcznie — magazyn jeszcze się nie zmieni.</span></div>';
    saveDraft();
  }

  document.querySelector('#deliverySupplier').addEventListener('input', saveDraft);
  document.querySelector('#deliveryReceived').addEventListener('input', saveDraft);
  document.querySelector('#deliveryNote').addEventListener('input', saveDraft);
  dialog.addEventListener('close', saveDraft);

  function openDelivery() {
    if (!restoreDraft()) {
      deliveryItems = [];
      scanEvents = [];
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

  async function showDeliveryItem(product, scan = null) {
    pendingProduct = product;
    pendingScan = scan && typeof scan === 'object' ? scan : null;
    pendingProduct.delivery_image = await productImage(product);
    const multiplier = Number(pendingScan?.quantity_multiplier || 1);
    const isPackage = Boolean(pendingScan?.barcode) && multiplier > 1;
    const packageLabel = pendingScan?.package_name ? ` · ${pendingScan.package_name}` : '';
    document.querySelector('#deliveryItemPreview').innerHTML = `<img src="${pendingProduct.delivery_image || defaultImage}" alt="${escapeHtml(product.name)}"><div><p>${escapeHtml(product.category)} · ${escapeHtml(productBrand(product))} · ${escapeHtml(productWeight(product))}${escapeHtml(packageLabel)}</p><h3>${escapeHtml(product.name)}</h3><small>Obecny stan: <b>${product.quantity} ${escapeHtml(product.unit)}</b>${isPackage ? ` · kod opakowania: <b>${multiplier} szt.</b>` : pendingScan ? ' · kod pojedynczej sztuki' : ''}</small></div>`;
    const calculation = document.querySelector('#deliveryPackageCalculation');
    const quantityField = document.querySelector('#deliveryItemQuantityField');
    const quantityInput = document.querySelector('#deliveryItemQuantity');
    calculation.hidden = !isPackage;
    quantityField.hidden = isPackage;
    quantityInput.readOnly = isPackage;
    document.querySelector('#deliveryPackageSize').value = isPackage ? multiplier : '';
    document.querySelector('#deliveryPackageCount').value = '1';
    document.querySelector('#deliveryPackageTotal').value = isPackage ? multiplier : '';
    quantityInput.value = pendingScan ? multiplier : '';
    document.querySelector('#deliveryItemExpiry').value = product.expiration_date || '';
    itemDialog.showModal();
    (isPackage ? document.querySelector('#deliveryPackageCount') : quantityInput).focus();
  }

  function recalculateDeliveryPackageQuantity() {
    const size = Number(document.querySelector('#deliveryPackageSize').value || 0);
    const packages = Number(document.querySelector('#deliveryPackageCount').value || 0);
    const total = size * packages;
    document.querySelector('#deliveryPackageTotal').value = Number.isFinite(total) && total > 0 ? total : '';
    document.querySelector('#deliveryItemQuantity').value = Number.isFinite(total) && total > 0 ? total : '';
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
    manualSelectedProductId = 0;
    document.querySelector('#deliveryManualBarcode').value = barcode || '';
    document.querySelector('#deliveryManualMultiplier').value = '1';
    document.querySelector('#deliverySavedBarcodeField').hidden = true;
    document.querySelector('#deliverySavedBarcode').innerHTML = '<option value="">Wybierz kod produktu…</option>';
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
        <header><div><p>DOSTAWA</p><h3>${escapeHtml(delivery.supplier)}</h3><small>Przyjęto: ${formatDate(delivery.received_date)}${delivery.accepted_by_name ? ` · zatwierdził(a): ${escapeHtml(delivery.accepted_by_name)}` : ''}${delivery.note ? ` · ${escapeHtml(delivery.note)}` : ''}</small></div><b>${delivery.items.length} ${delivery.items.length === 1 ? 'produkt' : 'produktów'}</b></header>
        <div class="delivery-history-items">${delivery.items.map(item => `<button type="button" class="delivery-history-item" data-delivery-product="${item.product_id || ''}"><img src="${item.image_data || defaultImage}" alt=""><span><b>${escapeHtml(item.name || 'Usunięty produkt')}</b><small>${escapeHtml(item.category || '')} · ${escapeHtml(item.brand || 'Pozostałe')} · ${item.weight_value ? `${item.weight_value} ${escapeHtml(item.weight_unit)}` : 'bez gramatury'}</small><small>Termin: ${formatDate(item.expiration_date)}</small></span><strong>${item.quantity}<small>${escapeHtml(item.unit || 'szt.')}</small></strong></button>`).join('')}</div>
        ${(delivery.scan_events || []).length ? `<details class="delivery-scan-history"><summary>Historia skanów (${delivery.scan_events.length})</summary><ul>${delivery.scan_events.map(event => { const multiplier=Number(event.quantity_multiplier || 1); const packages=Number(event.package_count || 1); const calculation=multiplier>1 ? `${packages} opak. × ${multiplier} szt. = <b>+${Number(event.quantity)} szt.</b>` : `<b>+${Number(event.quantity)} szt.</b>`; return `<li>${escapeHtml(event.scanned_at || '')} · ${escapeHtml(event.name || 'Produkt')} · ${escapeHtml(event.package_name || 'Sztuka')} · ${calculation}</li>`; }).join('')}</ul></details>` : ''}
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

  window.openGroupedDeliveryItem = (product, scan) => {
    if (addRepeatedScan(product, scan)) {
      window.openBarcodeForGroupedDelivery?.();
      return;
    }
    showDeliveryItem(product, scan);
  };
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
  document.querySelector('#deliveryManualName').addEventListener('input', () => { manualSelectedProductId = 0; renderManualProductSuggestions(); });
  document.querySelector('#deliveryManualMultiplier').addEventListener('input', event => {
    if (document.querySelector('#deliveryManualBarcode').value.trim()) document.querySelector('#deliveryManualQuantity').value = event.target.value || '';
  });
  document.querySelector('#deliverySavedBarcode').addEventListener('change', event => {
    const option = event.target.selectedOptions[0];
    if (!option?.value) return;
    document.querySelector('#deliveryManualBarcode').value = option.value;
    document.querySelector('#deliveryManualMultiplier').value = option.dataset.multiplier || '1';
    document.querySelector('#deliveryManualPackageName').value = option.dataset.package || 'Sztuka';
    document.querySelector('#deliveryManualQuantity').value = option.dataset.multiplier || '1';
  });
  document.querySelector('#deliveryManualSuggestions').addEventListener('click', event => {
    const button = event.target.closest('[data-manual-product]');
    if (button) chooseManualProduct(all.find(product => Number(product.id) === Number(button.dataset.manualProduct)));
  });
  document.querySelector('#deliveryPackageCount').addEventListener('input', recalculateDeliveryPackageQuantity);

  document.querySelector('#deliveryItemForm').addEventListener('submit', event => {
    event.preventDefault();
    const quantity = Number(document.querySelector('#deliveryItemQuantity').value);
    const expiration = document.querySelector('#deliveryItemExpiry').value;
    if (!pendingProduct || !Number.isFinite(quantity) || quantity <= 0 || !expiration) return;
    const product = pendingProduct;
    const scan = pendingScan;
    const packageCount = Number(scan?.quantity_multiplier || 1) > 1 ? Number(document.querySelector('#deliveryPackageCount').value) : null;
    addToDelivery({ product, image_data: product.delivery_image || '', quantity, expiration_date: expiration });
    addScanEvent(product, scan, quantity, packageCount);
    pendingProduct = null;
    pendingScan = null;
    itemDialog.close();
    renderLines();
    if (scan?.barcode && window.openBarcodeForGroupedDelivery) window.openBarcodeForGroupedDelivery();
    else dialog.showModal();
  });

  document.querySelector('#deliveryManualItemForm').addEventListener('submit', async event => {
    event.preventDefault();
    const category = canonicalCategory(document.querySelector('#deliveryManualCategory').value);
    const brand = document.querySelector('#deliveryManualBrand').value.trim();
    const name = document.querySelector('#deliveryManualName').value.trim();
    const barcode = document.querySelector('#deliveryManualBarcode').value.trim();
    const weightValue = Number(document.querySelector('#deliveryManualWeightValue').value || 0);
    const weightUnit = document.querySelector('#deliveryManualWeightUnit').value.trim().toLowerCase();
    const multiplier = Number(document.querySelector('#deliveryManualMultiplier').value || 1);
    const packageName = document.querySelector('#deliveryManualPackageName').value.trim() || 'Sztuka';
    const quantity = Number(document.querySelector('#deliveryManualQuantity').value);
    const unit = document.querySelector('#deliveryManualUnit').value;
    const expiration = document.querySelector('#deliveryManualExpiry').value;
    if (!category || !name || !Number.isFinite(quantity) || quantity <= 0 || !expiration || !Number.isFinite(multiplier) || multiplier <= 0) return;
    if (weightUnit && !['g', 'kg', 'ml', 'l'].includes(weightUnit)) return alert('Wybierz gramaturę: g, kg, ml albo l.');
    const matching = all.find(product => Number(product.id) === Number(manualSelectedProductId)) || all.find(product => isSameProduct(product, { name, category, brand, weightValue, weightUnit }));
    const file = document.querySelector('#deliveryManualImage').files[0];
    const image = file ? await read(file) : '';
    if (matching) {
      const existingImage = image || await productImage(matching);
      if (barcode && comparable(barcode) !== comparable(matching.barcode || '')) {
        const configured = await api(`/api/products/${matching.id}/barcodes`);
        if (!configured.some(code => comparable(code.barcode) === comparable(barcode))) {
          await api(`/api/products/${matching.id}/barcodes`, { method:'POST', body:JSON.stringify({ barcode, quantity_multiplier:multiplier, package_name:packageName }) });
        }
      }
      addToDelivery({ product: matching, image_data: existingImage, quantity, expiration_date: expiration });
      if (barcode) addScanEvent(matching, { barcode, package_name:packageName }, quantity);
    } else {
      const product = { name, category, brand, barcode, quantity: 0, unit, weight_value: weightValue || null, weight_unit: weightUnit || '', image_data: image };
      addToDelivery({ product, draft: { name, category, brand, barcode, unit, weight_value: weightValue || null, weight_unit: weightUnit || '', image_data: image }, image_data: image, quantity, expiration_date: expiration });
    }
    manualDialog.close();
    renderLines();
    dialog.showModal();
  });

  linesBox.addEventListener('click', event => {
    const button = event.target.closest('[data-delivery-remove]');
    if (button) {
      deliveryItems.splice(Number(button.dataset.deliveryRemove), 1);
      renderLines();
      return;
    }
    const adjust = event.target.closest('[data-delivery-adjust]');
    if (!adjust) return;
    const index = Number(adjust.dataset.deliveryIndex);
    const item = deliveryItems[index];
    if (!item) return;
    item.quantity = Math.max(0.001, Number(item.quantity || 0) + Number(adjust.dataset.deliveryAdjust || 0));
    renderLines();
  });
  linesBox.addEventListener('change', event => {
    const input = event.target.closest('[data-delivery-quantity]');
    if (!input) return;
    const item = deliveryItems[Number(input.dataset.deliveryQuantity)];
    const quantity = Number(input.value);
    if (!item || !Number.isFinite(quantity) || quantity <= 0) { renderLines(); return; }
    item.quantity = quantity;
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
        items: deliveryItems.map(item => ({ product_id: item.draft ? null : item.product.id, new_product: item.draft || null, quantity: item.quantity, expiration_date: item.expiration_date })),
        scan_events: scanEvents.map(event => ({ product_id:event.product_id, barcode:event.barcode, package_name:event.package_name, quantity:event.quantity }))
      }) });
      deliveryItems = [];
      scanEvents = [];
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
    scanEvents = [];
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
