(() => {
  const dialog = document.querySelector('#demandHistoryDialog');
  const dateInput = document.querySelector('#historyDate');
  const summaryBox = document.querySelector('#dailySummary');
  const runsBox = document.querySelector('#dailyRuns');
  const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const displayDate = value => value ? new Intl.DateTimeFormat('pl-PL').format(new Date(`${value}T12:00:00`)) : '';
  const number = value => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(Number(value || 0));
  const escHistory = value => String(value || '').replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));

  const numeric = value => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const optionalNumber = (item, field, fallback) => {
    const value = item?.[field];
    return value === undefined || value === null || value === '' ? fallback : numeric(value);
  };

  // Older entries have only `quantity`. For them requested and issued are the
  // same, so this stays fully compatible with the original history.
  function demandAmounts(item) {
    const requested = numeric(item.quantity);
    const issued = Math.max(0, optionalNumber(item, 'issued_quantity', requested));
    const corrected = Math.max(0, numeric(item.corrected_quantity));
    const shortage = Math.max(0, optionalNumber(item, 'shortage_quantity', Math.max(0, requested - issued)));
    const resolved = Math.min(shortage, Math.max(0, optionalNumber(item, 'shortage_resolved_quantity', 0)));
    const unresolved = Math.max(0, shortage - resolved);
    const rawResolution = String(item.shortage_resolution || '').toLowerCase();
    const resolution = rawResolution || (shortage && !unresolved ? 'purchased' : '');
    return {
      requested,
      issued,
      corrected,
      shortage,
      resolved,
      unresolved,
      resolution,
      correctionRemaining: Math.max(0, issued - corrected)
    };
  }

  function shortageStatus(amounts, unit) {
    if (!amounts.shortage) return '';
    if (amounts.resolution === 'dismissed') return `<em class="history-shortage history-shortage-dismissed" style="color:#667085;font-weight:600">Pominięto na liście zakupów</em>`;
    if (amounts.resolution === 'excluded') return `<em class="history-shortage history-shortage-dismissed" style="color:#667085;font-weight:600">Nie wymaga zakupu magazynowego</em>`;
    if (!amounts.unresolved) return `<em class="history-shortage history-shortage-purchased" style="color:#067647;font-weight:700">✓ Kupiono / uzupełniono: ${number(amounts.resolved || amounts.shortage)} ${escHistory(unit)}</em>`;
    return `<em class="history-shortage history-shortage-pending" style="color:#b42318;font-weight:700">Brakuje: ${number(amounts.unresolved)} ${escHistory(unit)} — oczekuje na zakup</em>`;
  }

  async function showDay() {
    const selected = dateInput.value || localDate();
    summaryBox.innerHTML = '<p class="demand-status">Ładuję podsumowanie…</p>';
    runsBox.innerHTML = '';
    try {
      const data = await api(`/api/demand/daily?date=${encodeURIComponent(selected)}`);
      if (!data.summary.length) {
        summaryBox.innerHTML = `<p class="demand-status">Brak zatwierdzonych zapotrzebowań z dnia ${displayDate(data.date)}.</p>`;
      } else {
        summaryBox.innerHTML = `<h3>Stan i zużycie — ${displayDate(data.date)}</h3><div class="summary-table"><div class="summary-head"><span>Produkt</span><span>Na początku</span><span>Zapotrzebowano</span><span>Przywrócono</span><span>Stan teraz</span></div>${data.summary.map(item => `<div class="summary-row"><strong>${escHistory(item.name)}</strong><span>${item.opening_quantity == null ? 'brak danych' : `${number(item.opening_quantity)} ${escHistory(item.unit)}`}</span><span>${number(item.demanded)} ${escHistory(item.unit)}</span><span>${number(item.corrected)} ${escHistory(item.unit)}</span><span>${number(item.current_quantity)} ${escHistory(item.unit)}</span></div>`).join('')}</div>`;
      }
      const purchases = (data.purchases || []).map(item => `<article class="daily-run daily-purchase"><div class="daily-run-title"><strong>✓ Kupione</strong><span>${escHistory(item.category)}${item.brand ? ` · ${escHistory(item.brand)}` : ''}</span></div><div class="run-items"><div class="run-item"><span><strong>${escHistory(item.name)}</strong><small>Zakup do uzupełnienia zapotrzebowania</small></span><b>${number(item.purchased_quantity)} ${escHistory(item.unit)}</b></div></div></article>`).join('');
      const runs = (data.runs || []).map(run => {
        const amountsByItem = run.items.map(demandAmounts);
        const active = amountsByItem.some(amounts => amounts.correctionRemaining > 0);
        const items = run.items.map((item, index) => {
          const amounts = amountsByItem[index];
          return `<div class="run-item"><span><strong>${escHistory(item.name)}</strong><small>Zapotrzebowanie: ${number(amounts.requested)} ${escHistory(item.unit)} · pobrano z magazynu: ${number(amounts.issued)} ${escHistory(item.unit)} · przywrócono: ${number(amounts.corrected)} ${escHistory(item.unit)}</small>${shortageStatus(amounts, item.unit)}</span>${amounts.correctionRemaining > 0 ? `<label>Przywróć<input data-correction-product="${item.product_id}" type="number" min="0" max="${amounts.correctionRemaining}" step="any" placeholder="0"></label>` : amounts.issued > 0 ? '<em>całość cofnięta</em>' : '<em>nie pobrano ze stanu</em>'}</div>`;
        }).join('');
        const actions = active
          ? `<div class="run-actions"><button type="button" class="small-btn" data-correct-run="${run.id}">Zapisz korektę</button><button type="button" class="small-btn danger-btn" data-reverse-run="${run.id}">Cofnij całe zapotrzebowanie</button></div>`
          : '<p class="reversed-note">To zapotrzebowanie nie ma już ilości do przywrócenia.</p>';
        return `<article class="daily-run" data-run-id="${run.id}"><div class="daily-run-title"><strong>Zapotrzebowanie #${run.id}</strong><span>${escHistory(run.source_name || 'wprowadzone ręcznie')}</span></div><div class="run-items">${items}</div>${actions}</article>`;
      }).join('');
      runsBox.innerHTML = purchases + runs;
    } catch (error) {
      summaryBox.innerHTML = `<p class="demand-status">${escHistory(error.message)}</p>`;
    }
  }

  async function legacyShowDay() {
    const selected = dateInput.value || localDate();
    summaryBox.innerHTML = '<p class="demand-status">Ładuję podsumowanie…</p>'; runsBox.innerHTML = '';
    try {
      const data = await api(`/api/demand/daily?date=${encodeURIComponent(selected)}`);
      if (!data.summary.length) summaryBox.innerHTML = `<p class="demand-status">Brak zatwierdzonych zapotrzebowań z dnia ${displayDate(data.date)}.</p>`;
      else summaryBox.innerHTML = `<h3>Stan i zużycie — ${displayDate(data.date)}</h3><div class="summary-table"><div class="summary-head"><span>Produkt</span><span>Na początku</span><span>Odjęto</span><span>Przywrócono</span><span>Stan teraz</span></div>${data.summary.map(item => `<div class="summary-row"><strong>${escHistory(item.name)}</strong><span>${item.opening_quantity == null ? 'brak danych' : `${number(item.opening_quantity)} ${escHistory(item.unit)}`}</span><span>${number(item.demanded)} ${escHistory(item.unit)}</span><span>${number(item.corrected)} ${escHistory(item.unit)}</span><span>${number(item.current_quantity)} ${escHistory(item.unit)}</span></div>`).join('')}</div>`;
      const purchases = (data.purchases || []).map(item => `<article class="daily-run daily-purchase"><div class="daily-run-title"><strong>✓ Kupione</strong><span>${escHistory(item.category)}${item.brand ? ` · ${escHistory(item.brand)}` : ''}</span></div><div class="run-items"><div class="run-item"><span><strong>${escHistory(item.name)}</strong><small>Zakup do uzupełnienia zapotrzebowania</small></span><b>${number(item.purchased_quantity)} ${escHistory(item.unit)}</b></div></div></article>`).join('');
      runsBox.innerHTML = purchases + data.runs.map(run => {
        const active = run.items.some(item => Number(item.quantity) > Number(item.corrected_quantity));
        return `<article class="daily-run" data-run-id="${run.id}"><div class="daily-run-title"><strong>Zapotrzebowanie #${run.id}</strong><span>${escHistory(run.source_name || 'wprowadzone ręcznie')}</span></div><div class="run-items">${run.items.map(item => { const remaining = Number(item.quantity) - Number(item.corrected_quantity); return `<div class="run-item"><span><strong>${escHistory(item.name)}</strong><small>Odjęto: ${number(item.quantity)} ${escHistory(item.unit)} · przywrócono: ${number(item.corrected_quantity)} ${escHistory(item.unit)}</small></span>${remaining > 0 ? `<label>Przywróć<input data-correction-product="${item.product_id}" type="number" min="0" max="${remaining}" step="any" placeholder="0"></label>` : '<em>całość cofnięta</em>'}</div>`; }).join('')}</div>${active ? `<div class="run-actions"><button type="button" class="small-btn" data-correct-run="${run.id}">Zapisz korektę</button><button type="button" class="small-btn danger-btn" data-reverse-run="${run.id}">Cofnij całe zapotrzebowanie</button></div>` : '<p class="reversed-note">To zapotrzebowanie zostało w całości cofnięte.</p>'}</article>`;
      }).join('') || '';
    } catch (error) { summaryBox.innerHTML = `<p class="demand-status">${escHistory(error.message)}</p>`; }
  }
  document.querySelector('#demandHistory').addEventListener('click', () => { dateInput.value = localDate(); dialog.showModal(); showDay(); });
  document.querySelector('#refreshDemandHistory').addEventListener('click', showDay);
  ['closeDemandHistory','closeDemandHistoryBottom'].forEach(id => document.querySelector(`#${id}`).addEventListener('click', () => dialog.close()));
  runsBox.addEventListener('click', async event => {
    const reverse = event.target.closest('[data-reverse-run]');
    const correct = event.target.closest('[data-correct-run]');
    if (!reverse && !correct) return;
    const runId = Number((reverse || correct).dataset.reverseRun || (reverse || correct).dataset.correctRun);
    const password = prompt('Wpisz hasło, aby zatwierdzić korektę:'); if (password === null) return;
    try {
      if (reverse) {
        if (!confirm('Cofnąć całe zapotrzebowanie i przywrócić wszystkie jeszcze nieprzywrócone ilości?')) return;
        await api(`/api/demand/runs/${runId}/reverse`, { method:'POST', body:JSON.stringify({ password }) });
      } else {
        const card = reverse || correct;
        const items = [...card.closest('.daily-run').querySelectorAll('[data-correction-product]')].map(input => ({ product_id:Number(input.dataset.correctionProduct), quantity:Number(input.value) })).filter(item => item.quantity > 0);
        if (!items.length) return alert('Wpisz ilość, którą chcesz przywrócić.');
        await api(`/api/demand/runs/${runId}/correct`, { method:'POST', body:JSON.stringify({ password, items }) });
      }
      await showDay(); await load();
    } catch (error) { alert(error.message); }
  });
})();
