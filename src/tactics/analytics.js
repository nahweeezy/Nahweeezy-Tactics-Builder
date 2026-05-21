// Minimal Google Analytics 4 helpers — gtag is loaded by the HTML.
const ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

function safeGtag(...args) {
  if (typeof window === 'undefined') return;
  if (typeof window.gtag !== 'function') return;
  try { window.gtag(...args); } catch { /* ignore */ }
}

/** Track a custom event. `params` is any object; GA4 accepts arbitrary keys. */
export function trackEvent(name, params = {}) {
  if (!ID) return;
  safeGtag('event', name, params);
}

/** Track a page view (Vite SPA-like nav). */
export function trackPage(path) {
  if (!ID) return;
  safeGtag('config', ID, { page_path: path });
}

// Convenience wrappers used throughout the app
export const track = {
  saveTactic:        (extra) => trackEvent('tactic_saved', extra),
  publishTactic:     (extra) => trackEvent('tactic_published', extra),
  loadTactic:        (extra) => trackEvent('tactic_loaded', extra),
  togglePossession:  (mode)  => trackEvent('possession_toggle', { mode }),
  playPhases:        (extra) => trackEvent('phase_animation_play', extra),
  login:             (method) => trackEvent('login', { method }),
  register:          (method) => trackEvent('sign_up', { method }),
  searchPlayer:      (q)      => trackEvent('player_search', { search_term: q }),
};
