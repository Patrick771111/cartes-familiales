import * as THREE from 'three';
import { unoCardImage } from '../ui/unoCardArt.js';

/**
 * Scène 3D persistante pour la vue de table du Uno — contrairement au
 * Pouilleux (plusieurs canvas indépendants, un par éventail, voir
 * pouilleuxScene.js), Uno a besoin d'UNE SEULE caméra cohérente pour
 * donner une vraie impression de table avec de la profondeur : ma main
 * (proche, grande, en bas), la pioche/défausse (au milieu), les mains
 * adversaires (loin, petites, en haut) — la perspective fait le travail
 * de mise à l'échelle toute seule du moment que ces trois groupes sont
 * placés à des distances (Z) et hauteurs (Y) différentes.
 *
 * Caméra volontairement JAMAIS inclinée/élevée (elle reste braquée bien en
 * face, `lookAt(0,0,0)` depuis un point sur l'axe Z) — leçon directe du
 * Pouilleux : une caméra en plongée fait apparaître une carte tournée sur
 * elle-même (rotation.z de l'éventail) avec une taille projetée différente
 * selon sa position dans l'éventail, ce qui avait cassé son rendu. La
 * profondeur de table s'obtient donc uniquement par le placement des
 * groupes de cartes, jamais par l'angle de la caméra elle-même.
 *
 * Montée UNE SEULE FOIS, ajoutée à `document.body` (donc en dehors de
 * `#app`, jamais touchée par les `container.innerHTML = ...` du reste de
 * l'appli) — un canvas WebGL recréé à chaque coup perdrait son contexte GL
 * et clignoterait.
 *
 * Volontairement décoratif : les clics réels restent sur des boutons DOM
 * invisibles superposés (voir getHandCardRects/getDrawPileRect,
 * utilisés par src/ui/games/uno.js) — pas de raycasting, la logique de
 * jeu ne bouge pas.
 */

const CARD_ASPECT = 240 / 360; // cohérent avec le reste de l'appli
const CAMERA_DISTANCE = 6;
const CAMERA_FOV = 45;
const HAND_BASE_Z = 1.2; // profondeur "de référence" de ma main — voir fitHandDepth pour une main nombreuse

// Dos de carte générique (aucun asset dédié pour Uno, contrairement aux
// faces — voir unoCardImage) : palette rouge/noir propre à Uno, distincte
// du vert/or du Pouilleux pour rester visuellement identifiable.
const BACK_RED = '#B8202A';
const BACK_BLACK = '#161616';
const BACK_CREAM = '#F4EDE1';

let canvas = null;
let renderer = null;
let scene = null;
let camera = null;
let mounted = false;

let handMeshes = []; // ma main, face visible
let opponentMeshGroups = []; // Array<{ meshes: THREE.Mesh[] }>, dos visible
let discardMeshes = [];
let drawPileMeshes = [];

let cardBackTexture = null;
const cardFaceTextures = new Map(); // url -> THREE.Texture
const textureLoader = new THREE.TextureLoader();

function buildCardBackTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size / CARD_ASPECT);
  const ctx = c.getContext('2d');

  ctx.fillStyle = BACK_BLACK;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = BACK_CREAM;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);

  ctx.save();
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(-Math.PI / 8);
  ctx.fillStyle = BACK_RED;
  ctx.beginPath();
  ctx.ellipse(0, 0, c.width * 0.42, c.height * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.fillStyle = BACK_CREAM;
  ctx.font = `italic 700 ${Math.round(c.width * 0.24)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('UNO', c.width / 2, c.height / 2 + 2);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getCardBackTexture() {
  if (!cardBackTexture) cardBackTexture = buildCardBackTexture();
  return cardBackTexture;
}

/** Illustration réelle (CC0, voir unoCardImage) mise en cache par URL — pas besoin de la recharger à chaque rendu. */
function getCardFaceTexture(card) {
  const url = unoCardImage(card);
  if (!url) return getCardBackTexture();
  let texture = cardFaceTextures.get(url);
  if (!texture) {
    texture = textureLoader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    cardFaceTextures.set(url, texture);
  }
  return texture;
}

function createCardMesh() {
  const geometry = new THREE.PlaneGeometry(CARD_ASPECT, 1);
  const material = new THREE.MeshStandardMaterial({ transparent: true });
  return new THREE.Mesh(geometry, material);
}

function disposeMesh(mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
}

function ensureMeshCount(list, count) {
  while (list.length > count) disposeMesh(list.pop());
  while (list.length < count) {
    const mesh = createCardMesh();
    scene.add(mesh);
    list.push(mesh);
  }
}

/** Dérive un nombre stable dans [0,1) à partir d'un id de carte — pour un décalage "en vrac" qui ne saute pas d'un rendu à l'autre (voir layoutDiscard), contrairement à Math.random(). */
function stableJitter(id, salt) {
  let hash = salt;
  const s = String(id);
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) >>> 0;
  return (hash % 10000) / 10000;
}

/**
 * Dispose `n` cartes en éventail centré sur (centerX, centerY, centerZ) —
 * même formule que layoutFan dans pouilleuxScene.js (angle plafonné,
 * chevauchement accru plutôt qu'un éventail qui continue de s'élargir sans
 * fin), dupliquée ici plutôt que partagée : les deux jeux n'ont pas les
 * mêmes contraintes de mise à l'échelle (un seul éventail vs plusieurs
 * groupes à des profondeurs différentes dans la même scène). Retourne
 * l'étendue horizontale maximale atteinte (demi-largeur en unités monde),
 * utilisée par `fitHandDepth` pour une main nombreuse (voir plus bas).
 */
function layoutFanGroup(meshes, { centerX, centerY, centerZ, radius, maxSpanDeg }) {
  const n = meshes.length;
  if (n === 0) return 0;
  const anglePerCardDeg = n > 1 ? Math.max(4, Math.min(maxSpanDeg / (n - 1), 10)) : 0;
  const anglePerCard = (anglePerCardDeg * Math.PI) / 180;
  const halfDiagonal = Math.sqrt((CARD_ASPECT / 2) ** 2 + 0.5 ** 2);
  let maxExtent = halfDiagonal;
  meshes.forEach((mesh, i) => {
    const angle = (i - (n - 1) / 2) * anglePerCard;
    const x = Math.sin(angle) * radius;
    const y = (Math.cos(angle) - 1) * radius * 0.15;
    mesh.position.set(centerX + x, centerY + y, centerZ + i * 0.002);
    mesh.rotation.z = -angle;
    maxExtent = Math.max(maxExtent, Math.abs(x) + halfDiagonal);
  });
  return maxExtent;
}

/**
 * Recule ma main (Z, distance à la caméra) au besoin pour qu'elle tienne
 * dans le champ de vision HORIZONTAL de la caméra partagée — sans ça, une
 * main nombreuse déborde du cadre (invisible ET impossible à toucher, voir
 * getHandCardRects) dès que le conteneur est haut et étroit (mobile
 * portrait), le champ horizontal effectif étant alors bien plus resserré
 * que le champ vertical. Même bug/correctif que fitCameraToExtent au
 * Pouilleux, appliqué ici à la profondeur de CE groupe seulement — les
 * autres éléments de la table (pioche/défausse/adversaires) ne doivent pas
 * changer de taille quand ma main s'agrandit.
 */
function fitHandDepth(maxExtent, baseZ) {
  const halfVFov = (camera.fov * Math.PI) / 360;
  const halfHFov = Math.atan(Math.tan(halfVFov) * camera.aspect);
  const margin = 0.85;
  const neededDistance = maxExtent / Math.tan(halfHFov * margin);
  const baseDistance = CAMERA_DISTANCE - baseZ;
  return neededDistance <= baseDistance ? baseZ : CAMERA_DISTANCE - neededDistance;
}

/** Empile les dernières poses "en vrac" (décalage pseudo-aléatoire mais stable, voir stableJitter) plutôt qu'un éventail rangé. */
function layoutDiscardPile(meshes, cards, { centerX, centerY, centerZ }) {
  meshes.forEach((mesh, i) => {
    const card = cards[i];
    const jx = stableJitter(card.id, 17) - 0.5;
    const jy = stableJitter(card.id, 31) - 0.5;
    const jr = stableJitter(card.id, 53) - 0.5;
    mesh.position.set(centerX + jx * 0.5, centerY + jy * 0.35, centerZ + i * 0.01);
    mesh.rotation.z = jr * 1.1;
  });
}

function ensureScene() {
  if (mounted) return;
  mounted = true;

  canvas = document.createElement('canvas');
  canvas.id = 'uno-3d-canvas';
  canvas.style.position = 'fixed';
  canvas.style.pointerEvents = 'none'; // les clics traversent vers les boutons DOM dessous
  canvas.style.display = 'none';
  canvas.style.zIndex = '5'; // sous les bulles HUD (z-index 50), au-dessus du feutre
  document.body.appendChild(canvas);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
  dirLight.position.set(1, 2, 2);
  scene.add(dirLight);

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const tick = () => {
    requestAnimationFrame(tick);
    renderer.render(scene, camera);
  };
  tick();
}

export function mountTable() {
  ensureScene();
}

/** Ajuste le canvas fixe pour qu'il recouvre exactement `rect` (un DOMRect, coordonnées viewport). */
export function positionTable(rect) {
  if (!mounted || !rect || rect.width <= 0 || rect.height <= 0) return;
  canvas.style.left = `${rect.left}px`;
  canvas.style.top = `${rect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

export function showTable() {
  if (canvas) canvas.style.display = 'block';
}

export function hideTable() {
  if (canvas) canvas.style.display = 'none';
}

/**
 * Reconstruit toute la table à partir de l'état nécessaire au rendu :
 * - `hand` : `Array<{ id, color, kind, value }>` — ma main, dans l'ordre
 *   d'affichage voulu (déjà triée/réordonnée côté appelant).
 * - `handPlayable` : `Array<boolean>`, même longueur que `hand`.
 * - `opponents` : `Array<{ count }>` — un par adversaire, dans l'ordre des
 *   sièges déjà calculé par l'appelant (orderedOpponents).
 * - `discardCards` : cartes face visible à empiler en vrac au centre
 *   (voir discardHistory dans game/uno.js, déjà borné à 4 côté moteur).
 */
export function updateTable({ hand = [], handPlayable = [], opponents = [], discardCards = [] }) {
  if (!mounted) return;

  ensureMeshCount(handMeshes, hand.length);
  hand.forEach((card, i) => {
    const mesh = handMeshes[i];
    mesh.material.map = getCardFaceTexture(card);
    mesh.material.color.set(handPlayable[i] ? 0xffffff : 0x8f8f8f);
    mesh.material.needsUpdate = true;
  });
  const handExtent = layoutFanGroup(handMeshes, { centerX: 0, centerY: -1.55, centerZ: HAND_BASE_Z, radius: 2.6, maxSpanDeg: 80 });
  const handZ = fitHandDepth(handExtent, HAND_BASE_Z);
  if (handZ !== HAND_BASE_Z) layoutFanGroup(handMeshes, { centerX: 0, centerY: -1.55, centerZ: handZ, radius: 2.6, maxSpanDeg: 80 });

  while (opponentMeshGroups.length > opponents.length) {
    const group = opponentMeshGroups.pop();
    group.meshes.forEach(disposeMesh);
  }
  while (opponentMeshGroups.length < opponents.length) opponentMeshGroups.push({ meshes: [] });

  const n = opponents.length;
  opponents.forEach((opp, i) => {
    const group = opponentMeshGroups[i];
    ensureMeshCount(group.meshes, opp.count);
    group.meshes.forEach((mesh) => {
      mesh.material.map = getCardBackTexture();
      mesh.material.color.set(0xffffff);
      mesh.material.needsUpdate = true;
    });
    const seatX = n > 1 ? (i - (n - 1) / 2) * 1.9 : 0;
    layoutFanGroup(group.meshes, { centerX: seatX, centerY: 1.9, centerZ: -2.6, radius: 0.85, maxSpanDeg: 70 });
  });

  ensureMeshCount(discardMeshes, discardCards.length);
  discardMeshes.forEach((mesh, i) => {
    const card = discardCards[i];
    mesh.material.map = getCardFaceTexture(card);
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate = true;
  });
  layoutDiscardPile(discardMeshes, discardCards, { centerX: 0.45, centerY: 0.05, centerZ: 0 });

  ensureMeshCount(drawPileMeshes, 4);
  drawPileMeshes.forEach((mesh, i) => {
    mesh.material.map = getCardBackTexture();
    mesh.material.color.set(0xffffff);
    mesh.material.needsUpdate = true;
    mesh.position.set(-0.55, 0.05 + i * 0.012, i * 0.01);
    mesh.rotation.z = 0;
  });
}

/**
 * Rectangles écran (coordonnées CSS px relatives au canvas) des `n`
 * dernières cartes de ma main, dans le même ordre que `updateTable` — sert
 * à superposer les vrais boutons DOM cliquables/glissables (voir
 * src/ui/games/uno.js). `camera.updateMatrixWorld()` est nécessaire :
 * cette caméra n'est ajoutée à aucune scène, son matrixWorld n'est donc
 * normalement recalculé qu'au prochain rendu WebGL — sans cet appel
 * explicite, la projection utiliserait encore la distance de caméra du
 * rendu précédent (bug direct constaté et corrigé côté Pouilleux, voir
 * getCardScreenRects dans pouilleuxScene.js).
 */
function projectMeshRects(meshes) {
  if (!mounted) return [];
  camera.updateMatrixWorld();
  const w = parseFloat(canvas.style.width) || canvas.clientWidth || 1;
  const h = parseFloat(canvas.style.height) || canvas.clientHeight || 1;
  const halfW = CARD_ASPECT / 2;
  const halfH = 0.5;
  const corner = new THREE.Vector3();

  return meshes.map((mesh) => {
    mesh.updateMatrixWorld();
    const xs = [];
    const ys = [];
    for (const [cx, cy] of [[-halfW, halfH], [halfW, halfH], [halfW, -halfH], [-halfW, -halfH]]) {
      corner.set(cx, cy, 0).applyMatrix4(mesh.matrixWorld).project(camera);
      xs.push((corner.x * 0.5 + 0.5) * w);
      ys.push((-corner.y * 0.5 + 0.5) * h);
    }
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  });
}

export function getHandCardRects() {
  return projectMeshRects(handMeshes);
}

export function getDrawPileRect() {
  return projectMeshRects(drawPileMeshes)[drawPileMeshes.length - 1] || null;
}

/** Rectangles écran des cartes de l'adversaire d'indice `index` (même ordre des sièges que `opponents` dans `updateTable`) — sert notamment à superposer un bouton Contre-UNO sur sa dernière carte visible. */
export function getOpponentCardRects(index) {
  const group = opponentMeshGroups[index];
  return group ? projectMeshRects(group.meshes) : [];
}
