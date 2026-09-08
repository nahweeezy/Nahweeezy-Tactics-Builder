import { useMemo, useRef, useState, useEffect, useCallback, Suspense, Fragment } from 'react';
import { Canvas, useThree, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls, Environment, Html } from '@react-three/drei';
import * as THREE from 'three';
import { ColladaLoader } from 'three/examples/jsm/loaders/ColladaLoader.js';
import ErrorBoundary from './ErrorBoundary';
import { faceUrl } from './faces';

// ── Custom stadium (.dae) configuration ────────────────────────────
// Drop your COLLADA file at: public/assets/models/stadium.dae
// Texture files in: public/assets/models/textures/<TextureName>.<ext>
//
// Tune these knobs to make the model fit the pitch (which is 105×68 m,
// centred on origin). The bounding box is logged to the console after
// the first load to help you pick a scale.
const STADIUM_MODEL = {
  url:      '/assets/models/stadium.dae',
  // When `autoFit` is true the loaded model is automatically scaled so its
  // longest horizontal dimension equals `targetSize` units, then centred
  // horizontally and dropped onto the pitch (its lowest point at y=0).
  // Set `autoFit: false` to use the manual scale/position/rotation knobs.
  autoFit:    true,
  // Longest horizontal dim of the model in metres. Bigger = more stand depth
  // around the pitch. Pitch is 105 long, so 200 gives ~47m of stand depth
  // each end (≈ stadium-sized).
  targetSize: 200,
  // After auto-fit, the model's bbox bottom sits at y=0. Many stadium models
  // include hidden foundation geometry below the visible structure, which
  // makes the bowl floor end up FAR above the pitch. This value drops the
  // whole model down so the visible bowl floor aligns with the pitch.
  // It auto-scales with `targetSize` (it's expressed as a fraction of total
  // scaled height — 0.30 ≈ 30% from the bottom of the model).
  pitchYFraction: 0.30,
  // (Old absolute knob — kept for back-compat. If non-null, it overrides
  // pitchYFraction. Set to null to use the fraction.)
  pitchYAdjust: null,
  scale:      1,
  position:   [0, 0, 0],
  rotation:   [0, 0, 0],
};

// PBR texture rebinding for Assimp-exported COLLADA models that lost their
// material→texture links during export. Material name (from the .dae's
// <effect id="X-fx">) maps to the texture set with that prefix.
const TEX_BASE = '/assets/models/textures';
const TEXTURE_SETS = {
  Rails:           { albedo:'Rails_albedo.jpg',            normal:'Rails_normal.png',            metallic:'Rails_metallic.jpg',            roughness:'Rails_roughness.jpg' },
  Scaffold_Lights: { albedo:'Scaffold_Lights_albedo.jpg',  normal:'Scaffold_Lights_normal.png',  metallic:'Scaffold_Lights_metallic.jpg',  roughness:'Scaffold_Lights_roughness.jpg', emissive:'Scaffold_Lights_emissive.jpg' },
  Adverts:         { albedo:'Adverts_albedo.jpg',          normal:'Adverts_normal.png',          metallic:'Adverts_metallic.jpg',          roughness:'Adverts_roughness.jpg' },
  Field_Entrance:  { albedo:'Field_Entrance_albedo.jpg',   normal:'Field_Entrance_normal.png',   metallic:'Field_Entrance_metallic.jpg',   roughness:'Field_Entrance_roughness.jpg' },
  Seats1:          { albedo:'Seats1_albedo.jpg',           normal:'Seats1_normal.png',           metallic:'Seats1_metallic.jpg',           roughness:'Seats1_roughness.jpg' },
  Seats2:          { albedo:'Seats2_albedo.jpg',           normal:'Seats2_normal.png',           metallic:'Seats2_metallic.jpg',           roughness:'Seats2_roughness.jpg' },
  Goal_Post:       { albedo:'Goal_Post_albedo.jpg',        normal:'Goal_Post_normal.png',        metallic:'Goal_Post_metallic.jpg',        roughness:'Goal_Post_roughness.jpg',        opacity:'Goal_Post_opacity.jpg' },
  Roof_Walls:      { albedo:'Roof_Walls_albedo.jpg',       normal:'Roof_Walls_normal.png',       metallic:'Roof_Walls_metallic.jpg',       roughness:'Roof_Walls_roughness.jpg' },
};

// Cache textures so multi-mesh materials reuse the same loader output
const _texCache = new Map();
function loadTex(name, sRGB = false) {
  if (_texCache.has(name)) return _texCache.get(name);
  const t = new THREE.TextureLoader().load(`${TEX_BASE}/${name}`);
  if (sRGB) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  _texCache.set(name, t);
  return t;
}

// Override: solid blue for both seat sets — keeps normal/roughness for surface
// detail but tints ALL the chairs blue across the stadium.
const SEAT_BLUE = '#1d4ed8';

