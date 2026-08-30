import * as THREE from 'three';
import { gameCardImage, cardBackImage } from '../ui/cardThemes.js';
import tableArtUrl from '../assets/games/trio/fondtrio.png';

/**
 * Scène 3D persistante pour Trio — table ronde, un chevalet par joueur
 * disposé en cercle, cartes communes étalées à plat au centre.
 *
 * Contrairement au Pouilleux/Uno (caméra face à l'écran, profondeur
 * simulée par le Z des éventails), Trio a besoin d'une VRAIE table vue
 * un peu en plongée : chaque main est un rack physique devant son joueur,
 * et le centre est un tas commun, pas un éventail. La leçon "pas de
 * caméra inclinée" du Pouilleux visait les éventails (une rotation.z
 * changeait la taille projetée) — ici les cartes d'un même chevalet
 * partagent la même pose, la perspective entre sièges est voulue.
 *
 * Siège 0 = le joueur local, toujours au plus près de la caméra (+Z).
 * Les suivants tournent dans le sens des aiguilles (même ordre que
 * orderedOpponents). Les trios gagnés sont posés face visible devant
 * chaque chevalet. Le retournement est une vraie rotation 180° du pivot.
 * Orbite : yaw borné pour un joueur assis (les faces adverses regardent
 * vers l'extérieur — tourner derrière = triche) ; 360° en spectateur.
 *
 * Montée UNE SEULE FOIS, hors de `#app`. Clics = boutons DOM superposés
 * (getCardRects), pas de raycasting.
 */

const CARD_ASPECT = 240 / 360;
const CAMERA_FOV = 46;

const TABLE_RADIUS = 2.55;
const TABLE_THICKNESS = 0.14;
const TABLE_TOP = TABLE_THICKNESS / 2;
const EASEL_RADIUS = 2.12;
const EASEL_WIDTH = 2.32;
const CARD_SCALE = 0.48;
const CENTER_SCALE = 0.4;
const TRIO_SCALE = 0.28;
const CARD_TILT = -0.28;
const CARD_GEO = new THREE.PlaneGeometry(CARD_ASPECT, 1);

const FELT_600 = '#1F4D3A';
const FELT_900 = '#0F2E21';
const BRASS = '#C9A227';
const BRASS_SOFT = '#E4C765';
const CREAM = '#F7F1E1';
const INK = '#3A2E0A';
const WOOD = '#6B4423';
const WOOD_DARK = '#4A2E18';

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
    document.querySelectorAll('#trio-3d-canvas').forEach((el) => el.remove());
    mounted = false;
    canvas = null;
  });
}

let tableGroup = null;
let feltMaterial = null;
let seatGroups = []; // [{ group, easel, meshes, trioMeshes, highlight }]
let myRowMeshes = [];
let opponentGroups = []; // [{ meshes }]
let centerMeshes = [];

const flips = new Map();

let cardBackTexture = null;
let cardBackTheme = null;
const faceTextures = new Map();
const textureLoader = new THREE.TextureLoader();

const _world = new THREE.Vector3();
const _look = new THREE.Vector3();

const BASE_ELEV = 1.02;
const BASE_DIST = 5.35;
const PITCH_MIN = 0.38;
const PITCH_MAX = 1.28;
// Les faces adverses regardent vers l'extérieur (yaw ≈ theta du voisin =
// on lit leur jeu). On reste en deçà de l'espacement entre sièges.
const PLAYER_YAW_PAD = 0.85;
const PLAYER_YAW_MIN = 0.38;
const PLAYER_YAW_MAX = 0.95;
let orbitYaw = 0;
let orbitPitch = BASE_ELEV;
let orbitDistance = BASE_DIST;
let orbitYawLimited = true;
let orbitYawLimit = 0.7;

function currentTheme() {
  return document.documentElement.dataset.cardTheme || 'classique';
}

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

