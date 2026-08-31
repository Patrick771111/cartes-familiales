import * as THREE from 'three';
import { suitCardImage, classiqueFigureImage, cardBackImage } from '../ui/cardThemes.js';
import { suitInfo } from '../game/deck.js';

/**
 * Scène 3D persistante pour le Pouilleux — table ronde, un chevalet par
 * joueur (même contrat caméra / overlays que Trio : src/three/trioScene.js).
 *
 * Siège 0 = le joueur local (+Z). Les suivants suivent orderedOpponents.
 * Les chevalets adverses sont retournés (cartes vers le centre) : depuis
 * notre siège on lit les dos, pas les faces. Orbite yaw bornée pour un
 * joueur assis (tourner derrière = triche) ; 360° en spectateur.
 *
 * Clics = boutons DOM superposés (getCardRects), pas de raycasting.
 * Le retournement d'une carte piochée est une vraie rotation 180° Y.
 */

const CARD_ASPECT = 240 / 360;
const CAMERA_FOV = 46;

const TABLE_RADIUS = 2.55;
const TABLE_THICKNESS = 0.14;
const TABLE_TOP = TABLE_THICKNESS / 2;
const EASEL_RADIUS = 2.12;
const EASEL_WIDTH = 2.45;
const TARGET_EASEL_RADIUS = 1.82;
const CARD_SCALE = 0.42;
const CARD_TILT = -0.28;
const CARD_GEO = new THREE.PlaneGeometry(CARD_ASPECT, 1);

const FELT_600 = '#1F4D3A';
const FELT_900 = '#0F2E21';
const BRASS = '#C9A227';
const BRASS_SOFT = '#E4C765';
const CREAM = '#F7F1E1';
const WOOD = '#6B4423';
const WOOD_DARK = '#4A2E18';
const RED_SUIT = '#B33A3A';
const DARK_SUIT = '#201E18';
const SUIT_COLOR = { S: DARK_SUIT, H: RED_SUIT, D: RED_SUIT, C: DARK_SUIT };
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const COURT_LABEL = { J: 'V', Q: 'D', K: 'R' };
const PIP_LAYOUTS = {
  1: [[50, 50]],
  2: [[50, 18], [50, 82]],
  3: [[50, 18], [50, 50], [50, 82]],
  4: [[28, 18], [72, 18], [28, 82], [72, 82]],
  5: [[28, 18], [72, 18], [50, 50], [28, 82], [72, 82]],
  6: [[28, 18], [72, 18], [28, 50], [72, 50], [28, 82], [72, 82]],
  7: [[28, 18], [72, 18], [50, 34], [28, 50], [72, 50], [28, 82], [72, 82]],
  8: [[28, 18], [72, 18], [50, 34], [28, 50], [72, 50], [50, 66], [28, 82], [72, 82]],
  9: [[28, 13], [72, 13], [28, 37], [72, 37], [50, 50], [28, 63], [72, 63], [28, 87], [72, 87]],
  10: [[28, 13], [72, 13], [50, 25], [28, 37], [72, 37], [28, 63], [72, 63], [50, 75], [28, 87], [72, 87]]
};
const PIP_COUNT = { A: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10 };

const BASE_ELEV = 1.02;
const BASE_DIST = 5.35;
const PITCH_MIN = 0.38;
const PITCH_MAX = 1.28;
const DIST_MIN = 2.35;
const DIST_MAX_FACTOR = 1.45;
let lastSeatCount = 2;

let canvas = null;
let renderer = null;
let scene = null;
let camera = null;
let mounted = false;
let animationHandle = null;

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (animationHandle) cancelAnimationFrame(animationHandle);
    animationHandle = null;
    document.querySelectorAll('#pouilleux-3d-canvas, [id^="pouilleux-3d-canvas-"]').forEach((el) => el.remove());
    mounted = false;
    canvas = null;
  });
}

let tableGroup = null;
let seatGroups = [];
let myHandMeshes = [];
let opponentGroups = [];

const flips = new Map();
const fades = new Map();
const alarms = new Map();

let cardBackTexture = null;
let cardBackTheme = null;
const cardFaceTextures = new Map();

const _world = new THREE.Vector3();
const _look = new THREE.Vector3();

let orbitYaw = 0;
let orbitPitch = BASE_ELEV;
let orbitDistance = BASE_DIST;
let fittedDistance = BASE_DIST;
let userZoomed = false;
let orbitYawLimited = true;
let orbitYawLimit = 0.7;

function buildCardBackTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size / CARD_ASPECT);
  const ctx = c.getContext('2d');

  ctx.fillStyle = FELT_900;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = FELT_600;
  ctx.lineWidth = 8;
  for (let x = -c.height; x < c.width; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, c.height);
    ctx.lineTo(x + c.height, 0);
    ctx.stroke();
  }

  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);

  const cx = c.width / 2;
  const cy = c.height / 2;
  const r = c.width * 0.23;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = FELT_900;
  ctx.fill();
  ctx.strokeStyle = BRASS_SOFT;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = BRASS_SOFT;
  ctx.font = `600 ${Math.round(c.width * 0.22)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CF', cx, cy + 2);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function drawPips(ctx, c, rank, symbol, color) {
  const layout = PIP_LAYOUTS[PIP_COUNT[rank]] || PIP_LAYOUTS[1];
  const inset = c.width * 0.1;
  const areaW = c.width - inset * 2;
  const areaH = c.height - inset * 2;
  const single = layout.length === 1;

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(c.width * (single ? 0.46 : 0.26))}px Georgia, serif`;
  layout.forEach(([leftPct, topPct]) => {
    ctx.fillText(symbol, inset + (leftPct / 100) * areaW, inset + (topPct / 100) * areaH);
  });
}

function currentTheme() {
  return document.documentElement.dataset.cardTheme || 'classique';
}

function roleForRank(rank) {
  if (rank === 'A') return 'as';
  if (rank === 'J') return 'valet';
  if (rank === 'Q') return 'dame';
  if (rank === 'K') return 'roi';
  return 'number';
}

function isCourtRank(rank) {
  return rank === 'J' || rank === 'Q' || rank === 'K';
}

