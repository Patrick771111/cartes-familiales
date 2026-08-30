import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/**
 * Scène 3D persistante pour Lucky Numbers — une seule scène/caméra (comme
 * unoScene.js). Thème "jardin en trèfle" (référence visuelle + exemple de
 * code fournis par l'utilisateur) : plateau vert aux coins arrondis avec de
 * vraies encoches en relief (anneau TorusGeometry + puits sombre), jetons en
 * forme de trèfle à 4 pétales, coccinelle décorative, fond sombre + brouillard
 * pour donner de la profondeur — matériaux PBR standards plutôt qu'une
 * texture peinte (le rendu peint précédent ne rendait pas assez "vraie 3D").
 *
 * Caméra volontairement JAMAIS inclinée/élevée (même leçon que
 * pouilleuxScene.js/unoScene.js) : la profondeur de table (mon plateau
 * proche/grand/bas, ceux des adversaires loin/petits/haut) vient
 * uniquement du placement Y/Z des plateaux, jamais de l'angle de caméra.
 *
 * ATTENTION — piège rencontré avec un puits en vrai relief (cône peu
 * profond) : même caméra non inclinée, mon plateau est positionné loin de
 * l'axe optique (MY_BOARD_Y très négatif) donc chaque case est quand même
 * VUE avec un angle de biais non nul (pure perspective, rien à voir avec
 * une rotation de caméra). Un cône À PEINE creusé est extrêmement sensible
 * à cet angle : la moindre bascule fait disparaître la moitié du dégradé et
 * assombrit l'autre, donnant un "croissant" au lieu d'un creux net. D'où le
 * choix d'un puits en disque plat + DÉGRADÉ PEINT (texture radiale, non
 * éclairé) : indépendant de l'angle de vue et de la lumière, contrairement
 * à une vraie géométrie en relief à cette échelle de profondeur.
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
// Rayon extérieur (NOTCH_RADIUS + NOTCH_TUBE) volontairement < CELL_SPACING/2
// pour que deux anneaux voisins ne se touchent/chevauchent jamais — sinon
// leurs bords fusionnent en une bande continue entre les cases (bug constaté).
const NOTCH_RADIUS = 0.35;
const NOTCH_TUBE = 0.035;
const BOARD_MARGIN = 0.45;
const BOARD_SIZE = (GRID_DIM - 1) * CELL_SPACING + BOARD_MARGIN * 2;
const BOARD_THICKNESS = 0.14;

const CAMERA_DISTANCE = 8.5;
const CAMERA_FOV = 45;

const MY_BOARD_Z = 1.6;
// < 1 : un plateau à taille pleine (scale 1) est si grand que le remonter
// pour éviter le clipping (voir MY_BOARD_Y) laisse son bord haut presque
// coller aux plateaux adversaires — plus de place pour la pioche/défausse
// entre les deux (bug constaté : plateau "trop haut", piles invisibles).
const MY_BOARD_SCALE = 0.82;

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

// Thème "jardin en trèfle" (référence de l'utilisateur) — plateau vert uni
// (matériau PBR, plus de texture peinte) + jetons trèfle pastel par couleur.
const SCENE_BG = '#0f1f0f';
const BOARD_GREEN = '#3a8a42';
const WELL_DARK = '#1a4a22';
const RIM_GREEN = '#2a6a32';
const GOLD = '#ffd700';
const GOLD_EMISSIVE = '#ffaa00';
const CENTER_CREAM = '#fffaf0';
const CENTER_RIM = '#d8c9a8';
const NUMBER_DARK = '#2a1e10';

/** Couleur du pétale par couleur réelle de la tuile (yellow/red/violet/green du jeu) — assez saturée pour rester lisible sous l'éclairage/tone mapping de la scène. */
const TILE_COLOR_MAP = {
  yellow: '#f5c945',
  red: '#e2645f',
  violet: '#9b7fd4',
  green: '#7cc36a'
};
const TILE_COLOR_FALLBACK = '#cccccc';

let canvas = null;
let renderer = null;
let scene = null;
let camera = null;
let mounted = false;

