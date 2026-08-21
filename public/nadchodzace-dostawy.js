(() => {
  'use strict';
  const token = localStorage.getItem('zapoToken');
  if (!token) { location.replace('/'); return; }
  const $ = selector => document.querySelector(selector);
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;' })[char]);
  const format = value => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(Number(value || 0));
  const imageUrl = product => product?.has_image ? `/api/products/${product.id}/image?v=${encodeURIComponent(product.updated_at || product.id)}` : '/assets/category-foods.png';
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  let session = null;
  let products = [];
  let categories = [];
  let deliveries = [];
  let activeDelivery = null;
  let selectedProduct = null;
  let editingSupplier = false;
  let newProductImage = null;

  async function api(url, options = {}) {
    const response = await fetch(url, { ...options, headers: { 'Content-Type':'application/json', 'x-session-token':token, ...(options.headers || {}) } });
    if (response.status === 401) { localStorage.removeItem('zapoToken'); location.replace('/'); throw new Error('Sesja wygasła.'); }
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Nie udało się wykonać operacji.');
    return response.status === 204 ? null : response.json();
  }
  function toast(message) {
    const element = $('#toast'); element.textContent = message; element.classList.add('show');
    clearTimeout(toast.timer); toast.timer = setTimeout(() => element.classList.remove('show'), 3200);
  }
  function statusClass(status) { return status === 'Kompletna' ? 'complete' : status === 'Oczekuje' ? '' : 'partial'; }
  function productMeta(product) {
    const weight = product.weight_value ? `${format(product.weight_value)} ${product.weight_unit || ''}` : 'bez gramatury';
    return [product.brand || 'Pozostałe', weight, product.category].filter(Boolean).join(' · ');
  }
  function progressMarkup(delivery) {
    return `<div class="progress-copy"><span>Odebrano ${format(delivery.received_total)} z ${format(delivery.planned_total)}</span><b>${delivery.progress}%</b></div><div class="progress-track" aria-label="Postęp dostawy ${delivery.progress}%"><span style="width:${delivery.progress}%"></span></div>`;
  }

  function renderCards() {
    const container = $('#deliveryCards');
    if (!deliveries.length) {
      container.innerHTML = '<div class="upcoming-empty"><strong>Nie ma jeszcze nadchodzących dostaw</strong><span>Dodaj pierwszą firmę, a następnie przygotuj listę produktów.</span></div>';
      return;
    }
    container.innerHTML = deliveries.map(delivery => `<button type="button" class="upcoming-card" data-delivery-id="${delivery.id}">
      <div class="upcoming-card-top"><div><p class="eyebrow">DOSTAWCA</p><h2>${escapeHtml(delivery.supplier)}</h2></div><span class="delivery-status ${statusClass(delivery.status)}">${escapeHtml(delivery.status)}</span></div>
      <div class="upcoming-card-summary"><span><b>${format(delivery.product_count)}</b> produktów</span><span><b>${format(delivery.planned_total)}</b> planowanych sztuk</span></div>
      ${progressMarkup(delivery)}
    </button>`).join('');
  }

  function renderDelivery() {
    const delivery = activeDelivery;
    $('#deliveryHeader').innerHTML = `<div class="delivery-detail-title"><div><p class="eyebrow">NADCHODZĄCA DOSTAWA</p><h1>${escapeHtml(delivery.supplier)}</h1><p>${format(delivery.product_count)} produktów · utworzył(a): ${escapeHtml(delivery.created_by_name || 'użytkownik')}</p></div><span class="delivery-status ${statusClass(delivery.status)}">${escapeHtml(delivery.status)}</span></div><div class="delivery-progress-large"><span>Łącznie odebrano <b>${format(delivery.received_total)}</b> z <b>${format(delivery.planned_total)}</b></span><strong>${delivery.progress}%</strong><div class="progress-track"><span style="width:${delivery.progress}%"></span></div></div>`;
    const container = $('#deliveryProducts');
    if (!delivery.items.length) {
      container.innerHTML = '<div class="upcoming-product-empty"><b>Ta dostawa nie ma jeszcze produktów.</b><br>Użyj przycisku „Dodaj produkt”, aby przygotować jej zawartość.</div>';
      return;
    }
    container.innerHTML = delivery.items.map(item => `<article class="upcoming-product-row" data-item-id="${item.id}">
      <img src="${imageUrl({ ...item, id:item.product_id })}" alt="" loading="lazy">
      <div class="upcoming-product-copy"><small>${escapeHtml(productMeta(item))}</small><h3>${escapeHtml(item.name)}</h3><p>Stan magazynu: <b>${format(item.stock_quantity)} ${escapeHtml(item.unit)}</b></p></div>
      <label>Planowane<input data-field="planned" type="number" min="0.01" step="0.01" value="${Number(item.planned_quantity)}"></label>
      <label>Odebrane<input data-field="received" type="number" min="0" step="0.01" value="${Number(item.received_quantity)}"></label>
      <div class="upcoming-row-actions"><button type="button" class="small-btn save" data-save-item="${item.id}">Zapisz</button><button type="button" class="small-btn delete" data-delete-item="${item.id}">Usuń</button></div>
    </article>`).join('');
  }

  async function loadAll() {
    [session, products, categories, deliveries] = await Promise.all([
      api('/api/session'), api('/api/products?sort=name'), api('/api/categories'), api('/api/upcoming-deliveries')
    ]);
    const caps = session.capabilities || session.user?.capabilities || {};
    if (!caps.delivery) throw new Error('To konto nie ma dostępu do nadchodzących dostaw.');
    $('#supplierOptions').innerHTML = [...new Set(products.map(p => p.brand).filter(Boolean))].sort((a,b) => a.localeCompare(b,'pl')).map(name => `<option value="${escapeHtml(name)}"></option>`).join('');
    $('#newProductCategory').innerHTML = categories.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
    renderCards();
  }
  async function reloadDeliveries() {
    deliveries = await api('/api/upcoming-deliveries'); renderCards();
    if (activeDelivery) { activeDelivery = await api(`/api/upcoming-deliveries/${activeDelivery.id}`); renderDelivery(); }
  }
  async function openDelivery(id) {
    activeDelivery = await api(`/api/upcoming-deliveries/${id}`);
    $('#deliveriesView').hidden = true; $('#deliveryView').hidden = false; renderDelivery(); scrollTo({ top:0, behavior:'smooth' });
  }

  function openSupplier(edit = false) {
    editingSupplier = edit;
    $('#supplierTitle').textContent = edit ? 'Edytuj dostawcę' : 'Nowa dostawa';
    $('#supplierName').value = edit ? activeDelivery.supplier : '';
    $('#supplierDialog').showModal(); setTimeout(() => $('#supplierName').focus(), 50);
  }
  function searchProducts(query) {
    const words = normalize(query).split(' ').filter(Boolean);
    if (!words.length) return [];
    return products.map(product => {
      const haystack = normalize([product.name, product.brand, product.category, product.weight_value, product.weight_unit, product.barcode].join(' '));
      const matched = words.filter(word => haystack.includes(word)).length;
      const starts = normalize(product.name).startsWith(words.join(' ')) ? 3 : 0;
      return { product, score:matched * 5 + starts };
    }).filter(item => item.score > 0).sort((a,b) => b.score - a.score || a.product.name.localeCompare(b.product.name,'pl')).slice(0,12).map(item => item.product);
  }
  function renderSuggestions() {
    const query = $('#productSearch').value.trim();
    const matches = searchProducts(query);
    $('#productSuggestions').innerHTML = !query ? '<p class="suggestion-help">Wpisz nazwę, firmę, kategorię albo kod kreskowy.</p>' : !matches.length ? '<p class="suggestion-help">Nie znaleziono podobnego produktu. Możesz dodać go do wspólnej bazy.</p>' : matches.map(product => `<button type="button" class="product-suggestion" data-select-product="${product.id}"><img src="${imageUrl(product)}" alt="" loading="lazy"><span><b>${escapeHtml(product.name)}</b><small>${escapeHtml(productMeta(product))}</small></span><span>${format(product.quantity)} ${escapeHtml(product.unit)}</span></button>`).join('');
  }
  function chooseProduct(id) {
    selectedProduct = products.find(product => product.id === id);
    if (!selectedProduct) return;
    $('#selectedProductImage').src = imageUrl(selectedProduct);
    $('#selectedProductName').textContent = selectedProduct.name;
    $('#selectedProductMeta').textContent = productMeta(selectedProduct);
    $('#selectedProductExtra').textContent = `Stan: ${format(selectedProduct.quantity)} ${selectedProduct.unit}${selectedProduct.barcode ? ` · kod: ${selectedProduct.barcode}` : ''}`;
    $('#selectedPlanned').value = '';
    $('#selectedProductForm').hidden = false;
    $('#selectedPlanned').focus();
  }
  async function imageToDataUrl(file) {
    if (!file) return null;
    const source = await new Promise((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file); });
    const image = await new Promise((resolve,reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = source; });
    const scale = Math.min(1, 1100 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(image.width * scale)); canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .78);
  }

  $('#newDelivery').onclick = () => openSupplier(false);
  $('#editSupplier').onclick = () => openSupplier(true);
  $('#supplierForm').onsubmit = async event => {
    event.preventDefault();
    try {
      if (editingSupplier) {
        activeDelivery = await api(`/api/upcoming-deliveries/${activeDelivery.id}`, { method:'PUT', body:JSON.stringify({ supplier:$('#supplierName').value }) });
      } else {
        activeDelivery = await api('/api/upcoming-deliveries', { method:'POST', body:JSON.stringify({ supplier:$('#supplierName').value }) });
      }
      $('#supplierDialog').close(); await reloadDeliveries(); await openDelivery(activeDelivery.id); toast('Dostawa została zapisana.');
    } catch (error) { toast(error.message); }
  };
  $('#deliveryCards').onclick = event => { const card = event.target.closest('[data-delivery-id]'); if (card) openDelivery(Number(card.dataset.deliveryId)).catch(error => toast(error.message)); };
  $('#backToDeliveries').onclick = async () => { activeDelivery = null; $('#deliveryView').hidden = true; $('#deliveriesView').hidden = false; deliveries = await api('/api/upcoming-deliveries'); renderCards(); };
  $('#addDeliveryProduct').onclick = () => { selectedProduct = null; $('#productSearch').value=''; $('#selectedProductForm').hidden=true; renderSuggestions(); $('#productPickerDialog').showModal(); setTimeout(() => $('#productSearch').focus(),50); };
  $('#productSearch').oninput = renderSuggestions;
  $('#productSuggestions').onclick = event => { const button = event.target.closest('[data-select-product]'); if (button) chooseProduct(Number(button.dataset.selectProduct)); };
  $('#selectedProductForm').onsubmit = async event => {
    event.preventDefault(); if (!selectedProduct) return;
    try {
      activeDelivery = await api(`/api/upcoming-deliveries/${activeDelivery.id}/items`, { method:'POST', body:JSON.stringify({ product_id:selectedProduct.id, planned_quantity:Number($('#selectedPlanned').value) }) });
      $('#productPickerDialog').close(); renderDelivery(); await reloadDeliveries(); toast('Produkt dodany do nadchodzącej dostawy.');
    } catch (error) { toast(error.message); }
  };
  $('#openNewProduct').onclick = () => { $('#productPickerDialog').close(); $('#newProductForm').reset(); newProductImage=null; $('#newProductDialog').showModal(); };
  $('#newProductForm [name="image"]').onchange = async event => { try { newProductImage = await imageToDataUrl(event.target.files[0]); } catch { newProductImage = null; toast('Nie udało się przygotować zdjęcia.'); } };
  $('#newProductForm').onsubmit = async event => {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    try {
      const product = await api('/api/products', { method:'POST', body:JSON.stringify({ name:form.get('name'), brand:form.get('brand'), category:form.get('category'), unit:form.get('unit'), quantity:0, min_quantity:0, weight_value:form.get('weight_value') ? Number(form.get('weight_value')) : null, weight_unit:form.get('weight_unit') || null, barcode:form.get('barcode'), image_data:newProductImage }) });
      products.push({ ...product, has_image:newProductImage ? 1 : 0 });
      activeDelivery = await api(`/api/upcoming-deliveries/${activeDelivery.id}/items`, { method:'POST', body:JSON.stringify({ product_id:product.id, planned_quantity:Number(form.get('planned_quantity')) }) });
      $('#newProductDialog').close(); renderDelivery(); await reloadDeliveries(); toast('Nowy produkt zapisano we wspólnej bazie i dodano do dostawy.');
    } catch (error) { toast(error.message); }
  };
  $('#deliveryProducts').onclick = async event => {
    const row = event.target.closest('[data-item-id]'); if (!row) return;
    const save = event.target.closest('[data-save-item]');
    const remove = event.target.closest('[data-delete-item]');
    try {
      if (save) {
        activeDelivery = await api(`/api/upcoming-delivery-items/${save.dataset.saveItem}`, { method:'PUT', body:JSON.stringify({ planned_quantity:Number(row.querySelector('[data-field="planned"]').value), received_quantity:Number(row.querySelector('[data-field="received"]').value) }) });
        renderDelivery(); await reloadDeliveries(); toast('Ilości zostały zapisane.');
      }
      if (remove && confirm('Usunąć ten produkt z nadchodzącej dostawy?')) {
        await api(`/api/upcoming-delivery-items/${remove.dataset.deleteItem}`, { method:'DELETE' });
        activeDelivery = await api(`/api/upcoming-deliveries/${activeDelivery.id}`); renderDelivery(); await reloadDeliveries(); toast('Produkt usunięto z dostawy.');
      }
    } catch (error) { toast(error.message); }
  };
  document.addEventListener('click', event => { const button = event.target.closest('[data-close]'); if (button) document.getElementById(button.dataset.close)?.close(); });
  loadAll().catch(error => { toast(error.message); if (/dostępu|uprawnień/i.test(error.message)) setTimeout(() => location.replace('/magazyn.html'), 1800); });
})();
