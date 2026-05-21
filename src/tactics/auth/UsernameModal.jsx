import { useState } from 'react';
import { createProfile, supabase } from '../supabase';

const RX = /^[a-zA-Z0-9_]{3,24}$/;

export default function UsernameModal({ userId, email, onComplete }) {
  const [username, setUsername] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    if (!RX.test(username)) {
      setError('3–24 characters · letters, numbers, underscores only.');
      return;
    }
    setLoading(true);
    const { error: err } = await createProfile(userId, username);
    setLoading(false);
    if (err) {
      const msg = err.message?.includes('duplicate')
        ? 'That username is taken.'
        : err.message || 'Could not save username.';
      setError(msg);
      return;
    }
    onComplete();
  };

  const signOut = async () => { await supabase.auth.signOut(); };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4
                    bg-black/80 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0d141f]
                      shadow-[0_30px_80px_rgba(0,0,0,0.7),0_0_60px_rgba(96,165,250,0.10)]
                      overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-white/10
                        bg-gradient-to-r from-blue-500/[0.08] to-transparent">
          <div className="text-[10px] font-extrabold tracking-[0.4em] text-blue-400 mb-1
                          font-display">
            ONE MORE STEP
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-wide font-display">
            CHOOSE A USERNAME
          </h1>
          <p className="text-[12px] text-slate-400 mt-1">
            This is how your tactics will be credited in the community feed.
          </p>
        </div>
        <form onSubmit={submit} className="p-6 space-y-3">
          <div>
            <label className="text-[9px] font-extrabold tracking-[0.25em] text-slate-400
                              font-display block mb-1">USERNAME</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)}
              autoFocus
              placeholder="e.g. nahweeezy"
              className="w-full bg-black/40 border border-white/10 rounded
                         px-3 py-2 text-sm text-white placeholder-slate-500
                         caret-blue-400
                         focus:outline-none focus:border-blue-400
                         font-display tracking-wider" />
            <div className="text-[10px] text-slate-500 mt-1 font-mono">
              3–24 chars · letters / numbers / underscores
            </div>
          </div>
          {email && (
            <div className="text-[10px] text-slate-500 font-mono tracking-wide">
              ACCOUNT: {email}
            </div>
          )}
          {error && (
            <div className="p-2.5 bg-rose-500/15 border border-rose-500/30
                            rounded text-[12px] text-rose-200">
              ⚠ {error}
            </div>
          )}
          <button type="submit" disabled={loading || !username}
            className="w-full py-2.5 rounded bg-blue-500 hover:bg-blue-400
                       text-white font-extrabold text-sm font-display
                       tracking-widest transition shadow-[0_0_14px_rgba(96,165,250,0.4)]
                       disabled:opacity-50">
            {loading ? '…' : 'CONTINUE'}
          </button>
          <button type="button" onClick={signOut}
            className="w-full py-1.5 text-[11px] font-extrabold tracking-[0.25em]
                       text-slate-500 hover:text-rose-300 font-display">
            ← SIGN OUT
          </button>
        </form>
      </div>
    </div>
  );
}
