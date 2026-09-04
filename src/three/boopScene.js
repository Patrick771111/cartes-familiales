import * as THREE from 'three';

/**
 * Scène 3D Boop — plateau 6×6 au centre, paniers chatons/chats en bord de
 * table. Un pion saute depuis son panier ; le rebond à l'atterrissage
 * pousse les voisins (boop). Trois chatons alignés grossissent en chats
 * puis rejoignent le panier des chats.
 */

const CAMERA_FOV = 46;
const TABLE_RADIUS = 2.55;
const TABLE_THICKNESS = 0.14;
const TABLE_TOP = TABLE_THICKNESS / 2;
const CELL = 0.36;
const GRID = 6;
const BOARD = CELL * GRID;

const FUR = { orange: 0xd9782c, gray: 0x8b9098 };
const BELLY = { orange: 0xf3d5a8, gray: 0xe8e8ea };
const WOOD = 0x6b4423;
const FELT = 0x1f4d3a;
const BOARD_WOOD = 0xb08958;
const CELL_DARK = 0x8a6234;

let canvas;
let renderer;
let scene;
let camera;
let mounted = false;
let animationHandle = null;
let overlaySync = null;

const pieceMeshes = new Map();
const busy = new Set();
const motions = [];
let lastAnimatedId = null;

const _corner = new THREE.Vector3();
const _look = new THREE.Vector3();

let orbitYaw = 0;
let orbitPitch = 1.02;
let orbitDistance = 6.2;
let orbitYawLimited = true;

function teardown() {
  if (animationHandle) cancelAnimationFrame(animationHandle);
  animationHandle = null;
  document.querySelectorAll('#boop-3d-canvas').forEach((el) => el.remove());
  mounted = false;
  canvas = null;
  renderer = null;
  scene = null;
  camera = null;
  overlaySync = null;
  pieceMeshes.clear();
  busy.clear();
  motions.length = 0;
}

if (import.meta.hot) import.meta.hot.dispose(teardown);

function makeMat(opts = {}) {
  return new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.04, ...opts });
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

function easeSmooth(t) {
  return t * t * (3 - 2 * t);
}

function cellWorld(index) {
  const col = index % GRID;
  const row = Math.floor(index / GRID);
  return new THREE.Vector3((col - 2.5) * CELL, TABLE_TOP + 0.06, (row - 2.5) * CELL);
}

function basketWorld(seat, type) {
  const z = seat === 0 ? 1.72 : -1.72;
  const x = type === 'kitten' ? (seat === 0 ? 1.15 : -1.15) : seat === 0 ? -1.15 : 1.15;
  return new THREE.Vector3(x, TABLE_TOP + 0.04, z);
}

function basketScatter(id, i, n) {
  const h = hashId(id);
  const a = (i / Math.max(n, 1)) * Math.PI * 2 + ((h % 13) - 6) * 0.04;
  const r = 0.08 + (h % 8) * 0.01;
  return { x: Math.cos(a) * r, z: Math.sin(a) * r };
}

function createAnimal(type, color) {
  const fur = makeMat({ color: FUR[color] || FUR.orange, roughness: 0.78 });
  const pale = makeMat({ color: BELLY[color] || BELLY.orange, roughness: 0.8 });
  const dark = makeMat({ color: 0x2a221c, roughness: 0.6 });
  const g = new THREE.Group();
  const s = type === 'cat' ? 1 : 0.72;

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), fur);
  body.scale.set(1.05, 0.78, 1.28);
  body.position.y = 0.12;
  g.add(body);

  const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), pale);
  tummy.position.set(0, 0.08, 0.08);
  tummy.scale.set(0.9, 0.7, 0.7);
  g.add(tummy);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), fur);
  head.position.set(0, 0.28, 0.12);
  g.add(head);

  const earGeo = new THREE.ConeGeometry(0.045, 0.08, 8);
  const earL = new THREE.Mesh(earGeo, fur);
  earL.position.set(-0.07, 0.38, 0.1);
  earL.rotation.z = 0.25;
  const earR = new THREE.Mesh(earGeo, fur);
  earR.position.set(0.07, 0.38, 0.1);
  earR.rotation.z = -0.25;
  g.add(earL, earR);

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), dark);
  eyeL.position.set(-0.04, 0.3, 0.21);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.04;
  g.add(eyeL, eyeR);

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.18, 8), fur);
  tail.position.set(0.08, 0.16, -0.16);
  tail.rotation.x = 0.9;
  tail.rotation.z = -0.4;
  g.add(tail);

  g.scale.setScalar(s);
  g.userData.type = type;
  g.userData.color = color;
  g.userData.baseScale = s;
  return g;
}

