import { useEffect, useState, useCallback } from 'react';
import { supabase, fetchProfile } from '../supabase';
import LoginRegister from './LoginRegister';
import UsernameModal from './UsernameModal';
import { identify, track } from '../analytics';

const GUEST_KEY = 'nahweeezy_guest';

/**
 * Wraps the tactics builder. States:
 *   1. No session, no guest → show LoginRegister overlay (app dimmed behind)
 *   2. Guest                → render the app; account features stay disabled
 *   3. Session, no profile  → show UsernameModal
 *   4. Authed + profile     → render children with { session, profile, signOut }
 *
 * Guest mode exists because the board itself is entirely client-side — a
 * shape, some arrows and a PNG export need no account. Only publishing to
 * the community does, and that is enforced by row-level security rather
 * than by this gate, so skipping it grants nothing server-side.
 *
 * `children` is a render-prop function. We always render the underlying app
 * so the user sees the dimmed pitch behind the login modal.
 */
export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [guest, setGuest] = useState(() => {
    try { return localStorage.getItem(GUEST_KEY) === '1'; } catch { return false; }
  });

  const continueAsGuest = useCallback(() => {
    try { localStorage.setItem(GUEST_KEY, '1'); } catch {}
    track.guestMode('entered');
    setGuest(true);
  }, []);

  // Bringing the login modal back — the header's "Sign in" affordance.
  const exitGuest = useCallback(() => {
    try { localStorage.removeItem(GUEST_KEY); } catch {}
    track.guestMode('exited');
    setGuest(false);
  }, []);

  const refreshProfile = useCallback(async (userId) => {
    setProfileLoading(true);
    const p = await fetchProfile(userId);
    setProfile(p);
    setProfileLoading(false);
  }, []);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getSession().then(async ({ data: { session: s } }) => {
      if (!mounted) return;
      setSession(s);
      if (s?.user) await refreshProfile(s.user.id);
      setBootstrapped(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, s) => {
      if (!mounted) return;
      setSession(s);
      if (s?.user) {
        // A real sign-in supersedes guest mode, so the flag doesn't linger
        // and strand the user outside the login modal after a sign-out.
        try { localStorage.removeItem(GUEST_KEY); } catch {}
        setGuest(false);
        await refreshProfile(s.user.id);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    identify(null);
    await supabase.auth.signOut();
  }, []);

  // Render children always so the gated app dims behind the modal.
  // We pass null for session/profile when not authed.
  return (
    <>
      {children({
        session,
        profile,
        signOut,
        refreshProfile,
        guest: guest && !session,
        exitGuest,
        authReady: bootstrapped && !profileLoading,
      })}
      {/* Login overlay over a grayed-out app */}
      {bootstrapped && !session && !guest && (
        <LoginRegister onGuest={continueAsGuest} />
      )}
      {/* Username creation, after first signup, before app */}
      {bootstrapped && session && !profileLoading && !profile && (
        <UsernameModal
          userId={session.user.id}
          email={session.user.email}
          onComplete={() => refreshProfile(session.user.id)}
        />
      )}
    </>
  );
}
