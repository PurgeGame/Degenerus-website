// Run in the head so a saved preference is applied before the page paints.
(function () {
  'use strict';
  const key = 'dgn.reader.theme';
  const root = document.documentElement;
  const system = window.matchMedia('(prefers-color-scheme: dark)');
  let preference = null;

  function valid(value) {
    return value === 'light' || value === 'dark' ? value : null;
  }

  try { preference = valid(localStorage.getItem(key)); } catch { /* Storage may be blocked. */ }

  function apply() {
    const theme = preference || (system.matches ? 'dark' : 'light');
    root.dataset.theme = theme;
    document.querySelectorAll('[data-reader-theme-toggle]').forEach(button => {
      const next = theme === 'dark' ? 'Light' : 'Dark';
      button.querySelector('[data-theme-label]').textContent = next + ' mode';
      button.setAttribute('aria-label', 'Switch to ' + next.toLowerCase() + ' mode');
      button.hidden = false;
    });
    window.dispatchEvent(new CustomEvent('reader-theme-change', { detail: { theme } }));
  }

  apply();
  system.addEventListener('change', () => { if (!preference) apply(); });
  window.addEventListener('storage', event => {
    if (event.key !== key && event.key !== null) return;
    preference = valid(event.newValue);
    apply();
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-reader-theme-toggle]').forEach(button => {
      button.addEventListener('click', () => {
        preference = root.dataset.theme === 'dark' ? 'light' : 'dark';
        try { localStorage.setItem(key, preference); } catch { /* Still switch for this visit. */ }
        apply();
      });
    });
    apply();
  }, { once: true });
})();
