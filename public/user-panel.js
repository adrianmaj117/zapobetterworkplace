(() => {
  const token = () => localStorage.getItem('zapoToken');
  const api = async (url, options = {}) => {
    const response = await fetch(url, { ...options, headers: { 'Content-Type': 'application/json', 'x-session-token': token(), ...(options.headers || {}) } });
    if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || 'Nie udało się wykonać tej operacji.');
    return response.status === 204 ? null : response.json();
  };
  const dialog = document.querySelector('#userPanelDialog');
  const open = document.querySelector('#userPanelOpen');
  const walletDialog = document.querySelector('#walletDialog');
  const walletConfirm = document.querySelector('#walletConfirmDialog');
  let session;
  let walletTimer;
  let knownPendingWalletOperations = new Set();
  const show = element => { dialog.close(); element?.click(); };
  const roleText = user => user.role_label || ({ admin:'Admin', procurement:'Zaopatrzenie', leader:'Lider', worker:'Pracownik' }[user.role] || 'Pracownik');
  const roleSelect = document.querySelector('#userRole');
  if (roleSelect) roleSelect.innerHTML = '<option value="worker">Pracownik — zapotrzebowanie i stany</option><option value="leader">Lider — magazyn, dostawy i zakupy</option><option value="procurement">Zaopatrzenie — magazyn bez użytkowników</option><option value="admin">Administrator — pełen dostęp</option>';

  function applyPermissions() {
    const caps = session.capabilities || session.user?.capabilities || {};
    document.querySelector('#userPanelRole').textContent = roleText(session.user);
    document.querySelector('#panelUserName').textContent = session.user.display_name;
    document.querySelector('#panelUserRole').textContent = `${roleText(session.user)}${session.user.role === 'leader' || session.user.role === 'worker' ? ' · ograniczony dostęp' : ''}`;
    document.querySelectorAll('[data-cap]').forEach(button => button.hidden = !caps[button.dataset.cap]);
    document.querySelector('#users').hidden = !caps.users;
    document.querySelector('#purchases').hidden = !caps.purchases;
    document.querySelector('#selgrosCard').hidden = !caps.selgros;
    document.querySelector('#delivery').hidden = !caps.delivery;
    document.querySelector('#deliveryHistory').hidden = !caps.deliveryHistory;
    document.querySelector('#shoppingList').hidden = !caps.shopping;
    document.querySelector('#add').hidden = !caps.inventoryEdit;
  }
  async function walletNotifications(showExisting = false) {
    const data = await api('/api/wallet/me', { headers: { 'x-background-refresh':'1' } });
    const pending = data.transactions.filter(item => item.status === 'pending');
    const pendingIds = new Set(pending.map(item => String(item.id)));
    const newOperations = pending.filter(item => !knownPendingWalletOperations.has(String(item.id)));
    knownPendingWalletOperations = pendingIds;
    if (!pending.length) return;
    document.querySelector('#walletPending').innerHTML = pending.map(item => `<article class="wallet-pending"><b>${item.kind === 'create' ? 'Utworzono portfel' : `Zmiana środków: ${Number(item.amount).toLocaleString('pl-PL',{style:'currency',currency:'PLN'})}`}</b><small>${item.note || 'Potwierdź operację własnym hasłem.'}</small><label>Twoje hasło<input type="password" data-wallet-password="${item.id}"></label><div><button class="button ghost" data-wallet-decide="${item.id}" data-accept="false">Odrzuć</button><button class="button primary" data-wallet-decide="${item.id}" data-accept="true">Akceptuję</button></div></article>`).join('');
    if ((showExisting || newOperations.length) && !walletConfirm.open) walletConfirm.showModal();
  }
  function scheduleWalletNotifications() {
    walletNotifications(false).catch(() => {});
    clearTimeout(walletTimer);
    walletTimer = setTimeout(scheduleWalletNotifications, document.hidden ? 30000 : 1000);
  }
  async function renderWallets() {
    const data = await api('/api/wallet/users');
    document.querySelector('#walletUsers').innerHTML = data.map(({ user, wallet, transactions }) => `<article class="wallet-user"><div><b>${user.display_name}</b><small>${roleText(user)} · ${wallet?.active ? 'portfel aktywny' : wallet ? 'oczekuje na akceptację' : 'brak portfela'}</small></div><strong>${wallet ? Number(wallet.balance).toLocaleString('pl-PL',{style:'currency',currency:'PLN'}) : '—'}</strong>${wallet ? `<form data-wallet-adjust="${user.id}"><input name="amount" type="number" step="0.01" placeholder="np. 1000 lub -100"><input name="note" placeholder="Powód (opcjonalnie)"><button class="small-btn">Wyślij do akceptacji</button></form>` : `<button class="small-btn" data-wallet-create="${user.id}">Załóż portfel</button>`}${wallet && transactions.some(t=>t.status==='pending') ? '<small class="wallet-wait">Oczekuje na decyzję właściciela</small>' : ''}</article>`).join('');
  }
  open.addEventListener('click', async () => { try { session = await api('/api/session'); applyPermissions(); dialog.showModal(); } catch (error) { alert(error.message); } });
  document.querySelector('#closeUserPanel').onclick = () => dialog.close();
  document.querySelector('#closeWallet').onclick = () => walletDialog.close();
  document.querySelector('#closeWalletConfirm').onclick = () => walletConfirm.close();
  dialog.addEventListener('click', async event => {
    const button = event.target.closest('[data-panel-action]'); if (!button) return;
    if (button.dataset.panelAction === 'wallet') { dialog.close(); await renderWallets(); walletDialog.showModal(); return; }
    show(document.querySelector(`#${button.dataset.panelAction}`));
  });
  walletDialog.addEventListener('click', async event => {
    const create = event.target.closest('[data-wallet-create]');
    if (create) { try { await api(`/api/wallet/users/${create.dataset.walletCreate}`, { method:'POST' }); await renderWallets(); } catch (error) { alert(error.message); } }
  });
  walletDialog.addEventListener('submit', async event => {
    const form = event.target.closest('[data-wallet-adjust]'); if (!form) return; event.preventDefault();
    try { await api(`/api/wallet/users/${form.dataset.walletAdjust}/transactions`, { method:'POST', body:JSON.stringify({ amount:Number(form.amount.value), note:form.note.value }) }); await renderWallets(); } catch (error) { alert(error.message); }
  });
  walletConfirm.addEventListener('click', async event => {
    const button = event.target.closest('[data-wallet-decide]'); if (!button) return;
    const password = walletConfirm.querySelector(`[data-wallet-password="${button.dataset.walletDecide}"]`)?.value;
    try { await api(`/api/wallet/transactions/${button.dataset.walletDecide}/decide`, { method:'POST', body:JSON.stringify({ accept: button.dataset.accept === 'true', password }) }); walletConfirm.close(); await walletNotifications(false); } catch (error) { alert(error.message); }
  });
  document.addEventListener('visibilitychange', () => { clearTimeout(walletTimer); if (document.hidden) walletTimer = setTimeout(scheduleWalletNotifications, 30000); else scheduleWalletNotifications(); });
  document.addEventListener('wallet:open-pending', () => { walletNotifications(true).catch(() => {}); });
  api('/api/session').then(data => { session = data; applyPermissions(); return walletNotifications(true); }).then(scheduleWalletNotifications).catch(() => {});
})();
