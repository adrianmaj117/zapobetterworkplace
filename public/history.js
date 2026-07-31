(() => {
  const dialog = document.querySelector('#demandHistoryDialog');
  const dateInput = document.querySelector('#historyDate');
  const summaryBox = document.querySelector('#dailySummary');
  const runsBox = document.querySelector('#dailyRuns');
  const localDate = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const displayDate = value => value ? new Intl.DateTimeFormat('pl-PL').format(new Date(`${value}T12:00:00`)) : '';
  const number = value => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 2 }).format(Number(value || 0));
  const escHistory = value => String(value || '').replace(/[&<>]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[char]));

  async function showDay() {
    const selected = dateInput.value || localDate();
    summaryBox.innerHTML = '<p class="demand-status">Ładuję podsumowanie…</p>'; runsBox.innerHTML = '';
    try {
      const data = await api(`/api/demand/daily?date=${encodeURIComponent(selected)}`);
      if (!data.summary.length) summaryBox.innerHTML = `<p class="demand-status">Brak zatwierdzonych zapotrzebowań z dnia ${displayDate(data.date)}.</p>`;
      else summaryBox.innerHTML = `<h3>Stan i zużycie — ${displayDate(data.date)}</h3><div class="summary-table"><div class="summary-head"><span>Produkt</span><span>Na początku</span><span>Odjęto</span><span>Przywrócono</span><span>Stan teraz</span></div>${data.summary.map(item => `<div class="summary-row"><strong>${escHistory(item.name)}</strong><span>${item.opening_quantity == null ? 'brak danych' : `${number(item.opening_quantity)} ${escHistory(item.unit)}`}</span><span>${number(item.demanded)} ${escHistory(item.unit)}</span><span>${number(item.corrected)} ${escHistory(item.unit)}</span><span>${number(item.current_quantity)} ${escHistory(item.unit)}</span></div>`).join('')}</div>`;
      runsBox.innerHTML = data.runs.map(run => {
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
