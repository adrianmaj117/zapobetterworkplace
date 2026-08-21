(() => {
  'use strict';
  const token = localStorage.getItem('zapoToken') || '';
  if (!token) return location.replace('/');

  const $ = selector => document.querySelector(selector);
  const monthNames = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
  const now = new Date();
  const state = {
    year: now.getFullYear(), month: now.getMonth(), entries: [],
    settings: { delivery_rate: 4.4, kilometer_rate: .14, kilogram_rate: .14, extra_hour_rate: 27 }
  };
  let toastTimer;

  async function api(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', 'x-session-token': token, ...(options.headers || {}) }
    });
    if (response.status === 401) {
      localStorage.removeItem('zapoToken'); location.replace('/'); throw new Error('Sesja wygasła.');
    }
    const body = response.status === 204 ? null : await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body?.error || 'Nie udało się zapisać danych.');
    return body;
  }
  function toast(message, error = false) {
    clearTimeout(toastTimer);
    const element = $('#toast'); element.textContent = message; element.className = `planner-toast show${error ? ' error' : ''}`;
    toastTimer = setTimeout(() => element.className = 'planner-toast', 3500);
  }
  const two = value => String(value).padStart(2, '0');
  const selectedMonth = () => `${state.year}-${two(state.month + 1)}`;
  const number = value => Number(value || 0).toLocaleString('pl-PL', { maximumFractionDigits: 2 });
  const money = value => Number(value || 0).toLocaleString('pl-PL', { style: 'currency', currency: 'PLN' });
  const dateLabel = value => new Date(`${value}T12:00:00`).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
  const numericInput = selector => Number($(selector).value || 0);

  function renderMonths() {
    $('#yearLabel').textContent = state.year;
    $('#monthGrid').innerHTML = monthNames.map((name, index) => {
      const active = index === state.month;
      return `<button class="month-button${active ? ' active' : ''}" type="button" data-month="${index}" aria-pressed="${active}"><strong>${name}</strong><small>${active ? 'Wybrany miesiąc' : state.year}</small></button>`;
    }).join('');
  }
  function renderSummary(totals) {
    $('#selectedMonthTitle').textContent = `${monthNames[state.month]} ${state.year}`;
    $('#sumDays').textContent = number(totals.days);
    $('#sumDeliveries').textContent = number(totals.deliveries);
    $('#sumKilometers').textContent = `${number(totals.kilometers)} km`;
    $('#sumKilograms').textContent = `${number(totals.kilograms)} kg`;
    $('#sumHours').textContent = `${number(totals.work_hours)} h`;
    $('#sumAmount').textContent = money(totals.daily_amount);
  }
  function renderEntries() {
    const empty = !state.entries.length;
    $('#entriesEmpty').hidden = !empty;
    $('#entriesTableWrap').hidden = empty;
    $('#entriesBody').innerHTML = state.entries.map(entry => `<tr>
      <td class="day-cell" data-label="Dzień"><strong>${dateLabel(entry.work_date)}</strong><small>${entry.work_date.split('-').reverse().join('.')}</small></td>
      <td data-label="Rozpoczęcie">${entry.start_time || '—'}</td>
      <td data-label="Dostawy">${number(entry.deliveries)}</td>
      <td data-label="Kilometry">${number(entry.kilometers)} km</td>
      <td data-label="Kilogramy">${number(entry.kilograms)} kg</td>
      <td data-label="Zakończenie">${entry.end_time || '—'}</td>
      <td data-label="Czas pracy">${number(entry.work_hours)} h</td>
      <td data-label="Dodatkowe">${number(entry.extra_hours)} h</td>
      <td class="amount-cell" data-label="Kwota">${money(entry.daily_amount)}</td>
      <td class="row-actions-cell"><div class="row-actions"><button type="button" data-edit="${entry.id}">Edytuj</button><button type="button" class="delete-entry" data-delete="${entry.id}">Usuń</button></div></td>
    </tr>`).join('');
  }
  async function loadMonth() {
    const data = await api(`/api/driver-planner/entries?month=${selectedMonth()}`);
    state.entries = data.entries || []; state.settings = data.settings || state.settings;
    renderMonths(); renderSummary(data.totals || {}); renderEntries();
  }
  function suggestedDate() {
    if (state.entries.length) {
      const latest = new Date(`${state.entries[state.entries.length - 1].work_date}T12:00:00`);
      latest.setDate(latest.getDate() + 1);
      if (latest.getFullYear() === state.year && latest.getMonth() === state.month) return `${latest.getFullYear()}-${two(latest.getMonth() + 1)}-${two(latest.getDate())}`;
    }
    if (state.year === now.getFullYear() && state.month === now.getMonth()) return `${state.year}-${two(state.month + 1)}-${two(now.getDate())}`;
    return `${state.year}-${two(state.month + 1)}-01`;
  }
  function workHours(start, end) {
    if (!start || !end) return 0;
    const [sh, sm] = start.split(':').map(Number); const [eh, em] = end.split(':').map(Number);
    let minutes = eh * 60 + em - (sh * 60 + sm); if (minutes < 0) minutes += 1440;
    return Math.round(minutes / 60 * 100) / 100;
  }
  function updateCalculation() {
    const hours = workHours($('#startTime').value, $('#endTime').value);
    const amount = numericInput('#deliveries') * state.settings.delivery_rate
      + numericInput('#kilometers') * state.settings.kilometer_rate
      + numericInput('#kilograms') * state.settings.kilogram_rate
      + numericInput('#extraHours') * state.settings.extra_hour_rate;
    $('#workHoursPreview').textContent = `${number(hours)} h`;
    $('#amountPreview').textContent = money(amount);
    $('#formulaPreview').textContent = `${number(numericInput('#deliveries'))} dost. × ${money(state.settings.delivery_rate)} + ${number(numericInput('#kilometers'))} km × ${money(state.settings.kilometer_rate)} + ${number(numericInput('#kilograms'))} kg × ${money(state.settings.kilogram_rate)} + ${number(numericInput('#extraHours'))} h × ${money(state.settings.extra_hour_rate)}`;
  }
  function openEntry(entry = null, quick = false) {
    $('#entryForm').reset(); $('#entryError').textContent = '';
    $('#entryId').value = entry?.id || '';
    $('#entryDialogTitle').textContent = entry ? 'Edytuj dzień' : quick ? 'Szybki wpis' : 'Dodaj dzień';
    $('#workDate').value = entry?.work_date || suggestedDate();
    $('#startTime').value = entry?.start_time || '';
    $('#endTime').value = entry?.end_time || '';
    $('#deliveries').value = entry?.deliveries ?? 0;
    $('#kilometers').value = entry?.kilometers ?? 0;
    $('#kilograms').value = entry?.kilograms ?? 0;
    $('#extraHours').value = entry?.extra_hours ?? 0;
    updateCalculation(); $('#entryDialog').showModal();
    setTimeout(() => (quick ? $('#deliveries') : $('#workDate')).focus(), 100);
  }
  function entryBody() {
    return {
      work_date: $('#workDate').value, start_time: $('#startTime').value,
      deliveries: numericInput('#deliveries'), kilometers: numericInput('#kilometers'), kilograms: numericInput('#kilograms'),
      end_time: $('#endTime').value, extra_hours: numericInput('#extraHours')
    };
  }
  async function saveEntry(event) {
    event.preventDefault(); $('#entryError').textContent = '';
    const button = event.submitter; button.disabled = true; button.textContent = 'Zapisywanie…';
    try {
      const id = $('#entryId').value;
      await api(id ? `/api/driver-planner/entries/${id}` : '/api/driver-planner/entries', { method: id ? 'PUT' : 'POST', body: JSON.stringify(entryBody()) });
      $('#entryDialog').close(); await loadMonth(); toast(id ? 'Dzień został zaktualizowany.' : 'Dzień został zapisany.');
    } catch (error) { $('#entryError').textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Zapisz dzień'; }
  }
  function openSettings() {
    $('#settingsError').textContent = '';
    $('#deliveryRate').value = state.settings.delivery_rate;
    $('#kilometerRate').value = state.settings.kilometer_rate;
    $('#kilogramRate').value = state.settings.kilogram_rate;
    $('#extraHourRate').value = state.settings.extra_hour_rate;
    $('#accountMenu').hidden = true; $('#settingsDialog').showModal();
  }
  async function saveSettings(event) {
    event.preventDefault(); $('#settingsError').textContent = '';
    const button = event.submitter; button.disabled = true; button.textContent = 'Zapisywanie…';
    try {
      state.settings = await api('/api/driver-planner/settings', { method: 'PUT', body: JSON.stringify({
        delivery_rate: numericInput('#deliveryRate'), kilometer_rate: numericInput('#kilometerRate'),
        kilogram_rate: numericInput('#kilogramRate'), extra_hour_rate: numericInput('#extraHourRate')
      }) });
      $('#settingsDialog').close(); toast('Stawki planera zostały zapisane.');
    } catch (error) { $('#settingsError').textContent = error.message; }
    finally { button.disabled = false; button.textContent = 'Zapisz stawki'; }
  }
  async function removeEntry(id) {
    const entry = state.entries.find(item => item.id === id); if (!entry) return;
    if (!confirm(`Usunąć wynik z dnia ${entry.work_date.split('-').reverse().join('.')}?`)) return;
    try { await api(`/api/driver-planner/entries/${id}`, { method: 'DELETE' }); await loadMonth(); toast('Wpis został usunięty.'); }
    catch (error) { toast(error.message, true); }
  }
  function closeDialog(selector) { const dialog = $(selector); if (dialog.open) dialog.close(); }

  $('#monthGrid').addEventListener('click', async event => {
    const button = event.target.closest('[data-month]'); if (!button) return;
    state.month = Number(button.dataset.month); await loadMonth();
  });
  $('#prevYear').onclick = async () => { state.year -= 1; await loadMonth(); };
  $('#nextYear').onclick = async () => { state.year += 1; await loadMonth(); };
  $('#currentYear').onclick = async () => { state.year = now.getFullYear(); state.month = now.getMonth(); await loadMonth(); };
  $('#quickAdd').onclick = () => openEntry(null, true);
  $('#addFullEntry').onclick = () => openEntry();
  $('#entryForm').onsubmit = saveEntry;
  $('#settingsForm').onsubmit = saveSettings;
  document.querySelectorAll('[data-close-entry]').forEach(button => button.onclick = () => closeDialog('#entryDialog'));
  document.querySelectorAll('[data-close-settings]').forEach(button => button.onclick = () => closeDialog('#settingsDialog'));
  ['#startTime','#endTime','#deliveries','#kilometers','#kilograms','#extraHours'].forEach(selector => $(selector).addEventListener('input', updateCalculation));
  $('#entriesBody').onclick = event => {
    const edit = event.target.closest('[data-edit]'); const remove = event.target.closest('[data-delete]');
    if (edit) openEntry(state.entries.find(item => item.id === Number(edit.dataset.edit)));
    if (remove) removeEntry(Number(remove.dataset.delete));
  };
  $('#accountMenuButton').onclick = event => {
    event.stopPropagation(); const menu = $('#accountMenu'); menu.hidden = !menu.hidden;
    $('#accountMenuButton').setAttribute('aria-expanded', String(!menu.hidden));
  };
  $('#openSettings').onclick = openSettings;
  $('#logout').onclick = () => { localStorage.removeItem('zapoToken'); location.replace('/'); };
  document.addEventListener('click', event => { if (!event.target.closest('.account-menu-wrap')) $('#accountMenu').hidden = true; });
  [$('#entryDialog'), $('#settingsDialog')].forEach(dialog => dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); }));

  (async () => {
    try {
      const session = await api('/api/session');
      if (!session.capabilities?.driverPlanner) return location.replace('/magazyn.html');
      const name = session.user?.display_name || 'Paweł';
      document.querySelectorAll('.account-button strong').forEach(element => element.textContent = name);
      await loadMonth();
    } catch (error) { toast(error.message, true); }
    finally { $('#pageLoader').hidden = true; }
  })();
})();
