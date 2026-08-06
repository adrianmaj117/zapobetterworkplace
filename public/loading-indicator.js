// Pokazujemy autobus dopiero po krótkiej chwili, aby szybkie kliknięcia
// pozostały natychmiastowe. Dłuższe pobieranie ma za to czytelną informację.
(() => {
  const originalFetch = window.fetch.bind(window);
  const overlay = document.querySelector('#loadingOverlay');
  let active = 0;
  let timer = null;
  const show = () => { if (active > 0) overlay.hidden = false; };
  const hide = () => { if (!active) { clearTimeout(timer); timer = null; overlay.hidden = true; } };
  window.fetch = async (...args) => {
    const options = args[1] || {};
    const headers = options.headers || {};
    const requestUrl = String(args[0]?.url || args[0] || '');
    const background = headers['x-background-refresh'] === '1' || headers['X-Background-Refresh'] === '1' || /\/api\/(notifications|products\/expired|wallet\/me)$/.test(requestUrl);
    if (background) return originalFetch(...args);
    active += 1;
    if (active === 1) timer = window.setTimeout(show, 450);
    try { return await originalFetch(...args); }
    finally { active = Math.max(0, active - 1); hide(); }
  };
})();