// Override: generate a tile of Nahweeezy ad branding for the perimeter ad
// boards. Tiled horizontally so the strip around the pitch reads as multiple
// rotating ads.
let _adTexture = null;
function buildAdvertTexture() {
  if (_adTexture) return _adTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 4096; canvas.height = 256;
  const ctx = canvas.getContext('2d');
  // Each ad in the strip is one of these brand panels.
  const ADS = [
    { label: 'YOUTUBE',  sub: '@Nahweeezy',  c1: '#ff0000', c2: '#990000' },
    { label: 'TIKTOK',   sub: '@Nahweeezy',  c1: '#000000', c2: '#ff0050' },
    { label: 'DISCORD',  sub: 'Join server', c1: '#5865f2', c2: '#3a44b8' },
    { label: 'X',        sub: '@Nahweeezy',  c1: '#0a0a0a', c2: '#272727' },
    { label: 'TWITCH',   sub: 'Live reacts', c1: '#9146ff', c2: '#5c2da3' },
    { label: 'NAHWEEEZY',sub: 'TACTICS BOARD',c1: '#0b1220',c2: '#1d4ed8' },
  ];
  const tileW = canvas.width / ADS.length;
  ADS.forEach((ad, i) => {
    const x = i * tileW;
    const grad = ctx.createLinearGradient(x, 0, x + tileW, 0);
    grad.addColorStop(0, ad.c1); grad.addColorStop(1, ad.c2);
    ctx.fillStyle = grad;
    ctx.fillRect(x, 0, tileW, canvas.height);
    // border / scanline detail
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    for (let y = 0; y < canvas.height; y += 2) ctx.fillRect(x, y, tileW, 1);
    // label
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 88px "Bebas Neue", sans-serif';
    ctx.fillText(ad.label, x + tileW / 2, canvas.height / 2 - 20);
    ctx.font = '600 36px Oswald, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(ad.sub.toUpperCase(), x + tileW / 2, canvas.height / 2 + 56);
  });
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 8;
  _adTexture = t;
  return t;
}

function applyPBRMaterials(scene) {
  scene.traverse((obj) => {
    if (!obj.isMesh) return;
    const matName = obj.material?.name;
    const set = TEXTURE_SETS[matName];
    if (!set) return;

    // ── OVERRIDES ───────────────────────────────────────────────
    // Both seat sets get tinted solid blue — diffuse map dropped, surface
    // detail (normal/roughness) preserved.
    const isSeats = (matName === 'Seats1' || matName === 'Seats2');
    // Adverts get our custom Nahweeezy texture. Tagged so the click handler
    // knows this mesh is the ad strip.
    const isAdverts = (matName === 'Adverts');

    const newMat = new THREE.MeshStandardMaterial({
      name: matName,
      color:         isSeats ? new THREE.Color(SEAT_BLUE) : new THREE.Color(0xffffff),
      map:           isSeats   ? null
                   : isAdverts ? buildAdvertTexture()
                   : set.albedo ? loadTex(set.albedo, true) : null,
      normalMap:     set.normal    ? loadTex(set.normal)       : null,
      roughnessMap:  set.roughness ? loadTex(set.roughness)    : null,
      metalnessMap:  set.metallic  ? loadTex(set.metallic)     : null,
      emissiveMap:   set.emissive  ? loadTex(set.emissive)     : null,
      emissive:           set.emissive ? new THREE.Color(0xffffff) : new THREE.Color(0x000000),
      emissiveIntensity:  set.emissive ? 1.6 : 0,
      transparent:        !!set.opacity,
      alphaMap:           set.opacity ? loadTex(set.opacity) : null,
      side:               set.opacity ? THREE.DoubleSide : THREE.FrontSide,
      metalness: 1,    // multiplied with the metallic map
      roughness: 1,    // multiplied with the roughness map
    });
    obj.material = newMat;
    if (isAdverts) obj.userData.isAdverts = true;     // for click-handling
    obj.castShadow = true;
    obj.receiveShadow = true;
  });
}

/**
 * 3D pitch view with full feature parity to 2D mode.
 *
 * INTERACTIONS
 *   • LMB drag a player    → reposition (handlers live in TacticsBuilder)
 *   • LMB drag the ball    → reposition
 *   • LMB drag empty pitch → tool action (arrow / zone draw, text/press add)
 *   • LMB click drawing    → erase (when eraser tool active)
 *   • Ctrl + LMB drag      → orbit camera
 *   • RMB drag             → orbit camera
 *   • Scroll               → zoom
 *   • Middle drag          → dolly
 *   • Right-click player   → clear the assigned face (Player Mode only)
 */

// 3D world scale: 1 unit = 1 metre. Real pitch ≈ 105 × 68 m.
const P_W = 105;
const P_H = 68;

// Match the 2D PHASE_DURATION so 3D phase animations are paced identically.
const PHASE_DURATION_MS = 2400;

const TEAM_COLORS = { home: '#eef1e6', away: '#f43f5e' };

// PITCH coords (0..1050, 0..680) ⇄ WORLD coords (-P_W/2..P_W/2, -P_H/2..P_H/2)
const PITCH_W_PX = 1050;
const PITCH_H_PX = 680;
const pitchToWorldX = (x) => (x / PITCH_W_PX) * P_W - P_W / 2;
const pitchToWorldZ = (y) => (y / PITCH_H_PX) * P_H - P_H / 2;
const worldToPitchX = (wx) => ((wx + P_W / 2) / P_W) * PITCH_W_PX;
const worldToPitchZ = (wz) => ((wz + P_H / 2) / P_H) * PITCH_H_PX;

const ARROW_COLOR_HEX = {
  white:  '#f8fafc',
  yellow: '#fde047',
  orange: '#fb923c',
  blue:   '#60a5fa',
};

/* ────────────────────────────────────────────────────────────
   PITCH GROUND — canvas-textured plane with chevron stripes + lines
   ──────────────────────────────────────────────────────────── */
