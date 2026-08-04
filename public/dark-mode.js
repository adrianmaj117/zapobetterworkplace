/* Global, persistent colour theme for the warehouse.
 * Load this file in <head> without `defer` to apply a saved preference before
 * the page is painted. The toggle itself may be placed anywhere as #themeToggle.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'zapobetterworkplace.theme';
  const DARK = 'dark';
  const LIGHT = 'light';
  const root = document.documentElement;
  const colourMeta = () => document.querySelector('meta[name="theme-color"]');

  const readStoredTheme = () => {
    try {
      const value = localStorage.getItem(STORAGE_KEY);
      return value === DARK || value === LIGHT ? value : null;
    } catch (_) {
      return null;
    }
  };

  const systemTheme = () => (
    window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
      ? DARK
      : LIGHT
  );

  const selectedTheme = () => readStoredTheme() || systemTheme();

  function syncToggle(theme) {
    const button = document.getElementById('themeToggle');
    if (!button) return;

    const nextTheme = theme === DARK ? LIGHT : DARK;
    const nextLabel = nextTheme === DARK ? 'Włącz tryb ciemny' : 'Włącz tryb jasny';
    button.setAttribute('aria-label', nextLabel);
    button.setAttribute('title', nextLabel);
    button.setAttribute('aria-pressed', String(theme === DARK));
    button.dataset.theme = theme;

    // The host page may provide its own label. A simple empty button, or a
    // button marked with data-theme-auto-label, gets a useful default label.
    if (button.hasAttribute('data-theme-auto-label') || !button.textContent.trim()) {
      button.textContent = theme === DARK ? '☀ Tryb jasny' : '◐ Tryb ciemny';
    }
  }

  function applyTheme(theme, options = {}) {
    const validTheme = theme === DARK || theme === LIGHT ? theme : selectedTheme();
    root.dataset.theme = validTheme;
    root.style.colorScheme = validTheme;

    const meta = colourMeta();
    if (meta) meta.setAttribute('content', validTheme === DARK ? '#101914' : '#146b52');

    if (options.persist !== false) {
      try {
        localStorage.setItem(STORAGE_KEY, validTheme);
      } catch (_) {
        // Private browsing or a disabled local storage should not prevent use.
      }
    }

    syncToggle(validTheme);
    window.dispatchEvent(new CustomEvent('zapothemechange', { detail: { theme: validTheme } }));
    return validTheme;
  }

  function toggleTheme() {
    return applyTheme(root.dataset.theme === DARK ? LIGHT : DARK);
  }

  // Run immediately: when included in <head>, the document receives its theme
  // before the browser paints the warehouse and avoids a bright first flash.
  applyTheme(selectedTheme(), { persist: false });

  // Event delegation keeps working if the top bar gets refreshed dynamically.
  document.addEventListener('click', (event) => {
    const toggle = event.target.closest && event.target.closest('#themeToggle');
    if (!toggle) return;
    event.preventDefault();
    toggleTheme();
  });

  const media = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  const followSystem = () => {
    if (!readStoredTheme()) applyTheme(systemTheme(), { persist: false });
  };
  if (media) {
    if (typeof media.addEventListener === 'function') media.addEventListener('change', followSystem);
    else if (typeof media.addListener === 'function') media.addListener(followSystem);
  }

  // Make the initial state correct even if #themeToggle is inserted after this
  // script (for example by a deferred toolbar script).
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => syncToggle(root.dataset.theme));
  } else {
    syncToggle(root.dataset.theme);
  }

  window.ZapoTheme = Object.freeze({
    get: () => root.dataset.theme || selectedTheme(),
    set: (theme) => applyTheme(theme),
    toggle: toggleTheme,
    reset: () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* no-op */ }
      return applyTheme(systemTheme(), { persist: false });
    }
  });
})();