function setAnimalType(mesh, type) {
  if (!mesh || mesh.userData.type === type) return;
  mesh.userData.type = type;
  mesh.userData.baseScale = type === 'cat' ? 1 : 0.72;
}

function createBasket() {
  const g = new THREE.Group();
  const wood = makeMat({ color: 0x8b5a2b, roughness: 0.82 });
  const rim = makeMat({ color: 0xc4a574, roughness: 0.7 });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.2, 20, 1, true), wood);
  wall.material.side = THREE.DoubleSide;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), wood);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.1;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 20), rim);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.1;
  g.add(wall, floor, lip);
  g.position.y = TABLE_TOP + 0.12;
  return g;
}

function createBoard() {
  const g = new THREE.Group();
  const wood = makeMat({ color: BOARD_WOOD, roughness: 0.72 });
  const plank = new THREE.Mesh(new THREE.BoxGeometry(BOARD + 0.22, 0.08, BOARD + 0.22), wood);
  plank.position.y = TABLE_TOP + 0.04;
  g.add(plank);
  const cellMat = makeMat({ color: CELL_DARK, roughness: 0.85 });
  for (let i = 0; i < 36; i++) {
    const sq = new THREE.Mesh(new THREE.PlaneGeometry(CELL * 0.88, CELL * 0.88), cellMat);
    const p = cellWorld(i);
    sq.rotation.x = -Math.PI / 2;
    sq.position.set(p.x, TABLE_TOP + 0.081, p.z);
    g.add(sq);
  }
  return g;
}

function createTable() {
  const g = new THREE.Group();
  const rim = new THREE.Mesh(
    new THREE.CylinderGeometry(TABLE_RADIUS, TABLE_RADIUS, TABLE_THICKNESS, 64, 1, true),
    makeMat({ color: WOOD, roughness: 0.7, side: THREE.DoubleSide })
  );
  const felt = new THREE.Mesh(new THREE.CircleGeometry(TABLE_RADIUS, 72), makeMat({ color: FELT, roughness: 0.9 }));
  felt.rotation.x = -Math.PI / 2;
  felt.position.y = TABLE_TOP + 0.002;
  g.add(rim, felt);
  return g;
}

function startJump(mesh, to, { duration = 720, lift = 0.72, scaleTo, onDone } = {}) {
  if (!mesh) return;
  busy.add(mesh.userData.pieceId);
  motions.push({
    mesh,
    from: mesh.position.clone(),
    to: to.clone(),
    start: performance.now(),
    duration,
    lift,
    scaleFrom: mesh.scale.x,
    scaleTo: scaleTo ?? mesh.scale.x,
    onDone
  });
}

function advanceMotions(now) {
  for (let i = motions.length - 1; i >= 0; i--) {
    const m = motions[i];
    const t = Math.min(1, (now - m.start) / m.duration);
    const k = easeSmooth(t);
    m.mesh.position.lerpVectors(m.from, m.to, k);
    m.mesh.position.y += Math.sin(t * Math.PI) * m.lift;
    const squash = t > 0.82 ? 1 - 0.18 * Math.sin(((t - 0.82) / 0.18) * Math.PI) : 1;
    const s = m.scaleFrom + (m.scaleTo - m.scaleFrom) * k;
    m.mesh.scale.set(s, s * squash, s);
    if (t >= 1) {
      m.mesh.position.copy(m.to);
      m.mesh.scale.setScalar(m.scaleTo);
      motions.splice(i, 1);
      const id = m.mesh.userData.pieceId;
      if (id) busy.delete(id);
      m.onDone?.();
    }
  }
}

function ensurePiece(piece) {
  let mesh = pieceMeshes.get(piece.id);
  if (!mesh) {
    mesh = createAnimal(piece.type, piece.color);
    mesh.userData.pieceId = piece.id;
    scene.add(mesh);
    pieceMeshes.set(piece.id, mesh);
  } else if (mesh.userData.type !== piece.type) {
    setAnimalType(mesh, piece.type);
    if (!busy.has(piece.id)) mesh.scale.setScalar(mesh.userData.baseScale);
  }
  mesh.visible = true;
  return mesh;
}