let myBoard = null; // { board, wellMeshes, notchMeshes, glowMeshes, tokenMeshes: THREE.Mesh/Group[16] }
let opponentBoardGroups = []; // Array<même forme que myBoard>
let discardMeshes = [];
let drawPileMeshes = [];

let ladybug = null;
let ladybugBaseZ = 0;

const tokenFaceTextures = new Map(); // value -> THREE.Texture (fond crème + nombre, indépendant de la couleur)
let wellGeometry = null;
let wellMaterial = null;
let glowGeometry = null;
let glowMaterial = null;
let petalGeometry = null;
let centerGeometry = null;

function buildTokenFaceTexture(value) {
  const size = 200;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  ctx.fillStyle = CENTER_CREAM;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = CENTER_RIM;
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

function getPetalGeometry() {
  if (!petalGeometry) {
    petalGeometry = new THREE.SphereGeometry(TOKEN_RADIUS * 0.42, 14, 10);
    petalGeometry.userData.shared = true;
  }
  return petalGeometry;
}

function getCenterGeometry() {
  if (!centerGeometry) {
    centerGeometry = new THREE.CircleGeometry(TOKEN_RADIUS * 0.5, 24);
    centerGeometry.userData.shared = true;
  }
  return centerGeometry;
}

/**
 * Jeton = trèfle à 4 pétales (sphères aplaties) + disque central numéroté,
 * pas un simple galet — cohérent avec le thème "jardin en trèfle" et
 * l'exemple de rendu fourni par l'utilisateur. Pétales à plat dans le plan
 * XY (aplaties sur Z, l'axe caméra), comme tout le reste de cette scène.
 */
function createTokenMesh() {
  const group = new THREE.Group();
  const petals = [];
  for (let i = 0; i < 4; i++) {
    const material = new THREE.MeshStandardMaterial({ roughness: 0.45, metalness: 0.08 });
    const petal = new THREE.Mesh(getPetalGeometry(), material);
    const angle = (i * 90 + 45) * (Math.PI / 180);
    petal.position.set(Math.cos(angle) * TOKEN_RADIUS * 0.4, Math.sin(angle) * TOKEN_RADIUS * 0.4, 0);
    petal.scale.z = 0.35;
    group.add(petal);
    petals.push(petal);
  }
  const center = new THREE.Mesh(getCenterGeometry(), new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.5 }));
  center.position.z = TOKEN_RADIUS * 0.42 * 0.35 + 0.008;
  group.add(center);
  group.userData.petals = petals;
  group.userData.center = center;
  return group;
}

function setTokenValue(group, tile) {
  const color = TILE_COLOR_MAP[tile.color] || TILE_COLOR_FALLBACK;
  group.userData.petals.forEach((p) => {
    p.material.color.set(color);
    p.material.emissive.set(color);
    p.material.emissiveIntensity = 0.08;
  });
  group.userData.center.material.map = getTokenFaceTexture(tile.value);
  group.userData.center.material.color.set(0xffffff);
  group.userData.center.material.needsUpdate = true;
}

/** Apparence "dos" (pioche non retournée) — pétales ternes, disque central vide. */
function setTokenBlank(group) {
  group.userData.petals.forEach((p) => {
    p.material.color.set(RIM_GREEN);
    p.material.emissive.set(0x000000);
    p.material.emissiveIntensity = 0;
  });
  group.userData.center.material.map = null;
  group.userData.center.material.color.set(WELL_DARK);
  group.userData.center.material.needsUpdate = true;
}

/**
 * Rebord d'encoche — vrai anneau en relief (TorusGeometry), pas une texture
 * peinte : "le plateau doit avoir des encoches" (demande explicite).
 * PAS de rotation : un TorusGeometry est DÉJÀ face à la caméra par défaut
 * (anneau dans le plan XY, trou le long de Z) — contrairement au Cylindre/
 * Cercle/Sphère de ce fichier qui, eux, ont besoin d'une rotation.x pour ça.
 * La rotation.x=90° appliquée par erreur ici (copiée du reste du fichier
 * sans vérifier) mettait le tore de PROFIL, l'écrasant en ellipse plate au
 * lieu d'un cercle net — cause réelle du "bandeau vert qui traverse
 * chaque trou" (confirmé en comparant un tore pivoté et un non pivoté côte
 * à côte). MeshBasicMaterial (non éclairé) : un tube assez épais peut
 * quand même attraper la lumière directionnelle de façon inégale ; une
 * couleur fixe reste prévisible quel que soit l'angle.
 */