function buildNumberFaceTexture(value) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size / CARD_ASPECT);
  const ctx = c.getContext('2d');

  const g = ctx.createRadialGradient(c.width * 0.3, c.height * 0.3, 8, c.width * 0.5, c.height * 0.5, c.width * 0.8);
  g.addColorStop(0, '#FDF6E3');
  g.addColorStop(1, '#E4C765');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 8;
  ctx.strokeRect(4, 4, c.width - 8, c.height - 8);

  ctx.fillStyle = INK;
  ctx.font = `700 ${Math.round(c.width * 0.42)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), c.width / 2, c.height / 2 + 4);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getCardBackTexture() {
  const theme = currentTheme();
  if (cardBackTexture && cardBackTheme === theme) return cardBackTexture;
  cardBackTheme = theme;
  const url = cardBackImage(theme);
  if (!url) {
    cardBackTexture = buildCardBackTexture();
    return cardBackTexture;
  }
  cardBackTexture = buildCardBackTexture();
  textureLoader.load(url, (tex) => {
    if (cardBackTheme !== theme) return;
    tex.colorSpace = THREE.SRGBColorSpace;
    cardBackTexture = tex;
    for (const mesh of allMeshes()) {
      if (!mesh.userData.faceUp && !flips.has(mesh.userData.cardId) && mesh.userData.back) {
        mesh.userData.back.material.map = tex;
        mesh.userData.back.material.needsUpdate = true;
      }
    }
  });
  return cardBackTexture;
}

function getCardFaceTexture(value) {
  const theme = currentTheme();
  const key = `${theme}:${value}`;
  const cached = faceTextures.get(key);
  if (cached) return cached;

  const fallback = buildNumberFaceTexture(value);
  faceTextures.set(key, fallback);
  const url = gameCardImage(theme, 'numbers', String(value), value);
  if (url) {
    textureLoader.load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      faceTextures.set(key, tex);
      for (const mesh of allMeshes()) {
        if (mesh.userData.value === value && mesh.userData.faceUp && !flips.has(mesh.userData.cardId)) {
          const face = mesh.userData.face;
          if (face) {
            face.material.map = tex;
            face.material.needsUpdate = true;
          }
        }
      }
    });
  }
  return fallback;
}

const HIGHLIGHT_GEO = new THREE.EdgesGeometry(new THREE.PlaneGeometry(CARD_ASPECT + 0.04, 1.04));

function createHighlightFrame() {
  const material = new THREE.LineBasicMaterial({
    color: BRASS_SOFT,
    transparent: true,
    opacity: 0.95
  });
  const lines = new THREE.LineSegments(HIGHLIGHT_GEO, material);
  lines.position.z = 0.004;
  lines.visible = false;
  return lines;
}

function makeCardMaterial() {
  return new THREE.MeshStandardMaterial({
    roughness: 0.55,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    depthWrite: true
  });
}

/**
 * Carte à deux faces (dos + face) autour d'un pivot Y — un vrai retournement
 * 180° sans pincement ni texture miroir. `pivot.rotation.y = 0` → dos vers
 * +Z local ; `Math.PI` → face vers +Z.
 */
function createCardMesh() {
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  const back = new THREE.Mesh(CARD_GEO, makeCardMaterial());
  const face = new THREE.Mesh(CARD_GEO, makeCardMaterial());
  face.rotation.y = Math.PI;
  back.position.z = 0.0015;
  face.position.z = -0.0015;
  const frame = createHighlightFrame();
  pivot.add(back);
  pivot.add(face);
  pivot.add(frame);
  root.add(pivot);
  root.userData.pivot = pivot;
  root.userData.back = back;
  root.userData.face = face;
  root.userData.frame = frame;
  return root;
}

function disposeMesh(root) {
  if (!root) return;
  flips.delete(root.userData.cardId);
  root.parent?.remove(root);
  const { back, face, frame } = root.userData;
  if (back?.material) back.material.dispose();
  if (face?.material) face.material.dispose();
  if (frame?.material) frame.material.dispose();
}

function allMeshes() {
  const out = [...centerMeshes];
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
    mesh.userData.value = card.value;
    next.push(mesh);
  }
  for (const leftover of byId.values()) disposeMesh(leftover);
  list.length = 0;
  list.push(...next);
}

function applyCardLook(root, card, { flipping = false } = {}) {
  const faceUp = Boolean(card.faceUp) && !flipping && !card.taken;
  root.userData.faceUp = faceUp;
  root.userData.flat = Boolean(card.flat);
  root.visible = !card.taken;
  if (!root.visible || flipping || flips.has(card.id)) return;
  const { face, back, pivot, frame } = root.userData;
  face.material.map = getCardFaceTexture(card.value);
  back.material.map = getCardBackTexture();
  const tint = card.pickable || card.pickableEnd ? 0xffffff : 0xf4f4f4;
  face.material.color.set(tint);
  back.material.color.set(tint);
  face.material.needsUpdate = true;
  back.material.needsUpdate = true;
  pivot.rotation.x = 0;
  pivot.rotation.y = faceUp ? Math.PI : 0;
  // Halo seulement sur les cartes encore cachées (centre / extrémités
  // adverses). Sur sa propre main face visible, le rectangle doré plein
  // recouvrait l'illustration.
  if (frame) frame.visible = Boolean((card.pickable || card.pickableEnd) && !faceUp);
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

  // Petite barre de dossier : assez basse pour ne pas masquer les cartes
  // des sièges latéraux vus en plongée.
  const rest = new THREE.Mesh(new THREE.BoxGeometry(width, 0.16, 0.035), wood);
  rest.position.set(0, 0.28, -0.05);
  rest.rotation.x = -0.35;
  g.add(rest);

  const highlight = new THREE.Mesh(
    new THREE.BoxGeometry(width + 0.06, 0.025, 0.22),
    new THREE.MeshStandardMaterial({
      color: BRASS,
      emissive: BRASS,
      emissiveIntensity: 0.45,
      roughness: 0.35,
      metalness: 0.4
    })
  );
  highlight.position.set(0, 0.145, 0.02);
  highlight.visible = false;
  g.add(highlight);
  g.userData.highlight = highlight;
  return g;
}

function isWhitePx(r, g, b) {
  return r > 242 && g > 242 && b > 242;
}

function isBurgundyPx(r, g, b) {
  return r > 90 && r > g * 1.25 && r > b * 1.15 && g < 110;
}

function radiusAlongRay(px, w, h, cx, cy, angle) {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  const max = Math.hypot(w, h);
  let lastSolid = 0;
  for (let t = 0; t < max; t++) {
    const x = Math.round(cx + dx * t);
    const y = Math.round(cy + dy * t);
    if (x < 0 || y < 0 || x >= w || y >= h) break;
    const i = (y * w + x) * 4;
    if (isWhitePx(px[i], px[i + 1], px[i + 2])) break;
    lastSolid = t;
  }
  return lastSolid;
}

function loadTableArtTexture() {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.width;
      const h = img.height;
      const src = document.createElement('canvas');
      src.width = w;
      src.height = h;
      const sctx = src.getContext('2d');
      sctx.drawImage(img, 0, 0);
      const px = sctx.getImageData(0, 0, w, h).data;
      const cx = w / 2;
      const cy = h / 2;
      const rays = [];
      for (let a = 0; a < 32; a++) rays.push(radiusAlongRay(px, w, h, cx, cy, (a * Math.PI) / 16));
      rays.sort((a, b) => a - b);
      const outerR = rays[Math.floor(rays.length / 2)];
      let rimR = 0;
      let rimG = 0;
      let rimB = 0;
      let rimN = 0;
      for (let a = 0; a < 32; a++) {
        const ang = (a * Math.PI) / 16;
        const x = Math.round(cx + Math.cos(ang) * outerR * 0.97);
        const y = Math.round(cy + Math.sin(ang) * outerR * 0.97);
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = (y * w + x) * 4;
        rimR += px[i];
        rimG += px[i + 1];
        rimB += px[i + 2];
        rimN += 1;
      }
      const rimColor = rimN
        ? (Math.round(rimR / rimN) << 16) | (Math.round(rimG / rimN) << 8) | Math.round(rimB / rimN)
        : 0x8a1d32;
      const size = 1024;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.fillStyle = `#${rimColor.toString(16).padStart(6, '0')}`;
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, cx - outerR, cy - outerR, outerR * 2, outerR * 2, 0, 0, size, size);
      const texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      resolve({ texture, rimColor });
    };
    img.src = tableArtUrl;
  });
}

