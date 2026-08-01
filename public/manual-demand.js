(() => {
  const picker = document.querySelector('#manualSelectDialog');
  const demandDialog = document.querySelector('#manualDemandDialog');
  const list = document.querySelector('#manualProductList');
  const selected = new Set();
  const imageCache = new Map();
  const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const escapeText = value => String(value || '').replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
  const productBrand = item => item.brand || (item.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const productWeight = item => item.weight_value ? `${item.weight_value} ${item.weight_unit}` : 'bez gramatury';
  const productText = item => `${item.name} · ${productBrand(item)} · ${productWeight(item)}`;
  function activeProducts() { return all.filter(item => selected.has(item.id)); }
  function refreshCount() { const count = selected.size; document.querySelector('#manualSelectionCount').textContent = `Zaznaczono: ${count} ${count === 1 ? 'produkt' : count < 5 ? 'produkty' : 'produktów'}`; document.querySelector('#manualSelectNext').disabled = !count; }
  function renderPicker() {
    const query = document.querySelector('#manualSearch').value.toLocaleLowerCase('pl-PL').trim();
    const products = all.slice().sort((a,b) => a.name.localeCompare(b.name, 'pl')).filter(item => !query || productText(item).toLocaleLowerCase('pl-PL').includes(query));
    list.innerHTML = products.map(item => `<label class="manual-select-row"><input type="checkbox" data-manual-select="${item.id}" ${selected.has(item.id) ? 'checked' : ''}><span><strong>${escapeText(item.name)}</strong><small>${escapeText(item.category)} · ${escapeText(productBrand(item))} · ${escapeText(productWeight(item))}</small></span><b>${escapeText(item.quantity)} ${escapeText(item.unit)}</b></label>`).join('') || '<p class="demand-status">Nie znaleziono produktów.</p>';
    refreshCount();
  }
  async function imageFor(item) {
    if (!item.has_image) return '';
    if (imageCache.has(item.id)) return imageCache.get(item.id);
    try { const result = await api(`/api/products/${item.id}/image`); imageCache.set(item.id, result.image_data || ''); return result.image_data || ''; } catch { return ''; }
  }
  async function renderDemandCards() {
    const cards = document.querySelector('#manualDemandCards'); const products = activeProducts();
    cards.innerHTML = '<p class="demand-status">Przygotowuję wybrane produkty…</p>';
    const images = await Promise.all(products.map(imageFor));
    cards.innerHTML = products.map((item, index) => `<article class="manual-demand-card"><div class="manual-product-image" style="${images[index] ? `background-image:url('${images[index]}')` : ''}"></div><div class="manual-product-info"><p>${escapeText(item.category)} · ${escapeText(productBrand(item))}</p><h3>${escapeText(item.name)}</h3><p>${escapeText(productWeight(item))}</p></div><div class="manual-stock">Na stanie<strong>${escapeText(item.quantity)} <small>${escapeText(item.unit)}</small></strong></div><label class="manual-quantity">Odjąć<input type="number" min="0" max="${escapeText(item.quantity)}" step="any" data-manual-quantity="${item.id}" placeholder="0"></label></article>`).join('');
  }
  function chosenItems() { return [...document.querySelectorAll('[data-manual-quantity]')].map(input => ({ product_id:Number(input.dataset.manualQuantity), quantity:Number(input.value) })).filter(item => Number.isInteger(item.product_id) && Number.isFinite(item.quantity) && item.quantity > 0); }
  function showSummary() {
    const items = chosenItems(); if (!items.length) return alert('Wpisz ilość większą od zera przy przynajmniej jednym produkcie.');
    const output = items.map(item => { const product=all.find(entry => entry.id === item.product_id); return `<article><strong>${escapeText(product.name)}</strong><span>${escapeText(productWeight(product))} · odjąć: <b>${item.quantity} ${escapeText(product.unit)}</b></span></article>`; }).join('');
    document.querySelector('#manualSummaryList').innerHTML = output;
    document.querySelector('#manualDemandEditor').hidden = true; document.querySelector('#manualDemandSummary').hidden = false; document.querySelector('#manualDemandPassword').value = '';
  }
  document.querySelector('#manualDemand').addEventListener('click', () => { selected.clear(); document.querySelector('#manualSearch').value = ''; renderPicker(); picker.showModal(); });
  ['closeManualSelect','cancelManualSelect'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => picker.close()));
  document.querySelector('#manualSearch').addEventListener('input', renderPicker);
  list.addEventListener('change', event => { const input = event.target.closest('[data-manual-select]'); if (!input) return; const id=Number(input.dataset.manualSelect); if (input.checked) selected.add(id); else selected.delete(id); refreshCount(); });
  document.querySelector('#manualSelectNext').addEventListener('click', async () => { picker.close(); document.querySelector('#manualDemandDate').value = localDate(); document.querySelector('#manualDemandEditor').hidden = false; document.querySelector('#manualDemandSummary').hidden = true; demandDialog.showModal(); await renderDemandCards(); });
  ['closeManualDemand'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => demandDialog.close()));
  document.querySelector('#backToManualSelect').addEventListener('click', () => { demandDialog.close(); renderPicker(); picker.showModal(); });
  document.querySelector('#manualShowSummary').addEventListener('click', showSummary);
  document.querySelector('#backToManualEditor').addEventListener('click', () => { document.querySelector('#manualDemandEditor').hidden = false; document.querySelector('#manualDemandSummary').hidden = true; });
  document.querySelector('#manualDemandForm').addEventListener('submit', async event => {
    event.preventDefault(); const items = chosenItems(), password = document.querySelector('#manualDemandPassword').value;
    if (!items.length) return alert('Brak produktów do odjęcia.'); if (!password) return alert('Wpisz hasło zatwierdzające.');
    if (!confirm(`Odjąć ze stanów ${items.length} ${items.length === 1 ? 'produkt' : 'produkty'} i zapisać raport w Historii dnia?`)) return;
    const button=document.querySelector('#applyManualDemand'); button.disabled=true;
    try { const result=await api('/api/demand/apply',{method:'POST',body:JSON.stringify({items,password,demand_date:document.querySelector('#manualDemandDate').value,source_name:'Zapotrzebowanie ręczne',recognized_text:items.map(item=>{const product=all.find(entry=>entry.id===item.product_id);return `${product.name} — ${item.quantity} ${product.unit}`}).join('\n')})}); demandDialog.close(); alert(`Zapisano ręczne zapotrzebowanie. Odjęto ${result.applied} ${result.applied === 1 ? 'produkt' : 'produkty'}.`); await load(); } catch(error) { alert(error.message); } finally { button.disabled=false; }
  });
})();
