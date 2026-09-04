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

/**
 * Scène 3D Boop — chambre kawaii, lit 6×6 au centre, paniers autour.
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

const FUR = { orange: 0xd9782c, gray: 0x8b9098 };
const BELLY = { orange: 0xf3d5a8, gray: 0xe8e8ea };
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
const DANCE_URL = { orange: danceOrange, gray: danceGray };

const pieceMeshes = new Map();
const busy = new Set();
const motions = [];
const dancers = new Map();
let lastAnimatedId = null;
let kawaiiMode = false;
let victoryQueued = false;
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
    const x = type === 'kitten' ? 1.15 : -1.15;
    return new THREE.Vector3(x, TABLE_TOP + 0.04, 1.72);
  }
  const x = type === 'kitten' ? -1.68 : 1.68;
  return new THREE.Vector3(x, TABLE_TOP + 0.04, -1.02);
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

function makeLeg(fur, x, z) {
  const leg = new THREE.Group();
  const bone = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.016, 0.09, 8), fur);
  bone.position.y = -0.045;
  const paw = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), fur);
  paw.scale.set(1.15, 0.5, 1.35);
  paw.position.y = -0.09;
  leg.position.set(x, 0.095, z);
  leg.add(bone, paw);
  return leg;
}

function createAnimal(type, color) {
  if (kawaiiMode) return createKawaiiAnimal(type, color);
  const fur = makeMat({ color: FUR[color] || FUR.orange, roughness: 0.78 });
  const pale = makeMat({ color: BELLY[color] || BELLY.orange, roughness: 0.8 });
  const dark = makeMat({ color: 0x2a221c, roughness: 0.6 });
  const g = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.position.set(0, 0.02, -0.12);
  g.add(pivot);
  const rig = new THREE.Group();
  rig.position.set(0, 0, 0.12);
  pivot.add(rig);
  const s = type === 'cat' ? 1 : 0.72;

  const body = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), fur);
  body.scale.set(1.05, 0.78, 1.28);
  body.position.y = 0.12;
  rig.add(body);

  const tummy = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), pale);
  tummy.position.set(0, 0.08, 0.08);
  tummy.scale.set(0.9, 0.7, 0.7);
  rig.add(tummy);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), fur);
  head.position.set(0, 0.28, 0.12);
  rig.add(head);

  const earGeo = new THREE.ConeGeometry(0.045, 0.08, 8);
  const earL = new THREE.Mesh(earGeo, fur);
  earL.position.set(-0.07, 0.38, 0.1);
  earL.rotation.z = 0.25;
  const earR = new THREE.Mesh(earGeo, fur);
  earR.position.set(0.07, 0.38, 0.1);
  earR.rotation.z = -0.25;
  rig.add(earL, earR);

  const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 8), dark);
  eyeL.position.set(-0.04, 0.3, 0.21);
  const eyeR = eyeL.clone();
  eyeR.position.x = 0.04;
  rig.add(eyeL, eyeR);

  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.012, 0.18, 8), fur);
  tail.position.set(0.08, 0.16, -0.16);
  tail.rotation.x = 0.9;
  tail.rotation.z = -0.4;
  rig.add(tail);

  const frontL = makeLeg(fur, -0.055, 0.1);
  const frontR = makeLeg(fur, 0.055, 0.1);
  const hindL = makeLeg(fur, -0.055, -0.11);
  const hindR = makeLeg(fur, 0.055, -0.11);
  rig.add(frontL, frontR, hindL, hindR);

  g.scale.setScalar(s);
  g.userData.type = type;
  g.userData.color = color;
  g.userData.baseScale = s;
  g.userData.pivot = pivot;
  g.userData.parts = { tail, frontL, frontR, hindL, hindR };
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

function createLamp(shadeColor) {
  const g = new THREE.Group();
  const wood = makeMat({ color: 0xe8d5b5, roughness: 0.55 });
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 0.28, 8), wood);
  stem.position.y = 0.14;
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.03, 12), wood);
  base.position.y = 0.015;
  const shade = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 0.14, 12, 1, true),
    makeMat({ color: shadeColor, roughness: 0.7, emissive: shadeColor, emissiveIntensity: 0.18, side: THREE.DoubleSide })
  );
  shade.position.y = 0.32;
  const glow = new THREE.PointLight(shadeColor, 0.35, 2.4);
  glow.position.y = 0.3;
  g.add(stem, base, shade, glow);
  return g;
}

function createPottedPlant() {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.06, 0.12, 10),
    makeMat({ color: 0xf2b8c6, roughness: 0.55 })
  );
  pot.position.y = 0.06;
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(0.07, 10), makeMat({ color: 0x6b4a32, roughness: 1 }));
  dirt.rotation.x = -Math.PI / 2;
  dirt.position.y = 0.121;
  const leafMat = makeMat({ color: 0x7ecf9a, roughness: 0.55 });
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), leafMat);
    const a = (i / 5) * Math.PI * 2;
    leaf.position.set(Math.cos(a) * 0.05, 0.2 + (i % 2) * 0.04, Math.sin(a) * 0.05);
    leaf.scale.set(1.1, 0.7, 0.85);
    g.add(leaf);
  }
  g.add(pot, dirt);
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

  const wallMat = makeMat({ map: loadMap(wallpaperUrl, 3.4, 1.6), roughness: 0.94, color: 0xffffff });
  const trim = makeMat({ color: 0xfff8f0, roughness: 0.62 });
  const wood = makeMat({ color: 0xe2c49a, roughness: 0.55 });
  const blush = makeMat({ color: 0xf4b8c9, roughness: 0.7 });
  const cream = makeMat({ color: 0xfff4e8, roughness: 0.75 });

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

  addBox(g, W, 0.1, 0.05, 0, 0.05, zBack + 0.025, trim);
  addBox(g, 0.05, 0.1, D, xL + 0.025, 0.05, zMid, trim);
  addBox(g, 0.05, 0.1, D, xR - 0.025, 0.05, zMid, trim);
  addBox(g, W, 0.06, 0.05, 0, H - 0.03, zBack + 0.025, trim);

  const winW = 1.55;
  const winH = 1.05;
  const winY = 1.58;
  const skyMap = loadMap(windowUrl, 1, 1);
  skyMap.wrapS = THREE.ClampToEdgeWrapping;
  skyMap.wrapT = THREE.ClampToEdgeWrapping;
  const sky = new THREE.Mesh(
    new THREE.PlaneGeometry(winW, winH),
    new THREE.MeshBasicMaterial({ map: skyMap })
  );
  sky.position.set(0, winY, zBack + 0.03);
  g.add(sky);
  addBox(g, winW + 0.16, 0.07, 0.08, 0, winY + winH / 2, zBack + 0.05, trim);
  addBox(g, winW + 0.16, 0.07, 0.08, 0, winY - winH / 2, zBack + 0.05, trim);
  addBox(g, 0.07, winH + 0.14, 0.08, -winW / 2, winY, zBack + 0.05, trim);
  addBox(g, 0.07, winH + 0.14, 0.08, winW / 2, winY, zBack + 0.05, trim);
  addBox(g, 0.04, winH, 0.04, 0, winY, zBack + 0.05, trim);
  addBox(g, winW, 0.04, 0.04, 0, winY, zBack + 0.05, trim);

  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 2.15, 8), wood);
  rod.rotation.z = Math.PI / 2;
  rod.position.set(0, winY + winH / 2 + 0.1, zBack + 0.12);
  g.add(rod);
  const curtainMat = makeMat({ color: 0xf3b7c8, roughness: 0.85, side: THREE.DoubleSide });
  const addCurtain = (x) => {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1.55), curtainMat);
    c.position.set(x, winY - 0.18, zBack + 0.1);
    g.add(c);
  };
  addCurtain(-0.95);
  addCurtain(0.95);

  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.85, 48), makeMat({ color: 0xf7c6d6, roughness: 0.95 }));
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(0, 0.006, -0.08);
  g.add(rug);
  const rugIn = new THREE.Mesh(new THREE.CircleGeometry(1.58, 48), makeMat({ color: 0xffeef4, roughness: 0.95 }));
  rugIn.rotation.x = -Math.PI / 2;
  rugIn.position.set(0, 0.008, -0.08);
  g.add(rugIn);

  const standH = 0.34;
  const addStand = (x) => {
    addBox(g, 0.42, standH, 0.38, x, standH / 2, -1.92, wood);
    addBox(g, 0.44, 0.03, 0.4, x, standH + 0.015, -1.92, cream);
    addBox(g, 0.34, 0.1, 0.02, x, 0.17, -1.73, makeMat({ color: 0xd7b48c, roughness: 0.6 }));
  };
  addStand(-2.52);
  addStand(2.52);
  const plant = createPottedPlant();
  plant.position.set(-2.52, standH + 0.03, -1.92);
  g.add(plant);
  const lamp = createLamp(0xffd4e2);
  lamp.position.set(2.52, standH + 0.03, -1.92);
  g.add(lamp);

  const frameMat = makeMat({ color: 0xf0c36a, roughness: 0.45 });
  const addFrame = (x, y, col) => {
    addBox(g, 0.36, 0.44, 0.05, x, y, zBack + 0.04, frameMat);
    addBox(g, 0.28, 0.36, 0.02, x, y, zBack + 0.07, makeMat({ color: col, roughness: 0.8 }));
  };
  addFrame(-2.2, 1.52, 0xb8e0f5);
  addFrame(2.2, 1.52, 0xf7c9a8);

  const lightMat = makeMat({ color: 0xffe7a8, emissive: 0xffd978, emissiveIntensity: 0.85, roughness: 0.4 });
  for (let i = 0; i < 11; i++) {
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), lightMat);
    const t = i / 10;
    bulb.position.set((t - 0.5) * 4.8, H - 0.28, zBack + 0.1);
    bulb.position.y += Math.sin(t * Math.PI) * 0.08;
    g.add(bulb);
  }

  const pouf = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), blush);
  pouf.scale.set(1.15, 0.42, 1.15);
  pouf.position.set(-2.35, 0.09, 1.55);
  g.add(pouf);

  const book = makeMat({ color: 0x9fd6ea, roughness: 0.7 });
  addBox(g, 0.18, 0.04, 0.14, 2.4, 0.04, 1.7, book);
  addBox(g, 0.16, 0.035, 0.13, 2.42, 0.08, 1.72, blush);
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

  const legGeo = new THREE.CylinderGeometry(0.045, 0.05, TABLE_TOP, 10);
  const legMat = makeMat({ color: 0x5a381c, roughness: 0.78 });
  const addLeg = (x, z) => {
    const leg = new THREE.Mesh(legGeo, legMat);
    leg.position.set(x, TABLE_TOP / 2, z);
    g.add(leg);
  };
  addLeg(-1.05, -1.16);
  addLeg(1.05, -1.16);
  addLeg(-1.05, 1.06);
  addLeg(1.05, 1.06);

  const tex = textureLoader.load(duvetUrl);
  tex.colorSpace = THREE.SRGBColorSpace;
  const duvet = new THREE.Mesh(
    new THREE.PlaneGeometry(BOARD + 0.04, BOARD + 0.04),
    new THREE.MeshStandardMaterial({ map: tex, roughness: 0.94, metalness: 0, color: 0xffffff })
  );
  duvet.rotation.x = -Math.PI / 2;
  duvet.position.y = DUVET_Y - 0.002;
  g.add(duvet);

  const linen = makeMat({ color: 0xf4f0e8, roughness: 0.9 });
  const addPillow = (x, yaw) => {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.28, 18, 14), linen);
    p.scale.set(1.42, 0.3, 0.38);
    // Contre la tête de lit, hors des cases (léger débord visuel seulement).
    p.position.set(x, TABLE_TOP + 0.2, -1.24);
    p.rotation.y = yaw;
    p.rotation.z = x > 0 ? -0.08 : 0.08;
    g.add(p);
  };
  addPillow(-0.4, 0.18);
  addPillow(0.4, -0.18);
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
    const fps = clip === 'run' ? 11 : clip === 'dance' ? 7 : 9;
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
        if (!mesh.userData.kawaii) mesh.rotation.y = seat === 0 ? 0 : Math.PI;
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
  if (kawaiiMode) startTravel(jumper, dest, { onDone: afterLand });
  else startJump(jumper, dest, { duration: 780, lift: 0.9, onDone: afterLand });
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
        scaleTo: mesh.userData.kawaii ? 1 : 1,
        clip: 'idle',
        onDone: () => goToCatBasket(mesh, g)
      });
    }, i * 90);
  });
}

function resetPose(mesh) {
  if (!mesh) return;
  mesh.userData.dancing = false;
  mesh.rotation.x = 0;
  mesh.rotation.z = 0;
  if (mesh.userData.pivot) mesh.userData.pivot.rotation.set(0, 0, 0);
  const parts = mesh.userData.parts;
  if (parts) {
    if (parts.frontL) parts.frontL.rotation.set(0, 0, 0);
    if (parts.frontR) parts.frontR.rotation.set(0, 0, 0);
    if (parts.tail) {
      parts.tail.rotation.x = 0.9;
      parts.tail.rotation.z = -0.4;
    }
  }
  if (mesh.userData.kawaii) {
    mesh.userData.spriteSize = mesh.userData.type === 'cat' ? 0.58 : 0.44;
    const plane = mesh.userData.plane;
    if (plane) plane.position.y = mesh.userData.spriteSize * 0.42;
    if (mesh.userData.clip === 'dance') applyClip(mesh, 'idle');
  }
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
  orbitPitch = Math.min(orbitPitch, 0.72);
  applyOrbit();
  list.forEach((c, i) => {
    const mesh = pieceMeshes.get(c.id);
    if (!mesh) return;
    busy.add(c.id);
    mesh.userData.dancing = true;
    const home = cellWorld(c.index);
    home.y = DUVET_Y;
    mesh.position.copy(home);
    mesh.visible = true;
    if (mesh.userData.kawaii) {
      mesh.userData.spriteSize = 0.72;
      applyClip(mesh, 'dance');
    }
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
    if (d.mesh.userData.kawaii) {
      d.mesh.rotation.z = sway * 0.35;
      const plane = d.mesh.userData.plane;
      if (plane) plane.position.y = (d.mesh.userData.spriteSize || 0.72) * (0.42 + 0.08 * e);
    } else {
      const pivot = d.mesh.userData.pivot;
      if (pivot) {
        pivot.rotation.x = -1.32 * e;
        pivot.rotation.z = sway;
      } else {
        d.mesh.rotation.x = -1.32 * e;
        d.mesh.rotation.z = sway;
      }
      d.mesh.rotation.y = 0;
      const parts = d.mesh.userData.parts;
      if (parts) {
        const wave = Math.sin((t + d.phase) * 9.5) * 0.55 * e;
        if (parts.frontL) parts.frontL.rotation.x = -1.15 * e + wave;
        if (parts.frontR) parts.frontR.rotation.x = -1.15 * e - wave;
        if (parts.tail) {
          parts.tail.rotation.z = -0.4 + Math.sin((t + d.phase) * 7) * 0.55 * e;
          parts.tail.rotation.x = 0.9 - 0.45 * e;
        }
      }
    }
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
  scene.background = new THREE.Color(0xf6e4d4);
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 80);
  scene.add(new THREE.HemisphereLight(0xffeef5, 0xc4b29a, 0.55));
  scene.add(new THREE.AmbientLight(0xfff6ea, 0.28));
  const key = new THREE.DirectionalLight(0xfff3d8, 0.42);
  key.position.set(1.2, 5.5, 3.2);
  scene.add(key);
  const windowLight = new THREE.DirectionalLight(0xfff0c8, 0.3);
  windowLight.position.set(0, 2.4, -3.4);
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
  renderer.setClearColor(0xf6e4d4, 1);
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
  orbitYaw = 0;
  orbitPitch = 1.02;
  orbitDistance = 6.2;
  if (mounted) applyOrbit();
}

export function updateTable({ board = [], players = [], lastMove = null, spectator = false, kawaii = false } = {}) {
  if (!mounted) return;
  if (kawaiiMode !== kawaii) {
    kawaiiMode = kawaii;
    stopVictoryDance();
    for (const mesh of pieceMeshes.values()) scene.remove(mesh);
    pieceMeshes.clear();
    busy.clear();
    motions.length = 0;
    lastAnimatedId = lastMove?.id || 'init';
  }
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