function createTable() {
  const group = new THREE.Group();
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x8a1d32, roughness: 0.7, metalness: 0.05 });
  // openEnded : sans ça le capuchon du cylindre dessine un énorme disque
  // bordeaux autour du PNG (le « gap » vu à l'écran).
  rimMat.side = THREE.DoubleSide;
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, TABLE_THICKNESS, 64, 1, true),
    rimMat
  );
  group.add(rim);

  feltMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0
  });
  const felt = new THREE.Mesh(new THREE.CircleGeometry(TABLE_RADIUS, 96), feltMaterial);
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = TABLE_TOP + 0.002;
  group.add(felt);

  loadTableArtTexture().then(({ texture, rimColor }) => {
    if (!feltMaterial) return;
    feltMaterial.map = texture;
    feltMaterial.needsUpdate = true;
    rimMat.color.setHex(rimColor);
  });

  return group;
}

function layoutEaselCards(meshes, cards) {
  const n = meshes.length;
  if (n === 0) return;
  const cardW = CARD_ASPECT * CARD_SCALE;
  const spacing = n <= 1 ? 0 : Math.min(cardW * 0.92, (EASEL_WIDTH - 0.2) / Math.max(n - 1, 1));
  const shelfY = 0.2;
  meshes.forEach((mesh, i) => {
    const x = (i - (n - 1) / 2) * spacing;
    const lifted = cards[i]?.lifted ? 0.14 : 0;
    const y = shelfY + 0.5 * CARD_SCALE + lifted;
    mesh.position.x = x;
    mesh.position.z = 0.04;
    if (!flips.has(mesh.userData.cardId)) mesh.position.y = y;
    mesh.scale.setScalar(CARD_SCALE);
    mesh.rotation.x = CARD_TILT;
    mesh.rotation.z = 0;
    mesh.renderOrder = 20 + i;
    const { back, face } = mesh.userData;
    if (back) back.renderOrder = 20 + i;
    if (face) face.renderOrder = 20 + i;
  });
}

