/* Rejestr faktur i budżetu zakupowego. */
(() => {
  const dialog = document.querySelector('#purchasesDialog');
  const form = document.querySelector('#purchaseForm');
  const money = value => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(value || 0));
  const amountValue = value => Number(String(value || '').replace(',', '.'));
  const safe = value => String(value || '').replace(/[&<>]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[character]));
  const today = () => new Date().toISOString().slice(0, 10);
  const ocrStatus = document.querySelector('#purchaseOcrStatus');
  const fullImageDialog = document.querySelector('#invoiceImageDialog');
  let invoiceData = '';
  let ocrLoader = null;
  let editingPurchaseId = 0;
  let editingPurchasePassword = '';
  let savedPurchases = [];

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

  function findPayableAmount(text) {
    // Nie zgadujemy kwoty z przypadkowych liczb (np. numeru faktury).
    // Bierzemy wyłącznie wartość bezpośrednio po „Do zapłaty” albo „Należność”.
    const normalized = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pl-PL');
    const pattern = /(?:do\s*za[pb][l1i]aty|naleznosc(?:i)?)[^\d]{0,24}(\d{1,3}(?:[ .]\d{3})*[,.]\d{2}|\d+[,.]\d{2})/gi;
    const matches = [...normalized.matchAll(pattern)];
    return matches.length ? numberFromText(matches[matches.length - 1][1]) : null;
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
      ocrStatus.textContent = 'Odczytuję kwotę brutto, datę i dostawcę z faktury…';
      const Tesseract = await loadOcr();
      const result = await Tesseract.recognize(invoiceData, 'pol+eng');
      const text = result?.data?.text || '';
      const amount = findPayableAmount(text);
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
    savedPurchases = data.purchases;
    const list = document.querySelector('#purchaseList');
    list.innerHTML = data.purchases.length ? data.purchases.map(item => `
      <article class="purchase-item">
        ${item.image_data ? `<button type="button" class="purchase-image-open" data-invoice-image="${item.id}" title="Pokaż zdjęcie faktury w pełnym widoku"><img src="${item.image_data}" alt="Zdjęcie faktury"></button>` : '<div class="purchase-no-image">Faktura</div>'}
        <div><b>${safe(item.supplier)}</b><small>${item.invoice_date ? date(item.invoice_date) : 'brak daty'}${item.note ? ` · ${safe(item.note)}` : ''}</small></div>
        <small class="purchase-owner">Dodane przez: ${safe(item.wallet_owner || 'Adrian')}</small>
        <strong>${money(item.gross_amount)}</strong>
        ${item.can_manage ? `<button type="button" class="small-btn purchase-edit" data-purchase-edit="${item.id}">Edytuj</button><button type="button" class="small-btn purchase-delete" data-purchase-delete="${item.id}" title="Usuń wpis">Usuń</button>` : '<span class="purchase-readonly">Tylko podgląd</span>'}
      </article>`).join('') : '<p class="purchase-empty">Nie zapisano jeszcze żadnej faktury.</p>';
  }

  document.querySelector('#purchases').addEventListener('click', async () => {
    resetPurchaseForm();
    dialog.showModal();
    try {
      const session = await api('/api/session');
      document.querySelector('.purchase-budget-edit').hidden = !session.capabilities?.finance;
      await refresh();
    } catch (error) { alert(error.message); }
  });
  document.querySelector('#closePurchases').addEventListener('click', () => dialog.close());
  ['closeInvoiceImage', 'returnInvoiceImage'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => fullImageDialog.close()));
  document.querySelector('#purchasePhoto').addEventListener('change', () => {
    const file = document.querySelector('#purchasePhoto').files[0];
    invoiceData = '';
    ocrStatus.textContent = file ? 'Przygotowuję zdjęcie faktury…' : 'Po wybraniu zdjęcia odczytam z niego dane faktury.';
    if (file) readInvoice(file);
  });

  document.querySelector('#savePurchaseBudget').addEventListener('click', async () => {
    try {
      await api('/api/purchases/budget', { method: 'PUT', body: JSON.stringify({
        amount: amountValue(document.querySelector('#purchaseBudget').value),
        password: document.querySelector('#purchaseBudgetPassword').value
      }) });
      document.querySelector('#purchaseBudgetPassword').value = '';
      await refresh();
    } catch (error) { alert(error.message); }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const file = document.querySelector('#purchasePhoto').files[0];
    if (!file && !editingPurchaseId) { alert('Dodaj zdjęcie faktury.'); return; }
    try {
      const body = {
        supplier: document.querySelector('#purchaseSupplier').value,
        invoice_date: document.querySelector('#purchaseDate').value,
        gross_amount: amountValue(document.querySelector('#purchaseAmount').value),
        note: document.querySelector('#purchaseNote').value,
        image_data: invoiceData || (editingPurchaseId ? null : await invoiceImage(file)),
        password: editingPurchaseId ? editingPurchasePassword : undefined
      };
      await api(editingPurchaseId ? `/api/purchases/${editingPurchaseId}` : '/api/purchases', { method: editingPurchaseId ? 'PUT' : 'POST', body: JSON.stringify(body) });
      resetPurchaseForm();
      await refresh();
    } catch (error) { alert(error.message); }
  });

  document.querySelector('#purchaseList').addEventListener('click', async event => {
    const imageButton = event.target.closest('[data-invoice-image]');
    if (imageButton) {
      const item = savedPurchases.find(entry => Number(entry.id) === Number(imageButton.dataset.invoiceImage));
      if (item?.image_data) {
        document.querySelector('#invoiceFullImage').src = item.image_data;
        fullImageDialog.showModal();
      }
      return;
    }
    const editButton = event.target.closest('[data-purchase-edit]');
    if (editButton) {
      const item = savedPurchases.find(entry => Number(entry.id) === Number(editButton.dataset.purchaseEdit));
      if (!item) return;
      const password = prompt('Wpisz hasło, aby edytować fakturę:');
      if (password === null) return;
      if (password !== '123') { alert('Nieprawidłowe hasło.'); return; }
      editingPurchaseId = item.id;
      editingPurchasePassword = password;
      invoiceData = '';
      document.querySelector('.purchase-add h3').textContent = 'Edytuj fakturę';
      document.querySelector('#purchaseSupplier').value = item.supplier;
      document.querySelector('#purchaseDate').value = item.invoice_date || today();
      document.querySelector('#purchaseAmount').value = Number(item.gross_amount).toFixed(2);
      document.querySelector('#purchaseNote').value = item.note || '';
      document.querySelector('#purchasePhoto').required = false;
      document.querySelector('#purchasePhoto').value = '';
      document.querySelector('#purchaseOcrStatus').textContent = 'Zmień dane albo dodaj nowe zdjęcie faktury, a następnie zatwierdź zapis.';
      document.querySelector('#purchaseForm button[type="submit"]').textContent = 'Zapisz zmiany faktury';
      document.querySelector('.purchase-add').scrollIntoView({ behavior:'smooth', block:'start' });
      return;
    }
    const button = event.target.closest('[data-purchase-delete]');
    if (!button || !await window.showAppConfirm('Usunąć ten zapis faktury?')) return;
    const password = prompt('Wpisz hasło, aby trwale usunąć fakturę:');
    if (password === null) return;
    if (password !== '123') { alert('Nieprawidłowe hasło.'); return; }
    try { await api(`/api/purchases/${button.dataset.purchaseDelete}`, { method: 'DELETE', body: JSON.stringify({ password }) }); await refresh(); }
    catch (error) { alert(error.message); }
  });

  function resetPurchaseForm() {
    editingPurchaseId = 0;
    editingPurchasePassword = '';
    invoiceData = '';
    form.reset();
    document.querySelector('.purchase-add h3').textContent = 'Dodaj fakturę';
    document.querySelector('#purchaseSupplier').value = 'SELGROS';
    document.querySelector('#purchaseDate').value = today();
    document.querySelector('#purchasePhoto').required = true;
    document.querySelector('#purchaseOcrStatus').textContent = 'Po wybraniu zdjęcia odczytam z niego dane faktury.';
    document.querySelector('#purchaseForm button[type="submit"]').textContent = 'Akceptuję i zapisz fakturę';
  }
})();
