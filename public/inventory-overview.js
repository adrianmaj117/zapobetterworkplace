(() => {
  const section = document.querySelector('#inventoryOverview');
  const tables = document.querySelector('#inventoryTables');
  const search = document.querySelector('#inventorySearch');
  const escTable = value => String(value || '').replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));
  const dateTable = value => value ? new Intl.DateTimeFormat('pl-PL').format(new Date(`${value}T12:00:00`)) : '—';
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL');
  const productBrand = item => item.brand || (item.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const weight = item => item.weight_value ? `${item.weight_value} ${item.weight_unit}` : '—';
  function renderOverview() {
    if (section.hidden) return;
    const query = normalize(search.value).trim();
    const items = all.filter(item => !query || normalize(`${item.name} ${item.category} ${productBrand(item)} ${weight(item)}`).includes(query));
    const categories = [...new Set(items.map(item => item.category))].sort((a,b) => a.localeCompare(b, 'pl'));
    tables.innerHTML = categories.map(category => {
      const rows = items.filter(item => item.category === category).sort((a,b) => a.name.localeCompare(b.name, 'pl'));
      return `<article class="inventory-table-card"><h3>${escTable(category)} <small>${rows.length} ${rows.length === 1 ? 'produkt' : 'produktów'}</small></h3><div class="inventory-table-wrap"><table><thead><tr><th>Produkt</th><th>Firma</th><th>Gramatura</th><th>Stan</th><th>Termin ważności</th><th></th></tr></thead><tbody>${rows.map(item => `<tr class="${Number(item.quantity) === 0 ? 'empty-stock' : ''}"><td><strong>${escTable(item.name)}</strong></td><td>${escTable(productBrand(item))}</td><td>${escTable(weight(item))}</td><td><b>${escTable(item.quantity)} ${escTable(item.unit)}</b></td><td>${escTable(dateTable(item.expiration_date))}</td><td><button type="button" class="small-btn table-edit" data-overview-edit="${item.id}">Edytuj</button></td></tr>`).join('')}</tbody></table></div></article>`;
    }).join('') || '<p class="demand-status">Nie znaleziono produktów pasujących do wyszukiwania.</p>';
  }
  document.querySelector('#showInventory').addEventListener('click', () => { section.hidden = false; renderOverview(); section.scrollIntoView({ behavior:'smooth', block:'start' }); });
  document.querySelector('#hideInventory').addEventListener('click', () => { section.hidden = true; });
  search.addEventListener('input', renderOverview);
  tables.addEventListener('click', event => { const button = event.target.closest('[data-overview-edit]'); if (button) openEdit(Number(button.dataset.overviewEdit)); });
  document.addEventListener('inventory:loaded', renderOverview);
})();
