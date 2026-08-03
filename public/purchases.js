/* Rejestr faktur i budżetu zakupowego. */
(() => {
  const dialog = document.querySelector('#purchasesDialog');
  const form = document.querySelector('#purchaseForm');
  const money = value => new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(Number(value || 0));
  const amountValue = value => Number(String(value || '').replace(',', '.'));
  const safe = value => String(value || '').replace(/[&<>]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[character]));
  const today = () => new Date().toISOString().slice(0, 10);

  function invoiceImage(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.onload = () => {
        const scale = Math.min(1, 2000 / Math.max(image.width, image.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * scale);
        canvas.height = Math.round(image.height * scale);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL('image/jpeg', .86));
      };
      image.onerror = () => { URL.revokeObjectURL(url); reject(Error('Nie udało się odczytać zdjęcia faktury.')); };
      image.src = url;
    });
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
        ${item.image_data ? `<a href="${item.image_data}" target="_blank" rel="noopener" title="Otwórz zdjęcie faktury"><img src="${item.image_data}" alt="Zdjęcie faktury"></a>` : '<div class="purchase-no-image">Faktura</div>'}
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
        image_data: await invoiceImage(file)
      }) });
      form.reset();
      document.querySelector('#purchaseSupplier').value = 'SELGROS';
      document.querySelector('#purchaseDate').value = today();
      await refresh();
    } catch (error) { alert(error.message); }
  });

  document.querySelector('#purchaseList').addEventListener('click', async event => {
    const button = event.target.closest('[data-purchase-delete]');
    if (!button || !confirm('Usunąć ten zapis faktury?')) return;
    try { await api(`/api/purchases/${button.dataset.purchaseDelete}`, { method: 'DELETE' }); await refresh(); }
    catch (error) { alert(error.message); }
  });
})();