function createNotchMesh() {
  const geometry = new THREE.TorusGeometry(NOTCH_RADIUS, NOTCH_TUBE, 12, 28);
  const material = new THREE.MeshBasicMaterial({ color: RIM_GREEN, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
}

/** Dégradé radial peint (sombre au centre, halo léger avant le bord) — voir le commentaire d'en-tête sur pourquoi un vrai relief ne marche pas ici. */
function buildWellTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;
  const grad = ctx.createRadialGradient(cx, cy, size * 0.04, cx, cy, size * 0.5);
  grad.addColorStop(0, '#0d2610');
  grad.addColorStop(0.55, WELL_DARK);
  grad.addColorStop(0.85, '#2e5a34');
  grad.addColorStop(1, 'rgba(46,90,52,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getWellGeometry() {
  if (!wellGeometry) {
    wellGeometry = new THREE.CircleGeometry(NOTCH_RADIUS * 0.98, 28);
    wellGeometry.userData.shared = true;
  }
  return wellGeometry;
}

function getWellMaterial() {
  if (!wellMaterial) {
    // MeshBasicMaterial (non éclairé) : le dégradé peint doit rester identique
    // quel que soit l'angle de vue/lumière, pas dépendre d'une normale 3D.
    wellMaterial = new THREE.MeshBasicMaterial({ map: buildWellTexture(), transparent: true });
    wellMaterial.userData.shared = true;
  }
  return wellMaterial;
}

/** Puits sombre d'une encoche vide — géométrie et matériau partagés (jamais recolorés individuellement). */
function createWellMesh() {
  return new THREE.Mesh(getWellGeometry(), getWellMaterial());
}

function getGlowGeometry() {
  if (!glowGeometry) {
    glowGeometry = new THREE.CircleGeometry(NOTCH_RADIUS * 1.12, 32);
    glowGeometry.userData.shared = true;
  }
  return glowGeometry;
}

function getGlowMaterial() {
  if (!glowMaterial) {
    // metalness/roughness bas (glossy+métallique) créait un reflet spéculaire
    // localisé au lieu d'un halo uniforme — un "glow" doit rester plat/mat,
    // sa luminosité vient de `emissive`, pas d'une réflexion de la lumière.
    glowMaterial = new THREE.MeshStandardMaterial({
      color: GOLD,
      emissive: GOLD_EMISSIVE,
      emissiveIntensity: 0.85,
      roughness: 1,
      metalness: 0,
      transparent: true,
      opacity: 0.7
    });
    glowMaterial.userData.shared = true;
  }
  return glowMaterial;
}

/** Halo doré pulsant d'une case jouable — vient s'ajouter au rebord doré, ne le remplace pas. */
function createGlowMesh() {
  const mesh = new THREE.Mesh(getGlowGeometry(), getGlowMaterial());
  mesh.visible = false;
  return mesh;
}

function createBoardMesh() {
  const radius = Math.min(BOARD_THICKNESS / 2, BOARD_SIZE * 0.02);
  const geometry = new RoundedBoxGeometry(BOARD_SIZE, BOARD_SIZE, BOARD_THICKNESS, 3, radius);
  const material = new THREE.MeshStandardMaterial({ color: BOARD_GREEN, roughness: 0.85 });
  return new THREE.Mesh(geometry, material);
}

/** Petite coccinelle décorative posée sur MON plateau (référence de l'utilisateur) — purement esthétique. */
function buildLadybug() {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.SphereGeometry(TOKEN_RADIUS * 0.5, 20, 16),
    new THREE.MeshStandardMaterial({ color: '#d81e1e', roughness: 0.35, metalness: 0.1 })
  );
  body.scale.set(1.15, 0.95, 0.55);
  group.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(TOKEN_RADIUS * 0.28, 16, 12),
    new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.4 })
  );
  head.position.set(TOKEN_RADIUS * 0.62, 0, TOKEN_RADIUS * 0.1);
  group.add(head);

  const spotMat = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.4 });
  const spotGeo = new THREE.SphereGeometry(TOKEN_RADIUS * 0.09, 10, 8);
  [
    [-0.15, 0.18, 0.16],
    [-0.15, -0.18, 0.16],
    [0.1, 0.24, 0.18],
    [0.1, -0.24, 0.18],
    [0.28, 0, 0.2]
  ].forEach(([sx, sy, sz]) => {
    const spot = new THREE.Mesh(spotGeo, spotMat);
    spot.position.set(sx, sy, sz);
    body.add(spot);
  });

  return group;
}

