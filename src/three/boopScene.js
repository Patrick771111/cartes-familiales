import * as THREE from 'three';
import idleKittenOrange from '../assets/games/boop/idle-kitten-orange.png';
import idleKittenGray from '../assets/games/boop/idle-kitten-gray.png';
import idleCatOrange from '../assets/games/boop/idle-cat-orange.png';
import idleCatGray from '../assets/games/boop/idle-cat-gray.png';
import runOrange from '../assets/games/boop/run-orange.png';
import runGray from '../assets/games/boop/run-gray.png';
import jumpOrange from '../assets/games/boop/jump-orange.png';
import jumpGray from '../assets/games/boop/jump-gray.png';
import danceOrange from '../assets/games/boop/dance-orange.png';
import danceGray from '../assets/games/boop/dance-gray.png';
import duvetUrl from '../assets/games/boop/duvet.jpg';
import wallpaperUrl from '../assets/games/boop/wallpaper.jpg';
import floorUrl from '../assets/games/boop/floor.jpg';
import windowUrl from '../assets/games/boop/window.jpg';
import curtainUrl from '../assets/games/boop/curtain.jpg';

/**
 * Scène 3D Boop — chambre kawaii (style illustration), lit 6×6 et paniers.
 * Un pion saute depuis son panier ; le rebond à l'atterrissage
 * pousse les voisins (boop). Un alignement de 3 avec au moins un chaton :
 * les chatons grandissent, puis toute la ligne rejoint le panier des chats.
 * Trois chats alignés dansent sur leurs pattes arrière.
 */

const CAMERA_FOV = 46;
const TABLE_THICKNESS = 0.14;
const TABLE_TOP = TABLE_THICKNESS / 2;
const CELL = 0.36;
const GRID = 6;
const BOARD = CELL * GRID;
const DUVET_Y = TABLE_TOP + 0.16;
const BASKET_Y = 0.12;
const DEFAULT_YAW = 0;
const DEFAULT_PITCH = 0.92;
const DEFAULT_DIST = 6.05;

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
const DANCE_URL = { orange: danceOrange, gray: danceGray };

const pieceMeshes = new Map();
const busy = new Set();
const motions = [];
const dancers = new Map();
let lastAnimatedId = null;
let victoryQueued = false;
const textureLoader = new THREE.TextureLoader();
const sheetCache = new Map();

const _corner = new THREE.Vector3();
const _look = new THREE.Vector3();

let orbitYaw = DEFAULT_YAW;
let orbitPitch = DEFAULT_PITCH;
let orbitDistance = DEFAULT_DIST;
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
  dancers.clear();
  victoryQueued = false;
}

if (import.meta.hot) import.meta.hot.dispose(teardown);

function makeMat(opts = {}) {
  return new THREE.MeshStandardMaterial({ roughness: 0.62, metalness: 0.04, ...opts });
}

