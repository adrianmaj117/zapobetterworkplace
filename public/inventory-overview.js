(() => {
  const section = document.querySelector('#inventoryOverview');
  const tables = document.querySelector('#inventoryTables');
  const search = document.querySelector('#inventorySearch');
  let expiryOrder = '';
  const escTable = value => String(value || '').replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
  const dateTable = value => value ? new Intl.DateTimeFormat('pl-PL').format(new Date(`${value}T12:00:00`)) : '—';
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL');
  const productBrand = item => item.brand || (item.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const weight = item => item.weight_value ? `${item.weight_value} ${item.weight_unit}` : '—';
  function renderOverview() {
    if (section.hidden) return;
    const query = normalize(search.value).trim();
    const items = all.filter(item => !query || normalize(`${item.name} ${item.category} ${productBrand(item)} ${weight(item)}`).includes(query));
    const dateSort = (a,b) => { const first=a.expiration_date||'9999-12-31', second=b.expiration_date||'9999-12-31'; return expiryOrder === 'desc' ? second.localeCompare(first) : first.localeCompare(second); };
    const categories = expiryOrder ? [{ name:`Wszystkie produkty — terminy ${expiryOrder === 'asc' ? 'od najkrótszego' : 'od najdłuższego'}`, rows:items.slice().sort(dateSort), global:true }] : [...new Set(items.map(item => item.category))].sort((a,b) => a.localeCompare(b, 'pl')).map(category => ({ name:category, rows:items.filter(item => item.category === category).sort((a,b) => a.name.localeCompare(b.name, 'pl')), global:false }));
    const dateHeading = expiryOrder === 'asc' ? 'Termin ważności ↑' : expiryOrder === 'desc' ? 'Termin ważności ↓' : 'Termin ważności';
    tables.innerHTML = categories.map(group => `<article class="inventory-table-card"><h3>${escTable(group.name)} <small>${group.rows.length} ${group.rows.length === 1 ? 'produkt' : 'produktów'}</small></h3><div class="inventory-table-wrap"><table><thead><tr>${group.global ? '<th>Kategoria</th>' : ''}<th>Produkt</th><th>Firma</th><th>Gramatura</th><th>Stan</th><th><button type="button" class="table-sort" data-overview-sort>${dateHeading}</button></th><th></th></tr></thead><tbody>${group.rows.map(item => `<tr class="${Number(item.quantity) === 0 ? 'empty-stock' : ''}">${group.global ? `<td>${escTable(item.category)}</td>` : ''}<td><strong>${escTable(item.name)}</strong></td><td>${escTable(productBrand(item))}</td><td>${escTable(weight(item))}</td><td><b>${escTable(item.quantity)} ${escTable(item.unit)}</b></td><td>${escTable(dateTable(item.expiration_date))}</td><td><button type="button" class="small-btn table-edit" data-overview-edit="${item.id}">Edytuj</button></td></tr>`).join('')}</tbody></table></div></article>`).join('') || '<p class="demand-status">Nie znaleziono produktów pasujących do wyszukiwania.</p>';
  }
  document.querySelector('#showInventory').addEventListener('click', () => { section.hidden = false; renderOverview(); section.scrollIntoView({ behavior:'smooth', block:'start' }); });
  document.querySelector('#hideInventory').addEventListener('click', () => { section.hidden = true; });
  search.addEventListener('input', renderOverview);
  tables.addEventListener('click', event => { const sort = event.target.closest('[data-overview-sort]'); if (sort) { expiryOrder = expiryOrder === 'asc' ? 'desc' : 'asc'; renderOverview(); return; } const button = event.target.closest('[data-overview-edit]'); if (button) openEdit(Number(button.dataset.overviewEdit)); });
  document.addEventListener('inventory:loaded', renderOverview);
})();
