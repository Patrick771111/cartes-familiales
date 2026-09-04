import * as THREE from 'three';
import backUrl from '../assets/games/skyjo/back.png';

const FACE_URLS = import.meta.glob('../assets/games/skyjo/face*.png', { eager: true, import: 'default' });
const FACE_BY_VALUE = {};
for (const [path, url] of Object.entries(FACE_URLS)) {
  const m = path.match(/face-(-?\d+)\.png$/);
  if (m) FACE_BY_VALUE[Number(m[1])] = url;
}

/**
 * Scène 3D Skyjo — même table ronde / orbite que Trio, mais chaque joueur
 * a sa grille 3×4 posée à plat devant lui (pas de chevalet). Pioche et
 * défausse au centre. Clics = boutons DOM superposés (getCardRects).
 *
 * Siège 0 = joueur local au +Z. Orbite yaw bornée en joueur, 360° spectateur.
 *
 * Pioche : le tas reste ; la carte du dessus se retourne et se pose à côté.
 * Pose : la carte remplacée saute vers la défausse (flip si elle était cachée).
 * Défausse : pile qui grossit, cartes volontairement mal empilées.
 */

const CARD_ASPECT = 120 / 186;
const CAMERA_FOV = 46;
const TABLE_RADIUS = 2.7;
const TABLE_THICKNESS = 0.14;
const TABLE_TOP = TABLE_THICKNESS / 2;
const GRID_RADIUS = 1.95;
const CARD_SCALE = 0.32;
const CENTER_SCALE = 0.36;
const CARD_GEO = new THREE.PlaneGeometry(CARD_ASPECT, 1);
const COLS = 4;
const ROWS = 3;
const SPACING_X = CARD_ASPECT * CARD_SCALE * 1.14;
const SPACING_Z = CARD_SCALE * 1.16;
const GRID_WIDTH = (COLS - 1) * SPACING_X;

const DECK_X = 0.42;
const DECK_Z = 0;
const DRAWN_X = 0.42;
const DRAWN_Z = 0.52;
const DISCARD_X = -0.42;
const DISCARD_Z = 0;
const DECK_VISIBLE = 8;
const DISCARD_VISIBLE = 12;
const CARD_Y = TABLE_TOP + 0.012;
const CARD_TINT = 0xb3aea6;

const FELT = 0x1f4d3a;
const WOOD = 0x6b4423;
const BRASS = 0xc9a227;

let canvas;
let renderer;
let scene;
let camera;
let mounted = false;
let animationHandle = null;
let tableGroup = null;
let seatGroups = [];
let deckMeshes = [];
let discardMeshes = [];
let drawnMesh = null;
let overlaySync = null;

const flips = new Map();
const motions = new Map();
const inFlight = new Set();
const hiddenUntil = new Set();
const flightPool = [];
const faceTextures = new Map();
let cardBackTexture = null;
const textureLoader = new THREE.TextureLoader();

const _world = new THREE.Vector3();
const _look = new THREE.Vector3();
const _corner = new THREE.Vector3();

const BASE_ELEV = 1.05;
const BASE_DIST = 5.5;
const PITCH_MIN = 0.42;
const PITCH_MAX = 1.28;
const DIST_MIN = 2.6;
const DIST_MAX_FACTOR = 1.45;
let lastSeatCount = 2;
let orbitYaw = 0;
let orbitPitch = BASE_ELEV;
let orbitDistance = BASE_DIST;
let fittedDistance = BASE_DIST;
let userZoomed = false;
let orbitYawLimited = true;
let orbitYawLimit = 0.7;

let hasSnapshot = false;
let prev = { drawnId: null, drawnSource: null, drawn: null, discardIds: [], grids: [] };
let lastPile = [];

function teardown() {
  if (animationHandle) cancelAnimationFrame(animationHandle);
  animationHandle = null;
  document.querySelectorAll('#skyjo-3d-canvas').forEach((el) => el.remove());
  mounted = false;
  canvas = null;
  renderer = null;
  scene = null;
  camera = null;
  tableGroup = null;
  seatGroups = [];
  deckMeshes = [];
  discardMeshes = [];
  drawnMesh = null;
  overlaySync = null;
  flips.clear();
  motions.clear();
  inFlight.clear();
  hiddenUntil.clear();
  flightPool.length = 0;
  hasSnapshot = false;
  prev = { drawnId: null, drawnSource: null, drawn: null, discardIds: [], grids: [] };
  lastPile = [];
}

