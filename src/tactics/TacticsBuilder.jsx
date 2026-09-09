/* eslint-disable */
import { useState, useEffect, useRef, useMemo, useCallback, Fragment, lazy, Suspense } from 'react';
import { track, identify } from './analytics';
import CommunityTactics from './community/CommunityTactics';
import { supabase } from './supabase';
import ErrorBoundary from './ErrorBoundary';
import { loadFaces, searchFaces, nationsFor, faceUrl, ageFrom } from './faces';
import { asset } from './assets';
// Lazy-loaded so the ~1 MB Three.js bundle is only fetched when the user
// switches to 3D mode.
const Pitch3D = lazy(() => import('./Pitch3D'));

/* =============================================================
   CONSTANTS
   ============================================================= */
const PITCH_W = 1050;
const PITCH_H = 680;
const PLAYER_R = 17;
const BALL_R = 9;
// 2400ms ≈ 1/3 of original speed — gives the eye time to track movement.
const PHASE_DURATION = 2400;

const AD_BAND_TB = 78;
const AD_BAND_LR = 72;
const VB_X = -AD_BAND_LR;
const VB_Y = -AD_BAND_TB;
const VB_W = PITCH_W + AD_BAND_LR * 2;
const VB_H = PITCH_H + AD_BAND_TB * 2;

// Pitch-content palette. These are CONTENT colors (kits, turf, chalk) — they
// stay fixed across UI themes and serialize safely into the PNG export,
// unlike the chrome which flows through CSS variables.
const COLORS = {
  pitch:     '#1e6a3b',
  pitchAlt:  '#1c6237',
  line:      'rgba(245,250,240,0.9)',
  home:      '#eef1e6',   // white kit
  homeRing:  '#9aa392',
  homeText:  '#141a0a',
  away:      '#f43f5e',   // rose kit
  awayRing:  '#9f1239',
  awayText:  '#ffffff',
  selected:  '#d7ff3c',
  accent:    '#d7ff3c',   // volt — on-pitch labels, plates, scoreboard
  accentDeep:'#9fc426',
};

const ARROW_COLORS = {
  white:   '#f8fafc',
  volt:    '#d7ff3c',
  yellow:  '#fde047',
  orange:  '#fb923c',
  cyan:    '#22d3ee',
  magenta: '#ff2e7e',
  blue:    '#60a5fa',
};
const ARROW_COLOR_KEYS = Object.keys(ARROW_COLORS);

// hex → rgba with alpha, for translucent fills derived from the palette.
const hexA = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/* ── Kit colours ───────────────────────────────────────────────
   Users can recolour both teams, so every shade the token needs —
   the highlight, the base, the rim, and the label ink — is derived
   from the one chosen colour rather than hard-coded. */
const DEFAULT_KITS = { home: '#eef1e6', away: '#f43f5e' };

const KIT_PRESETS = [
  '#eef1e6', '#f43f5e', '#d7ff3c', '#22d3ee', '#2563eb', '#7c3aed',
  '#fb923c', '#fde047', '#16a34a', '#0f172a', '#94a3b8', '#ec4899',
];

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const toRgb = (hex) => {
  const h = (hex || '#000000').replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const toHex = ({ r, g, b }) =>
  '#' + [r, g, b].map(v => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0')).join('');

/** Mix toward white (k > 0) or black (k < 0). */
const shade = (hex, k) => {
  const { r, g, b } = toRgb(hex);
  const t = k > 0 ? 255 : 0;
  const a = Math.abs(k);
  return toHex({ r: r + (t - r) * a, g: g + (t - g) * a, b: b + (t - b) * a });
};

/** WCAG relative luminance — picks ink that stays legible on any kit. */
const luminance = (hex) => {
  const { r, g, b } = toRgb(hex);
  const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const readableInk = (hex) => (luminance(hex) > 0.42 ? '#141a0a' : '#ffffff');

/** Everything a team's tokens and markers need, from one hex. */
const kitPalette = (hex) => ({
  base: hex,
  hi:   shade(hex, 0.42),
  lo:   shade(hex, -0.22),
  ring: shade(hex, -0.38),
  ink:  readableInk(hex),
  // Structure lines sit on turf, so very dark kits get lifted for contrast.
  line: luminance(hex) < 0.12 ? shade(hex, 0.55) : hex,
});

// Pitch surface skins. `grass` is the default broadcast turf; `dark` is the
// night-slate surface used by Dark Pitch mode.
const PITCH_SKINS = {
  grass: {
    pitch: '#1e6a3b', pitchAlt: '#1c6237',
    line: 'rgba(245,250,240,0.9)',
    deck: '#0b0d08', frame: 'rgba(215,255,60,0.22)',
    goalFill: 'rgba(255,255,255,0.18)',
  },
  dark: {
    pitch: '#17191d', pitchAlt: '#141619',
    line: 'rgba(226,232,240,0.5)',
    deck: '#070809', frame: 'rgba(226,232,240,0.16)',
    goalFill: 'rgba(255,255,255,0.10)',
  },
};

// Positional-structure bands: each unit of a team gets a connecting line.
const SHAPE_BANDS = [
  ['LB', 'CB', 'RB', 'LWB', 'RWB'],       // defence
  ['CDM', 'CM', 'CAM', 'LM', 'RM'],       // midfield
  ['LW', 'ST', 'RW', 'CF'],               // attack
];
/* Structure lines follow each team's kit — see `kitPalette().line`. */

// Balance Symmetry: mirrored role pairs, then central roles paired outside-in.
const MIRROR_PAIRS = [['LB', 'RB'], ['LWB', 'RWB'], ['LM', 'RM'], ['LW', 'RW']];
const CENTRAL_ROLES = ['GK', 'CB', 'CDM', 'CM', 'CAM', 'ST', 'CF'];

/* =============================================================
   POSITIONS
   ============================================================= */
const POSITION_GRID = [
  ['LW',  'ST',  'RW'],
  ['LM',  'CAM', 'RM'],
  ['LB',  'CM',  'RB'],
  ['CDM', 'CB',  'GK'],
];

// Roles the faces dataset can be filtered by. Board roles it doesn't carry
// (LWB/RWB/CF) fall back to their nearest equivalent.
const ROLE_TO_FACE_ROLE = {
  GK: 'GK', CB: 'CB', LB: 'LB', RB: 'RB', LWB: 'LB', RWB: 'RB',
  CDM: 'CDM', CM: 'CM', CAM: 'CAM', LM: 'LM', RM: 'RM',
  LW: 'LW', RW: 'RW', ST: 'ST', CF: 'ST',
};

/* =============================================================
   AD BOARDS
   ============================================================= */
const DEFAULT_ADS = [
  { id: 'yt',    label: 'YOUTUBE',  sub: '@Nahweeezy',   url: 'https://youtube.com/@Nahweeezy',  icon: asset('assets/icons/youtube.png'),  g1: '#ff0000', g2: '#990000' },
  { id: 'tt',    label: 'TIKTOK',   sub: '@Nahweeezy',   url: 'https://tiktok.com/@Nahweeezy',   icon: asset('assets/icons/tiktok.webp'),  g1: '#000000', g2: '#ff0050' },
  { id: 'dc',    label: 'DISCORD',  sub: 'Join server',  url: 'https://discord.gg/nahweeezy',    icon: asset('assets/icons/discord.webp'), g1: '#5865f2', g2: '#3a44b8' },
  { id: 'x',     label: 'X',        sub: '@Nahweeezy',   url: 'https://x.com/Nahweeezy',         icon: asset('assets/icons/x.webp'),       g1: '#0a0a0a', g2: '#272727' },
  { id: 'tw',    label: 'TWITCH',   sub: 'Live reacts',  url: 'https://twitch.tv/nahweeezy',     icon: asset('assets/icons/twitch.webp'),  g1: '#9146ff', g2: '#5c2da3' },
  { id: 'site',  label: 'WEBSITE',  sub: 'nahweeezy.tv', url: '#',                               icon: null,                            g1: '#3b82f6', g2: '#1d4ed8' },
];

function buildAdSlots(ads) {
  const list = ads.length ? ads : DEFAULT_ADS;
  const get = (i) => list[i % list.length];
  const slots = [];
  const topCount = 5;
  const topGap = 8;
  const topW = (PITCH_W - topGap * (topCount - 1)) / topCount;
  for (let i = 0; i < topCount; i++) {
    slots.push({ x: i * (topW + topGap), y: -AD_BAND_TB + 10, w: topW, h: AD_BAND_TB - 22, orientation: 'h', ad: get(i) });
  }
  for (let i = 0; i < topCount; i++) {
    slots.push({ x: i * (topW + topGap), y: PITCH_H + 12, w: topW, h: AD_BAND_TB - 22, orientation: 'h', ad: get(i + 5) });
  }
  const sideCount = 3;
  const sideGap = 8;
  const sideH = (PITCH_H - sideGap * (sideCount - 1)) / sideCount;
  for (let i = 0; i < sideCount; i++) {
    slots.push({ x: -AD_BAND_LR + 10, y: i * (sideH + sideGap), w: AD_BAND_LR - 22, h: sideH, orientation: 'v', ad: get(i + 10) });
  }
  for (let i = 0; i < sideCount; i++) {
    slots.push({ x: PITCH_W + 12, y: i * (sideH + sideGap), w: AD_BAND_LR - 22, h: sideH, orientation: 'v', ad: get(i + 13) });
  }
  return slots;
}

/* =============================================================
   FORMATIONS
   ============================================================= */
// NOTE on orientation: home defends LEFT, attacks RIGHT. Looking at the pitch
// from the broadcast camera (south side), the player's LEFT side maps to the
// TOP of the screen (small y) and RIGHT side maps to the BOTTOM (large y).
// → LB/LW/LM live at small y, RB/RW/RM live at large y.
const FORMATIONS = {
  '4-3-3': [
    ['GK', 70, 340], ['LB', 240, 110], ['CB', 210, 260], ['CB', 210, 420],
    ['RB', 240, 570], ['CM', 410, 340], ['CM', 490, 200], ['CM', 490, 480],
    ['LW', 820, 110], ['ST', 880, 340], ['RW', 820, 570],
  ],
  '4-2-3-1': [
    ['GK', 70, 340], ['LB', 240, 110], ['CB', 210, 260], ['CB', 210, 420],
    ['RB', 240, 570], ['CDM', 380, 250], ['CDM', 380, 430], ['LM', 600, 130],
    ['CAM', 670, 340], ['RM', 600, 550], ['ST', 880, 340],
  ],
  '3-4-3': [
    ['GK', 70, 340], ['CB', 220, 200], ['CB', 200, 340], ['CB', 220, 480],
    ['LM', 440, 110], ['CM', 440, 270], ['CM', 440, 410], ['RM', 440, 570],
    ['LW', 820, 130], ['ST', 880, 340], ['RW', 820, 550],
  ],
  '3-5-2': [
    ['GK', 70, 340], ['CB', 220, 200], ['CB', 200, 340], ['CB', 220, 480],
    ['LM', 440, 90], ['CM', 460, 240], ['CDM', 380, 340], ['CM', 460, 440],
    ['RM', 440, 590], ['ST', 820, 260], ['ST', 820, 420],
  ],
  '4-4-2': [
    ['GK', 70, 340], ['LB', 240, 110], ['CB', 210, 260], ['CB', 210, 420],
    ['RB', 240, 570], ['LM', 510, 110], ['CM', 490, 280], ['CM', 490, 400],
    ['RM', 510, 570], ['ST', 830, 260], ['ST', 830, 420],
  ],
  '5-3-2': [
    ['GK', 70, 340], ['LB', 290, 90], ['CB', 230, 230], ['CB', 200, 340],
    ['CB', 230, 450], ['RB', 290, 590], ['CM', 490, 220], ['CM', 470, 340],
    ['CM', 490, 460], ['ST', 830, 270], ['ST', 830, 410],
  ],
  '4-1-4-1': [
    ['GK', 70, 340], ['LB', 240, 110], ['CB', 210, 260], ['CB', 210, 420],
    ['RB', 240, 570], ['CDM', 380, 340], ['LM', 550, 130], ['CM', 540, 280],
    ['CM', 540, 400], ['RM', 550, 570], ['ST', 830, 340],
  ],
};
const FORMATION_KEYS = Object.keys(FORMATIONS);

/* =============================================================
   HELPERS
   ============================================================= */
const clamp = (v, mn, mx) => Math.max(mn, Math.min(mx, v));
const mirrorX = (x) => PITCH_W - x;
const uid = (() => { let n = 0; return (p='id') => `${p}_${++n}_${Date.now().toString(36)}`; })();

function buildFormation(key) {
  const formation = FORMATIONS[key];
  const players = [];
  formation.forEach(([label, x, y], i) => {
    players.push({
      id: `h${i}`, team: 'home', label, number: i === 0 ? 1 : i + 1, face: null, name: '',
      pos: { inPossession: { x, y }, outOfPossession: { x, y } },
      arrowDir: null, speed: 6, press: 6,
    });
  });
  formation.forEach(([label, x, y], i) => {
    players.push({
      id: `a${i}`, team: 'away', label, number: i === 0 ? 1 : i + 1, face: null, name: '',
      pos: { inPossession: { x: mirrorX(x), y }, outOfPossession: { x: mirrorX(x), y } },
      arrowDir: null, speed: 6, press: 6,
    });
  });
  return players;
}

function detectFormation(players, mode, team) {
  const list = players.filter(p => p.team === team && p.label !== 'GK');
  if (list.length !== 10) return '';
  const baseX = team === 'home' ? 0 : PITCH_W;
  const sorted = [...list].sort((a, b) =>
    Math.abs(a.pos[mode].x - baseX) - Math.abs(b.pos[mode].x - baseX));
  const bands = [];
  let cur = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = cur[cur.length - 1];
    const d = Math.abs(sorted[i].pos[mode].x - prev.pos[mode].x);
    if (d < 80) cur.push(sorted[i]);
    else { bands.push(cur.length); cur = [sorted[i]]; }
  }
  bands.push(cur.length);
  return bands.join('-');
}

function getSVGPoint(svg, evt) {
  const pt = svg.createSVGPoint();
  pt.x = evt.clientX; pt.y = evt.clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: 0, y: 0 };
  return pt.matrixTransform(ctm.inverse());
}

/* =============================================================
   PITCH LINES
   ============================================================= */
function PitchLines({ showChannels, showDefLine, defLines, playing, animating, skin = PITCH_SKINS.grass, kitPal }) {
  // Smoothly translate the def-line group via CSS transform when animating
  // so it doesn't teleport between phases like x1/x2 attribute changes do.
  const lineTrans = animating ? `transform ${PHASE_DURATION}ms linear` : 'none';
  return (
    <g pointerEvents="none">
      {Array.from({ length: 12 }).map((_, i) => (
        <rect key={i} x={i * (PITCH_W / 12)} y={0}
          width={PITCH_W / 12} height={PITCH_H}
          fill={i % 2 === 0 ? skin.pitch : skin.pitchAlt} />
      ))}
      <rect x={0} y={0} width={PITCH_W} height={PITCH_H} fill="url(#pitchVignette)" />
      {playing && (
        <rect x={0} y={0} width={PITCH_W} height={PITCH_H} fill="url(#playGlow)" pointerEvents="none">
          <animate attributeName="opacity" values="0.7;1;0.7" dur="1.6s" repeatCount="indefinite" />
        </rect>
      )}
      <rect x={20} y={20} width={PITCH_W - 40} height={PITCH_H - 40} fill="none" stroke={skin.line} strokeWidth={2.5} />
      <line x1={PITCH_W / 2} y1={20} x2={PITCH_W / 2} y2={PITCH_H - 20} stroke={skin.line} strokeWidth={2.5} />
      <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={92} fill="none" stroke={skin.line} strokeWidth={2.5} />
      <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={3} fill={skin.line} />
      <rect x={20} y={PITCH_H / 2 - 200} width={165} height={400} fill="none" stroke={skin.line} strokeWidth={2.5} />
      <rect x={PITCH_W - 185} y={PITCH_H / 2 - 200} width={165} height={400} fill="none" stroke={skin.line} strokeWidth={2.5} />
      <rect x={20} y={PITCH_H / 2 - 90} width={55} height={180} fill="none" stroke={skin.line} strokeWidth={2.5} />
      <rect x={PITCH_W - 75} y={PITCH_H / 2 - 90} width={55} height={180} fill="none" stroke={skin.line} strokeWidth={2.5} />
      <rect x={5} y={PITCH_H / 2 - 36} width={15} height={72} fill={skin.goalFill} stroke={skin.line} strokeWidth={2} />
      <rect x={PITCH_W - 20} y={PITCH_H / 2 - 36} width={15} height={72} fill={skin.goalFill} stroke={skin.line} strokeWidth={2} />
      <circle cx={130} cy={PITCH_H / 2} r={3} fill={skin.line} />
      <circle cx={PITCH_W - 130} cy={PITCH_H / 2} r={3} fill={skin.line} />
      <path d={`M 185 ${PITCH_H / 2 - 50} A 50 50 0 0 1 185 ${PITCH_H / 2 + 50}`} fill="none" stroke={skin.line} strokeWidth={2.5} />
      <path d={`M ${PITCH_W - 185} ${PITCH_H / 2 - 50} A 50 50 0 0 0 ${PITCH_W - 185} ${PITCH_H / 2 + 50}`} fill="none" stroke={skin.line} strokeWidth={2.5} />
      {[[20,20],[PITCH_W-20,20],[20,PITCH_H-20],[PITCH_W-20,PITCH_H-20]].map(([cx,cy], i) => (
        <path key={i}
          d={`M ${cx + (cx === 20 ? 10 : -10)} ${cy} A 10 10 0 0 ${cx === 20 ? (cy === 20 ? 1 : 0) : (cy === 20 ? 0 : 1)} ${cx} ${cy + (cy === 20 ? 10 : -10)}`}
          fill="none" stroke={skin.line} strokeWidth={2} />
      ))}

      {showChannels && [136, 272, 408, 544].map((y, i) => (
        <line key={`ch-${i}`} x1={20} y1={y} x2={PITCH_W - 20} y2={y}
          stroke="rgba(255,255,255,0.32)" strokeWidth={1.5} strokeDasharray="2 6" />
      ))}
      {showChannels && (
        <g pointerEvents="none">
          {['WING','HALFSPACE','CENTRAL','HALFSPACE','WING'].map((tx, i) => (
            <text key={i} x={28} y={68 + i * 136}
              fill="rgba(255,255,255,0.5)" fontSize={11} fontWeight={800} letterSpacing="2"
              style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
              {tx}
            </text>
          ))}
        </g>
      )}

      {showDefLine && defLines.home != null && (
        <g style={{ transform: `translate(${defLines.home}px, 0px)`, transition: lineTrans }}>
          <line x1={0} y1={20} x2={0} y2={PITCH_H - 20}
            stroke={kitPal.home.base} strokeWidth={2} strokeDasharray="8 6" opacity={0.85} />
          <rect x={-36} y={26} width={72} height={18} rx={3}
            fill={kitPal.home.base} opacity={0.92} />
          <text x={0} y={39} textAnchor="middle" fontSize={10} fontWeight={800}
            fill={kitPal.home.ink} letterSpacing="1.5"
            style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
            HOME LINE
          </text>
        </g>
      )}
      {showDefLine && defLines.away != null && (
        <g style={{ transform: `translate(${defLines.away}px, 0px)`, transition: lineTrans }}>
          <line x1={0} y1={20} x2={0} y2={PITCH_H - 20}
            stroke={kitPal.away.base} strokeWidth={2} strokeDasharray="8 6" opacity={0.85} />
          <rect x={-36} y={26} width={72} height={18} rx={3}
            fill={kitPal.away.base} opacity={0.92} />
          <text x={0} y={39} textAnchor="middle" fontSize={10} fontWeight={800}
            fill={kitPal.away.ink} letterSpacing="1.5"
            style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
            AWAY LINE
          </text>
        </g>
      )}

      {/* Watermark */}
      <g pointerEvents="none" opacity={0.18}>
        <text x={PITCH_W - 28} y={56} textAnchor="end"
          fontSize={36} fontWeight={800} fill="#ffffff"
          style={{ fontFamily: '"Uni Sans Heavy", "Bebas Neue", sans-serif', letterSpacing: '4px' }}>
          NAHWEEEZY
        </text>
        <text x={PITCH_W - 28} y={74} textAnchor="end"
          fontSize={10} fontWeight={800} fill="#ffffff"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '6px' }}>
          TACTICS · BOARD
        </text>
      </g>
    </g>
  );
}