function loadMap(url, nx = 1, ny = 1) {
  const tex = textureLoader.load(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(nx, ny);
  tex.anisotropy = 4;
  return tex;
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
  if (seat === 0) {
    const x = type === 'kitten' ? 1.35 : -1.35;
    return new THREE.Vector3(x, TABLE_TOP + 0.04, 1.68);
  }
  const x = type === 'kitten' ? -1.55 : 1.55;
  return new THREE.Vector3(x, TABLE_TOP + 0.04, -1.12);
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
  if (clip === 'dance') return DANCE_URL[color] || DANCE_URL.orange;
  return IDLE_URL[`${type}-${color}`] || IDLE_URL['kitten-orange'];
}

function applyClip(mesh, clip) {
  if (!mesh?.userData.plane) return;
  mesh.userData.clip = clip;
  mesh.userData.animT = 0;
  const url = spriteUrl(mesh.userData.type, mesh.userData.color, clip);
  const base = loadSheet(url);
  const paint = () => {
    if (!mesh.userData.plane || mesh.userData.clip !== clip || !base.image) return;
    const tex = base.clone();
    tex.image = base.image;
    tex.needsUpdate = true;
    if (clip === 'run' || clip === 'jump' || clip === 'dance') {
      tex.repeat.set(0.25, 1);
      tex.offset.set(0, 0);
    } else {
      tex.repeat.set(1, 1);
      tex.offset.set(0, 0);
    }
    mesh.userData.plane.material.map = tex;
    mesh.userData.plane.material.needsUpdate = true;
  };
  if (base.image && base.image.width) paint();
  else {
    const start = performance.now();
    const wait = () => {
      if (base.image && base.image.width) paint();
      else if (performance.now() - start < 8000) requestAnimationFrame(wait);
    };
    wait();
  }
}

function createAnimal(type, color) {
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
  applyClip(g, 'idle');
  return g;
}

function setAnimalType(mesh, type) {
  if (!mesh || mesh.userData.type === type) return;
  mesh.userData.type = type;
  mesh.userData.spriteSize = type === 'cat' ? 0.58 : 0.44;
  applyClip(mesh, mesh.userData.clip || 'idle');
}

function createBasket(kind = 'kitten') {
  const g = new THREE.Group();
  const wood = makeMat({ color: 0x8b5a2b, roughness: 0.82 });
  const rim = makeMat({ color: 0xc4a574, roughness: 0.7 });
  const lining = makeMat({ color: kind === 'cat' ? 0xd9c6f0 : 0xf8d5c8, roughness: 0.92 });
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.28, 0.2, 20, 1, true), wood);
  wall.material.side = THREE.DoubleSide;
  const floor = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), wood);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.1;
  const cloth = new THREE.Mesh(new THREE.CircleGeometry(0.255, 20), lining);
  cloth.rotation.x = -Math.PI / 2;
  cloth.position.y = -0.085;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.025, 8, 20), rim);
  lip.rotation.x = Math.PI / 2;
  lip.position.y = 0.1;
  g.add(wall, floor, cloth, lip);
  g.position.y = BASKET_Y;
  return g;
}

function addBox(parent, w, h, d, x, y, z, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}

function createLamp() {
  const g = new THREE.Group();
  const stemWood = makeMat({ color: 0xe2b56a, roughness: 0.48 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 0.22, 10), stemWood);
  stem.position.y = 0.14;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.07, 0.025, 12), stemWood);
  base.position.y = 0.012;
  const pink = makeMat({ color: 0xf4a8c0, roughness: 0.7, emissive: 0xf4a8c0, emissiveIntensity: 0.14, side: THREE.DoubleSide });
  const shade = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.125, 0.12, 16, 1, true), pink);
  shade.position.y = 0.3;
  const cap = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), pink);
  cap.rotation.x = -Math.PI / 2;
  cap.position.y = 0.36;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const scallop = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), pink);
    scallop.position.set(Math.cos(a) * 0.12, 0.245, Math.sin(a) * 0.12);
    g.add(scallop);
  }
  const glow = new THREE.PointLight(0xffd4e4, 0.32, 2.4);
  glow.position.y = 0.28;
  g.add(stem, base, shade, cap, glow);
  return g;
}

function createPot() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.07, 0.055, 0.1, 12),
    makeMat({ color: 0xf7f2ea, roughness: 0.52 })
  );
  pot.position.y = 0.05;
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(0.06, 12), makeMat({ color: 0x6b4a32, roughness: 1 }));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = 0.102;
  g.add(pot, dirt);
  return g;
}

function createFern() {
  const g = createPot();
  const leaf = makeMat({ color: 0x4f9a55, roughness: 0.55 });
  for (let i = 0; i < 9; i++) {
    const frond = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), leaf);
    const a = (i / 9) * Math.PI * 2;
    frond.scale.set(0.35, 0.22, 1.15);
    frond.position.set(Math.cos(a) * 0.06, 0.16, Math.sin(a) * 0.06);
    frond.lookAt(Math.cos(a) * 0.4, 0.28, Math.sin(a) * 0.4);
    g.add(frond);
  }
  return g;
}