function layoutCenterOnTable(meshes, cards) {
  const n = meshes.length;
  if (n === 0) return;
  const cols = n <= 3 ? n : n <= 4 ? 2 : n <= 6 ? 3 : n <= 8 ? 4 : 3;
  const rows = Math.ceil(n / cols);
  const cardW = CARD_ASPECT * CENTER_SCALE;
  const cardH = CENTER_SCALE;
  const spacingX = cardW * 1.38;
  const spacingZ = cardH * 1.28;
  meshes.forEach((mesh, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col - (cols - 1) / 2) * spacingX;
    const z = (row - (rows - 1) / 2) * spacingZ;
    if (!flips.has(mesh.userData.cardId)) mesh.position.set(x, TABLE_TOP + 0.012, z);
    else {
      mesh.position.x = x;
      mesh.position.z = z;
    }
    mesh.scale.setScalar(CENTER_SCALE);
    mesh.rotation.set(-Math.PI / 2, 0, 0);
    mesh.renderOrder = 5 + i;
    const { back, face } = mesh.userData;
    if (back) back.renderOrder = 5 + i;
    if (face) face.renderOrder = 5 + i;
  });
}

/** Trois cartes face visible, chevauchement 90 %, posées sur la table devant le chevalet. */
function layoutWonTrios(seat, trioValues, seatIndex, faceOutward = seatIndex === 0) {
  const cards = [];
  trioValues.forEach((value, ti) => {
    for (let k = 0; k < 3; k++) {
      cards.push({ id: `won-${seatIndex}-${ti}-${k}`, value, faceUp: true, flat: true });
    }
  });
  if (!seat.trioMeshes) seat.trioMeshes = [];
  syncMeshes(seat.trioMeshes, cards, seat.group);
  const scale = TRIO_SCALE;
  const cardW = CARD_ASPECT * scale;
  const step = cardW * 0.1;
  const stackGap = cardW * 1.45;
  const inward = faceOutward ? -0.5 : 0.5;
  trioValues.forEach((value, ti) => {
    const stackX = (ti - (trioValues.length - 1) / 2) * stackGap;
    for (let k = 0; k < 3; k++) {
      const mesh = seat.trioMeshes[ti * 3 + k];
      applyCardLook(mesh, { id: mesh.userData.cardId, value, faceUp: true, flat: true });
      mesh.position.set(stackX + k * step, 0.012 + k * 0.004, inward);
      mesh.scale.setScalar(scale);
      mesh.rotation.set(-Math.PI / 2, 0, 0);
      mesh.renderOrder = 8 + ti * 3 + k;
    }
  });
}