/* =============================================================
   PLAYER TOKEN
   ============================================================= */
function PlayerToken({
  player, x, y, selected, dragging, animating, showStats, showMovementArrows, playerMode,
  pal, onPointerDown, onContextMenu, onDoubleClick,
}) {
  const isHome = player.team === 'home';
  const kit = isHome ? 'url(#kitHome)' : 'url(#kitAway)';
  const ring = pal.ring;
  const labelFill = pal.ink;
  const transition = animating ? `transform ${PHASE_DURATION}ms linear` : 'none';
  const face = player.face;
  const showHeadshot = playerMode && face;

  // A typed-in name wins over the assigned face's name; the plate shows
  // whichever is set, so custom names work with Player Mode off.
  const nameText = player.name?.trim() || (playerMode && face ? face.name : '');
  // tight name label width: char count × 6.2px + padding, min 36
  const nameWidth = Math.max(36, nameText.length * 6.4 + 12);

  return (
    <g
      style={{ transform: `translate(${x}px, ${y}px)`, transition }}
      onPointerDown={(e) => onPointerDown(e, player.id)}
      onContextMenu={(e) => onContextMenu(e, player.id)}
      onDoubleClick={(e) => onDoubleClick(e, player.id)}
      className="cursor-grab active:cursor-grabbing"
    >
    {/* Inner group handles pickup scale so it can spring independently of
        the positional translate (which must track the pointer instantly). */}
    <g style={{
      transform: `scale(${dragging ? 1.12 : 1})`,
      transition: 'transform 180ms cubic-bezier(0.2, 1.6, 0.4, 1)',
    }}>
      {/* contact shadow — lifts while dragging */}
      <ellipse cx={0} cy={PLAYER_R * 0.9} rx={PLAYER_R * (dragging ? 1.05 : 0.85)} ry={4.5}
        fill="rgba(0,0,0,0.38)" style={{ transition: 'rx 180ms' }} />

      {selected && (
        <Fragment>
          <circle r={PLAYER_R + 7} fill="none" stroke={COLORS.selected}
            strokeWidth={2.5} strokeDasharray="5 3" opacity={0.9}>
            <animate attributeName="stroke-dashoffset" from="0" to="16" dur="1.2s" repeatCount="indefinite" />
          </circle>
          <circle r={PLAYER_R + 14} fill="none" stroke={COLORS.selected}
            strokeWidth={1} opacity={0.35}>
            <animate attributeName="r" values={`${PLAYER_R + 12};${PLAYER_R + 18};${PLAYER_R + 12}`} dur="1.6s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="0.35;0;0.35" dur="1.6s" repeatCount="indefinite" />
          </circle>
        </Fragment>
      )}

      <circle r={PLAYER_R + 1.5} fill={ring} opacity={0.95} />

      {showHeadshot ? (
        <Fragment>
          <defs>
            <clipPath id={`clip-${player.id}`}>
              <circle r={PLAYER_R - 0.5} />
            </clipPath>
          </defs>
          {/* The kit disc sits behind the cutout: these PNGs have transparent
              backgrounds, so without it the pitch would show through around
              the head — and it keeps faced tokens reading as team members. */}
          <circle r={PLAYER_R} fill={kit}
            style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.4))' }} />
          {/* Cutouts are 300×390 head-and-chest portraits. Measuring the alpha
              silhouette, the head runs from the very top down to ~68% of the
              height — that's where the outline pinches at the neck before
              flaring into the shoulders. Map that band onto the disc. */}
          {(() => {
            const HEAD_BOTTOM = 0.68;                       // head ends here
            const headH = 390 * HEAD_BOTTOM;                // ≈265px of source
            const imgScale = (PLAYER_R * 2 + 2) / headH;    // +2 to overfill
            const imgW = 300 * imgScale;
            const imgH = 390 * imgScale;
            return (
              <image
                href={faceUrl(face.id)}
                x={-imgW / 2}
                y={-(headH / 2) * imgScale}    /* centre the head on the disc */
                width={imgW}
                height={imgH}
                clipPath={`url(#clip-${player.id})`}
                preserveAspectRatio="xMidYMin meet"
              />
            );
          })()}
          <circle r={PLAYER_R - 0.5} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
        </Fragment>
      ) : (
        <Fragment>
          <circle r={PLAYER_R} fill={kit}
            style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.4))' }} />
          <text x={0} y={4} textAnchor="middle" fontSize={11} fontWeight={800}
            fill={labelFill} pointerEvents="none"
            style={{ userSelect: 'none', fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.5px' }}>
            {player.label}
          </text>
        </Fragment>
      )}

      {nameText && (
        <g pointerEvents="none">
          <rect x={-nameWidth/2} y={PLAYER_R + 4} width={nameWidth} height={14} rx={2}
            fill="rgba(0,0,0,0.85)"
            stroke="rgba(215,255,60,0.5)" strokeWidth={0.8} />
          <text x={0} y={PLAYER_R + 14} textAnchor="middle" fontSize={9} fontWeight={800}
            fill="#fff" style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.4px' }}>
            {nameText}
          </text>
        </g>
      )}

      {showStats && !nameText && (
        <g pointerEvents="none">
          <rect x={-22} y={PLAYER_R + 4} width={44} height={13} rx={2}
            fill="rgba(0,0,0,0.78)" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
          <text x={0} y={PLAYER_R + 13} textAnchor="middle" fontSize={8.5} fontWeight={700}
            fill="#fff" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
            S{player.speed}·P{player.press}
          </text>
        </g>
      )}

      {showMovementArrows && player.arrowDir && (
        <g pointerEvents="none">
          <line x1={0} y1={0} x2={player.arrowDir.dx} y2={player.arrowDir.dy}
            stroke="#fff" strokeWidth={2.5} strokeLinecap="round"
            markerEnd="url(#arrow-white)" opacity={0.9} />
        </g>
      )}
    </g>
    </g>
  );
}

/* =============================================================
   POSITIONAL STRUCTURE LINES — connects each unit (DEF / MID / ATT)
   of a team with a glowing polyline. Because token movement animates
   via CSS transforms while polyline points are attributes, we tween
   the coordinate map with rAF (linear, matching the tokens' easing)
   so the lines glide in lockstep with the players.
   ============================================================= */
function ShapeLines({ players, positions, editingTeam, animating, tool, kitPal, onBandPointerDown }) {
  const [tweened, setTweened] = useState(positions);
  const curRef = useRef(positions);   // what's currently on screen
  const rafRef = useRef(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const from = curRef.current;
    const to = positions;
    if (!animating) {
      curRef.current = to;
      setTweened(to);
      return;
    }
    const t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / PHASE_DURATION);
      const cur = {};
      for (const id in to) {
        const b = to[id];
        if (!b || b.x == null) continue;           // skip __ball/drawings/title
        const a = (from[id]?.x != null) ? from[id] : b;
        cur[id] = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      }
      curRef.current = cur;
      setTweened(cur);
      if (k < 1) rafRef.current = requestAnimationFrame(step);
      else rafRef.current = null;
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [positions, animating]);

  const teams = editingTeam === 'both' ? ['home', 'away'] : [editingTeam];
  const at = (p) => tweened[p.id];
  const has = (p) => { const q = at(p); return q && q.x != null; };
  // nearest partner by straight-line distance
  const nearest = (from, list) => {
    let best = null, bd = Infinity;
    for (const cand of list) {
      const a = at(from), b = at(cand);
      if (!a || !b || a.x == null || b.x == null) continue;
      const dd = (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      if (dd < bd) { bd = dd; best = cand; }
    }
    return best;
  };

  return (
    <g>
      {teams.map(team => {
        const squad = players.filter(p => p.team === team && has(p));
        const byLabel = (...labels) => squad.filter(p => labels.includes(p.label));
        const c = kitPal[team].line;

        /* ── Progression linkers (faint) ─────────────────────────
           Fullbacks → wide mids, and centre-backs → the pivot
           (CDMs, or CMs when the shape has no CDM). */
        const links = [];
        const pushLink = (a, b) => {
          if (!a || !b) return;
          links.push({ key: `${a.id}-${b.id}`, a: at(a), b: at(b) });
        };
        byLabel('LB', 'LWB').forEach(fb => pushLink(fb, nearest(fb, byLabel('LM'))));
        byLabel('RB', 'RWB').forEach(fb => pushLink(fb, nearest(fb, byLabel('RM'))));
        const pivot = byLabel('CDM').length ? byLabel('CDM') : byLabel('CM');
        byLabel('CB').forEach(cb => pushLink(cb, nearest(cb, pivot)));

        /* ── CAM → ST: the CAM stays in the midfield band but also
           links up to the striker it plays off. ─────────────────── */
        const camLinks = [];
        byLabel('CAM').forEach(cam => {
          const st = nearest(cam, byLabel('ST', 'CF'));
          if (st) camLinks.push({ key: `${cam.id}-${st.id}`, a: at(cam), b: at(st) });
        });

        return (
          <g key={team}>
            {/* faint progression linkers — under the unit lines */}
            <g pointerEvents="none" opacity={0.5}>
              {links.map(l => (
                <line key={l.key} x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y}
                  stroke={c} strokeWidth={1.4} strokeDasharray="3 7"
                  strokeLinecap="round" opacity={0.42} />
              ))}
            </g>

            {/* CAM → ST connection */}
            <g pointerEvents="none">
              {camLinks.map(l => (
                <Fragment key={l.key}>
                  <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y}
                    stroke={c} strokeWidth={6} strokeLinecap="round" opacity={0.13} />
                  <line x1={l.a.x} y1={l.a.y} x2={l.b.x} y2={l.b.y}
                    stroke={c} strokeWidth={2} strokeLinecap="round" opacity={0.7} />
                </Fragment>
              ))}
            </g>

            {/* unit bands — draggable as a whole with the select tool */}
            {SHAPE_BANDS.map((band, bi) => {
              const unit = squad
                .filter(p => band.includes(p.label))
                .sort((a, b) => at(a).y - at(b).y);
              if (unit.length < 2) return null;
              const pts = unit.map(at);
              const d = pts.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ');
              const ids = unit.map(p => p.id);
              const grabbable = tool === 'select' && !!onBandPointerDown;
              return (
                <g key={`${team}-${bi}`} opacity={0.9}>
                  {/* soft glow underlay + crisp core line */}
                  <path d={d} fill="none" stroke={c} strokeWidth={7}
                    strokeLinejoin="round" strokeLinecap="round" opacity={0.16}
                    pointerEvents="none" />
                  <path d={d} fill="none" stroke={c} strokeWidth={2.25}
                    strokeLinejoin="round" strokeLinecap="round" opacity={0.8}
                    pointerEvents="none" />
                  {/* invisible fat hit-strip: grab the line, move the unit */}
                  <path d={d} fill="none" stroke="transparent" strokeWidth={16}
                    strokeLinejoin="round" strokeLinecap="round"
                    pointerEvents={grabbable ? 'stroke' : 'none'}
                    style={grabbable ? { cursor: 'grab' } : undefined}
                    onPointerDown={grabbable ? (e) => onBandPointerDown(e, ids) : undefined}>
                    {grabbable && <title>Drag to move this whole unit</title>}
                  </path>
                  {/* diamond studs at each joint */}
                  {pts.map((p, i) => (
                    <rect key={i} x={-3} y={-3} width={6} height={6} fill={c} opacity={0.9}
                      pointerEvents="none"
                      transform={`translate(${p.x}, ${p.y}) rotate(45)`} />
                  ))}
                </g>
              );
            })}
          </g>
        );
      })}
    </g>
  );
}

/* =============================================================
   BALL
   ============================================================= */
function Ball({ x, y, animating, onPointerDown }) {
  const transition = animating ? `transform ${PHASE_DURATION}ms linear` : 'none';
  // Render the puma webp ball as an <image>. We make it slightly bigger than
  // the original SVG ball for clarity at this zoom.
  const R = BALL_R + 2;
  return (
    <g
      style={{ transform: `translate(${x}px, ${y}px)`, transition, cursor: 'grab' }}
      onPointerDown={onPointerDown}
      data-ball="1"
    >
      {/* contact shadow */}
      <ellipse cx={0} cy={R + 3} rx={R - 1} ry={R / 3} fill="rgba(0,0,0,0.55)" />
      {/* glow */}
      <circle r={R + 2} fill="rgba(255,255,255,0.12)" />
      {/* the actual puma ball */}
      <image
        href={asset('assets/icons/ball.webp')}
        x={-R} y={-R}
        width={R * 2} height={R * 2}
        style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.6))' }}
      />
    </g>
  );
}

/* =============================================================
   GOAL CONFETTI — fires when the ball crosses a goal-line
   ============================================================= */
function GoalConfetti({ origin, fireKey }) {
  // Generate 36 particles when fireKey changes — fresh randomization each fire
  const particles = useMemo(() => {
    if (fireKey === 0) return [];
    return Array.from({ length: 36 }, (_, i) => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.4;
      const speed = 60 + Math.random() * 130;
      const colors = ['#fde047', '#60a5fa', '#a3e635', '#fb923c', '#f472b6', '#ef4444', '#22d3ee', '#ffffff'];
      return {
        id: i + '_' + fireKey,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        rot: (Math.random() - 0.5) * 240,
        size: 2 + Math.random() * 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        delay: Math.random() * 0.15,
      };
    });
  }, [fireKey]);
  if (!particles.length || !origin) return null;
  return (
    <g pointerEvents="none" transform={`translate(${origin.x}, ${origin.y})`}>
      {particles.map(p => (
        <rect key={p.id} x={-p.size/2} y={-p.size/2} width={p.size} height={p.size}
          fill={p.color} rx={0.5}>
          <animateTransform attributeName="transform" type="translate"
            values={`0,0; ${p.dx},${p.dy + 80}`}
            dur="1.6s" begin={`${p.delay}s`} fill="freeze" calcMode="spline"
            keySplines="0.2 0.8 0.4 1" />
          <animateTransform attributeName="transform" type="rotate"
            values={`0; ${p.rot}`} dur="1.6s" begin={`${p.delay}s`}
            additive="sum" fill="freeze" />
          <animate attributeName="opacity" values="1;1;0" dur="1.6s"
            begin={`${p.delay}s`} fill="freeze" keyTimes="0;0.7;1" />
        </rect>
      ))}
    </g>
  );
}

/* =============================================================
   STADIUM EXTRAS — corner flags & dust particles
   ============================================================= */
function CornerFlags() {
  const corners = [
    { x: 22, y: 22,           dx: 8 },   // TL — flag waves right
    { x: PITCH_W - 22, y: 22, dx: -8 },  // TR — flag waves left
    { x: 22, y: PITCH_H - 22, dx: 8 },   // BL
    { x: PITCH_W - 22, y: PITCH_H - 22, dx: -8 },
  ];
  return (
    <g pointerEvents="none">
      {corners.map((c, i) => (
        <g key={i} transform={`translate(${c.x},${c.y})`}>
          {/* pole */}
          <line x1={0} y1={0} x2={0} y2={-22}
            stroke="rgba(255,255,255,0.65)" strokeWidth={1} />
          {/* flag — gentle wave via SMIL */}
          <path d={`M 0 -22 L ${c.dx} -19 L 0 -16 Z`}
            fill="#f43f5e" opacity={0.95}>
            <animateTransform attributeName="transform" type="rotate"
              values="-1;3;-1" dur="2.4s" repeatCount="indefinite" />
          </path>
        </g>
      ))}
    </g>
  );
}

