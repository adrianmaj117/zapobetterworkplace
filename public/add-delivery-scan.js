/* Pierwszy krok dostawy: skanowanie kodu, a potem gotowy formularz. */
(() => {
  const addButton = document.querySelector('#add');
  const dialog = document.querySelector('#addDialog');
  const form = document.querySelector('#addForm');
  const category = document.querySelector('#category');
  const today = () => new Date().toISOString().slice(0, 10);
  const safe = value => String(value || '').replace(/[&<>]/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;' }[character]));

  function categories() {
    return [...new Set([
      ...(typeof cats === 'undefined' ? [] : cats),
      ...(typeof all === 'undefined' ? [] : all).map(product => product.category),
      ...(typeof paths === 'undefined' ? [] : paths).filter(path => path.level === 'category').map(path => path.category)
    ])].filter(Boolean).sort((a, b) => a.localeCompare(b, 'pl'));
  }

  async function openAddDeliveryForm(product = null, scannedCode = '') {
    form.reset();
    category.innerHTML = categories().map(value => `<option>${safe(value)}</option>`).join('');
    document.querySelector('#received').value = today();
    document.querySelector('#expiry').value = '';
    document.querySelector('#barcode').value = scannedCode || product?.barcode || '';
    document.querySelector('.modal-head h2', dialog).textContent = product ? 'Dodaj dostawę — produkt rozpoznany' : 'Dodaj dostawę';
    if (product) {
      category.value = product.category;
      category.dispatchEvent(new Event('change', { bubbles: true }));
      document.querySelector('#brand').value = product.brand || '';
      document.querySelector('#name').value = product.name;
      document.querySelector('#weightValue').value = product.weight_value || '';
      document.querySelector('#weightUnit').value = product.weight_unit || 'g';
    }
    dialog.showModal();
    (product ? document.querySelector('#quantity') : document.querySelector('#name')).focus();
  }

  window.openAddDeliveryForm = openAddDeliveryForm;
  addButton.onclick = () => {
    if (window.openBarcodeForNewDelivery) window.openBarcodeForNewDelivery();
    else openAddDeliveryForm();
  };
})();
