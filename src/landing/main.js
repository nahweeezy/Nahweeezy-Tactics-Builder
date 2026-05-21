// Landing page enhancement script — wires the optional Login/Logout button
// in the navbar against the same Supabase client used by the tactics builder.
import '../../style.css';
import { supabase, fetchProfile } from '../tactics/supabase';

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
    await supabase.auth.signOut();
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
