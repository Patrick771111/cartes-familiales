import * as THREE from 'three';
import idleKittenOrange from '../assets/games/boop/idle-kitten-orange.png';
import idleKittenGray from '../assets/games/boop/idle-kitten-gray.png';
import idleCatOrange from '../assets/games/boop/idle-cat-orange.png';
import idleCatGray from '../assets/games/boop/idle-cat-gray.png';
import runOrange from '../assets/games/boop/run-orange.png';
import runGray from '../assets/games/boop/run-gray.png';
import jumpOrange from '../assets/games/boop/jump-orange.png';
import jumpGray from '../assets/games/boop/jump-gray.png';
import duvetUrl from '../assets/games/boop/duvet.jpg';

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
const DUVET_Y = TABLE_TOP + 0.16;

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

const IDLE_URL = {
  'kitten-orange': idleKittenOrange,
  'kitten-gray': idleKittenGray,
  'cat-orange': idleCatOrange,
  'cat-gray': idleCatGray
};
const RUN_URL = { orange: runOrange, gray: runGray };
const JUMP_URL = { orange: jumpOrange, gray: jumpGray };

const pieceMeshes = new Map();
const busy = new Set();
const motions = [];
let lastAnimatedId = null;
let kawaiiMode = false;
const textureLoader = new THREE.TextureLoader();
const sheetCache = new Map();

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
  return new THREE.Vector3((col - 2.5) * CELL, DUVET_Y, (row - 2.5) * CELL);
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

function loadSheet(url) {
  if (sheetCache.has(url)) return sheetCache.get(url);
  const tex = textureLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  sheetCache.set(url, tex);
  return tex;
}

function spriteUrl(type, color, clip) {
  if (clip === 'run') return RUN_URL[color] || RUN_URL.orange;
  if (clip === 'jump') return JUMP_URL[color] || JUMP_URL.orange;
  return IDLE_URL[`${type}-${color}`] || IDLE_URL['kitten-orange'];
}

function applyClip(mesh, clip) {
  if (!mesh?.userData.plane) return;
  mesh.userData.clip = clip;
  mesh.userData.animT = 0;
  const url = spriteUrl(mesh.userData.type, mesh.userData.color, clip);
  const base = loadSheet(url);
  const tex = base.clone();
  tex.needsUpdate = true;
  if (clip === 'idle') {
    tex.repeat.set(1, 1);
    tex.offset.set(0, 0);
  } else {
    tex.repeat.set(0.25, 1);
    tex.offset.set(0, 0);
  }
  const prev = mesh.userData.plane.material.map;
  mesh.userData.plane.material.map = tex;
  mesh.userData.plane.material.needsUpdate = true;
  if (prev && prev !== base && !sheetCache.has(prev.image?.src)) {
    /* cloned frame textures are cheap; leave them */
  }
}

function createKawaiiAnimal(type, color) {
  const g = new THREE.Group();
  const s = type === 'cat' ? 0.58 : 0.44;
  const mat = new THREE.MeshBasicMaterial({
    transparent: true,
    alphaTest: 0.12,
    depthWrite: true,
    color: 0xffffff
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  plane.scale.set(s, s, 1);
  plane.position.y = s * 0.42;
  g.add(plane);
  g.userData.plane = plane;
  g.userData.type = type;
  g.userData.color = color;
  g.userData.baseScale = 1;
  g.userData.spriteSize = s;
  g.userData.facing = 1;
  g.userData.clip = 'idle';
  g.userData.kawaii = true;
  applyClip(g, 'idle');
  return g;
}

function createAnimal(type, color) {
  if (kawaiiMode) return createKawaiiAnimal(type, color);
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
  if (mesh.userData.kawaii) {
    mesh.userData.spriteSize = type === 'cat' ? 0.58 : 0.44;
    applyClip(mesh, mesh.userData.clip || 'idle');
  } else {
    mesh.userData.baseScale = type === 'cat' ? 1 : 0.72;
  }
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
  const frame = makeMat({ color: 0x6b4423, roughness: 0.68 });
  const rail = makeMat({ color: 0x8a6234, roughness: 0.7 });
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(BOARD + 0.34, 0.12, BOARD + 0.46), frame);
  mattress.position.set(0, TABLE_TOP + 0.06, -0.05);
  g.add(mattress);
  const head = new THREE.Mesh(new THREE.BoxGeometry(BOARD + 0.38, 0.46, 0.09), frame);
  head.position.set(0, TABLE_TOP + 0.28, -(BOARD + 0.46) / 2 - 0.05);
  g.add(head);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(BOARD + 0.38, 0.18, 0.07), rail);
  foot.position.set(0, TABLE_TOP + 0.14, (BOARD + 0.46) / 2 - 0.05);
  g.add(foot);

  const tex = textureLoader.load(duvetUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  const duvet = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD + 0.04, BOARD + 0.04),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.94, metalness: 0, color: 0xffffff })
  );
  duvet.rotation.x = -Math.PI / 2;
  duvet.position.y = DUVET_Y - 0.002;
  g.add(duvet);
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

