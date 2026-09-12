import { useCallback, useEffect, useState } from 'react';

const KEY = 'nahweeezy_ui_mode';   // 'auto' | 'touch' | 'desktop'

/**
 * Should the app present its touch shell?
 *
 * Detection is capability-based rather than user-agent sniffing: a coarse
 * primary pointer plus a hover-less screen is what actually distinguishes a
 * finger from a mouse, and it catches iPadOS — which reports a desktop UA and
 * would otherwise fall through to the mouse layout.
 *
 * A narrow viewport alone also qualifies, so a small desktop window gets the
 * compact layout rather than a cramped one. The user can pin either mode.
 */
const detect = () => {
  if (typeof window === 'undefined') return false;
  const mm = (q) => window.matchMedia?.(q).matches ?? false;
  const touchFirst = mm('(pointer: coarse)') && mm('(hover: none)');
  const narrow = window.innerWidth < 900;
  return touchFirst || narrow;
};

export function useTouchUI() {
  const [pref, setPref] = useState(() => {
    try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; }
  });
  const [auto, setAuto] = useState(detect);

  useEffect(() => {
    const onResize = () => setAuto(detect());
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
    };
  }, []);

  const setMode = useCallback((mode) => {
    try { localStorage.setItem(KEY, mode); } catch {}
    setPref(mode);
  }, []);

  const touchUI = pref === 'auto' ? auto : pref === 'touch';
  return { touchUI, pref, setMode };
}

/** True when launched from the Home Screen (no Safari chrome around us). */
export function useStandalone() {
  const [standalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator?.standalone === true;
  });
  return standalone;
}
