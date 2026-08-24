/**
 * Builds the compact player index consumed by the tactics board from the
 * football-faces dataset (https://github.com/nahweeezy/football-faces).
 *
 *   node scripts/build-faces-index.mjs
 *
 * The upstream metadata.json is ~4.3 MB and carries fields the board never
 * reads (birthplace, transfermarkt slugs, source image urls). This flattens
 * it into positional arrays with de-duplicated nationality strings, which
 * ships ~10x smaller and needs no network at runtime — only the face PNGs
 * are fetched lazily, from the CDN.
 *
 * Re-run whenever the faces repo gains players.
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'nahweeezy/football-faces';
const BRANCH = 'main';
const SRC = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/metadata.json`;
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/tactics/data/faces-index.json');

// Board roles, in index order. Upstream's detailed `position` maps onto these
// directly — a far better fit than a four-bucket GK/DEF/MID/FWD split.
const ROLES = ['GK', 'CB', 'LB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];
const ROLE_BY_POSITION = {
  'Goalkeeper': 'GK',
  'Defender - Centre-Back': 'CB',
  'Defender - Sweeper': 'CB',
  'Defender - Left-Back': 'LB',
  'Defender - Right-Back': 'RB',
  'Midfield - Defensive Midfield': 'CDM',
  'Midfield - Central Midfield': 'CM',
  'Midfield': 'CM',
  'Midfield - Attacking Midfield': 'CAM',
  'Midfield - Left Midfield': 'LM',
  'Midfield - Right Midfield': 'RM',
  'Attack - Left Winger': 'LW',
  'Attack - Right Winger': 'RW',
  'Attack - Centre-Forward': 'ST',
  'Attack - Second Striker': 'ST',
};
const FOOT = { right: 1, left: 2, both: 3 };

const log = (...a) => console.log('[faces-index]', ...a);

log(`fetching ${SRC}`);
const res = await fetch(SRC);
if (!res.ok) throw new Error(`upstream returned ${res.status} ${res.statusText}`);
const meta = await res.json();
const entries = Object.values(meta);
log(`${entries.length} players in upstream metadata`);

const nations = [];
const nationIdx = new Map();
const internNation = (name) => {
  if (!name) return -1;
  if (!nationIdx.has(name)) { nationIdx.set(name, nations.length); nations.push(name); }
  return nationIdx.get(name);
};

const unmapped = new Map();
const players = [];

for (const p of entries) {
  const role = ROLE_BY_POSITION[p.position];
  if (!role) unmapped.set(p.position, (unmapped.get(p.position) || 0) + 1);

  // Dual citizenship is joined with a double space ("Argentina  Italy");
  // single spaces and commas are part of country names ("Korea, South").
  const primaryNation = (p.nationality || '').split(/\s{2,}/)[0].trim();

  // full_name is only worth carrying when it says more than `name` does
  const fullName = p.full_name && p.full_name !== p.name ? p.full_name : '';
  const height = Math.round(Number(p.height_cm) || 0);

  players.push([
    p.player_id,
    p.name,
    fullName,
    Math.max(0, ROLES.indexOf(role ?? 'CM')),
    internNation(primaryNation),
    (p.date_of_birth || '').slice(0, 10),
    height,
    FOOT[(p.foot || '').toLowerCase()] || 0,
  ]);
}

// Alphabetical by common name so the picker's default listing is stable.
players.sort((a, b) => a[1].localeCompare(b[1]));

if (unmapped.size) {
  log('positions with no role mapping (defaulted to CM):');
  for (const [pos, n] of unmapped) log(`   ${n}x  ${pos || '(empty)'}`);
}

const index = {
  version: 1,
  generated: new Date().toISOString().slice(0, 10),
  source: `https://github.com/${REPO}`,
  faceBase: `https://cdn.jsdelivr.net/gh/${REPO}@${BRANCH}/faces/`,
  roles: ROLES,
  nations,
  // [id, name, fullName, roleIdx, nationIdx, dob, heightCm, foot]
  players,
};

await mkdir(dirname(OUT), { recursive: true });
const json = JSON.stringify(index);
await writeFile(OUT, json, 'utf8');

const byRole = ROLES.map((r, i) => `${r}:${players.filter(p => p[3] === i).length}`).join('  ');
log(`roles → ${byRole}`);
log(`${nations.length} nations`);
log(`wrote ${OUT} (${(json.length / 1024).toFixed(0)} KB)`);
