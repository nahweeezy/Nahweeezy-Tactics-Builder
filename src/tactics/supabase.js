import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !key) {
  // Fail loudly in dev — Vercel will catch missing env vars at runtime in console.
  // eslint-disable-next-line no-console
  console.error(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
    'Copy .env.example to .env (and set them on Vercel).'
  );
}

export const supabase = createClient(url ?? '', key ?? '', {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});

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