// Pre-generated random positions so they don't reshuffle on every render.
const _DUST = Array.from({ length: 22 }, (_, i) => ({
  id: i,
  x: 30 + Math.random() * (PITCH_W - 60),
  y: 30 + Math.random() * (PITCH_H - 60),
  r: 0.6 + Math.random() * 1.2,
  dur: 8 + Math.random() * 12,
  delay: Math.random() * -6,
  drift: 20 + Math.random() * 60,
}));

function DustParticles() {
  return (
    <g pointerEvents="none" opacity={0.5}>
      {_DUST.map((p) => (
        <circle key={p.id} cx={p.x} cy={p.y} r={p.r} fill="rgba(255,255,255,0.35)">
          <animate attributeName="cy"
            values={`${p.y};${p.y - p.drift};${p.y}`}
            dur={`${p.dur}s`} repeatCount="indefinite"
            begin={`${p.delay}s`} />
          <animate attributeName="opacity"
            values="0;0.55;0" dur={`${p.dur}s`} repeatCount="indefinite"
            begin={`${p.delay}s`} />
        </circle>
      ))}
    </g>
  );
}

/* =============================================================
   FREEHAND ARROW
   ============================================================= */
function ArrowOverlay({ arrow }) {
  const { points, color, style } = arrow;
  if (!points || points.length < 2) return null;
  const stroke = ARROW_COLORS[color] || ARROW_COLORS.white;
  const d = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  const dashed = style === 'dashed';
  return (
    <path d={d} fill="none" stroke={stroke} strokeWidth={3.5}
      strokeLinecap="round" strokeLinejoin="round"
      strokeDasharray={dashed ? '10 8' : undefined}
      markerEnd={`url(#arrow-${color})`} opacity={0.95}>
      {/* pass arrows march toward the target */}
      {dashed && (
        <animate attributeName="stroke-dashoffset" from="18" to="0"
          dur="0.9s" repeatCount="indefinite" />
      )}
    </path>
  );
}

/* =============================================================
   AD BOARD
   ============================================================= */
function AdBoard({ slot }) {
  const { ad, x, y, w, h, orientation } = slot;
  const horiz = orientation === 'h';
  const gradId = `adgrad-${ad.id}-${orientation}`;
  const iconSize = horiz ? 24 : 20;

  // Horizontal boards read left-to-right: icon, then label over sub-label.
  // Vertical boards stack the icon above a label rotated to run upward.
  const cx = x + w / 2;
  const cy = y + h / 2;

  return (
    <a href={ad.url} target="_blank" rel="noopener noreferrer" data-ad={ad.id}
       onClick={() => track.adBoardClick(ad.label, orientation === 'h' ? 'perimeter_h' : 'perimeter_v')}
       className="ad-board" style={{ pointerEvents: 'auto' }}>
      <rect x={x} y={y} width={w} height={h} rx={4}
        fill={`url(#${gradId})`} stroke="rgba(255,255,255,0.14)" strokeWidth={1} />
      {/* scanline texture */}
      <rect x={x} y={y} width={w} height={h} rx={4} fill="url(#adScan)" pointerEvents="none" />

      {horiz ? (
        <g pointerEvents="none">
          {ad.icon && (
            <image href={ad.icon} x={x + 12} y={cy - iconSize / 2}
              width={iconSize} height={iconSize} preserveAspectRatio="xMidYMid meet" />
          )}
          <text x={x + 12 + (ad.icon ? iconSize + 8 : 0)} y={cy - 1}
            fill="#fff" fontSize={16} fontWeight={800} letterSpacing="1.5"
            style={{ fontFamily: '"Uni Sans Heavy", "Bebas Neue", sans-serif' }}>
            {ad.label}
          </text>
          <text x={x + 12 + (ad.icon ? iconSize + 8 : 0)} y={cy + 12}
            fill="rgba(255,255,255,0.85)" fontSize={9} fontWeight={600} letterSpacing="1.5"
            style={{ fontFamily: 'Oswald, sans-serif' }}>
            {ad.sub.toUpperCase()}
          </text>
        </g>
      ) : (
        <g pointerEvents="none">
          {ad.icon && (
            <image href={ad.icon} x={cx - iconSize / 2} y={y + 10}
              width={iconSize} height={iconSize} preserveAspectRatio="xMidYMid meet" />
          )}
          <text x={0} y={0} textAnchor="middle"
            transform={`translate(${cx + 5}, ${y + h - 12}) rotate(-90)`}
            fill="#fff" fontSize={13} fontWeight={800} letterSpacing="1"
            style={{ fontFamily: '"Uni Sans Heavy", "Bebas Neue", sans-serif' }}>
            {ad.label}
          </text>
        </g>
      )}
    </a>
  );
}

/* Gradient + texture defs backing every ad board, emitted once per pitch. */
function AdBoardDefs({ ads }) {
  return (
    <Fragment>
      <pattern id="adScan" width="1" height="3" patternUnits="userSpaceOnUse">
        <rect width="1" height="1" fill="rgba(0,0,0,0.05)" />
      </pattern>
      {ads.map(ad => (
        <Fragment key={ad.id}>
          <linearGradient id={`adgrad-${ad.id}-h`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={ad.g1} />
            <stop offset="100%" stopColor={ad.g2} />
          </linearGradient>
          <linearGradient id={`adgrad-${ad.id}-v`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ad.g1} />
            <stop offset="100%" stopColor={ad.g2} />
          </linearGradient>
        </Fragment>
      ))}
    </Fragment>
  );
}

/* =============================================================
   POSITION GRID
   ============================================================= */
function PositionGrid({ current, onPick }) {
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {POSITION_GRID.flat().map(pos => {
        const active = current === pos;
        return (
          <button key={pos}
            onClick={() => onPick(pos)}
            className={`py-2.5 rounded text-xs font-extrabold transition border ${
              active
                ? 'bg-accent border-accent text-acc-ink shadow-glow'
                : 'bg-ink/[0.04] border-ink/10 hover:bg-accent/15 hover:border-accent/40 text-ink'
            }`}
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
            {pos}
          </button>
        );
      })}
    </div>
  );
}

/* =============================================================
   FACE PICKER PANEL (inline in side panel)
   Backed by the football-faces dataset — ~7,300 players with
   transparent-background cutouts, keyed by Transfermarkt id.
   ============================================================= */
function FacePickerPanel({ targetPlayer, takenIds = new Set(), onPick, onClear }) {
  const [index, setIndex] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [nation, setNation] = useState('');
  // Default to the token's own role; the user can widen to every role.
  const [roleFilter, setRoleFilter] = useState(true);

  useEffect(() => {
    if (index || loading) return;
    setLoading(true);
    loadFaces()
      .then(setIndex)
      .catch((e) => setError(e?.message || 'Could not load the player index.'))
      .finally(() => setLoading(false));
  }, [index, loading]);

  // Debounced GA event for player search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => track.searchPlayer(q), 700);
    return () => clearTimeout(t);
  }, [query]);

  const role = roleFilter ? (ROLE_TO_FACE_ROLE[targetPlayer?.label] || '') : '';

  // The token's own pick stays visible even though it's in `takenIds`, so it
  // reads as the current selection rather than silently vanishing.
  const exclude = useMemo(() => {
    const s = new Set(takenIds);
    if (targetPlayer?.face?.id) s.delete(targetPlayer.face.id);
    return s;
  }, [takenIds, targetPlayer?.face?.id]);

  const results = useMemo(
    () => searchFaces(index, { query, role, nation, exclude }),
    [index, query, role, nation, exclude]);

  const nations = useMemo(() => nationsFor(index, role), [index, role]);

  // A nation filter that the current role has nobody for would strand the
  // list empty with no obvious cause — drop it instead.
  useEffect(() => {
    if (nation && nations.length && !nations.includes(nation)) setNation('');
  }, [nation, nations]);

  if (!targetPlayer) return null;

  return (
    <section className="p-3 rounded-lg bg-accent/[0.04] border border-accent/25">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-extrabold tracking-[0.25em] text-accent"
          style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
          PLAYER PICKER
        </div>
        {targetPlayer.face && (
          <button onClick={onClear}
            className="text-[9px] font-extrabold tracking-wider px-2 py-0.5 bg-rose-500/20 border border-rose-500/30 text-rose-300 rounded"
            style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
            CLEAR
          </button>
        )}
      </div>

      {error && (
        <div className="p-2 bg-rose-500/15 border border-rose-500/30 rounded text-rose-200 text-[11px] mb-2">
          ⚠ {error}
        </div>
      )}
      {loading && (
        <div className="p-3 text-center text-mute text-[11px]">Loading player index…</div>
      )}

      {index && (
        <Fragment>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name…"
            className="w-full bg-well/50 border border-ink/10 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent mb-2" />

          <div className="flex gap-1.5 mb-2">
            <button
              onClick={() => setRoleFilter(v => !v)}
              title="Limit results to players who actually play this role"
              className={`px-2 py-1.5 text-[10px] font-extrabold tracking-wider rounded border transition whitespace-nowrap ${
                roleFilter
                  ? 'bg-accent/20 border-accent/45 text-accent'
                  : 'bg-ink/5 border-ink/10 text-mute hover:bg-ink/10'
              }`}
              style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
              {roleFilter ? (ROLE_TO_FACE_ROLE[targetPlayer.label] || 'ROLE') : 'ALL ROLES'}
            </button>
            <select value={nation} onChange={(e) => setNation(e.target.value)}
              className="flex-1 min-w-0 bg-well/50 border border-ink/10 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent">
              <option value="">All nations</option>
              {nations.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>

          <div className="space-y-1 max-h-72 overflow-auto pr-0.5">
            {results.map(p => {
              const age = ageFrom(p.dob);
              const current = targetPlayer.face?.id === p.id;
              return (
                <button key={p.id}
                  onClick={() => onPick({
                    id: p.id, name: p.name, fullName: p.fullName,
                    role: p.role, nation: p.nation,
                  })}
                  className={`w-full text-left p-1.5 rounded transition group flex gap-2 items-center border ${
                    current
                      ? 'bg-accent/15 border-accent/50'
                      : 'bg-ink/[0.03] hover:bg-accent/10 border-ink/10 hover:border-accent/40'
                  }`}>
                  <img src={faceUrl(p.id)} alt="" loading="lazy" width={36} height={44}
                    className="w-9 h-11 object-contain object-top rounded bg-well/60 flex-shrink-0"
                    onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}/>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-extrabold truncate group-hover:text-accent"
                      style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.3px' }}>
                      {p.name}
                    </div>
                    <div className="text-[9px] text-mute font-mono truncate">
                      {p.role}{p.nation ? ` · ${p.nation}` : ''}{age != null ? ` · ${age}` : ''}
                    </div>
                  </div>
                </button>
              );
            })}
            {results.length === 0 && (
              <div className="py-3 text-center text-dim text-[11px]">
                No players match.
                {roleFilter && <> Try <button onClick={() => setRoleFilter(false)}
                  className="text-accent underline">all roles</button>.</>}
              </div>
            )}
          </div>

          <div className="mt-2 pt-2 border-t border-ink/10 text-[8.5px] text-dim font-mono leading-tight">
            {index.players.length.toLocaleString()} players · faces &amp; data via{' '}
            <a href={index.source} target="_blank" rel="noopener noreferrer"
              className="text-accent hover:underline">football-faces</a>
            {' '}· photos © Transfermarkt
          </div>
        </Fragment>
      )}
    </section>
  );
}

/* =============================================================
   MODAL: Display Options
   ============================================================= */
const THEME_OPTIONS = [
  { id: 'volt',   label: 'Volt',   desc: 'Night match · electric', dots: ['#0b0d08', '#d7ff3c', '#f43f5e'] },
  { id: 'blue',   label: 'Blue',   desc: 'The original look',      dots: ['#060912', '#60a5fa', '#e2e8f0'] },
  { id: 'light',  label: 'Light',  desc: 'Paper & ink',            dots: ['#edefe6', '#567a00', '#1a1d0f'] },
  { id: 'dark',   label: 'Dark',   desc: 'Neutral graphite',       dots: ['#0c0c0d', '#e4e8f0', '#6c6e78'] },
  { id: 'system', label: 'System', desc: 'Follow OS',              dots: ['#0c0c0d', '#edefe6', '#567a00'] },
];

