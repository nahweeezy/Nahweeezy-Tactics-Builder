import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './tailwind.css';
import AuthGate from './auth/AuthGate';
import TacticsBuilder from './TacticsBuilder';

const root = createRoot(document.getElementById('root'));
root.render(
  <StrictMode>
    <AuthGate>
      {(authProps) => <TacticsBuilder {...authProps} />}
    </AuthGate>
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