if (import.meta.hot) import.meta.hot.dispose(teardown);

function makeMat(opts = {}) {
  return new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.04, ...opts });
}

function makeCardMaterial() {
  return new THREE.MeshBasicMaterial({
    color: CARD_TINT,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1
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

function getBack() {
  if (cardBackTexture) return cardBackTexture;
  cardBackTexture = textureLoader.load(backUrl);
  cardBackTexture.colorSpace = THREE.SRGBColorSpace;
  return cardBackTexture;
}

function getFace(value) {
  if (faceTextures.has(value)) return faceTextures.get(value);
  const url = FACE_BY_VALUE[value];
  if (!url) {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = Math.round(256 / CARD_ASPECT);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#F7F1E1';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#201E18';
    ctx.font = '700 96px Georgia';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(value), c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    faceTextures.set(value, tex);
    return tex;
  }
  const tex = textureLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  faceTextures.set(value, tex);
  return tex;
}

function busy(mesh) {
  return Boolean(mesh && (motions.has(mesh.uuid) || flips.has(mesh.userData.cardId)));
}

function applyCard(mesh, card, { faceUp = false, scale = CARD_SCALE } = {}) {
  mesh.visible = Boolean(card) && !hiddenUntil.has(mesh.uuid);
  if (!card) return;
  mesh.userData.cardId = card.id;
  mesh.userData.value = card.value;
  mesh.userData.face.material.map = getFace(card.value);
  mesh.userData.back.material.map = getBack();
  mesh.userData.face.material.needsUpdate = true;
  mesh.userData.back.material.needsUpdate = true;
  if (!busy(mesh)) {
    mesh.scale.setScalar(scale);
    mesh.userData.pivot.rotation.y = faceUp ? Math.PI : 0;
  }
}

function layFlat(mesh, y) {
  mesh.rotation.set(-Math.PI / 2, 0, 0);
  if (!busy(mesh)) mesh.position.y = y;
}

function hashId(id) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function unitNoise(h, shift) {
  return (((h >>> shift) & 1023) / 1023) * 2 - 1;
}

function discardPose(cardId, stackIndex, pileLen = stackIndex + 1) {
  const h = hashId(cardId || `d-${stackIndex}`);
  const spread = 0.048 + Math.min(0.04, pileLen * 0.0012);
  const buried = Math.max(0, pileLen - DISCARD_VISIBLE);
  const visibleIndex = Math.min(stackIndex, DISCARD_VISIBLE - 1);
  return {
    x: DISCARD_X + unitNoise(h, 0) * spread,
    y: CARD_Y + buried * 0.0035 + visibleIndex * 0.0072,
    z: DISCARD_Z + unitNoise(h, 10) * spread * 0.88,
    yaw: unitNoise(h, 20) * 0.34
  };
}

function discardEuler(yaw) {
  return new THREE.Euler(-Math.PI / 2, 0, yaw);
}

function drawnRestPos() {
  return new THREE.Vector3(DRAWN_X, CARD_Y + 0.02, DRAWN_Z);
}

function drawnRestEuler() {
  return new THREE.Euler(-Math.PI / 2, 0, 0.07);
}

function deckTopPos(deckCount) {
  const n = Math.min(DECK_VISIBLE, Math.max(0, deckCount));
  const buried = Math.max(0, deckCount - DECK_VISIBLE);
  return new THREE.Vector3(DECK_X, CARD_Y + buried * 0.0025 + n * 0.007 + 0.006, DECK_Z);
}

function createTable() {
  const group = new THREE.Group();
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, TABLE_THICKNESS, 64, 1, true),
    makeMat({ color: WOOD, roughness: 0.7, side: THREE.DoubleSide })
  );
  group.add(rim);
  const felt = new THREE.Mesh(new THREE.CircleGeometry(TABLE_RADIUS, 96), makeMat({ color: FELT, roughness: 0.9 }));
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = TABLE_TOP + 0.002;
  group.add(felt);
  return group;
}

function createSeatMarker() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.22, 0.28, 32),
    makeMat({ color: BRASS, roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide, emissive: BRASS, emissiveIntensity: 0.18 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.006;
  ring.visible = false;
  return ring;
}

function layoutGrid(meshes, grid) {
  const y = CARD_Y;
  meshes.forEach((mesh, i) => {
    if (busy(mesh)) return;
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    mesh.position.x = (col - 1.5) * SPACING_X;
    mesh.position.z = -0.22 - (ROWS - 1 - row) * SPACING_Z;
    layFlat(mesh, y);
    mesh.renderOrder = 10 + i;
  });
}

function layoutDeck(deckCount) {
  const n = deckMeshes.length;
  const buried = Math.max(0, deckCount - DECK_VISIBLE);
  deckMeshes.forEach((m, i) => {
    const h = hashId(`deck-${i}`);
    m.position.set(
      DECK_X + unitNoise(h, 0) * 0.006,
      CARD_Y + buried * 0.0025 + i * 0.007,
      DECK_Z + unitNoise(h, 10) * 0.005
    );
    m.rotation.set(-Math.PI / 2, 0, unitNoise(h, 20) * 0.045);
    m.scale.setScalar(CENTER_SCALE);
    m.renderOrder = 4 + i;
    m.visible = i < Math.min(n, Math.max(0, deckCount));
    if (m.visible) applyCard(m, { id: `deck-${i}`, value: 0 }, { faceUp: false, scale: CENTER_SCALE });
  });
}

function layoutDiscard(pile) {
  const start = Math.max(0, pile.length - discardMeshes.length);
  discardMeshes.forEach((m, i) => {
    const card = pile[start + i];
    if (!card || inFlight.has(card.id)) {
      m.visible = false;
      return;
    }
    applyCard(m, card, { faceUp: true, scale: CENTER_SCALE });
    if (busy(m)) return;
    const pose = discardPose(card.id, start + i, pile.length);
    m.position.set(pose.x, pose.y, pose.z);
    m.rotation.copy(discardEuler(pose.yaw));
    m.scale.setScalar(CENTER_SCALE);
    m.renderOrder = 6 + i;
  });
}

function layoutDrawn(drawn) {
  if (!drawnMesh) return;
  if (busy(drawnMesh)) {
    drawnMesh.visible = true;
    return;
  }
  drawnMesh.visible = Boolean(drawn);
  if (!drawn) return;
  applyCard(drawnMesh, drawn, { faceUp: true, scale: CENTER_SCALE });
  drawnMesh.position.copy(drawnRestPos());
  drawnMesh.rotation.copy(drawnRestEuler());
  drawnMesh.scale.setScalar(CENTER_SCALE);
  drawnMesh.renderOrder = 20;
}

function easeSmooth(t) {
  return t * t * (3 - 2 * t);
}

function startFlip(mesh, value) {
  const id = mesh.userData.cardId;
  if (!id || !mesh.userData.pivot || flips.has(id) || motions.has(mesh.uuid)) return;
  mesh.userData.face.material.map = getFace(value);
  mesh.userData.face.material.needsUpdate = true;
  flips.set(id, {
    root: mesh,
    startTime: performance.now(),
    duration: 620,
    from: 0,
    to: Math.PI,
    baseY: mesh.position.y,
    lift: 0.12
  });
}

function advanceFlips(now) {
  for (const [id, flip] of flips) {
    const mesh = flip.root;
    const pivot = mesh?.userData?.pivot;
    if (!mesh || !pivot) {
      flips.delete(id);
      continue;
    }
    const t = Math.min(1, (now - flip.startTime) / flip.duration);
    const k = easeSmooth(t);
    pivot.rotation.y = flip.from + (flip.to - flip.from) * k;
    mesh.position.y = flip.baseY + Math.sin(t * Math.PI) * flip.lift;
    if (t >= 1) {
      pivot.rotation.y = flip.to;
      mesh.position.y = flip.baseY;
      flips.delete(id);
    }
  }
}

function eulerToQuat(euler) {
  return new THREE.Quaternion().setFromEuler(euler);
}

function startMotion(mesh, { toPos, toQuat, pivotFrom, pivotTo, duration = 720, lift = 0.28, scaleFrom, scaleTo, onDone }) {
  if (!mesh) return;
  mesh.updateMatrixWorld(true);
  const fromPos = mesh.position.clone();
  const fromQuat = mesh.quaternion.clone();
  const pivot = mesh.userData.pivot;
  motions.set(mesh.uuid, {
    mesh,
    fromPos,
    toPos: toPos.clone(),
    fromQuat,
    toQuat: toQuat.clone(),
    pivotFrom: pivotFrom ?? pivot?.rotation.y ?? 0,
    pivotTo: pivotTo ?? pivot?.rotation.y ?? 0,
    start: performance.now(),
    duration,
    lift,
    scaleFrom: scaleFrom ?? mesh.scale.x,
    scaleTo: scaleTo ?? mesh.scale.x,
    onDone
  });
}

function advanceMotions(now) {
  for (const [id, m] of motions) {
    const mesh = m.mesh;
    if (!mesh) {
      motions.delete(id);
      continue;
    }
    const t = Math.min(1, (now - m.start) / m.duration);
    const k = easeSmooth(t);
    mesh.position.lerpVectors(m.fromPos, m.toPos, k);
    mesh.position.y += Math.sin(t * Math.PI) * m.lift;
    mesh.quaternion.copy(m.fromQuat).slerp(m.toQuat, k);
    if (mesh.userData.pivot) {
      mesh.userData.pivot.rotation.y = m.pivotFrom + (m.pivotTo - m.pivotFrom) * k;
    }
    mesh.scale.setScalar(m.scaleFrom + (m.scaleTo - m.scaleFrom) * k);
    if (t >= 1) {
      mesh.position.copy(m.toPos);
      mesh.quaternion.copy(m.toQuat);
      mesh.rotation.setFromQuaternion(m.toQuat);
      if (mesh.userData.pivot) mesh.userData.pivot.rotation.y = m.pivotTo;
      mesh.scale.setScalar(m.scaleTo);
      motions.delete(id);
      const cardId = mesh.userData.cardId;
      if (cardId) inFlight.delete(cardId);
      m.onDone?.();
    }
  }
}

function captureWorldPose(mesh) {
  if (!mesh) return null;
  mesh.updateMatrixWorld(true);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  mesh.getWorldPosition(pos);
  mesh.getWorldQuaternion(quat);
  return { pos, quat, mesh };
}

function acquireFlightMesh() {
  const m = flightPool.pop() || createCardMesh();
  if (!m.parent && scene) scene.add(m);
  m.visible = true;
  return m;
}

function releaseFlightMesh(mesh) {
  if (!mesh) return;
  mesh.visible = false;
  motions.delete(mesh.uuid);
  if (mesh.userData.cardId) inFlight.delete(mesh.userData.cardId);
  flightPool.push(mesh);
}

function flyCardToDiscard(card, fromPose, { wasFaceUp, pile, scaleFrom = CARD_SCALE } = {}) {
  if (!card || !fromPose) return;
  const flyer = acquireFlightMesh();
  applyCard(flyer, card, { faceUp: wasFaceUp, scale: scaleFrom });
  flyer.position.copy(fromPose.pos);
  flyer.quaternion.copy(fromPose.quat);
  flyer.userData.pivot.rotation.y = wasFaceUp ? Math.PI : 0;
  flyer.renderOrder = 30;
  const idx = Math.max(
    0,
    pile.findIndex((c) => c.id === card.id)
  );
  const pose = discardPose(card.id, idx < 0 ? pile.length : idx, pile.length);
  const toPos = new THREE.Vector3(pose.x, pose.y, pose.z);
  inFlight.add(card.id);
  startMotion(flyer, {
    toPos,
    toQuat: eulerToQuat(discardEuler(pose.yaw)),
    pivotFrom: wasFaceUp ? Math.PI : 0,
    pivotTo: Math.PI,
    duration: 760,
    lift: 0.34,
    scaleFrom,
    scaleTo: CENTER_SCALE,
    onDone: () => {
      releaseFlightMesh(flyer);
      layoutDiscard(lastPile);
    }
  });
}

function placeSeats(total) {
  lastSeatCount = total;
  for (let i = 0; i < seatGroups.length; i++) {
    const theta = -i * ((Math.PI * 2) / total);
    const seat = seatGroups[i];
    seat.group.position.set(Math.sin(theta) * GRID_RADIUS, 0, Math.cos(theta) * GRID_RADIUS);
    seat.group.rotation.set(0, theta, 0);
  }
}

function ensureSeats(count) {
  while (seatGroups.length > count) {
    const seat = seatGroups.pop();
    seat.meshes.forEach((m) => m.parent?.remove(m));
    scene.remove(seat.group);
  }
  while (seatGroups.length < count) {
    const group = new THREE.Group();
    const marker = createSeatMarker();
    group.add(marker);
    const meshes = [];
    for (let i = 0; i < 12; i++) {
      const m = createCardMesh();
      group.add(m);
      meshes.push(m);
    }
    scene.add(group);
    seatGroups.push({ group, meshes, marker });
  }
}

function syncMeshList(list, n, parent) {
  while (list.length > n) {
    const m = list.pop();
    m.parent?.remove(m);
  }
  while (list.length < n) {
    const m = createCardMesh();
    parent.add(m);
    list.push(m);
  }
}

function ensureCenterMeshes(deckCount, discardCount) {
  syncMeshList(deckMeshes, Math.min(DECK_VISIBLE, Math.max(0, deckCount)), scene);
  syncMeshList(discardMeshes, Math.min(DISCARD_VISIBLE, Math.max(0, discardCount)), scene);
  if (!drawnMesh) {
    drawnMesh = createCardMesh();
    scene.add(drawnMesh);
  }
}

function neighborSpacing() {
  return (Math.PI * 2) / Math.max(lastSeatCount, 2);
}

function facePeekHalf() {
  const horiz = Math.abs(Math.cos(orbitPitch) * orbitDistance);
  if (horiz <= GRID_RADIUS + 0.08) return 0;
  return Math.acos(Math.min(0.999, GRID_RADIUS / horiz));
}

function refreshPlayerYawLimit(seatCount) {
  if (Number.isFinite(seatCount) && seatCount >= 2) lastSeatCount = seatCount;
  const spacing = neighborSpacing();
  const peek = facePeekHalf();
  const gridHalf = Math.atan(GRID_WIDTH / 2 / GRID_RADIUS);
  orbitYawLimit = Math.max(0.08, spacing - peek - gridHalf * 0.35);
  if (orbitYawLimited) {
    if (orbitYaw > orbitYawLimit) orbitYaw = orbitYawLimit;
    else if (orbitYaw < -orbitYawLimit) orbitYaw = -orbitYawLimit;
  }
}

function applyOrbitCamera() {
  if (!camera) return;
  _look.set(0, 0.06, 0);
  const horiz = Math.cos(orbitPitch) * orbitDistance;
  camera.position.set(
    _look.x + Math.sin(orbitYaw) * horiz,
    _look.y + Math.sin(orbitPitch) * orbitDistance,
    _look.z + Math.cos(orbitYaw) * horiz
  );
  camera.lookAt(_look);
}

function computeFittedDistance() {
  if (!camera) return BASE_DIST;
  const halfVFov = (CAMERA_FOV * Math.PI) / 360;
  const halfHFov = Math.atan(Math.tan(halfVFov) * Math.max(camera.aspect, 0.05));
  const margin = TABLE_RADIUS + 0.45;
  return Math.max(BASE_DIST, margin / Math.tan(halfHFov), margin / Math.tan(halfVFov));
}

function fitCamera() {
  if (!camera) return;
  fittedDistance = computeFittedDistance();
  if (!userZoomed) orbitDistance = fittedDistance;
  else {
    const maxD = Math.max(fittedDistance, BASE_DIST) * DIST_MAX_FACTOR;
    orbitDistance = Math.max(DIST_MIN, Math.min(maxD, orbitDistance));
  }
  applyOrbitCamera();
}

function ensureScene() {
  if (mounted && canvas?.isConnected) return;
  teardown();
  mounted = true;
  canvas = document.createElement('canvas');
  canvas.id = 'skyjo-3d-canvas';
  canvas.style.cssText = 'position:fixed;pointer-events:none;display:none;z-index:5';
  document.body.appendChild(canvas);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 80);
  scene.add(new THREE.HemisphereLight(0xdde6e0, 0x1a120c, 0.28));
  scene.add(new THREE.AmbientLight(0xf2eee6, 0.12));
  const key = new THREE.DirectionalLight(0xfff6e8, 0.32);
  key.position.set(2.2, 7, 4.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xb7c9c0, 0.1);
  fill.position.set(-3, 3, -2);
  scene.add(fill);
  tableGroup = createTable();
  scene.add(tableGroup);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const tick = () => {
    animationHandle = requestAnimationFrame(tick);
    if (renderer && scene && camera) {
      const now = performance.now();
      advanceFlips(now);
      advanceMotions(now);
      renderer.render(scene, camera);
      if ((flips.size || motions.size) && overlaySync) overlaySync();
    }
  };
  tick();
}

