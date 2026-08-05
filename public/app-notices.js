(() => {
  const dialog = document.querySelector('#appNoticeDialog');
  const title = document.querySelector('#appNoticeTitle');
  const message = document.querySelector('#appNoticeMessage');
  const kicker = document.querySelector('#appNoticeKicker');
  const accept = document.querySelector('#appNoticeAccept');
  const cancel = document.querySelector('#appNoticeCancel');
  let resolver = null;

  function openNotice(text, options = {}) {
    title.textContent = options.title || (options.confirm ? 'Potwierdź działanie' : 'Informacja');
    kicker.textContent = options.confirm ? 'POTWIERDZENIE' : 'MAGAZYN BETTERWORKPLACE';
    message.textContent = String(text || '');
    accept.textContent = options.acceptLabel || 'OK';
    cancel.hidden = !options.confirm;
    if (dialog.open) dialog.close();
    dialog.showModal();
    accept.focus();
  }

  window.showAppAlert = text => {
    openNotice(text);
    return Promise.resolve();
  };
  window.showAppConfirm = text => new Promise(resolve => {
    resolver = resolve;
    openNotice(text, { confirm:true, acceptLabel:'Potwierdź' });
  });
  accept.addEventListener('click', () => { const done = resolver; resolver = null; dialog.close(); done?.(true); });
  cancel.addEventListener('click', () => { const done = resolver; resolver = null; dialog.close(); done?.(false); });
  dialog.addEventListener('cancel', event => { event.preventDefault(); cancel.click(); });
  dialog.addEventListener('close', () => { if (resolver) { const done = resolver; resolver = null; done(false); } });
  window.alert = text => { window.showAppAlert(text); };
})();