function placeSeats(total, myIsTurn, opponents, spectator = false) {
  for (let i = 0; i < seatGroups.length; i++) {
    const theta = -i * ((Math.PI * 2) / total);
    const seat = seatGroups[i];
    seat.group.position.set(Math.sin(theta) * EASEL_RADIUS, TABLE_TOP, Math.cos(theta) * EASEL_RADIUS);
    // Local +Z = vers le joueur (extérieur). En vue joueur, les chevalets
    // adverses sont retournés (cartes vers le centre) pour rester lisibles
    // en plongée depuis notre siège — sinon on les verrait par la tranche.
    // En spectateur, chaque chevalet fait face à son joueur : on peut
    // tourner derrière pour lire les cartes.
    const faceOutward = spectator || i === 0;
    seat.group.rotation.set(0, faceOutward ? theta : theta + Math.PI, 0);
    const isTurn = spectator
      ? Boolean(opponents[i]?.isTurn)
      : i === 0
        ? myIsTurn
        : Boolean(opponents[i - 1]?.isTurn);
    if (seat.highlight) seat.highlight.visible = isTurn && (spectator || i !== 0);
  }
}

function refreshPlayerYawLimit(seatCount) {
  const spacing = (Math.PI * 2) / Math.max(seatCount, 2);
  orbitYawLimit = Math.min(PLAYER_YAW_MAX, Math.max(PLAYER_YAW_MIN, spacing - PLAYER_YAW_PAD));
}

function clampOrbitYaw() {
  if (!orbitYawLimited) return;
  if (orbitYaw > orbitYawLimit) orbitYaw = orbitYawLimit;
  else if (orbitYaw < -orbitYawLimit) orbitYaw = -orbitYawLimit;
}

/** `true` (joueur assis) : yaw borné. `false` (spectateur) : 360°. */
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
    (seat.trioMeshes || []).forEach(disposeMesh);
    scene.remove(seat.group);
  }
  while (seatGroups.length < count) {
    const group = new THREE.Group();
    const easel = createEasel();
    group.add(easel);
    scene.add(group);
    seatGroups.push({ group, easel, meshes: [], trioMeshes: [], highlight: easel.userData.highlight });
  }
  myRowMeshes = seatGroups[0] ? seatGroups[0].meshes : [];
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

function fitCamera() {
  if (!camera) return;
  orbitDistance = BASE_DIST;
  applyOrbitCamera();
  const halfVFov = (CAMERA_FOV * Math.PI) / 360;
  const halfHFov = Math.atan(Math.tan(halfVFov) * camera.aspect);
  const margin = TABLE_RADIUS + 0.5;
  const offset = camera.position.clone().sub(_look);
  const visibleHalfW = offset.length() * Math.tan(halfHFov);
  if (visibleHalfW < margin && visibleHalfW > 0) {
    orbitDistance = offset.length() * (margin / visibleHalfW);
    applyOrbitCamera();
  }
}

/** Glisser pour tourner autour de la table (yaw) et incliner (pitch). */
export function orbitCameraByScreenDelta(dx, dy) {
  if (!mounted) return;
  orbitYaw -= dx * 0.008;
  if (orbitYawLimited) {
    clampOrbitYaw();
  } else if (orbitYaw > Math.PI) {
    orbitYaw -= Math.PI * 2;
  } else if (orbitYaw < -Math.PI) {
    orbitYaw += Math.PI * 2;
  }
  orbitPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, orbitPitch + dy * 0.006));
  applyOrbitCamera();
}