function disposeMesh(obj) {
  if (!obj) return;
  scene.remove(obj);
  obj.traverse((child) => {
    if (child.geometry && !child.geometry.userData.shared) child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
    materials.forEach((m) => {
      if (!m.userData.shared) m.dispose();
    });
  });
}

/** Décalage local (avant mise à l'échelle) d'une case dans la grille 4×4 — ligne 0 = haut, colonne 0 = gauche. */
function cellLocalOffset(index) {
  const row = Math.floor(index / GRID_DIM);
  const col = index % GRID_DIM;
  const mid = (GRID_DIM - 1) / 2;
  return { dx: (col - mid) * CELL_SPACING, dy: (mid - row) * CELL_SPACING };
}

function createBoardGroup() {
  return {
    board: createBoardMesh(),
    wellMeshes: Array(GRID_SIZE).fill(null),
    notchMeshes: Array(GRID_SIZE).fill(null),
    glowMeshes: Array(GRID_SIZE).fill(null),
    tokenMeshes: Array(GRID_SIZE).fill(null)
  };
}

function disposeBoardGroup(group) {
  disposeMesh(group.board);
  group.wellMeshes.forEach(disposeMesh);
  group.notchMeshes.forEach(disposeMesh);
  group.glowMeshes.forEach(disposeMesh);
  group.tokenMeshes.forEach(disposeMesh);
}

/**
 * Place/actualise un plateau complet à (centerX, centerY, centerZ), mis à
 * l'échelle `scale` (plateaux adversaires plus petits — voir updateScene).
 * `placeableIndexes` (miennes uniquement) éclaircit l'encoche en doré (rebord
 * + halo), même intention que le contraste jouable/grisé des autres jeux.
 */