function drawCoverImage(ctx, img, w, h) {
  const ir = img.width / img.height;
  const br = w / h;
  let dw;
  let dh;
  let dx;
  let dy;
  if (ir > br) {
    dh = h;
    dw = h * ir;
    dx = (w - dw) / 2;
    dy = 0;
  } else {
    dw = w;
    dh = w / ir;
    dx = 0;
    dy = (h - dh) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawContainedImage(ctx, img, x, y, w, h) {
  const ir = img.width / img.height;
  const br = w / h;
  let dw;
  let dh;
  let dx;
  let dy;
  if (ir > br) {
    dw = w;
    dh = w / ir;
    dx = x;
    dy = y + (h - dh) / 2;
  } else {
    dh = h;
    dw = h * ir;
    dy = y;
    dx = x + (w - dw) / 2;
  }
  ctx.drawImage(img, dx, dy, dw, dh);
}

function drawCorners(ctx, c, label, symbol, color, { boxed = false } = {}) {
  const cornerFont = Math.round(c.width * 0.17);
  const drawOne = () => {
    if (boxed) {
      ctx.fillStyle = 'rgba(245, 240, 230, 0.88)';
      const bw = c.width * 0.28;
      const bh = c.height * 0.22;
      ctx.fillRect(c.width * 0.04, c.height * 0.03, bw, bh);
    }
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${cornerFont}px Georgia, serif`;
    ctx.fillText(label, c.width * 0.16, c.height * 0.05);
    ctx.font = `${Math.round(cornerFont * 0.7)}px Georgia, serif`;
    ctx.fillText(symbol, c.width * 0.16, c.height * 0.05 + cornerFont * 1.05);
  };
  drawOne();
  ctx.save();
  ctx.translate(c.width, c.height);
  ctx.rotate(Math.PI);
  drawOne();
  ctx.restore();
}

function drawCourtFigure(ctx, c, rank, symbol, color) {
  const cqw = c.width / 100;
  const label = COURT_LABEL[rank] || rank;

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, cqw * 0.6);
  const frameInset = 13 * cqw;
  const radius = 6 * cqw;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(frameInset, frameInset, c.width - frameInset * 2, c.height - frameInset * 2, radius);
  else ctx.rect(frameInset, frameInset, c.width - frameInset * 2, c.height - frameInset * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(19 * cqw)}px Georgia, serif`;
  const ornamentText = `${symbol}  ${symbol}  ${symbol}`;
  const ornamentOffset = 22 * cqw;
  ctx.fillText(ornamentText, c.width / 2, ornamentOffset);
  ctx.save();
  ctx.translate(c.width / 2, c.height - ornamentOffset);
  ctx.rotate(Math.PI);
  ctx.fillText(ornamentText, 0, 0);
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(38 * cqw)}px Georgia, serif`;
  ctx.fillText(label, c.width / 2, c.height / 2);
}

function buildCardFaceTexture(rank, suit, img = null, mode = 'mono') {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size / CARD_ASPECT);
  const ctx = c.getContext('2d');
  const color = SUIT_COLOR[suit] || DARK_SUIT;
  const symbol = SUIT_SYMBOL[suit] || '?';
  const label = COURT_LABEL[rank] || rank;

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, c.width, c.height);

  if (mode === 'full' && img) {
    drawCoverImage(ctx, img, c.width, c.height);
    drawCorners(ctx, c, label, symbol, color, { boxed: true });
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);
  drawCorners(ctx, c, label, symbol, color);

  if (isCourtRank(rank) && img && mode === 'inset') {
    const cqw = c.width / 100;
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, cqw * 0.6);
    const frameInset = 8 * cqw;
    const radius = 6 * cqw;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(frameInset, frameInset, c.width - frameInset * 2, c.height - frameInset * 2, radius);
    else ctx.rect(frameInset, frameInset, c.width - frameInset * 2, c.height - frameInset * 2);
    ctx.stroke();
    ctx.restore();
    const inset = 10 * cqw;
    drawContainedImage(ctx, img, inset, inset, c.width - inset * 2, c.height - inset * 2);
  } else if (isCourtRank(rank)) {
    drawCourtFigure(ctx, c, rank, symbol, color);
  } else {
    drawPips(ctx, c, rank, symbol, color);
  }

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function applyFaceToMeshes(rank, suit, tex) {
  for (const mesh of allMeshes()) {
    if (mesh.userData.rank === rank && mesh.userData.suit === suit && mesh.userData.face) {
      mesh.userData.face.material.map = tex;
      mesh.userData.face.material.needsUpdate = true;
    }
  }
}

function getCardBackTexture() {
  const theme = currentTheme();
  if (cardBackTexture && cardBackTheme === theme) return cardBackTexture;
  cardBackTheme = theme;
  const url = cardBackImage(theme);
  cardBackTexture = buildCardBackTexture();
  if (url) {
    const img = new Image();
    img.onload = () => {
      if (cardBackTheme !== theme) return;
      const tex = new THREE.Texture(img);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.needsUpdate = true;
      cardBackTexture = tex;
      for (const mesh of allMeshes()) {
        if (!mesh.userData.faceUp && !flips.has(mesh.userData.cardId) && mesh.userData.back) {
          mesh.userData.back.material.map = tex;
          mesh.userData.back.material.needsUpdate = true;
        }
      }
    };
    img.src = url;
  }
  return cardBackTexture;
}

function getCardFaceTexture(rank, suit) {
  const theme = currentTheme();
  const key = `${theme}:${rank}${suit}`;
  const cached = cardFaceTextures.get(key);
  if (cached) return cached;

  const fallback = buildCardFaceTexture(rank, suit);
  cardFaceTextures.set(key, fallback);

  const role = roleForRank(rank);
  const fullUrl = suitCardImage(theme, suit, role);
  const insetUrl = !fullUrl && isCourtRank(rank) ? classiqueFigureImage(role, suitInfo(suit)?.color) : null;
  const url = fullUrl || insetUrl;
  if (url) {
    const img = new Image();
    img.onload = () => {
      if (currentTheme() !== theme) return;
      const tex = buildCardFaceTexture(rank, suit, img, fullUrl ? 'full' : 'inset');
      cardFaceTextures.set(key, tex);
      fallback.dispose();
      applyFaceToMeshes(rank, suit, tex);
    };
    img.src = url;
  }
  return fallback;
}

function makeCardMaterial() {
  return new THREE.MeshStandardMaterial({
    roughness: 0.55,
    metalness: 0.02,
    transparent: true,
    emissive: 0x000000,
    emissiveIntensity: 1,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    depthWrite: true
  });
}

function createCardMesh() {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  const back = new THREE.Mesh(CARD_GEO, makeCardMaterial());
  const face = new THREE.Mesh(CARD_GEO, makeCardMaterial());
  face.rotation.y = Math.PI;
  back.position.z = 0.0015;
  face.position.z = -0.0015;
  pivot.add(back);
  pivot.add(face);
  root.add(pivot);
  root.userData.pivot = pivot;
  root.userData.back = back;
  root.userData.face = face;
  return root;
}

function disposeMesh(root) {
  if (!root) return;
  flips.delete(root.userData.cardId);
  fades.delete(root.userData.cardId);
  alarms.delete(root.userData.cardId);
  root.parent?.remove(root);
  const { back, face } = root.userData;
  if (back?.material) back.material.dispose();
  if (face?.material) face.material.dispose();
}

function allMeshes() {
  const out = [];
  for (const s of seatGroups) out.push(...s.meshes);
  return out;
}

function findMesh(cardId) {
  return allMeshes().find((m) => m.userData.cardId === cardId) || null;
}

function syncMeshes(list, cards, parent) {
  const byId = new Map(list.map((m) => [m.userData.cardId, m]));
  const next = [];
  for (const card of cards) {
    let mesh = byId.get(card.id);
    if (mesh) {
      byId.delete(card.id);
    } else {
      mesh = createCardMesh();
      parent.add(mesh);
    }
    if (mesh.parent !== parent) parent.add(mesh);
    mesh.userData.cardId = card.id;
    mesh.userData.rank = card.rank;
    mesh.userData.suit = card.suit;
    next.push(mesh);
  }
  for (const leftover of byId.values()) disposeMesh(leftover);
  list.length = 0;
  list.push(...next);
}

function applyCardLook(root, card, { flipping = false } = {}) {
  const faceUp = Boolean(card.faceUp) && !flipping;
  root.userData.faceUp = faceUp;
  root.visible = true;
  if (flipping || flips.has(card.id) || fades.has(card.id) || alarms.has(card.id)) return;
  const { face, back, pivot } = root.userData;
  if (card.rank && card.suit) face.material.map = getCardFaceTexture(card.rank, card.suit);
  back.material.map = getCardBackTexture();
  face.material.color.set(0xffffff);
  back.material.color.set(0xffffff);
  face.material.opacity = 1;
  back.material.opacity = 1;
  face.material.needsUpdate = true;
  back.material.needsUpdate = true;
  pivot.rotation.x = 0;
  pivot.rotation.y = faceUp ? Math.PI : 0;
}

function createEasel() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: WOOD, roughness: 0.82, metalness: 0.04 });
  const woodDark = new THREE.MeshStandardMaterial({ color: WOOD_DARK, roughness: 0.88, metalness: 0.04 });
  const width = EASEL_WIDTH;

  for (const x of [-width / 2 + 0.1, width / 2 - 0.1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.18), woodDark);
    leg.position.set(x, 0.09, 0);
    g.add(leg);
  }

  const shelf = new THREE.Mesh(new THREE.BoxGeometry(width, 0.05, 0.2), wood);
  shelf.position.set(0, 0.175, 0.02);
  g.add(shelf);

  const lip = new THREE.Mesh(new THREE.BoxGeometry(width, 0.08, 0.035), wood);
  lip.position.set(0, 0.215, 0.11);
  g.add(lip);

  const rest = new THREE.Mesh(new THREE.BoxGeometry(width, 0.16, 0.035), wood);
  rest.position.set(0, 0.28, -0.05);
  rest.rotation.x = -0.35;
  g.add(rest);
  return g;
}

function createTable() {
  const group = new THREE.Group();
  const rimMat = new THREE.MeshStandardMaterial({
    color: WOOD,
    roughness: 0.7,
    metalness: 0.05,
    side: THREE.DoubleSide
  });
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, TABLE_THICKNESS, 64, 1, true),
    rimMat
  );
  group.add(rim);

  const felt = new THREE.Mesh(
    new THREE.CircleGeometry(TABLE_RADIUS, 96),
    new THREE.MeshStandardMaterial({ color: FELT_600, roughness: 0.9, metalness: 0 })
  );
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = TABLE_TOP + 0.002;
  group.add(felt);

  const inlay = new THREE.Mesh(
    new THREE.RingGeometry(TABLE_RADIUS * 0.22, TABLE_RADIUS * 0.26, 48),
    new THREE.MeshStandardMaterial({ color: BRASS, roughness: 0.45, metalness: 0.35 })
  );
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = TABLE_TOP + 0.004;
  group.add(inlay);
  return group;
}

function layoutEaselCards(meshes, cards) {
  const n = meshes.length;
  if (n === 0) return;
  const pickable = cards.some((c) => c.pickable);
  const cardW = CARD_ASPECT * CARD_SCALE;
  const maxSpread = pickable ? 3.2 : EASEL_WIDTH - 0.2;
  const spacing = n <= 1 ? 0 : Math.min(cardW * 0.92, maxSpread / Math.max(n - 1, 1));
  const shelfY = 0.2;
  meshes.forEach((mesh, i) => {
    const x = (i - (n - 1) / 2) * spacing;
    const lifted = cards[i]?.lifted ? 0.14 : 0;
    const y = shelfY + 0.5 * CARD_SCALE + lifted;
    mesh.position.z = 0.04;
    if (!alarms.has(mesh.userData.cardId)) {
      mesh.position.x = x;
      mesh.rotation.z = 0;
    }
    if (!flips.has(mesh.userData.cardId) && !fades.has(mesh.userData.cardId) && !alarms.has(mesh.userData.cardId)) {
      mesh.position.y = y;
    }
    if (!alarms.has(mesh.userData.cardId) && !fades.has(mesh.userData.cardId)) mesh.scale.setScalar(CARD_SCALE);
    mesh.rotation.x = CARD_TILT;
    mesh.renderOrder = 20 + i;
    const { back, face } = mesh.userData;
    if (back) back.renderOrder = 20 + i;
    if (face) face.renderOrder = 20 + i;
  });
}

function placeSeats(total, seatsMeta, spectator = false) {
  for (let i = 0; i < seatGroups.length; i++) {
    const theta = -i * ((Math.PI * 2) / total);
    const seat = seatGroups[i];
    const meta = seatsMeta[i] || {};
    const radius = !spectator && meta.isTarget && i !== 0 ? TARGET_EASEL_RADIUS : EASEL_RADIUS;
    seat.group.position.set(Math.sin(theta) * radius, TABLE_TOP, Math.cos(theta) * radius);
    const faceOutward = spectator || i === 0;
    seat.group.rotation.set(0, faceOutward ? theta : theta + Math.PI, 0);
  }
}

function neighborSpacing() {
  return (Math.PI * 2) / Math.max(lastSeatCount, 2);
}

/** Demi-angle (rad) sous lequel on voit la FACE d'un chevalet (normale vers l'extérieur). */
function facePeekHalf() {
  const horiz = Math.abs(Math.cos(orbitPitch) * orbitDistance);
  if (horiz <= EASEL_RADIUS + 0.08) return 0;
  return Math.acos(Math.min(0.999, EASEL_RADIUS / horiz));
}

function refreshPlayerYawLimit(seatCount) {
  if (Number.isFinite(seatCount) && seatCount >= 2) lastSeatCount = seatCount;
  const spacing = neighborSpacing();
  const peek = facePeekHalf();
  const easelHalf = Math.atan(EASEL_WIDTH / 2 / EASEL_RADIUS);
  // Plus il y a de joueurs, plus le voisin est proche : on reste devant
  // son chevalet, hors du cône qui montre ses cartes.
  orbitYawLimit = Math.max(0.06, spacing - peek - easelHalf * 0.35);
  clampOrbitYaw();
}

function clampOrbitYaw() {
  if (!orbitYawLimited) return;
  if (orbitYaw > orbitYawLimit) orbitYaw = orbitYawLimit;
  else if (orbitYaw < -orbitYawLimit) orbitYaw = -orbitYawLimit;
}

export function setOrbitYawLimited(limited) {
  const next = Boolean(limited);
  if (next && !orbitYawLimited) {
    orbitYaw = 0;
    orbitPitch = BASE_ELEV;
  }
  orbitYawLimited = next;
  clampOrbitYaw();
  if (mounted) applyOrbitCamera();
}

function ensureSeats(count) {
  while (seatGroups.length > count) {
    const seat = seatGroups.pop();
    seat.meshes.forEach(disposeMesh);
    scene.remove(seat.group);
  }
  while (seatGroups.length < count) {
    const group = new THREE.Group();
    const easel = createEasel();
    group.add(easel);
    scene.add(group);
    seatGroups.push({ group, easel, meshes: [] });
  }
  myHandMeshes = seatGroups[0] ? seatGroups[0].meshes : [];
  opponentGroups = seatGroups.slice(1).map((s) => ({ meshes: s.meshes }));
}

function applyOrbitCamera() {
  if (!camera) return;
  _look.set(0, 0.08, 0);
  const horiz = Math.cos(orbitPitch) * orbitDistance;
  camera.position.set(
    _look.x + Math.sin(orbitYaw) * horiz,
    _look.y + Math.sin(orbitPitch) * orbitDistance,
    _look.z + Math.cos(orbitYaw) * horiz
  );
  camera.lookAt(_look);
}

function maxOrbitDistance() {
  return Math.max(fittedDistance, BASE_DIST) * DIST_MAX_FACTOR;
}

function computeFittedDistance() {
  if (!camera) return BASE_DIST;
  const halfVFov = (CAMERA_FOV * Math.PI) / 360;
  const halfHFov = Math.atan(Math.tan(halfVFov) * Math.max(camera.aspect, 0.05));
  const margin = TABLE_RADIUS + 0.5;
  const byWidth = margin / Math.tan(halfHFov);
  const byHeight = margin / Math.tan(halfVFov);
  return Math.max(BASE_DIST, byWidth, byHeight);
}

function fitCamera() {
  if (!camera) return;
  fittedDistance = computeFittedDistance();
  if (!userZoomed) orbitDistance = fittedDistance;
  else orbitDistance = Math.max(DIST_MIN, Math.min(maxOrbitDistance(), orbitDistance));
  applyOrbitCamera();
}

export function orbitCameraByScreenDelta(dx, dy) {
  if (!mounted) return;
  orbitPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, orbitPitch + dy * 0.006));
  orbitYaw -= dx * 0.008;
  if (orbitYawLimited) {
    refreshPlayerYawLimit();
  } else if (orbitYaw > Math.PI) {
    orbitYaw -= Math.PI * 2;
  } else if (orbitYaw < -Math.PI) {
    orbitYaw += Math.PI * 2;
  }
  applyOrbitCamera();
}

export function zoomCameraByFactor(factor) {
  if (!mounted || !Number.isFinite(factor) || factor <= 0) return;
  userZoomed = true;
  orbitDistance = Math.max(DIST_MIN, Math.min(maxOrbitDistance(), orbitDistance / factor));
  if (orbitYawLimited) refreshPlayerYawLimit();
  applyOrbitCamera();
}

export function resetOrbit() {
  orbitYaw = 0;
  orbitPitch = BASE_ELEV;
  userZoomed = false;
  orbitDistance = fittedDistance || BASE_DIST;
  if (orbitYawLimited) refreshPlayerYawLimit();
  else clampOrbitYaw();
  if (mounted) applyOrbitCamera();
}

function easeFlip(t) {
  return t * t * (3 - 2 * t);
}

function advanceFlips(now) {
  for (const [cardId, flip] of flips) {
    const mesh = flip.root || findMesh(cardId);
    const pivot = mesh?.userData?.pivot;
    if (!mesh || !pivot) {
      flips.delete(cardId);
      continue;
    }
    const t = Math.min(1, (now - flip.startTime) / flip.duration);
    const k = easeFlip(t);
    pivot.rotation.y = flip.from + (flip.to - flip.from) * k;
    mesh.position.y = flip.baseY + Math.sin(t * Math.PI) * flip.lift;
    if (t >= 1) {
      pivot.rotation.y = flip.to;
      mesh.position.y = flip.baseY;
      mesh.userData.faceUp = true;
      flips.delete(cardId);
    }
  }
}

function advanceFades(now) {
  for (const [cardId, fade] of fades) {
    const mesh = fade.root || findMesh(cardId);
    if (!mesh) {
      fades.delete(cardId);
      continue;
    }
    const t = Math.min(1, (now - fade.startTime) / fade.duration);
    const { back, face } = mesh.userData;
    if (fade.kind === 'fadeOut') {
      const s = Math.max(0.02, 1 - t);
      mesh.scale.setScalar(CARD_SCALE * s);
      if (back) back.material.opacity = 1 - t;
      if (face) face.material.opacity = 1 - t;
    } else {
      mesh.position.y = fade.startY - fade.distance * t;
      if (back) back.material.opacity = 1 - t;
      if (face) face.material.opacity = 1 - t;
    }
    if (t >= 1) {
      mesh.visible = false;
      fades.delete(cardId);
    }
  }
}

function advanceAlarms(now) {
  for (const [cardId, alarm] of alarms) {
    const mesh = alarm.root || findMesh(cardId);
    if (!mesh) {
      alarms.delete(cardId);
      continue;
    }
    const t = Math.min(1, (now - alarm.startTime) / alarm.duration);
    const decay = 1 - t;
    const wiggle = Math.sin(t * Math.PI * 14);
    mesh.position.x = alarm.baseX + wiggle * 0.07 * decay;
    mesh.rotation.z = alarm.baseRotZ + wiggle * 0.22 * decay;
    mesh.position.y = alarm.baseY + 0.08 + Math.sin(t * Math.PI) * 0.16;
    mesh.scale.setScalar(CARD_SCALE * (1 + 0.12 * Math.sin(t * Math.PI)));
    const pulse = 0.45 + 0.55 * Math.abs(Math.sin(t * Math.PI * 5));
    const { face, back } = mesh.userData;
    if (face) face.material.emissive.setRGB(0.7 * pulse, 0.04 * pulse, 0.04 * pulse);
    if (back) back.material.emissive.setRGB(0.45 * pulse, 0.02 * pulse, 0.02 * pulse);
    if (t >= 1) {
      mesh.position.x = alarm.baseX;
      mesh.position.y = alarm.baseY;
      mesh.rotation.z = alarm.baseRotZ;
      mesh.scale.setScalar(CARD_SCALE);
      if (face) face.material.emissive.set(0x000000);
      if (back) back.material.emissive.set(0x000000);
      alarms.delete(cardId);
    }
  }
}

function ensureScene() {
  if (mounted && canvas && canvas.isConnected) return;
  mounted = true;
  if (animationHandle) cancelAnimationFrame(animationHandle);
  animationHandle = null;
  seatGroups = [];
  myHandMeshes = [];
  opponentGroups = [];
  tableGroup = null;
  document.querySelectorAll('#pouilleux-3d-canvas, [id^="pouilleux-3d-canvas-"]').forEach((el) => el.remove());

  canvas = document.createElement('canvas');
  canvas.id = 'pouilleux-3d-canvas';
  canvas.style.position = 'fixed';
  canvas.style.pointerEvents = 'none';
  canvas.style.display = 'none';
  canvas.style.zIndex = '5';
  document.body.appendChild(canvas);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 80);

  scene.add(new THREE.HemisphereLight(0xe8f0ea, 0x1a120c, 0.55));
  scene.add(new THREE.AmbientLight(0xffffff, 0.28));
  const key = new THREE.DirectionalLight(0xfff6e8, 0.75);
  key.position.set(2.2, 7, 4.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb7c9c0, 0.28);
  fill.position.set(-3, 3, -2);
  scene.add(fill);

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  tableGroup = createTable();
  scene.add(tableGroup);

  const tick = () => {
    animationHandle = requestAnimationFrame(tick);
    const now = performance.now();
    advanceFlips(now);
    advanceFades(now);
    advanceAlarms(now);
    renderer.render(scene, camera);
  };
  tick();
}

export function mountTable() {
  ensureScene();
}

export function positionTable(rect) {
  if (!mounted || !rect || rect.width <= 0 || rect.height <= 0) return;
  canvas.style.left = `${rect.left}px`;
  canvas.style.top = `${rect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  fitCamera();
}

export function showTable() {
  ensureScene();
  if (canvas) canvas.style.display = 'block';
}

export function hideTable() {
  if (canvas) canvas.style.display = 'none';
  document.querySelectorAll('#pouilleux-3d-canvas, [id^="pouilleux-3d-canvas-"]').forEach((el) => {
    el.style.display = 'none';
  });
}

export function hideAllFans() {
  hideTable();
}

export function updateTable({ myHand = [], opponents = [], spectator = false, myIsTarget = false } = {}) {
  if (!mounted) return;

  setOrbitYawLimited(!spectator);

  const fillSeat = (seat, cards) => {
    if (!seat) return;
    syncMeshes(seat.meshes, cards, seat.group);
    seat.meshes.forEach((mesh, j) => applyCardLook(mesh, cards[j], { flipping: flips.has(cards[j].id) }));
    layoutEaselCards(seat.meshes, cards);
  };

  if (spectator) {
    const total = opponents.length;
    ensureSeats(total);
    placeSeats(
      total,
      opponents.map((p) => ({ isTurn: p.isTurn, isTarget: p.isTarget })),
      true
    );
    fitCamera();
    opponents.forEach((p, i) => fillSeat(seatGroups[i], p.hand || []));
    myHandMeshes = [];
    opponentGroups = seatGroups.map((s) => ({ meshes: s.meshes }));
    return;
  }

  const total = 1 + opponents.length;
  ensureSeats(total);
  const seatsMeta = [{ isTurn: false, isTarget: Boolean(myIsTarget) }, ...opponents.map((o) => ({ isTurn: o.isTurn, isTarget: o.isTarget }))];
  placeSeats(total, seatsMeta, false);
  fitCamera();
  refreshPlayerYawLimit(total);

  const meSeat = seatGroups[0];
  fillSeat(meSeat, myHand);
  myHandMeshes = meSeat.meshes;

  opponents.forEach((opp, i) => fillSeat(seatGroups[i + 1], opp.hand || []));
  opponentGroups = seatGroups.slice(1).map((s) => ({ meshes: s.meshes }));
}

export function flipCard(cardId, card, { duration = 700 } = {}) {
  const mesh = findMesh(cardId);
  const pivot = mesh?.userData?.pivot;
  if (!mesh || !pivot) return;
  if (card?.rank && card?.suit) {
    mesh.userData.face.material.map = getCardFaceTexture(card.rank, card.suit);
    mesh.userData.face.material.needsUpdate = true;
  }
  flips.set(cardId, {
    root: mesh,
    startTime: performance.now(),
    duration,
    from: 0,
    to: Math.PI,
    baseY: mesh.position.y,
    lift: 0.1
  });
}

export function fadeOutCard(cardId, { duration = 400 } = {}) {
  const mesh = findMesh(cardId);
  if (!mesh) return;
  fades.set(cardId, { kind: 'fadeOut', root: mesh, startTime: performance.now(), duration });
}

export function descendCard(cardId, { duration = 450, distance = 0.55 } = {}) {
  const mesh = findMesh(cardId);
  if (!mesh) return;
  fades.set(cardId, {
    kind: 'descend',
    root: mesh,
    startTime: performance.now(),
    duration,
    distance,
    startY: mesh.position.y
  });
}

/** Équivalent 3D de `.draw-reveal--danger` : la carte tremble, s'élève et pulse en rouge. */
export function alarmCard(cardId, { duration = 1200 } = {}) {
  const mesh = findMesh(cardId);
  if (!mesh) return;
  fades.delete(cardId);
  alarms.set(cardId, {
    root: mesh,
    startTime: performance.now(),
    duration,
    baseX: mesh.position.x,
    baseY: mesh.position.y,
    baseRotZ: mesh.rotation.z
  });
}

function projectMeshes(meshes) {
  if (!mounted) return [];
  camera.updateMatrixWorld();
  const w = parseFloat(canvas.style.width) || canvas.clientWidth || 1;
  const h = parseFloat(canvas.style.height) || canvas.clientHeight || 1;
  const halfW = CARD_ASPECT / 2;
  const halfH = 0.5;
  const corner = new THREE.Vector3();

  return meshes.map((mesh) => {
    const plane = mesh.userData?.back || mesh;
    plane.updateMatrixWorld();
    mesh.updateMatrixWorld();
    const xs = [];
    const ys = [];
    for (const [cx, cy] of [
      [-halfW, halfH],
      [halfW, halfH],
      [halfW, -halfH],
      [-halfW, -halfH]
    ]) {
      corner.set(cx, cy, 0).applyMatrix4(plane.matrixWorld).project(camera);
      xs.push((corner.x * 0.5 + 0.5) * w);
      ys.push((-corner.y * 0.5 + 0.5) * h);
    }
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return {
      id: mesh.userData.cardId,
      left,
      top,
      width: Math.max(...xs) - left,
      height: Math.max(...ys) - top
    };
  });
}

export function getCardRects() {
  return {
    mine: projectMeshes(myHandMeshes.filter((m) => m.visible)),
    opponents: opponentGroups.map((g) => projectMeshes(g.meshes.filter((m) => m.visible))),
    seats: seatGroups.map((s) => projectMeshes(s.meshes.filter((m) => m.visible)))
  };
}

export function getRowLabelAnchors() {
  if (!mounted) return { mine: null, opponents: [], seats: [] };
  camera.updateMatrixWorld();
  const w = parseFloat(canvas.style.width) || canvas.clientWidth || 1;
  const h = parseFloat(canvas.style.height) || canvas.clientHeight || 1;

  const fromGroup = (group) => {
    if (!group) return null;
    group.updateMatrixWorld();
    _world.set(0, 0.88, -0.08).applyMatrix4(group.matrixWorld).project(camera);
    return { left: (_world.x * 0.5 + 0.5) * w, top: (-_world.y * 0.5 + 0.5) * h };
  };

  return {
    mine: fromGroup(seatGroups[0]?.group),
    opponents: seatGroups.slice(1).map((s) => fromGroup(s.group)),
    seats: seatGroups.map((s) => fromGroup(s.group))
  };
}
