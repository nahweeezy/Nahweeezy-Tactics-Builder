# Nahweeezy's Tactics Board

A browser based tactical sandbox that allows visualization + animation of tactical football nuance - things such as in/out of possession setups, transitions, etc. 

This was intended to be used in conjunction with my YT page _Nahweeezy_, but I think it has a lot of potential as a product entirely. 

There's a couple other QOL features as well — chiefly **Player Mode**, which drops real footballers onto the board with background-removed face cutouts, pulled from my [football-faces](https://github.com/nahweeezy/football-faces) dataset (~7,300 players).

## Stack

Vite + React + Supabase + Tailwind. Multi-page rollup so the marketing landing (`/`) and the React app (`/tactics`) ship as separate entries that share a build pipeline.

```
/                                # repo root
├── index.html                   # landing page entry
├── tactics.html                 # tactics builder entry (mounts the React app)
├── style.css                    # landing styles (lp-* design system)
├── vite.config.js               # multi-page rollup (landing + tactics)
├── tailwind.config.js
├── postcss.config.js
├── package.json
├── vercel.json                  # Vite preset + /tactics rewrite
├── .env.example
├── scripts/
│   └── build-faces-index.mjs    # regenerates the player index from football-faces
├── src/
│   ├── landing/
│   │   └── main.js              # nav auth slot + smooth-scroll
│   └── tactics/
│       ├── main.jsx             # mounts <AuthGate><TacticsBuilder/></AuthGate>
│       ├── TacticsBuilder.jsx   # the big React component (~3,000 LOC)
│       ├── Pitch3D.jsx          # optional Three.js stadium overlay
│       ├── faces.js             # player index loader + search (football-faces)
│       ├── data/
│       │   └── faces-index.json # generated: ~7,300 players, code-split chunk
│       ├── ErrorBoundary.jsx
│       ├── supabase.js          # Supabase client + helpers
│       ├── analytics.js         # GA4 wrapper (track.* helpers)
│       ├── tailwind.css         # Tailwind directives + @font-face + utilities
│       ├── auth/                # AuthGate, LoginRegister, UsernameModal
│       └── community/           # CommunityTactics public DB panel
├── public/
│   └── assets/{fonts,icons,legal}/   # copied verbatim into /dist
└── supabase/
    └── migrations/
        └── 20260504_init.sql    # tables, RLS policies, triggers
```

## Quick start

```bash
# 1. Install deps
npm install

# 2. Set env vars (copy and fill in)
cp .env.example .env
#   VITE_SUPABASE_URL=https://your-project.supabase.co
#   VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1...
#   VITE_GA_MEASUREMENT_ID=G-XXXXXXXXXX

# 3. Run the migration on your Supabase project (once)
#    Either paste supabase/migrations/20260504_init.sql into the Supabase SQL editor,
#    or use the Supabase CLI:
#       supabase db push

# 4. Dev server
npm run dev   # → http://localhost:5173

# 5. Production build
npm run build
```

## Deploy (Vercel)

1. Push to GitHub.
2. Import the repo on Vercel — it auto-detects **Vite**.
3. Add environment variables under **Settings → Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_GA_MEASUREMENT_ID`
4. Deploy.

> The Supabase anon key is meant to be public — but make sure your Postgres tables have RLS policies enabled (they are in the migration).

## Auth providers

Email/password + Google + Discord OAuth are all wired in. Enable each in **Supabase → Authentication → Providers**, and add your Vercel preview/production URLs to the allowed redirect list:

- `https://your-domain.vercel.app/tactics.html`
- `http://localhost:5173/tactics.html` (for dev)

## Routes

| URL              | What                                              |
|------------------|---------------------------------------------------|
| `/`              | Landing page                                      |
| `/tactics`       | Tactics builder (login required) — alias for `/tactics.html` via `vercel.json` |
| `/tactics.html`  | Same page, direct entry                           |

## Analytics (GA4)

Set `VITE_GA_MEASUREMENT_ID` and both entry points boot gtag. The id is
validated first, so an unset var (Vite leaves the `%VAR%` token verbatim) or
the local `G-STUB` placeholder means **no GA request is made at all** — the
gtag stub still exists, so every `track.*` call is a safe no-op.

Append `?ga_debug=1` to any URL to log every event to the console instead of
waiting on GA's DebugView; `?ga_debug=0` clears it. All helpers live in
[`src/tactics/analytics.js`](src/tactics/analytics.js).

