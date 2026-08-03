/* Rejestr faktur i budżetu zakupowego. */
(() => {
  const dialog = document.querySelector('#purchasesDialog');
  const form = document.querySelector('#purchaseForm');
  const money = value => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(value || 0));
  const amountValue = value => Number(String(value || '').replace(',', '.'));
  const safe = value => String(value || '').replace(/[&<>]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[character]));
  const today = () => new Date().toISOString().slice(0, 10);
  const ocrStatus = document.querySelector('#purchaseOcrStatus');
  const preview = document.querySelector('#purchaseNewPreview');
  const fullImageDialog = document.querySelector('#invoiceImageDialog');
  let invoiceData = '';
  let ocrLoader = null;

  function invoiceImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        // Rozdzielczość wystarcza do pełnego podglądu i odczytania faktury,
        // ale jest znacznie lżejsza niż zdjęcie prosto z telefonu.
        const scale = Math.min(1, 3000 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', .9));
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(Error('Nie udało się odczytać zdjęcia faktury.')); };
      image.src = url;
    });
  }

  function loadOcr() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (ocrLoader) return ocrLoader;
    ocrLoader = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
      script.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(Error('Nie udało się uruchomić odczytu faktury.'));
      script.onerror = () => reject(Error('Nie udało się pobrać modułu odczytu. Sprawdź połączenie z internetem.'));
      document.head.append(script);
    });
    return ocrLoader;
  }

  function numberFromText(value) {
    const raw = String(value || '').replace(/\s/g, '');
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    const amount = Number(normalized);
    return Number.isFinite(amount) ? amount : null;
  }

  function findGrossAmount(text) {
    const lines = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const preferred = lines.filter(line => /(razem.{0,25}brutto|do zap[łl]aty|kwota.{0,25}brutto|suma.{0,25}brutto|nale[żz]no[śs][ćc])/i.test(line));
    const candidates = [...preferred, ...lines];
    for (const line of candidates) {
      const values = line.match(/\d{1,3}(?:[ .]\d{3})*,\d{2}|\d+\.\d{2}/g);
      if (values?.length) return numberFromText(values[values.length - 1]);
    }
    return null;
  }

  function findInvoiceDate(text) {
    const match = String(text || '').match(/\b(\d{2})[.\/-](\d{2})[.\/-](\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (!match) return '';
    return match[4] ? `${match[4]}-${match[5]}-${match[6]}` : `${match[3]}-${match[2]}-${match[1]}`;
  }

  function supplierFromText(text) {
    if (/selgros/i.test(text)) return 'SELGROS';
    if (/makro/i.test(text)) return 'MAKRO';
    return '';
  }

  async function readInvoice(file) {
    try {
      invoiceData = await invoiceImage(file);
      preview.hidden = false;
      preview.querySelector('img').src = invoiceData;
      ocrStatus.textContent = 'Odczytuję kwotę brutto, datę i dostawcę z faktury…';
      const Tesseract = await loadOcr();
      const result = await Tesseract.recognize(invoiceData, 'pol+eng');
      const text = result?.data?.text || '';
      const amount = findGrossAmount(text);
      const invoiceDate = findInvoiceDate(text);
      const supplier = supplierFromText(text);
      if (amount !== null) document.querySelector('#purchaseAmount').value = amount.toFixed(2);
      if (invoiceDate) document.querySelector('#purchaseDate').value = invoiceDate;
      if (supplier) document.querySelector('#purchaseSupplier').value = supplier;
      ocrStatus.textContent = amount !== null
        ? 'Odczytano propozycję danych. Sprawdź je na fakturze i kliknij „Akceptuję i zapisz fakturę”.'
        : 'Nie udało się pewnie znaleźć kwoty brutto. Wpisz ją ręcznie, sprawdź datę i kliknij „Akceptuję i zapisz fakturę”.';
    } catch (error) {
      ocrStatus.textContent = `${error.message} Dane możesz wpisać ręcznie i nadal zapisać fakturę.`;
    }
  }

  async function refresh() {
    const data = await api('/api/purchases');
    document.querySelector('#purchaseBudgetValue').textContent = money(data.budget);
    document.querySelector('#purchaseSpentValue').textContent = money(data.spent);
    document.querySelector('#purchaseRemainingValue').textContent = money(data.remaining);
    document.querySelector('#purchaseBudget').value = data.budget || '';
    const list = document.querySelector('#purchaseList');
    list.innerHTML = data.purchases.length ? data.purchases.map(item => `
      <article class="purchase-item">
        ${item.image_data ? `<button type="button" class="purchase-image-open" data-invoice-image="${item.id}" title="Pokaż zdjęcie faktury w pełnym widoku"><img src="${item.image_data}" alt="Zdjęcie faktury"></button>` : '<div class="purchase-no-image">Faktura</div>'}
        <div><b>${safe(item.supplier)}</b><small>${item.invoice_date ? date(item.invoice_date) : 'brak daty'}${item.note ? ` · ${safe(item.note)}` : ''}</small></div>
        <strong>${money(item.gross_amount)}</strong>
        <button type="button" class="small-btn purchase-delete" data-purchase-delete="${item.id}" title="Usuń wpis">Usuń</button>
      </article>`).join('') : '<p class="purchase-empty">Nie zapisano jeszcze żadnej faktury.</p>';
  }

  document.querySelector('#purchases').addEventListener('click', async () => {
    document.querySelector('#purchaseDate').value = today();
    dialog.showModal();
    try { await refresh(); } catch (error) { alert(error.message); }
  });
  document.querySelector('#closePurchases').addEventListener('click', () => dialog.close());
  ['closeInvoiceImage', 'returnInvoiceImage'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => fullImageDialog.close()));
  preview.addEventListener('click', () => {
    document.querySelector('#invoiceFullImage').src = invoiceData;
    fullImageDialog.showModal();
  });

  document.querySelector('#purchasePhoto').addEventListener('change', () => {
    const file = document.querySelector('#purchasePhoto').files[0];
    invoiceData = '';
    preview.hidden = true;
    ocrStatus.textContent = file ? 'Przygotowuję zdjęcie faktury…' : 'Po wybraniu zdjęcia odczytam z niego dane faktury.';
    if (file) readInvoice(file);
  });

  document.querySelector('#savePurchaseBudget').addEventListener('click', async () => {
    try {
      await api('/api/purchases/budget', { method: 'PUT', body: JSON.stringify({ amount: amountValue(document.querySelector('#purchaseBudget').value) }) });
      await refresh();
    } catch (error) { alert(error.message); }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const file = document.querySelector('#purchasePhoto').files[0];
    if (!file) { alert('Dodaj zdjęcie faktury.'); return; }
    try {
      await api('/api/purchases', { method: 'POST', body: JSON.stringify({
        supplier: document.querySelector('#purchaseSupplier').value,
        invoice_date: document.querySelector('#purchaseDate').value,
        gross_amount: amountValue(document.querySelector('#purchaseAmount').value),
        note: document.querySelector('#purchaseNote').value,
        image_data: invoiceData || await invoiceImage(file)
      }) });
      form.reset();
      document.querySelector('#purchaseSupplier').value = 'SELGROS';
      document.querySelector('#purchaseDate').value = today();
      invoiceData = '';
      preview.hidden = true;
      ocrStatus.textContent = 'Po wybraniu zdjęcia odczytam z niego dane faktury.';
      await refresh();
    } catch (error) { alert(error.message); }
  });

  document.querySelector('#purchaseList').addEventListener('click', async event => {
    const imageButton = event.target.closest('[data-invoice-image]');
    if (imageButton) {
      const item = (await api('/api/purchases')).purchases.find(entry => Number(entry.id) === Number(imageButton.dataset.invoiceImage));
      if (item?.image_data) {
        document.querySelector('#invoiceFullImage').src = item.image_data;
        fullImageDialog.showModal();
      }
      return;
    }
    const button = event.target.closest('[data-purchase-delete]');
    if (!button || !confirm('Usunąć ten zapis faktury?')) return;
    try { await api(`/api/purchases/${button.dataset.purchaseDelete}`, { method: 'DELETE' }); await refresh(); }
    catch (error) { alert(error.message); }
  });
})();
