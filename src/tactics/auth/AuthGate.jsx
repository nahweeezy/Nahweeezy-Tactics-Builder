import { useEffect, useState, useCallback } from 'react';
import { supabase, fetchProfile } from '../supabase';
import LoginRegister from './LoginRegister';
import UsernameModal from './UsernameModal';
import { identify } from '../analytics';

/**
 * Wraps the tactics builder. Three states:
 *   1. No session         → show LoginRegister overlay (UI behind it is grayed out)
 *   2. Session, no profile → show UsernameModal
 *   3. Authed + profile    → render children with { session, profile, signOut }
 *
 * `children` is a render-prop function. We always render the underlying app
 * so the user sees the dimmed pitch behind the login modal.
 */
export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

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
        authReady: bootstrapped && !profileLoading,
      })}
      {/* Login overlay over a grayed-out app */}
      {bootstrapped && !session && <LoginRegister />}
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