function KitPicker({ label, value, onChange }) {
  return (
    <div className="p-2.5 rounded-lg bg-ink/[0.03] border border-ink/10">
      <div className="flex items-center gap-2 mb-2">
        <label className="relative w-8 h-8 rounded-full flex-shrink-0 cursor-pointer border border-ink/20 overflow-hidden"
          style={{ background: value }}
          title={`${label} kit colour`}>
          <input type="color" value={value}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 opacity-0 cursor-pointer" />
        </label>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-extrabold tracking-wider"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>{label}</div>
          <div className="text-[9px] text-dim font-mono uppercase">{value}</div>
        </div>
      </div>
      <div className="grid grid-cols-6 gap-1">
        {KIT_PRESETS.map(c => (
          <button key={c} onClick={() => onChange(c)} title={c}
            aria-label={`${label} kit ${c}`}
            className={`h-5 rounded border transition ${
              value.toLowerCase() === c.toLowerCase()
                ? 'border-accent ring-1 ring-accent/50'
                : 'border-ink/15 hover:border-ink/40'
            }`}
            style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

function DisplayOptionsModal({ open, onClose, opts, setOpts, theme, setTheme, kits, setKits }) {
  if (!open) return null;
  const flag = (key) => opts[key];
  // Tracking stays outside the updater: React may invoke updaters more than
  // once, which would double-count the event.
  const toggle = (key) => {
    track.displayOption(key, !opts[key]);
    setOpts(o => ({ ...o, [key]: !o[key] }));
  };
  return (
    <ModalShell title="Display Options" subtitle="Theme, pitch overlays & extras" onClose={onClose}>
      <div className="mb-4">
        <div className="text-[10px] font-extrabold text-mute tracking-widest mb-2"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
          THEME
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
          {THEME_OPTIONS.map(t => {
            const active = theme === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTheme(t.id)}
                aria-pressed={active}
                className={`px-2.5 py-2 rounded-lg border text-left transition ${
                  active
                    ? 'bg-accent/15 border-accent/50 ring-1 ring-accent/40'
                    : 'bg-ink/[0.03] hover:bg-ink/[0.07] border-ink/10'
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-extrabold tracking-wide"
                    style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                    {t.label}
                  </div>
                  <div className="flex gap-0.5">
                    {t.dots.map((c, i) => (
                      <span key={i} className="w-2.5 h-2.5 rounded-sm border border-ink/20"
                        style={{ background: c }} />
                    ))}
                  </div>
                </div>
                <div className="text-[10px] text-mute leading-tight mt-0.5">{t.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10px] font-extrabold text-mute tracking-widest"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            TEAM KITS
          </div>
          <button onClick={() => { track.kitChanged('reset', ''); setKits(DEFAULT_KITS); }}
            className="text-[9px] font-extrabold tracking-wider px-2 py-0.5 bg-ink/5 hover:bg-ink/15 border border-ink/10 rounded"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            RESET
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <KitPicker label="HOME" value={kits.home}
            onChange={(c) => { track.kitChanged('home', c); setKits(k => ({ ...k, home: c })); }} />
          <KitPicker label="AWAY" value={kits.away}
            onChange={(c) => { track.kitChanged('away', c); setKits(k => ({ ...k, away: c })); }} />
        </div>
      </div>

      <div className="text-[10px] font-extrabold text-mute tracking-widest mb-2"
        style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
        PITCH OVERLAYS
      </div>
      <div className="space-y-2 max-h-[46vh] overflow-y-auto pr-1">
        {[
          ['showShapeLines',   'Positional Structure Lines', 'Connect each unit — defence, midfield, attack — plus CAM→ST and faint fullback / centre-back progression linkers. Drag a line to move the whole unit (2D).'],
          ['darkPitch',        'Dark Pitch Surface',         'Swap the green turf for night slate. Selecting the Dark theme turns this on automatically.'],
          ['playerMode',       'Real Player Faces',          'Click any token to assign one of ~7,300 real players. Their cutout and name appear on the token.'],
          ['showStats',        'Player Stat Badges',         'Speed / press intensity badge under each token.'],
          ['showMovementArrows','Movement Intent Arrows',    'Per-player movement vector (set in player editor).'],
          ['showTrails',       'Phase Movement Trails',      'Ghost dashed lines as phases play through.'],
          ['showChannels',     '5 Channel Split',            'Wing / halfspace / central guides drawn across the pitch.'],
          ['showDefLine',      'Defensive Line Markers',     'Auto-line at the deepest defender for each side.'],
          ['showAds',          'Stadium Ad Boards',          'The 16 perimeter ad boards around the pitch.'],
          ['showBall',         'Show Football',              'Toggle the interactive ball on the pitch.'],
          ['vertical',         'Vertical Stadium View',      'Flip the whole pitch into up-and-down (portrait) orientation.'],
          ['customStadium',    'Custom 3D Stadium Model',    '3D mode only — load /assets/models/stadium.dae instead of the procedural box stands.'],
        ].map(([key, label, desc]) => (
          <label key={key} className="flex items-center gap-3 p-3 bg-ink/[0.03] hover:bg-ink/[0.06] border border-ink/10 rounded-lg cursor-pointer transition">
            <div className="flex-1 min-w-0">
              <div className="text-sm font-extrabold text-ink"
                style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.4px' }}>{label}</div>
              <div className="text-[11px] text-mute leading-snug">{desc}</div>
            </div>
            <input type="checkbox" checked={!!flag(key)} onChange={() => toggle(key)}
              className="sr-only" />
            <span className="tgl" aria-hidden="true" />
          </label>
        ))}
      </div>
    </ModalShell>
  );
}

/* =============================================================
   MODAL: Tactic Management
   ============================================================= */
const STORAGE_KEY = 'nahweeezy_tactics_v3';

function loadTactics() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function saveTactics(list) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); } catch {}
}

function TacticManagementModal({ open, onClose, current, onLoad }) {
  const [list, setList] = useState(() => loadTactics());
  const [name, setName] = useState('');
  useEffect(() => { if (open) setList(loadTactics()); }, [open]);
  if (!open) return null;
  const doSave = () => {
    const trimmed = (name || current.name || 'Untitled').trim();
    if (!trimmed) return;
    const entry = { id: uid('tac'), name: trimmed, saved_at: new Date().toISOString(), data: current.data };
    const next = [entry, ...list].slice(0, 30);
    saveTactics(next); setList(next); setName('');
    track.saveTactic({ name: trimmed, where: 'localStorage' });
  };
  const doLoad = (entry) => { track.loadTactic({ where: 'localStorage', name: entry.name }); onLoad(entry.data); onClose(); };
  const doDelete = (id) => {
    track.deleteTactic({ where: 'localStorage' });
    const next = list.filter(e => e.id !== id); saveTactics(next); setList(next);
  };
  const doExport = (entry) => {
    track.exportTactic({ format: 'json', status: 'success' });
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${entry.name.replace(/[^a-z0-9]+/gi,'_')}.tactic.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  return (
    <ModalShell title="Tactic Management" subtitle="Save, load & manage your boards" onClose={onClose}>
      <div className="mb-4 p-3 bg-accent/10 border border-accent/30 rounded-lg">
        <div className="text-[10px] font-extrabold text-accent tracking-widest mb-2"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
          SAVE CURRENT BOARD
        </div>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={current.name || 'Tactic name...'}
            className="flex-1 bg-well/50 border border-ink/10 rounded px-3 py-2 text-sm focus:outline-none focus:border-accent" />
          <button onClick={doSave}
            className="px-4 py-2 bg-accent hover:brightness-110 text-acc-ink font-extrabold text-sm rounded transition"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.6px' }}>
            SAVE
          </button>
        </div>
      </div>
      <div className="text-[10px] font-extrabold text-mute tracking-widest mb-2"
        style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
        SAVED ({list.length})
      </div>
      {list.length === 0 ? (
        <div className="text-center py-8 text-dim text-sm">No saved tactics yet.</div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-auto pr-1">
          {list.map(entry => (
            <div key={entry.id} className="p-3 bg-ink/[0.03] hover:bg-ink/[0.06] border border-ink/10 rounded-lg flex items-center gap-3 transition">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate" style={{ fontFamily: 'Oswald, sans-serif', letterSpacing: '0.3px' }}>
                  {entry.name}
                </div>
                <div className="text-[10px] text-dim font-mono">{new Date(entry.saved_at).toLocaleString()}</div>
              </div>
              <button onClick={() => doLoad(entry)}
                className="px-3 py-1.5 text-xs font-extrabold bg-accent/20 hover:bg-accent/30 border border-accent/40 text-accent rounded">
                LOAD
              </button>
              <button onClick={() => doExport(entry)}
                className="px-2 py-1.5 text-xs font-bold bg-ink/5 hover:bg-ink/10 border border-ink/10 rounded" title="Download as JSON">↓</button>
              <button onClick={() => { if (confirm(`Delete "${entry.name}"?`)) doDelete(entry.id); }}
                className="px-2 py-1.5 text-xs font-bold bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 rounded">✕</button>
            </div>
          ))}
        </div>
      )}
    </ModalShell>
  );
}

/* =============================================================
   ModalShell
   ============================================================= */
function ModalShell({ title, subtitle, onClose, children, wide }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm backdrop-fade" onClick={onClose}>
      <div className={`${wide ? 'max-w-3xl' : 'max-w-md'} w-full bg-s2 border border-ink/15 rounded-xl shadow-2xl overflow-hidden modal-pop corner-tape`}
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 60px rgb(var(--accent-rgb) / 0.12)' }}>
        <div className="h-0.5" style={{ background: 'linear-gradient(90deg, var(--accent), transparent 70%)' }} />
        <div className="px-5 py-3.5 border-b border-ink/10 flex items-center justify-between bg-gradient-to-r from-accent/[0.08] to-transparent">
          <div>
            <div className="text-lg font-extrabold" style={{ fontFamily: '"Uni Sans Heavy", "Bebas Neue", sans-serif', letterSpacing: '2px', fontStyle: 'italic' }}>{title}</div>
            {subtitle && <div className="text-[10px] text-mute font-mono tracking-wide">{subtitle}</div>}
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-md bg-ink/5 hover:bg-ink/15 border border-ink/10 text-mute hover:text-ink text-lg leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* =============================================================
   MAIN
   ============================================================= */
function TacticsBuilder({ session, profile, signOut }) {
  const [players, setPlayers] = useState(() => buildFormation('4-3-3'));
  const [possessionMode, setPossessionMode] = useState('inPossession');
  // Opens on the home side alone — a single shape is the common starting
  // point, and the opposition is one click away.
  const [editingTeam, setEditingTeam] = useState('home');
  // phases is a growable array — start with 4 empty slots, user can add more
  const [phases, setPhases] = useState([null, null, null, null]);
  const [currentPhase, setCurrentPhase] = useState(-1);
  const [playing, setPlaying] = useState(false);
  // Multi-select: Shift+click adds/removes. The LAST entry is the "primary"
  // — it's what the side-panel editor targets. setSelectedPlayer(id) keeps
  // the old single-select semantics for every existing call site.
  const [selectedIds, setSelectedIds] = useState([]);
  const selectedPlayer = selectedIds.length ? selectedIds[selectedIds.length - 1] : null;
  const setSelectedPlayer = useCallback((id) => setSelectedIds(id ? [id] : []), []);
  const toggleSelected = useCallback((id) => {
    const next = selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id];
    if (next.length > 1) track.multiSelect(next.length);
    setSelectedIds(next);
  }, [selectedIds]);
  const [tool, setTool] = useState('select');
  const [arrowColor, setArrowColor] = useState('white');
  // 'solid' = run, 'dashed' = pass — stored per arrow when drawn.
  const [arrowStyle, setArrowStyle] = useState('solid');
  // Top-level drawings — used when no phase is active. When a phase IS active,
  // drawings live inside that phase's `.drawings` object so they swap when
  // the user moves between phases.
  const [arrows, setArrows] = useState([]);
  const [zones, setZones] = useState([]);
  const [texts, setTexts] = useState([]);
  const [presses, setPresses] = useState([]);
  const [shapes, setShapes] = useState([]);      // rect/square objects
  const [tacticName, setTacticName] = useState('Untitled tactic');
  const [animating, setAnimating] = useState(false);
  const [drawingArrow, setDrawingArrow] = useState(null);
  const [drawingZone, setDrawingZone] = useState(null);
  const [drawingShape, setDrawingShape] = useState(null);
  // Phones and iPad-portrait can't spare 340px beside the pitch, so the panel
  // starts closed there and floats over the board when opened rather than
  // squeezing it. 1024px is the breakpoint where both fit comfortably.
  const NARROW_Q = '(max-width: 1023px)';
  const [isNarrow, setIsNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(NARROW_Q).matches);
  useEffect(() => {
    const mq = window.matchMedia(NARROW_Q);
    const onChange = (e) => setIsNarrow(e.matches);
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, []);
  const [showSidePanel, setShowSidePanel] = useState(
    () => !(typeof window !== 'undefined' && window.matchMedia(NARROW_Q).matches));
  const [draggingIds, setDraggingIds] = useState([]);  // token pickup scale
  const [exporting, setExporting] = useState(false);
  const [trails, setTrails] = useState([]);
  const [activePreset, setActivePreset] = useState('4-3-3');
  const [compareMode, setCompareMode] = useState(false);

  // 2D vs 3D view
  const [viewMode, setViewMode] = useState('2d');

  // Ball
  const [ballPos, setBallPos] = useState({ x: PITCH_W / 2, y: PITCH_H / 2 });

  const [opts, setOpts] = useState({
    showStats: false,
    showMovementArrows: false,
    showTrails: false,
    showChannels: false,
    showDefLine: false,
    showAds: false,
    playerMode: false,
    showBall: true,
    showShapeLines: true,   // positional-structure unit lines (2D)
    darkPitch: false,       // night-slate turf instead of green
    vertical: false,        // up-and-down stadium orientation
    customStadium: false,   // 3D-only: use the user-supplied .dae model
  });

  const [showDisplayOpts, setShowDisplayOpts] = useState(false);
  const [showTacticMgmt, setShowTacticMgmt] = useState(false);

  // ── Kit colours ────────────────────────────────────────────────
  const [kits, setKits] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('nahweeezy_kits') || 'null');
      return saved?.home && saved?.away ? saved : DEFAULT_KITS;
    } catch { return DEFAULT_KITS; }
  });
  useEffect(() => {
    try { localStorage.setItem('nahweeezy_kits', JSON.stringify(kits)); } catch {}
  }, [kits]);
  const kitPal = useMemo(() => ({
    home: kitPalette(kits.home),
    away: kitPalette(kits.away),
  }), [kits]);

  // ── Theme ──────────────────────────────────────────────────────
  // Persisted to localStorage; one of 'volt' | 'blue' | 'light' | 'dark' |
  // 'system'. Volt is the default identity; "system" resolves to light/dark
  // via prefers-color-scheme. v2 key: the v1 default was force-written as
  // 'blue' on first load, so honoring it would hide the redesign.
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('nahweeezy_theme_v2');
      return ['volt', 'blue', 'light', 'dark', 'system'].includes(saved) ? saved : 'volt';
    } catch { return 'volt'; }
  });
  useEffect(() => {
    try { localStorage.setItem('nahweeezy_theme_v2', theme); } catch {}
    const apply = () => {
      const resolved = theme === 'system'
        ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')
        : theme;
      document.documentElement.setAttribute('data-theme', resolved);
    };
    apply();
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => apply();
    // older Safari uses addListener; modern uses addEventListener
    if (mq.addEventListener) mq.addEventListener('change', onChange);
    else mq.addListener(onChange);
    return () => {
      if (mq.removeEventListener) mq.removeEventListener('change', onChange);
      else mq.removeListener(onChange);
    };
  }, [theme]);

  // Picking the Dark theme darkens the pitch surface too; any other theme
  // restores grass. Users can still flip Dark Pitch on its own afterwards.
  const chooseTheme = useCallback((id) => {
    track.themeChanged(id);
    setTheme(id);
    setOpts(o => ({ ...o, darkPitch: id === 'dark' }));
  }, []);

  // One baseline event per load. Everything else is a delta against this, so
  // segmenting by theme / device / signed-in state doesn't need a join.
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    identify(session?.user?.id || null);
    track.appReady({
      theme,
      dark_pitch: opts.darkPitch,
      viewport: isNarrow ? 'narrow' : 'wide',
      signed_in: !!session,
      touch: typeof window !== 'undefined' && 'ontouchstart' in window,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const playTimerRef = useRef(null);
  const historyRef = useRef([]);
  const futureRef = useRef([]);

  /* ── History ─────────────────────────────────────────────── */
  const snapshot = useCallback(() => ({
    players: JSON.parse(JSON.stringify(players)),
    arrows: JSON.parse(JSON.stringify(arrows)),
    zones: [...zones], texts: [...texts], presses: [...presses],
    shapes: [...shapes],
    phases: phases.map(p => p ? { ...p } : null),
    ballPos: { ...ballPos },
  }), [players, arrows, zones, texts, presses, shapes, phases, ballPos]);
  const pushHistory = useCallback(() => {
    historyRef.current.push(snapshot());
    if (historyRef.current.length > 50) historyRef.current.shift();
    futureRef.current = [];
  }, [snapshot]);
  const restore = (snap) => {
    setPlayers(snap.players); setArrows(snap.arrows); setZones(snap.zones);
    setTexts(snap.texts); setPresses(snap.presses); setPhases(snap.phases);
    setShapes(snap.shapes || []);
    if (snap.ballPos) setBallPos(snap.ballPos);
  };
  const undo = () => {
    if (!historyRef.current.length) return;
    track.boardAction('undo');
    futureRef.current.push(snapshot());
    restore(historyRef.current.pop());
  };
  const redo = () => {
    if (!futureRef.current.length) return;
    track.boardAction('redo');
    historyRef.current.push(snapshot());
    restore(futureRef.current.pop());
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); if (e.shiftKey) redo(); else undo();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault(); redo();
      } else if (e.key === 'Escape') {
        setSelectedPlayer(null); setTool('select');
      } else if (e.key === ' ' && phases.some(Boolean)) {
        e.preventDefault(); playing ? handlePause() : handlePlay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line
  }, [playing, phases]);

  /* ── Computed ────────────────────────────────────────────── */
  const displayedPositions = useMemo(() => {
    const map = {};
    for (const p of players) {
      if (currentPhase >= 0 && phases[currentPhase] && phases[currentPhase][p.id]) {
        map[p.id] = phases[currentPhase][p.id];
      } else {
        map[p.id] = p.pos[possessionMode];
      }
    }
    return map;
  }, [players, possessionMode, currentPhase, phases]);

  const displayedBall = useMemo(() => {
    if (currentPhase >= 0 && phases[currentPhase] && phases[currentPhase].__ball) {
      return phases[currentPhase].__ball;
    }
    return ballPos;
  }, [currentPhase, phases, ballPos]);

  // Whichever drawings are currently visible — phase's set in phase mode,
  // top-level otherwise. Components consume `live.arrows` etc.
  const live = useMemo(() => {
    if (currentPhase >= 0 && phases[currentPhase]?.drawings) {
      const d = phases[currentPhase].drawings;
      return {
        arrows: d.arrows || [], zones: d.zones || [],
        texts: d.texts || [], presses: d.presses || [],
        shapes: d.shapes || [],
      };
    }
    return { arrows, zones, texts, presses, shapes };
  }, [currentPhase, phases, arrows, zones, texts, presses, shapes]);

  // ── Goal confetti ───────────────────────────────────────────
  // When the ball enters a goal mouth, fire a celebratory confetti burst.
  // We only trigger on entry (rising edge) so the confetti doesn't loop while
  // the ball stays inside the goal.
  const [goalFire, setGoalFire] = useState({ key: 0, origin: null });
  const wasInGoalRef = useRef(false);
  useEffect(() => {
    const b = displayedBall;
    if (!b) return;
    const inLeftGoal  = b.x < 22 && b.y > PITCH_H/2 - 36 && b.y < PITCH_H/2 + 36;
    const inRightGoal = b.x > PITCH_W - 22 && b.y > PITCH_H/2 - 36 && b.y < PITCH_H/2 + 36;
    const inGoal = inLeftGoal || inRightGoal;
    if (inGoal && !wasInGoalRef.current) {
      setGoalFire({
        key: Date.now(),
        origin: { x: inLeftGoal ? 12 : PITCH_W - 12, y: PITCH_H / 2 },
      });
    }
    wasInGoalRef.current = inGoal;
  }, [displayedBall]);

  // Routes drawing mutations to the correct store (phase-scoped or top-level).
  const updateDrawings = (kind, updater) => {
    const apply = (xs) => (typeof updater === 'function' ? updater(xs) : updater);
    if (currentPhase >= 0) {
      setPhases(prev => prev.map((ph, i) => {
        if (i !== currentPhase) return ph;
        const d = ph?.drawings || { arrows: [], zones: [], texts: [], presses: [], shapes: [] };
        return { ...(ph || {}), drawings: { ...d, [kind]: apply(d[kind] || []) } };
      }));
    } else {
      if (kind === 'arrows')  setArrows(apply);
      if (kind === 'zones')   setZones(apply);
      if (kind === 'texts')   setTexts(apply);
      if (kind === 'presses') setPresses(apply);
      if (kind === 'shapes')  setShapes(apply);
    }
  };

  // Write absolute positions for many players at once — into the open phase
  // when there is one, otherwise into the base possession shape.
  const applyPositions = (map) => {
    if (!map || !Object.keys(map).length) return;
    if (currentPhase >= 0) {
      setPhases(prev => prev.map((ph, i) =>
        i === currentPhase ? { ...(ph || {}), ...map } : ph));
    } else {
      setPlayers(prev => prev.map(p => map[p.id]
        ? { ...p, pos: { ...p.pos, [possessionMode]: map[p.id] } } : p));
    }
  };

  // A side's defensive line is only meaningful when that side is on screen —
  // in Home-only or Away-only mode the hidden team's marker is suppressed.
  const defLines = useMemo(() => {
    const positions = displayedPositions;
    const at = (p) => positions[p.id]?.x ?? p.pos[possessionMode].x;
    const outfield = (team) => (editingTeam === 'both' || editingTeam === team)
      ? players.filter(p => p.team === team && p.label !== 'GK')
      : [];
    const homeDefs = outfield('home');
    const awayDefs = outfield('away');
    return {
      home: homeDefs.length ? homeDefs.reduce((min, p) => Math.min(min, at(p)), Infinity) : null,
      away: awayDefs.length ? awayDefs.reduce((max, p) => Math.max(max, at(p)), -Infinity) : null,
    };
  }, [players, displayedPositions, possessionMode, editingTeam]);

  const formationLabel = useMemo(() => {
    if (currentPhase >= 0) return `PHASE ${currentPhase + 1}`;
    const team = editingTeam === 'away' ? 'away' : 'home';
    const f = detectFormation(players, possessionMode, team);
    return f ? `${team === 'home' ? 'HOME' : 'AWAY'} · ${f}` : '';
  }, [players, possessionMode, editingTeam, currentPhase]);

  // Set of player ids already assigned somewhere on the pitch — used to dedupe
  // the picker so the same player can't be placed twice.
  const takenFaceIds = useMemo(() => {
    const s = new Set();
    for (const p of players) if (p.face?.id) s.add(p.face.id);
    return s;
  }, [players]);

  const triggerAnimation = useCallback(() => {
    setAnimating(true);
    setTimeout(() => setAnimating(false), PHASE_DURATION + 60);
  }, []);

  /* ── Drag ────────────────────────────────────────────────── */
  // When the pitch is in vertical (rotated) mode, the SVG viewBox is rotated
  // 90° clockwise around the centre. Pointer events fire in that rotated
  // viewbox space; we apply the inverse rotation here so all downstream
  // handlers see coordinates in the original (horizontal) coord space.
  const getPitchPoint = (e) => {
    const pt = getSVGPoint(svgRef.current, e);
    if (!opts.vertical) return pt;
    const cx = VB_X + VB_W / 2;
    const cy = VB_Y + VB_H / 2;
    return { x: cx + cy - pt.y, y: pt.x + cy - cx };
  };

  /* ── PURE-coordinate handlers (called by both 2D and 3D views) ── */
  // Moves any number of players together. The delta is clamped against the
  // group's bounding box so the shape never distorts at the touchline.
  const startGroupDrag = (ids, pt) => {
    if (playing || tool !== 'select') return;
    const orig = {};
    for (const id of ids) {
      const c = displayedPositions[id];
      if (c) orig[id] = { x: c.x, y: c.y };
    }
    const list = Object.keys(orig);
    if (!list.length) return;
    dragRef.current = { type: 'group', ids: list, orig, start: pt };
    setDraggingIds(list);
    pushHistory();
  };

  const startPlayerDrag = (id, pt, additive = false) => {
    if (playing) return;
    if (tool !== 'select') return;
    if (!displayedPositions[id]) return;
    // Shift+click toggles membership instead of starting a drag.
    if (additive) { toggleSelected(id); return; }
    // Grabbing a member of a multi-selection moves the whole selection.
    if (selectedIds.length > 1 && selectedIds.includes(id)) {
      startGroupDrag(selectedIds, pt);
      return;
    }
    setSelectedPlayer(id);
    startGroupDrag([id], pt);
  };
  const startBallDrag = (pt) => {
    if (playing) return;
    if (tool !== 'select') return;
    dragRef.current = { type: 'ball', offset: { x: pt.x - displayedBall.x, y: pt.y - displayedBall.y } };
    pushHistory();
  };
  // Tool-driven action when the user clicks an empty area of the pitch
  const startPitchAction = (pt) => {
    if (playing) return;
    if (tool === 'arrow') {
      setDrawingArrow({ points: [{ x: pt.x, y: pt.y }] });
      dragRef.current = { type: 'arrow' };
    } else if (tool === 'zone') {
      setDrawingZone({ x: pt.x, y: pt.y, w: 0, h: 0, sx: pt.x, sy: pt.y });
      dragRef.current = { type: 'zone' };
    } else if (tool === 'shape') {
      setDrawingShape({ x: pt.x, y: pt.y, w: 0, h: 0, sx: pt.x, sy: pt.y });
      dragRef.current = { type: 'shape-draw' };
    } else if (tool === 'text') {
      const text = window.prompt('Note text:');
      if (text && text.trim()) {
        pushHistory();
        track.drawingCreated('text');
        updateDrawings('texts', prev => [...prev, { id: uid('t'), x: pt.x, y: pt.y, text: text.trim().toUpperCase() }]);
      }
    } else if (tool === 'press') {
      pushHistory();
      track.drawingCreated('press');
      updateDrawings('presses', prev => [...prev, { id: uid('p'), x: pt.x, y: pt.y }]);
    } else if (tool === 'select') {
      setSelectedPlayer(null);
    }
  };
  const continueDragOrDraw = (pt, shiftKey = false) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    if (d.type === 'group') {
      const xs = d.ids.map(id => d.orig[id].x);
      const ys = d.ids.map(id => d.orig[id].y);
      const lo = PLAYER_R + 4;
      const hiX = PITCH_W - PLAYER_R - 4;
      const hiY = PITCH_H - PLAYER_R - 4;
      // one delta for everyone, bounded by the extremes of the group
      const dx = clamp(pt.x - d.start.x, lo - Math.min(...xs), hiX - Math.max(...xs));
      const dy = clamp(pt.y - d.start.y, lo - Math.min(...ys), hiY - Math.max(...ys));
      const map = {};
      for (const id of d.ids) map[id] = { x: d.orig[id].x + dx, y: d.orig[id].y + dy };
      applyPositions(map);
    } else if (d.type === 'ball') {
      const nx = clamp(pt.x - d.offset.x, BALL_R + 4, PITCH_W - BALL_R - 4);
      const ny = clamp(pt.y - d.offset.y, BALL_R + 4, PITCH_H - BALL_R - 4);
      if (currentPhase >= 0) {
        setPhases(prev => prev.map((ph, i) =>
          i === currentPhase ? { ...(ph || {}), __ball: { x: nx, y: ny } } : ph));
      } else {
        setBallPos({ x: nx, y: ny });
      }
    } else if (d.type === 'arrow') {
      setDrawingArrow(prev => {
        if (!prev) return null;
        const last = prev.points[prev.points.length - 1];
        const d2 = (pt.x - last.x) ** 2 + (pt.y - last.y) ** 2;
        if (d2 < 36) return prev;
        return { points: [...prev.points, { x: pt.x, y: pt.y }] };
      });
    } else if (d.type === 'zone') {
      setDrawingZone(z => {
        if (!z) return null;
        const nx = Math.min(z.sx, pt.x);
        const ny = Math.min(z.sy, pt.y);
        const nw = Math.abs(pt.x - z.sx);
        const nh = Math.abs(pt.y - z.sy);
        return { ...z, x: nx, y: ny, w: nw, h: nh };
      });
    } else if (d.type === 'shape-draw') {
      setDrawingShape(s => {
        if (!s) return null;
        let dx = pt.x - s.sx;
        let dy = pt.y - s.sy;
        if (shiftKey) {
          // Perfect square — longest side wins, sign follows the pointer
          const side = Math.max(Math.abs(dx), Math.abs(dy));
          dx = Math.sign(dx || 1) * side;
          dy = Math.sign(dy || 1) * side;
        }
        return {
          ...s,
          x: Math.min(s.sx, s.sx + dx),
          y: Math.min(s.sy, s.sy + dy),
          w: Math.abs(dx),
          h: Math.abs(dy),
        };
      });
    } else if (d.type === 'shape-move') {
      const nx = clamp(d.orig.x + (pt.x - d.start.x), 4, PITCH_W - d.w - 4);
      const ny = clamp(d.orig.y + (pt.y - d.start.y), 4, PITCH_H - d.h - 4);
      updateDrawings('shapes', prev => prev.map(s =>
        s.id === d.id ? { ...s, x: nx, y: ny } : s));
    }
  };

  /* ── 2D event-driven wrappers ───────────────────────────────── */
  const beginDragPlayer = (e, id) => {
    if (playing) return;
    if (tool !== 'select') return;
    e.stopPropagation(); e.preventDefault();
    const svg = svgRef.current;
    startPlayerDrag(id, getPitchPoint(e), e.shiftKey);
    if (svg?.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch {} }
  };

  // Grab a positional-structure line → move that entire unit.
  const beginDragBand = (e, ids) => {
    if (playing || tool !== 'select') return;
    e.stopPropagation(); e.preventDefault();
    setSelectedIds(ids);
    track.unitDragged(ids.length);
    startGroupDrag(ids, getPitchPoint(e));
    const svg = svgRef.current;
    if (svg?.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch {} }
  };

  const beginDragBall = (e) => {
    if (playing) return;
    if (tool !== 'select') return;
    e.stopPropagation(); e.preventDefault();
    const svg = svgRef.current;
    startBallDrag(getPitchPoint(e));
    if (svg?.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch {} }
  };

  const onPitchPointerDown = (e) => {
    if (e.target.closest && e.target.closest('g[data-player]')) return;
    if (e.target.closest && e.target.closest('g[data-ball]')) return;
    if (e.target.closest && e.target.closest('a[data-ad]')) return;
    startPitchAction(getPitchPoint(e));
  };

  const onPointerMove = (e) => {
    if (!dragRef.current) return;
    continueDragOrDraw(getPitchPoint(e), e.shiftKey);
  };

  // Move an existing shape object with the select tool.
  const beginDragShape = (e, id) => {
    if (playing || tool !== 'select') return;
    e.stopPropagation(); e.preventDefault();
    const shape = live.shapes.find(s => s.id === id);
    if (!shape) return;
    pushHistory();
    dragRef.current = {
      type: 'shape-move', id,
      start: getPitchPoint(e),
      orig: { x: shape.x, y: shape.y },
      w: shape.w, h: shape.h,
    };
    const svg = svgRef.current;
    if (svg?.setPointerCapture) { try { svg.setPointerCapture(e.pointerId); } catch {} }
  };

  const endDragOrDraw = () => {
    const d = dragRef.current;
    if (!d) return;
    if (d.type === 'arrow' && drawingArrow) {
      if (drawingArrow.points.length >= 2) {
        const first = drawingArrow.points[0];
        const last = drawingArrow.points[drawingArrow.points.length - 1];
        const len = Math.hypot(last.x - first.x, last.y - first.y);
        if (len > 12) {
          pushHistory();
          track.drawingCreated('arrow', { color: arrowColor, style: arrowStyle, points: drawingArrow.points.length });
          updateDrawings('arrows', prev => [...prev, { id: uid('a'), points: drawingArrow.points, color: arrowColor, style: arrowStyle }]);
        }
      }
      setDrawingArrow(null);
    } else if (d.type === 'zone' && drawingZone) {
      if (drawingZone.w > 18 && drawingZone.h > 18) {
        pushHistory();
        track.drawingCreated('zone', { color: arrowColor });
        updateDrawings('zones', prev => [...prev, {
          id: uid('z'), x: drawingZone.x, y: drawingZone.y,
          w: drawingZone.w, h: drawingZone.h,
          color: hexA(ARROW_COLORS[arrowColor] || ARROW_COLORS.white, 0.16),
        }]);
      }
      setDrawingZone(null);
    } else if (d.type === 'shape-draw' && drawingShape) {
      if (drawingShape.w > 14 && drawingShape.h > 14) {
        pushHistory();
        track.drawingCreated('shape', { color: arrowColor, square: Math.abs(drawingShape.w - drawingShape.h) < 2 });
        updateDrawings('shapes', prev => [...prev, {
          id: uid('s'), x: drawingShape.x, y: drawingShape.y,
          w: drawingShape.w, h: drawingShape.h, color: arrowColor,
        }]);
      }
      setDrawingShape(null);
    }
    dragRef.current = null;
    setDraggingIds([]);
  };
  // 2D wrapper for SVG onPointerUp/onPointerLeave
  const onPointerUp = () => endDragOrDraw();

  /* ── Player handlers ─────────────────────────────────────── */
  const handleContextMenu = (e, id) => {
    e.preventDefault(); e.stopPropagation();
    if (opts.playerMode) {
      pushHistory();
      setPlayers(prev => prev.map(p => p.id === id ? { ...p, face: null } : p));
      return;
    }
    setSelectedPlayer(id);
  };
  const handleDoubleClick = (e, id) => {
    e.preventDefault(); e.stopPropagation();
    setSelectedPlayer(id);
  };

  const tryErase = (kind, id) => {
    if (tool !== 'eraser') return false;
    pushHistory();
    track.drawingErased(kind);
    const collKey = { arrow: 'arrows', zone: 'zones', text: 'texts', press: 'presses', shape: 'shapes' }[kind];
    if (collKey) updateDrawings(collKey, prev => prev.filter(x => x.id !== id));
    return true;
  };

  // ── API surface used by 3D view ────────────────────────────
  // Defined AFTER all the handlers it references (tryErase etc.) so the
  // object literal doesn't hit a TDZ error during render.
  const tacticsApi = {
    startPlayerDrag,
    startBallDrag,
    startPitchAction,
    continueDragOrDraw,
    endDragOrDraw,
    selectPlayer: (id) => setSelectedPlayer(id),
    clearFaceFor: (id) => {
      pushHistory();
      setPlayers(prev => prev.map(p => p.id === id ? { ...p, face: null } : p));
    },
    tryErase,
  };

  /* ── Formation / mirror / clear ──────────────────────────── */
  const loadPreset = (key) => {
    pushHistory(); triggerAnimation();
    track.loadFormation(key);
    setPlayers(buildFormation(key));
    setActivePreset(key); setCurrentPhase(-1);
    setPhases([null, null, null, null]);  // baseline — user can grow beyond 4
  };
  const mirrorTactic = () => {
    pushHistory(); triggerAnimation();
    track.boardAction('mirror');
    setPlayers(prev => prev.map(p => ({
      ...p,
      pos: {
        inPossession: { x: mirrorX(p.pos.inPossession.x), y: p.pos.inPossession.y },
        outOfPossession: { x: mirrorX(p.pos.outOfPossession.x), y: p.pos.outOfPossession.y },
      },
      team: p.team === 'home' ? 'away' : 'home',
    })));
    setArrows(prev => prev.map(a => ({
      ...a,
      points: a.points
        ? a.points.map(pt => ({ x: mirrorX(pt.x), y: pt.y }))
        : [{x: mirrorX(a.x1), y: a.y1}, {x: mirrorX(a.x2), y: a.y2}],
    })));
    setZones(prev => prev.map(z => ({ ...z, x: mirrorX(z.x + z.w) })));
    setTexts(prev => prev.map(t => ({ ...t, x: mirrorX(t.x) })));
    setPresses(prev => prev.map(p => ({ ...p, x: mirrorX(p.x) })));
    setShapes(prev => prev.map(s => ({ ...s, x: mirrorX(s.x + s.w) })));
    setBallPos(prev => ({ x: mirrorX(prev.x), y: prev.y }));
    setPhases(prev => prev.map(ph => {
      if (!ph) return null;
      const out = {};
      for (const k in ph) {
        if (k === 'drawings') {
          // Mirror per-phase drawings too
          const d = ph.drawings || {};
          out.drawings = {
            arrows: (d.arrows || []).map(a => ({
              ...a,
              points: a.points
                ? a.points.map(pt => ({ x: mirrorX(pt.x), y: pt.y }))
                : a.points,
            })),
            zones: (d.zones || []).map(z => ({ ...z, x: mirrorX(z.x + z.w) })),
            texts: (d.texts || []).map(t => ({ ...t, x: mirrorX(t.x) })),
            presses: (d.presses || []).map(p => ({ ...p, x: mirrorX(p.x) })),
            shapes: (d.shapes || []).map(s => ({ ...s, x: mirrorX(s.x + s.w) })),
          };
        } else if (k === 'title') {
          out.title = ph.title;
        } else {
          out[k] = { x: mirrorX(ph[k].x), y: ph[k].y };
        }
      }
      return out;
    }));
  };
  /* ── Balance symmetry ──────────────────────────────────────────
     Squares the shape up about the pitch's long axis: every mirrored
     role pair (LB/RB, LM/RM, LW/RW, LWB/RWB) is pulled to a shared
     depth and equal offset from the centre line. Central roles pair
     outside-in — CB with CB, ST with ST — and an odd one out is
     centred. Only the team(s) currently being edited are touched. */
  const balanceSymmetry = () => {
    pushHistory(); triggerAnimation();
    track.boardAction('balance_symmetry', { team: editingTeam });
    const mid = PITCH_H / 2;
    const teams = editingTeam === 'both' ? ['home', 'away'] : [editingTeam];
    const next = {};
    const posOf = (p) => displayedPositions[p.id] || p.pos[possessionMode];
    // `a` takes the left slot (small y), `b` the right (large y)
    const symPair = (a, b) => {
      const pa = posOf(a), pb = posOf(b);
      const x = (pa.x + pb.x) / 2;
      const dev = (Math.abs(mid - pa.y) + Math.abs(pb.y - mid)) / 2;
      next[a.id] = { x, y: mid - dev };
      next[b.id] = { x, y: mid + dev };
    };

    for (const team of teams) {
      const squad = players.filter(p => p.team === team);
      const byY = (list) => [...list].sort((m, n) => posOf(m).y - posOf(n).y);

      for (const [L, R] of MIRROR_PAIRS) {
        const ls = byY(squad.filter(p => p.label === L));
        const rs = byY(squad.filter(p => p.label === R));
        const n = Math.min(ls.length, rs.length);
        for (let i = 0; i < n; i++) symPair(ls[i], rs[rs.length - 1 - i]);
      }
      for (const label of CENTRAL_ROLES) {
        const list = byY(squad.filter(p => p.label === label));
        for (let i = 0, j = list.length - 1; i < j; i++, j--) symPair(list[i], list[j]);
        if (list.length % 2 === 1) {
          const m = list[(list.length - 1) / 2];
          next[m.id] = { x: posOf(m).x, y: mid };
        }
      }
    }
    applyPositions(next);
  };

  const clearOverlays = () => {
    pushHistory();
    track.boardAction('clear_overlays', { scope: currentPhase >= 0 ? 'phase' : 'board' });
    if (currentPhase >= 0) {
      // Clear the current phase's drawings only
      updateDrawings('arrows', []);
      updateDrawings('zones', []);
      updateDrawings('texts', []);
      updateDrawings('presses', []);
      updateDrawings('shapes', []);
    } else {
      setArrows([]); setZones([]); setTexts([]); setPresses([]); setShapes([]);
    }
  };

  /* ── Phase ───────────────────────────────────────────────── */
  const savePhase = (idx) => {
    pushHistory();
    const snap = {};
    for (const p of players) snap[p.id] = { ...displayedPositions[p.id] };
    snap.__ball = { ...displayedBall };
    // Snapshot the currently-displayed drawings into the phase, so the
    // user's per-phase whiteboard sticks across navigation.
    snap.drawings = {
      arrows:  live.arrows.map(a  => ({ ...a, points: a.points ? [...a.points] : a.points })),
      zones:   live.zones.map(z   => ({ ...z })),
      texts:   live.texts.map(t   => ({ ...t })),
      presses: live.presses.map(p => ({ ...p })),
      shapes:  live.shapes.map(s  => ({ ...s })),
    };
    setPhases(prev => {
      // Auto-grow if the user is saving past the current array length.
      const next = idx < prev.length ? [...prev] : [...prev, ...Array(idx - prev.length + 1).fill(null)];
      // Preserve any existing title; otherwise default to "Phase N"
      const existingTitle = prev[idx]?.title;
      snap.title = existingTitle || `Phase ${idx + 1}`;
      next[idx] = snap;
      return next;
    });
    setCurrentPhase(idx);
    track.saveTactic({ phase: idx + 1, name: tacticName });
  };
  const clearPhase = (idx) => {
    pushHistory();
    track.phaseAction('clear', { index: idx + 1 });
    setPhases(prev => prev.map((ph, i) => i === idx ? null : ph));
    if (currentPhase === idx) setCurrentPhase(-1);
  };
  const goToPhase = (idx) => {
    if (phases[idx]) { triggerAnimation(); setCurrentPhase(idx); } else { savePhase(idx); }
  };
  // Add a new empty phase slot at the end (button shows "+" when last slot is filled).
  const addPhaseSlot = () => {
    pushHistory();
    track.phaseAction('add_slot', { total: phases.length + 1 });
    setPhases(prev => [...prev, null]);
  };
  // Inline rename via prompt — simple but does the job.
  const renamePhase = (idx) => {
    const cur = phases[idx]?.title || `Phase ${idx + 1}`;
    const next = window.prompt('Rename phase', cur);
    if (next == null) return;
    const trimmed = next.trim().slice(0, 32);
    if (!trimmed) return;
    pushHistory();
    track.phaseAction('rename', { index: idx + 1 });
    setPhases(prev => prev.map((ph, i) =>
      i === idx && ph ? { ...ph, title: trimmed } : ph));
  };
  const togglePossessionMode = (mode) => {
    if (mode === possessionMode) return;
    triggerAnimation();
    setPossessionMode(mode);
    track.togglePossession(mode);
  };
  const handlePlay = () => {
    const saved = phases.map((p, i) => p ? i : -1).filter(i => i >= 0);
    if (saved.length < 2) return;
    track.playPhases({ count: saved.length });
    // Wipe any leftover ghost trails from a previous run before starting a new one
    setTrails([]);
    setPlaying(true); setAnimating(true);
    let stepIdx = saved.indexOf(currentPhase);
    if (stepIdx < 0 || stepIdx === saved.length - 1) stepIdx = 0;
    setCurrentPhase(saved[stepIdx]);
    const advance = () => {
      stepIdx++;
      if (stepIdx >= saved.length) {
        setPlaying(false); setAnimating(false); playTimerRef.current = null;
        return;
      }
      if (opts.showTrails) {
        const from = phases[saved[stepIdx - 1]];
        const to = phases[saved[stepIdx]];
        // Build trails from player positions only — skip metadata keys
        // like __ball, drawings, title.
        const skip = new Set(['__ball', 'drawings', 'title']);
        const newTrails = Object.keys(from).filter(k => !skip.has(k) && from[k]?.x != null).map(pid => ({
          id: uid('tr'), x1: from[pid].x, y1: from[pid].y,
          x2: to[pid] ? to[pid].x : from[pid].x,
          y2: to[pid] ? to[pid].y : from[pid].y,
        }));
        setTrails(prev => [...prev, ...newTrails]);
      }
      setCurrentPhase(saved[stepIdx]);
      playTimerRef.current = setTimeout(advance, PHASE_DURATION + 100);
    };
    playTimerRef.current = setTimeout(advance, PHASE_DURATION + 100);
  };
  const handlePause = () => {
    if (playTimerRef.current) clearTimeout(playTimerRef.current);
    playTimerRef.current = null;
    setPlaying(false); setAnimating(false);
  };
  const stepPhase = (delta) => {
    if (playing) handlePause();
    const saved = phases.map((p, i) => p ? i : -1).filter(i => i >= 0);
    if (!saved.length) return;
    triggerAnimation();
    let idx = saved.indexOf(currentPhase);
    if (idx < 0) idx = 0;
    else idx = clamp(idx + delta, 0, saved.length - 1);
    setCurrentPhase(saved[idx]);
  };
  const exitPhase = () => {
    triggerAnimation();
    track.phaseAction('exit');
    setCurrentPhase(-1);
    setTrails([]);
  };

  /* ── Export ──────────────────────────────────────────────── */
  // A serialized SVG rasterises inside an isolated document that cannot
  // resolve external or root-relative URLs, so face cutouts and ad logos
  // would silently vanish from the export. Inline every raster first.
  const inlineRasters = async (root) => {
    const nodes = [...root.querySelectorAll('image, img')];
    await Promise.all(nodes.map(async (el) => {
      const attr = el.tagName.toLowerCase() === 'img' ? 'src' : 'href';
      const src = el.getAttribute(attr) || el.getAttribute('xlink:href');
      if (!src || src.startsWith('data:')) return;
      try {
        const res = await fetch(src, { mode: 'cors' });
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        const dataUri = await new Promise((resolve, reject) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.onerror = reject;
          fr.readAsDataURL(blob);
        });
        el.setAttribute(attr, dataUri);
        el.removeAttribute('xlink:href');
      } catch {
        // Drop unreachable assets — a broken reference can abort the whole
        // rasterisation, losing the entire export rather than one image.
        el.remove();
      }
    }));
  };

  const exportPNG = async () => {
    const svg = svgRef.current;
    if (!svg || exporting) return;
    setExporting(true);
    const startedAt = performance.now();
    const facesOnBoard = players.filter(p => p.face).length;
    let url;
    try {
      const clone = svg.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      await inlineRasters(clone);
      const xml = new XMLSerializer().serializeToString(clone);
      url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));

      const img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error('Could not rasterise the board.'));
        im.src = url;
      });

      const scale = 2;
      const canvas = document.createElement('canvas');
      canvas.width = VB_W * scale;
      canvas.height = (VB_H + 80) * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = skin.deck;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 80 * scale, VB_W * scale, VB_H * scale);
      ctx.fillStyle = '#f1f4e3';
      ctx.font = `${28 * scale}px "Bebas Neue", Inter, sans-serif`;
      ctx.fillText(tacticName.toUpperCase(), 24 * scale, 50 * scale);
      ctx.fillStyle = COLORS.accent;
      ctx.font = `${14 * scale}px Oswald, Inter, sans-serif`;
      ctx.fillText(formationLabel || possessionMode.toUpperCase(), 24 * scale, 72 * scale);

      const a = document.createElement('a');
      a.download = `${tacticName.replace(/[^a-z0-9]+/gi, '_') || 'tactic'}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
      track.exportTactic({
        format: 'png', status: 'success', faces: facesOnBoard,
        view: opts.vertical ? 'vertical' : 'horizontal',
        ms: Math.round(performance.now() - startedAt),
      });
    } catch (err) {
      console.error('[export]', err);
      track.exportTactic({ format: 'png', status: 'error', reason: String(err?.name || err).slice(0, 60) });
      alert(`Export failed: ${err.message || err}`);
    } finally {
      if (url) URL.revokeObjectURL(url);
      setExporting(false);
    }
  };

  /* ── Tactic save/load ────────────────────────────────────── */
  const collectTacticData = () => ({
    name: tacticName, players, phases, arrows, zones, texts, presses, shapes, ballPos,
    activePreset, possessionMode, editingTeam,
    saved_with_version: 'v3',
  });
  const restoreTacticData = (d) => {
    if (!d || !Array.isArray(d.players)) return;
    pushHistory(); triggerAnimation();
    setTacticName(d.name || 'Loaded tactic');
    // Boards saved before the football-faces switch carry `fpl` assignments
    // keyed by FPL id, which can't be resolved to a face — drop them and keep
    // everything else about the player intact.
    setPlayers(d.players.map(({ fpl, ...p }) => (fpl && !p.face ? { ...p, face: null } : p)));
    setPhases(d.phases || [null, null, null, null]);
    setArrows(d.arrows || []); setZones(d.zones || []);
    setTexts(d.texts || []); setPresses(d.presses || []);
    setShapes(d.shapes || []);
    if (d.ballPos) setBallPos(d.ballPos);
    setCurrentPhase(-1);
    setActivePreset(d.activePreset || '4-3-3');
    if (d.possessionMode) setPossessionMode(d.possessionMode);
    if (d.editingTeam) setEditingTeam(d.editingTeam);
  };

  /* ── Faces & Position ────────────────────────────────────── */
  const handleFacePick = (faceData) => {
    if (!selectedPlayer) return;
    pushHistory();
    track.faceAssigned({
      player_id: faceData.id, player_name: faceData.name,
      role: faceData.role, nation: faceData.nation,
    });
    setPlayers(prev => prev.map(p => p.id === selectedPlayer ? { ...p, face: faceData } : p));
  };
  const handleFaceClear = () => {
    if (!selectedPlayer) return;
    pushHistory();
    track.faceCleared('panel');
    setPlayers(prev => prev.map(p => p.id === selectedPlayer ? { ...p, face: null } : p));
  };
  const handlePositionPick = (pos) => {
    if (!selectedPlayer) return;
    pushHistory();
    track.positionChanged(players.find(p => p.id === selectedPlayer)?.label, pos);
    setPlayers(prev => prev.map(p => {
      if (p.id !== selectedPlayer) return p;
      // The face assignment survives a role change — playing a winger at
      // wing-back is a legitimate tactical choice, not a data mismatch.
      return { ...p, label: pos };
    }));
  };

  /* ── Drawing previews ────────────────────────────────────── */
  const renderDrawingArrow = drawingArrow && drawingArrow.points.length >= 2 && (
    <path d={drawingArrow.points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ')}
      fill="none" stroke={ARROW_COLORS[arrowColor]} strokeWidth={3} strokeDasharray="6 4"
      strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" opacity={0.95} />
  );
  const renderDrawingZone = drawingZone && (
    <rect x={drawingZone.x} y={drawingZone.y} width={drawingZone.w} height={drawingZone.h}
      fill={ARROW_COLORS[arrowColor]} fillOpacity={0.18}
      stroke={ARROW_COLORS[arrowColor]} strokeOpacity={0.6}
      strokeDasharray="6 4" strokeWidth={2} pointerEvents="none" />
  );
  const renderDrawingShape = drawingShape && (
    <rect x={drawingShape.x} y={drawingShape.y} width={drawingShape.w} height={drawingShape.h}
      fill={ARROW_COLORS[arrowColor]} fillOpacity={0.08}
      stroke={ARROW_COLORS[arrowColor]} strokeOpacity={0.85}
      strokeDasharray="8 5" strokeWidth={2.5} pointerEvents="none" />
  );

  // Corner-bracket rect object — crisp outline, faint fill, bold corners.
  const renderShapeObject = (s) => {
    const c = ARROW_COLORS[s.color] || ARROW_COLORS.white;
    const tick = Math.min(12, s.w / 3, s.h / 3);
    const corners = [
      `M ${s.x} ${s.y + tick} L ${s.x} ${s.y} L ${s.x + tick} ${s.y}`,
      `M ${s.x + s.w - tick} ${s.y} L ${s.x + s.w} ${s.y} L ${s.x + s.w} ${s.y + tick}`,
      `M ${s.x + s.w} ${s.y + s.h - tick} L ${s.x + s.w} ${s.y + s.h} L ${s.x + s.w - tick} ${s.y + s.h}`,
      `M ${s.x + tick} ${s.y + s.h} L ${s.x} ${s.y + s.h} L ${s.x} ${s.y + s.h - tick}`,
    ];
    return (
      <g key={s.id} data-shape={s.id}
        onPointerDown={(e) => beginDragShape(e, s.id)}
        onClick={() => tryErase('shape', s.id)}
        style={{ cursor: tool === 'select' ? 'move' : tool === 'eraser' ? 'not-allowed' : undefined }}>
        <rect x={s.x} y={s.y} width={s.w} height={s.h}
          fill={hexA(c, 0.09)} stroke={c} strokeWidth={2} strokeOpacity={0.8} />
        {corners.map((d, i) => (
          <path key={i} d={d} fill="none" stroke={c} strokeWidth={4} strokeLinecap="square" />
        ))}
      </g>
    );
  };

  const adSlots = useMemo(() => buildAdSlots(DEFAULT_ADS), []);
  const skin = opts.darkPitch ? PITCH_SKINS.dark : PITCH_SKINS.grass;

  /* ── Pitch render ────────────────────────────────────────── */
  const renderPitch = (mode, label) => {
    const positions = (currentPhase >= 0 && phases[currentPhase])
      ? phases[currentPhase]
      : Object.fromEntries(players.map(p => [p.id, p.pos[mode]]));

    // Vertical mode: swap the viewBox dims (W↔H) and rotate ALL content
    // 90° clockwise around the original viewBox center. The SVG element's
    // intrinsic aspect-ratio adjusts automatically because `width:100%
    // height:auto` derives height from viewBox aspect.
    const cx = VB_X + VB_W / 2;
    const cy = VB_Y + VB_H / 2;
    const verticalVB = `${cx - VB_H / 2} ${cy - VB_W / 2} ${VB_H} ${VB_W}`;
    const horizontalVB = `${VB_X} ${VB_Y} ${VB_W} ${VB_H}`;

    // Sizing: in vertical mode the SVG is portrait (~836×1194). Pin it by
    // height and let width auto-derive from viewBox aspect, so the user
    // never has to scroll. ~190px reserved for top bar + status row + phase
    // bar + the surrounding p-4.
    const verticalSize = {
      height: 'min(calc(100vh - 190px), 100%)',
      width: 'auto',
      maxWidth: '100%',
      display: 'block',
      margin: '0 auto',
    };

    return (
      <svg
        ref={mode === possessionMode ? svgRef : null}
        viewBox={opts.vertical ? verticalVB : horizontalVB}
        className={
          opts.vertical
            ? 'select-none touch-none rounded-xl border border-ink/10 pitch-clip'
            : 'w-full h-auto select-none touch-none rounded-xl border border-ink/10 pitch-clip'
        }
        style={{
          background: `radial-gradient(800px 400px at 50% 0%, rgba(215,255,60,0.10), transparent 70%), ${skin.deck}`,
          boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 0 60px rgba(215,255,60,0.08)',
          ...(opts.vertical ? verticalSize : {}),
          cursor:
            tool === 'select' ? 'default' :
            tool === 'arrow'  ? 'crosshair' :
            tool === 'zone'   ? 'crosshair' :
            tool === 'text'   ? 'text' :
            tool === 'press'  ? 'crosshair' :
            tool === 'eraser' ? 'not-allowed' : 'default',
        }}
        onPointerDown={mode === possessionMode ? onPitchPointerDown : undefined}
        onPointerMove={mode === possessionMode ? onPointerMove : undefined}
        onPointerUp={mode === possessionMode ? onPointerUp : undefined}
        onPointerLeave={mode === possessionMode ? onPointerUp : undefined}
      >
        <defs>
          {Object.entries(ARROW_COLORS).map(([key, c]) => (
            <marker key={key} id={`arrow-${key}`} viewBox="0 0 10 10" refX="8" refY="5"
              markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={c} />
            </marker>
          ))}
          <radialGradient id="pressGrad">
            <stop offset="0%" stopColor="#fb7185" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.4" />
          </radialGradient>
          <radialGradient id="pitchVignette">
            <stop offset="60%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.35)" />
          </radialGradient>
          <radialGradient id="playGlow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="rgba(215,255,60,0)" />
            <stop offset="80%" stopColor="rgba(215,255,60,0.05)" />
            <stop offset="100%" stopColor="rgba(215,255,60,0.18)" />
          </radialGradient>
          {/* corner floodlight cones */}
          <radialGradient id="floodTL" cx="0%" cy="0%" r="80%">
            <stop offset="0%"  stopColor="rgba(255,255,255,0.18)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0.04)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <radialGradient id="floodTR" cx="100%" cy="0%" r="80%">
            <stop offset="0%"  stopColor="rgba(255,255,255,0.18)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0.04)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <radialGradient id="floodBL" cx="0%" cy="100%" r="80%">
            <stop offset="0%"  stopColor="rgba(255,255,255,0.14)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0.03)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          <radialGradient id="floodBR" cx="100%" cy="100%" r="80%">
            <stop offset="0%"  stopColor="rgba(255,255,255,0.14)" />
            <stop offset="60%" stopColor="rgba(255,255,255,0.03)" />
            <stop offset="100%" stopColor="rgba(255,255,255,0)" />
          </radialGradient>
          {/* grass tile pattern — subtle horizontal nap */}
          <pattern id="grassNap" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill="transparent"/>
            <line x1="0" y1="0" x2="6" y2="0" stroke="rgba(255,255,255,0.025)" strokeWidth="0.5"/>
          </pattern>
          {/* crowd silhouette — tiny dot pattern for the band outside the pitch */}
          <pattern id="crowdDots" width="6" height="6" patternUnits="userSpaceOnUse">
            <circle cx="2" cy="2" r="1" fill="rgba(20,30,50,0.85)" />
            <circle cx="5" cy="4" r="0.9" fill="rgba(35,45,65,0.85)" />
          </pattern>
          {opts.showAds && <AdBoardDefs ads={DEFAULT_ADS} />}
          {/* kit shading — off-center light source for a 3D shirt read */}
          {['home', 'away'].map(team => (
            <radialGradient key={team} id={`kit${team === 'home' ? 'Home' : 'Away'}`}
              cx="35%" cy="30%" r="85%">
              <stop offset="0%"   stopColor={kitPal[team].hi} />
              <stop offset="62%"  stopColor={kitPal[team].base} />
              <stop offset="100%" stopColor={kitPal[team].lo} />
            </radialGradient>
          ))}
        </defs>

        {/* All visible content lives inside this `<g>`. When `opts.vertical`
            is true we rotate 90° clockwise around the center of the original
            viewBox; the swapped viewBox above keeps the result in frame. */}
        <g transform={opts.vertical ? `rotate(90 ${cx} ${cy})` : undefined}>
        <rect x={VB_X} y={VB_Y} width={VB_W} height={VB_H} fill={skin.deck} />
        <rect x={VB_X + 4} y={VB_Y + 4} width={VB_W - 8} height={VB_H - 8}
          fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={1} />

        {/* CROWD silhouette band — only visible when ads are off so it doesn't
            compete; keeps it from looking empty */}
        {!opts.showAds && (
          <g pointerEvents="none">
            <rect x={VB_X + 8} y={VB_Y + 8} width={VB_W - 16} height={AD_BAND_TB - 14}
              fill="url(#crowdDots)" opacity={0.55} />
            <rect x={VB_X + 8} y={PITCH_H + AD_BAND_TB / 2 - 6}
              width={VB_W - 16} height={AD_BAND_TB - 14}
              fill="url(#crowdDots)" opacity={0.55} />
          </g>
        )}

        <rect x={-8} y={-8} width={PITCH_W + 16} height={PITCH_H + 16}
          fill="none" stroke={skin.frame} strokeWidth={2} rx={4} />

        <PitchLines showChannels={opts.showChannels} showDefLine={opts.showDefLine} defLines={defLines} playing={playing} animating={animating} skin={skin} kitPal={kitPal} />

        {/* Subtle grass-nap pattern over the pitch */}
        <rect x={0} y={0} width={PITCH_W} height={PITCH_H}
          fill="url(#grassNap)" pointerEvents="none" />

        {/* CORNER FLOODLIGHTS — soft white cones from each corner of the pitch */}
        <g pointerEvents="none" opacity={0.85}>
          <rect x={0} y={0} width={PITCH_W * 0.55} height={PITCH_H * 0.55} fill="url(#floodTL)" />
          <rect x={PITCH_W * 0.45} y={0} width={PITCH_W * 0.55} height={PITCH_H * 0.55} fill="url(#floodTR)" />
          <rect x={0} y={PITCH_H * 0.45} width={PITCH_W * 0.55} height={PITCH_H * 0.55} fill="url(#floodBL)" />
          <rect x={PITCH_W * 0.45} y={PITCH_H * 0.45} width={PITCH_W * 0.55} height={PITCH_H * 0.55} fill="url(#floodBR)" />
        </g>

        {/* CORNER FLAGS */}
        <CornerFlags />

        {/* DUST PARTICLES — slow drift for ambient stadium feel */}
        <DustParticles />

        {/* BROADCAST SCOREBOARD — top-left over the pitch when in PLAY mode */}
        {playing && (
          <g pointerEvents="none">
            <rect x={PITCH_W / 2 - 110} y={32} width={220} height={32} rx={4}
              fill="rgba(0,0,0,0.85)" stroke="rgba(215,255,60,0.5)" strokeWidth={1} />
            <rect x={PITCH_W / 2 - 110} y={32} width={6} height={32} fill="#f43f5e" />
            <text x={PITCH_W / 2 - 96} y={54} fontSize={14} fontWeight={900}
              fill="#ffffff" letterSpacing="2"
              style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
              ● LIVE · TACTICS
            </text>
            <circle cx={PITCH_W / 2 + 84} cy={48} r={3.5} fill="#22c55e">
              <animate attributeName="opacity" values="1;0.3;1" dur="1s" repeatCount="indefinite" />
            </circle>
          </g>
        )}

        {opts.showAds && adSlots.map((slot, i) => (
          <AdBoard key={`ad-${i}`} slot={slot} />
        ))}

        {/* POSITIONAL STRUCTURE — unit lines under drawings & tokens */}
        {opts.showShapeLines && (
          <ShapeLines players={players} positions={positions}
            editingTeam={editingTeam} animating={animating}
            tool={tool} kitPal={kitPal}
            onBandPointerDown={mode === possessionMode ? beginDragBand : undefined} />
        )}

        {live.zones.map(z => (
          <rect key={z.id} x={z.x} y={z.y} width={z.w} height={z.h}
            fill={z.color}
            stroke={z.color.replace(/[\d.]+\)$/, '0.6)')}
            strokeWidth={1.5} strokeDasharray="4 4"
            onClick={() => tryErase('zone', z.id)} />
        ))}
        {live.shapes.map(renderShapeObject)}
        {opts.showTrails && trails.map(t => (
          <line key={t.id} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2}
            stroke="rgba(255,255,255,0.5)" strokeWidth={1.5} strokeDasharray="4 4" pointerEvents="none" />
        ))}
        {live.arrows.map(a => (
          <g key={a.id} onClick={() => tryErase('arrow', a.id)}>
            <ArrowOverlay arrow={a} />
          </g>
        ))}
        {live.presses.map(p => (
          <g key={p.id} transform={`translate(${p.x},${p.y})`}
            onClick={() => tryErase('press', p.id)}>
            <circle r={20} fill="url(#pressGrad)" stroke="#fff" strokeWidth={2}>
              <animate attributeName="r" values="16;22;16" dur="1.4s" repeatCount="indefinite" />
            </circle>
            <text x={0} y={5} textAnchor="middle" fontSize={16} fontWeight={900} fill="#fff"
              style={{ fontFamily: 'Inter,sans-serif' }}>!</text>
          </g>
        ))}
        {live.texts.map(t => (
          <g key={t.id} transform={`translate(${t.x},${t.y})`}
            onClick={() => tryErase('text', t.id)}>
            <rect x={-4} y={-13} width={t.text.length * 7 + 14} height={20} rx={2}
              fill="rgba(0,0,0,0.82)" stroke="rgba(215,255,60,0.42)" strokeWidth={1} />
            <text x={4} y={2} fontSize={11} fontWeight={800} fill="#d7ff3c"
              style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1.2px' }}>
              {t.text}
            </text>
          </g>
        ))}

        {mode === possessionMode && renderDrawingArrow}
        {mode === possessionMode && renderDrawingZone}
        {mode === possessionMode && renderDrawingShape}

        {/* Goal confetti — re-renders the burst whenever goalFire.key changes */}
        <GoalConfetti origin={goalFire.origin} fireKey={goalFire.key} />

        {opts.showBall && (
          <Ball
            x={displayedBall.x}
            y={displayedBall.y}
            animating={animating}
            onPointerDown={mode === possessionMode ? beginDragBall : undefined}
          />
        )}

        {players
          .filter(p => editingTeam === 'both' || p.team === editingTeam)
          .map(p => (
            <g key={p.id} data-player={p.id}>
              <PlayerToken
                player={p}
                x={positions[p.id].x}
                y={positions[p.id].y}
                selected={selectedIds.includes(p.id)}
                dragging={draggingIds.includes(p.id)}
                animating={animating}
                showStats={opts.showStats}
                showMovementArrows={opts.showMovementArrows}
                playerMode={opts.playerMode}
                pal={kitPal[p.team]}
                onPointerDown={beginDragPlayer}
                onContextMenu={handleContextMenu}
                onDoubleClick={handleDoubleClick}
              />
            </g>
        ))}

        <g pointerEvents="none">
          <rect x={20} y={PITCH_H - 50} width={240} height={32} rx={4}
            fill="rgba(0,0,0,0.78)" stroke="rgba(215,255,60,0.42)" strokeWidth={1} />
          <text x={32} y={PITCH_H - 28} fontSize={14} fontWeight={800} fill="#d7ff3c"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1.5px' }}>
            {label}
          </text>
        </g>
        </g>
      </svg>
    );
  };

  /* ── Selected ────────────────────────────────────────────── */
  const sel = selectedPlayer ? players.find(p => p.id === selectedPlayer) : null;
  const patchSelected = (patch) =>
    setPlayers(prev => prev.map(p => p.id === selectedPlayer ? { ...p, ...patch } : p));
  const updateSelected = (patch) => {
    pushHistory();
    patchSelected(patch);
  };

  const phaseSavedCount = phases.filter(Boolean).length;

  return (
    <div className="min-h-screen w-full text-ink flex flex-col app-shell"
      style={{ fontFamily: '"Space Grotesk", Inter, system-ui, sans-serif' }}>

      {/* TOP BAR */}
      <header className="flex items-center gap-2.5 px-4 py-2.5 border-b border-ink/10 bg-s1/95 backdrop-blur flex-wrap relative rise">
        <div className="absolute left-0 top-0 bottom-0 w-1"
          style={{background: 'linear-gradient(180deg, var(--accent) 0%, var(--accent-deep) 100%)'}} />

        <a href="index.html" className="flex flex-col group select-none mr-2 ml-1.5">
          <span className="text-[10px] font-extrabold tracking-[0.3em] text-accent -mb-1"
            style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif', fontStyle:'italic'}}>NAHWEEEZY'S</span>
          <span className="text-[1.18rem] font-black tracking-[0.14em] leading-none text-ink group-hover:text-accent transition flex items-center gap-1.5"
            style={{fontFamily:'"Uni Sans Heavy", "Bebas Neue", sans-serif', fontStyle:'italic'}}>
            TACTICS BOARD
            <span className="inline-block w-2 h-2 -skew-x-12 bg-accent group-hover:animate-pulse" />
          </span>
        </a>

        <div className="h-7 w-px bg-ink/10" />

        <input
          value={tacticName} onChange={(e) => setTacticName(e.target.value)}
          className="bg-well/40 border border-ink/10 rounded px-2.5 py-1.5 text-sm font-bold text-ink placeholder-dim focus:outline-none focus:border-accent w-56"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.5px' }}
          placeholder="Tactic name…"
        />

        <div className="flex items-center bg-well/40 rounded p-0.5 border border-ink/10">
          <button
            onClick={() => togglePossessionMode('inPossession')}
            className={`px-2.5 py-1.5 text-[11px] font-extrabold rounded transition tracking-wider ${
              possessionMode === 'inPossession' ? 'bg-accent text-acc-ink shadow-glow' : 'text-mute hover:text-ink'
            }`} style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>IN POSS.</button>
          <button
            onClick={() => togglePossessionMode('outOfPossession')}
            className={`px-2.5 py-1.5 text-[11px] font-extrabold rounded transition tracking-wider ${
              possessionMode === 'outOfPossession' ? 'bg-rose-500 text-ink' : 'text-mute hover:text-ink'
            }`} style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>OUT OF POSS.</button>
        </div>

        <div className="flex items-center bg-well/40 rounded p-0.5 border border-ink/10">
          {[
            ['home', 'H', kitPal.home.base, kitPal.home.ink],
            ['both', 'BOTH', '#e2e8f0', '#0f172a'],
            ['away', 'A', kitPal.away.base, kitPal.away.ink],
          ].map(([key, label, bg, fg]) => (
            <button key={key} onClick={() => { setEditingTeam(key); track.teamFilter(key); }}
              className="px-2 py-1.5 text-[11px] font-black rounded transition"
              style={{
                fontFamily:'"Uni Sans Heavy", Oswald, sans-serif', letterSpacing:'1px',
                background: editingTeam === key ? bg : 'transparent',
                color: editingTeam === key ? fg : 'rgb(var(--mute-rgb))',
              }}>
              {label}
            </button>
          ))}
        </div>

        <select value={activePreset} onChange={(e) => loadPreset(e.target.value)}
          className="bg-well/40 border border-ink/10 rounded px-2 py-1.5 text-[11px] font-extrabold focus:outline-none focus:border-accent cursor-pointer"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
          {FORMATION_KEYS.map(k => <option key={k} value={k} className="bg-s1">{k}</option>)}
        </select>

        {/* 2D / 3D toggle — large unique tab */}
        <div className="flex items-center bg-well/50 rounded p-0.5 border border-accent/40 shadow-glow">
          <button
            onClick={() => { setViewMode('2d'); track.viewMode('2d'); }}
            className={`px-3 py-1.5 text-[11px] font-black tracking-wider rounded transition ${
              viewMode === '2d' ? 'bg-accent text-acc-ink shadow-glow' : 'text-mute hover:text-ink'
            }`}
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            ▱ 2D
          </button>
          <button
            onClick={() => { setViewMode('3d'); track.viewMode('3d'); }}
            className={`px-3 py-1.5 text-[11px] font-black tracking-wider rounded transition ${
              viewMode === '3d' ? 'bg-accent text-acc-ink shadow-glow' : 'text-mute hover:text-ink'
            }`}
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            ⛁ 3D
          </button>
        </div>

        <button onClick={mirrorTactic}
          className="px-2.5 py-1.5 text-[11px] font-extrabold bg-ink/5 hover:bg-ink/10 border border-ink/10 rounded transition"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
          ⇄ MIRROR
        </button>
        <button onClick={balanceSymmetry}
          title="Square the shape up — mirrored roles (LB/RB, LM/RM, LW/RW…) get equal depth and equal offset from the centre line"
          className="px-2.5 py-1.5 text-[11px] font-extrabold bg-ink/5 hover:bg-ink/10 border border-ink/10 rounded transition"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
          ⚖ BALANCE SYMMETRY
        </button>
        <button onClick={() => { track.boardAction(compareMode ? 'compare_off' : 'compare_on'); setCompareMode(c => !c); }}
          className={`px-2.5 py-1.5 text-[11px] font-extrabold border rounded transition ${
            compareMode ? 'bg-accent/20 border-accent/40 text-accent' : 'bg-ink/5 hover:bg-ink/10 border-ink/10'
          }`} style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
          ⊟ COMPARE
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setShowDisplayOpts(true)}
            className="px-2.5 py-1.5 text-[11px] font-extrabold bg-ink/5 hover:bg-ink/10 border border-ink/10 rounded transition"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
            👁 VISUAL DISPLAY SETTINGS
          </button>
          <button onClick={() => setShowTacticMgmt(true)}
            className="px-2.5 py-1.5 text-[11px] font-extrabold bg-ink/5 hover:bg-ink/10 border border-ink/10 rounded transition"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
            ☰ TACTICS
          </button>
          <button onClick={undo}
            className="px-2 py-1.5 text-[11px] font-bold bg-ink/5 hover:bg-ink/10 border border-ink/10 rounded">↶</button>
          <button onClick={redo}
            className="px-2 py-1.5 text-[11px] font-bold bg-ink/5 hover:bg-ink/10 border border-ink/10 rounded">↷</button>
          <button onClick={exportPNG} disabled={exporting}
            className="px-3 py-1.5 text-[11px] font-black bg-accent hover:brightness-110 text-acc-ink rounded transition shadow-glow sheen disabled:opacity-60"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
            {exporting ? '⏳ EXPORTING…' : '⇩ EXPORT'}
          </button>

          {profile && (
            <div className="flex items-center gap-1.5 ml-1 pl-2 border-l border-ink/10">
              <div className="flex flex-col text-right leading-tight pr-1">
                <span className="text-[8px] font-extrabold tracking-[0.3em] text-dim"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>SIGNED IN</span>
                <span className="text-[12px] font-extrabold text-accent tracking-wide truncate max-w-[120px]"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                  @{profile.username}
                </span>
              </div>
              <button onClick={() => { track.logout('builder_header'); identify(null); signOut(); }}
                title="Log out"
                className="px-2 py-1.5 text-[11px] font-extrabold bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 rounded"
                style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
                ⏏ OUT
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* TOOLBAR */}
        <aside className="flex flex-col gap-1 p-2 border-r border-ink/10 bg-s1 w-14 overflow-y-auto rise d1">
          {[
            ['select', '✥', 'Select & drag (players, ball, shapes)'],
            ['arrow', '➤', 'Arrow tool (freehand)'],
            ['shape', '▭', 'Rect / square object — hold Shift for a square'],
            ['zone', '▱', 'Zone shading'],
            ['text', 'T', 'Text label'],
            ['press', '!', 'Press trigger'],
            ['eraser', '⌫', 'Eraser'],
          ].map(([t, icon, title]) => (
            <button key={t} onClick={() => { setTool(t); track.selectTool(t); }} title={title}
              className={`w-10 h-10 rounded flex items-center justify-center text-base font-extrabold transition border ${
                tool === t
                  ? 'bg-accent/20 border-accent/55 text-accent shadow-glow'
                  : 'bg-ink/5 border-ink/10 hover:bg-ink/10 text-mute'
              }`}>
              {icon}
            </button>
          ))}
          <div className="h-px bg-ink/10 my-1" />
          {/* Arrow line style — solid RUN vs dashed PASS */}
          {[
            ['solid', '━', 'RUN', 'Solid arrows — player runs'],
            ['dashed', '╍', 'PASS', 'Dashed arrows — passes (animated)'],
          ].map(([s, icon, tag, title]) => (
            <button key={s} onClick={() => setArrowStyle(s)} title={title}
              className={`w-10 h-8 rounded flex flex-col items-center justify-center leading-none transition border ${
                arrowStyle === s
                  ? 'bg-accent/20 border-accent/55 text-accent'
                  : 'bg-ink/5 border-ink/10 hover:bg-ink/10 text-mute'
              }`}>
              <span className="text-[13px] -mb-0.5">{icon}</span>
              <span className="text-[6.5px] font-black tracking-widest"
                style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>{tag}</span>
            </button>
          ))}
          <div className="h-px bg-ink/10 my-1" />
          {ARROW_COLOR_KEYS.map(c => (
            <button key={c} onClick={() => setArrowColor(c)}
              className={`w-10 h-6 rounded border-2 transition ${
                arrowColor === c ? 'border-accent shadow-glow scale-105' : 'border-ink/10 hover:border-ink/30'
              }`}
              style={{ background: ARROW_COLORS[c] }} title={`Color: ${c}`} />
          ))}
          <div className="h-px bg-ink/10 my-1" />
          <button onClick={clearOverlays}
            className="w-10 h-10 rounded bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[10px] font-extrabold tracking-wider"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            CLR
          </button>
        </aside>

        {/* PITCH */}
        <main className="flex-1 min-w-0 p-4 overflow-auto rise d2">
          <div className="max-w-[1500px] mx-auto">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-dim font-extrabold tracking-[0.25em]"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>SHAPE</span>
                <span className={`font-black tracking-[0.15em] text-[15px] ${possessionMode === 'inPossession' ? 'text-accent' : 'text-rose-400'}`}
                  style={{fontFamily:'"Uni Sans Heavy", "Bebas Neue", sans-serif'}}>
                  {formationLabel || '—'}
                </span>
                {currentPhase >= 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-black bg-accent/20 text-accent border border-accent/40 rounded tracking-widest"
                    style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                    PHASE {currentPhase + 1}
                  </span>
                )}
                {opts.playerMode && (
                  <span className="px-2 py-0.5 text-[10px] font-black bg-accent/30 text-ink border border-accent/40 rounded tracking-widest"
                    style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                    FACES
                  </span>
                )}
                {playing && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-black bg-rose-500/30 text-ink border border-rose-400/50 rounded tracking-widest"
                    style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                    LIVE
                  </span>
                )}
              </div>
              <div className="text-[10px] text-dim font-mono tracking-widest">
                Drag · Click → side panel · Shift+box = square · Esc · Ctrl+Z
              </div>
            </div>

            {viewMode === '3d' ? (
              <ErrorBoundary>
                <Suspense fallback={
                  <div className="rounded-xl border border-ink/10 bg-s1 flex items-center justify-center"
                       style={{ height: 'calc(100vh - 160px)' }}>
                    <div className="text-center">
                      <div className="w-10 h-10 mx-auto mb-3 border-2 border-ink/10 border-t-accent rounded-full animate-spin" />
                      <div className="text-[10px] tracking-[0.4em] text-accent font-display">LOADING 3D ENGINE</div>
                    </div>
                  </div>
                }>
                  <Pitch3D
                    tactics={tacticsApi}
                    players={players}
                    displayedPositions={displayedPositions}
                    ballPos={displayedBall}
                    selectedPlayer={selectedPlayer}
                    playerMode={opts.playerMode}
                    tool={tool}
                    arrowColor={arrowColor}
                    drawings={live}
                    drawingArrow={drawingArrow}
                    drawingZone={drawingZone}
                    customStadium={opts.customStadium}
                    animating={animating}
                    kits={kits}
                  />
                </Suspense>
              </ErrorBoundary>
            ) : compareMode ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-black tracking-[0.3em] text-accent mb-1.5 px-1"
                    style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>IN POSSESSION</div>
                  {renderPitch('inPossession', 'IN POSSESSION')}
                </div>
                <div>
                  <div className="text-[10px] font-black tracking-[0.3em] text-rose-400 mb-1.5 px-1"
                    style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>OUT OF POSSESSION</div>
                  {renderPitch('outOfPossession', 'OUT OF POSSESSION')}
                </div>
              </div>
            ) : (
              <div>{renderPitch(possessionMode, possessionMode === 'inPossession' ? 'IN POSSESSION' : 'OUT OF POSSESSION')}</div>
            )}

            {/* PHASE BAR */}
            <div className="mt-4 p-3 rounded-xl bg-s1 border border-ink/10 flex items-center gap-3 flex-wrap"
              style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), 0 6px 24px rgba(0,0,0,0.4)' }}>
              <div className="flex items-center gap-1">
                <button onClick={() => stepPhase(-1)} disabled={!phaseSavedCount}
                  className="px-3 py-2 rounded bg-ink/5 hover:bg-ink/10 border border-ink/10 text-sm disabled:opacity-30">⏮</button>
                <button
                  onClick={playing ? handlePause : handlePlay}
                  disabled={phaseSavedCount < 2}
                  className={`px-4 py-2 rounded text-[12px] font-black tracking-widest transition ${
                    playing ? 'bg-rose-500 text-white pulse-glow' : 'bg-accent text-acc-ink hover:brightness-110 shadow-glow sheen'
                  } disabled:opacity-30`}
                  style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                  {playing ? '⏸ PAUSE' : '▶ PLAY'}
                </button>
                <button onClick={() => stepPhase(1)} disabled={!phaseSavedCount}
                  className="px-3 py-2 rounded bg-ink/5 hover:bg-ink/10 border border-ink/10 text-sm disabled:opacity-30">⏭</button>
              </div>

              <div className="h-8 w-px bg-ink/10" />

              <div className="flex items-center gap-1.5 flex-wrap max-w-[640px]">
                <span className="text-[10px] text-dim font-extrabold tracking-[0.2em] mr-1"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>PHASES</span>
                {phases.map((ph, i) => {
                  const saved = !!ph;
                  const active = currentPhase === i;
                  const phaseTitle = ph?.title || `Phase ${i + 1}`;
                  return (
                    <div key={i} className="flex flex-col items-center">
                      <button
                        onClick={() => goToPhase(i)}
                        onContextMenu={(e) => { e.preventDefault(); if (saved) renamePhase(i); }}
                        title={saved ? `${phaseTitle} (right-click to rename)` : `Save current as Phase ${i+1}`}
                        className={`w-9 h-9 rounded text-xs font-black border transition ${
                          active ? 'bg-accent text-acc-ink border-accent shadow-glow'
                                 : saved ? 'bg-accent/15 border-accent/40 text-accent hover:bg-accent/25'
                                         : 'bg-ink/5 border-ink/10 text-dim hover:bg-ink/10 hover:text-mute'
                        }`}
                        style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                        {i+1}
                      </button>
                      {/* Title (truncated) — click to rename */}
                      {saved && (
                        <button
                          onClick={() => renamePhase(i)}
                          title="Rename phase"
                          className="text-[8.5px] mt-0.5 max-w-[70px] truncate text-mute hover:text-accent cursor-pointer leading-none"
                          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.5px' }}>
                          {phaseTitle.toUpperCase()}
                        </button>
                      )}
                    </div>
                  );
                })}
                {/* Add a new phase slot — only when the last slot already has data,
                    to avoid an infinite trail of empty buttons */}
                {phases[phases.length - 1] && (
                  <button onClick={addPhaseSlot}
                    title="Add another phase slot"
                    className="w-9 h-9 rounded text-sm font-black border border-dashed border-accent/40 text-accent hover:bg-accent/15 transition"
                    style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                    +
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => savePhase(currentPhase >= 0 ? currentPhase : (phases.findIndex(p => !p) === -1 ? 0 : phases.findIndex(p => !p)))}
                  className="px-2.5 py-1.5 text-[10px] font-black bg-accent/20 hover:bg-accent/30 border border-accent/40 text-accent rounded tracking-widest"
                  style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                  + SAVE PHASE
                </button>
                {currentPhase >= 0 && (
                  <button onClick={() => clearPhase(currentPhase)}
                    className="px-2.5 py-1.5 text-[10px] font-black bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-200 rounded tracking-widest"
                    style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                    CLEAR PHASE
                  </button>
                )}
                {currentPhase >= 0 && (
                  <button onClick={exitPhase}
                    className="px-2.5 py-1.5 text-[10px] font-black bg-ink/5 hover:bg-ink/10 border border-ink/10 rounded tracking-widest"
                    style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                    ← EDIT
                  </button>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* Dim the board behind the drawer so the panel reads as a layer. */}
        {isNarrow && showSidePanel && (
          <div className="fixed inset-0 z-30 bg-black/50 backdrop-fade"
            onClick={() => setShowSidePanel(false)} />
        )}

        {/* SIDE PANEL — in-flow column on desktop, floating drawer when narrow */}
        <aside className={`border-l border-ink/10 bg-s1 transition-all overflow-auto rise d3 ${
          isNarrow && showSidePanel
            ? 'fixed top-0 right-0 bottom-0 z-40 w-[min(340px,86vw)] shadow-2xl'
            : showSidePanel ? 'w-[340px]' : 'w-12'
        }`}>
          <button onClick={() => setShowSidePanel(s => !s)}
            className="w-full px-3 py-2.5 text-[10px] font-black tracking-[0.3em] text-mute hover:text-ink hover:bg-ink/5 border-b border-ink/10 flex items-center gap-2"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            {showSidePanel ? '◀' : '▶'} {showSidePanel && 'PLAYER PANEL'}
          </button>

          {showSidePanel && (
            <div className="p-3 space-y-4">
              {selectedIds.length > 1 && (
                <section className="p-2.5 rounded-lg bg-accent/10 border border-accent/35 flex items-center gap-2">
                  <span className="text-[15px] font-black text-accent"
                    style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                    {selectedIds.length}
                  </span>
                  <div className="flex-1 min-w-0 leading-tight">
                    <div className="text-[10px] font-extrabold text-accent tracking-[0.2em]"
                      style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>PLAYERS SELECTED</div>
                    <div className="text-[10px] text-mute">Drag any one to move them together.</div>
                  </div>
                  <button onClick={() => setSelectedIds([])}
                    className="px-2 py-1 text-[9px] font-extrabold bg-ink/5 hover:bg-ink/15 border border-ink/10 rounded tracking-wider"
                    style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                    CLEAR
                  </button>
                </section>
              )}
              {sel ? (
                <Fragment>
                  <section className="p-3 rounded-lg bg-ink/[0.03] border border-ink/10 corner-tape">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-black flex-shrink-0 overflow-hidden relative"
                        style={{
                          background: kitPal[sel.team].base,
                          color: kitPal[sel.team].ink,
                          fontFamily: '"Uni Sans Heavy", Oswald, sans-serif',
                          boxShadow: '0 0 14px rgba(215,255,60,0.25)',
                        }}>
                        {sel.face ? (
                          <img src={faceUrl(sel.face.id)} alt="" aria-hidden="true"
                            className="absolute inset-0 w-full h-auto"
                            style={{ objectFit: 'cover', objectPosition: 'top' }}
                            onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                        ) : sel.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-dim font-extrabold tracking-[0.2em]"
                          style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                          {sel.team === 'home' ? 'HOME' : 'AWAY'} · #{sel.number}
                          {sel.face?.nation ? ` · ${sel.face.nation}` : ''}
                        </div>
                        <div className="text-sm font-extrabold text-ink tracking-wide truncate"
                          title={sel.face ? sel.face.fullName : undefined}
                          style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                          {sel.name?.trim() || (sel.face ? sel.face.fullName : `Player ${sel.label}`)}
                        </div>
                      </div>
                      <button onClick={() => setSelectedPlayer(null)}
                        className="w-6 h-6 rounded bg-ink/5 hover:bg-ink/15 text-mute hover:text-ink text-sm leading-none">×</button>
                    </div>

                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[10px] font-extrabold text-accent tracking-[0.25em]"
                        style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>NAME</div>
                      {sel.name && (
                        <button onClick={() => updateSelected({ name: '' })}
                          className="text-[9px] font-extrabold tracking-wider text-mute hover:text-ink"
                          style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                          CLEAR
                        </button>
                      )}
                    </div>
                    <input
                      value={sel.name || ''}
                      /* One undo step per editing session, not per keystroke. */
                      onFocus={pushHistory}
                      onChange={(e) => patchSelected({ name: e.target.value.slice(0, 24) })}
                      /* One event per committed edit, not per keystroke. */
                      onBlur={(e) => { if (e.target.value.trim()) track.playerNamed({ has_face: !!sel.face }); }}
                      placeholder={sel.face ? sel.face.name : 'Add a name…'}
                      maxLength={24}
                      className="w-full mb-3 bg-well/50 border border-ink/10 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-accent" />

                    <div className="text-[10px] font-extrabold text-accent tracking-[0.25em] mb-1.5"
                      style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>POSITION</div>
                    <PositionGrid current={sel.label} onPick={handlePositionPick} />

                    <div className="mt-3 pt-3 border-t border-ink/10 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] text-mute font-mono tracking-widest mb-1">SPEED <span className="text-accent">{sel.speed}</span></div>
                        <input type="range" min={1} max={10} value={sel.speed}
                          onChange={(e) => updateSelected({ speed: +e.target.value })}
                          className="w-full accent-accent" />
                      </div>
                      <div>
                        <div className="text-[10px] text-mute font-mono tracking-widest mb-1">PRESS <span className="text-rose-300">{sel.press}</span></div>
                        <input type="range" min={1} max={10} value={sel.press}
                          onChange={(e) => updateSelected({ press: +e.target.value })}
                          className="w-full accent-rose-500" />
                      </div>
                    </div>
                  </section>

                  {opts.playerMode ? (
                    <FacePickerPanel
                      targetPlayer={sel}
                      takenIds={takenFaceIds}
                      onPick={handleFacePick}
                      onClear={handleFaceClear}
                    />
                  ) : (
                    <button
                      onClick={() => setOpts(o => ({ ...o, playerMode: true }))}
                      className="w-full py-2.5 bg-accent/10 hover:bg-accent/20 border border-accent/30 text-accent rounded text-[11px] font-extrabold tracking-wider"
                      style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                      ENABLE PLAYER MODE → ASSIGN A REAL FACE
                    </button>
                  )}
                </Fragment>
              ) : (
                <section className="p-3 rounded-lg bg-ink/[0.02] border border-dashed border-ink/10 text-center">
                  <div className="text-[24px] mb-1">⚽</div>
                  <div className="text-[11px] text-mute leading-snug">
                    Click a player on the pitch to name them, edit their position and stats, or assign a real player's face.
                  </div>
                </section>
              )}

              {/* CONCEPT PLAYBOOK — blurred */}
              <section className="relative">
                <div className="text-[10px] font-extrabold tracking-[0.3em] text-accent mb-2"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>CONCEPT PLAYBOOK</div>
                <div className="relative rounded-lg overflow-hidden border border-ink/10">
                  <div className="space-y-2 p-3" style={{ filter: 'blur(5px)', userSelect: 'none', pointerEvents: 'none' }}>
                    {[
                      ["Pep's 3-2-5 Build-Up", "GK + back-three. RB inverts into double pivot."],
                      ["Klopp's Gegenpress", "Heavy-metal pressing, 5-second swarm."],
                      ["High Press 4-3-3", "Striker triggers on back-pass, fullbacks jump."],
                      ["Half-Space Overload", "Right-side combination, 10 finds the seam."],
                    ].map((c, i) => (
                      <div key={i} className="p-3 rounded bg-ink/[0.03] border border-ink/10">
                        <div className="text-sm font-black text-ink"
                          style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>{c[0]}</div>
                        <div className="text-[11px] text-mute mt-0.5">{c[1]}</div>
                      </div>
                    ))}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center bg-well/50 backdrop-blur-[2px]">
                    <div className="text-center">
                      <div className="text-[8px] font-extrabold text-accent tracking-[0.4em] mb-1"
                        style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>WORK IN PROGRESS</div>
                      <div className="text-2xl font-black shimmer-text"
                        style={{fontFamily:'"Uni Sans Heavy", "Bebas Neue", sans-serif', letterSpacing: '0.1em'}}>
                        COMING SOON
                      </div>
                      <div className="text-[10px] text-mute mt-2 max-w-[220px] mx-auto leading-tight">
                        Pre-built tactical concepts loading positions, arrows &amp; phases.
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* COMMUNITY TACTICS — public DB */}
              <CommunityTactics
                session={session}
                profile={profile}
                currentTactic={{ name: tacticName, data: collectTacticData() }}
                onLoad={(entry) => {
                  // Loaded payload mirrors `collectTacticData` shape
                  if (entry && entry.data) restoreTacticData(entry.data);
                }}
              />

              <section className="text-[10px] text-dim leading-relaxed border-t border-ink/10 pt-3 font-mono">
                <div className="font-extrabold text-mute mb-1 tracking-[0.2em]"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>GENERAL HOTKEYS</div>
                <div>• Drag → reposition · Click → edit panel</div>
                <div>• <span className="text-accent">Shift+click</span> players → multi-select · drag any one to move them together</div>
                <div>• Drag a <span className="text-accent">structure line</span> → move that whole unit</div>
                <div>• Right-click player → clear the assigned face</div>
                <div>• Arrow tool → freehand path · <span className="text-accent">RUN/PASS</span> sets line style</div>
                <div>• Shape tool → drag a box · <span className="text-accent">Shift</span> = perfect square</div>
                <div>• Select tool → drag shapes to reposition them</div>
                <div>• Right-click phase → rename</div>
                <div>• Ctrl+Z undo · Esc deselect · Space play/pause</div>
                <div className="font-extrabold text-mute mb-1 mt-3 tracking-[0.2em]"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>3D MODE</div>
                <div>• <span className="text-accent">LMB</span> → drag players · draw · click drawings to erase</div>
                <div>• <span className="text-accent">Ctrl + LMB</span> drag → orbit camera</div>
                <div>• <span className="text-accent">RMB</span> drag → orbit camera</div>
                <div>• <span className="text-accent">Scroll</span> → zoom in / out</div>
                <div>• <span className="text-accent">Middle drag</span> → dolly</div>
              </section>
            </div>
          )}
        </aside>
      </div>

      <DisplayOptionsModal
        open={showDisplayOpts}
        onClose={() => setShowDisplayOpts(false)}
        opts={opts} setOpts={setOpts}
        theme={theme} setTheme={chooseTheme}
        kits={kits} setKits={setKits}
      />
      <TacticManagementModal
        open={showTacticMgmt}
        onClose={() => setShowTacticMgmt(false)}
        current={{ name: tacticName, data: collectTacticData() }}
        onLoad={restoreTacticData}
      />
    </div>
  );
}

export default TacticsBuilder;
