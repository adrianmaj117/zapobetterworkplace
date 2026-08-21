(() => {
  const token = localStorage.getItem('zapoToken');
  if (!token) return;
  fetch('/api/session', { headers: { 'x-session-token': token } })
    .then(response => response.ok ? response.json() : null)
    .then(session => { if (session?.capabilities?.driverPlanner) location.replace('/planer-dostaw.html'); })
    .catch(() => {});
})();