function createPothos() {
  const g = createPot();
  const leaf = makeMat({ color: 0x63b36a, roughness: 0.52 });
  const spots = [
    [0.04, 0.2, 0.02],
    [-0.05, 0.22, 0.04],
    [0.02, 0.26, -0.05],
    [-0.03, 0.18, -0.04],
    [0.06, 0.24, 0.05],
    [-0.06, 0.28, 0]
  ];
  for (const [x, y, z] of spots) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), leaf);
    l.scale.set(1.2, 0.35, 0.85);
    l.position.set(x, y, z);
    l.rotation.z = x > 0 ? -0.4 : 0.4;
    g.add(l);
  }
  return g;
}

function createSucculent() {
  const g = createPot();
  g.scale.setScalar(0.7);
  const leaf = makeMat({ color: 0x7db86a, roughness: 0.5 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), leaf);
    l.scale.set(0.55, 0.9, 0.4);
    l.position.set(Math.cos(a) * 0.035, 0.14, Math.sin(a) * 0.035);
    g.add(l);
  }
  return g;
}

function createNightstand() {
  const g = new THREE.Group();
  const white = makeMat({ color: 0xf6f1ea, roughness: 0.52 });
  const drawer = makeMat({ color: 0xeee6dc, roughness: 0.55 });
  const knob = makeMat({ color: 0xe8dccf, roughness: 0.4 });
  addBox(g, 0.5, 0.38, 0.42, 0, 0.19, 0, white);
  addBox(g, 0.52, 0.03, 0.44, 0, 0.395, 0, white);
  addBox(g, 0.42, 0.13, 0.02, 0, 0.28, 0.211, drawer);
  addBox(g, 0.42, 0.13, 0.02, 0, 0.13, 0.211, drawer);
  const k1 = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), knob);
  k1.position.set(0, 0.28, 0.23);
  const k2 = k1.clone();
  k2.position.y = 0.13;
  g.add(k1, k2);
  return g;
}

