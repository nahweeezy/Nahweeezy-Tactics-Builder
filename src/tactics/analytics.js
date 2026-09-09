/**
 * Google Analytics 4.
 *
 * The gtag stub is defined inline in each HTML entry, so calls made before
 * the GA script finishes loading queue safely in `dataLayer`. When no
 * measurement id is configured the stub still exists — every helper here
 * becomes a no-op and no network request is made.
 *
 * Event taxonomy: names are deliberately few and broad, with the specifics
 * carried in parameters (`board_action` + `action`, rather than one event
 * name per button). GA4 caps a property at 500 distinct event names and
 * reports far better on a small, stable set.
 *
 * NOTE: custom parameters below (`action`, `tool`, `option`, `theme`, …)
 * only show up in GA4 reports once registered as custom dimensions under
 * Admin → Custom definitions. They land in the raw/BigQuery export either way.
 */
const ID = import.meta.env.VITE_GA_MEASUREMENT_ID;

// Vite leaves `%VITE_GA_MEASUREMENT_ID%` verbatim in the HTML when the var is
// unset, and local dev uses a `G-STUB` placeholder — neither should ever boot
// a real GA request.
const VALID_ID = /^G-[A-Z0-9]{4,}$/i.test(ID || '') && ID !== 'G-STUB';

// `?ga_debug=1` (sticky, cleared with ?ga_debug=0) logs every event locally so
// wiring can be verified without waiting on GA's DebugView.
const DEBUG = (() => {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('ga_debug');
    if (q === '1') localStorage.setItem('ga_debug', '1');
    if (q === '0') localStorage.removeItem('ga_debug');
    return localStorage.getItem('ga_debug') === '1';
  } catch { return false; }
})();

export const analyticsEnabled = VALID_ID;

function safeGtag(...args) {
  if (typeof window === 'undefined') return;
  if (typeof window.gtag !== 'function') return;
  try { window.gtag(...args); } catch { /* never let telemetry break the app */ }
}

/** Drop null/undefined/'' so GA4 isn't fed empty params. */
function clean(params) {
  const out = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined || v === '') continue;
    out[k] = typeof v === 'boolean' ? (v ? 1 : 0) : v;
  }
  return out;
}

/** Track a custom event. `params` is any object; GA4 accepts arbitrary keys. */
export function trackEvent(name, params = {}) {
  const payload = clean(params);
  if (DEBUG) console.debug('[ga]', name, payload);
  if (!VALID_ID) return;
  safeGtag('event', name, payload);
}

/** Track a page view (Vite SPA-like nav). */
export function trackPage(path) {
  if (!VALID_ID) return;
  safeGtag('config', ID, { page_path: path });
}

/**
 * Ties events to a stable pseudonymous id so sessions join across devices.
 * The Supabase user UUID only — never the email address, which GA4
 * prohibits as PII.
 */
export function identify(userId) {
  if (DEBUG) console.debug('[ga] identify', userId || '(anonymous)');
  if (!VALID_ID) return;
  safeGtag('set', { user_id: userId || undefined });
  safeGtag('set', 'user_properties', { signed_in: userId ? 'yes' : 'no' });
}

// Convenience wrappers used throughout the app.
export const track = {
  /* ── lifecycle ─────────────────────────────────────────── */
  appReady:          (extra)  => trackEvent('app_ready', extra),
  ctaClick:          (cta, location) => trackEvent('cta_click', { cta, location }),
  adBoardClick:      (brand, placement) => trackEvent('ad_board_click', { brand, placement }),

  /* ── auth ──────────────────────────────────────────────── */
  login:             (method) => trackEvent('login', { method }),
  register:          (method) => trackEvent('sign_up', { method }),
  logout:            (where)  => trackEvent('logout', { where }),
  usernameSet:       ()       => trackEvent('username_set'),

  /* ── board setup ───────────────────────────────────────── */
  loadFormation:     (formation) => trackEvent('formation_loaded', { formation }),
  teamFilter:        (team)   => trackEvent('team_filter_changed', { team }),
  togglePossession:  (mode)   => trackEvent('possession_toggle', { mode }),
  viewMode:          (mode)   => trackEvent('view_mode_changed', { mode }),
  /** mirror | balance_symmetry | compare_on | compare_off | undo | redo | clear_overlays */
  boardAction:       (action, extra) => trackEvent('board_action', { action, ...extra }),

  /* ── drawing ───────────────────────────────────────────── */
  selectTool:        (tool)   => trackEvent('tool_selected', { tool }),
  drawingCreated:    (kind, extra) => trackEvent('drawing_created', { kind, ...extra }),
  drawingErased:     (kind)   => trackEvent('drawing_erased', { kind }),

  /* ── players ───────────────────────────────────────────── */
  positionChanged:   (from, to) => trackEvent('player_position_changed', { from, to }),
  playerNamed:       (extra)  => trackEvent('player_named', extra),
  faceAssigned:      (extra)  => trackEvent('face_assigned', extra),
  faceCleared:       (where)  => trackEvent('face_cleared', { where }),
  searchPlayer:      (q)      => trackEvent('player_search', { search_term: q }),
  multiSelect:       (count)  => trackEvent('players_multi_selected', { count }),
  unitDragged:       (count)  => trackEvent('unit_dragged', { count }),

  /* ── phases ────────────────────────────────────────────── */
  /** save | clear | rename | add_slot | step | exit */
  phaseAction:       (action, extra) => trackEvent('phase_action', { action, ...extra }),
  playPhases:        (extra)  => trackEvent('phase_animation_play', extra),

  /* ── personalisation ───────────────────────────────────── */
  displayOption:     (option, enabled) => trackEvent('display_option_toggled', { option, enabled }),
  themeChanged:      (theme)  => trackEvent('theme_changed', { theme }),
  kitChanged:        (team, color) => trackEvent('kit_changed', { team, color }),

  /* ── persistence ───────────────────────────────────────── */
  saveTactic:        (extra)  => trackEvent('tactic_saved', extra),
  publishTactic:     (extra)  => trackEvent('tactic_published', extra),
  loadTactic:        (extra)  => trackEvent('tactic_loaded', extra),
  deleteTactic:      (extra)  => trackEvent('tactic_deleted', extra),
  exportTactic:      (extra)  => trackEvent('tactic_exported', extra),
};
