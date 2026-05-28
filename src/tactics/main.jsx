import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tailwind.css';
import AuthGate from './auth/AuthGate';
import TacticsBuilder from './TacticsBuilder';

// Skip the login gate and render the builder with a null session.
// Enable by either:
//   • setting VITE_BYPASS_AUTH=1 in .env (works in any build), or
//   • appending ?bypass=1 to the URL (dev builds only — ignored in prod)
const bypassAuth =
  import.meta.env.VITE_BYPASS_AUTH === '1' ||
  (import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get('bypass') === '1');

const root = createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    {bypassAuth ? (
      <TacticsBuilder session={null} profile={null} signOut={() => {}} />
    ) : (
      <AuthGate>
        {(authProps) => <TacticsBuilder {...authProps} />}
      </AuthGate>
    )}
  </StrictMode>
);

// Hide the boot overlay (and cancel its diagnostic fallback timer)
if (window.__bootFallback__) clearTimeout(window.__bootFallback__);
const boot = document.getElementById('boot');
if (boot) {
  setTimeout(() => {
    boot.classList.add('hidden');
    setTimeout(() => boot.remove(), 500);
  }, 80);
}
