import * as THREE from 'three';

/**
 * Scène 3D persistante pour Lucky Numbers — une seule scène/caméra (comme
 * unoScene.js), mais avec une VRAIE géométrie 3D plutôt que de simples
 * plans texturés : les jetons sont des cylindres plats (galets de bois),
 * les plateaux ont de vraies encoches en relief (anneaux TorusGeometry),
 * pas juste une texture peinte — demande explicite de l'utilisateur.
 *
 * Caméra volontairement JAMAIS inclinée/élevée (même leçon que
 * pouilleuxScene.js/unoScene.js) : la profondeur de table (mon plateau
 * proche/grand/bas, ceux des adversaires loin/petits/haut) vient
 * uniquement du placement Y/Z des plateaux, jamais de l'angle de caméra.
 *
 * Montée UNE SEULE FOIS, ajoutée à `document.body` (donc en dehors de
 * `#app`) — un canvas WebGL recréé à chaque coup perdrait son contexte GL
 * et clignoterait.
 *
 * Volontairement décoratif : les clics réels restent sur des boutons DOM
 * invisibles superposés (voir getMyBoardCellRects/getDiscardTileRects/
 * getDrawPileRect, utilisés par src/ui/games/luckynumbers.js).
 */

const GRID_DIM = 4;
const GRID_SIZE = GRID_DIM * GRID_DIM;
const CELL_SPACING = 0.85;
const TOKEN_RADIUS = 0.36;
const TOKEN_HEIGHT = 0.12;
const NOTCH_RADIUS = 0.4;
const NOTCH_TUBE = 0.045;
const BOARD_MARGIN = 0.45;
const BOARD_SIZE = (GRID_DIM - 1) * CELL_SPACING + BOARD_MARGIN * 2;
const BOARD_THICKNESS = 0.14;

const CAMERA_DISTANCE = 8.5;
const CAMERA_FOV = 45;

const MY_BOARD_Z = 1.6;
const MY_BOARD_SCALE = 1;

/**
 * Le FOV d'une PerspectiveCamera est TOUJOURS vertical (indépendant de
 * l'aspect ratio) — un plateau placé à un centerY fixe peut sortir du
 * frustum même si le conteneur CSS a de la place, car le clipping se
 * fait en espace caméra 3D, pas en layout CSS (bug déjà rencontré et
 * corrigé sur la main du Uno via maxHandCenterY, même cause ici).
 */
function visibleHalfHeightAt(z) {
  const halfVFov = (CAMERA_FOV * Math.PI) / 360;
  return (CAMERA_DISTANCE - z) * Math.tan(halfVFov);
}

const MY_BOARD_HALF = (BOARD_SIZE / 2) * MY_BOARD_SCALE;
// Centre le plus bas possible tout en gardant le plateau entier dans le frustum (petite marge de sécurité).
const MY_BOARD_Y = -(visibleHalfHeightAt(MY_BOARD_Z) - MY_BOARD_HALF - 0.1);

const WOOD_LIGHT = '#C9A066';
const WOOD_MID = '#A9762E';
const WOOD_DARK = '#6E4B22';
const WOOD_SIDE = '#8A5F2C';
const NUMBER_DARK = '#3B2712';
const NOTCH_DARK = '#3B4A22';
const NOTCH_HIGHLIGHT = '#D4AF37';

// Thème "jardin en trèfle" du plateau (référence fournie par l'utilisateur) —
// séparé des couleurs bois des jetons, qui restent inchangés.
const GRASS_MID = '#5C8A3A';
const GRASS_LIGHT = '#719C4A';
const GRASS_DARK = '#3F6428';
const LEAF_GREEN = '#7CB342';
const LEAF_DARK = '#4E7A2C';

let canvas = null;
let renderer = null;
let scene = null;
let camera = null;
let mounted = false;

let myBoard = null; // { group, notchMeshes: THREE.Mesh[16], tokenMeshes: (THREE.Mesh|null)[16] }
let opponentBoardGroups = []; // Array<même forme que myBoard>
let discardMeshes = [];
let drawPileMeshes = [];