export function setOverlaySync(fn) {
  overlaySync = typeof fn === 'function' ? fn : null;
}

export function orbitCameraByScreenDelta(dx, dy) {
  if (!mounted) return;
  orbitPitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, orbitPitch + dy * 0.006));
  orbitYaw -= dx * 0.008;
  if (orbitYawLimited) refreshPlayerYawLimit();
  else if (orbitYaw > Math.PI) orbitYaw -= Math.PI * 2;
  else if (orbitYaw < -Math.PI) orbitYaw += Math.PI * 2;
  applyOrbitCamera();
}

export function zoomCameraByFactor(factor) {
  if (!mounted || !Number.isFinite(factor) || factor <= 0) return;
  userZoomed = true;
  const maxD = Math.max(fittedDistance, BASE_DIST) * DIST_MAX_FACTOR;
  orbitDistance = Math.max(DIST_MIN, Math.min(maxD, orbitDistance / factor));
  if (orbitYawLimited) refreshPlayerYawLimit();
  applyOrbitCamera();
}

export function resetOrbit() {
  orbitYaw = 0;
  orbitPitch = BASE_ELEV;
  userZoomed = false;
  orbitDistance = fittedDistance || BASE_DIST;
  if (orbitYawLimited) refreshPlayerYawLimit();
  if (mounted) applyOrbitCamera();
}