function layoutBoardGroup(group, board, { centerX, centerY, centerZ, scale, placeableIndexes = [] }) {
  group.board.position.set(centerX, centerY, centerZ);
  group.board.scale.setScalar(scale);
  const surfaceZ = centerZ + (BOARD_THICKNESS / 2) * scale;

  for (let i = 0; i < GRID_SIZE; i++) {
    const { dx, dy } = cellLocalOffset(i);
    const x = centerX + dx * scale;
    const y = centerY + dy * scale;
    const highlighted = placeableIndexes.includes(i);

    // renderOrder explicite : ces meshes sont si proches en Z (quelques
    // millièmes) que le tri par distance-caméra par défaut de Three.js pour
    // les objets transparents peut les intercaler dans le mauvais ordre
    // (bug constaté : bande visible traversant les cases en surbrillance).
    if (!group.wellMeshes[i]) {
      const well = createWellMesh();
      well.renderOrder = 1;
      scene.add(well);
      group.wellMeshes[i] = well;
    }
    const well = group.wellMeshes[i];
    well.position.set(x, y, surfaceZ + 0.002 * scale);
    well.scale.setScalar(scale);

    if (!group.notchMeshes[i]) {
      const notch = createNotchMesh();
      notch.renderOrder = 2;
      scene.add(notch);
      group.notchMeshes[i] = notch;
    }
    const notch = group.notchMeshes[i];
    notch.position.set(x, y, surfaceZ + 0.005 * scale);
    notch.scale.setScalar(scale);
    notch.material.color.set(highlighted ? GOLD : RIM_GREEN);

    if (!group.glowMeshes[i]) {
      const glow = createGlowMesh();
      glow.renderOrder = 3;
      scene.add(glow);
      group.glowMeshes[i] = glow;
    }
    const glow = group.glowMeshes[i];
    glow.position.set(x, y, surfaceZ + 0.004 * scale);
    glow.scale.setScalar(scale);
    glow.visible = highlighted;

    const tile = board[i];
    if (tile) {
      if (!group.tokenMeshes[i]) {
        const token = createTokenMesh();
        token.renderOrder = 4;
        scene.add(token);
        group.tokenMeshes[i] = token;
      }
      const token = group.tokenMeshes[i];
      token.visible = true;
      token.position.set(x, y, surfaceZ + 0.02 * scale);
      token.scale.setScalar(scale);
      setTokenValue(token, tile);
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
  scene.background = new THREE.Color(SCENE_BG);
  // near au-delà de la distance des plateaux adversaires (~10.9) : le
  // brouillard ne doit pas les rendre flous/délavés, juste teinter le vide
  // derrière eux — bug constaté avec near=7.5 (déjà ~50% de brouillard là-bas).
  scene.fog = new THREE.Fog(SCENE_BG, 11.5, 20);

  camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
  camera.position.set(0, 0, CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xbfe8c8, 0x14210f, 0.5));
  const keyLight = new THREE.DirectionalLight(0xfff4e0, 0.7);
  keyLight.position.set(2, 3, 6);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x88aaff, 0.2);
  fillLight.position.set(-3, 2, -2);
  scene.add(fillLight);

  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  myBoard = createBoardGroup();
  scene.add(myBoard.board);

  ladybug = buildLadybug();
  // Réduite et casée dans le coin, à l'écart du rayon extérieur de la case
  // voisine (NOTCH_RADIUS + NOTCH_TUBE) — sinon elle mange une partie du trou.
  ladybug.scale.setScalar(0.55);
  ladybug.position.set(1.634, MY_BOARD_Y + 1.634, MY_BOARD_Z + BOARD_THICKNESS / 2 + 0.06);
  ladybugBaseZ = ladybug.position.z;
  scene.add(ladybug);

  const tick = () => {
    requestAnimationFrame(tick);
    const t = performance.now() * 0.001;
    if (glowMaterial) glowMaterial.emissiveIntensity = 0.55 + 0.35 * Math.sin(t * 3);
    if (ladybug) ladybug.position.z = ladybugBaseZ + Math.sin(t * 2) * 0.01;
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
 * - `myBoardTiles` : `Array<{value,color}|null>` de longueur 16 (mon jardin).
 * - `placeableIndexes` : indices de MON plateau où la tuile en cours (piochée
 *   ou de défausse sélectionnée) peut être posée — surligne l'encoche.
 * - `opponents` : `Array<{ board: Array<{value,color}|null> }>`, un par
 *   adversaire dans l'ordre des sièges déjà calculé par l'appelant.
 * - `discardTiles` : `Array<{value,color}>` — tuiles visibles de la défausse commune.
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

  // Z rapproché de la caméra (mais toujours derrière mon plateau à MY_BOARD_Z)
  // pour que la pioche/défausse restent bien visibles, pas minuscules au loin.
  const PILE_Z = 0.9;

  ensureDiscardMeshCount(discardTiles.length);
  discardTiles.forEach((tile, i) => {
    const mesh = discardMeshes[i];
    mesh.visible = true;
    setTokenValue(mesh, tile);
    const spread = (i - (discardTiles.length - 1) / 2) * (TOKEN_RADIUS * 2.1);
    mesh.position.set(0.65 + spread, NEUTRAL_ZONE_Y, PILE_Z);
  });

  ensureDrawPileMeshCount(stockCount > 0 ? 4 : 0);
  drawPileMeshes.forEach((mesh, i) => {
    mesh.position.set(-0.65, NEUTRAL_ZONE_Y + i * 0.02, PILE_Z - 0.05 + i * 0.01);
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
    setTokenBlank(mesh);
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
  const half = TOKEN_RADIUS * 1.15 * MY_BOARD_SCALE;
  const x = dx * MY_BOARD_SCALE;
  const y = MY_BOARD_Y + dy * MY_BOARD_SCALE;
  const z = MY_BOARD_Z + (BOARD_THICKNESS / 2 + 0.02) * MY_BOARD_SCALE;
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
