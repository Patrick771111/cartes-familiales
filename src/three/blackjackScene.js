import * as THREE from 'three';
import { suitCardImage, classiqueFigureImage, cardBackImage } from '../ui/cardThemes.js';
import { suitInfo } from '../game/deck.js';
import { playerHands, chipsForAmount, CHIP_VALUES } from '../game/blackjack.js';
import tableArtUrl from '../assets/games/blackjack/table-ref.jpg';

const CARD_ASPECT = 240 / 360;
const CARD_GEO = new THREE.PlaneGeometry(CARD_ASPECT, 1);
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
const CAMERA_FOV = 32;
const CREAM = '#FBF6EC';
const CARD_EDGE = '#1A1A1A';
const DARK = '#201E18';
const RED = '#B33A3A';
const SUIT_COLOR = { S: DARK, H: RED, D: RED, C: DARK };
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const COURT = { J: 'V', Q: 'D', K: 'R' };
const CHIP_COLOR = { 5: 0xf4f4f4, 10: 0xb33a3a, 25: 0x2b5a42, 100: 0x201e18 };

/** Coordonnées dans la photo (origine haut-gauche, 0–1). */
const SPOTS = [
  { x: 0.118, y: 0.568 },
  { x: 0.208, y: 0.625 },
  { x: 0.365, y: 0.695 },
  { x: 0.5, y: 0.712 },
  { x: 0.635, y: 0.695 },
  { x: 0.792, y: 0.625 },
  { x: 0.882, y: 0.568 }
];
const DEALER_UV = { x: 0.5, y: 0.545 };
const SHOE_UV = { x: 0.375, y: 0.465 };
const TRAY_UV = { x: 0.62, y: 0.8 };
const PHOTO_H = 2;
const CARD_BASE = 0.075;
const CHIP_R = 0.016;
const LIFT = 0.02;

const BASE_DIST = 3.55;
const DIST_MIN = 2.4;
const DIST_MAX = 5.2;

let canvas;
let renderer;
let scene;
let camera;
let mounted = false;
let animationHandle = null;
let photoMesh;
let photoW = PHOTO_H * (16 / 9);
let dealerGroup;
let seatGroups = [];
let chipTrayMeshes = [];
let trayGroup;

const flights = new Map();
const knownCardIds = new Set();

const _world = new THREE.Vector3();
const _shoeLocal = new THREE.Vector3();
let panX = 0;
let panY = 0;
let orbitDistance = BASE_DIST;

const faceTextures = new Map();
let cardBackTexture = null;
let cardBackTheme = null;

function teardown() {
  if (animationHandle) cancelAnimationFrame(animationHandle);
  animationHandle = null;
  document.querySelectorAll('#blackjack-3d-canvas').forEach((el) => el.remove());
  mounted = false;
  canvas = null;
  renderer = null;
  scene = null;
  camera = null;
  photoMesh = null;
  dealerGroup = null;
  trayGroup = null;
  seatGroups = [];
  chipTrayMeshes = [];
  flights.clear();
  knownCardIds.clear();
}

if (import.meta.hot) {
  import.meta.hot.dispose(teardown);
}

function currentTheme() {
  return document.documentElement.dataset.cardTheme || 'classique';
}

function makeCardMaterial() {
  return new THREE.MeshBasicMaterial({
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2
  });
}

function uvToLocal(u, v) {
  return new THREE.Vector3(u - 0.5, 0.5 - v, LIFT);
}

function depthScale(v) {
  const t = Math.max(0, Math.min(1, (v - 0.46) / 0.36));
  return 0.48 + 0.52 * t;
}

function seatSpotIndex(i) {
  if (i === 0) return 3;
  const rank = Math.ceil(i / 2);
  const side = i % 2 === 1 ? 1 : -1;
  return Math.max(0, Math.min(SPOTS.length - 1, 3 + side * rank));
}

function layOnPhoto(mesh, v) {
  const s = CARD_BASE * depthScale(v);
  mesh.scale.set(s, s * 0.62, 1);
  mesh.rotation.set(-0.42, 0, 0);
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
  root.renderOrder = 30;
  back.renderOrder = 30;
  face.renderOrder = 30;
  return root;
}