function layoutIdle(board, players, seatOf) {
  const poolIndex = new Map();
  players.forEach((p) => {
    const byType = { kitten: [], cat: [] };
    p.pool.forEach((piece) => byType[piece.type]?.push(piece));
    ['kitten', 'cat'].forEach((type) => {
      byType[type].forEach((piece, i) => {
        if (busy.has(piece.id)) return;
        const mesh = ensurePiece(piece);
        const seat = seatOf.get(p.id) ?? 0;
        const base = basketWorld(seat, type);
        const scatter = basketScatter(piece.id, i, byType[type].length);
        mesh.position.set(base.x + scatter.x, TABLE_TOP + 0.12, base.z + scatter.z);
        mesh.scale.setScalar(mesh.userData.baseScale);
        mesh.rotation.y = seat === 0 ? 0 : Math.PI;
      });
    });
  });
  board.forEach((piece, i) => {
    if (!piece || busy.has(piece.id)) return;
    const mesh = ensurePiece(piece);
    const p = cellWorld(i);
    mesh.position.copy(p);
    mesh.position.y = TABLE_TOP + 0.07;
    mesh.scale.setScalar(mesh.userData.baseScale);
  });
  const live = new Set();
  players.forEach((p) => p.pool.forEach((piece) => live.add(piece.id)));
  board.forEach((piece) => piece && live.add(piece.id));
  for (const [id, mesh] of pieceMeshes) {
    if (!live.has(id) && !busy.has(id)) mesh.visible = false;
  }
}

function playMove(move, seatOf) {
  if (!move?.placedId) return;
  const involved = [move.placedId, ...(move.boops || []).map((b) => b.id), ...(move.graduated || []).map((g) => g.id)];
  involved.forEach((id) => busy.add(id));
  (move.boops || []).forEach((b) => {
    const mesh = pieceMeshes.get(b.id);
    if (!mesh) return;
    const p = cellWorld(b.from);
    p.y = TABLE_TOP + 0.07;
    mesh.position.copy(p);
    mesh.visible = true;
  });
  (move.graduated || []).forEach((g) => {
    if ((move.boops || []).some((b) => b.id === g.id)) return;
    const mesh = pieceMeshes.get(g.id);
    if (!mesh) return;
    const p = cellWorld(g.from);
    p.y = TABLE_TOP + 0.07;
    mesh.position.copy(p);
    mesh.visible = true;
  });
  const jumper = pieceMeshes.get(move.placedId);
  if (!jumper) return;
  const seat = seatOf.get(move.playerId) ?? 0;
  const from = basketWorld(seat, move.placedType);
  const dest = cellWorld(move.placedIndex);
  dest.y = TABLE_TOP + 0.07;
  jumper.position.copy(from);
  jumper.position.y = TABLE_TOP + 0.12;
  jumper.visible = true;
  jumper.scale.setScalar(jumper.userData.baseScale);

  startJump(jumper, dest, {
    duration: 780,
    lift: 0.9,
    onDone: () => {
      move.boops.forEach((b, i) => {
        const mesh = pieceMeshes.get(b.id);
        if (!mesh) return;
        const delay = i * 30;
        window.setTimeout(() => {
          if (b.to < 0) {
            const ownerSeat = seatOf.get(b.ownerId) ?? 0;
            const to = basketWorld(ownerSeat, b.type);
            to.y = TABLE_TOP + 0.12;
            startJump(mesh, to, { duration: 560, lift: 0.55 });
          } else {
            const to = cellWorld(b.to);
            to.y = TABLE_TOP + 0.07;
            startJump(mesh, to, { duration: 480, lift: 0.42 });
          }
        }, delay);
      });
      const wait = 120 + Math.max(0, move.boops.length) * 40 + (move.boops.length ? 520 : 0);
      window.setTimeout(() => playGraduation(move, seatOf), wait);
    }
  });
}

function playGraduation(move, seatOf) {
  const list = move.graduated || [];
  if (!list.length) return;
  list.forEach((g, i) => {
    const mesh = pieceMeshes.get(g.id);
    if (!mesh) return;
    window.setTimeout(() => {
      setAnimalType(mesh, 'cat');
      const here = mesh.position.clone();
      here.y = TABLE_TOP + 0.07;
      startJump(mesh, here, {
        duration: 620,
        lift: 0.22,
        scaleTo: 1,
        onDone: () => {
          const seat = seatOf.get(g.ownerId) ?? 0;
          const to = basketWorld(seat, 'cat');
          to.y = TABLE_TOP + 0.12;
          startJump(mesh, to, { duration: 720, lift: 0.7 });
        }
      });
    }, i * 90);
  });
}