export function mountTable() {
  ensureScene();
}

export function positionTable(rect) {
  if (!mounted || !rect?.width || !renderer || !camera) return;
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
  overlaySync = null;
  if (canvas) canvas.style.display = 'none';
  document.querySelectorAll('#skyjo-3d-canvas').forEach((el) => {
    el.style.display = 'none';
  });
}

function snapshotOf(seats, pile, drawn, drawnSource) {
  return {
    drawnId: drawn?.id || null,
    drawnSource: drawnSource || null,
    drawn: drawn ? { id: drawn.id, value: drawn.value } : null,
    discardIds: pile.map((c) => c.id),
    grids: seats.map((s) =>
      (s.grid || []).map((c) => (c?.card ? { id: c.card.id, value: c.card.value, faceUp: Boolean(c.faceUp) } : null))
    )
  };
}

/**
 * `seats` : [{ grid, isTurn }] dans l'ordre local d'abord, puis adversaires.
 * `grid[i]` = `{ card: {id,value}, faceUp }` ou `null`.
 * `spectator` : tous les sièges autour de la table, orbite 360°.
 */
export function updateTable({
  seats = [],
  discard = [],
  discardTop = null,
  deckCount = 0,
  drawn = null,
  drawnSource = null,
  spectator = false
} = {}) {
  if (!mounted) return;
  orbitYawLimited = !spectator;
  const pile = discard.length ? discard : discardTop ? [discardTop] : [];
  const animate = hasSnapshot;

  const events = [];
  if (animate) {
    const newDrawnId = drawn?.id || null;
    if (newDrawnId && newDrawnId !== prev.drawnId) {
      events.push({ type: 'draw', source: drawnSource || 'deck', card: drawn });
    }
    if (prev.drawnId && !newDrawnId) {
      let placed = null;
      seats.forEach((s, si) => {
        (s.grid || []).forEach((cell, j) => {
          if (cell?.card?.id === prev.drawnId && prev.grids[si]?.[j]?.id !== prev.drawnId) {
            placed = { si, j, old: prev.grids[si]?.[j] || null };
          }
        });
      });
      if (!placed) {
        seats.forEach((s, si) => {
          (s.grid || []).forEach((cell, j) => {
            const before = prev.grids[si]?.[j];
            if (!cell && before && pile.some((c) => c.id === prev.drawnId) && pile.some((c) => c.id === before.id)) {
              placed = { si, j, old: before, thenCleared: true };
            }
          });
        });
      }
      if (placed) events.push({ type: 'place', ...placed, cardId: prev.drawnId });
      else events.push({ type: 'discardDrawn', cardId: prev.drawnId, card: prev.drawn || { id: prev.drawnId } });
    }
    const skipCleared = new Set(events.filter((e) => e.type === 'place').map((e) => `${e.si}-${e.j}`));
    seats.forEach((s, si) => {
      (prev.grids[si] || []).forEach((before, j) => {
        if (before && !(s.grid || [])[j] && !skipCleared.has(`${si}-${j}`)) {
          events.push({ type: 'cleared', si, j, old: before });
        }
      });
    });
  }

  const captures = {};
  for (const ev of events) {
    if (ev.si == null) continue;
    captures[`${ev.si}-${ev.j}`] = captureWorldPose(seatGroups[ev.si]?.meshes[ev.j]);
  }
  const drawnStart = drawnMesh && busy(drawnMesh) ? null : captureWorldPose(drawnMesh);

  ensureSeats(Math.max(seats.length, 1));
  ensureCenterMeshes(deckCount, pile.length);
  placeSeats(seatGroups.length);
  fitCamera();
  refreshPlayerYawLimit(seatGroups.length);

  seats.forEach((p, i) => {
    const seat = seatGroups[i];
    if (!seat) return;
    const grid = p.grid || [];
    const prevGrid = prev.grids[i] || [];
    seat.meshes.forEach((mesh, j) => {
      const cell = grid[j];
      const before = prevGrid[j];
      applyCard(mesh, cell?.card, { faceUp: Boolean(cell?.faceUp) });
      if (
        animate &&
        cell?.faceUp &&
        before &&
        before.id === cell.card.id &&
        !before.faceUp &&
        !flips.has(cell.card.id)
      ) {
        startFlip(mesh, cell.card.value);
      }
    });
    layoutGrid(seat.meshes, grid);
    if (seat.marker) seat.marker.visible = Boolean(p.isTurn);
  });

  lastPile = pile;
  layoutDeck(deckCount);
  layoutDiscard(pile);
  layoutDrawn(drawn);

  if (animate) {
    for (const ev of events) {
      if (ev.type === 'draw' && ev.card) {
        applyCard(drawnMesh, ev.card, { faceUp: true, scale: CENTER_SCALE });
        drawnMesh.visible = true;
        drawnMesh.renderOrder = 22;
        if (ev.source === 'discard') {
          const prevIdx = Math.max(0, prev.discardIds.length - 1);
          const prevId = prev.discardIds[prevIdx] || ev.card.id;
          const pose = discardPose(prevId, prevIdx, prev.discardIds.length);
          drawnMesh.position.set(pose.x, pose.y, pose.z);
          drawnMesh.quaternion.copy(eulerToQuat(discardEuler(pose.yaw)));
          drawnMesh.userData.pivot.rotation.y = Math.PI;
          startMotion(drawnMesh, {
            toPos: drawnRestPos(),
            toQuat: eulerToQuat(drawnRestEuler()),
            pivotFrom: Math.PI,
            pivotTo: Math.PI,
            duration: 560,
            lift: 0.22,
            scaleFrom: CENTER_SCALE,
            scaleTo: CENTER_SCALE
          });
        } else {
          drawnMesh.position.copy(deckTopPos(deckCount));
          drawnMesh.quaternion.copy(eulerToQuat(new THREE.Euler(-Math.PI / 2, 0, 0)));
          drawnMesh.userData.pivot.rotation.y = 0;
          startMotion(drawnMesh, {
            toPos: drawnRestPos(),
            toQuat: eulerToQuat(drawnRestEuler()),
            pivotFrom: 0,
            pivotTo: Math.PI,
            duration: 820,
            lift: 0.3,
            scaleFrom: CENTER_SCALE,
            scaleTo: CENTER_SCALE
          });
        }
      } else if (ev.type === 'place') {
        const cellMesh = seatGroups[ev.si]?.meshes[ev.j];
        if (ev.old) {
          flyCardToDiscard(ev.old, captures[`${ev.si}-${ev.j}`], {
            wasFaceUp: Boolean(ev.old.faceUp),
            pile,
            scaleFrom: CARD_SCALE
          });
        }
        if (ev.thenCleared) {
          const card = pile.find((c) => c.id === ev.cardId) || prev.drawn;
          const from = drawnStart || { pos: drawnRestPos(), quat: eulerToQuat(drawnRestEuler()) };
          if (card) flyCardToDiscard(card, from, { wasFaceUp: true, pile, scaleFrom: CENTER_SCALE });
          if (drawnMesh && !busy(drawnMesh)) drawnMesh.visible = false;
        } else if (drawnMesh && ev.cardId && cellMesh) {
          hiddenUntil.add(cellMesh.uuid);
          cellMesh.visible = false;
          cellMesh.updateMatrixWorld(true);
          const destPos = new THREE.Vector3();
          const destQuat = new THREE.Quaternion();
          cellMesh.getWorldPosition(destPos);
          cellMesh.getWorldQuaternion(destQuat);
          if (!busy(drawnMesh)) {
            if (drawnStart) {
              drawnMesh.position.copy(drawnStart.pos);
              drawnMesh.quaternion.copy(drawnStart.quat);
            }
            drawnMesh.visible = true;
            startMotion(drawnMesh, {
              toPos: destPos,
              toQuat: destQuat,
              pivotFrom: Math.PI,
              pivotTo: Math.PI,
              duration: 640,
              lift: 0.26,
              scaleFrom: CENTER_SCALE,
              scaleTo: CARD_SCALE,
              onDone: () => {
                hiddenUntil.delete(cellMesh.uuid);
                cellMesh.visible = true;
                if (!drawn) drawnMesh.visible = false;
              }
            });
          } else {
            hiddenUntil.delete(cellMesh.uuid);
            cellMesh.visible = true;
          }
        }
      } else if (ev.type === 'discardDrawn') {
        const card = pile.find((c) => c.id === ev.cardId) || ev.card || prev.drawn;
        const from = drawnStart || captureWorldPose(drawnMesh) || { pos: drawnRestPos(), quat: eulerToQuat(drawnRestEuler()) };
        flyCardToDiscard(card, from, { wasFaceUp: true, pile, scaleFrom: CENTER_SCALE });
        if (drawnMesh && !busy(drawnMesh)) drawnMesh.visible = false;
      } else if (ev.type === 'cleared' && ev.old) {
        flyCardToDiscard(ev.old, captures[`${ev.si}-${ev.j}`], {
          wasFaceUp: Boolean(ev.old.faceUp),
          pile,
          scaleFrom: CARD_SCALE
        });
      }
    }
  }

  prev = snapshotOf(seats, pile, drawn, drawnSource);
  hasSnapshot = true;
}

