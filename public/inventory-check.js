/* Spis z natury — porównanie stanu systemowego z faktycznie policzonym. */
(() => {
  'use strict';
  const dialog = document.querySelector('#inventoryCheckDialog');
  const list = document.querySelector('#inventoryCheckList');
  const search = document.querySelector('#inventoryCheckSearch');
  const summary = document.querySelector('#inventoryCheckSummary');
  if (!dialog || !list) return;

  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const counted = new Map();

  function productRows() {
    const query = normalize(search.value.trim());
    return all.filter(product => !query || normalize(`${product.name} ${product.category} ${product.brand || ''}`).includes(query))
      .sort((a, b) => a.category.localeCompare(b.category, 'pl') || a.name.localeCompare(b.name, 'pl'));
  }
  function render() {
    const groups = new Map();
    productRows().forEach(product => { if (!groups.has(product.category)) groups.set(product.category, []); groups.get(product.category).push(product); });
    list.innerHTML = [...groups].map(([category, products]) => `<section class="inventory-check-group"><h3>${esc(category)} <small>${products.length}</small></h3>${products.map(product => {
      const physical = counted.has(product.id) ? counted.get(product.id) : '';
      const difference = physical === '' ? '' : Number(physical) - Number(product.quantity || 0);
      return `<label class="inventory-check-row" data-check-id="${product.id}"><span><b>${esc(product.name)}</b><small>${esc(product.brand || 'Pozostałe')} · ${product.weight_value ? `${product.weight_value} ${esc(product.weight_unit)}` : 'bez gramatury'}</small></span><span class="inventory-system">System: <b>${product.quantity} ${esc(product.unit)}</b></span><input type="number" min="0" step="any" inputmode="decimal" value="${physical}" placeholder="Stan fizyczny" aria-label="Stan fizyczny ${esc(product.name)}"><strong class="inventory-difference ${difference < 0 ? 'is-minus' : difference > 0 ? 'is-plus' : ''}">${difference === '' ? '—' : `${difference > 0 ? '+' : ''}${difference}`}</strong></label>`;
    }).join('')}</section>`).join('') || '<p class="inventory-check-empty">Nie znaleziono produktów.</p>';
    updateSummary();
  }
  function updateSummary() {
    const entries = [...counted].map(([id, physical]) => ({ product:all.find(item => Number(item.id) === Number(id)), physical:Number(physical) })).filter(entry => entry.product && Number.isFinite(entry.physical));
    const changed = entries.filter(entry => entry.physical !== Number(entry.product.quantity || 0)).length;
    summary.textContent = entries.length ? `Policzono: ${entries.length} pozycji · różnice: ${changed}.` : 'Nie wpisano jeszcze stanów fizycznych.';
  }
  function open() { counted.clear(); search.value = ''; document.querySelector('#inventoryCheckNote').value = ''; render(); dialog.showModal(); }
  document.querySelector('#inventoryCheck').addEventListener('click', open);
  document.querySelector('#closeInventoryCheck').addEventListener('click', () => dialog.close());
  document.querySelector('#cancelInventoryCheck').addEventListener('click', () => dialog.close());
  search.addEventListener('input', render);
  list.addEventListener('input', event => {
    const row = event.target.closest('[data-check-id]'); if (!row || !event.target.matches('input')) return;
    const id = Number(row.dataset.checkId), value = event.target.value;
    if (value === '') counted.delete(id); else counted.set(id, Number(String(value).replace(',', '.')));
    const product = all.find(item => Number(item.id) === id);
    const difference = value === '' ? '' : Number(value) - Number(product?.quantity || 0);
    const output = row.querySelector('.inventory-difference');
    output.textContent = difference === '' ? '—' : `${difference > 0 ? '+' : ''}${difference}`;
    output.className = `inventory-difference ${difference < 0 ? 'is-minus' : difference > 0 ? 'is-plus' : ''}`;
    updateSummary();
  });
  document.querySelector('#saveInventoryCheck').addEventListener('click', async event => {
    const items = [...counted].filter(([, value]) => Number.isFinite(value) && value >= 0).map(([product_id, physical_quantity]) => ({ product_id, physical_quantity }));
    if (!items.length) return window.showAppAlert ? window.showAppAlert('Wpisz co najmniej jeden policzony stan.') : alert('Wpisz co najmniej jeden policzony stan.');
    if (window.showAppConfirm && !await window.showAppConfirm(`Zapisać spis ${items.length} pozycji i skorygować magazyn?`)) return;
    event.currentTarget.disabled = true; event.currentTarget.textContent = 'Zapisywanie…';
    try {
      await api('/api/inventory-checks', { method:'POST', body:JSON.stringify({ items, note:document.querySelector('#inventoryCheckNote').value }) });
      dialog.close(); await load();
      window.showAppAlert ? window.showAppAlert('Sprawdzanie zapisane. Stany magazynu zostały skorygowane.', { title:'Gotowe' }) : alert('Sprawdzanie zapisane.');
    } catch (error) { window.showAppAlert ? window.showAppAlert(error.message) : alert(error.message); }
    finally { event.currentTarget.disabled = false; event.currentTarget.textContent = 'Zapisz korekty'; }
  });
})();