function createRoom() {
  const g = new THREE.Group();
  const W = 6.8;
  const zBack = -2.58;
  const zFront = 3.35;
  const D = zFront - zBack;
  const zMid = (zBack + zFront) / 2;
  const H = 2.55;
  const xL = -W / 2;
  const xR = W / 2;

  const wallMat = makeMat({ map: loadMap(wallpaperUrl, 3.1, 1.55), roughness: 0.94, color: 0xffffff });
  const trim = makeMat({ color: 0xfffaf4, roughness: 0.62 });
  const honey = makeMat({ map: loadMap(floorUrl, 1.8, 1.8), roughness: 0.6, color: 0xf2d7a8 });
  const curtainMat = makeMat({
    map: loadMap(curtainUrl, 2.2, 3.2),
    roughness: 0.84,
    side: THREE.DoubleSide,
    color: 0xffffff
  });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(W, D),
    makeMat({ map: loadMap(floorUrl, 5.2, 4.4), roughness: 0.88, color: 0xffffff })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, zMid);
  g.add(floor);

  const back = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
  back.position.set(0, H / 2, zBack);
  g.add(back);
  const left = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat);
  left.rotation.y = Math.PI / 2;
  left.position.set(xL, H / 2, zMid);
  g.add(left);
  const right = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat);
  right.rotation.y = -Math.PI / 2;
  right.position.set(xR, H / 2, zMid);
  g.add(right);

  addBox(g, W, 0.12, 0.06, 0, 0.06, zBack + 0.03, trim);
  addBox(g, 0.06, 0.12, D, xL + 0.03, 0.06, zMid, trim);
  addBox(g, 0.06, 0.12, D, xR - 0.03, 0.06, zMid, trim);

  const winW = 1.72;
  const winH = 1.12;
  const winY = 1.64;
  const skyMap = loadMap(windowUrl, 1, 1);
  skyMap.wrapS = THREE.ClampToEdgeWrapping;
  skyMap.wrapT = THREE.ClampToEdgeWrapping;
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(winW, winH), new THREE.MeshBasicMaterial({ map: skyMap }));
  sky.position.set(0, winY, zBack + 0.03);
  g.add(sky);
  addBox(g, winW + 0.2, 0.08, 0.1, 0, winY + winH / 2 + 0.02, zBack + 0.07, trim);
  addBox(g, winW + 0.2, 0.08, 0.1, 0, winY - winH / 2 - 0.02, zBack + 0.07, trim);
  addBox(g, 0.08, winH + 0.2, 0.1, -winW / 2 - 0.02, winY, zBack + 0.07, trim);
  addBox(g, 0.08, winH + 0.2, 0.1, winW / 2 + 0.02, winY, zBack + 0.07, trim);
  addBox(g, winW + 0.28, 0.06, 0.18, 0, winY - winH / 2 - 0.08, zBack + 0.14, trim);

  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 2.4, 8), honey);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(0, winY + winH / 2 + 0.1, zBack + 0.16);
  g.add(rod);
  const addCurtain = (side) => {
    const x = side * 1.08;
    const p1 = new THREE.Mesh(new THREE.PlaneGeometry(0.32, 1.72), curtainMat);
    p1.position.set(x - side * 0.08, winY - 0.24, zBack + 0.14);
    p1.rotation.y = side * 0.28;
    const p2 = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 1.72), curtainMat);
    p2.position.set(x + side * 0.1, winY - 0.24, zBack + 0.18);
    p2.rotation.y = -side * 0.18;
    g.add(p1, p2);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 6, 12), makeMat({ color: 0xf2c2d0, roughness: 0.6 }));
    tie.position.set(x, winY - 0.05, zBack + 0.2);
    tie.rotation.y = Math.PI / 2;
    g.add(tie);
  };
  addCurtain(-1);
  addCurtain(1);

  const succulent = createSucculent();
  succulent.position.set(0.42, winY - winH / 2 - 0.05, zBack + 0.2);
  g.add(succulent);

  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.78, 48), makeMat({ color: 0xf6e9b8, roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.006, 0.18);
  g.add(rug);
  const stitch = new THREE.Mesh(
    new THREE.RingGeometry(1.42, 1.46, 48),
    makeMat({ color: 0xe8d48a, roughness: 0.9, side: THREE.DoubleSide })
  );
  stitch.rotation.x = -Math.PI / 2;
  stitch.position.set(0, 0.008, 0.18);
  g.add(stitch);
  const fringe = makeMat({ color: 0xf4edd4, roughness: 0.9 });
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const tassel = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.01, 0.12), fringe);
    tassel.position.set(Math.cos(a) * 1.84, 0.007, 0.18 + Math.sin(a) * 1.84);
    tassel.rotation.y = -a;
    g.add(tassel);
  }

  const standZ = -1.95;
  const nsL = createNightstand();
  nsL.position.set(-2.42, 0, standZ);
  const nsR = createNightstand();
  nsR.position.set(2.42, 0, standZ);
  g.add(nsL, nsR);
  const fern = createFern();
  fern.position.set(-2.52, 0.4, standZ);
  g.add(fern);
  const pothos = createPothos();
  pothos.position.set(2.55, 0.4, standZ);
  g.add(pothos);
  const lampL = createLamp();
  lampL.position.set(-2.28, 0.4, standZ);
  g.add(lampL);
  const lampR = createLamp();
  lampR.position.set(2.28, 0.4, standZ);
  g.add(lampR);
  return g;
}