function PitchGround() {
  const tex = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2048; canvas.height = 1320;
    const ctx = canvas.getContext('2d');
    const stripes = 12;
    for (let i = 0; i < stripes; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#1e6a3b' : '#1c6237';
      ctx.fillRect(i * (canvas.width / stripes), 0, canvas.width / stripes, canvas.height);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 4;
    const margin = 40;
    ctx.strokeRect(margin, margin, canvas.width - margin * 2, canvas.height - margin * 2);
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, margin); ctx.lineTo(canvas.width / 2, canvas.height - margin); ctx.stroke();
    ctx.beginPath(); ctx.arc(canvas.width / 2, canvas.height / 2, 180, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(canvas.width / 2, canvas.height / 2, 6, 0, Math.PI * 2); ctx.fill();
    const pbW = 320, pbH = 770;
    ctx.strokeRect(margin, (canvas.height - pbH) / 2, pbW, pbH);
    ctx.strokeRect(canvas.width - margin - pbW, (canvas.height - pbH) / 2, pbW, pbH);
    const gbW = 105, gbH = 350;
    ctx.strokeRect(margin, (canvas.height - gbH) / 2, gbW, gbH);
    ctx.strokeRect(canvas.width - margin - gbW, (canvas.height - gbH) / 2, gbW, gbH);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath(); ctx.arc(margin + 220, canvas.height / 2, 6, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(canvas.width - margin - 220, canvas.height / 2, 6, 0, Math.PI * 2); ctx.fill();
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  return (
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[P_W, P_H, 1, 1]} />
      <meshStandardMaterial map={tex} roughness={0.95} />
    </mesh>
  );
}

// Same ad list our perimeter ad boards use in 2D — keeps both views in sync.
const NAHWEEEZY_ADS = [
  { label: 'YouTube',  url: 'https://youtube.com/@Nahweeezy',  icon: '/assets/icons/youtube.png' },
  { label: 'TikTok',   url: 'https://tiktok.com/@Nahweeezy',   icon: '/assets/icons/tiktok.webp' },
  { label: 'Discord',  url: 'https://discord.gg/nahweeezy',    icon: '/assets/icons/discord.webp' },
  { label: 'X',        url: 'https://x.com/Nahweeezy',         icon: '/assets/icons/x.webp' },
  { label: 'Twitch',   url: 'https://twitch.tv/nahweeezy',     icon: '/assets/icons/twitch.webp' },
];

// Loads STADIUM_MODEL.url via ColladaLoader and inserts it into the scene.
// Suspense will wait on the load; ErrorBoundary catches a missing file.
function CustomStadium({ onAdvertClick }) {
  const collada = useLoader(ColladaLoader, STADIUM_MODEL.url);
  // Apply PBR textures, then either auto-fit the bbox or use manual transforms
  useEffect(() => {
    if (!collada?.scene) return;
    const root = collada.scene;
    applyPBRMaterials(root);

    if (STADIUM_MODEL.autoFit) {
      // Reset transforms before measuring
      root.scale.setScalar(1);
      root.position.set(0, 0, 0);
      root.rotation.set(...STADIUM_MODEL.rotation);
      const box = new THREE.Box3().setFromObject(root);
      const size = new THREE.Vector3(); box.getSize(size);
      const longest = Math.max(size.x, size.z) || 1;
      const s = STADIUM_MODEL.targetSize / longest;
      root.scale.setScalar(s);
      box.setFromObject(root);
      const c = new THREE.Vector3(); box.getCenter(c);
      // Centre horizontally and drop the lowest point to y=0,
      // then drop further by pitchYAdjust to align the bowl-floor with the pitch.
      root.position.x -= c.x;
      root.position.z -= c.z;
      root.position.y -= box.min.y;
      // Drop the model so the visible bowl floor aligns with the pitch.
      // Prefer the absolute pitchYAdjust if set, else use a fraction of the
      // scaled height (so this auto-scales with targetSize).
      const totalH = size.y * s;
      const drop = (STADIUM_MODEL.pitchYAdjust != null)
        ? STADIUM_MODEL.pitchYAdjust
        : totalH * (STADIUM_MODEL.pitchYFraction ?? 0);
      root.position.y -= drop;
      // eslint-disable-next-line no-console
      console.log('[CustomStadium] autoFit applied. scale:', s.toFixed(4),
        'final size:', size.clone().multiplyScalar(s).toArray().map(n => n.toFixed(2)),
        '— if it hovers/sinks, tune STADIUM_MODEL.pitchYAdjust');
    } else {
      root.scale.setScalar(STADIUM_MODEL.scale);
      root.position.set(...STADIUM_MODEL.position);
      root.rotation.set(...STADIUM_MODEL.rotation);
    }
  }, [collada]);
  // Clicking on the perimeter Adverts mesh opens the social-links popup.
  const handleClick = (e) => {
    if (e.object?.userData?.isAdverts || e.object?.material?.name === 'Adverts') {
      e.stopPropagation();
      onAdvertClick?.();
    }
  };
  return <primitive object={collada.scene} onClick={handleClick} />;
}

// Floating popup (HTML) that lists the Nahweeezy social links — opens when
// the user clicks any perimeter ad in 3D.
function StadiumAdsPopup({ onClose }) {
  return (
    <Html fullscreen zIndexRange={[2000, 1000]}>
      <div onClick={onClose}
        style={{
          position:'fixed', inset:0, display:'flex',
          alignItems:'center', justifyContent:'center',
          background:'rgba(0,0,0,0.7)', backdropFilter:'blur(4px)',
        }}>
        <div onClick={(e) => e.stopPropagation()}
          style={{
            background:'#171b0f', borderRadius:12,
            border:'1px solid rgba(215,255,60,0.35)',
            padding:'24px 28px', minWidth:320, maxWidth:420,
            boxShadow:'0 30px 80px rgba(0,0,0,0.7), 0 0 60px rgba(215,255,60,0.18)',
          }}>
          <div style={{
            fontFamily:'"Bebas Neue", sans-serif', fontSize:24,
            color:'#fff', letterSpacing:'2px', marginBottom:4,
          }}>NAHWEEEZY</div>
          <div style={{
            fontFamily:'Oswald, sans-serif', fontSize:11,
            color:'#d7ff3c', letterSpacing:'3px', marginBottom:18,
          }}>FOLLOW · WATCH · CHAT</div>
          <div style={{ display:'grid', gap:8 }}>
            {NAHWEEEZY_ADS.map(ad => (
              <a key={ad.label} href={ad.url} target="_blank" rel="noopener noreferrer"
                style={{
                  display:'flex', alignItems:'center', gap:12,
                  padding:'10px 14px', background:'rgba(255,255,255,0.04)',
                  border:'1px solid rgba(255,255,255,0.08)', borderRadius:8,
                  color:'#fff', textDecoration:'none', fontFamily:'Oswald, sans-serif',
                  fontWeight:600, letterSpacing:'1.5px', fontSize:14,
                  transition:'background 0.15s, border-color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(96,165,250,0.12)'; e.currentTarget.style.borderColor = 'rgba(96,165,250,0.45)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)'; }}>
                {ad.icon && <img src={ad.icon} alt={ad.label}
                  style={{ width:24, height:24, objectFit:'contain' }} />}
                <span>{ad.label.toUpperCase()}</span>
                <span style={{ marginLeft:'auto', opacity:0.5, fontSize:11 }}>↗</span>
              </a>
            ))}
          </div>
          <button onClick={onClose}
            style={{
              marginTop:14, width:'100%', padding:'8px 12px',
              background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)',
              borderRadius:6, color:'#cbd5e1', cursor:'pointer',
              fontFamily:'Oswald, sans-serif', fontSize:11, letterSpacing:'2px',
            }}>
            CLOSE
          </button>
        </div>
      </div>
    </Html>
  );
}

