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
  const controls = document.querySelector('#youtubeControls');
  const previous = document.querySelector('#youtubePrevious');
  const next = document.querySelector('#youtubeNext');
  const compactScreen = window.matchMedia('(max-width: 700px)');
  const topbar = document.querySelector('.warehouse-topbar');
  const themeToggle = document.querySelector('#themeToggle');
  let mobileOpen = false;
  let videos = [];
  let currentVideo = null;
  let history = [];
  let historyIndex = -1;
  let ytPlayer = null;
  let ytReady = null;
  let nextBusy = false;
  if (!panel || !form) return;

  const esc = value => String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' })[char]);
  const api = async path => {
    const response = await fetch(path, { headers: { 'x-session-token': localStorage.getItem('zapoToken') || '' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Nie udało się połączyć z YouTube.');
    return data;
  };
  const updateControls = () => {
    controls.hidden = !currentVideo;
    previous.disabled = historyIndex <= 0;
    next.disabled = !currentVideo || nextBusy;
  };
  const ensureYouTubePlayer = () => {
    if (window.YT?.Player) return Promise.resolve();
    if (ytReady) return ytReady;
    ytReady = new Promise(resolve => {
      const previousReady = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (typeof previousReady === 'function') previousReady(); resolve(); };
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      document.head.append(script);
    });
    return ytReady;
  };
  function saveInHistory(video) {
    if (history[historyIndex]?.id === video.id) return;
    history = history.slice(0, historyIndex + 1);
    history.push(video);
    historyIndex = history.length - 1;
  }
  async function startVideo(video, saveHistory = true) {
    if (!video?.id) return;
    currentVideo = video;
    if (saveHistory) saveInHistory(video);
    player.hidden = false;
    player.innerHTML = '<div id="youtubePlayerFrame"></div>';
    info.textContent = `Odtwarzanie: ${video.title}`;
    updateControls();
    await ensureYouTubePlayer();
    ytPlayer?.destroy?.();
    ytPlayer = new window.YT.Player('youtubePlayerFrame', {
      host: 'https://www.youtube-nocookie.com',
      videoId: video.id,
      playerVars: { autoplay: 1, rel: 0 },
      events: { onStateChange(event) { if (event.data === window.YT.PlayerState.ENDED) void playSimilar(); } }
    });
  }
  async function playSimilar() {
    if (!currentVideo || nextBusy) return;
    nextBusy = true;
    updateControls();
    info.textContent = 'Szukam nowej, podobnej piosenki…';
    try {
      const related = await api(`/api/youtube/related?id=${encodeURIComponent(currentVideo.id)}`);
      const played = new Set(history.map(video => video.id));
      const candidate = related.find(video => !played.has(video.id)) || related.find(video => video.id !== currentVideo.id);
      if (!candidate) throw new Error('Nie znalazłem kolejnej podobnej piosenki.');
      await startVideo(candidate, true);
    } catch (error) {
      info.textContent = error.message || 'Nie udało się znaleźć następnej piosenki.';
    } finally {
      nextBusy = false;
      updateControls();
    }
  }
  const setDesktopHidden = hidden => {
    panel.hidden = hidden;
    show.hidden = !hidden;
    try { localStorage.setItem('zapo.youtubeHidden', hidden ? '1' : '0'); } catch (_) { /* brak zapisu ustawienia nie blokuje panelu */ }
  };
  function syncPosition() {
    if (compactScreen.matches) {
      if (topbar && themeToggle) topbar.insertBefore(show, themeToggle.nextSibling);
      panel.hidden = !mobileOpen;
      show.hidden = false;
      return;
    }
    if (show.parentElement !== document.body) document.body.append(show);
    try { setDesktopHidden(localStorage.getItem('zapo.youtubeHidden') === '1'); } catch (_) { setDesktopHidden(false); }
  }
  syncPosition();
  compactScreen.addEventListener('change', () => { mobileOpen = false; syncPosition(); });
  hide.addEventListener('click', () => {
    if (compactScreen.matches) { mobileOpen = false; syncPosition(); }
    else setDesktopHidden(true);
  });
  show.addEventListener('click', () => {
    if (compactScreen.matches) { mobileOpen = true; syncPosition(); query.focus(); }
    else setDesktopHidden(false);
  });
  previous.addEventListener('click', () => {
    if (historyIndex <= 0) return;
    historyIndex -= 1;
    void startVideo(history[historyIndex], false);
  });
  next.addEventListener('click', () => { void playSimilar(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const text = query.value.trim();
    if (!text) return;
    info.textContent = 'Szukam filmów…';
    results.innerHTML = '';
    try {
      videos = await api(`/api/youtube/search?q=${encodeURIComponent(text)}`);
      info.textContent = videos.length ? `Wyniki dla: ${text}` : 'Nie znaleziono filmów.';
      results.innerHTML = videos.map(video => `<button type="button" class="youtube-result" data-video="${esc(video.id)}"><img src="${esc(video.thumbnail)}" alt=""><span><b>${esc(video.title)}</b><small>${esc(video.channel)}</small></span></button>`).join('');
    } catch (error) { info.textContent = error.message; }
  });
  results.addEventListener('click', event => {
    const item = event.target.closest('[data-video]');
    if (!item) return;
    const video = videos.find(entry => entry.id === item.dataset.video);
    void startVideo(video, true);
  });
})();
