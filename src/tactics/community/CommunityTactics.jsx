import { useEffect, useState, useMemo, useCallback } from 'react';
import { listSharedTactics, publishTactic, supabase } from '../supabase';
import { track } from '../analytics';

/**
 * Community Tactics tab — sits in the right side panel under the Concept Playbook.
 * Browse, search, and load community-published tactics. Authenticated users
 * can publish their current tactic.
 */
export default function CommunityTactics({ session, profile, currentTactic, onLoad }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [error, setError] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const [publishOpen, setPublishOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: err } = await listSharedTactics({ limit: 100 });
    if (err) setError(err.message);
    else setItems(data);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => {
      const name = (it.name || '').toLowerCase();
      const author = (it.profiles?.username || '').toLowerCase();
      const desc = (it.description || '').toLowerCase();
      return name.includes(q) || author.includes(q) || desc.includes(q);
    });
  }, [items, search]);

  const onPublish = async ({ name, description }) => {
    setPublishing(true);
    const { error: err } = await publishTactic({
      name, description,
      data: currentTactic.data,
    });
    setPublishing(false);
    if (err) {
      setError(err.message);
      return;
    }
    track.publishTactic({ name });
    setPublishOpen(false);
    refresh();
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-extrabold tracking-[0.3em] text-blue-400
                        font-display">
          COMMUNITY TACTICS
        </div>
        {session && profile && (
          <button onClick={() => setPublishOpen(true)}
            className="text-[9px] font-extrabold tracking-wider px-2 py-0.5
                       bg-blue-400/20 hover:bg-blue-400/30
                       border border-blue-400/40 text-blue-200 rounded font-display">
            + PUBLISH
          </button>
        )}
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search by tactic, user, description…"
        className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5
                   text-xs focus:outline-none focus:border-blue-400 mb-2"
      />

      {error && (
        <div className="p-2 bg-rose-500/15 border border-rose-500/30 rounded
                        text-[11px] text-rose-200 mb-2">
          ⚠ {error}
        </div>
      )}
      {loading && (
        <div className="p-3 text-center text-slate-400 text-[11px]">Loading community…</div>
      )}

      <div className="space-y-1.5 max-h-72 overflow-auto pr-0.5">
        {filtered.map((it) => (
          <button key={it.id}
            onClick={() => {
              onLoad(it);
              track.loadTactic({ shared_id: it.id, name: it.name });
            }}
            className="w-full text-left p-2 bg-white/[0.03] hover:bg-blue-400/10
                       border border-white/10 hover:border-blue-400/40 rounded transition group">
            <div className="text-[12px] font-extrabold truncate group-hover:text-blue-200
                            font-display tracking-[0.04em]">
              {it.name}
            </div>
            <div className="text-[10px] text-slate-400 font-mono mt-0.5 flex items-center gap-2">
              <span className="text-blue-300/80">@{it.profiles?.username || 'anon'}</span>
              <span>·</span>
              <span>{new Date(it.created_at).toLocaleDateString()}</span>
            </div>
            {it.description && (
              <div className="text-[10px] text-slate-500 mt-1 line-clamp-2">
                {it.description}
              </div>
            )}
          </button>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="py-4 text-center text-slate-500 text-[11px]">
            {items.length === 0 ? 'Be the first to publish a tactic.' : 'No matches.'}
          </div>
        )}
      </div>

      {publishOpen && (
        <PublishModal
          defaultName={currentTactic?.name}
          loading={publishing}
          onClose={() => setPublishOpen(false)}
          onSubmit={onPublish}
        />
      )}
    </section>
  );
}

function PublishModal({ defaultName, loading, onClose, onSubmit }) {
  const [name, setName] = useState(defaultName || '');
  const [description, setDescription] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSubmit({ name: name.trim(), description: description.trim() });
  };

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4
                    bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <form onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        className="w-full max-w-sm rounded-xl border border-white/10 bg-[#0d141f]
                   shadow-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between
                        bg-gradient-to-r from-blue-500/[0.08] to-transparent">
          <div>
            <div className="text-base font-extrabold font-display tracking-[2px]">
              PUBLISH TO COMMUNITY
            </div>
            <div className="text-[10px] text-slate-400 font-mono">Anyone can browse it.</div>
          </div>
          <button type="button" onClick={onClose}
            className="w-7 h-7 rounded bg-white/5 hover:bg-white/15 text-slate-300 hover:text-white">
            ×
          </button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="text-[9px] font-extrabold tracking-[0.25em] text-slate-400
                              font-display block mb-1">TITLE</label>
            <input value={name} onChange={(e) => setName(e.target.value)}
              maxLength={80} required
              className="w-full bg-black/40 border border-white/10 rounded
                         px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
          </div>
          <div>
            <label className="text-[9px] font-extrabold tracking-[0.25em] text-slate-400
                              font-display block mb-1">DESCRIPTION</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Optional — describe the idea so people get it at a glance."
              className="w-full bg-black/40 border border-white/10 rounded
                         px-3 py-2 text-sm focus:outline-none focus:border-blue-400 resize-none" />
          </div>
          <button type="submit" disabled={loading || !name.trim()}
            className="w-full py-2.5 rounded bg-blue-500 hover:bg-blue-400
                       text-white font-extrabold text-sm font-display
                       tracking-widest transition disabled:opacity-50">
            {loading ? '…' : 'PUBLISH'}
          </button>
        </div>
      </form>
    </div>
  );
}
