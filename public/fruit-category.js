/* Owoce są liczone wagowo: bez firmy i bez gramatury opakowania. */
(() => {
  const $ = selector => document.querySelector(selector);
  const setLabel = (id, text) => { const label = $(`#${id}`); if (label?.firstChild) label.firstChild.nodeValue = text; };
  function syncFruitFields(prefix) {
    const isFruit = $(prefix === 'add' ? '#category' : '#editCategory').value === 'Owoce';
    const hidden = prefix === 'add' ? ['BrandField', 'WeightValueField', 'WeightUnitField'] : ['BrandField', 'UnitField', 'WeightValueField', 'WeightUnitField'];
    hidden.forEach(suffix => { const field = $(`#${prefix}${suffix}`); if (field) field.hidden = isFruit; });
    setLabel(`${prefix}NameField`, isFruit ? 'Nazwa owocu' : 'Nazwa artykułu');
    setLabel(`${prefix}QuantityField`, isFruit ? 'Ilość (kg)' : 'Ilość sztuk');
    if (!isFruit) return;
    $(`#${prefix}Brand`).value = '';
    $(`#${prefix}WeightValue`).value = '';
    if ($(`#${prefix}WeightUnit`)) $(`#${prefix}WeightUnit`).value = 'g';
    if ($(`#${prefix}Unit`)) $(`#${prefix}Unit`).value = 'kg';
  }
  document.addEventListener('change', event => {
    if (event.target.id === 'category') syncFruitFields('add');
    if (event.target.id === 'editCategory') syncFruitFields('edit');
  });
  $('#add').addEventListener('click', () => setTimeout(() => syncFruitFields('add'), 300));
  $('#products').addEventListener('click', event => { if (event.target.closest('[data-edit]')) setTimeout(() => syncFruitFields('edit'), 0); });

  const regularAdd = $('#addForm').onsubmit;
  $('#addForm').onsubmit = async event => {
    if ($('#category').value !== 'Owoce') return regularAdd(event);
    event.preventDefault();
    try {
      const file = $('#photo').files[0];
      await api('/api/products', { method:'POST', body:JSON.stringify({ name:$('#name').value, category:'Owoce', brand:'', quantity:+$('#quantity').value, unit:'kg', weight_value:null, weight_unit:null, received_date:$('#received').value || null, expiration_date:$('#expiry').value || null, image_data:file ? await read(file) : null }) });
      $('#addDialog').close(); await load();
    } catch (error) { alert(error.message); }
  };

  const regularEdit = $('#editForm').onsubmit;
  $('#editForm').onsubmit = async event => {
    if ($('#editCategory').value !== 'Owoce') return regularEdit(event);
    event.preventDefault();
    try {
      const current = all.find(item => item.id === editId);
      await api(`/api/products/${editId}`, { method:'PUT', body:JSON.stringify({ name:$('#editName').value, category:'Owoce', brand:'', quantity:+$('#editQuantity').value, unit:'kg', min_quantity:current?.min_quantity || 0, weight_value:null, weight_unit:null, received_date:$('#editReceived').value || null, expiration_date:$('#editExpiry').value || null, notes:current?.notes || '' }) });
      $('#editDialog').close(); await load();
    } catch (error) { alert(error.message); }
  };
})();
