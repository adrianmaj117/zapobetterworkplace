/* Grupowe przyjmowanie dostaw i ich historia. */
(() => {
  const dialog = document.querySelector('#deliveryDialog');
  const itemDialog = document.querySelector('#deliveryItemDialog');
  const historyDialog = document.querySelector('#deliveryHistoryDialog');
  const linesBox = document.querySelector('#deliveryLines');
  const historyBox = document.querySelector('#deliveryHistoryList');
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const today = () => new Date().toISOString().slice(0, 10);
  const formatDate = value => value ? new Intl.DateTimeFormat('pl-PL').format(new Date(value)) : 'brak daty';
  const productBrand = product => product.brand || (product.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const productWeight = product => product.weight_value ? `${product.weight_value} ${product.weight_unit}` : 'bez gramatury';
  const defaultImage = 'assets/category-foods.png';
  let deliveryItems = [];
  let pendingProduct = null;

  function renderLines() {
    const confirm = document.querySelector('#confirmDelivery');
    confirm.disabled = !deliveryItems.length;
    linesBox.innerHTML = deliveryItems.length ? deliveryItems.map((item, index) => `
      <article class="delivery-line">
        <img src="${item.image_data || defaultImage}" alt="${escapeHtml(item.product.name)}">
        <div><p>${escapeHtml(item.product.category)} · ${escapeHtml(productBrand(item.product))} · ${escapeHtml(productWeight(item.product))}</p><h4>${escapeHtml(item.product.name)}</h4><small>Termin: <b>${formatDate(item.expiration_date)}</b></small></div>
        <strong>${item.quantity}<small>${escapeHtml(item.product.unit)}</small></strong>
        <button type="button" class="delivery-line-remove" data-delivery-remove="${index}" aria-label="Usuń z dostawy">×</button>
      </article>`).join('') : '<div class="delivery-empty"><b>Brak produktów w tej dostawie.</b><span>Zeskanuj pierwszy artykuł, aby go dodać.</span></div>';
  }

  function openDelivery() {
    deliveryItems = [];
    document.querySelector('#deliveryForm').reset();
    document.querySelector('#deliveryReceived').value = today();
    renderLines();
    dialog.showModal();
  }

  async function showDeliveryItem(product) {
    pendingProduct = product;
    let image = product.image_data || '';
    if (!image && product.has_image) {
      try { image = (await api(`/api/products/${product.id}/image`)).image_data || ''; } catch (_) { /* obraz jest dodatkiem */ }
    }
    pendingProduct.delivery_image = image;
    document.querySelector('#deliveryItemPreview').innerHTML = `<img src="${image || defaultImage}" alt="${escapeHtml(product.name)}"><div><p>${escapeHtml(product.category)} · ${escapeHtml(productBrand(product))} · ${escapeHtml(productWeight(product))}</p><h3>${escapeHtml(product.name)}</h3><small>Obecny stan: <b>${product.quantity} ${escapeHtml(product.unit)}</b></small></div>`;
    document.querySelector('#deliveryItemQuantity').value = '';
    document.querySelector('#deliveryItemExpiry').value = product.expiration_date || '';
    itemDialog.showModal();
    document.querySelector('#deliveryItemQuantity').focus();
  }

  async function openHistory() {
    historyBox.innerHTML = '<p class="delivery-empty">Wczytuję historię dostaw…</p>';
    historyDialog.showModal();
    try {
      const deliveries = await api('/api/deliveries');
      historyBox.innerHTML = deliveries.length ? deliveries.map(delivery => `<article class="delivery-history-card">
        <header><div><p>DOSTAWA</p><h3>${escapeHtml(delivery.supplier)}</h3><small>Przyjęto: ${formatDate(delivery.received_date)}${delivery.note ? ` · ${escapeHtml(delivery.note)}` : ''}</small></div><b>${delivery.items.length} ${delivery.items.length === 1 ? 'produkt' : 'produktów'}</b></header>
        <div class="delivery-history-items">${delivery.items.map(item => `<button type="button" class="delivery-history-item" data-delivery-product="${item.product_id}"><img src="${item.image_data || defaultImage}" alt=""><span><b>${escapeHtml(item.name || 'Usunięty produkt')}</b><small>${escapeHtml(item.category || '')} · ${escapeHtml(item.brand || 'Pozostałe')} · ${item.weight_value ? `${item.weight_value} ${escapeHtml(item.weight_unit)}` : 'bez gramatury'}</small><small>Termin: ${formatDate(item.expiration_date)}</small></span><strong>${item.quantity}<small>${escapeHtml(item.unit || 'szt.')}</small></strong></button>`).join('')}</div>
      </article>`).join('') : '<div class="delivery-empty"><b>Nie ma jeszcze zatwierdzonych dostaw.</b><span>Po pierwszym przyjęciu produktów pojawią się tutaj szczegóły.</span></div>';
    } catch (error) {
      historyBox.innerHTML = `<p class="delivery-empty">${escapeHtml(error.message)}</p>`;
    }
  }

  // Wywoływane przez skaner po prawidłowym odczycie kodu.
  window.openGroupedDeliveryItem = showDeliveryItem;
  window.openDeliveryForProduct = id => {
    const product = all.find(item => Number(item.id) === Number(id));
    if (!product) return;
    openDelivery();
    dialog.close();
    showDeliveryItem(product);
  };

  document.querySelector('#delivery').addEventListener('click', openDelivery);
  document.querySelector('#deliveryHistory').addEventListener('click', openHistory);
  document.querySelector('#scanDeliveryProduct').addEventListener('click', () => {
    if (!document.querySelector('#deliverySupplier').value.trim()) {
      document.querySelector('#deliverySupplier').focus();
      return alert('Najpierw podaj nazwę dostawy lub dostawcy.');
    }
    dialog.close();
    if (window.openBarcodeForGroupedDelivery) window.openBarcodeForGroupedDelivery();
    else alert('Skaner nie jest jeszcze gotowy. Odśwież stronę i spróbuj ponownie.');
  });
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
        items: deliveryItems.map(item => ({ product_id: item.product.id, quantity: item.quantity, expiration_date: item.expiration_date }))
      }) });
      dialog.close();
      deliveryItems = [];
      await load();
      await openHistory();
    } catch (error) {
      alert(error.message);
    } finally {
      confirm.textContent = 'Potwierdź dostawę';
      renderLines();
    }
  });
  ['closeDelivery', 'cancelDelivery'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.close()));
  ['closeDeliveryItem', 'cancelDeliveryItem'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => {
    itemDialog.close();
    pendingProduct = null;
    if (!dialog.open) dialog.showModal();
  }));
  ['closeDeliveryHistory', 'closeDeliveryHistoryBottom'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => historyDialog.close()));
  historyBox.addEventListener('click', event => {
    const button = event.target.closest('[data-delivery-product]');
    if (!button) return;
    historyDialog.close();
    window.openProductDetails?.(Number(button.dataset.deliveryProduct));
  });
})();