function applyOrbit() {
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

function ensureScene() {
  if (mounted && canvas?.isConnected) return;
  teardown();
  mounted = true;
  canvas = document.createElement('canvas');
  canvas.id = 'boop-3d-canvas';
  canvas.style.cssText = 'position:fixed;pointer-events:none;display:none;z-index:5';
  document.body.appendChild(canvas);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 80);
  scene.add(new THREE.HemisphereLight(0xe8f0ea, 0x1a120c, 0.42));
  scene.add(new THREE.AmbientLight(0xf2eee6, 0.18));
  const key = new THREE.DirectionalLight(0xfff6e8, 0.55);
  key.position.set(2.2, 7, 4.5);
  scene.add(key);
  scene.add(createTable());
  scene.add(createBoard());
  const b0k = createBasket();
  const p0k = basketWorld(0, 'kitten');
  b0k.position.set(p0k.x, TABLE_TOP + 0.12, p0k.z);
  const b0c = createBasket();
  const p0c = basketWorld(0, 'cat');
  b0c.position.set(p0c.x, TABLE_TOP + 0.12, p0c.z);
  const b1k = createBasket();
  const p1k = basketWorld(1, 'kitten');
  b1k.position.set(p1k.x, TABLE_TOP + 0.12, p1k.z);
  const b1c = createBasket();
  const p1c = basketWorld(1, 'cat');
  b1c.position.set(p1c.x, TABLE_TOP + 0.12, p1c.z);
  scene.add(b0k, b0c, b1k, b1c);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  applyOrbit();
  const tick = () => {
    animationHandle = requestAnimationFrame(tick);
    if (renderer && scene && camera) {
      advanceMotions(performance.now());
      renderer.render(scene, camera);
      if (motions.length && overlaySync) overlaySync();
    }
  };
  tick();
}

export function setOverlaySync(fn) {
  overlaySync = typeof fn === 'function' ? fn : null;
}

export function orbitCameraByScreenDelta(dx, dy) {
  if (!mounted) return;
  orbitPitch = Math.max(0.45, Math.min(1.28, orbitPitch + dy * 0.006));
  orbitYaw -= dx * 0.008;
  if (orbitYawLimited) orbitYaw = Math.max(-0.7, Math.min(0.7, orbitYaw));
  applyOrbit();
}

export function zoomCameraByFactor(factor) {
  if (!mounted || !Number.isFinite(factor) || factor <= 0) return;
  orbitDistance = Math.max(3.4, Math.min(9.5, orbitDistance / factor));
  applyOrbit();
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
  applyOrbit();
}

export function showTable() {
  ensureScene();
  if (canvas) canvas.style.display = 'block';
}

export function hideTable() {
  overlaySync = null;
  if (canvas) canvas.style.display = 'none';
}

export function resetOrbit() {
  orbitYaw = 0;
  orbitPitch = 1.02;
  orbitDistance = 6.2;
  if (mounted) applyOrbit();
}

export function updateTable({ board = [], players = [], lastMove = null, spectator = false } = {}) {
  if (!mounted) return;
  orbitYawLimited = !spectator;
  const seatOf = new Map();
  players.forEach((p, i) => seatOf.set(p.id, i));
  players.forEach((p) => {
    p.pool.forEach((piece) => ensurePiece(piece));
  });
  board.forEach((piece) => piece && ensurePiece(piece));

  if (lastMove?.id && lastMove.id !== lastAnimatedId && lastAnimatedId !== null) {
    lastAnimatedId = lastMove.id;
    playMove(lastMove, seatOf);
  } else if (lastAnimatedId === null) {
    lastAnimatedId = lastMove?.id || 'init';
  }
  layoutIdle(board, players, seatOf);
}

function projectAt(x, y, z, half) {
  if (!mounted || !camera || !canvas) return null;
  camera.updateMatrixWorld();
  const w = parseFloat(canvas.style.width) || 1;
  const h = parseFloat(canvas.style.height) || 1;
  const xs = [];
  const ys = [];
  for (const [dx, dz] of [
    [-half, -half],
    [half, -half],
    [half, half],
    [-half, half]
  ]) {
    _corner.set(x + dx, y, z + dz).project(camera);
    xs.push((_corner.x * 0.5 + 0.5) * w);
    ys.push((-_corner.y * 0.5 + 0.5) * h);
  }
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

export function getCellRects() {
  return Array.from({ length: 36 }, (_, i) => {
    const p = cellWorld(i);
    return projectAt(p.x, p.y, p.z, CELL * 0.42);
  });
}

export function getBasketRects() {
  const kit = basketWorld(0, 'kitten');
  const cat = basketWorld(0, 'cat');
  return [
    { type: 'kitten', ...(projectAt(kit.x, TABLE_TOP + 0.16, kit.z, 0.38) || {}) },
    { type: 'cat', ...(projectAt(cat.x, TABLE_TOP + 0.16, cat.z, 0.38) || {}) }
  ];
}