function faceToward(mesh, from, to) {
  const dx = to.x - from.x;
  if (Math.abs(dx) > 0.02) mesh.userData.facing = dx >= 0 ? 1 : -1;
}

function startJump(mesh, to, { duration = 720, lift = 0.72, scaleTo, clip, keepBusy = false, onDone } = {}) {
  if (!mesh) return;
  busy.add(mesh.userData.pieceId);
  if (clip && mesh.userData.kawaii) applyClip(mesh, clip);
  faceToward(mesh, mesh.position, to);
  motions.push({
    mesh,
    from: mesh.position.clone(),
    to: to.clone(),
    start: performance.now(),
    duration,
    lift,
    scaleFrom: mesh.scale.x,
    scaleTo: scaleTo ?? mesh.scale.x,
    clip,
    keepBusy,
    onDone
  });
}

function startTravel(mesh, to, { onDone } = {}) {
  if (!mesh) {
    onDone?.();
    return;
  }
  const from = mesh.position.clone();
  const dist = Math.hypot(to.x - from.x, to.z - from.z);
  if (!mesh.userData.kawaii || dist < 0.32) {
    startJump(mesh, to, { duration: dist < 0.32 ? 420 : 780, lift: dist < 0.32 ? 0.38 : 0.9, clip: 'jump', onDone });
    return;
  }
  const ground = to.clone();
  ground.y = DUVET_Y;
  const runFrom = from.clone();
  runFrom.y = DUVET_Y;
  mesh.position.copy(runFrom);
  const runDur = Math.min(1300, 380 + dist * 480);
  startJump(mesh, ground, {
    duration: runDur,
    lift: 0.05,
    clip: 'run',
    keepBusy: true,
    onDone: () => {
      startJump(mesh, to, { duration: 440, lift: 0.42, clip: 'jump', onDone });
    }
  });
}

function advanceMotions(now) {
  for (let i = motions.length - 1; i >= 0; i--) {
    const m = motions[i];
    const t = Math.min(1, (now - m.start) / m.duration);
    const k = easeSmooth(t);
    m.mesh.position.lerpVectors(m.from, m.to, k);
    m.mesh.position.y += Math.sin(t * Math.PI) * m.lift;
    const squash = m.mesh.userData.kawaii ? 1 : t > 0.82 ? 1 - 0.18 * Math.sin(((t - 0.82) / 0.18) * Math.PI) : 1;
    const s = m.scaleFrom + (m.scaleTo - m.scaleFrom) * k;
    m.mesh.scale.set(s, s * squash, s);
    if (t >= 1) {
      m.mesh.position.copy(m.to);
      m.mesh.scale.setScalar(m.scaleTo);
      motions.splice(i, 1);
      const id = m.mesh.userData.pieceId;
      if (!m.keepBusy) {
        if (id) busy.delete(id);
        if (m.mesh.userData.kawaii) applyClip(m.mesh, 'idle');
      }
      m.onDone?.();
    }
  }
}

function advanceSprites(now) {
  if (!camera) return;
  for (const mesh of pieceMeshes.values()) {
    const plane = mesh.userData.plane;
    if (!plane) continue;
    plane.quaternion.copy(camera.quaternion);
    const size = mesh.userData.spriteSize || 0.44;
    const facing = mesh.userData.facing || 1;
    plane.scale.set(size * facing, size, 1);
    const clip = mesh.userData.clip || 'idle';
    const frames = clip === 'idle' ? 1 : 4;
    if (frames === 1) continue;
    const fps = clip === 'run' ? 11 : 9;
    const frame = Math.floor((now / 1000) * fps) % frames;
    const map = plane.material.map;
    if (map) map.offset.x = frame * 0.25;
  }
}