let boardTexture = null;
const tokenFaceTextures = new Map(); // value -> THREE.Texture
let tokenSideMaterial = null;
let tokenBottomMaterial = null;

/** Dessine un petit trèfle à 3 folioles (cercles superposés + tige) — décor du plateau "jardin". */
function drawClover(ctx, x, y, size, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(Math.random() * Math.PI * 2);
  const r = size * 0.32;
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(Math.cos(a) * r, Math.sin(a) * r, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = size * 0.12;
  ctx.beginPath();
  ctx.moveTo(0, r * 0.5);
  ctx.lineTo(0, size * 0.85);
  ctx.stroke();
  ctx.restore();
}

/**
 * Plateau "jardin en trèfle" (référence visuelle fournie par l'utilisateur) :
 * fond herbe moucheté + trèfles éparpillés, avec un puits sombre peint
 * directement sous chaque case pour simuler le creux d'une vraie encoche —
 * l'anneau TorusGeometry (voir createNotchMesh) reste la seule géométrie
 * réelle en relief, mais ce puits peint donne l'illusion de profondeur que
 * l'anneau seul (posé à plat sur une texture unie) ne donnait pas.
 */
function buildBoardTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');

  ctx.fillStyle = GRASS_MID;
  ctx.fillRect(0, 0, size, size);

  // Mouchetures d'herbe : brins courts, orientation et teinte aléatoires.
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * size;
    const y = Math.random() * size;
    const len = 4 + Math.random() * 7;
    const angle = Math.random() * Math.PI * 2;
    ctx.strokeStyle = Math.random() > 0.5 ? GRASS_LIGHT : GRASS_DARK;
    ctx.globalAlpha = 0.25 + Math.random() * 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Trèfles décoratifs éparpillés sur toute la surface.
  for (let i = 0; i < 30; i++) {
    drawClover(ctx, Math.random() * size, Math.random() * size, 10 + Math.random() * 11, Math.random() > 0.5 ? LEAF_GREEN : LEAF_DARK);
  }

  ctx.strokeStyle = GRASS_DARK;
  ctx.lineWidth = 10;
  ctx.strokeRect(5, 5, size - 10, size - 10);

  // Puits sombres peints à l'emplacement exact des 16 encoches (voir cellLocalOffset).
  for (let i = 0; i < GRID_SIZE; i++) {
    const { dx, dy } = cellLocalOffset(i);
    const u = 0.5 + dx / BOARD_SIZE;
    const v = 0.5 + dy / BOARD_SIZE;
    const cx = u * size;
    const cy = (1 - v) * size; // Y du monde vers le haut, Y du canvas vers le bas.
    const r = (NOTCH_RADIUS / BOARD_SIZE) * size * 1.05;
    const grad = ctx.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    grad.addColorStop(0, 'rgba(18,26,10,0.85)');
    grad.addColorStop(0.7, 'rgba(18,26,10,0.55)');
    grad.addColorStop(1, 'rgba(18,26,10,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getBoardTexture() {
  if (!boardTexture) boardTexture = buildBoardTexture();
  return boardTexture;
}

function buildTokenFaceTexture(value) {
  const size = 200;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  const grad = ctx.createRadialGradient(cx * 0.7, cy * 0.6, size * 0.05, cx, cy, size * 0.55);
  grad.addColorStop(0, WOOD_LIGHT);
  grad.addColorStop(1, WOOD_MID);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = NUMBER_DARK;
  ctx.font = `700 ${Math.round(size * 0.42)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), cx, cy + size * 0.02);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getTokenFaceTexture(value) {
  let texture = tokenFaceTextures.get(value);
  if (!texture) {
    texture = buildTokenFaceTexture(value);
    tokenFaceTextures.set(value, texture);
  }
  return texture;
}

function getTokenSideMaterial() {
  if (!tokenSideMaterial) tokenSideMaterial = new THREE.MeshStandardMaterial({ color: WOOD_SIDE });
  return tokenSideMaterial;
}

function getTokenBottomMaterial() {
  if (!tokenBottomMaterial) tokenBottomMaterial = new THREE.MeshStandardMaterial({ color: WOOD_DARK });
  return tokenBottomMaterial;
}

/**
 * Jeton = cylindre plat (galet de bois), pas un simple plan comme les
 * cartes des autres jeux — "billes de bois aplaties" (demande explicite).
 * 3 groupes de matériaux natifs à CylinderGeometry (flanc / dessus /
 * dessous) : le dessus reçoit la texture avec le nombre (voir
 * setTokenValue), flanc et dessous restent en bois uni (jamais vus de
 * face). Tourné de 90° sur X pour que les faces plates (dessus/dessous)
 * regardent la caméra, comme le reste des plans de cette appli.
 */
function createTokenMesh() {
  const geometry = new THREE.CylinderGeometry(TOKEN_RADIUS, TOKEN_RADIUS, TOKEN_HEIGHT, 32);
  const material = [getTokenSideMaterial(), new THREE.MeshStandardMaterial({ transparent: true }), getTokenBottomMaterial()];
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function setTokenValue(mesh, value) {
  mesh.material[1].map = getTokenFaceTexture(value);
  mesh.material[1].color.set(0xffffff);
  mesh.material[1].needsUpdate = true;
}

/** Rebord d'encoche — vrai anneau en relief (TorusGeometry), pas une texture peinte : "le plateau doit avoir des encoches" (demande explicite). */
function createNotchMesh() {
  const geometry = new THREE.TorusGeometry(NOTCH_RADIUS, NOTCH_TUBE, 12, 28);
  const material = new THREE.MeshStandardMaterial({ color: NOTCH_DARK });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2;
  return mesh;
}

function createBoardMesh() {
  const geometry = new THREE.BoxGeometry(BOARD_SIZE, BOARD_SIZE, BOARD_THICKNESS);
  const material = new THREE.MeshStandardMaterial({ map: getBoardTexture() });
  return new THREE.Mesh(geometry, material);
}

function disposeMesh(mesh) {
  if (!mesh) return;
  scene.remove(mesh);
  mesh.geometry.dispose();
  if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
  else mesh.material.dispose();
}

/** Décalage local (avant mise à l'échelle) d'une case dans la grille 4×4 — ligne 0 = haut, colonne 0 = gauche. */
function cellLocalOffset(index) {
  const row = Math.floor(index / GRID_DIM);
  const col = index % GRID_DIM;
  const mid = (GRID_DIM - 1) / 2;
  return { dx: (col - mid) * CELL_SPACING, dy: (mid - row) * CELL_SPACING };
}

function createBoardGroup() {
  return { board: createBoardMesh(), notchMeshes: Array(GRID_SIZE).fill(null), tokenMeshes: Array(GRID_SIZE).fill(null) };
}

function disposeBoardGroup(group) {
  disposeMesh(group.board);
  group.notchMeshes.forEach(disposeMesh);
  group.tokenMeshes.forEach(disposeMesh);
}

/**
 * Place/actualise un plateau complet à (centerX, centerY, centerZ), mis à
 * l'échelle `scale` (plateaux adversaires plus petits — voir updateScene).
 * `placeableIndexes` (miennes uniquement) éclaircit l'anneau de la case en
 * doré, même intention que le contraste jouable/grisé des autres jeux.
 */
function layoutBoardGroup(group, board, { centerX, centerY, centerZ, scale, placeableIndexes = [] }) {
  group.board.position.set(centerX, centerY, centerZ);
  group.board.scale.setScalar(scale);

  for (let i = 0; i < GRID_SIZE; i++) {
    const { dx, dy } = cellLocalOffset(i);
    const x = centerX + dx * scale;
    const y = centerY + dy * scale;

    if (!group.notchMeshes[i]) {
      const notch = createNotchMesh();
      scene.add(notch);
      group.notchMeshes[i] = notch;
    }
    const notch = group.notchMeshes[i];
    notch.position.set(x, y, centerZ + (BOARD_THICKNESS / 2) * scale + 0.005);
    notch.scale.setScalar(scale);
    notch.material.color.set(placeableIndexes.includes(i) ? NOTCH_HIGHLIGHT : NOTCH_DARK);

    const tile = board[i];
    if (tile) {
      if (!group.tokenMeshes[i]) {
        const token = createTokenMesh();
        scene.add(token);
        group.tokenMeshes[i] = token;
      }
      const token = group.tokenMeshes[i];
      token.visible = true;
      token.position.set(x, y, centerZ + (BOARD_THICKNESS / 2) * scale + 0.02);
      token.scale.setScalar(scale);
      setTokenValue(token, tile.value);
    } else if (group.tokenMeshes[i]) {
      group.tokenMeshes[i].visible = false;
    }
  }
}

function ensureScene() {
  if (mounted) return;
  mounted = true;

  canvas = document.createElement('canvas');
  canvas.id = 'luckynumbers-3d-canvas';
  canvas.style.position = 'fixed';
  canvas.style.pointerEvents = 'none'; // les clics traversent vers les boutons DOM dessous
  canvas.style.display = 'none';
  canvas.style.zIndex = '5'; // sous les bulles HUD (z-index 50), au-dessus du feutre
  document.body.appendChild(canvas);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
  dirLight.position.set(1, 2, 3);
  scene.add(dirLight);

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  myBoard = createBoardGroup();
  scene.add(myBoard.board);

  const tick = () => {
    requestAnimationFrame(tick);
    renderer.render(scene, camera);
  };
  tick();
}

export function mountBoard() {
  ensureScene();
}

/** Ajuste le canvas fixe pour qu'il recouvre exactement `rect` (un DOMRect, coordonnées viewport). */
export function positionBoard(rect) {
  if (!mounted || !rect || rect.width <= 0 || rect.height <= 0) return;
  canvas.style.left = `${rect.left}px`;
  canvas.style.top = `${rect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

export function showBoard() {
  if (canvas) canvas.style.display = 'block';
}

export function hideBoard() {
  if (canvas) canvas.style.display = 'none';
}

/**
 * Reconstruit toute la scène à partir de l'état nécessaire au rendu :
 * - `myBoardTiles` : `Array<{value}|null>` de longueur 16 (mon jardin).
 * - `placeableIndexes` : indices de MON plateau où la tuile en cours (piochée
 *   ou de défausse sélectionnée) peut être posée — surligne l'encoche.
 * - `opponents` : `Array<{ board: Array<{value}|null> }>`, un par adversaire
 *   dans l'ordre des sièges déjà calculé par l'appelant (orderedOpponents).
 * - `discardTiles` : `Array<{value}>` — tuiles visibles de la défausse commune.
 * - `stockCount` : nombre de tuiles restantes dans la pioche (juste pour
 *   décider si la pioche doit apparaître "pleine" ou non, purement décoratif).
 */
export function updateScene({ myBoardTiles = [], placeableIndexes = [], opponents = [], discardTiles = [], stockCount = 0 }) {
  if (!mounted) return;

  layoutBoardGroup(myBoard, myBoardTiles, { centerX: 0, centerY: MY_BOARD_Y, centerZ: MY_BOARD_Z, scale: MY_BOARD_SCALE, placeableIndexes });

  while (opponentBoardGroups.length > opponents.length) disposeBoardGroup(opponentBoardGroups.pop());
  while (opponentBoardGroups.length < opponents.length) {
    const group = createBoardGroup();
    scene.add(group.board);
    opponentBoardGroups.push(group);
  }
  const n = opponents.length;
  const oppScale = 0.42;
  opponents.forEach((opp, i) => {
    const seatX = n > 1 ? (i - (n - 1) / 2) * BOARD_SIZE * oppScale * 1.35 : 0;
    layoutBoardGroup(opponentBoardGroups[i], opp.board, { centerX: seatX, centerY: 1.9, centerZ: -2.4, scale: oppScale });
  });

  // Zone neutre entre le haut de mon plateau et le bas de ceux des adversaires — évite que
  // les piles soient masquées par mon plateau (bug constaté après avoir remonté MY_BOARD_Y).
  const myBoardTopEdge = MY_BOARD_Y + MY_BOARD_HALF;
  const opponentBottomEdge = 1.9 - (BOARD_SIZE / 2) * oppScale;
  const NEUTRAL_ZONE_Y = (myBoardTopEdge + opponentBottomEdge) / 2;

  ensureDiscardMeshCount(discardTiles.length);
  discardTiles.forEach((tile, i) => {
    const mesh = discardMeshes[i];
    mesh.visible = true;
    setTokenValue(mesh, tile.value);
    const spread = (i - (discardTiles.length - 1) / 2) * (TOKEN_RADIUS * 2.1);
    mesh.position.set(0.65 + spread, NEUTRAL_ZONE_Y, 0.15);
  });

  ensureDrawPileMeshCount(stockCount > 0 ? 4 : 0);
  drawPileMeshes.forEach((mesh, i) => {
    mesh.position.set(-0.65, NEUTRAL_ZONE_Y + i * 0.02, 0.1 + i * 0.01);
  });
}

function ensureDiscardMeshCount(count) {
  while (discardMeshes.length > count) disposeMesh(discardMeshes.pop());
  while (discardMeshes.length < count) {
    const mesh = createTokenMesh();
    scene.add(mesh);
    discardMeshes.push(mesh);
  }
}

function ensureDrawPileMeshCount(count) {
  while (drawPileMeshes.length > count) disposeMesh(drawPileMeshes.pop());
  while (drawPileMeshes.length < count) {
    const mesh = createTokenMesh();
    mesh.material[1].map = null;
    mesh.material[1].color.set(WOOD_DARK);
    mesh.material[1].needsUpdate = true;
    scene.add(mesh);
    drawPileMeshes.push(mesh);
  }
}

/**
 * Rectangles écran (coordonnées CSS px relatives au canvas) d'un ensemble
 * de meshes — sert à superposer les vrais boutons DOM cliquables (voir
 * src/ui/games/luckynumbers.js). `camera.updateMatrixWorld()` est
 * nécessaire : cette caméra n'est ajoutée à aucune scène, son matrixWorld
 * n'est donc normalement recalculé qu'au prochain rendu WebGL — sans cet
 * appel explicite, la projection utiliserait encore la distance de caméra
 * du rendu précédent (bug direct constaté et corrigé côté Pouilleux/Uno).
 */
function projectPointsRect(points) {
  if (!mounted) return null;
  camera.updateMatrixWorld();
  const w = parseFloat(canvas.style.width) || canvas.clientWidth || 1;
  const h = parseFloat(canvas.style.height) || canvas.clientHeight || 1;
  const p = new THREE.Vector3();
  const xs = [];
  const ys = [];
  for (const [x, y, z] of points) {
    p.set(x, y, z).project(camera);
    xs.push((p.x * 0.5 + 0.5) * w);
    ys.push((-p.y * 0.5 + 0.5) * h);
  }
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
}

/** Rectangle de la case `index` de MON plateau (case vide ou occupée — pure géométrie de grille, indépendante d'un éventuel jeton dessus). */
export function getMyBoardCellRect(index) {
  const { dx, dy } = cellLocalOffset(index);
  const half = TOKEN_RADIUS * 1.15;
  const x = dx;
  const y = MY_BOARD_Y + dy;
  const z = MY_BOARD_Z + BOARD_THICKNESS / 2 + 0.02;
  return projectPointsRect([
    [x - half, y + half, z],
    [x + half, y + half, z],
    [x + half, y - half, z],
    [x - half, y - half, z]
  ]);
}

export function getMyBoardCellRects() {
  return Array.from({ length: GRID_SIZE }, (_, i) => getMyBoardCellRect(i));
}

function meshScreenRect(mesh) {
  if (!mesh) return null;
  const half = TOKEN_RADIUS * 1.1;
  const { x, y, z } = mesh.position;
  return projectPointsRect([
    [x - half, y + half, z],
    [x + half, y + half, z],
    [x + half, y - half, z],
    [x - half, y - half, z]
  ]);
}

export function getDiscardTileRects() {
  return discardMeshes.map(meshScreenRect);
}

export function getDrawPileRect() {
  return meshScreenRect(drawPileMeshes[drawPileMeshes.length - 1]);
}
