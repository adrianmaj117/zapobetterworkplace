(() => {
  'use strict';
  const panel = document.querySelector('#youtubePanel');
  const show = document.querySelector('#youtubeShow');
  const hide = document.querySelector('#youtubeHide');
  const form = document.querySelector('#youtubeSearchForm');
  const query = document.querySelector('#youtubeQuery');
  const info = document.querySelector('#youtubeInfo');
  const results = document.querySelector('#youtubeResults');
  const player = document.querySelector('#youtubePlayer');
  if (!panel || !form) return;

  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
  const api = async path => {
    const response = await fetch(path, { headers: { 'x-session-token': localStorage.getItem('zapoToken') || '' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nie udało się połączyć z YouTube.');
    return data;
  };
  const setHidden = hidden => {
    panel.hidden = hidden;
    show.hidden = !hidden;
    try { localStorage.setItem('zapo.youtubeHidden', hidden ? '1' : '0'); } catch (_) { /* brak zapisu ustawienia nie blokuje panelu */ }
  };
  try { setHidden(localStorage.getItem('zapo.youtubeHidden') === '1'); } catch (_) { /* domyślnie widoczny */ }
  hide.addEventListener('click', () => setHidden(true));
  show.addEventListener('click', () => setHidden(false));

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = query.value.trim();
    if (!text) return;
    info.textContent = 'Szukam filmów…';
    results.innerHTML = '';
    try {
      const videos = await api(`/api/youtube/search?q=${encodeURIComponent(text)}`);
      info.textContent = videos.length ? `Wyniki dla: ${text}` : 'Nie znaleziono filmów.';
      results.innerHTML = videos.map(video => `<button type="button" class="youtube-result" data-video="${esc(video.id)}" data-title="${esc(video.title)}"><img src="${esc(video.thumbnail)}" alt=""><span><b>${esc(video.title)}</b><small>${esc(video.channel)}</small></span></button>`).join('');
    } catch (error) {
      info.textContent = error.message;
    }
  });
  results.addEventListener('click', event => {
    const item = event.target.closest('[data-video]');
    if (!item) return;
    const videoId = item.dataset.video;
    player.hidden = false;
    player.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1" title="${esc(item.dataset.title)}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
    info.textContent = item.dataset.title;
  });
})();
