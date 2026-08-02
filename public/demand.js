/* Darmowe OCR działa w przeglądarce. Każdy odczytany wiersz jest widoczny do ręcznego dopasowania. */
(() => {
  const dialog = document.querySelector('#demandDialog');
  const fileInputs = [...document.querySelectorAll('.demand-image')];
  const status = document.querySelector('#demandStatus');
  const preview = document.querySelector('#demandPreview');
  const rows = document.querySelector('#demandRows');
  const apply = document.querySelector('#applyDemand');
  let recognizedText = '';
  const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const selectedFiles = () => fileInputs.map(input => input.files[0]).filter(Boolean);
  const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
  const label = item => `${item.name} — ${brand(item)} · ${size(item)} (stan: ${item.quantity} ${item.unit})`;
  const productOptions = selected => {
    const categories = [...new Set(all.map(item => item.category))].sort((a,b) => a.localeCompare(b, 'pl'));
    return `<option value="">Dopasuj produkt z magazynu…</option>${categories.map(category => `<optgroup label="${esc(category)}">${all.filter(item => item.category === category).sort((a,b) => a.name.localeCompare(b.name, 'pl')).map(item => `<option value="${item.id}" ${Number(selected) === item.id ? 'selected' : ''}>${esc(label(item))}</option>`).join('')}</optgroup>`).join('')}`;
  };

  function addRow(productId = '', quantity = '', source = '') {
    const row = document.createElement('div'); row.className = 'demand-row';
    row.innerHTML = `<input class="demand-raw" aria-label="Odczytany tekst" value="${esc(source)}" placeholder="Tekst odczytany ze zdjęcia"><select class="demand-product" aria-label="Produkt">${productOptions(productId)}</select><input class="demand-quantity" aria-label="Ilość" type="number" min="0.01" step="any" value="${esc(quantity)}" placeholder="Ilość"><button type="button" class="demand-remove" title="Usuń pozycję" aria-label="Usuń pozycję">×</button>`;
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
    rows.innerHTML = '';
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(line => line.length >= 2 && !/^#{3}/.test(line));
    let matched = 0;
    lines.forEach(line => {
      const best = all.map(item => ({ item, score:score(line, item) })).sort((a,b) => b.score-a.score)[0];
      const productId = best?.score >= 45 ? best.item.id : '';
      if (productId) matched += 1;
      addRow(productId, quantityFrom(line), line);
    });
    if (!lines.length) addRow();
    document.querySelector('#recognizedText').textContent = text || 'Nie udało się odczytać tekstu.';
    preview.hidden = false; apply.disabled = false;
    const count = selectedFiles().length;
    status.textContent = `Odczytano ${lines.length} ${lines.length === 1 ? 'wiersz' : 'wierszy'} z ${count} ${count === 1 ? 'zdjęcia' : 'zdjęć'}. Automatycznie dopasowano ${matched}; resztę wybierz z listy.`;
  }
  async function recognizeFiles(files) {
    if (!files.length) return;
    if (!window.Tesseract) { status.textContent = 'Nie udało się uruchomić odczytu. Sprawdź połączenie z internetem i spróbuj ponownie.'; return; }
    apply.disabled = true; preview.hidden = true; rows.innerHTML = '';
    try {
      const fragments = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index]; status.textContent = `Odczytuję zdjęcie ${index + 1} z ${files.length}: ${file.name}`;
        const result = await window.Tesseract.recognize(file, 'pol+eng', { logger: message => { if (message.status === 'recognizing text') status.textContent = `Odczytuję zdjęcie ${index + 1} z ${files.length}: ${Math.round((message.progress || 0) * 100)}%`; } });
        fragments.push(`### ${file.name}\n${result.data.text || ''}`);
      }
      recognizedText = fragments.join('\n\n'); buildPreview(recognizedText);
    } catch (error) { console.error(error); recognizedText = ''; preview.hidden = false; addRow(); apply.disabled = false; status.textContent = 'Nie udało się odczytać jednego ze zdjęć. Możesz dopisać pozycje ręcznie lub wybrać wyraźniejsze zdjęcia.'; }
  }
  document.querySelector('#demand').addEventListener('click', () => { dialog.showModal(); status.textContent = 'Wybierz od 1 do 4 zdjęć, aby rozpocząć.'; preview.hidden = true; rows.innerHTML = ''; recognizedText = ''; fileInputs.forEach(input => input.value = ''); document.querySelector('#demandDate').value = localDate(); document.querySelector('#demandPassword').value = ''; });
  ['closeDemand','cancelDemand'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.close()));
  fileInputs.forEach(input => input.addEventListener('change', () => recognizeFiles(selectedFiles())));
  document.querySelector('#addDemandRow').addEventListener('click', () => addRow());
  rows.addEventListener('click', event => { if (event.target.closest('.demand-remove')) event.target.closest('.demand-row').remove(); });
  document.querySelector('#demandForm').addEventListener('submit', async event => {
    event.preventDefault();
    const items = [...rows.querySelectorAll('.demand-row')].map(row => ({ product_id:Number(row.querySelector('.demand-product').value), quantity:Number(row.querySelector('.demand-quantity').value) })).filter(item => Number.isInteger(item.product_id) && Number.isFinite(item.quantity) && item.quantity > 0);
    if (!items.length) return alert('Wybierz przynajmniej jeden produkt i podaj jego ilość.');
    const password = document.querySelector('#demandPassword').value; if (!password) return alert('Wpisz hasło zatwierdzające.');
    if (!confirm(`Odjąć ze stanów ${items.length} ${items.length === 1 ? 'pozycję' : 'pozycje'}?`)) return;
    apply.disabled = true;
    try {
      const sourceName = selectedFiles().map(file => file.name).join(', ') || 'zdjęcia zapotrzebowania';
      const result = await api('/api/demand/apply', { method:'POST', body:JSON.stringify({ items, password, demand_date:document.querySelector('#demandDate').value, source_name:sourceName, recognized_text:recognizedText }) });
      dialog.close(); alert(result.shortages?.length ? `Zapotrzebowanie zatwierdzone. Odjęto dostępne produkty, a ${result.shortages.length} brakujące pozycje dodano do listy zakupów.` : `Zapotrzebowanie zatwierdzone. Odjęto ${result.applied} ${result.applied === 1 ? 'produkt' : 'produkty'}.`); await load();
    } catch (error) { alert(error.message); } finally { apply.disabled = false; }
  });
})();