function createBoard() {
  const g = new THREE.Group();
  const honey = makeMat({ map: loadMap(floorUrl, 2.4, 2.4), roughness: 0.58, color: 0xf0d4a0 });
  const linen = makeMat({ color: 0xf6ead8, roughness: 0.9 });
  const frameW = BOARD + 0.4;
  const frameD = BOARD + 0.52;
  const mattress = new THREE.Mesh(new THREE.BoxGeometry(frameW, 0.12, frameD), honey);
  mattress.position.set(0, TABLE_TOP + 0.06, -0.05);
  g.add(mattress);
  const hz = -frameD / 2 - 0.05;
  addBox(g, frameW, 0.07, 0.08, 0, TABLE_TOP + 0.5, hz, honey);
  addBox(g, frameW, 0.07, 0.08, 0, TABLE_TOP + 0.16, hz, honey);
  addBox(g, 0.08, 0.42, 0.08, -frameW / 2 + 0.04, TABLE_TOP + 0.33, hz, honey);
  addBox(g, 0.08, 0.42, 0.08, frameW / 2 - 0.04, TABLE_TOP + 0.33, hz, honey);
  for (let i = 0; i < 6; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.34, 0.035), honey);
    slat.position.set((i - 2.5) * 0.3, TABLE_TOP + 0.33, hz + 0.02);
    g.add(slat);
  }
  const foot = new THREE.Mesh(new THREE.BoxGeometry(frameW, 0.14, 0.08), honey);
  foot.position.set(0, TABLE_TOP + 0.13, frameD / 2 - 0.05);
  g.add(foot);
  const addLeg = (x, z) => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.09, TABLE_TOP, 0.09), honey);
    leg.position.set(x, TABLE_TOP / 2, z);
    g.add(leg);
  };
  addLeg(-frameW / 2 + 0.08, -frameD / 2 + 0.08);
  addLeg(frameW / 2 - 0.08, -frameD / 2 + 0.08);
  addLeg(-frameW / 2 + 0.08, frameD / 2 - 0.08);
  addLeg(frameW / 2 - 0.08, frameD / 2 - 0.08);

  const tex = textureLoader.load(duvetUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  const duvet = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD, BOARD),
    new THREE.MeshBasicMaterial({ map: tex })
  );
  duvet.rotation.x = -Math.PI / 2;
  duvet.position.y = DUVET_Y - 0.002;
  g.add(duvet);

  const addPillow = (x) => {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.24, 16, 12), linen);
    p.scale.set(1.45, 0.38, 0.55);
    p.position.set(x, TABLE_TOP + 0.2, -BOARD / 2 + 0.02);
    g.add(p);
  };
  addPillow(-0.4);
  addPillow(0.4);
  return g;
}

function faceToward(mesh, from, to) {
  const dx = to.x - from.x;
  if (Math.abs(dx) > 0.02) mesh.userData.facing = dx >= 0 ? 1 : -1;
}

