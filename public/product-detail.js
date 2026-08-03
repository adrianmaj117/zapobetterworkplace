/* Duży widok pojedynczego artykułu wraz z historią dostaw. */
(() => {
  const dialog = document.querySelector('#productDetailDialog');
  const content = document.querySelector('#productDetailContent');
  const batchesBox = document.querySelector('#productBatchHistory');
  const movementsBox = document.querySelector('#productMovementHistory');
  let shownId = 0;
  const escapeHtml = value => String(value || '').replace(/[&<>]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[character]));
  const productBrand = product => product.brand || (product.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const productWeight = product => product.weight_value ? `${product.weight_value} ${product.weight_unit}` : 'bez gramatury';
  const labelForMovement = type => ({ add:'Dostawa / dodanie', remove:'Odjęcie', demand:'Zapotrzebowanie', adjustment:'Korekta stanu' }[type] || type);

  async function openProductDetails(id) {
    const product = all.find(item => Number(item.id) === Number(id));
    if (!product) return;
    shownId = product.id;
    dialog.showModal();
    content.innerHTML = '<p class="detail-loading">Wczytuję produkt…</p>';
    batchesBox.innerHTML = '';
    movementsBox.innerHTML = '';
    try {
      const [image, batches, movements] = await Promise.all([
        api(`/api/products/${product.id}/image`),
        api(`/api/products/${product.id}/batches`),
        api(`/api/products/${product.id}/movements`)
      ]);
      const imageSrc = image.image_data || 'assets/category-foods.png';
      content.innerHTML = `<article class="product-detail-main">
        <img src="${imageSrc}" alt="${escapeHtml(product.name)}">
        <div><p>${escapeHtml(product.category)} · ${escapeHtml(productBrand(product))} · ${escapeHtml(productWeight(product))}</p>
          <h2>${escapeHtml(product.name)}</h2>
          <div class="detail-stock"><strong>${product.quantity}</strong><span>${escapeHtml(product.unit)}</span></div>
          <p>Najbliższy termin: <b>${product.expiration_date ? date(product.expiration_date) : 'brak daty'}</b></p>
          <p>Ostatnie przyjęcie: <b>${product.received_date ? date(product.received_date) : 'brak daty'}</b></p>
        </div>
      </article>`;
      batchesBox.innerHTML = batches.length ? batches.map(batch => `<article class="detail-history-row ${Number(batch.quantity) <= 0 ? 'is-empty-batch' : ''}"><span><b>${batch.expiration_date ? `Termin: ${date(batch.expiration_date)}` : 'Termin: brak daty'}</b><small>Przyjęto: ${batch.received_date ? date(batch.received_date) : 'brak daty'} · zapisano: ${date(batch.created_at)}</small></span><strong>${batch.quantity} <small>${escapeHtml(product.unit)}</small></strong></article>`).join('') : '<p class="detail-empty">Nie ma jeszcze zapisanych partii.</p>';
      movementsBox.innerHTML = movements.length ? movements.map(move => `<article class="detail-history-row"><span><b>${escapeHtml(labelForMovement(move.type))}</b><small>${date(move.movement_date)}${move.note ? ` · ${escapeHtml(move.note)}` : ''}</small></span><strong>${move.quantity} <small>${escapeHtml(product.unit)}</small></strong></article>`).join('') : '<p class="detail-empty">Brak zmian stanu.</p>';
    } catch (error) {
      content.innerHTML = `<p class="detail-empty">${escapeHtml(error.message)}</p>`;
    }
  }
  window.openProductDetails = openProductDetails;

  document.querySelector('#products').addEventListener('click', event => {
    const card = event.target.closest('.product-card');
    if (!card || event.target.closest('button, input, label, a')) return;
    const id = card.querySelector('[data-edit]')?.dataset.edit;
    if (id) openProductDetails(id);
  });
  ['closeProductDetail', 'closeProductDetailBottom'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.close()));
  document.querySelector('#editDetailProduct').addEventListener('click', () => {
    if (!shownId) return;
    dialog.close();
    openEdit(shownId);
  });
  document.querySelector('#addDetailDelivery').addEventListener('click', () => {
    if (!shownId) return;
    dialog.close();
    window.openDeliveryForProduct?.(shownId);
  });
})();
