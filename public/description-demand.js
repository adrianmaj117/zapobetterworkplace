/* Zapotrzebowanie z wklejonego opisu: każdy wiersz jest zawsze możliwy do poprawienia przed odjęciem. */
(() => {
  const dialog = document.querySelector('#demandTextDialog');
  const input = document.querySelector('#demandTextInput');
  const status = document.querySelector('#demandTextStatus');
  const preview = document.querySelector('#demandTextPreview');
  const rows = document.querySelector('#demandTextRows');
  const apply = document.querySelector('#applyDemandText');
  const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  const normalize = value => String(value || '').toLocaleLowerCase('pl-PL').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const productBrand = item => item.brand || (item.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const productSize = item => item.weight_value ? `${item.weight_value} ${item.weight_unit}` : 'bez gramatury';
  const productLabel = item => `${item.name} — ${productBrand(item)} · ${productSize(item)} (stan: ${item.quantity} ${item.unit})`;
  const productOptions = selected => {
    const categories = [...new Set(all.map(item => item.category))].sort((a, b) => a.localeCompare(b, 'pl'));
    return `<option value="">Dopasuj produkt z magazynu…</option>${categories.map(category => `<optgroup label="${escapeHtml(category)}">${all.filter(item => item.category === category).sort((a, b) => a.name.localeCompare(b.name, 'pl')).map(item => `<option value="${item.id}" ${Number(selected) === item.id ? 'selected' : ''}>${escapeHtml(productLabel(item))}</option>`).join('')}</optgroup>`).join('')}`;
  };
  function addRow(productId = '', quantity = '', source = '') {
    const row = document.createElement('div'); row.className = 'demand-row';
    row.innerHTML = `<input class="demand-raw" aria-label="Wiersz opisu" value="${escapeHtml(source)}" placeholder="Wiersz z opisu"><select class="demand-product" aria-label="Produkt">${productOptions(productId)}</select><input class="demand-quantity" aria-label="Ilość" type="number" min="0.01" step="any" value="${escapeHtml(quantity)}" placeholder="Ilość"><button type="button" class="demand-remove" title="Usuń pozycję" aria-label="Usuń pozycję">×</button>`;
    rows.append(row);
  }
  function score(line, item) {
    const text = normalize(line), name = normalize(item.name); if (!text || !name) return 0;
    if (text.includes(name)) return 100;
    const words = name.split(' ').filter(word => word.length > 2);
    return words.filter(word => text.includes(word)).length / Math.max(words.length, 1) * 80;
  }
  function quantityFrom(line) {
    const values = [...line.matchAll(/(?:^|\s)(\d+(?:[,.]\d+)?)(?:\s*(?:szt\.?|opak\.?|op\.?|x))?(?=\s|$)/gi)];
    return values.length ? Number(values[values.length - 1][1].replace(',', '.')) : '';
  }
  function buildPreview(text) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    rows.innerHTML = ''; let matched = 0;
    lines.forEach(line => {
      const best = all.map(item => ({ item, score:score(line, item) })).sort((a, b) => b.score - a.score)[0];
      const productId = best?.score >= 45 ? best.item.id : '';
      if (productId) matched += 1;
      addRow(productId, quantityFrom(line), line);
    });
    if (!lines.length) addRow();
    preview.hidden = false; apply.disabled = false;
    status.textContent = lines.length ? `Odczytano ${lines.length} ${lines.length === 1 ? 'wiersz' : 'wierszy'} od góry do dołu. Dopasowano automatycznie: ${matched}. Popraw każdą pozycję przed zatwierdzeniem.` : 'Wklej przynajmniej jeden wiersz opisu.';
  }
  let timer;
  document.querySelector('#demandText').addEventListener('click', () => { input.value = ''; rows.innerHTML = ''; preview.hidden = true; apply.disabled = true; status.textContent = 'Wklej opis, aby rozpocząć.'; document.querySelector('#demandTextDate').value = localDate(); document.querySelector('#demandTextPassword').value = ''; dialog.showModal(); input.focus(); });
  ['closeDemandText', 'cancelDemandText'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.close()));
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => buildPreview(input.value), 250); });
  document.querySelector('#addDemandTextRow').addEventListener('click', () => addRow());
  rows.addEventListener('click', event => { if (event.target.closest('.demand-remove')) event.target.closest('.demand-row').remove(); });
  document.querySelector('#demandTextForm').addEventListener('submit', async event => {
    event.preventDefault();
    const items = [...rows.querySelectorAll('.demand-row')].map(row => ({ product_id:Number(row.querySelector('.demand-product').value), quantity:Number(row.querySelector('.demand-quantity').value) })).filter(item => Number.isInteger(item.product_id) && Number.isFinite(item.quantity) && item.quantity > 0);
    if (!items.length) return alert('Wybierz przynajmniej jeden produkt i podaj jego ilość.');
    const password = document.querySelector('#demandTextPassword').value; if (!password) return alert('Wpisz hasło zatwierdzające.');
    if (!confirm(`Odjąć ze stanów ${items.length} ${items.length === 1 ? 'pozycję' : 'pozycje'}?`)) return;
    apply.disabled = true;
    try {
      const result = await api('/api/demand/apply', { method:'POST', body:JSON.stringify({ items, password, demand_date:document.querySelector('#demandTextDate').value, source_name:'Opis ręczny zapotrzebowania', recognized_text:input.value }) });
      dialog.close(); alert(`Zapotrzebowanie zatwierdzone. Odjęto ${result.applied} ${result.applied === 1 ? 'produkt' : 'produkty'}.`); await load();
    } catch (error) { alert(error.message); } finally { apply.disabled = false; }
  });
})();
