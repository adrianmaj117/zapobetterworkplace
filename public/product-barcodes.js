/* Dodatkowe kody opakowań: sztuka, zgrzewka, karton itd. */
(() => {
  const list = document.querySelector('#editBarcodePackages');
  const dialog = document.querySelector('#editDialog');
  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[char]));
  let productId = 0;

  async function loadCodes(id = productId) {
    productId = Number(id || 0);
    if (!productId) return;
    list.innerHTML = '<p class="barcode-package-empty">Wczytuję zapisane kody…</p>';
    try {
      const codes = await api(`/api/products/${productId}/barcodes`);
      list.innerHTML = codes.length ? codes.map(code => code.primary
        ? `<div class="barcode-package-row is-primary"><span><b>${esc(code.barcode)}</b><small>Kod pojedynczej sztuki · 1 szt.</small></span><em>kod główny</em></div>`
        : `<form class="barcode-package-row" data-package-id="${code.id}"><label>Kod<input name="barcode" value="${esc(code.barcode)}" inputmode="numeric" required></label><label>Sztuki<input name="quantity_multiplier" type="number" min="0.001" step="any" value="${Number(code.quantity_multiplier)}" required></label><label>Opakowanie<input name="package_name" maxlength="100" value="${esc(code.package_name)}" required></label><button class="small-btn" type="submit">Zapisz</button><button class="small-btn danger-btn" type="button" data-delete-package="${code.id}">Usuń</button></form>`).join('')
        : '<p class="barcode-package-empty">Nie ma jeszcze dodatkowych kodów opakowań.</p>';
    } catch (error) { list.innerHTML = `<p class="barcode-package-empty">${esc(error.message)}</p>`; }
  }

  document.addEventListener('product-edit-open', event => loadCodes(event.detail?.product?.id));
  dialog.addEventListener('close', () => { productId = 0; list.innerHTML = ''; });

  document.querySelector('#addPackageBarcode').addEventListener('click', async () => {
    if (!productId) return;
    const barcode = document.querySelector('#packageBarcode').value.trim();
    const quantity_multiplier = Number(document.querySelector('#packageMultiplier').value);
    const package_name = document.querySelector('#packageName').value.trim() || 'Sztuka';
    try {
      await api(`/api/products/${productId}/barcodes`, { method:'POST', body:JSON.stringify({ barcode, quantity_multiplier, package_name }) });
      document.querySelector('#packageBarcode').value = '';
      document.querySelector('#packageMultiplier').value = '1';
      document.querySelector('#packageName').value = '';
      await loadCodes();
    } catch (error) { alert(error.message); }
  });

  list.addEventListener('submit', async event => {
    const form = event.target.closest('[data-package-id]');
    if (!form) return;
    event.preventDefault();
    try {
      await api(`/api/product-barcodes/${form.dataset.packageId}`, { method:'PUT', body:JSON.stringify(Object.fromEntries(new FormData(form))) });
      await loadCodes();
    } catch (error) { alert(error.message); }
  });
  list.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-package]');
    if (!button) return;
    if (!await window.showAppConfirm('Usunąć ten dodatkowy kod opakowania?')) return;
    try { await api(`/api/product-barcodes/${button.dataset.deletePackage}`, { method:'DELETE' }); await loadCodes(); }
    catch (error) { alert(error.message); }
  });
})();
