/* eslint-disable */
import { useState, useEffect, useRef, useMemo, useCallback, Fragment, lazy, Suspense } from 'react';
import { track } from './analytics';
import CommunityTactics from './community/CommunityTactics';
import { supabase } from './supabase';
import ErrorBoundary from './ErrorBoundary';
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

const COLORS = {
  pitch:     '#1f5f30',
  pitchAlt:  '#1d5a2d',
  line:      'rgba(255,255,255,0.85)',
  home:      '#2563eb',
  homeRing:  '#1e40af',
  away:      '#dc2626',
  awayRing:  '#7f1d1d',
  selected:  '#60a5fa',
  accent:    '#60a5fa',
  accentDeep:'#3b82f6',
};

const ARROW_COLORS = {
  white:  '#f8fafc',
  yellow: '#fde047',
  orange: '#fb923c',
  blue:   '#60a5fa',
};

// Premier League club primary colors — used to glow the ring around an FPL token.
const PL_TEAM_COLORS = {
  ARS: '#ef0107', AVL: '#95bfe5', BOU: '#da291c', BRE: '#e30613',
  BHA: '#0057b8', CHE: '#034694', CRY: '#1b458f', EVE: '#003399',
  FUL: '#ffffff', LEI: '#003090', LIV: '#c8102e', MCI: '#6cabdd',
  MUN: '#da291c', NEW: '#241f20', NFO: '#dd0000', SOU: '#d71920',
  TOT: '#132257', WHU: '#7a263a', WOL: '#fdb913', IPS: '#3457a4',
  LEE: '#ffcd00', BUR: '#6c1d45', SHU: '#ee2737',
};

/* =============================================================
   POSITIONS
   ============================================================= */
const POSITION_GRID = [
  ['LW',  'ST',  'RW'],
  ['LM',  'CAM', 'RM'],
  ['LB',  'CM',  'RB'],
  ['CDM', 'CB',  'GK'],
];

// Map UI position → FPL element_type (1=GK, 2=DEF, 3=MID, 4=FWD)
const POSITION_TO_FPL = {
  GK:  1,
  CB:  2, LB: 2, RB: 2,
  CDM: 3, CM: 3, CAM: 3, LM: 3, RM: 3,
  LW:  4, ST: 4, RW: 4,
};

const FPL_CATEGORY_LABEL = { 1: 'GKP', 2: 'DEF', 3: 'MID', 4: 'FWD' };

/* =============================================================
   AD BOARDS
   ============================================================= */