function startJump(mesh, to, { duration = 720, lift = 0.72, scaleTo, clip, keepBusy = false, onDone } = {}) {
  if (!mesh) return;
  busy.add(mesh.userData.pieceId);
  if (clip) applyClip(mesh, clip);
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
  if (dist < 0.32) {
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
    const s = m.scaleFrom + (m.scaleTo - m.scaleFrom) * k;
    m.mesh.scale.setScalar(s);
    if (t >= 1) {
      m.mesh.position.copy(m.to);
      m.mesh.scale.setScalar(m.scaleTo);
      motions.splice(i, 1);
      const id = m.mesh.userData.pieceId;
      if (!m.keepBusy) {
        if (id) busy.delete(id);
        applyClip(m.mesh, 'idle');
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
    const fps = clip === 'run' ? 11 : clip === 'dance' ? 7 : 9;
    const frame = Math.floor((now / 1000) * fps) % frames;
    const map = plane.material.map;
    if (map) map.offset.x = frame * 0.25;
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
        if (busy.has(piece.id) || dancers.has(piece.id)) return;
        const mesh = ensurePiece(piece);
        if (i >= shown) {
          mesh.visible = false;
          return;
        }
        const seat = seatOf.get(p.id) ?? 0;
        const base = basketWorld(seat, type);
        const scatter = basketScatter(piece.id, i, shown);
        mesh.position.set(base.x + scatter.x, BASKET_Y, base.z + scatter.z);
        mesh.scale.setScalar(mesh.userData.baseScale);
      });
    });
  });
  board.forEach((piece, i) => {
    if (!piece || busy.has(piece.id) || dancers.has(piece.id)) return;
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
  if (move.winCats?.length) victoryQueued = true;
  const involved = [
    move.placedId,
    ...(move.boops || []).map((b) => b.id),
    ...(move.graduated || []).map((g) => g.id),
    ...(move.winCats || []).map((c) => c.id)
  ];
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
  (move.winCats || []).forEach((c) => {
    if (c.id === move.placedId) return;
    if ((move.boops || []).some((b) => b.id === c.id)) return;
    const mesh = pieceMeshes.get(c.id);
    if (!mesh) return;
    const p = cellWorld(c.index);
    p.y = DUVET_Y;
    mesh.position.copy(p);
    mesh.visible = true;
  });
  const jumper = pieceMeshes.get(move.placedId);
  if (!jumper) {
    if (move.winCats?.length) startVictoryDance(move);
    return;
  }
  const seat = seatOf.get(move.playerId) ?? 0;
  const from = basketWorld(seat, move.placedType);
  const dest = cellWorld(move.placedIndex);
  dest.y = DUVET_Y;
  jumper.position.copy(from);
  jumper.position.y = BASKET_Y;
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
          to.y = BASKET_Y;
          startTravel(mesh, to);
        } else {
          const to = cellWorld(b.to);
          to.y = DUVET_Y;
          startJump(mesh, to, { duration: 480, lift: 0.42, clip: 'jump' });
        }
      }, i * 40);
    });
    const wait = 140 + Math.max(0, move.boops.length) * 50 + (move.boops.length ? 700 : 0);
    window.setTimeout(() => {
      playGraduation(move, seatOf);
      if (move.winCats?.length) startVictoryDance(move);
    }, wait);
  };
  startTravel(jumper, dest, { onDone: afterLand });
}

function playGraduation(move, seatOf) {
  const list = move.graduated || [];
  if (!list.length) return;
  const goToCatBasket = (mesh, g) => {
    const seat = seatOf.get(g.ownerId) ?? 0;
    const to = basketWorld(seat, 'cat');
    to.y = BASKET_Y;
    startTravel(mesh, to);
  };
  list.forEach((g, i) => {
    const mesh = pieceMeshes.get(g.id);
    if (!mesh) return;
    window.setTimeout(() => {
      if (g.fromType === 'cat') {
        goToCatBasket(mesh, g);
        return;
      }
      setAnimalType(mesh, 'cat');
      const here = mesh.position.clone();
      here.y = DUVET_Y;
      startJump(mesh, here, {
        duration: 620,
        lift: 0.22,
        scaleTo: 1,
        clip: 'idle',
        onDone: () => goToCatBasket(mesh, g)
      });
    }, i * 90);
  });
}

function resetPose(mesh) {
  if (!mesh) return;
  mesh.userData.dancing = false;
  mesh.rotation.z = 0;
  mesh.userData.spriteSize = mesh.userData.type === 'cat' ? 0.58 : 0.44;
  const plane = mesh.userData.plane;
  if (plane) plane.position.y = mesh.userData.spriteSize * 0.42;
  if (mesh.userData.clip === 'dance') applyClip(mesh, 'idle');
  mesh.scale.setScalar(mesh.userData.baseScale || 1);
}

function stopVictoryDance() {
  for (const { mesh } of dancers.values()) {
    const id = mesh.userData.pieceId;
    resetPose(mesh);
    if (id) busy.delete(id);
  }
  dancers.clear();
  victoryQueued = false;
}

