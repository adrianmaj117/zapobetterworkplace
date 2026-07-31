/* Darmowe OCR działa w przeglądarce. Lista jest zawsze do poprawienia przed zapisem. */
(() => {
  const dialog = document.querySelector('#demandDialog');
  const fileInput = document.querySelector('#demandImage');
  const status = document.querySelector('#demandStatus');
  const preview = document.querySelector('#demandPreview');
  const rows = document.querySelector('#demandRows');
  const apply = document.querySelector('#applyDemand');
  let recognizedText = '';

  const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const label = item => `${item.name} — ${brand(item)} · ${size(item)} (stan: ${item.quantity} ${item.unit})`;
  const productOptions = selected => `<option value="">Wybierz produkt…</option>${all.slice().sort((a,b) => a.name.localeCompare(b.name, 'pl')).map(item => `<option value="${item.id}" ${Number(selected) === item.id ? 'selected' : ''}>${esc(label(item))}</option>`).join('')}`;

  function addRow(productId = '', quantity = '', note = '') {
    const row = document.createElement('div'); row.className = 'demand-row';
    row.innerHTML = `<select class="demand-product" aria-label="Produkt">${productOptions(productId)}</select><input class="demand-quantity" aria-label="Ilość" type="number" min="0.01" step="any" value="${esc(quantity)}" placeholder="Ilość"><button type="button" class="demand-remove" title="Usuń pozycję" aria-label="Usuń pozycję">×</button>`;
    if (note) row.title = note; rows.append(row);
  }
  function score(line, item) {
    const text = normalize(line), name = normalize(item.name); if (!text || !name) return 0;
    if (text.includes(name)) return 100;
    const words = name.split(' ').filter(word => word.length > 2);
    return words.filter(word => text.includes(word)).length / Math.max(words.length, 1) * 80;
  }
  function buildPreview(text) {
    rows.innerHTML = '';
    const found = new Map();
    text.split(/\r?\n/).forEach(raw => {
      const line = raw.trim(); if (line.length < 3) return;
      const nums = [...line.matchAll(/(?:^|\s)(\d+(?:[,.]\d+)?)(?:\s*(?:szt\.?|opak\.?|op\.?|x))?(?=\s|$)/gi)];
      const quantity = nums.length ? Number(nums[nums.length - 1][1].replace(',', '.')) : 0;
      const best = all.map(item => ({item, score: score(line, item)})).sort((a,b) => b.score-a.score)[0];
      if (best?.score >= 45 && quantity > 0) found.set(best.item.id, { id: best.item.id, quantity: (found.get(best.item.id)?.quantity || 0) + quantity, line });
    });
    [...found.values()].forEach(item => addRow(item.id, item.quantity, `Odczytano: ${item.line}`));
    if (!found.size) addRow();
    document.querySelector('#recognizedText').textContent = text || 'Nie udało się odczytać tekstu.';
    preview.hidden = false; apply.disabled = false;
    status.textContent = found.size ? `Znaleziono ${found.size} pasujących pozycji. Sprawdź je przed zatwierdzeniem.` : 'Nie znaleziono pewnych dopasowań. Dodaj produkty ręcznie z listy.';
  }
  async function recognize(file) {
    if (!file) return;
    if (!window.Tesseract) { status.textContent = 'Nie udało się uruchomić odczytu. Sprawdź połączenie z internetem i spróbuj ponownie.'; return; }
    apply.disabled = true; preview.hidden = true; rows.innerHTML = ''; status.textContent = 'Odczytuję zdjęcie…';
    try {
      const result = await window.Tesseract.recognize(file, 'pol+eng', { logger: m => { if (m.status === 'recognizing text') status.textContent = `Odczytuję zdjęcie: ${Math.round((m.progress || 0) * 100)}%`; } });
      recognizedText = result.data.text || ''; buildPreview(recognizedText);
    } catch (error) { console.error(error); recognizedText = ''; preview.hidden = false; addRow(); apply.disabled = false; status.textContent = 'Nie udało się odczytać zdjęcia. Dodaj pozycje ręcznie lub wybierz wyraźniejsze zdjęcie.'; }
  }
  document.querySelector('#demand').addEventListener('click', () => { dialog.showModal(); status.textContent = 'Wybierz zdjęcie, aby rozpocząć.'; preview.hidden = true; rows.innerHTML = ''; recognizedText = ''; fileInput.value = ''; });
  ['closeDemand','cancelDemand'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.close()));
  fileInput.addEventListener('change', () => recognize(fileInput.files[0]));
  document.querySelector('#addDemandRow').addEventListener('click', () => addRow());
  rows.addEventListener('click', event => { if (event.target.closest('.demand-remove')) event.target.closest('.demand-row').remove(); });
  document.querySelector('#demandForm').addEventListener('submit', async event => {
    event.preventDefault();
    const items = [...rows.querySelectorAll('.demand-row')].map(row => ({ product_id: Number(row.querySelector('.demand-product').value), quantity: Number(row.querySelector('.demand-quantity').value) })).filter(item => Number.isInteger(item.product_id) && Number.isFinite(item.quantity) && item.quantity > 0);
    if (!items.length) return alert('Wybierz przynajmniej jeden produkt i podaj jego ilość.');
    const password = document.querySelector('#demandPassword').value; if (!password) return alert('Wpisz hasło zatwierdzające.');
    if (!confirm(`Odjąć ze stanów ${items.length} ${items.length === 1 ? 'pozycję' : 'pozycje'}?`)) return;
    apply.disabled = true;
    try {
      const result = await api('/api/demand/apply', { method:'POST', body:JSON.stringify({ items, password, source_name:fileInput.files[0]?.name || 'zdjęcie zapotrzebowania', recognized_text:recognizedText }) });
      dialog.close(); alert(`Zapotrzebowanie zatwierdzone. Odjęto ${result.applied} ${result.applied === 1 ? 'produkt' : 'produkty'}.`); await load();
    } catch (error) { alert(error.message); } finally { apply.disabled = false; }
  });
})();
