import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

/** True when real credentials were baked in at build time. */
export const supabaseConfigured = Boolean(url && key && /^https?:\/\//.test(url));

if (!supabaseConfigured) {
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing or invalid VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. ' +
    'Auth and the community feed are disabled; the board itself still works. ' +
    'Set them in .env locally, or as repository secrets for the deploy.'
  );
}

// `createClient` throws synchronously on an empty url, which would take the
// whole bundle down and render a blank page — the exact failure mode of a
// deploy whose env vars were never configured. A placeholder keeps the module
// importable so the board loads and only the backend-backed features degrade.
export const supabase = createClient(
  supabaseConfigured ? url : 'https://placeholder.supabase.co',
  supabaseConfigured ? key : 'placeholder-anon-key',
  {
    auth: {
      autoRefreshToken: supabaseConfigured,
      persistSession: supabaseConfigured,
      detectSessionInUrl: supabaseConfigured,
    },
  },
);

/** Fetch the profile row for a uid. Returns null if missing. */
export async function fetchProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, created_at')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    // eslint-disable-next-line no-console
    console.warn('[supabase] fetchProfile error:', error.message);
    return null;
  }
  return data;
}

/** Upsert (insert) the user's profile row with the chosen username. */
export async function createProfile(userId, username) {
  const { data, error } = await supabase
    .from('profiles')
    .insert({ id: userId, username })
    .select()
    .single();
  return { data, error };
}

/** Publish a tactic to the public table. */
export async function publishTactic({ name, description, data }) {
  const { data: user } = await supabase.auth.getUser();
  if (!user?.user) return { error: { message: 'Not signed in' } };
  const { data: row, error } = await supabase
    .from('shared_tactics')
    .insert({
      user_id: user.user.id,
      name,
      description,
      data,
    })
    .select()
    .single();
  return { data: row, error };
}

/**
 * List recently shared tactics, joined with author username.
 *
 * shared_tactics.user_id has a FK to auth.users (not profiles), so PostgREST
 * can't auto-infer the join to public.profiles. Two-query fan-out works
 * everywhere, regardless of FK shape:
 *   1. fetch tactics
 *   2. fetch profiles for those user_ids in a single round trip
 *   3. attach `profiles: { username }` shape on the client
 */
export async function listSharedTactics({ q = '', limit = 50 } = {}) {
  let query = supabase
    .from('shared_tactics')
    .select('id, name, description, data, created_at, views, user_id')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (q) query = query.ilike('name', `%${q}%`);
  const { data: rows, error } = await query;
  if (error || !rows?.length) return { data: rows ?? [], error };

  const ids = [...new Set(rows.map((r) => r.user_id).filter(Boolean))];
  let profileMap = {};
  if (ids.length) {
    const { data: profs } = await supabase
      .from('profiles')
      .select('id, username')
      .in('id', ids);
    profileMap = Object.fromEntries((profs ?? []).map((p) => [p.id, p]));
  }
  const merged = rows.map((r) => ({ ...r, profiles: profileMap[r.user_id] ?? null }));
  return { data: merged, error: null };
}