function StadiumStands() {
  const standDepth = 22;
  const standHeight = 14;
  const offset = 6;
  return (
    <group>
      {[-1, 1].map(side => (
        <mesh key={`long-${side}`}
          position={[0, standHeight / 2, side * (P_H / 2 + offset + standDepth / 2)]}>
          <boxGeometry args={[P_W + standDepth * 2, standHeight, standDepth]} />
          <meshStandardMaterial color="#1f2937" metalness={0.1} roughness={0.85} />
        </mesh>
      ))}
      {[-1, 1].map(side => (
        <mesh key={`short-${side}`}
          position={[side * (P_W / 2 + offset + standDepth / 2), standHeight / 2, 0]}>
          <boxGeometry args={[standDepth, standHeight, P_H + offset * 2]} />
          <meshStandardMaterial color="#1f2937" metalness={0.1} roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

function GoalNet({ x }) {
  const direction = x < 0 ? 1 : -1;
  const goalW = 7.32;
  const goalH = 2.44;
  const goalDepth = 2.0;
  return (
    <group position={[x, goalH / 2, 0]}>
      <mesh position={[0, 0, -goalW / 2]}>
        <cylinderGeometry args={[0.07, 0.07, goalH, 8]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, 0, goalW / 2]}>
        <cylinderGeometry args={[0.07, 0.07, goalH, 8]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[0, goalH / 2, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.07, 0.07, goalW, 8]} />
        <meshStandardMaterial color="#ffffff" />
      </mesh>
      <mesh position={[direction * goalDepth / 2, 0, 0]}>
        <boxGeometry args={[goalDepth, goalH, goalW]} />
        <meshStandardMaterial color="#ffffff" transparent opacity={0.08} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/* ────────────────────────────────────────────────────────────
   INTERACTIVE PLAYER — clickable, draggable, with selection ring
   ──────────────────────────────────────────────────────────── */
function Player3D({ player, position, color, selected, playerMode, animating,
                   onPointerDown, onContextMenu, onLabelClick }) {
  const ringRef = useRef();
  // Imperative position lerp: when `animating` flips true and the target
  // changes, we linearly interpolate world position over PHASE_DURATION_MS
  // — matching the 2D CSS-transform behaviour. When not animating (drag,
  // initial mount, idle), we snap to target every frame so dragging is
  // responsive.
  const groupRef = useRef();
  const startPos = useRef(position);
  const startTime = useRef(0);
  const lastTarget = useRef(position);
  useEffect(() => {
    const t = lastTarget.current;
    if (position[0] !== t[0] || position[1] !== t[1] || position[2] !== t[2]) {
      if (groupRef.current && animating) {
        startPos.current = [groupRef.current.position.x, groupRef.current.position.y, groupRef.current.position.z];
        startTime.current = performance.now();
      }
      lastTarget.current = position;
    }
  }, [position, animating]);
  useFrame(({ clock }) => {
    // Selection ring pulse
    if (selected && ringRef.current) {
      const t = clock.getElapsedTime() * 2;
      ringRef.current.scale.setScalar(1 + 0.08 * Math.sin(t));
      ringRef.current.material.opacity = 0.6 + 0.3 * Math.sin(t);
    }
    // Position lerp / snap
    if (!groupRef.current) return;
    if (!animating) {
      groupRef.current.position.set(position[0], position[1], position[2]);
      return;
    }
    const elapsed = performance.now() - startTime.current;
    const tParam = Math.min(1, elapsed / PHASE_DURATION_MS);
    const [sx, sy, sz] = startPos.current;
    const [tx, ty, tz] = position;
    groupRef.current.position.set(
      sx + (tx - sx) * tParam,
      sy + (ty - sy) * tParam,
      sz + (tz - sz) * tParam,
    );
  });
  return (
    <group ref={groupRef}
      onPointerDown={(e) => onPointerDown(e, player.id)}
      onContextMenu={(e) => onContextMenu(e, player.id)}>
      {/* shadow disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.6, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.35} />
      </mesh>
      {/* selection halo */}
      {selected && (
        <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
          <ringGeometry args={[0.8, 1.0, 32]} />
          <meshBasicMaterial color="#d7ff3c" transparent opacity={0.7} side={THREE.DoubleSide} />
        </mesh>
      )}
      {/* base ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <ringGeometry args={[0.45, 0.6, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
      {/* body */}
      <mesh castShadow position={[0, 0.7, 0]}>
        <cylinderGeometry args={[0.32, 0.32, 1.3, 16]} />
        <meshStandardMaterial color={color} roughness={0.6} />
      </mesh>
      {/* head */}
      <mesh castShadow position={[0, 1.6, 0]}>
        <sphereGeometry args={[0.28, 16, 16]} />
        <meshStandardMaterial color="#fcd9b6" roughness={0.7} />
      </mesh>
      {/* Nameplate + (in PL mode) headshot — sits above the model */}
      <Html position={[0, 2.5, 0]} center occlude={false} zIndexRange={[100, 0]}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          gap: 4, transform: 'translate(0, -100%)',
          // The wrapper passes pointer events through to the canvas; only the
          // inner clickable bits below opt back in to receive clicks.
          pointerEvents: 'none',
        }}>
          {playerMode && player.face && (
            <img
              src={faceUrl(player.face.id)}
              alt={player.face.name}
              draggable={false}
              onClick={(e) => { e.stopPropagation(); onLabelClick?.(player.id); }}
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
              style={{
                width: 44, height: 44,
                // Cutouts are transparent head-and-chest PNGs: cover+top framing
                // keeps the face in the disc, and the kit colour fills behind it.
                objectFit: 'cover', objectPosition: 'top',
                borderRadius: '50%',
                border: `2px solid ${color}`,
                background: color,
                boxShadow: '0 4px 12px rgba(0,0,0,0.6)',
                cursor: 'pointer', pointerEvents: 'auto',
              }} />
          )}
          <div
            onClick={(e) => { e.stopPropagation(); onLabelClick?.(player.id); }}
            title="Click to open player panel"
            style={{
              padding: '3px 9px',
              background: selected ? 'rgba(215,255,60,0.95)' : 'rgba(0,0,0,0.88)',
              border: selected ? '1px solid #eaffa0' : '1px solid rgba(215,255,60,0.55)',
              borderRadius: 4,
              fontSize: 13,
              fontFamily: '"Uni Sans Heavy", Oswald, sans-serif',
              letterSpacing: '0.06em',
              // Volt is a light accent — dark ink on it, white off it.
              color: selected ? '#0e1104' : '#fff',
              fontWeight: 800,
              whiteSpace: 'nowrap',
              textShadow: selected ? 'none' : '0 1px 2px rgba(0,0,0,0.7)',
              userSelect: 'none',
              cursor: 'pointer',
              pointerEvents: 'auto',
              transition: 'background 0.12s, border-color 0.12s, transform 0.12s',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; }}>
            {player.name?.trim() || (playerMode && player.face ? player.face.name : player.label)}
          </div>
        </div>
      </Html>
    </group>
  );
}

// Slightly larger so the jabulani texture is readable from a distance.
const BALL_RADIUS_3D = 0.22;

function Ball3D({ position, animating, onPointerDown }) {
  // Textured 2010 World Cup ball — jabulani.png as albedo, jabulani_normal.png
  // as normal map for surface detail. Spins slowly for ambience.
  const meshRef = useRef();
  const groupRef = useRef();
  const startPos = useRef(position);
  const startTime = useRef(0);
  const lastTarget = useRef(position);
  const albedo = useMemo(() => {
    const t = new THREE.TextureLoader().load('/assets/icons/jabulani.png');
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  }, []);
  const normal = useMemo(() => {
    const t = new THREE.TextureLoader().load('/assets/icons/jabulani_normal.png');
    return t;
  }, []);
  useEffect(() => {
    const t = lastTarget.current;
    if (position[0] !== t[0] || position[1] !== t[1] || position[2] !== t[2]) {
      if (groupRef.current && animating) {
        startPos.current = [groupRef.current.position.x, groupRef.current.position.y, groupRef.current.position.z];
        startTime.current = performance.now();
      }
      lastTarget.current = position;
    }
  }, [position, animating]);
  useFrame((_, dt) => {
    // Slow rotation for ambience
    if (meshRef.current) meshRef.current.rotation.y += dt * 0.4;
    // Position lerp / snap (same pattern as Player3D)
    if (!groupRef.current) return;
    if (!animating) {
      groupRef.current.position.set(position[0], position[1], position[2]);
      return;
    }
    const elapsed = performance.now() - startTime.current;
    const tParam = Math.min(1, elapsed / PHASE_DURATION_MS);
    const [sx, sy, sz] = startPos.current;
    const [tx, ty, tz] = position;
    groupRef.current.position.set(
      sx + (tx - sx) * tParam,
      sy + (ty - sy) * tParam,
      sz + (tz - sz) * tParam,
    );
  });
  return (
    <group ref={groupRef} onPointerDown={onPointerDown}>
      <mesh ref={meshRef} castShadow position={[0, BALL_RADIUS_3D + 0.04, 0]}>
        <sphereGeometry args={[BALL_RADIUS_3D, 32, 32]} />
        <meshStandardMaterial map={albedo} normalMap={normal}
          roughness={0.5} metalness={0.05} />
      </mesh>
      {/* contact shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
        <circleGeometry args={[BALL_RADIUS_3D + 0.06, 24]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.45} />
      </mesh>
    </group>
  );
}

/* ────────────────────────────────────────────────────────────
   DRAWINGS in 3D — flat overlays just above the pitch
   ──────────────────────────────────────────────────────────── */
function ArrowMesh({ arrow, onClick }) {
  // All hooks before any conditional returns (rules-of-hooks)
  const built = useMemo(() => {
    const points = arrow.points || [];
    if (points.length < 2) return null;
    const worldPoints = points.map(p =>
      new THREE.Vector3(pitchToWorldX(p.x), 0.05, pitchToWorldZ(p.y))
    );
    const curve = new THREE.CatmullRomCurve3(worldPoints, false, 'centripetal', 0.5);
    const tubeGeom = new THREE.TubeGeometry(curve, Math.max(6, points.length * 4), 0.16, 8, false);
    const last = worldPoints[worldPoints.length - 1];
    const prev = worldPoints[worldPoints.length - 2];
    const dir = new THREE.Vector3().subVectors(last, prev).normalize();
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    return { tubeGeom, headPos: last.clone(), quat };
  }, [arrow]);
  if (!built) return null;
  const color = ARROW_COLOR_HEX[arrow.color] || ARROW_COLOR_HEX.white;
  return (
    <group onClick={onClick}>
      <mesh geometry={built.tubeGeom}>
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
      </mesh>
      <mesh position={built.headPos} quaternion={built.quat}>
        <coneGeometry args={[0.4, 0.9, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

function ZoneMesh({ zone, onClick }) {
  // zone in pitch coords: { x, y, w, h }
  const cx = zone.x + zone.w / 2;
  const cy = zone.y + zone.h / 2;
  const wx = pitchToWorldX(cx);
  const wz = pitchToWorldZ(cy);
  // Convert zone size from pitch px to world units
  const ww = (zone.w / PITCH_W_PX) * P_W;
  const wh = (zone.h / PITCH_H_PX) * P_H;
  return (
    <mesh position={[wx, 0.04, wz]} rotation={[-Math.PI / 2, 0, 0]} onClick={onClick}>
      <planeGeometry args={[ww, wh]} />
      <meshBasicMaterial color={zone.color || 'rgba(255,255,255,0.14)'}
        transparent opacity={0.45} side={THREE.DoubleSide} />
    </mesh>
  );
}

function TextMesh({ t, onClick }) {
  const wx = pitchToWorldX(t.x);
  const wz = pitchToWorldZ(t.y);
  return (
    <Html position={[wx, 0.2, wz]} center distanceFactor={16}>
      <div onClick={(e) => { e.stopPropagation(); onClick?.(); }}
        style={{
          padding: '3px 8px',
          background: 'rgba(0,0,0,0.82)',
          border: '1px solid rgba(215,255,60,0.42)',
          borderRadius: 3,
          fontSize: 11,
          fontFamily: '"Uni Sans Heavy", Oswald, sans-serif',
          letterSpacing: '0.08em',
          color: '#d7ff3c',
          fontWeight: 800,
          whiteSpace: 'nowrap',
          cursor: 'pointer',
          userSelect: 'none',
        }}>
        {t.text}
      </div>
    </Html>
  );
}

function PressMesh({ p, onClick }) {
  const ringRef = useRef();
  useFrame(({ clock }) => {
    if (!ringRef.current) return;
    const k = (Math.sin(clock.getElapsedTime() * 3) + 1) / 2;
    ringRef.current.scale.setScalar(0.85 + k * 0.3);
  });
  const wx = pitchToWorldX(p.x);
  const wz = pitchToWorldZ(p.y);
  return (
    <group position={[wx, 0.06, wz]} onClick={onClick}>
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.7, 1.1, 32]} />
        <meshBasicMaterial color="#f43f5e" transparent opacity={0.85} side={THREE.DoubleSide} />
      </mesh>
      <Html position={[0, 0.1, 0]} center>
        <div style={{
          color: '#fff', fontSize: 14, fontWeight: 900,
          textShadow: '0 0 8px rgba(220,38,38,0.9)', userSelect: 'none',
        }}>!</div>
      </Html>
    </group>
  );
}

/* ────────────────────────────────────────────────────────────
   SCENE — ties everything together inside the Canvas
   ──────────────────────────────────────────────────────────── */
function Scene({ tactics, players, displayedPositions, ballPos,
                 selectedPlayer, playerMode, tool, arrowColor, drawings, drawingArrow, drawingZone,
                 customStadium, animating, kits = TEAM_COLORS }) {
  const { camera, gl, raycaster } = useThree();
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [adsOpen, setAdsOpen] = useState(false);
  const dragInProgress = useRef(false);

  // ── Track Ctrl state to gate camera control ───────────────────────
  useEffect(() => {
    const onKey = (e) => setCtrlHeld(e.ctrlKey || e.metaKey);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKey);
    };
  }, []);

  // ── Project a screen-space pointer to a point on the ground plane ─
  const project = useCallback((clientX, clientY) => {
    const rect = gl.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x, y }, camera);
    const ray = raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-5) return null;
    const t = -ray.origin.y / ray.direction.y;
    if (t < 0) return null;
    const pos = ray.origin.clone().add(ray.direction.clone().multiplyScalar(t));
    return { x: worldToPitchX(pos.x), y: worldToPitchZ(pos.z) };
  }, [camera, gl, raycaster]);

  // ── Document-level move/up for drag continuation ──────────────────
  // Listeners are added ONCE and read latest tactics/project via refs
  // (instead of re-binding on every TacticsBuilder re-render, which caused
  // the drag to silently break mid-stroke).
  const tacticsRef = useRef(tactics);
  const projectRef = useRef(project);
  useEffect(() => { tacticsRef.current = tactics; }, [tactics]);
  useEffect(() => { projectRef.current = project; }, [project]);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragInProgress.current) return;
      const pt = projectRef.current(e.clientX, e.clientY);
      if (pt) tacticsRef.current.continueDragOrDraw(pt);
    };
    const onUp = () => {
      if (!dragInProgress.current) return;
      dragInProgress.current = false;
      tacticsRef.current.endDragOrDraw();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, []);

  // ── Player / ball pointerdown handlers ────────────────────────────
  const handlePlayerDown = (e, id) => {
    if (e.ctrlKey || e.metaKey || e.button === 2) return; // let camera handle
    e.stopPropagation();
    if (tool === 'eraser') return;            // eraser shouldn't move tokens
    if (tool !== 'select') {
      // tool active — clicking a player is treated as clicking the pitch
      const pt = project(e.clientX, e.clientY);
      if (pt) tactics.startPitchAction(pt);
      dragInProgress.current = true;
      return;
    }
    const pt = project(e.clientX, e.clientY);
    if (!pt) return;
    if (playerMode) {
      tactics.selectPlayer(id);                // clicking opens the face picker
      return;
    }
    tactics.startPlayerDrag(id, pt);
    dragInProgress.current = true;
  };
  const handlePlayerContextMenu = (e, id) => {
    e.nativeEvent?.preventDefault?.();
    e.stopPropagation();
    if (playerMode) tactics.clearFaceFor(id);
    else tactics.selectPlayer(id);
  };
  const handleBallDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.button === 2) return;
    if (tool !== 'select') return;
    e.stopPropagation();
    const pt = project(e.clientX, e.clientY);
    if (!pt) return;
    tactics.startBallDrag(pt);
    dragInProgress.current = true;
  };

  // ── Ground click — tool action or starting a draw ─────────────────
  const handleGroundDown = (e) => {
    if (e.ctrlKey || e.metaKey || e.button === 2) return;
    e.stopPropagation();
    const pt = project(e.clientX, e.clientY);
    if (!pt) return;
    tactics.startPitchAction(pt);
    // For arrow/zone tools the action sets dragRef; we mirror that here.
    if (tool === 'arrow' || tool === 'zone') dragInProgress.current = true;
  };

  // ── Drawing previews ──────────────────────────────────────────────
  const previewArrow = drawingArrow && drawingArrow.points.length >= 2 && (
    <ArrowMesh arrow={{ points: drawingArrow.points, color: arrowColor }} />
  );
  const previewZone = drawingZone && drawingZone.w > 0 && drawingZone.h > 0 && (
    <ZoneMesh zone={{ ...drawingZone, color: ARROW_COLOR_HEX[arrowColor] }} />
  );

  return (
    <>
      <color attach="background" args={['#060912']} />

      {/* Lighting */}
      <ambientLight intensity={0.45} />
      <directionalLight position={[40, 60, 40]} intensity={0.8}
        castShadow shadow-mapSize-width={2048} shadow-mapSize-height={2048}
        shadow-camera-left={-80} shadow-camera-right={80}
        shadow-camera-top={80} shadow-camera-bottom={-80} />
      <directionalLight position={[-40, 50, -40]} intensity={0.4} />
      {/* Dark night-sky dome — replaces drei Sky which was rendering a bright
          atmospheric daytime gradient at the top of the canvas. */}
      <mesh>
        <sphereGeometry args={[400, 32, 16]} />
        <meshBasicMaterial side={THREE.BackSide} color="#06091a" fog={false} />
      </mesh>
      <Environment preset="night" />

      {/* Stadium — custom .dae model when enabled, else procedural box stands.
          The pitch ground + goals always come from our own primitives so the
          tactical lines / goal markings stay accurate. */}
      {customStadium ? (
        <ErrorBoundary fallback={<StadiumStands />}>
          <Suspense fallback={<StadiumStands />}>
            <CustomStadium onAdvertClick={() => setAdsOpen(true)} />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <StadiumStands />
      )}
      {adsOpen && <StadiumAdsPopup onClose={() => setAdsOpen(false)} />}
      <PitchGround />
      <GoalNet x={-P_W / 2} />
      <GoalNet x={P_W / 2} />

      {/* Ground catcher — invisible plane that catches all pointer events on the pitch */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.001, 0]}
        onPointerDown={handleGroundDown}>
        <planeGeometry args={[P_W, P_H]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* DRAWINGS */}
      {drawings.zones.map(z => (
        <ZoneMesh key={z.id} zone={z}
          onClick={(e) => { e.stopPropagation(); tactics.tryErase('zone', z.id); }} />
      ))}
      {drawings.arrows.map(a => (
        <ArrowMesh key={a.id} arrow={a}
          onClick={(e) => { e.stopPropagation(); tactics.tryErase('arrow', a.id); }} />
      ))}
      {drawings.presses.map(p => (
        <PressMesh key={p.id} p={p}
          onClick={(e) => { e?.stopPropagation?.(); tactics.tryErase('press', p.id); }} />
      ))}
      {drawings.texts.map(t => (
        <TextMesh key={t.id} t={t}
          onClick={() => tactics.tryErase('text', t.id)} />
      ))}

      {/* Drawing preview */}
      {previewArrow}
      {previewZone}

      {/* PLAYERS */}
      {players.map(p => {
        const pos = displayedPositions[p.id];
        if (!pos) return null;
        const wx = pitchToWorldX(pos.x);
        const wz = pitchToWorldZ(pos.y);
        return (
          <Player3D key={p.id} player={p} position={[wx, 0, wz]}
            color={p.team === 'home' ? kits.home : kits.away}
            selected={selectedPlayer === p.id}
            playerMode={playerMode}
            animating={animating}
            onPointerDown={handlePlayerDown}
            onContextMenu={handlePlayerContextMenu}
            onLabelClick={(id) => tactics.selectPlayer(id)} />
        );
      })}

      {/* BALL */}
      {ballPos && (() => {
        const wx = pitchToWorldX(ballPos.x);
        const wz = pitchToWorldZ(ballPos.y);
        return <Ball3D position={[wx, 0, wz]} animating={animating} onPointerDown={handleBallDown} />;
      })()}

      {/* Camera rig — gated by Ctrl. Plain LMB is reserved for app interactions. */}
      <OrbitControls
        target={[0, 0, 0]}
        enableDamping dampingFactor={0.08}
        minDistance={20} maxDistance={180}
        maxPolarAngle={Math.PI / 2 - 0.05}
        mouseButtons={{
          LEFT:   ctrlHeld ? THREE.MOUSE.ROTATE : null,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT:  THREE.MOUSE.ROTATE,
        }}
        touches={{
          ONE: THREE.TOUCH.PAN,
          TWO: THREE.TOUCH.DOLLY_ROTATE,
        }}
      />
    </>
  );
}