Event names are deliberately few and broad, with the specifics carried in
parameters — GA4 caps a property at 500 distinct names and reports far better
on a small, stable set.

| Event | Key params | Fires when |
|-------|-----------|------------|
| `app_ready` | `theme`, `dark_pitch`, `viewport`, `signed_in`, `touch` | Builder mounts — the baseline every other event is a delta against |
| `cta_click` | `cta`, `location` | Landing CTAs, attributed by where they were clicked |
| `ad_board_click` | `brand`, `placement` | Perimeter / 3D ad boards → your own channels |
| `login`, `sign_up` | `method` (email / google / discord) | Auth success |
| `auth_error` | `method`, `mode`, `reason` | Auth failure |
| `logout`, `username_set` | `where` | Session end / profile created |
| `formation_loaded` | `formation` | Preset picked |
| `team_filter_changed` | `team` | H / BOTH / A |
| `possession_toggle` | `mode` | IP ⇄ OOP |
| `view_mode_changed` | `mode` | 2D ⇄ 3D |
| `board_action` | `action` | mirror, balance_symmetry, compare_on/off, undo, redo, clear_overlays |
| `tool_selected` | `tool` | Toolbar rail |
| `drawing_created` | `kind`, `color`, `style` | Arrow / shape / zone / text / press placed |
| `drawing_erased` | `kind` | Eraser used |
| `player_position_changed` | `from`, `to` | Position grid |
| `player_named` | `has_face` | Name field committed (once per edit, not per keystroke) |
| `face_assigned` | `player_id`, `player_name`, `role`, `nation` | Face picked |
| `face_cleared` | `where` | Face removed |
| `player_search` | `search_term` | Debounced face-picker search |
| `players_multi_selected` | `count` | Shift+click selection |
| `unit_dragged` | `count` | Structure line dragged |
| `phase_action` | `action`, `index`, `total` | save, clear, rename, add_slot, exit |
| `phase_animation_play` | `count` | ▶ Play |
| `display_option_toggled` | `option`, `enabled` | Any Display Options switch |
| `theme_changed` | `theme` | Theme picker |
| `kit_changed` | `team`, `color` | Team kit recoloured |
| `tactic_saved` / `_loaded` / `_deleted` | `where`, `name` | localStorage + community |
| `tactic_published` | `name`, `status` | Community publish (success **and** error) |
| `tactic_exported` | `format`, `status`, `faces`, `view`, `ms` | PNG / JSON export, with timing |
| `community_search` | `search_term` | Debounced community filter |

> Custom parameters (`action`, `tool`, `option`, `theme`, …) only appear in GA4
> reports once registered under **Admin → Custom definitions**. They're in the
> raw and BigQuery export either way.

`identify(userId)` sets GA's `user_id` to the Supabase UUID so sessions join
across devices. The email address is never sent — GA4 prohibits PII.

## Player Mode (football-faces)

Turn on **Real Player Faces** in Visual Display Settings, then click any token to
open the picker. It filters by the token's actual role — a left-back token lists
left-backs, not "defenders" — plus nationality and a name search that ignores
accents (`mbappe` finds Mbappé).

Data comes from [football-faces](https://github.com/nahweeezy/football-faces).
The upstream `metadata.json` is ~4.3 MB, so a build step flattens it into a
compact index that ships as its own lazily-imported chunk (~184 KB gzipped,
loaded only when Player Mode is first opened). Face cutouts stream from jsDelivr
on demand and are inlined as data URIs during PNG export.

```bash
npm run faces:build   # regenerate src/tactics/data/faces-index.json
```

Re-run that whenever the faces repo gains players. The generated file is
committed, so a plain `npm install && npm run build` needs no network.

## Credits

Player photos and biographical data originate from **Transfermarkt**, via the
[football-faces](https://github.com/nahweeezy/football-faces) dataset. This
project is unofficial and not affiliated with or endorsed by Transfermarkt; the
underlying images and data remain the property of Transfermarkt and their
respective rights holders.

## What's intentionally NOT in this repo

The original combined project also shipped an FM26 tactic creator and a Squads daily picker game. Those live separately now:

- Squads / Pluck: <https://github.com/nahweeezy/Pluck>
- FM26 Creator: kept locally as a backup
