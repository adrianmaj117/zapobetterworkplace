(() => {
  const dialog = document.querySelector('#appNoticeDialog');
  const title = document.querySelector('#appNoticeTitle');
  const message = document.querySelector('#appNoticeMessage');
  const kicker = document.querySelector('#appNoticeKicker');
  const accept = document.querySelector('#appNoticeAccept');
  const cancel = document.querySelector('#appNoticeCancel');
  let resolver = null;
  let loginRequired = false;
  const needsLogin = text => /zaloguj|sesja.*wygas|brak.*sesj|nieautoryzowan/i.test(String(text || '').toLowerCase());

  function goToLogin() {
    localStorage.removeItem('zapoToken');
    window.location.replace('/');
  }
  function openNotice(text, options = {}) {
    const requireLogin = Boolean(options.requireLogin || needsLogin(text));
    if (loginRequired && dialog.open) return;
    loginRequired = requireLogin;
    title.textContent = requireLogin ? 'Zaloguj się' : (options.title || (options.confirm ? 'Potwierdź działanie' : 'Informacja'));
    kicker.textContent = requireLogin ? 'MAGAZYN BETTERWORKPLACE' : (options.confirm ? 'POTWIERDZENIE' : 'MAGAZYN BETTERWORKPLACE');
    message.textContent = requireLogin ? 'Zaloguj się, aby zobaczyć magazyn.' : String(text || '');
    accept.textContent = requireLogin ? 'OK' : (options.acceptLabel || 'OK');
    cancel.hidden = requireLogin || !options.confirm;
    if (dialog.open) dialog.close();
    dialog.showModal();
    accept.focus();
  }
  window.showLoginRequired = () => openNotice('Zaloguj się, aby zobaczyć magazyn.', { requireLogin:true });
  window.showAppAlert = text => { openNotice(text); return Promise.resolve(); };
  window.showAppConfirm = text => new Promise(resolve => {
    resolver = resolve;
    openNotice(text, { confirm:true, acceptLabel:'Potwierdź' });
  });
  accept.addEventListener('click', () => {
    const redirect = loginRequired;
    const done = resolver;
    resolver = null;
    dialog.close();
    done?.(true);
    if (redirect) goToLogin();
  });
  cancel.addEventListener('click', () => {
    const redirect = loginRequired;
    const done = resolver;
    resolver = null;
    dialog.close();
    done?.(false);
    if (redirect) goToLogin();
  });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (loginRequired) goToLogin(); else cancel.click(); });
  dialog.addEventListener('close', () => {
    if (resolver) { const done = resolver; resolver = null; done(false); }
  });
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await originalFetch(...args);
    const url = String(args[0]?.url || args[0] || '');
    if (response.status === 401 && url.includes('/api/')) window.showLoginRequired();
    return response;
  };
  document.addEventListener('click', event => {
    if (localStorage.getItem('zapoToken') || event.target.closest('#appNoticeDialog')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    window.showLoginRequired();
  }, true);
  window.alert = text => { window.showAppAlert(text); };
})();