const DEFAULT_ADS = [
  { id: 'yt',    label: 'YOUTUBE',  sub: '@Nahweeezy',   url: 'https://youtube.com/@Nahweeezy',  icon: '/assets/icons/youtube.png',  g1: '#ff0000', g2: '#990000' },
  { id: 'tt',    label: 'TIKTOK',   sub: '@Nahweeezy',   url: 'https://tiktok.com/@Nahweeezy',   icon: '/assets/icons/tiktok.webp',  g1: '#000000', g2: '#ff0050' },
  { id: 'dc',    label: 'DISCORD',  sub: 'Join server',  url: 'https://discord.gg/nahweeezy',    icon: '/assets/icons/discord.webp', g1: '#5865f2', g2: '#3a44b8' },
  { id: 'x',     label: 'X',        sub: '@Nahweeezy',   url: 'https://x.com/Nahweeezy',         icon: '/assets/icons/x.webp',       g1: '#0a0a0a', g2: '#272727' },
  { id: 'tw',    label: 'TWITCH',   sub: 'Live reacts',  url: 'https://twitch.tv/nahweeezy',     icon: '/assets/icons/twitch.webp',  g1: '#9146ff', g2: '#5c2da3' },
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
      id: `h${i}`, team: 'home', label, number: i === 0 ? 1 : i + 1, fpl: null,
      pos: { inPossession: { x, y }, outOfPossession: { x, y } },
      arrowDir: null, speed: 6, press: 6,
    });
  });
  formation.forEach(([label, x, y], i) => {
    players.push({
      id: `a${i}`, team: 'away', label, number: i === 0 ? 1 : i + 1, fpl: null,
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
   FPL HELPERS
   ============================================================= */
let _fplCache = null;
async function fetchFpl() {
  if (_fplCache) return _fplCache;
  const url = 'https://fantasy.premierleague.com/api/bootstrap-static/';
  try {
    const r = await fetch(url, { mode: 'cors' });
    if (r.ok) { _fplCache = await r.json(); return _fplCache; }
  } catch {}
  // corsproxy.io is the primary fallback per production-prep — it works in
  // Vercel's runtime where direct calls fail due to FPL's missing CORS headers.
  const proxies = [
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
    `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  ];
  for (const p of proxies) {
    try {
      const r = await fetch(p);
      if (r.ok) { _fplCache = await r.json(); return _fplCache; }
    } catch {}
  }
  throw new Error('Could not fetch FPL data — try again.');
}

const fplPhotoUrl = (code) => `https://resources.premierleague.com/premierleague/photos/players/110x140/p${code}.png`;

/* =============================================================
   PITCH LINES
   ============================================================= */
function PitchLines({ showChannels, showDefLine, defLines, playing, animating }) {
  // Smoothly translate the def-line group via CSS transform when animating
  // so it doesn't teleport between phases like x1/x2 attribute changes do.
  const lineTrans = animating ? `transform ${PHASE_DURATION}ms linear` : 'none';
  return (
    <g pointerEvents="none">
      {Array.from({ length: 12 }).map((_, i) => (
        <rect key={i} x={i * (PITCH_W / 12)} y={0}
          width={PITCH_W / 12} height={PITCH_H}
          fill={i % 2 === 0 ? COLORS.pitch : COLORS.pitchAlt} />
      ))}
      <rect x={0} y={0} width={PITCH_W} height={PITCH_H} fill="url(#pitchVignette)" />
      {playing && (
        <rect x={0} y={0} width={PITCH_W} height={PITCH_H} fill="url(#playGlow)" pointerEvents="none">
          <animate attributeName="opacity" values="0.7;1;0.7" dur="1.6s" repeatCount="indefinite" />
        </rect>
      )}
      <rect x={20} y={20} width={PITCH_W - 40} height={PITCH_H - 40} fill="none" stroke={COLORS.line} strokeWidth={2.5} />
      <line x1={PITCH_W / 2} y1={20} x2={PITCH_W / 2} y2={PITCH_H - 20} stroke={COLORS.line} strokeWidth={2.5} />
      <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={92} fill="none" stroke={COLORS.line} strokeWidth={2.5} />
      <circle cx={PITCH_W / 2} cy={PITCH_H / 2} r={3} fill={COLORS.line} />
      <rect x={20} y={PITCH_H / 2 - 200} width={165} height={400} fill="none" stroke={COLORS.line} strokeWidth={2.5} />
      <rect x={PITCH_W - 185} y={PITCH_H / 2 - 200} width={165} height={400} fill="none" stroke={COLORS.line} strokeWidth={2.5} />
      <rect x={20} y={PITCH_H / 2 - 90} width={55} height={180} fill="none" stroke={COLORS.line} strokeWidth={2.5} />
      <rect x={PITCH_W - 75} y={PITCH_H / 2 - 90} width={55} height={180} fill="none" stroke={COLORS.line} strokeWidth={2.5} />
      <rect x={5} y={PITCH_H / 2 - 36} width={15} height={72} fill="rgba(255,255,255,0.18)" stroke={COLORS.line} strokeWidth={2} />
      <rect x={PITCH_W - 20} y={PITCH_H / 2 - 36} width={15} height={72} fill="rgba(255,255,255,0.18)" stroke={COLORS.line} strokeWidth={2} />
      <circle cx={130} cy={PITCH_H / 2} r={3} fill={COLORS.line} />
      <circle cx={PITCH_W - 130} cy={PITCH_H / 2} r={3} fill={COLORS.line} />
      <path d={`M 185 ${PITCH_H / 2 - 50} A 50 50 0 0 1 185 ${PITCH_H / 2 + 50}`} fill="none" stroke={COLORS.line} strokeWidth={2.5} />
      <path d={`M ${PITCH_W - 185} ${PITCH_H / 2 - 50} A 50 50 0 0 0 ${PITCH_W - 185} ${PITCH_H / 2 + 50}`} fill="none" stroke={COLORS.line} strokeWidth={2.5} />
      {[[20,20],[PITCH_W-20,20],[20,PITCH_H-20],[PITCH_W-20,PITCH_H-20]].map(([cx,cy], i) => (
        <path key={i}
          d={`M ${cx + (cx === 20 ? 10 : -10)} ${cy} A 10 10 0 0 ${cx === 20 ? (cy === 20 ? 1 : 0) : (cy === 20 ? 0 : 1)} ${cx} ${cy + (cy === 20 ? 10 : -10)}`}
          fill="none" stroke={COLORS.line} strokeWidth={2} />
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
            stroke={COLORS.home} strokeWidth={2} strokeDasharray="8 6" opacity={0.85} />
          <rect x={-36} y={26} width={72} height={18} rx={3}
            fill={COLORS.home} opacity={0.92} />
          <text x={0} y={39} textAnchor="middle" fontSize={10} fontWeight={800}
            fill="#fff" letterSpacing="1.5"
            style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
            HOME LINE
          </text>
        </g>
      )}
      {showDefLine && defLines.away != null && (
        <g style={{ transform: `translate(${defLines.away}px, 0px)`, transition: lineTrans }}>
          <line x1={0} y1={20} x2={0} y2={PITCH_H - 20}
            stroke={COLORS.away} strokeWidth={2} strokeDasharray="8 6" opacity={0.85} />
          <rect x={-36} y={26} width={72} height={18} rx={3}
            fill={COLORS.away} opacity={0.92} />
          <text x={0} y={39} textAnchor="middle" fontSize={10} fontWeight={800}
            fill="#fff" letterSpacing="1.5"
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
  player, x, y, selected, animating, showStats, showMovementArrows, fplMode,
  onPointerDown, onContextMenu, onDoubleClick,
}) {
  const isHome = player.team === 'home';
  const fill = isHome ? COLORS.home : COLORS.away;
  const ring = isHome ? COLORS.homeRing : COLORS.awayRing;
  const transition = animating ? `transform ${PHASE_DURATION}ms linear` : 'none';
  const fpl = player.fpl;
  const showHeadshot = fplMode && fpl;

  // tight name label width: char count × 6.2px + padding, min 36
  const nameText = fpl?.name || '';
  const nameWidth = Math.max(36, nameText.length * 6.4 + 12);

  return (
    <g
      style={{ transform: `translate(${x}px, ${y}px)`, transition }}
      onPointerDown={(e) => onPointerDown(e, player.id)}
      onContextMenu={(e) => onContextMenu(e, player.id)}
      onDoubleClick={(e) => onDoubleClick(e, player.id)}
      className="cursor-grab active:cursor-grabbing"
    >
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

      {/* When PL mode + FPL assigned, glow with team colour */}
      {showHeadshot && PL_TEAM_COLORS[fpl?.team] && (
        <Fragment>
          <circle r={PLAYER_R + 4} fill="none"
            stroke={PL_TEAM_COLORS[fpl.team]} strokeWidth={1.5}
            opacity={0.55} />
          <circle r={PLAYER_R + 7} fill="none"
            stroke={PL_TEAM_COLORS[fpl.team]} strokeWidth={1}
            opacity={0.18} />
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
          {/* FPL portraits are 110×140 (head + chest). We want JUST the head.
              The face occupies roughly the top 38% of the image, so we render
              the photo oversized and align top-center: only the face fits
              inside the circle clip. */}
          {(() => {
            const FACE_RATIO = 0.38;          // top ~38% of source = face
            const imgScale = (PLAYER_R * 2) / (140 * FACE_RATIO);
            const imgW = 110 * imgScale;
            const imgH = 140 * imgScale;
            return (
              <image
                href={fplPhotoUrl(fpl.code)}
                x={-imgW / 2}
                y={-PLAYER_R - 1}              /* nudge up so hair isn't cropped */
                width={imgW}
                height={imgH}
                clipPath={`url(#clip-${player.id})`}
                preserveAspectRatio="none"
              />
            );
          })()}
          <circle r={PLAYER_R - 0.5} fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth={1} />
        </Fragment>
      ) : (
        <Fragment>
          <circle r={PLAYER_R} fill={fill}
            style={{ filter: 'drop-shadow(0 3px 4px rgba(0,0,0,0.4))' }} />
          <text x={0} y={4} textAnchor="middle" fontSize={11} fontWeight={800}
            fill="#ffffff" pointerEvents="none"
            style={{ userSelect: 'none', fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.5px' }}>
            {player.label}
          </text>
        </Fragment>
      )}

      {fplMode && fpl && (
        <g pointerEvents="none">
          <rect x={-nameWidth/2} y={PLAYER_R + 4} width={nameWidth} height={14} rx={2}
            fill="rgba(0,0,0,0.85)"
            stroke="rgba(96,165,250,0.5)" strokeWidth={0.8} />
          <text x={0} y={PLAYER_R + 14} textAnchor="middle" fontSize={9} fontWeight={800}
            fill="#fff" style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.4px' }}>
            {nameText}
          </text>
        </g>
      )}

      {showStats && !fplMode && (
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
        href="/assets/icons/ball.webp"
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
            fill="#dc2626" opacity={0.95}>
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
  const { points, color } = arrow;
  if (!points || points.length < 2) return null;
  const stroke = ARROW_COLORS[color] || ARROW_COLORS.white;
  const d = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
  return (
    <path d={d} fill="none" stroke={stroke} strokeWidth={3.5}
      strokeLinecap="round" strokeLinejoin="round"
      markerEnd={`url(#arrow-${color})`} opacity={0.95} />
  );
}

/* =============================================================
   AD BOARD
   ============================================================= */
function AdBoard({ slot }) {
  const { ad, x, y, w, h, orientation } = slot;
  const dir = orientation === 'h' ? 'to right' : 'to bottom';
  return (
    <a href={ad.url} target="_blank" rel="noopener noreferrer" data-ad={ad.id}
       style={{ pointerEvents: 'auto' }}>
      <foreignObject x={x} y={y} width={w} height={h}>
        <div xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: '100%', height: '100%',
            background: `linear-gradient(${dir}, ${ad.g1} 0%, ${ad.g2} 100%)`,
            borderRadius: '4px',
            border: '1px solid rgba(255,255,255,0.14)',
            display: 'flex',
            flexDirection: orientation === 'h' ? 'row' : 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: orientation === 'h' ? '4px 12px' : '8px 4px',
            cursor: 'pointer',
            overflow: 'hidden',
            position: 'relative',
            boxShadow: '0 2px 6px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(255,255,255,0.06)',
            transition: 'transform 0.15s, filter 0.15s',
            color: '#fff',
            textAlign: 'center',
            gap: orientation === 'h' ? '8px' : '4px',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'scale(1.03)';
            e.currentTarget.style.filter = 'brightness(1.18)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'scale(1)';
            e.currentTarget.style.filter = 'none';
          }}
        >
          <div style={{
            position: 'absolute', inset: 0,
            background: 'repeating-linear-gradient(0deg, rgba(0,0,0,0.04) 0 1px, transparent 1px 3px)',
            pointerEvents: 'none',
          }}/>
          {ad.icon && (
            <img src={ad.icon} alt={ad.label}
              style={{
                width: orientation === 'h' ? '24px' : '20px',
                height: orientation === 'h' ? '24px' : '20px',
                objectFit: 'contain',
                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.5))',
                flexShrink: 0,
              }}/>
          )}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: orientation === 'h' ? 'flex-start' : 'center',
            lineHeight: 1,
            gap: orientation === 'h' ? '2px' : '0',
          }}>
            <div style={{
              fontFamily: '"Uni Sans Heavy", "Bebas Neue", sans-serif',
              fontWeight: 800,
              fontSize: orientation === 'h' ? '16px' : '13px',
              letterSpacing: orientation === 'h' ? '1.5px' : '1px',
              textShadow: '0 2px 4px rgba(0,0,0,0.45)',
              writingMode: orientation === 'v' ? 'vertical-rl' : 'horizontal-tb',
              transform: orientation === 'v' ? 'rotate(180deg)' : 'none',
            }}>
              {ad.label}
            </div>
            {orientation === 'h' && (
              <div style={{
                fontFamily: 'Oswald, sans-serif',
                fontSize: '9px',
                letterSpacing: '1.5px',
                opacity: 0.85,
                fontWeight: 600,
                textShadow: '0 1px 2px rgba(0,0,0,0.45)',
              }}>
                {ad.sub}
              </div>
            )}
          </div>
        </div>
      </foreignObject>
    </a>
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
                ? 'bg-blue-500 border-blue-300 text-white shadow-[0_0_14px_rgba(96,165,250,0.5)]'
                : 'bg-white/[0.04] border-white/10 hover:bg-blue-400/15 hover:border-blue-400/40 text-slate-200'
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
   FPL PICKER PANEL (inline in side panel)
   ============================================================= */
function FplPickerPanel({ targetPlayer, takenIds = new Set(), onPick, onClear }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [teamFilter, setTeamFilter] = useState('all');

  useEffect(() => {
    if (data || loading) return;
    setLoading(true);
    fetchFpl()
      .then((d) => setData(d))
      .catch((e) => setError(e.message || 'Failed to load.'))
      .finally(() => setLoading(false));
  }, [data, loading]);

  // Debounced GA event for player search
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const t = setTimeout(() => track.searchPlayer(q), 700);
    return () => clearTimeout(t);
  }, [query]);

  const fplCategoryId = targetPlayer ? POSITION_TO_FPL[targetPlayer.label] : null;

  const filtered = useMemo(() => {
    if (!data) return [];
    let list = data.elements;
    if (fplCategoryId) list = list.filter(p => p.element_type === fplCategoryId);
    if (teamFilter !== 'all') list = list.filter(p => p.team === +teamFilter);
    // Hide players already assigned to other tokens (across both teams).
    // The currently-selected token's own assignment is allowed (so it shows
    // up as the current pick, not as "missing").
    list = list.filter(p => {
      if (targetPlayer?.fpl?.id === p.id) return true;
      return !takenIds.has(p.id);
    });
    const q = query.trim().toLowerCase();
    if (q) list = list.filter(p => {
      const full = `${p.first_name} ${p.second_name}`.toLowerCase();
      return p.web_name.toLowerCase().includes(q) || full.includes(q);
    });
    list = [...list].sort((a, b) => (b.total_points || 0) - (a.total_points || 0));
    return list.slice(0, 50);
  }, [data, query, fplCategoryId, teamFilter, takenIds, targetPlayer?.fpl?.id]);

  if (!targetPlayer) return null;

  return (
    <section className="p-3 rounded-lg bg-blue-400/[0.04] border border-blue-400/25">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-extrabold tracking-[0.25em] text-blue-300"
          style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
          PL PLAYER PICKER
        </div>
        {targetPlayer.fpl && (
          <button onClick={onClear}
            className="text-[9px] font-extrabold tracking-wider px-2 py-0.5 bg-rose-500/20 border border-rose-500/30 text-rose-300 rounded"
            style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
            CLEAR
          </button>
        )}
      </div>

      <div className="text-[9px] text-slate-500 mb-2 font-mono tracking-wider">
        FILTERED · <span className="text-blue-300">{fplCategoryId ? FPL_CATEGORY_LABEL[fplCategoryId] : 'ALL'}</span>
      </div>

      {error && (
        <div className="p-2 bg-rose-500/15 border border-rose-500/30 rounded text-rose-200 text-[11px] mb-2">
          ⚠ {error}
        </div>
      )}
      {loading && (
        <div className="p-3 text-center text-slate-400 text-[11px]">Loading FPL squads…</div>
      )}
      {data && (
        <Fragment>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name…"
            className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400 mb-2" />
          <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded px-2 py-1.5 text-xs focus:outline-none focus:border-blue-400 mb-2">
            <option value="all">All clubs</option>
            {data.teams && data.teams.map(t => (
              <option key={t.id} value={t.id}>{t.short_name || t.name}</option>
            ))}
          </select>
          <div className="space-y-1 max-h-72 overflow-auto pr-0.5">
            {filtered.map(p => {
              const team = data.teams.find(t => t.id === p.team);
              const fullName = `${p.first_name} ${p.second_name}`.trim();
              return (
                <button key={p.id}
                  onClick={() => onPick({
                    id: p.id, code: p.code, name: p.web_name, fullName,
                    position: FPL_CATEGORY_LABEL[p.element_type],
                    team: team ? team.short_name : '',
                  })}
                  className="w-full text-left p-1.5 bg-white/[0.03] hover:bg-blue-400/10 border border-white/10 hover:border-blue-400/40 rounded transition group flex gap-2 items-center">
                  <img src={fplPhotoUrl(p.code)} alt={p.web_name}
                    className="w-9 h-11 object-cover rounded bg-slate-800"
                    style={{ objectPosition: 'top' }}
                    onError={(e) => { e.currentTarget.style.opacity = '0.2'; }}/>
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-extrabold truncate group-hover:text-blue-200"
                      style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.3px' }}>
                      {p.web_name}
                    </div>
                    <div className="text-[9px] text-slate-400 font-mono">
                      {team ? team.short_name : '?'} · {p.total_points} PTS
                    </div>
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="py-3 text-center text-slate-500 text-[11px]">No players match.</div>
            )}
          </div>
        </Fragment>
      )}
    </section>
  );
}

/* =============================================================
   MODAL: Display Options
   ============================================================= */
function DisplayOptionsModal({ open, onClose, opts, setOpts }) {
  if (!open) return null;
  const flag = (key) => opts[key];
  const toggle = (key) => setOpts(o => ({ ...o, [key]: !o[key] }));
  return (
    <ModalShell title="Display Options" subtitle="Pitch overlays & extras" onClose={onClose}>
      <div className="space-y-2">
        {[
          ['fplMode',          'Premier League Player Mode', 'Click any token to assign a real PL player. Photo + name appear on the token.'],
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
          <label key={key} className="flex items-start gap-3 p-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-lg cursor-pointer transition">
            <input type="checkbox" checked={!!flag(key)} onChange={() => toggle(key)}
              className="mt-1 w-4 h-4 accent-blue-400" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-extrabold text-white"
                style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.4px' }}>{label}</div>
              <div className="text-[11px] text-slate-400 leading-snug">{desc}</div>
            </div>
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
  const doLoad = (entry) => { onLoad(entry.data); onClose(); };
  const doDelete = (id) => { const next = list.filter(e => e.id !== id); saveTactics(next); setList(next); };
  const doExport = (entry) => {
    const blob = new Blob([JSON.stringify(entry, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `${entry.name.replace(/[^a-z0-9]+/gi,'_')}.tactic.json`;
    a.click(); URL.revokeObjectURL(url);
  };
  return (
    <ModalShell title="Tactic Management" subtitle="Save, load & manage your boards" onClose={onClose}>
      <div className="mb-4 p-3 bg-blue-400/10 border border-blue-400/30 rounded-lg">
        <div className="text-[10px] font-extrabold text-blue-300 tracking-widest mb-2"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
          SAVE CURRENT BOARD
        </div>
        <div className="flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            placeholder={current.name || 'Tactic name...'}
            className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-400" />
          <button onClick={doSave}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-400 text-white font-extrabold text-sm rounded transition"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.6px' }}>
            SAVE
          </button>
        </div>
      </div>
      <div className="text-[10px] font-extrabold text-slate-400 tracking-widest mb-2"
        style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
        SAVED ({list.length})
      </div>
      {list.length === 0 ? (
        <div className="text-center py-8 text-slate-500 text-sm">No saved tactics yet.</div>
      ) : (
        <div className="space-y-2 max-h-80 overflow-auto pr-1">
          {list.map(entry => (
            <div key={entry.id} className="p-3 bg-white/[0.03] hover:bg-white/[0.06] border border-white/10 rounded-lg flex items-center gap-3 transition">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold truncate" style={{ fontFamily: 'Oswald, sans-serif', letterSpacing: '0.3px' }}>
                  {entry.name}
                </div>
                <div className="text-[10px] text-slate-500 font-mono">{new Date(entry.saved_at).toLocaleString()}</div>
              </div>
              <button onClick={() => doLoad(entry)}
                className="px-3 py-1.5 text-xs font-extrabold bg-blue-400/20 hover:bg-blue-400/30 border border-blue-400/40 text-blue-200 rounded">
                LOAD
              </button>
              <button onClick={() => doExport(entry)}
                className="px-2 py-1.5 text-xs font-bold bg-white/5 hover:bg-white/10 border border-white/10 rounded" title="Download as JSON">↓</button>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className={`${wide ? 'max-w-3xl' : 'max-w-md'} w-full bg-[#0d141f] border border-white/12 rounded-xl shadow-2xl overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 30px 80px rgba(0,0,0,0.6), 0 0 60px rgba(96,165,250,0.10)' }}>
        <div className="px-5 py-3.5 border-b border-white/10 flex items-center justify-between bg-gradient-to-r from-blue-500/[0.08] to-transparent">
          <div>
            <div className="text-lg font-extrabold" style={{ fontFamily: '"Uni Sans Heavy", "Bebas Neue", sans-serif', letterSpacing: '2px' }}>{title}</div>
            {subtitle && <div className="text-[10px] text-slate-400 font-mono tracking-wide">{subtitle}</div>}
          </div>
          <button onClick={onClose}
            className="w-8 h-8 rounded-md bg-white/5 hover:bg-white/15 border border-white/10 text-slate-300 hover:text-white text-lg leading-none">×</button>
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
  const [editingTeam, setEditingTeam] = useState('both');
  // phases is a growable array — start with 4 empty slots, user can add more
  const [phases, setPhases] = useState([null, null, null, null]);
  const [currentPhase, setCurrentPhase] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null);
  const [tool, setTool] = useState('select');
  const [arrowColor, setArrowColor] = useState('white');
  // Top-level drawings — used when no phase is active. When a phase IS active,
  // drawings live inside that phase's `.drawings` object so they swap when
  // the user moves between phases.
  const [arrows, setArrows] = useState([]);
  const [zones, setZones] = useState([]);
  const [texts, setTexts] = useState([]);
  const [presses, setPresses] = useState([]);
  const [tacticName, setTacticName] = useState('Untitled tactic');
  const [animating, setAnimating] = useState(false);
  const [drawingArrow, setDrawingArrow] = useState(null);
  const [drawingZone, setDrawingZone] = useState(null);
  const [showSidePanel, setShowSidePanel] = useState(true);
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
    showAds: true,
    fplMode: false,
    showBall: true,
    vertical: false,        // up-and-down stadium orientation
    customStadium: false,   // 3D-only: use the user-supplied .dae model
  });

  const [showDisplayOpts, setShowDisplayOpts] = useState(false);
  const [showTacticMgmt, setShowTacticMgmt] = useState(false);

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
    phases: phases.map(p => p ? { ...p } : null),
    ballPos: { ...ballPos },
  }), [players, arrows, zones, texts, presses, phases, ballPos]);
  const pushHistory = useCallback(() => {
    historyRef.current.push(snapshot());
    if (historyRef.current.length > 50) historyRef.current.shift();
    futureRef.current = [];
  }, [snapshot]);
  const restore = (snap) => {
    setPlayers(snap.players); setArrows(snap.arrows); setZones(snap.zones);
    setTexts(snap.texts); setPresses(snap.presses); setPhases(snap.phases);
    if (snap.ballPos) setBallPos(snap.ballPos);
  };
  const undo = () => {
    if (!historyRef.current.length) return;
    futureRef.current.push(snapshot());
    restore(historyRef.current.pop());
  };
  const redo = () => {
    if (!futureRef.current.length) return;
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
      };
    }
    return { arrows, zones, texts, presses };
  }, [currentPhase, phases, arrows, zones, texts, presses]);

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
        const d = ph?.drawings || { arrows: [], zones: [], texts: [], presses: [] };
        return { ...(ph || {}), drawings: { ...d, [kind]: apply(d[kind]) } };
      }));
    } else {
      if (kind === 'arrows')  setArrows(apply);
      if (kind === 'zones')   setZones(apply);
      if (kind === 'texts')   setTexts(apply);
      if (kind === 'presses') setPresses(apply);
    }
  };

  const defLines = useMemo(() => {
    const positions = displayedPositions;
    const homeDefs = players.filter(p => p.team === 'home' && p.label !== 'GK');
    const awayDefs = players.filter(p => p.team === 'away' && p.label !== 'GK');
    if (!homeDefs.length || !awayDefs.length) return { home: null, away: null };
    const homeDeepest = homeDefs.reduce((min, p) =>
      (positions[p.id]?.x ?? p.pos[possessionMode].x) < min ? (positions[p.id]?.x ?? p.pos[possessionMode].x) : min, 999);
    const awayDeepest = awayDefs.reduce((max, p) =>
      (positions[p.id]?.x ?? p.pos[possessionMode].x) > max ? (positions[p.id]?.x ?? p.pos[possessionMode].x) : max, 0);
    return { home: homeDeepest, away: awayDeepest };
  }, [players, displayedPositions, possessionMode]);

  const formationLabel = useMemo(() => {
    if (currentPhase >= 0) return `PHASE ${currentPhase + 1}`;
    const team = editingTeam === 'away' ? 'away' : 'home';
    const f = detectFormation(players, possessionMode, team);
    return f ? `${team === 'home' ? 'HOME' : 'AWAY'} · ${f}` : '';
  }, [players, possessionMode, editingTeam, currentPhase]);

  // Set of FPL ids already assigned somewhere on the pitch — used to dedupe
  // the picker so the same player can't be placed twice.
  const takenFplIds = useMemo(() => {
    const s = new Set();
    for (const p of players) if (p.fpl?.id) s.add(p.fpl.id);
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
  const startPlayerDrag = (id, pt) => {
    if (playing) return;
    if (tool !== 'select') return;
    const cur = displayedPositions[id];
    if (!cur) return;
    dragRef.current = { type: 'player', id, offset: { x: pt.x - cur.x, y: pt.y - cur.y }, moved: false };
    setSelectedPlayer(id);
    pushHistory();
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
    } else if (tool === 'text') {
      const text = window.prompt('Note text:');
      if (text && text.trim()) {
        pushHistory();
        updateDrawings('texts', prev => [...prev, { id: uid('t'), x: pt.x, y: pt.y, text: text.trim().toUpperCase() }]);
      }
    } else if (tool === 'press') {
      pushHistory();
      updateDrawings('presses', prev => [...prev, { id: uid('p'), x: pt.x, y: pt.y }]);
    } else if (tool === 'select') {
      setSelectedPlayer(null);
    }
  };
  const continueDragOrDraw = (pt) => {
    if (!dragRef.current) return;
    const d = dragRef.current;
    if (d.type === 'player') {
      d.moved = true;
      const nx = clamp(pt.x - d.offset.x, PLAYER_R + 4, PITCH_W - PLAYER_R - 4);
      const ny = clamp(pt.y - d.offset.y, PLAYER_R + 4, PITCH_H - PLAYER_R - 4);
      if (currentPhase >= 0) {
        setPhases(prev => prev.map((ph, i) =>
          i === currentPhase ? { ...(ph || {}), [d.id]: { x: nx, y: ny } } : ph));
      } else {
        setPlayers(prev => prev.map(p => p.id === d.id
          ? { ...p, pos: { ...p.pos, [possessionMode]: { x: nx, y: ny } } } : p));
      }
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
    }
  };

  /* ── 2D event-driven wrappers ───────────────────────────────── */
  const beginDragPlayer = (e, id) => {
    if (playing) return;
    if (tool !== 'select') return;
    e.stopPropagation(); e.preventDefault();
    const svg = svgRef.current;
    startPlayerDrag(id, getPitchPoint(e));
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
    continueDragOrDraw(getPitchPoint(e));
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
          updateDrawings('arrows', prev => [...prev, { id: uid('a'), points: drawingArrow.points, color: arrowColor }]);
        }
      }
      setDrawingArrow(null);
    } else if (d.type === 'zone' && drawingZone) {
      if (drawingZone.w > 18 && drawingZone.h > 18) {
        pushHistory();
        const fillMap = {
          white:  'rgba(255,255,255,0.14)',
          yellow: 'rgba(253,224,71,0.18)',
          orange: 'rgba(251,146,60,0.18)',
          blue:   'rgba(96,165,250,0.20)',
        };
        updateDrawings('zones', prev => [...prev, {
          id: uid('z'), x: drawingZone.x, y: drawingZone.y,
          w: drawingZone.w, h: drawingZone.h, color: fillMap[arrowColor] || fillMap.white,
        }]);
      }
      setDrawingZone(null);
    }
    dragRef.current = null;
  };
  // 2D wrapper for SVG onPointerUp/onPointerLeave
  const onPointerUp = () => endDragOrDraw();

  /* ── Player handlers ─────────────────────────────────────── */
  const handleContextMenu = (e, id) => {
    e.preventDefault(); e.stopPropagation();
    if (opts.fplMode) {
      pushHistory();
      setPlayers(prev => prev.map(p => p.id === id ? { ...p, fpl: null } : p));
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
    const collKey = { arrow: 'arrows', zone: 'zones', text: 'texts', press: 'presses' }[kind];
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
    clearFplFor: (id) => {
      pushHistory();
      setPlayers(prev => prev.map(p => p.id === id ? { ...p, fpl: null } : p));
    },
    tryErase,
  };

  /* ── Formation / mirror / clear ──────────────────────────── */
  const loadPreset = (key) => {
    pushHistory(); triggerAnimation();
    setPlayers(buildFormation(key));
    setActivePreset(key); setCurrentPhase(-1);
    setPhases([null, null, null, null]);  // baseline — user can grow beyond 4
  };
  const mirrorTactic = () => {
    pushHistory(); triggerAnimation();
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
  const clearOverlays = () => {
    pushHistory();
    if (currentPhase >= 0) {
      // Clear the current phase's drawings only
      updateDrawings('arrows', []);
      updateDrawings('zones', []);
      updateDrawings('texts', []);
      updateDrawings('presses', []);
    } else {
      setArrows([]); setZones([]); setTexts([]); setPresses([]);
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
    setPhases(prev => prev.map((ph, i) => i === idx ? null : ph));
    if (currentPhase === idx) setCurrentPhase(-1);
  };
  const goToPhase = (idx) => {
    if (phases[idx]) { triggerAnimation(); setCurrentPhase(idx); } else { savePhase(idx); }
  };
  // Add a new empty phase slot at the end (button shows "+" when last slot is filled).
  const addPhaseSlot = () => {
    pushHistory();
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
    setCurrentPhase(-1);
    setTrails([]);
  };

  /* ── Export ──────────────────────────────────────────────── */
  const exportPNG = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const xml = new XMLSerializer().serializeToString(clone);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = 2;
      canvas.width = VB_W * scale;
      canvas.height = (VB_H + 80) * scale;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#060912';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 80 * scale, VB_W * scale, VB_H * scale);
      ctx.fillStyle = '#e7ebf2';
      ctx.font = `${28 * scale}px "Bebas Neue", Inter, sans-serif`;
      ctx.fillText(tacticName.toUpperCase(), 24 * scale, 50 * scale);
      ctx.fillStyle = '#60a5fa';
      ctx.font = `${14 * scale}px Oswald, Inter, sans-serif`;
      ctx.fillText(formationLabel || possessionMode.toUpperCase(), 24 * scale, 72 * scale);
      const a = document.createElement('a');
      a.download = `${tacticName.replace(/[^a-z0-9]+/gi, '_')}.png`;
      a.href = canvas.toDataURL('image/png');
      a.click();
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  /* ── Tactic save/load ────────────────────────────────────── */
  const collectTacticData = () => ({
    name: tacticName, players, phases, arrows, zones, texts, presses, ballPos,
    activePreset, possessionMode, editingTeam,
    saved_with_version: 'v3',
  });
  const restoreTacticData = (d) => {
    if (!d || !Array.isArray(d.players)) return;
    pushHistory(); triggerAnimation();
    setTacticName(d.name || 'Loaded tactic');
    setPlayers(d.players);
    setPhases(d.phases || [null, null, null, null]);
    setArrows(d.arrows || []); setZones(d.zones || []);
    setTexts(d.texts || []); setPresses(d.presses || []);
    if (d.ballPos) setBallPos(d.ballPos);
    setCurrentPhase(-1);
    setActivePreset(d.activePreset || '4-3-3');
    if (d.possessionMode) setPossessionMode(d.possessionMode);
    if (d.editingTeam) setEditingTeam(d.editingTeam);
  };

  /* ── FPL & Position ──────────────────────────────────────── */
  const handleFplPick = (fplData) => {
    if (!selectedPlayer) return;
    pushHistory();
    setPlayers(prev => prev.map(p => p.id === selectedPlayer ? { ...p, fpl: fplData } : p));
  };
  const handleFplClear = () => {
    if (!selectedPlayer) return;
    pushHistory();
    setPlayers(prev => prev.map(p => p.id === selectedPlayer ? { ...p, fpl: null } : p));
  };
  const handlePositionPick = (pos) => {
    if (!selectedPlayer) return;
    pushHistory();
    setPlayers(prev => prev.map(p => {
      if (p.id !== selectedPlayer) return p;
      // If FPL category changes, clear the FPL assignment (mismatch protection)
      const oldCat = POSITION_TO_FPL[p.label];
      const newCat = POSITION_TO_FPL[pos];
      const fpl = (oldCat !== newCat) ? null : p.fpl;
      return { ...p, label: pos, fpl };
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

  const adSlots = useMemo(() => buildAdSlots(DEFAULT_ADS), []);

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
            ? 'select-none touch-none rounded-xl border border-white/10 pitch-clip'
            : 'w-full h-auto select-none touch-none rounded-xl border border-white/10 pitch-clip'
        }
        style={{
          background: 'radial-gradient(800px 400px at 50% 0%, rgba(96,165,250,0.10), transparent 70%), #060912',
          boxShadow: '0 30px 80px rgba(0,0,0,0.55), 0 0 60px rgba(96,165,250,0.08)',
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
            <stop offset="100%" stopColor="#dc2626" stopOpacity="0.4" />
          </radialGradient>
          <radialGradient id="pitchVignette">
            <stop offset="60%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,0.35)" />
          </radialGradient>
          <radialGradient id="playGlow" cx="50%" cy="50%" r="60%">
            <stop offset="0%" stopColor="rgba(96,165,250,0)" />
            <stop offset="80%" stopColor="rgba(96,165,250,0.05)" />
            <stop offset="100%" stopColor="rgba(96,165,250,0.18)" />
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
        </defs>

        {/* All visible content lives inside this `<g>`. When `opts.vertical`
            is true we rotate 90° clockwise around the center of the original
            viewBox; the swapped viewBox above keeps the result in frame. */}
        <g transform={opts.vertical ? `rotate(90 ${cx} ${cy})` : undefined}>
        <rect x={VB_X} y={VB_Y} width={VB_W} height={VB_H} fill="#060912" />
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
          fill="none" stroke="rgba(96,165,250,0.22)" strokeWidth={2} rx={4} />

        <PitchLines showChannels={opts.showChannels} showDefLine={opts.showDefLine} defLines={defLines} playing={playing} animating={animating} />

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
              fill="rgba(0,0,0,0.85)" stroke="rgba(96,165,250,0.5)" strokeWidth={1} />
            <rect x={PITCH_W / 2 - 110} y={32} width={6} height={32} fill="#dc2626" />
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

        {live.zones.map(z => (
          <rect key={z.id} x={z.x} y={z.y} width={z.w} height={z.h}
            fill={z.color}
            stroke={z.color.replace(/[\d.]+\)$/, '0.6)')}
            strokeWidth={1.5} strokeDasharray="4 4"
            onClick={() => tryErase('zone', z.id)} />
        ))}
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
              fill="rgba(0,0,0,0.82)" stroke="rgba(96,165,250,0.42)" strokeWidth={1} />
            <text x={4} y={2} fontSize={11} fontWeight={800} fill="#60a5fa"
              style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1.2px' }}>
              {t.text}
            </text>
          </g>
        ))}

        {mode === possessionMode && renderDrawingArrow}
        {mode === possessionMode && renderDrawingZone}

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
                selected={selectedPlayer === p.id}
                animating={animating}
                showStats={opts.showStats}
                showMovementArrows={opts.showMovementArrows}
                fplMode={opts.fplMode}
                onPointerDown={beginDragPlayer}
                onContextMenu={handleContextMenu}
                onDoubleClick={handleDoubleClick}
              />
            </g>
        ))}

        <g pointerEvents="none">
          <rect x={20} y={PITCH_H - 50} width={240} height={32} rx={4}
            fill="rgba(0,0,0,0.78)" stroke="rgba(96,165,250,0.42)" strokeWidth={1} />
          <text x={32} y={PITCH_H - 28} fontSize={14} fontWeight={800} fill="#60a5fa"
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
  const updateSelected = (patch) => {
    pushHistory();
    setPlayers(prev => prev.map(p => p.id === selectedPlayer ? { ...p, ...patch } : p));
  };

  const phaseSavedCount = phases.filter(Boolean).length;

  return (
    <div className="min-h-screen w-full text-slate-100 flex flex-col"
      style={{
        fontFamily: '"Space Grotesk", Inter, system-ui, sans-serif',
        background: `
          radial-gradient(900px 600px at 15% 0%, rgba(96,165,250,0.07), transparent 60%),
          radial-gradient(800px 600px at 85% 100%, rgba(220,38,38,0.05), transparent 60%),
          repeating-linear-gradient(135deg, rgba(255,255,255,0.012) 0 1px, transparent 1px 12px),
          #060912`,
      }}>

      {/* TOP BAR */}
      <header className="flex items-center gap-2.5 px-4 py-2.5 border-b border-white/10 bg-[#080d18]/95 backdrop-blur flex-wrap relative">
        <div className="absolute left-0 top-0 bottom-0 w-1"
          style={{background: 'linear-gradient(180deg, #60a5fa 0%, #3b82f6 50%, #1d4ed8 100%)'}} />

        <a href="../index.html" className="flex flex-col group select-none mr-2 ml-1.5">
          <span className="text-[10px] font-extrabold tracking-[0.3em] text-blue-400 -mb-1"
            style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>NAHWEEEZY'S</span>
          <span className="text-[1.18rem] font-black tracking-[0.18em] leading-none text-white group-hover:text-blue-300 transition"
            style={{fontFamily:'"Uni Sans Heavy", "Bebas Neue", sans-serif'}}>
            TACTICS BOARD
          </span>
        </a>

        <div className="h-7 w-px bg-white/10" />

        <input
          value={tacticName} onChange={(e) => setTacticName(e.target.value)}
          className="bg-black/30 border border-white/10 rounded px-2.5 py-1.5 text-sm font-bold text-white placeholder-slate-500 focus:outline-none focus:border-blue-400 w-56"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '0.5px' }}
          placeholder="Tactic name…"
        />

        <div className="flex items-center bg-black/30 rounded p-0.5 border border-white/10">
          <button
            onClick={() => togglePossessionMode('inPossession')}
            className={`px-2.5 py-1.5 text-[11px] font-extrabold rounded transition tracking-wider ${
              possessionMode === 'inPossession' ? 'bg-blue-500 text-white shadow-[0_0_14px_rgba(96,165,250,0.4)]' : 'text-slate-300 hover:text-white'
            }`} style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>IN POSS.</button>
          <button
            onClick={() => togglePossessionMode('outOfPossession')}
            className={`px-2.5 py-1.5 text-[11px] font-extrabold rounded transition tracking-wider ${
              possessionMode === 'outOfPossession' ? 'bg-rose-500 text-white' : 'text-slate-300 hover:text-white'
            }`} style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>OUT OF POSS.</button>
        </div>

        <div className="flex items-center bg-black/30 rounded p-0.5 border border-white/10">
          {[
            ['home', 'H', COLORS.home],
            ['both', 'BOTH', '#e2e8f0'],
            ['away', 'A', COLORS.away],
          ].map(([key, label, bg]) => (
            <button key={key} onClick={() => setEditingTeam(key)}
              className="px-2 py-1.5 text-[11px] font-black rounded transition"
              style={{
                fontFamily:'"Uni Sans Heavy", Oswald, sans-serif', letterSpacing:'1px',
                background: editingTeam === key ? bg : 'transparent',
                color: editingTeam === key ? (key === 'both' ? '#0f172a' : '#fff') : '#cbd5e1',
              }}>
              {label}
            </button>
          ))}
        </div>

        <select value={activePreset} onChange={(e) => loadPreset(e.target.value)}
          className="bg-black/30 border border-white/10 rounded px-2 py-1.5 text-[11px] font-extrabold focus:outline-none focus:border-blue-400 cursor-pointer"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
          {FORMATION_KEYS.map(k => <option key={k} value={k} className="bg-[#080d18]">{k}</option>)}
        </select>

        {/* 2D / 3D toggle — large unique tab */}
        <div className="flex items-center bg-black/40 rounded p-0.5 border border-blue-400/40 shadow-[0_0_14px_rgba(96,165,250,0.25)]">
          <button
            onClick={() => setViewMode('2d')}
            className={`px-3 py-1.5 text-[11px] font-black tracking-wider rounded transition ${
              viewMode === '2d' ? 'bg-blue-500 text-white shadow-[0_0_10px_rgba(96,165,250,0.5)]' : 'text-slate-300 hover:text-white'
            }`}
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            ▱ 2D
          </button>
          <button
            onClick={() => setViewMode('3d')}
            className={`px-3 py-1.5 text-[11px] font-black tracking-wider rounded transition ${
              viewMode === '3d' ? 'bg-blue-500 text-white shadow-[0_0_10px_rgba(96,165,250,0.5)]' : 'text-slate-300 hover:text-white'
            }`}
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            ⛁ 3D
          </button>
        </div>

        <button onClick={mirrorTactic}
          className="px-2.5 py-1.5 text-[11px] font-extrabold bg-white/5 hover:bg-white/10 border border-white/10 rounded transition"
          style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
          ⇄ MIRROR
        </button>
        <button onClick={() => setCompareMode(c => !c)}
          className={`px-2.5 py-1.5 text-[11px] font-extrabold border rounded transition ${
            compareMode ? 'bg-blue-400/20 border-blue-400/40 text-blue-300' : 'bg-white/5 hover:bg-white/10 border-white/10'
          }`} style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
          ⊟ COMPARE
        </button>

        <div className="ml-auto flex items-center gap-1.5">
          <button onClick={() => setShowDisplayOpts(true)}
            className="px-2.5 py-1.5 text-[11px] font-extrabold bg-white/5 hover:bg-white/10 border border-white/10 rounded transition"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
            👁 VISUAL DISPLAY SETTINGS
          </button>
          <button onClick={() => setShowTacticMgmt(true)}
            className="px-2.5 py-1.5 text-[11px] font-extrabold bg-white/5 hover:bg-white/10 border border-white/10 rounded transition"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
            ☰ TACTICS
          </button>
          <button onClick={undo}
            className="px-2 py-1.5 text-[11px] font-bold bg-white/5 hover:bg-white/10 border border-white/10 rounded">↶</button>
          <button onClick={redo}
            className="px-2 py-1.5 text-[11px] font-bold bg-white/5 hover:bg-white/10 border border-white/10 rounded">↷</button>
          <button onClick={exportPNG}
            className="px-3 py-1.5 text-[11px] font-black bg-blue-500 hover:bg-blue-400 text-white rounded transition shadow-[0_0_12px_rgba(96,165,250,0.4)]"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif', letterSpacing: '1px' }}>
            ⇩ EXPORT
          </button>

          {profile && (
            <div className="flex items-center gap-1.5 ml-1 pl-2 border-l border-white/10">
              <div className="flex flex-col text-right leading-tight pr-1">
                <span className="text-[8px] font-extrabold tracking-[0.3em] text-slate-500"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>SIGNED IN</span>
                <span className="text-[12px] font-extrabold text-blue-300 tracking-wide truncate max-w-[120px]"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                  @{profile.username}
                </span>
              </div>
              <button onClick={signOut}
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
        <aside className="flex flex-col gap-1 p-2 border-r border-white/10 bg-[#080d18] w-14">
          {[
            ['select', '✥', 'Select & drag'],
            ['arrow', '➤', 'Arrow tool (freehand)'],
            ['zone', '▱', 'Zone shading'],
            ['text', 'T', 'Text label'],
            ['press', '!', 'Press trigger'],
            ['eraser', '⌫', 'Eraser'],
          ].map(([t, icon, title]) => (
            <button key={t} onClick={() => setTool(t)} title={title}
              className={`w-10 h-10 rounded flex items-center justify-center text-base font-extrabold transition border ${
                tool === t
                  ? 'bg-blue-400/20 border-blue-400/55 text-blue-200 shadow-[0_0_12px_rgba(96,165,250,0.4)]'
                  : 'bg-white/5 border-white/10 hover:bg-white/10 text-slate-300'
              }`}>
              {icon}
            </button>
          ))}
          <div className="h-px bg-white/10 my-1" />
          {['white','yellow','orange','blue'].map(c => (
            <button key={c} onClick={() => setArrowColor(c)}
              className={`w-10 h-7 rounded border-2 transition ${
                arrowColor === c ? 'border-blue-400 shadow-[0_0_10px_rgba(96,165,250,0.5)]' : 'border-white/10 hover:border-white/30'
              }`}
              style={{ background: ARROW_COLORS[c] }} title={`Color: ${c}`} />
          ))}
          <div className="h-px bg-white/10 my-1" />
          <button onClick={clearOverlays}
            className="w-10 h-10 rounded bg-rose-500/10 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[10px] font-extrabold tracking-wider"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            CLR
          </button>
        </aside>

        {/* PITCH */}
        <main className="flex-1 min-w-0 p-4 overflow-auto">
          <div className="max-w-[1500px] mx-auto">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-slate-500 font-extrabold tracking-[0.25em]"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>SHAPE</span>
                <span className={`font-black tracking-[0.15em] text-[15px] ${possessionMode === 'inPossession' ? 'text-blue-400' : 'text-rose-400'}`}
                  style={{fontFamily:'"Uni Sans Heavy", "Bebas Neue", sans-serif'}}>
                  {formationLabel || '—'}
                </span>
                {currentPhase >= 0 && (
                  <span className="px-2 py-0.5 text-[10px] font-black bg-blue-400/20 text-blue-300 border border-blue-400/40 rounded tracking-widest"
                    style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                    PHASE {currentPhase + 1}
                  </span>
                )}
                {opts.fplMode && (
                  <span className="px-2 py-0.5 text-[10px] font-black bg-blue-500/30 text-white border border-blue-400/40 rounded tracking-widest"
                    style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                    PL MODE
                  </span>
                )}
                {playing && (
                  <span className="flex items-center gap-1.5 px-2 py-0.5 text-[10px] font-black bg-rose-500/30 text-white border border-rose-400/50 rounded tracking-widest"
                    style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                    LIVE
                  </span>
                )}
              </div>
              <div className="text-[10px] text-slate-500 font-mono tracking-widest">
                Drag · Click → side panel · Esc · Ctrl+Z
              </div>
            </div>

            {viewMode === '3d' ? (
              <ErrorBoundary>
                <Suspense fallback={
                  <div className="rounded-xl border border-white/10 bg-[#080d18] flex items-center justify-center"
                       style={{ height: 'calc(100vh - 160px)' }}>
                    <div className="text-center">
                      <div className="w-10 h-10 mx-auto mb-3 border-3 border-white/10 border-t-blue-400 rounded-full animate-spin" />
                      <div className="text-[10px] tracking-[0.4em] text-blue-300 font-display">LOADING 3D ENGINE</div>
                    </div>
                  </div>
                }>
                  <Pitch3D
                    tactics={tacticsApi}
                    players={players}
                    displayedPositions={displayedPositions}
                    ballPos={displayedBall}
                    selectedPlayer={selectedPlayer}
                    fplMode={opts.fplMode}
                    tool={tool}
                    arrowColor={arrowColor}
                    drawings={live}
                    drawingArrow={drawingArrow}
                    drawingZone={drawingZone}
                    customStadium={opts.customStadium}
                    animating={animating}
                  />
                </Suspense>
              </ErrorBoundary>
            ) : compareMode ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <div className="text-[10px] font-black tracking-[0.3em] text-blue-400 mb-1.5 px-1"
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
            <div className="mt-4 p-3 rounded-xl bg-[#080d18] border border-white/10 flex items-center gap-3 flex-wrap"
              style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.03), 0 6px 24px rgba(0,0,0,0.4)' }}>
              <div className="flex items-center gap-1">
                <button onClick={() => stepPhase(-1)} disabled={!phaseSavedCount}
                  className="px-3 py-2 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-sm disabled:opacity-30">⏮</button>
                <button
                  onClick={playing ? handlePause : handlePlay}
                  disabled={phaseSavedCount < 2}
                  className={`px-4 py-2 rounded text-[12px] font-black tracking-widest transition ${
                    playing ? 'bg-rose-500 text-white' : 'bg-blue-500 text-white hover:bg-blue-400 shadow-[0_0_14px_rgba(96,165,250,0.4)]'
                  } disabled:opacity-30`}
                  style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                  {playing ? '⏸ PAUSE' : '▶ PLAY'}
                </button>
                <button onClick={() => stepPhase(1)} disabled={!phaseSavedCount}
                  className="px-3 py-2 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-sm disabled:opacity-30">⏭</button>
              </div>

              <div className="h-8 w-px bg-white/10" />

              <div className="flex items-center gap-1.5 flex-wrap max-w-[640px]">
                <span className="text-[10px] text-slate-500 font-extrabold tracking-[0.2em] mr-1"
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
                          active ? 'bg-blue-400 text-blue-950 border-blue-300 shadow-[0_0_14px_rgba(96,165,250,0.5)]'
                                 : saved ? 'bg-blue-400/15 border-blue-400/40 text-blue-300 hover:bg-blue-400/25'
                                         : 'bg-white/5 border-white/10 text-slate-500 hover:bg-white/10 hover:text-slate-300'
                        }`}
                        style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                        {i+1}
                      </button>
                      {/* Title (truncated) — click to rename */}
                      {saved && (
                        <button
                          onClick={() => renamePhase(i)}
                          title="Rename phase"
                          className="text-[8.5px] mt-0.5 max-w-[70px] truncate text-slate-400 hover:text-blue-300 cursor-pointer leading-none"
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
                    className="w-9 h-9 rounded text-sm font-black border border-dashed border-blue-400/40 text-blue-300 hover:bg-blue-400/15 transition"
                    style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                    +
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => savePhase(currentPhase >= 0 ? currentPhase : (phases.findIndex(p => !p) === -1 ? 0 : phases.findIndex(p => !p)))}
                  className="px-2.5 py-1.5 text-[10px] font-black bg-blue-400/20 hover:bg-blue-400/30 border border-blue-400/40 text-blue-200 rounded tracking-widest"
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
                    className="px-2.5 py-1.5 text-[10px] font-black bg-white/5 hover:bg-white/10 border border-white/10 rounded tracking-widest"
                    style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
                    ← EDIT
                  </button>
                )}
              </div>
            </div>
          </div>
        </main>

        {/* SIDE PANEL */}
        <aside className={`border-l border-white/10 bg-[#080d18] transition-all overflow-auto ${showSidePanel ? 'w-[340px]' : 'w-12'}`}>
          <button onClick={() => setShowSidePanel(s => !s)}
            className="w-full px-3 py-2.5 text-[10px] font-black tracking-[0.3em] text-slate-400 hover:text-white hover:bg-white/5 border-b border-white/10 flex items-center gap-2"
            style={{ fontFamily: '"Uni Sans Heavy", Oswald, sans-serif' }}>
            {showSidePanel ? '◀' : '▶'} {showSidePanel && 'PLAYER PANEL'}
          </button>

          {showSidePanel && (
            <div className="p-3 space-y-4">
              {sel ? (
                <Fragment>
                  <section className="p-3 rounded-lg bg-white/[0.03] border border-white/10 corner-tape">
                    <div className="flex items-center gap-2 mb-3">
                      <span className="w-9 h-9 rounded-full flex items-center justify-center text-[12px] font-black flex-shrink-0"
                        style={{
                          background: sel.team === 'home' ? COLORS.home : COLORS.away,
                          color: '#fff',
                          fontFamily: '"Uni Sans Heavy", Oswald, sans-serif',
                          boxShadow: '0 0 14px rgba(96,165,250,0.25)',
                        }}>
                        {sel.label}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="text-[10px] text-slate-500 font-extrabold tracking-[0.2em]"
                          style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                          {sel.team === 'home' ? 'HOME' : 'AWAY'} · #{sel.number}
                        </div>
                        <div className="text-sm font-extrabold text-white tracking-wide truncate"
                          style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                          {sel.fpl ? sel.fpl.fullName : `Player ${sel.label}`}
                        </div>
                      </div>
                      <button onClick={() => setSelectedPlayer(null)}
                        className="w-6 h-6 rounded bg-white/5 hover:bg-white/15 text-slate-400 hover:text-white text-sm leading-none">×</button>
                    </div>

                    <div className="text-[10px] font-extrabold text-blue-300 tracking-[0.25em] mb-1.5"
                      style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>POSITION</div>
                    <PositionGrid current={sel.label} onPick={handlePositionPick} />

                    <div className="mt-3 pt-3 border-t border-white/10 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] text-slate-400 font-mono tracking-widest mb-1">SPEED <span className="text-blue-300">{sel.speed}</span></div>
                        <input type="range" min={1} max={10} value={sel.speed}
                          onChange={(e) => updateSelected({ speed: +e.target.value })}
                          className="w-full accent-blue-400" />
                      </div>
                      <div>
                        <div className="text-[10px] text-slate-400 font-mono tracking-widest mb-1">PRESS <span className="text-rose-300">{sel.press}</span></div>
                        <input type="range" min={1} max={10} value={sel.press}
                          onChange={(e) => updateSelected({ press: +e.target.value })}
                          className="w-full accent-rose-500" />
                      </div>
                    </div>
                  </section>

                  {opts.fplMode ? (
                    <FplPickerPanel
                      targetPlayer={sel}
                      takenIds={takenFplIds}
                      onPick={handleFplPick}
                      onClear={handleFplClear}
                    />
                  ) : (
                    <button
                      onClick={() => setOpts(o => ({ ...o, fplMode: true }))}
                      className="w-full py-2.5 bg-blue-400/10 hover:bg-blue-400/20 border border-blue-400/30 text-blue-200 rounded text-[11px] font-extrabold tracking-wider"
                      style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>
                      ENABLE PL MODE → ASSIGN REAL PLAYER
                    </button>
                  )}
                </Fragment>
              ) : (
                <section className="p-3 rounded-lg bg-white/[0.02] border border-dashed border-white/10 text-center">
                  <div className="text-[24px] mb-1">⚽</div>
                  <div className="text-[11px] text-slate-400 leading-snug">
                    Click a player on the pitch to edit their position, stats and assign a real Premier League player.
                  </div>
                </section>
              )}

              {/* CONCEPT PLAYBOOK — blurred */}
              <section className="relative">
                <div className="text-[10px] font-extrabold tracking-[0.3em] text-blue-400 mb-2"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>CONCEPT PLAYBOOK</div>
                <div className="relative rounded-lg overflow-hidden border border-white/10">
                  <div className="space-y-2 p-3" style={{ filter: 'blur(5px)', userSelect: 'none', pointerEvents: 'none' }}>
                    {[
                      ["Pep's 3-2-5 Build-Up", "GK + back-three. RB inverts into double pivot."],
                      ["Klopp's Gegenpress", "Heavy-metal pressing, 5-second swarm."],
                      ["High Press 4-3-3", "Striker triggers on back-pass, fullbacks jump."],
                      ["Half-Space Overload", "Right-side combination, 10 finds the seam."],
                    ].map((c, i) => (
                      <div key={i} className="p-3 rounded bg-white/[0.03] border border-white/10">
                        <div className="text-sm font-black text-white"
                          style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>{c[0]}</div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{c[1]}</div>
                      </div>
                    ))}
                  </div>
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
                    <div className="text-center">
                      <div className="text-[8px] font-extrabold text-blue-300 tracking-[0.4em] mb-1"
                        style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>WORK IN PROGRESS</div>
                      <div className="text-2xl font-black shimmer-text"
                        style={{fontFamily:'"Uni Sans Heavy", "Bebas Neue", sans-serif', letterSpacing: '0.1em'}}>
                        COMING SOON
                      </div>
                      <div className="text-[10px] text-slate-400 mt-2 max-w-[220px] mx-auto leading-tight">
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

              <section className="text-[10px] text-slate-500 leading-relaxed border-t border-white/10 pt-3 font-mono">
                <div className="font-extrabold text-slate-300 mb-1 tracking-[0.2em]"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>GENERAL HOTKEYS</div>
                <div>• Drag → reposition · Click → edit panel</div>
                <div>• Right-click player → clear FPL assignment</div>
                <div>• Arrow tool → freehand path</div>
                <div>• Right-click phase → rename</div>
                <div>• Ctrl+Z undo · Esc deselect · Space play/pause</div>
                <div className="font-extrabold text-slate-300 mb-1 mt-3 tracking-[0.2em]"
                  style={{fontFamily:'"Uni Sans Heavy", Oswald, sans-serif'}}>3D MODE</div>
                <div>• <span className="text-blue-300">LMB</span> → drag players · draw · click drawings to erase</div>
                <div>• <span className="text-blue-300">Ctrl + LMB</span> drag → orbit camera</div>
                <div>• <span className="text-blue-300">RMB</span> drag → orbit camera</div>
                <div>• <span className="text-blue-300">Scroll</span> → zoom in / out</div>
                <div>• <span className="text-blue-300">Middle drag</span> → dolly</div>
              </section>
            </div>
          )}
        </aside>
      </div>

      <DisplayOptionsModal
        open={showDisplayOpts}
        onClose={() => setShowDisplayOpts(false)}
        opts={opts} setOpts={setOpts}
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
