(() => {
  const section = document.querySelector('#inventoryOverview');
  const tables = document.querySelector('#inventoryTables');
  const search = document.querySelector('#inventorySearch');
  let activeSort = null;
  let expandedCategories = new Set();
  const escTable = value => String(value || '').replace(/[&<>]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[character]));
  const dateTable = value => value ? new Intl.DateTimeFormat('pl-PL').format(new Date(`${value}T12:00:00`)) : '—';
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL');
  const productBrand = item => item.brand || (item.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const weight = item => item.weight_value ? `${item.weight_value} ${item.weight_unit}` : '—';
  const weightComparable = item => {
    const value = Number(item.weight_value) || 0;
    const unit = String(item.weight_unit || '').toLowerCase();
    return unit === 'kg' || unit === 'l' ? value * 1000 : value;
  };
  const categoryTone = category => {
    const colors = ['#eef6ef', '#eef4fa', '#fff4e9', '#f8eff8', '#fdf0f0', '#f1f6e8', '#eef3f2', '#fff8df'];
    return colors[[...String(category)].reduce((sum, character) => sum + character.charCodeAt(0), 0) % colors.length];
  };
  const barcodeMark = item => item.barcode
    ? '<span class="barcode-state barcode-yes" title="Kod kreskowy zapisany" aria-label="Kod kreskowy zapisany">✓</span>'
    : '<span class="barcode-state barcode-no" title="Brak kodu kreskowego" aria-label="Brak kodu kreskowego">×</span>';
  const sortLabel = { name:'Produkt', brand:'Firma', weight:'Gramatura', quantity:'Stan', expiration:'Termin ważności' };

  function sortRows(rows) {
    if (!activeSort) return rows.slice().sort((a, b) => a.name.localeCompare(b.name, 'pl'));
    const { field, direction } = activeSort;
    const compare = (a, b) => {
      if (field === 'name') return a.name.localeCompare(b.name, 'pl');
      if (field === 'brand') return productBrand(a).localeCompare(productBrand(b), 'pl');
      if (field === 'weight') return weightComparable(a) - weightComparable(b);
      if (field === 'quantity') return Number(a.quantity) - Number(b.quantity);
      return (a.expiration_date || '9999-12-31').localeCompare(b.expiration_date || '9999-12-31');
    };
    return rows.slice().sort((a, b) => direction === 'desc' ? -compare(a, b) : compare(a, b));
  }

  function sortHeader(field) {
    const direction = activeSort?.field === field ? (activeSort.direction === 'desc' ? ' ↓' : ' ↑') : '';
    return `<button type="button" class="table-sort ${activeSort?.field === field ? 'is-active' : ''}" data-overview-sort="${field}">${sortLabel[field]}${direction}</button>`;
  }

  function rowsMarkup(group) {
    return group.rows.map(item => `<tr class="${Number(item.quantity) === 0 ? 'empty-stock' : ''}" data-overview-product="${item.id}">
      ${group.global ? `<td>${escTable(item.category)}</td>` : ''}
      <td><strong>${escTable(item.name)}</strong></td>
      <td>${escTable(productBrand(item))}</td>
      <td>${escTable(weight(item))}</td>
      <td><b>${escTable(item.quantity)} ${escTable(item.unit)}</b></td>
      <td>${escTable(dateTable(item.expiration_date))}</td>
      <td class="barcode-cell">${barcodeMark(item)}</td>
      <td><button type="button" class="small-btn table-edit" data-overview-edit="${item.id}">Edytuj</button></td>
    </tr>`).join('');
  }

  function renderOverview() {
    if (section.hidden) return;
    const query = normalize(search.value).trim();
    const items = all.filter(item => !query || normalize(`${item.name} ${item.category} ${productBrand(item)} ${weight(item)} ${item.barcode || ''}`).includes(query));
    const categories = activeSort
      ? [{ name: `Wszystkie produkty — ${sortLabel[activeSort.field].toLocaleLowerCase('pl-PL')}`, rows:sortRows(items), global:true }]
      : [...new Set(items.map(item => item.category))].sort((a, b) => a.localeCompare(b, 'pl')).map(category => ({ name:category, rows:sortRows(items.filter(item => item.category === category)), global:false }));
    tables.innerHTML = categories.map(group => {
      const isOpen = group.global || expandedCategories.has(group.name);
      return `<article class="inventory-table-card ${isOpen ? 'is-expanded' : 'is-collapsed'}" style="--category-tint:${categoryTone(group.name)}">
        <button type="button" class="inventory-category-toggle" data-overview-category="${escTable(group.name)}" aria-expanded="${isOpen}">
          <span><b>${escTable(group.name)}</b> <small>${group.rows.length} ${group.rows.length === 1 ? 'produkt' : 'produktów'}</small></span>
          <span class="inventory-toggle-label">${isOpen ? 'Zwiń' : 'Rozwiń'} <i>${isOpen ? '⌃' : '⌄'}</i></span>
        </button>
        <div class="inventory-table-wrap" ${isOpen ? '' : 'hidden'}><table><thead><tr>
          ${group.global ? '<th>Kategoria</th>' : ''}<th>${sortHeader('name')}</th><th>${sortHeader('brand')}</th><th>${sortHeader('weight')}</th><th>${sortHeader('quantity')}</th><th>${sortHeader('expiration')}</th><th title="Kod kreskowy">Kod</th><th></th>
        </tr></thead><tbody>${rowsMarkup(group)}</tbody></table></div>
      </article>`;
    }).join('') || '<p class="demand-status">Nie znaleziono produktów pasujących do wyszukiwania.</p>';
  }

  document.querySelector('#showInventory').addEventListener('click', () => {
    activeSort = null;
    expandedCategories = new Set();
    section.hidden = false;
    renderOverview();
    section.scrollIntoView({ behavior:'smooth', block:'start' });
  });
  document.querySelector('#hideInventory').addEventListener('click', () => { section.hidden = true; });
  search.addEventListener('input', renderOverview);
  tables.addEventListener('click', event => {
    const category = event.target.closest('[data-overview-category]');
    if (category) {
      const name = category.dataset.overviewCategory;
      if (expandedCategories.has(name)) expandedCategories.delete(name); else expandedCategories.add(name);
      renderOverview();
      return;
    }
    const sort = event.target.closest('[data-overview-sort]');
    if (sort) {
      const field = sort.dataset.overviewSort;
      if (activeSort?.field !== field) activeSort = { field, direction: field === 'weight' || field === 'quantity' ? 'desc' : 'asc' };
      else if (field === 'quantity' && activeSort.direction === 'desc') activeSort = { field, direction:'asc' };
      else activeSort = null;
      renderOverview();
      return;
    }
    const button = event.target.closest('[data-overview-edit]');
    if (button) { openEdit(Number(button.dataset.overviewEdit)); return; }
    const row = event.target.closest('[data-overview-product]');
    if (row) window.openProductDetails?.(Number(row.dataset.overviewProduct));
  });
  document.addEventListener('inventory:loaded', renderOverview);
})();