function projectMesh(mesh) {
  if (!mounted || !mesh?.visible) return null;
  camera.updateMatrixWorld();
  mesh.updateMatrixWorld();
  const plane = mesh.userData?.back || mesh;
  plane.updateMatrixWorld();
  const w = parseFloat(canvas.style.width) || 1;
  const h = parseFloat(canvas.style.height) || 1;
  const halfW = CARD_ASPECT / 2;
  const xs = [];
  const ys = [];
  for (const [cx, cy] of [
    [-halfW, 0.5],
    [halfW, 0.5],
    [halfW, -0.5],
    [-halfW, -0.5]
  ]) {
    _corner.set(cx, cy, 0).applyMatrix4(plane.matrixWorld).project(camera);
    xs.push((_corner.x * 0.5 + 0.5) * w);
    ys.push((-_corner.y * 0.5 + 0.5) * h);
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
}

export function getCardRects() {
  const mine = (seatGroups[0]?.meshes || []).map((m, i) => {
    const r = projectMesh(m);
    return r ? { ...r, index: i } : null;
  });
  const topDeck = [...deckMeshes].reverse().find((m) => m.visible);
  const topDiscard = [...discardMeshes].reverse().find((m) => m.visible);
  return {
    mine,
    deck: projectMesh(topDeck),
    discard: projectMesh(topDiscard),
    drawn: projectMesh(drawnMesh)
  };
}

export function getRowLabelAnchors() {
  if (!mounted) return { mine: null, opponents: [], seats: [] };
  camera.updateMatrixWorld();
  const w = parseFloat(canvas.style.width) || 1;
  const h = parseFloat(canvas.style.height) || 1;
  const fromGroup = (group) => {
    if (!group) return null;
    group.updateMatrixWorld();
    _world.set(0, 0.22, 0.35).applyMatrix4(group.matrixWorld).project(camera);
    return { left: (_world.x * 0.5 + 0.5) * w, top: (-_world.y * 0.5 + 0.5) * h };
  };
  return {
    mine: fromGroup(seatGroups[0]?.group),
    opponents: seatGroups.slice(1).map((s) => fromGroup(s.group)),
    seats: seatGroups.map((s) => fromGroup(s.group))
  };
}

export function flipCard(cardId, value, { duration = 620 } = {}) {
  const mesh =
    seatGroups.flatMap((s) => s.meshes).find((m) => m.userData.cardId === cardId) ||
    (drawnMesh?.userData.cardId === cardId ? drawnMesh : null);
  if (mesh) startFlip(mesh, value);
  if (duration) flips.get(cardId) && (flips.get(cardId).duration = duration);
}

export function skyjoFaceUrl(value) {
  return FACE_BY_VALUE[value] || '';
}
