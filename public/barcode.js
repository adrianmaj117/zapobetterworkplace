/* Wyszukiwanie artykułów kodem kreskowym: aparat telefonu lub wpisany kod. */
(() => {
  const dialog = document.querySelector('#barcodeDialog');
  const openButton = document.querySelector('#barcodeLookup');
  const video = document.querySelector('#barcodeVideo');
  const manual = document.querySelector('#barcodeManual');
  const status = document.querySelector('#barcodeStatus');
  const result = document.querySelector('#barcodeResult');
  const addMissing = document.querySelector('#barcodeAddMissing');
  let stream = null, detector = null, timer = null, currentCode = '', zxingControls = null, captureTarget = '';

  const cleanCode = value => String(value || '').trim().replace(/[^0-9A-Za-z-]/g, '').toUpperCase();
  const escapeHtml = value => String(value || '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const productBrand = item => item.brand || (item.category === 'Bakalie' ? 'HEBAR' : 'Pozostałe');
  const productWeight = item => item.weight_value ? `${item.weight_value} ${item.weight_unit}` : 'bez gramatury';

  function stopCamera() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (zxingControls) { try { zxingControls.stop(); } catch (_) {} zxingControls = null; }
    if (stream) { stream.getTracks().forEach(track => track.stop()); stream = null; }
    video.srcObject = null;
  }
  function reset(keepCaptureTarget = false) {
    stopCamera(); currentCode = ''; manual.value = ''; result.hidden = true; result.innerHTML = ''; addMissing.hidden = true;
    status.textContent = 'Aparat jest wyłączony.';
    if (!keepCaptureTarget) captureTarget = '';
  }
  function saveScannedCode(code) {
    const input = document.querySelector(`#${captureTarget}`);
    if (!input) { captureTarget = ''; return false; }
    input.value = code;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    stopCamera();
    dialog.close();
    captureTarget = '';
    return true;
  }
  function showProduct(product) {
    result.hidden = false; addMissing.hidden = true;
    result.innerHTML = `<article class="barcode-found"><strong>✓ Artykuł jest w magazynie</strong><h3>${escapeHtml(product.name)}</h3><p>${escapeHtml(product.category)} · ${escapeHtml(productBrand(product))} · ${escapeHtml(productWeight(product))}</p><p class="barcode-stock">Stan: <b>${product.quantity} ${escapeHtml(product.unit)}</b>${product.expiration_date ? ` · termin: ${escapeHtml(new Intl.DateTimeFormat('pl-PL').format(new Date(product.expiration_date)))}` : ''}</p><button type="button" class="small-btn" data-open-product="${product.id}">Otwórz artykuł</button></article>`;
  }
  function lookup(value) {
    const code = cleanCode(value);
    if (!code) { status.textContent = 'Wpisz kod kreskowy albo włącz aparat.'; return; }
    currentCode = code; manual.value = code; stopCamera();
    if (captureTarget && saveScannedCode(code)) return;
    const product = all.find(item => cleanCode(item.barcode) === code);
    if (product) { status.textContent = `Znaleziono kod: ${code}`; showProduct(product); return; }
    status.textContent = `Nie ma artykułu z kodem ${code} w magazynie.`;
    result.hidden = false; addMissing.hidden = false;
    result.innerHTML = `<article class="barcode-not-found"><strong>Brak artykułu w magazynie</strong><p>Ten kod nie jest jeszcze przypisany do żadnego produktu.</p></article>`;
  }
  async function scanFrame() {
    if (!stream || !dialog.open) return;
    try {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const codes = await detector.detect(video);
        if (codes.length && codes[0].rawValue) { lookup(codes[0].rawValue); return; }
      }
    } catch (_) { /* kolejna klatka może być już czytelna */ }
    timer = setTimeout(scanFrame, 180);
  }
  async function startWithZxing() {
    if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
      status.textContent = 'Nie udało się wczytać skanera. Sprawdź połączenie z internetem albo wpisz kod ręcznie.';
      return;
    }
    try {
      stopCamera();
      status.textContent = 'Uruchamiam aparat…';
      const reader = new window.ZXingBrowser.BrowserMultiFormatReader();
      zxingControls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false }, video, (scanResult) => {
        if (scanResult?.getText()) lookup(scanResult.getText());
      });
      status.textContent = 'Skanowanie trwa — ustaw kod kreskowy w ramce.';
    } catch (error) {
      stopCamera();
      status.textContent = error.name === 'NotAllowedError' ? 'Brak zgody na aparat. Zezwól na dostęp do aparatu w przeglądarce.' : 'Nie udało się uruchomić aparatu. Możesz wpisać kod ręcznie.';
    }
  }
  async function startCamera() {
    if (!('BarcodeDetector' in window)) return startWithZxing();
    try {
      stopCamera();
      const wanted = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf'];
      const supported = BarcodeDetector.getSupportedFormats ? await BarcodeDetector.getSupportedFormats() : wanted;
      const formats = wanted.filter(format => supported.includes(format));
      detector = formats.length ? new BarcodeDetector({ formats }) : new BarcodeDetector();
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = stream; await video.play();
      status.textContent = 'Skanowanie trwa — ustaw kod kreskowy w ramce.';
      scanFrame();
    } catch (error) {
      stopCamera();
      status.textContent = error.name === 'NotAllowedError' ? 'Brak zgody na aparat. Zezwól na dostęp do aparatu w przeglądarce.' : 'Nie udało się uruchomić aparatu. Możesz wpisać kod ręcznie.';
    }
  }
  function openProduct(id) {
    const product = all.find(item => item.id === Number(id)); if (!product) return;
    state = { level: 'products', category: product.category, brand: productBrand(product), weight: productWeight(product) };
    dialog.close(); render(); document.querySelector('#products').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function addProductWithCode() {
    if (!currentCode) return;
    dialog.close(); document.querySelector('#add').click();
    let tries = 0;
    const insertCode = () => {
      if (document.querySelector('#addDialog').open) document.querySelector('#barcode').value = currentCode;
      else if (tries++ < 80) setTimeout(insertCode, 40);
    };
    insertCode();
  }

  function openLookup() {
    reset();
    dialog.querySelector('h2').textContent = 'Znajdź artykuł kodem';
    dialog.showModal();
    startCamera();
  }
  function openCapture(targetId) {
    captureTarget = targetId;
    reset(true);
    dialog.querySelector('h2').textContent = 'Dodaj kod kreskowy';
    dialog.showModal();
    startCamera();
  }

  openButton.addEventListener('click', openLookup);
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-scan-barcode-for]');
    if (!button) return;
    event.preventDefault();
    openCapture(button.dataset.scanBarcodeFor);
  });
  document.querySelector('#startBarcodeCamera').addEventListener('click', startCamera);
  document.querySelector('#findBarcodeManual').addEventListener('click', () => lookup(manual.value));
  manual.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); lookup(manual.value); } });
  result.addEventListener('click', event => { const button = event.target.closest('[data-open-product]'); if (button) openProduct(button.dataset.openProduct); });
  addMissing.addEventListener('click', addProductWithCode);
  ['closeBarcode', 'cancelBarcode'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.close()));
  dialog.addEventListener('close', () => { stopCamera(); captureTarget = ''; });
})();
