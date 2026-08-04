(() => {
  const button = document.querySelector('#users');
  const dialog = document.querySelector('#usersDialog');
  const form = document.querySelector('#userForm');
  if (!button || !dialog || !form) return;

  const sessionToken = localStorage.getItem('zapoToken');
  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-session-token': sessionToken, ...options.headers }
    });
    if (!response.ok) throw Error((await response.json().catch(() => ({}))).error || 'Nie udało się zapisać użytkownika.');
    return response.status === 204 ? null : response.json();
  };
  const escapeHtml = value => String(value || '').replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
  let users = [];

  function resetForm() {
    form.reset();
    document.querySelector('#userId').value = '';
    document.querySelector('#userActive').checked = true;
    document.querySelector('#userPassword').required = true;
    document.querySelector('#userPasswordHint').textContent = '(minimum 4 znaki)';
    document.querySelector('#userFormKicker').textContent = 'NOWE KONTO';
    document.querySelector('#userFormTitle').textContent = 'Dodaj użytkownika';
    document.querySelector('#deleteUser').hidden = true;
  }

  function render() {
    const list = document.querySelector('#usersList');
    list.innerHTML = users.map(user => `<article class="user-row ${user.active ? '' : 'is-inactive'}">
      <div class="user-avatar">${escapeHtml(user.display_name).slice(0, 1).toUpperCase()}</div>
      <div><b>${escapeHtml(user.display_name)}</b><small>@${escapeHtml(user.username)} · ${user.role === 'admin' ? 'Administrator — pełen dostęp' : 'Pracownik — podgląd'}${user.active ? '' : ' · konto wyłączone'}</small></div>
      <span class="user-role ${user.role === 'admin' ? 'admin' : ''}">${user.role === 'admin' ? 'Admin' : 'Pracownik'}</span>
      <button type="button" class="small-btn" data-user-edit="${user.id}">Edytuj</button>
    </article>`).join('') || '<p class="users-empty">Nie ma jeszcze użytkowników.</p>';
  }

  async function refresh() {
    users = await api('/api/users');
    render();
  }

  button.addEventListener('click', async () => {
    resetForm();
    dialog.showModal();
    try { await refresh(); } catch (error) { alert(error.message); dialog.close(); }
  });
  document.querySelector('#closeUsers').addEventListener('click', () => dialog.close());
  document.querySelector('#newUser').addEventListener('click', resetForm);
  document.querySelector('#usersList').addEventListener('click', event => {
    const edit = event.target.closest('[data-user-edit]');
    if (!edit) return;
    const user = users.find(item => item.id === Number(edit.dataset.userEdit));
    if (!user) return;
    document.querySelector('#userId').value = user.id;
    document.querySelector('#userDisplayName').value = user.display_name;
    document.querySelector('#userUsername').value = user.username;
    document.querySelector('#userRole').value = user.role;
    document.querySelector('#userActive').checked = user.active;
    document.querySelector('#userPassword').value = '';
    document.querySelector('#userPassword').required = false;
    document.querySelector('#userPasswordHint').textContent = '(zostaw puste, aby nie zmieniać)';
    document.querySelector('#userFormKicker').textContent = 'EDYCJA KONTA';
    document.querySelector('#userFormTitle').textContent = `Edytuj: ${user.display_name}`;
    document.querySelector('#deleteUser').hidden = false;
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const id = Number(document.querySelector('#userId').value || 0);
    const body = {
      display_name: document.querySelector('#userDisplayName').value,
      username: document.querySelector('#userUsername').value,
      role: document.querySelector('#userRole').value,
      active: document.querySelector('#userActive').checked,
      password: document.querySelector('#userPassword').value
    };
    try {
      await api(id ? `/api/users/${id}` : '/api/users', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) });
      resetForm();
      await refresh();
    } catch (error) { alert(error.message); }
  });
  document.querySelector('#deleteUser').addEventListener('click', async () => {
    const id = Number(document.querySelector('#userId').value || 0);
    if (!id || !confirm('Usunąć to konto użytkownika?')) return;
    try { await api(`/api/users/${id}`, { method: 'DELETE' }); resetForm(); await refresh(); }
    catch (error) { alert(error.message); }
  });

  api('/api/session').then(data => { if (data.user?.role === 'admin') button.hidden = false; }).catch(() => {});
})();
