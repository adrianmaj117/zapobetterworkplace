/* Partie dostaw: ten plik rozszerza widok magazynu bez zmiany sposobu pracy. */
(() => {
  const clean = value => String(value ?? '').trim().toLocaleLowerCase('pl-PL');
  const cleanCode = value => String(value || '').trim().replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
  const today = () => new Date().toISOString().slice(0, 10);

  function productWeight(product) {
    return product.weight_value ? `${product.weight_value} ${product.weight_unit}` : 'Bez gramatury';
  }

  function productBrand(product) {
    return product.brand || (product.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  }

  function findExistingDelivery(payload) {
    const barcode = cleanCode(payload.barcode);
    if (barcode) {
      const coded = all.find(product => cleanCode(product.barcode) === barcode);
      if (coded) return coded;
    }
    return all.find(product =>
      clean(product.name) === clean(payload.name) &&
      clean(product.category) === clean(payload.category) &&
      clean(productBrand(product)) === clean(payload.brand || (payload.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe')) &&
      Number(product.weight_value || 0) === Number(payload.weight_value || 0) &&
      clean(product.weight_unit) === clean(payload.weight_unit) &&
      clean(product.unit) === clean(payload.unit)
    );
  }

  async function addDeliveryFromForm(event) {
    event.preventDefault();
    event.stopImmediatePropagation();
    const photo = document.querySelector('#photo').files[0];
    const payload = {
      name: document.querySelector('#name').value,
      category: document.querySelector('#category').value,
      brand: document.querySelector('#brand').value,
      quantity: Number(document.querySelector('#quantity').value),
      unit: 'szt.',
      weight_value: Number(document.querySelector('#weightValue').value) || null,
      weight_unit: document.querySelector('#weightUnit').value || null,
      received_date: document.querySelector('#received').value || null,
      expiration_date: document.querySelector('#expiry').value || null,
      barcode: document.querySelector('#barcode').value || ''
    };
    try {
      if (clean(payload.category).includes('nabiał') && !payload.expiration_date) {
        const continueWithoutDate = confirm('Nabiał powinien mieć wpisany termin ważności. Czy na pewno chcesz dodać dostawę bez daty?');
        if (!continueWithoutDate) return;
      }
      const existing = findExistingDelivery(payload);
      if (existing) {
        const proceed = confirm(`„${existing.name}” jest już w magazynie. Dodać ${payload.quantity} ${existing.unit} jako nową partię z osobnym terminem ważności?`);
        if (!proceed) return;
        await api(`/api/products/${existing.id}/batches`, {
          method: 'POST',
          body: JSON.stringify({
            quantity: payload.quantity,
            expiration_date: payload.expiration_date,
            received_date: payload.received_date
          })
        });
        if (photo) {
          await api(`/api/products/${existing.id}/image`, {
            method: 'POST', body: JSON.stringify({ image_data: await read(photo) })
          });
        }
      } else {
        await api('/api/products', {
          method: 'POST',
          body: JSON.stringify({ ...payload, image_data: photo ? await read(photo) : null, min_quantity: 0, notes: '' })
        });
      }
      document.querySelector('#addDialog').close();
      await load();
    } catch (error) {
      alert(error.message);
    }
  }

  // Przechwytujemy zapis dostawy przed starszym formularzem, aby przy zgodnym
  // artykule dodać nową partię, a nie tworzyć drugi, taki sam kafelek produktu.
  document.querySelector('#addForm').addEventListener('submit', addDeliveryFromForm, true);

  async function openDeliveryForProduct(id) {
    const product = all.find(item => Number(item.id) === Number(id));
    if (!product) return;
    document.querySelector('#add').click();
    let attempts = 0;
    const fill = () => {
      const dialog = document.querySelector('#addDialog');
      if (!dialog.open) {
        if (attempts++ < 80) setTimeout(fill, 30);
        return;
      }
      document.querySelector('#category').value = product.category;
      document.querySelector('#category').dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#brand').value = product.brand || '';
      document.querySelector('#name').value = product.name;
      document.querySelector('#weightValue').value = product.weight_value || '';
      document.querySelector('#weightUnit').value = product.weight_unit || 'g';
      document.querySelector('#barcode').value = product.barcode || '';
      document.querySelector('#quantity').value = '';
      document.querySelector('#received').value = today();
      document.querySelector('#expiry').value = '';
      document.querySelector('#quantity').focus();
    };
    fill();
  }
  window.openDeliveryForProduct = openDeliveryForProduct;

  function batchDate(value, fallback) {
    return value ? date(value) : fallback;
  }

  async function renderBatches() {
    if (!state || state.level !== 'products') return;
    const branchProducts = all.filter(product =>
      product.category === state.category && productBrand(product) === state.brand && productWeight(product) === state.weight
    );
    const cards = [...document.querySelectorAll('.product-card')];
    await Promise.all(cards.map(async (card, index) => {
      const product = branchProducts[index];
      if (!product || card.querySelector('.product-batches')) return;
      let batches = [];
      try { batches = await api(`/api/products/${product.id}/batches`); } catch (_) { return; }
      const active = batches.filter(batch => Number(batch.quantity) > 0).sort((a, b) => {
        if (!a.expiration_date && !b.expiration_date) return 0;
        if (!a.expiration_date) return 1;
        if (!b.expiration_date) return -1;
        return a.expiration_date.localeCompare(b.expiration_date);
      });
      const section = document.createElement('section');
      section.className = 'product-batches';
      const rows = active.length ? active.map(batch => `
        <div class="batch-row">
          <span><b>Termin: ${esc(batchDate(batch.expiration_date, 'brak daty'))}</b><small>Przyjęto: ${esc(batchDate(batch.received_date, 'brak daty'))}</small></span>
          <strong>${batch.quantity} <small>${esc(product.unit)}</small></strong>
        </div>`).join('') : '<p class="batch-empty">Brak zapisanych partii.</p>';
      section.innerHTML = `<div class="batch-heading"><b>Partie dostawy (${active.length})</b><button type="button" class="small-btn" data-batch-add="${product.id}">＋ Nowa partia</button></div><div class="batch-list">${rows}</div>`;
      const detailsTarget = card.querySelector('div:nth-child(2)');
      detailsTarget?.append(section);
    }));
  }

  document.addEventListener('inventory:loaded', () => { renderBatches(); });
  setTimeout(renderBatches, 300);

  document.addEventListener('click', event => {
    const delivery = event.target.closest('[data-batch-add], [data-delivery-add]');
    if (!delivery) return;
    event.preventDefault();
    event.stopPropagation();
    openDeliveryForProduct(delivery.dataset.batchAdd || delivery.dataset.deliveryAdd);
  });

  // Przy wyszukiwaniu kodem kreskowym można od razu przejść do nowej dostawy.
  const barcodeResult = document.querySelector('#barcodeResult');
  if (barcodeResult) {
    new MutationObserver(() => {
      const open = barcodeResult.querySelector('[data-open-product]');
      if (!open || barcodeResult.querySelector('[data-delivery-add]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'small-btn';
      button.dataset.deliveryAdd = open.dataset.openProduct;
      button.textContent = '＋ Dodaj dostawę';
      open.insertAdjacentElement('afterend', button);
    }).observe(barcodeResult, { childList: true, subtree: true });
  }
})();