function strokeCardEdge(ctx, c) {
  ctx.save();
  ctx.strokeStyle = CARD_EDGE;
  ctx.lineWidth = 3;
  ctx.strokeRect(1.5, 1.5, c.width - 3, c.height - 3);
  ctx.restore();
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

function drawCorners(ctx, c, label, symbol, color) {
  const cornerFont = Math.round(c.width * 0.16);
  const drawOne = () => {
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.font = `700 ${cornerFont}px Georgia, serif`;
    ctx.fillText(label, c.width * 0.15, c.height * 0.045);
    ctx.font = `${Math.round(cornerFont * 0.72)}px Georgia, serif`;
    ctx.fillText(symbol, c.width * 0.15, c.height * 0.045 + cornerFont * 1.05);
  };
  drawOne();
  ctx.save();
  ctx.translate(c.width, c.height);
  ctx.rotate(Math.PI);
  drawOne();
  ctx.restore();
}

function drawCourt(ctx, c, rank, symbol, color) {
  const label = COURT[rank] || rank;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(c.width * 0.38)}px Georgia, serif`;
  ctx.fillText(label, c.width / 2, c.height / 2);
  ctx.font = `${Math.round(c.width * 0.18)}px Georgia, serif`;
  ctx.fillText(`${symbol}  ${symbol}  ${symbol}`, c.width / 2, c.height * 0.22);
  ctx.save();
  ctx.translate(c.width / 2, c.height * 0.78);
  ctx.rotate(Math.PI);
  ctx.fillText(`${symbol}  ${symbol}  ${symbol}`, 0, 0);
  ctx.restore();
}

function buildBack() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round(256 / CARD_ASPECT);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0F2E21';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#1a4a36';
  ctx.lineWidth = 6;
  for (let x = -c.height; x < c.width; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, c.height);
    ctx.lineTo(x + c.height, 0);
    ctx.stroke();
  }
  ctx.fillStyle = CREAM;
  ctx.font = `700 ${Math.round(c.width * 0.16)}px Georgia`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('BJ', c.width / 2, c.height / 2);
  strokeCardEdge(ctx, c);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function isCourtRank(rank) {
  return rank === 'J' || rank === 'Q' || rank === 'K';
}

function buildFace(rank, suit, img = null, mode = 'mono') {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = Math.round(256 / CARD_ASPECT);
  const ctx = c.getContext('2d');
  const color = SUIT_COLOR[suit] || DARK;
  const symbol = SUIT_SYMBOL[suit] || '';
  const label = COURT[rank] || rank;
  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, c.width, c.height);

  if (mode === 'full' && img) {
    const pad = 5;
    ctx.drawImage(img, pad, pad, c.width - pad * 2, c.height - pad * 2);
    drawCorners(ctx, c, label, symbol, color);
    if (!isCourtRank(rank)) drawPips(ctx, c, rank, symbol, color);
  } else {
    drawCorners(ctx, c, label, symbol, color);
    if (isCourtRank(rank) && img && mode === 'inset') {
      const inset = c.width * 0.12;
      ctx.drawImage(img, inset, inset, c.width - inset * 2, c.height - inset * 2);
    } else if (isCourtRank(rank)) {
      drawCourt(ctx, c, rank, symbol, color);
    } else {
      drawPips(ctx, c, rank, symbol, color);
    }
  }
  strokeCardEdge(ctx, c);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function getBack() {
  const theme = currentTheme();
  if (cardBackTexture && cardBackTheme === theme) return cardBackTexture;
  cardBackTheme = theme;
  cardBackTexture = buildBack();
  const url = cardBackImage(theme);
  if (url) {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = 256;
      c.height = Math.round(256 / CARD_ASPECT);
      const ctx = c.getContext('2d');
      ctx.fillStyle = CREAM;
      ctx.fillRect(0, 0, c.width, c.height);
      const pad = 5;
      ctx.drawImage(img, pad, pad, c.width - pad * 2, c.height - pad * 2);
      strokeCardEdge(ctx, c);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      cardBackTexture = tex;
    };
    img.src = url;
  }
  return cardBackTexture;
}

function getFace(rank, suit) {
  const theme = currentTheme();
  const key = `${theme}:${rank}${suit}`;
  if (faceTextures.has(key)) return faceTextures.get(key);
  const fallback = buildFace(rank, suit);
  faceTextures.set(key, fallback);
  const role = rank === 'A' ? 'as' : rank === 'J' ? 'valet' : rank === 'Q' ? 'dame' : rank === 'K' ? 'roi' : 'number';
  const fullUrl = suitCardImage(theme, suit, role);
  const insetUrl = !fullUrl && isCourtRank(rank) ? classiqueFigureImage(role, suitInfo(suit)?.color) : null;
  const url = fullUrl || insetUrl;
  if (url) {
    const img = new Image();
    img.onload = () => {
      const tex = buildFace(rank, suit, img, fullUrl ? 'full' : 'inset');
      faceTextures.set(key, tex);
      fallback.dispose();
      const refresh = (mesh) => {
        if (mesh?.userData?.face?.material?.map === fallback) {
          mesh.userData.face.material.map = tex;
          mesh.userData.face.material.needsUpdate = true;
        }
      };
      seatGroups.forEach((s) => s.cardMeshes?.forEach(refresh));
      dealerGroup?.userData?.meshes?.forEach(refresh);
    };
    img.src = url;
  }
  return faceTextures.get(key);
}

function applyCard(mesh, card, { faceUp = true, v = 0.7 } = {}) {
  mesh.visible = Boolean(card);
  if (!card) return;
  mesh.userData.cardId = card.id;
  mesh.userData.face.material.map = getFace(card.rank, card.suit);
  mesh.userData.back.material.map = getBack();
  mesh.userData.face.material.color.set(0xffffff);
  mesh.userData.back.material.color.set(0xffffff);
  mesh.userData.face.material.needsUpdate = true;
  mesh.userData.back.material.needsUpdate = true;
  layOnPhoto(mesh, v);
  if (!flights.has(card.id)) mesh.userData.pivot.rotation.y = faceUp ? Math.PI : 0;
}

function syncList(list, n, parent, factory) {
  while (list.length > n) {
    const m = list.pop();
    m.parent?.remove(m);
  }
  while (list.length < n) {
    const m = factory();
    parent.add(m);
    list.push(m);
  }
}

function createChip(value) {
  const m = new THREE.Mesh(
    new THREE.CylinderGeometry(CHIP_R, CHIP_R, 0.01, 24),
    new THREE.MeshBasicMaterial({ color: CHIP_COLOR[value] || 0x888888 })
  );
  m.rotation.x = -1.05;
  m.userData.value = value;
  m.renderOrder = 25;
  return m;
}

function stackChips(meshes, values, origin, v) {
  const s = depthScale(v);
  meshes.forEach((m, k) => {
    const val = values[k] || 5;
    m.material.color.setHex(CHIP_COLOR[val] || 0x888888);
    m.userData.value = val;
    m.visible = true;
    m.scale.setScalar(s);
    m.position.set(origin.x, origin.y + k * 0.007 * s, origin.z + k * 0.002);
  });
}

function ease(t) {
  return t * t * (3 - 2 * t);
}

function flyCard(mesh, toLocal, { faceUp, delay = 0, v = 0.7 }) {
  const id = mesh.userData.cardId;
  if (!id || flights.has(id) || !mesh.parent) return;
  mesh.parent.updateMatrixWorld();
  const from = mesh.parent.worldToLocal(uvToWorld(SHOE_UV.x, SHOE_UV.y));
  mesh.position.copy(from);
  layOnPhoto(mesh, SHOE_UV.y);
  mesh.userData.pivot.rotation.y = 0;
  flights.set(id, {
    mesh,
    from,
    to: toLocal.clone(),
    start: performance.now() + delay,
    dur: 420,
    faceUp,
    v
  });
}

function uvToWorld(u, v) {
  if (!photoMesh) return uvToLocal(u, v);
  photoMesh.updateMatrixWorld();
  return photoMesh.localToWorld(uvToLocal(u, v));
}

function advanceFlights(now) {
  for (const [id, f] of flights) {
    if (now < f.start) {
      f.mesh.position.copy(f.from);
      continue;
    }
    const t = Math.min(1, (now - f.start) / f.dur);
    const k = ease(t);
    f.mesh.position.lerpVectors(f.from, f.to, k);
    f.mesh.position.z = LIFT + Math.sin(k * Math.PI) * 0.08;
    layOnPhoto(f.mesh, f.v);
    if (k > 0.55) f.mesh.userData.pivot.rotation.y = f.faceUp ? Math.PI : 0;
    if (t >= 1) {
      f.mesh.position.copy(f.to);
      f.mesh.userData.pivot.rotation.y = f.faceUp ? Math.PI : 0;
      flights.delete(id);
    }
  }
}

function createPhoto() {
  const geo = new THREE.PlaneGeometry(1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, depthWrite: true, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.z = 0;
  const img = new Image();
  img.onload = () => {
    photoW = PHOTO_H * (img.width / img.height);
    mesh.scale.set(photoW, PHOTO_H, 1);
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    mat.map = tex;
    mat.needsUpdate = true;
    framePhoto();
  };
  img.src = tableArtUrl;
  mesh.scale.set(photoW, PHOTO_H, 1);
  return mesh;
}

function framePhoto() {
  if (!camera || !photoMesh) return;
  const vFov = (CAMERA_FOV * Math.PI) / 180;
  const visibleH = 2 * Math.tan(vFov / 2) * orbitDistance;
  const visibleW = visibleH * Math.max(camera.aspect, 0.05);
  const fit = Math.min(visibleW / photoW, visibleH / PHOTO_H) * 0.98;
  photoMesh.scale.set(photoW * fit, PHOTO_H * fit, 1);
  camera.position.set(panX, panY, orbitDistance);
  camera.lookAt(panX, panY, 0);
}

function ensureScene() {
  if (mounted && canvas?.isConnected) return;
  teardown();
  mounted = true;
  canvas = document.createElement('canvas');
  canvas.id = 'blackjack-3d-canvas';
  canvas.style.cssText = 'position:fixed;pointer-events:none;display:none;z-index:5';
  document.body.appendChild(canvas);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.05, 40);

  photoMesh = createPhoto();
  scene.add(photoMesh);

  dealerGroup = new THREE.Group();
  dealerGroup.userData.meshes = [];
  photoMesh.add(dealerGroup);

  trayGroup = new THREE.Group();
  photoMesh.add(trayGroup);

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const tick = () => {
    animationHandle = requestAnimationFrame(tick);
    if (renderer && scene && camera) {
      advanceFlights(performance.now());
      renderer.render(scene, camera);
    }
  };
  tick();
}

export function orbitCameraByScreenDelta(dx, dy) {
  if (!mounted) return;
  panX += dx * 0.0012;
  panY -= dy * 0.0012;
  const lim = 0.35;
  panX = Math.max(-lim, Math.min(lim, panX));
  panY = Math.max(-lim, Math.min(lim, panY));
  framePhoto();
}

export function zoomCameraByFactor(factor) {
  if (!mounted || !factor) return;
  orbitDistance = Math.max(DIST_MIN, Math.min(DIST_MAX, orbitDistance / factor));
  framePhoto();
}

export function resetOrbit() {
  panX = 0;
  panY = 0;
  orbitDistance = BASE_DIST;
  if (mounted) framePhoto();
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
  framePhoto();
}

export function showTable() {
  ensureScene();
  if (canvas) canvas.style.display = 'block';
}

export function hideTable() {
  if (canvas) canvas.style.display = 'none';
  document.querySelectorAll('#blackjack-3d-canvas').forEach((el) => {
    el.style.display = 'none';
  });
}

function ensureSeats(n) {
  if (!photoMesh) return;
  while (seatGroups.length > n) photoMesh.remove(seatGroups.pop().group);
  while (seatGroups.length < n) {
    const group = new THREE.Group();
    photoMesh.add(group);
    seatGroups.push({ group, cardMeshes: [], betChips: [], bankChips: [] });
  }
}

function placeSeat(seat, i) {
  const spot = SPOTS[seatSpotIndex(i)];
  const p = uvToLocal(spot.x, spot.y);
  seat.group.position.copy(p);
  seat.uv = spot;
}

function layoutHandCards(meshes, cards, faceUpFor, { fly, betting, seen, delayRef, v }) {
  const gap = CARD_BASE * depthScale(v) * CARD_ASPECT * 0.55;
  meshes.forEach((mesh, k) => {
    const card = cards[k];
    const faceUp = faceUpFor(card, k);
    applyCard(mesh, card, { faceUp, v });
    const local = new THREE.Vector3((k - (cards.length - 1) / 2) * gap, 0.045 * depthScale(v), 0.004 + k * 0.001);
    if (card?.id) {
      seen.add(card.id);
      if (!knownCardIds.has(card.id) && !betting && fly) {
        flyCard(mesh, local, { faceUp, delay: delayRef.n * 90, v });
        delayRef.n += 1;
      } else if (!flights.has(card.id)) {
        mesh.position.copy(local);
        layOnPhoto(mesh, v);
      }
    } else {
      mesh.position.copy(local);
      layOnPhoto(mesh, v);
    }
  });
}

export function updateTable({ me, opponents = [], dealer, betting } = {}) {
  if (!mounted || !scene || !photoMesh) return;
  const seats = me ? [me, ...opponents] : opponents;
  ensureSeats(seats.length);
  const seen = new Set();
  const delayRef = { n: 0 };

  seats.forEach((p, i) => {
    const seat = seatGroups[i];
    placeSeat(seat, i);
    const v = seat.uv.y;
    const hands = playerHands(p);
    const cards = hands.flatMap((h) => h.cards);
    if (!seat.cardMeshes) seat.cardMeshes = [];
    syncList(seat.cardMeshes, cards.length, seat.group, createCardMesh);
    layoutHandCards(seat.cardMeshes, cards, () => true, { fly: true, betting, seen, delayRef, v });

    const bet = hands.reduce((s, h) => s + (h.bet || 0), 0) || p.bet || 0;
    const betChips = chipsForAmount(bet).slice(0, 12);
    if (!seat.betChips) seat.betChips = [];
    syncList(seat.betChips, betChips.length, seat.group, () => createChip(5));
    stackChips(seat.betChips, betChips, { x: 0, y: -0.035, z: 0.006 }, v);

    if (i === 0) {
      const bank = chipsForAmount(p.money || 0).slice(0, 14);
      if (!seat.bankChips) seat.bankChips = [];
      syncList(seat.bankChips, bank.length, seat.group, () => createChip(5));
      stackChips(seat.bankChips, bank, { x: -0.08, y: -0.07, z: 0.006 }, v);
    } else {
      syncList(seat.bankChips || [], 0, seat.group, () => createChip(5));
    }
  });

  const dCards = dealer?.hand || [];
  const dPos = uvToLocal(DEALER_UV.x, DEALER_UV.y);
  dealerGroup.position.copy(dPos);
  if (!dealerGroup.userData.meshes) dealerGroup.userData.meshes = [];
  syncList(dealerGroup.userData.meshes, dCards.length, dealerGroup, createCardMesh);
  layoutHandCards(
    dealerGroup.userData.meshes,
    dCards,
    (_c, i) => !dealer?.hidden || i === 0,
    { fly: true, betting, seen, delayRef, v: DEALER_UV.y }
  );

  knownCardIds.clear();
  for (const id of seen) knownCardIds.add(id);
  if (betting) {
    flights.clear();
    knownCardIds.clear();
  }

  const tray = uvToLocal(TRAY_UV.x, TRAY_UV.y);
  trayGroup.position.copy(tray);
  syncList(chipTrayMeshes, CHIP_VALUES.length, trayGroup, () => createChip(5));
  chipTrayMeshes.forEach((m, i) => {
    const val = CHIP_VALUES[i];
    m.material.color.setHex(CHIP_COLOR[val]);
    m.userData.value = val;
    m.scale.setScalar(depthScale(TRAY_UV.y) * 1.15);
    m.position.set((i - 1.5) * 0.04, 0, 0.006);
    m.visible = Boolean(betting);
  });
}

export function getChipRects() {
  if (!mounted || !camera || !canvas) return [];
  camera.updateMatrixWorld();
  const w = parseFloat(canvas.style.width) || 1;
  const h = parseFloat(canvas.style.height) || 1;
  return chipTrayMeshes
    .filter((m) => m.visible)
    .map((m) => {
      m.updateMatrixWorld();
      _world.set(0, 0, 0).applyMatrix4(m.matrixWorld).project(camera);
      const left = (_world.x * 0.5 + 0.5) * w - 28;
      const top = (-_world.y * 0.5 + 0.5) * h - 28;
      return { value: m.userData.value, left, top, width: 56, height: 56 };
    });
}

export function getCardRects() {
  return [];
}

export function getRowLabelAnchors() {
  if (!mounted || !camera || !canvas) return { opponents: [] };
  camera.updateMatrixWorld();
  const w = parseFloat(canvas.style.width) || 1;
  const h = parseFloat(canvas.style.height) || 1;
  return {
    opponents: seatGroups.slice(1).map((s) => {
      s.group.updateMatrixWorld();
      _world.set(0, 0.05, 0).applyMatrix4(s.group.matrixWorld).project(camera);
      return { left: (_world.x * 0.5 + 0.5) * w, top: (-_world.y * 0.5 + 0.5) * h };
    })
  };
}