export function resetOrbit() {
  orbitYaw = 0;
  orbitPitch = BASE_ELEV;
  orbitDistance = BASE_DIST;
  clampOrbitYaw();
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

function ensureScene() {
  if (mounted && canvas && canvas.isConnected) return;
  mounted = true;
  if (animationHandle) cancelAnimationFrame(animationHandle);
  animationHandle = null;
  seatGroups = [];
  myRowMeshes = [];
  opponentGroups = [];
  centerMeshes = [];
  tableGroup = null;
  feltMaterial = null;
  document.querySelectorAll('#trio-3d-canvas').forEach((el) => el.remove());

  canvas = document.createElement('canvas');
  canvas.id = 'trio-3d-canvas';
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
    advanceFlips(performance.now());
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
  document.querySelectorAll('#trio-3d-canvas').forEach((el) => {
    el.style.display = 'none';
  });
}

/**
 * Reconstruit la table :
 * - `myRow` / `opponents[].row` / `center` : `{ id, value, faceUp, lifted?,
 *    pickable?, pickableEnd?, taken? }`
 * - `opponents[].isTurn` allume le chevalet du joueur actif
 * - `flippingIds` : cartes dont le retournement est en cours
 * - `spectator` : tous les sièges font face à leur joueur, orbite 360°
 */
export function updateTable({
  myRow = [],
  myTrios = [],
  opponents = [],
  center = [],
  flippingIds = new Set(),
  myIsTurn,
  spectator = false
} = {}) {
  if (!mounted) return;

  setOrbitYawLimited(!spectator);

  if (spectator) {
    const total = opponents.length;
    ensureSeats(total);
    placeSeats(total, false, opponents, true);
    fitCamera();
    opponents.forEach((p, i) => {
      const seat = seatGroups[i];
      if (!seat) return;
      syncMeshes(seat.meshes, p.row, seat.group);
      seat.meshes.forEach((mesh, j) => applyCardLook(mesh, p.row[j], { flipping: flippingIds.has(p.row[j].id) }));
      layoutEaselCards(seat.meshes, p.row);
      layoutWonTrios(seat, p.trios || [], i, true);
    });
    myRowMeshes = [];
    opponentGroups = seatGroups.map((s) => ({ meshes: s.meshes }));
  } else {
    const total = 1 + opponents.length;
    refreshPlayerYawLimit(total);
    clampOrbitYaw();
    ensureSeats(total);
    const turnMine = myIsTurn === undefined ? !opponents.some((o) => o.isTurn) : Boolean(myIsTurn);
    placeSeats(total, turnMine, opponents, false);
    fitCamera();

    const meSeat = seatGroups[0];
    syncMeshes(meSeat.meshes, myRow, meSeat.group);
    myRowMeshes = meSeat.meshes;
    meSeat.meshes.forEach((mesh, i) => applyCardLook(mesh, myRow[i], { flipping: flippingIds.has(myRow[i].id) }));
    layoutEaselCards(meSeat.meshes, myRow);
    layoutWonTrios(meSeat, myTrios, 0);

    opponents.forEach((opp, i) => {
      const seat = seatGroups[i + 1];
      if (!seat) return;
      syncMeshes(seat.meshes, opp.row, seat.group);
      seat.meshes.forEach((mesh, j) => applyCardLook(mesh, opp.row[j], { flipping: flippingIds.has(opp.row[j].id) }));
      layoutEaselCards(seat.meshes, opp.row);
      layoutWonTrios(seat, opp.trios || [], i + 1);
    });
    opponentGroups = seatGroups.slice(1).map((s) => ({ meshes: s.meshes }));
  }

  const centerCards = center.map((c) => ({ ...c, flat: true }));
  syncMeshes(centerMeshes, centerCards, scene);
  centerMeshes.forEach((mesh, i) => applyCardLook(mesh, centerCards[i], { flipping: flippingIds.has(centerCards[i].id) }));
  layoutCenterOnTable(centerMeshes, centerCards);
}

export function flipCard(cardId, value, { duration = 820 } = {}) {
  const mesh = findMesh(cardId);
  const pivot = mesh?.userData?.pivot;
  if (!mesh || !pivot) return;
  mesh.userData.face.material.map = getCardFaceTexture(value);
  mesh.userData.face.material.needsUpdate = true;
  const flat = Boolean(mesh.userData.flat);
  flips.set(cardId, {
    root: mesh,
    startTime: performance.now(),
    duration,
    from: 0,
    to: Math.PI,
    baseY: mesh.position.y,
    lift: flat ? 0.14 : 0.08
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
    mine: projectMeshes(myRowMeshes.filter((m) => m.visible)),
    center: projectMeshes(centerMeshes.filter((m) => m.visible)),
    opponents: opponentGroups.map((g) => projectMeshes(g.meshes.filter((m) => m.visible)))
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
