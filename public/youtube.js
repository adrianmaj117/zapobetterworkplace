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
  const playlist = document.querySelector('#youtubePlaylist');
  const playlistItems = document.querySelector('#youtubePlaylistItems');
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
  let queue = [];
  let queueIndex = -1;
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
    previous.disabled = queueIndex <= 0;
    next.disabled = !currentVideo || nextBusy;
  };
  function renderPlaylist() {
    playlist.hidden = !queue.length;
    playlistItems.innerHTML = queue.map((video, index) => `<button type="button" class="youtube-queue-item ${index === queueIndex ? 'is-playing' : ''}" data-queue-index="${index}"><img src="${esc(video.thumbnail)}" alt=""><span><b>${esc(video.title)}</b><small>${esc(video.channel)}</small></span></button>`).join('');
  }
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
  async function startVideo(video, saveHistory = true, index = queueIndex) {
    if (!video?.id) return;
    currentVideo = video;
    queueIndex = index;
    if (saveHistory) saveInHistory(video);
    player.hidden = false;
    player.innerHTML = '<div id="youtubePlayerFrame"></div>';
    info.textContent = `Odtwarzanie: ${video.title}`;
    renderPlaylist();
    updateControls();
    await ensureYouTubePlayer();
    ytPlayer?.destroy?.();
    ytPlayer = new window.YT.Player('youtubePlayerFrame', {
      host: 'https://www.youtube-nocookie.com',
      videoId: video.id,
      playerVars: { autoplay: 1, rel: 0 },
      events: { onStateChange(event) { if (event.data === window.YT.PlayerState.ENDED) void playNextInQueue(); } }
    });
  }
  async function playNextInQueue() {
    if (!currentVideo || nextBusy) return;
    const nextInQueue = queue[queueIndex + 1];
    if (nextInQueue) { await startVideo(nextInQueue, true, queueIndex + 1); return; }
    nextBusy = true;
    updateControls();
    info.textContent = 'Uzupełniam kolejkę podobnymi piosenkami…';
    try {
      const related = await api(`/api/youtube/related?id=${encodeURIComponent(currentVideo.id)}`);
      const known = new Set(queue.map(video => video.id));
      queue.push(...related.filter(video => !known.has(video.id) && video.id !== currentVideo.id));
      renderPlaylist();
      const candidate = queue[queueIndex + 1];
      if (!candidate) throw new Error('Nie znalazłem kolejnej podobnej piosenki.');
      await startVideo(candidate, true, queueIndex + 1);
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
    if (queueIndex <= 0) return;
    void startVideo(queue[queueIndex - 1], false, queueIndex - 1);
  });
  next.addEventListener('click', () => { void playNextInQueue(); });
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
    queue = [...videos];
    void startVideo(video, true, queue.findIndex(item => item.id === video.id));
  });
  playlistItems.addEventListener('click', event => {
    const item = event.target.closest('[data-queue-index]');
    if (!item) return;
    const index = Number(item.dataset.queueIndex);
    if (queue[index]) void startVideo(queue[index], true, index);
  });
})();