function ensurePiece(piece) {
  let mesh = pieceMeshes.get(piece.id);
  if (mesh && Boolean(mesh.userData.kawaii) !== kawaiiMode) {
    scene.remove(mesh);
    pieceMeshes.delete(piece.id);
    mesh = null;
  }
  if (!mesh) {
    mesh = createAnimal(piece.type, piece.color);
    mesh.userData.pieceId = piece.id;
    scene.add(mesh);
    pieceMeshes.set(piece.id, mesh);
  } else if (mesh.userData.type !== piece.type) {
    setAnimalType(mesh, piece.type);
    if (!busy.has(piece.id) && !mesh.userData.kawaii) mesh.scale.setScalar(mesh.userData.baseScale);
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
      const shown = Math.min(2, byType[type].length);
      byType[type].forEach((piece, i) => {
        if (busy.has(piece.id)) return;
        const mesh = ensurePiece(piece);
        if (i >= shown) {
          mesh.visible = false;
          return;
        }
        const seat = seatOf.get(p.id) ?? 0;
        const base = basketWorld(seat, type);
        const scatter = basketScatter(piece.id, i, shown);
        mesh.position.set(base.x + scatter.x, TABLE_TOP + 0.12, base.z + scatter.z);
        mesh.scale.setScalar(mesh.userData.baseScale);
        if (!mesh.userData.kawaii) mesh.rotation.y = seat === 0 ? 0 : Math.PI;
      });
    });
  });
  board.forEach((piece, i) => {
    if (!piece || busy.has(piece.id)) return;
    const mesh = ensurePiece(piece);
    const p = cellWorld(i);
    mesh.position.copy(p);
    mesh.position.y = DUVET_Y;
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
    p.y = DUVET_Y;
    mesh.position.copy(p);
    mesh.visible = true;
  });
  (move.graduated || []).forEach((g) => {
    if ((move.boops || []).some((b) => b.id === g.id)) return;
    const mesh = pieceMeshes.get(g.id);
    if (!mesh) return;
    const p = cellWorld(g.from);
    p.y = DUVET_Y;
    mesh.position.copy(p);
    mesh.visible = true;
  });
  const jumper = pieceMeshes.get(move.placedId);
  if (!jumper) return;
  const seat = seatOf.get(move.playerId) ?? 0;
  const from = basketWorld(seat, move.placedType);
  const dest = cellWorld(move.placedIndex);
  dest.y = DUVET_Y;
  jumper.position.copy(from);
  jumper.position.y = TABLE_TOP + 0.12;
  jumper.visible = true;
  jumper.scale.setScalar(jumper.userData.baseScale);

  const afterLand = () => {
    move.boops.forEach((b, i) => {
      const mesh = pieceMeshes.get(b.id);
      if (!mesh) return;
      window.setTimeout(() => {
        if (b.to < 0) {
          const ownerSeat = seatOf.get(b.ownerId) ?? 0;
          const to = basketWorld(ownerSeat, b.type);
          to.y = TABLE_TOP + 0.12;
          startTravel(mesh, to);
        } else {
          const to = cellWorld(b.to);
          to.y = DUVET_Y;
          startJump(mesh, to, { duration: 480, lift: 0.42, clip: 'jump' });
        }
      }, i * 40);
    });
    const wait = 140 + Math.max(0, move.boops.length) * 50 + (move.boops.length ? 700 : 0);
    window.setTimeout(() => playGraduation(move, seatOf), wait);
  };
  if (kawaiiMode) startTravel(jumper, dest, { onDone: afterLand });
  else startJump(jumper, dest, { duration: 780, lift: 0.9, onDone: afterLand });
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
      here.y = DUVET_Y;
      startJump(mesh, here, {
        duration: 620,
        lift: 0.22,
        scaleTo: mesh.userData.kawaii ? 1 : 1,
        clip: 'idle',
        onDone: () => {
          const seat = seatOf.get(g.ownerId) ?? 0;
          const to = basketWorld(seat, 'cat');
          to.y = TABLE_TOP + 0.12;
          startTravel(mesh, to);
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
      const now = performance.now();
      advanceMotions(now);
      advanceSprites(now);
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

export function updateTable({ board = [], players = [], lastMove = null, spectator = false, kawaii = false } = {}) {
  if (!mounted) return;
  if (kawaiiMode !== kawaii) {
    kawaiiMode = kawaii;
    for (const mesh of pieceMeshes.values()) scene.remove(mesh);
    pieceMeshes.clear();
    busy.clear();
    motions.length = 0;
    lastAnimatedId = lastMove?.id || 'init';
  }
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
  const out = [];
  for (const seat of [0, 1]) {
    for (const type of ['kitten', 'cat']) {
      const p = basketWorld(seat, type);
      const r = projectAt(p.x, TABLE_TOP + 0.16, p.z, 0.38);
      out.push({ seat, type, ...(r || {}) });
    }
  }
  return out;
}