function startVictoryDance(move) {
  const list = move.winCats || [];
  victoryQueued = false;
  if (!list.length) return;
  list.forEach((c, i) => {
    const mesh = pieceMeshes.get(c.id);
    if (!mesh) return;
    busy.add(c.id);
    mesh.userData.dancing = true;
    const home = cellWorld(c.index);
    home.y = DUVET_Y;
    mesh.position.copy(home);
    mesh.visible = true;
    mesh.userData.spriteSize = 0.72;
    applyClip(mesh, 'dance');
    dancers.set(c.id, {
      mesh,
      home,
      t0: performance.now() + i * 80,
      phase: ((hashId(c.id) % 628) / 100)
    });
  });
}

function advanceDances(now) {
  for (const d of dancers.values()) {
    const t = Math.max(0, (now - d.t0) / 1000);
    const stand = Math.min(1, t / 0.42);
    const e = easeSmooth(stand);
    const bounce = Math.abs(Math.sin((t + d.phase) * 8.2)) * 0.055 * e;
    const sway = Math.sin((t + d.phase) * 5.4) * 0.26 * e;
    d.mesh.position.copy(d.home);
    d.mesh.position.y = d.home.y + 0.12 * e + bounce;
    d.mesh.rotation.z = sway * 0.35;
    const plane = d.mesh.userData.plane;
    if (plane) plane.position.y = (d.mesh.userData.spriteSize || 0.72) * (0.42 + 0.08 * e);
  }
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
  scene.background = new THREE.Color(0xf4ead8);
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 80);
  scene.add(new THREE.HemisphereLight(0xfff4ea, 0xc4b29a, 0.55));
  scene.add(new THREE.AmbientLight(0xfff6ea, 0.32));
  const key = new THREE.DirectionalLight(0xfff3d8, 0.42);
  key.position.set(1.6, 6.2, 3.8);
  scene.add(key);
  const windowLight = new THREE.DirectionalLight(0xfff0c8, 0.22);
  windowLight.position.set(0, 2.4, -3.2);
  scene.add(windowLight);
  scene.add(createRoom());
  scene.add(createBoard());
  const b0k = createBasket('kitten');
  const p0k = basketWorld(0, 'kitten');
  b0k.position.set(p0k.x, BASKET_Y, p0k.z);
  const b0c = createBasket('cat');
  const p0c = basketWorld(0, 'cat');
  b0c.position.set(p0c.x, BASKET_Y, p0c.z);
  const b1k = createBasket('kitten');
  const p1k = basketWorld(1, 'kitten');
  b1k.position.set(p1k.x, BASKET_Y, p1k.z);
  const b1c = createBasket('cat');
  const p1c = basketWorld(1, 'cat');
  b1c.position.set(p1c.x, BASKET_Y, p1c.z);
  scene.add(b0k, b0c, b1k, b1c);
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0xf4ead8, 1);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  applyOrbit();
  const tick = () => {
    animationHandle = requestAnimationFrame(tick);
    if (renderer && scene && camera) {
      const now = performance.now();
      advanceMotions(now);
      advanceDances(now);
      advanceSprites(now);
      renderer.render(scene, camera);
      if ((motions.length || dancers.size) && overlaySync) overlaySync();
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
  orbitYaw = DEFAULT_YAW;
  orbitPitch = DEFAULT_PITCH;
  orbitDistance = DEFAULT_DIST;
  if (mounted) applyOrbit();
}

export function updateTable({ board = [], players = [], lastMove = null, spectator = false } = {}) {
  if (!mounted) return;
  if (!lastMove?.winCats?.length) stopVictoryDance();
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
  } else {
    if (lastAnimatedId === null) lastAnimatedId = lastMove?.id || 'init';
    if (!victoryQueued && lastMove?.winCats?.length && dancers.size === 0) {
      startVictoryDance(lastMove);
    }
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