export default function Pitch3D({ tactics, players, displayedPositions, ballPos,
                                  selectedPlayer, playerMode, tool, arrowColor,
                                  drawings, drawingArrow, drawingZone,
                                  customStadium, animating, kits = TEAM_COLORS }) {
  // R3F's Canvas mounts with default 300×150 dimensions when lazy-loaded
  // inside Suspense — its internal ResizeObserver doesn't catch the parent
  // layout settle. We poke `resize` a few times after mount to force a
  // recompute.
  useEffect(() => {
    let cancelled = false;
    const fire = () => { if (!cancelled) window.dispatchEvent(new Event('resize')); };
    // Multiple attempts to cover paint / layout race conditions
    const ids = [
      requestAnimationFrame(fire),
      setTimeout(fire, 50),
      setTimeout(fire, 200),
      setTimeout(fire, 500),
    ];
    return () => {
      cancelled = true;
      cancelAnimationFrame(ids[0]);
      ids.slice(1).forEach(clearTimeout);
    };
  }, []);
  return (
    <div className="w-full relative" style={{ height: 'calc(100vh - 160px)' }}>
      <Canvas shadows
        camera={{ position: [0, 35, 65], fov: 45, near: 0.1, far: 500 }}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        onContextMenu={(e) => e.preventDefault()}
        style={{ borderRadius: '12px', background: '#0b0d08', cursor:
          tool === 'arrow' || tool === 'zone' || tool === 'press' ? 'crosshair' :
          tool === 'text' ? 'text' :
          tool === 'eraser' ? 'not-allowed' :
          'default' }}>
        <Scene
          tactics={tactics}
          players={players}
          displayedPositions={displayedPositions}
          ballPos={ballPos}
          selectedPlayer={selectedPlayer}
          playerMode={playerMode}
          kits={kits}
          tool={tool}
          arrowColor={arrowColor}
          drawings={drawings}
          drawingArrow={drawingArrow}
          drawingZone={drawingZone}
          customStadium={customStadium}
          animating={animating}
        />
      </Canvas>

      {/* Camera-control hint — tiny, floats over the canvas top-right so it
          doesn't steal vertical real-estate from the pitch. */}
      <div className="absolute top-2 right-3 text-[9px] tracking-[0.18em] text-slate-300/70 font-display
                      bg-black/45 border border-white/10 rounded px-2 py-1 pointer-events-none"
           style={{ position: 'absolute', top: 8, right: 12 }}>
        CTRL+LMB OR RMB ORBITS · SCROLL ZOOMS
      </div>
    </div>
  );
}
