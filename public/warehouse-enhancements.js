/* Usprawnienia głównego widoku: terminy, skaner USB i proste przenoszenie kategorii. */
(() => {
  'use strict';
  const nearestBox = document.querySelector('#nearest');
  const nearestTitle = nearestBox?.previousElementSibling;
  const hiddenKey = 'zapo-hidden-nearest-v1';
  const limitKey = 'zapo-nearest-limit-v1';
  let hiddenNearest = new Set(JSON.parse(localStorage.getItem(hiddenKey) || '[]').map(Number));
  let nearestLimit = Number(localStorage.getItem(limitKey) || 10);

  function persistHidden() { localStorage.setItem(hiddenKey, JSON.stringify([...hiddenNearest])); }
  function photoFor(product) {
    return productImages[product.id] && productImages[product.id] !== 'loading'
      ? productImages[product.id]
      : images[`category:${product.category}`] || 'assets/category-foods.png';
  }

  if (nearestBox && nearestTitle) {
    const header = document.createElement('div');
    header.className = 'nearest-heading';
    nearestTitle.before(header); header.append(nearestTitle);
    header.insertAdjacentHTML('beforeend', `<div class="nearest-controls"><label>Pokaż<select id="nearestLimit"><option value="3">3</option><option value="5">5</option><option value="10">10</option></select></label><button type="button" id="showHiddenNearest" class="small-btn" hidden>Pokaż ukryte</button></div>`);
    const select = document.querySelector('#nearestLimit');
    select.value = [3, 5, 10].includes(nearestLimit) ? String(nearestLimit) : '10';
    nearestLimit = Number(select.value);

    nearest = function renderNearestEnhanced() {
      const products = all
        .filter(product => Number(product.quantity || 0) > 0 && product.expiration_date && !hiddenNearest.has(Number(product.id)))
        .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date) || a.name.localeCompare(b.name, 'pl'))
        .slice(0, nearestLimit);
      nearestBox.innerHTML = products.length ? products.map(product => `<article class="nearest-card" data-nearest-id="${product.id}">
        <div class="nearest-product-image" style="background-image:url('${photoFor(product)}')"></div>
        <div><p>${esc(product.category)}</p><h3>${esc(product.name)}</h3><p><b>${date(product.expiration_date)}</b> · ${product.quantity} ${esc(product.unit)}</p></div>
        <button type="button" class="nearest-hide" data-hide-nearest="${product.id}" title="Ukryj ten produkt z listy">Ukryj</button>
      </article>`).join('') : '<p class="nearest-empty">Brak produktów na stanie z zapisanym terminem ważności.</p>';
      products.forEach(fetchProductImage);
      document.querySelector('#showHiddenNearest').hidden = hiddenNearest.size === 0;
    };
    select.addEventListener('change', () => { nearestLimit = Number(select.value); localStorage.setItem(limitKey, String(nearestLimit)); nearest(); });
    document.querySelector('#showHiddenNearest').addEventListener('click', () => { hiddenNearest.clear(); persistHidden(); nearest(); });
    nearestBox.addEventListener('click', event => {
      const hide = event.target.closest('[data-hide-nearest]');
      if (hide) { event.stopPropagation(); hiddenNearest.add(Number(hide.dataset.hideNearest)); persistHidden(); nearest(); return; }
      const card = event.target.closest('[data-nearest-id]');
      if (card) { event.stopPropagation(); window.openProductDetails?.(Number(card.dataset.nearestId)); }
    });
    nearest();
  }

  // Przenoszenie produktu zachowuje firmę i gramaturę. Operator wybiera tylko kategorię.
  const moveDialog = document.querySelector('#productMoveDialog');
  const moveForm = document.querySelector('#productMoveForm');
  const brandField = document.querySelector('#moveProductBrand')?.closest('label');
  const weightField = document.querySelector('#moveProductWeight')?.closest('label');
  if (moveDialog && moveForm) {
    if (brandField) brandField.hidden = true;
    if (weightField) weightField.hidden = true;
    document.querySelector('#moveProductBrand')?.removeAttribute('required');
    document.querySelector('#moveProductWeight')?.removeAttribute('required');
    // Usuń starszą obsługę formularza, która nadal wymagała firmy i gramatury.
    moveForm.onsubmit = null;
    const help = moveDialog.querySelector('.path-help');
    if (help) help.textContent = 'Wybierz tylko nową kategorię. Firma i gramatura produktu pozostaną bez zmian.';
    moveForm.addEventListener('submit', async event => {
      event.preventDefault(); event.stopImmediatePropagation();
      const category = document.querySelector('#moveProductCategory').value;
      const ids = typeof selectedProducts !== 'undefined' ? [...selectedProducts] : [];
      const source = typeof productToMove !== 'undefined' ? productToMove : null;
      if (!category || (!source && !ids.length)) return;
      try {
        if (typeof batchMove !== 'undefined' && batchMove && ids.length) {
          await api('/api/products/bulk-move-category', { method:'POST', body:JSON.stringify({ ids, category }) });
          batchMove = false; selectedProducts.clear(); if (typeof refreshBulkBar === 'function') refreshBulkBar();
        } else {
          await api(`/api/products/${source.id}/move-category`, { method:'POST', body:JSON.stringify({ category }) });
        }
        moveDialog.close(); await load();
      } catch (error) { alert(error.message); }
    }, true);
  }

  // Stacjonarny skaner USB działa również na pustym ekranie głównym.
  let buffer = '', lastKeyAt = 0, clearTimer;
  document.addEventListener('keydown', async event => {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (document.querySelector('dialog[open]') || document.activeElement?.matches('input,textarea,select,[contenteditable="true"]')) return;
    const now = Date.now();
    if (now - lastKeyAt > 130) buffer = '';
    lastKeyAt = now;
    if (event.key === 'Enter') {
      const code = buffer; buffer = '';
      if (clearTimer) clearTimeout(clearTimer);
      if (code.length < 6) return;
      event.preventDefault();
      try {
        const binding = await api(`/api/barcodes/${encodeURIComponent(code)}`);
        const product = all.find(item => Number(item.id) === Number(binding.id)) || binding;
        window.openProductDetails?.(Number(product.id));
      } catch (_) {
        window.showAppAlert?.(`Nie znaleziono produktu z kodem ${code}.`, { title:'Nieznany kod' });
      }
      return;
    }
    if (!/^[0-9A-Za-z-]$/.test(event.key)) return;
    buffer += event.key;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { buffer = ''; }, 280);
  }, true);
})();
