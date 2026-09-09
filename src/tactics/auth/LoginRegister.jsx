import { useState } from 'react';
import { supabase } from '../supabase';
import { track, trackEvent } from '../analytics';

/**
 * Login + Register modal that floats above a dimmed app background.
 * Toggles between two tabs. Includes Google + Discord OAuth buttons.
 */
export default function LoginRegister({ onGuest }) {
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null); setInfo(null); setLoading(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        track.login('email');
      } else {
        const { data, error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        track.register('email');
        if (data.session === null) {
          setInfo('Check your email to confirm your account, then come back to log in.');
        }
      }
    } catch (err) {
      trackEvent('auth_error', { method: 'email', mode, reason: String(err?.message || '').slice(0, 80) });
      setError(err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  const oauth = async (provider) => {
    setError(null);
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: window.location.href },
    });
    if (error) {
      trackEvent('auth_error', { method: provider, mode: 'oauth', reason: String(error.message || '').slice(0, 80) });
      setError(error.message);
    } else track.login(provider);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4
                    bg-black/75 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-ink/10 bg-s2
                      shadow-[0_30px_80px_rgba(0,0,0,0.7),0_0_60px_rgba(215,255,60,0.10)]
                      overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-ink/10
                        bg-gradient-to-r from-accent/[0.08] to-transparent">
          <div className="text-[10px] font-extrabold tracking-[0.4em] text-accent mb-1
                          font-display">
            NAHWEEEZY'S TACTICS BOARD
          </div>
          <h1 className="text-2xl font-extrabold text-ink tracking-wide font-display">
            {mode === 'login' ? 'WELCOME BACK' : 'CREATE ACCOUNT'}
          </h1>
          <p className="text-[12px] text-mute mt-1">
            {mode === 'login'
              ? 'Log in to access the coaching board, save tactics & publish to the community.'
              : 'Make an account to save tactics, share with the community, and pick PL players.'}
          </p>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-ink/10">
          {['login', 'register'].map((m) => (
            <button key={m}
              onClick={() => { setMode(m); setError(null); setInfo(null); }}
              className={`flex-1 py-3 text-xs font-extrabold tracking-[0.25em] transition
                          font-display
                          ${mode === m
                            ? 'bg-accent/[0.08] text-accent border-b-2 border-accent'
                            : 'text-mute hover:text-ink border-b-2 border-transparent'}`}>
              {m === 'login' ? 'LOG IN' : 'REGISTER'}
            </button>
          ))}
        </div>

        <div className="p-6 space-y-3">
          {/* OAuth buttons */}
          <button onClick={() => oauth('google')}
            className="w-full flex items-center justify-center gap-3 py-2.5 rounded
                       bg-white text-slate-900 font-bold text-sm hover:bg-slate-100
                       transition border border-ink/10">
            <GoogleIcon />
            Continue with Google
          </button>
          <button onClick={() => oauth('discord')}
            className="w-full flex items-center justify-center gap-3 py-2.5 rounded
                       bg-[#5865F2] text-ink font-bold text-sm hover:bg-[#4752c4]
                       transition border border-[#5865F2]/40">
            <DiscordIcon />
            Continue with Discord
          </button>

          <div className="flex items-center gap-3 my-2">
            <div className="flex-1 h-px bg-white/10" />
            <div className="text-[9px] tracking-[0.3em] text-dim font-display">OR EMAIL</div>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="text-[9px] font-extrabold tracking-[0.25em] text-mute
                                font-display block mb-1">EMAIL</label>
              <input type="email" required value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full bg-well/50 border border-ink/10 rounded
                           px-3 py-2 text-sm text-ink placeholder-dim caret-accent
                           focus:outline-none focus:border-accent" />
            </div>
            <div>
              <label className="text-[9px] font-extrabold tracking-[0.25em] text-mute
                                font-display block mb-1">PASSWORD</label>
              <input type="password" required minLength={6} value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-well/50 border border-ink/10 rounded
                           px-3 py-2 text-sm text-ink placeholder-dim caret-accent
                           focus:outline-none focus:border-accent" />
            </div>

            {error && (
              <div className="p-2.5 bg-rose-500/15 border border-rose-500/30
                              rounded text-[12px] text-rose-200">
                ⚠ {error}
              </div>
            )}
            {info && (
              <div className="p-2.5 bg-accent/15 border border-accent/30
                              rounded text-[12px] text-accent">
                ✉ {info}
              </div>
            )}

            <button type="submit" disabled={loading}
              className="w-full py-2.5 rounded bg-accent hover:brightness-110
                         text-acc-ink font-extrabold text-sm font-display
                         tracking-widest transition shadow-[0_0_14px_rgba(215,255,60,0.4)]
                         disabled:opacity-50">
              {loading ? '…' : mode === 'login' ? 'LOG IN' : 'CREATE ACCOUNT'}
            </button>
          </form>

          {onGuest && (
            <>
              <div className="flex items-center gap-3 pt-1">
                <div className="flex-1 h-px bg-ink/10" />
                <div className="text-[9px] tracking-[0.3em] text-dim font-display">OR</div>
                <div className="flex-1 h-px bg-ink/10" />
              </div>
              <button type="button" onClick={onGuest}
                className="w-full py-2.5 rounded border border-accent/40 bg-accent/10
                           hover:bg-accent/20 text-accent font-extrabold text-sm
                           font-display tracking-widest transition">
                SKIP — USE THE BOARD
              </button>
              <p className="text-[10px] text-dim leading-snug text-center">
                The full board, drawing tools and PNG export work without an account.
                Saving to the cloud and publishing to the community need one.
              </p>
            </>
          )}

          <div className="text-center">
            <a href="index.html"
              className="text-[10px] font-extrabold tracking-[0.25em] text-dim
                         hover:text-accent font-display">
              ← BACK TO LANDING
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5h-1.9V20H24v8h11.3c-1.6 4.7-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z"/>
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2c-2 1.5-4.5 2.4-7.2 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.6 39.6 16.2 44 24 44z"/>
      <path fill="#1976D2" d="M43.6 20.5h-1.9V20H24v8h11.3c-.7 2.2-2.1 4-3.9 5.4l6.2 5.2c-.5.5 6.7-4.9 6.7-14.6 0-1.3-.1-2.4-.4-3.5z"/>
    </svg>
  );
}

function DiscordIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 71 55" fill="currentColor" aria-hidden="true">
      <path d="M60.1045 4.8978C55.5792 2.8214 50.7265 1.2916 45.6527 0.41542C45.5603 0.39851 45.468 0.440769 45.4204 0.525289C44.7963 1.6353 44.105 3.0834 43.6209 4.2216C38.1637 3.4046 32.7345 3.4046 27.3892 4.2216C26.905 3.0581 26.1886 1.6353 25.5617 0.525289C25.5141 0.443589 25.4218 0.40133 25.3294 0.41542C20.2584 1.2888 15.4057 2.8186 10.8776 4.8978C10.8384 4.9147 10.8048 4.9429 10.7825 4.9795C1.57795 18.7309 -0.943343 32.1443 0.293408 45.3914C0.299005 45.4562 0.335386 45.5182 0.385761 45.5576C6.45866 50.0174 12.3413 52.7249 18.1147 54.5195C18.2071 54.5477 18.305 54.5139 18.3638 54.4378C19.7295 52.5728 20.9469 50.6063 21.9907 48.5383C22.0523 48.4172 21.9935 48.2735 21.8676 48.2256C19.9366 47.4931 18.0979 46.6 16.3292 45.5858C16.1893 45.5041 16.1781 45.304 16.3068 45.2082C16.679 44.9293 17.0513 44.6391 17.4067 44.3461C17.471 44.2926 17.5606 44.2813 17.6362 44.3151C29.2558 49.6202 41.8354 49.6202 53.3179 44.3151C53.3935 44.2785 53.4831 44.2898 53.5502 44.3433C53.9057 44.6363 54.2779 44.9293 54.6529 45.2082C54.7816 45.304 54.7732 45.5041 54.6333 45.5858C52.8646 46.6197 51.0259 47.4931 49.0921 48.2228C48.9662 48.2707 48.9102 48.4172 48.9718 48.5383C50.038 50.6035 51.2554 52.5699 52.5959 54.435C52.6519 54.5139 52.7526 54.5477 52.845 54.5195C58.6464 52.7249 64.529 50.0174 70.6019 45.5576C70.6551 45.5182 70.6887 45.459 70.6943 45.3942C72.1747 30.0791 68.2147 16.7757 60.1968 4.9823C60.1772 4.9429 60.1437 4.9147 60.1045 4.8978ZM23.7259 37.3253C20.2276 37.3253 17.3451 34.1136 17.3451 30.1693C17.3451 26.225 20.1717 23.0133 23.7259 23.0133C27.308 23.0133 30.1626 26.2532 30.1066 30.1693C30.1066 34.1136 27.28 37.3253 23.7259 37.3253ZM47.3178 37.3253C43.8196 37.3253 40.9371 34.1136 40.9371 30.1693C40.9371 26.225 43.7636 23.0133 47.3178 23.0133C50.9 23.0133 53.7545 26.2532 53.6986 30.1693C53.6986 34.1136 50.9 37.3253 47.3178 37.3253Z"/>
    </svg>
  );
}
