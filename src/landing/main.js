// Landing page enhancement script — wires the optional Login/Logout button
// in the navbar against the same Supabase client used by the tactics builder.
import '../../style.css';
import { supabase, fetchProfile } from '../tactics/supabase';
import { track, identify } from '../tactics/analytics';

const slot = document.getElementById('lp-auth-slot');
if (slot) {
  render();
  supabase.auth.onAuthStateChange(() => render());
}

async function render() {
  const { data } = await supabase.auth.getSession();
  const session = data?.session;
  if (!session) {
    slot.innerHTML = `
      <a href="/tactics.html" class="lp-nav-cta lp-nav-cta-auth">
        <i class="fa-solid fa-right-to-bracket"></i>
        <span>Login</span>
      </a>`;
    return;
  }
  const profile = await fetchProfile(session.user.id);
  const display = profile?.username
    ? `@${profile.username}`
    : session.user.email?.split('@')[0] || 'You';
  slot.innerHTML = `
    <span class="lp-auth-username">${escapeHtml(display)}</span>
    <button id="lp-logout" class="lp-nav-cta lp-nav-cta-logout">
      <i class="fa-solid fa-right-from-bracket"></i>
      <span>Log out</span>
    </button>`;
  document.getElementById('lp-logout')?.addEventListener('click', async () => {
    track.logout('landing_nav');
    await supabase.auth.signOut();
    identify(null);
  });
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Smooth-scroll for anchor links (was previously script.js)
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    const id = a.getAttribute('href');
    if (id.length < 2) return;
    const t = document.querySelector(id);
    if (!t) return;
    e.preventDefault();
    t.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
});

/* ── Analytics ──────────────────────────────────────────────────
   Which entry point actually converts is the landing page's whole
   question, so every route into the app is attributed by location
   rather than lumped into one click event. Delegated from the
   document so the nav's re-rendered auth slot stays covered. */
supabase.auth.getSession()
  .then(({ data }) => identify(data?.session?.user?.id || null))
  .catch(() => {});

document.addEventListener('click', (e) => {
  const link = e.target.closest?.('a[href]');
  if (!link) return;
  const href = link.getAttribute('href') || '';

  if (href.includes('tactics.html')) {
    const location =
      link.closest('.lp-nav')    ? (link.classList.contains('lp-nav-cta-auth') ? 'nav_login' : 'nav')
      : link.closest('.lp-ctas') ? 'hero'
      : 'other';
    track.ctaClick('open_board', location);
    return;
  }
  if (href === '#features') { track.ctaClick('whats_inside', 'hero'); return; }
  // Outbound: the footer credit and anything else off-site.
  if (/^https?:/i.test(href) && !href.includes(window.location.host)) {
    try { track.ctaClick('outbound', new URL(href).hostname); } catch {}
  }
});
