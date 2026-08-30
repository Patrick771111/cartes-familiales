import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import boardPlateUrl from '../assets/games/luckynumbers/board-plate.jpg';

/**
 * Scène 3D persistante pour Lucky Numbers — une seule scène/caméra (comme
 * unoScene.js). Tous les plateaux (le mien + ceux des adversaires) sont à
 * la MÊME taille, alignés côte à côte sur une "table" (plan texturé bois) ;
 * la caméra ne fait que TRANSLATER horizontalement (glisser pour faire
 * défiler, voir panCameraByScreenDelta) — jamais de rotation/inclinaison,
 * donc toujours la même leçon que pouilleuxScene.js/unoScene.js : une
 * translation pure ne déforme rien, contrairement à une rotation.
 *
 * Le plateau utilise une VRAIE photo (voir boardPlateUrl) comme texture —
 * demande explicite de l'utilisateur — avec un remplacement "blanc → vert"
 * au chargement (voir loadBoardPlateTexture) pour que le fond blanc de la
 * photo (hors de la forme octogonale du plateau) ne laisse pas de taches
 * blanches aux 4 coins de notre géométrie rectangulaire. Les encoches
 * (anneau + puits + halo) restent une VRAIE géométrie/dégradé par-dessus
 * cette texture, pour garder la surbrillance dynamique des cases jouables.
 *
 * ATTENTION — piège rencontré avec un puits en vrai relief (cône peu
 * profond) : même caméra non inclinée, un plateau loin de l'axe optique
 * est quand même VU avec un angle de biais non nul (pure perspective,
 * rien à voir avec une rotation de caméra). Un cône À PEINE creusé est
 * extrêmement sensible à cet angle : la moindre bascule fait disparaître
 * la moitié du dégradé, donnant un "croissant" au lieu d'un creux net.
 * D'où le choix d'un puits en disque plat + DÉGRADÉ PEINT (texture
 * radiale, non éclairé) : indépendant de l'angle de vue et de la lumière.
 *
 * Montée UNE SEULE FOIS, ajoutée à `document.body` (donc en dehors de
 * `#app`) — un canvas WebGL recréé à chaque coup perdrait son contexte GL
 * et clignoterait.
 *
 * Volontairement décoratif : les clics réels restent sur des boutons DOM
 * invisibles superposés (voir getMyBoardCellRects/getDiscardTileRects/
 * getDrawPileRect, utilisés par src/ui/games/luckynumbers.js) — et comme
 * la caméra peut désormais bouger, ces boutons doivent être repositionnés
 * pendant le glisser, pas seulement au rendu initial (voir positionBoard).
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

// Taille UNIQUE pour tous les plateaux (moi + adversaires) — demande
// explicite de l'utilisateur, remplace l'ancien système "le mien proche/
// grand, ceux des adversaires loin/petits".
const TABLE_Z = 1.6;
const BOARD_SCALE = 0.75;
const BOARD_HALF = (BOARD_SIZE / 2) * BOARD_SCALE;
const SEAT_SPACING = BOARD_SIZE * BOARD_SCALE * 1.65;

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

// Légèrement sous le centre optique pour laisser de la place au texte de
// statut en haut d'écran, tout en gardant une bonne marge de sécurité
// verticale (BOARD_HALF est petit maintenant que tous les plateaux
// partagent la même échelle réduite — plus besoin du calcul au plus près
// du bord comme à l'époque du plateau "plein cadre").
const TABLE_Y = -0.35;

/** Position X du siège `index` parmi `total` sièges, centrée sur X=0 (le "milieu de la table"). */
function seatX(index, total) {
  return (index - (total - 1) / 2) * SEAT_SPACING;
}

// Thème "jardin en trèfle" (référence de l'utilisateur) — plateau texturé
// (vraie photo, voir boardPlateUrl) + jetons trèfle pastel par couleur.
const SCENE_BG = '#0f1f0f';
const BOARD_GREEN = '#3a8a42';
const WELL_DARK = '#1a4a22';
const RIM_GREEN = '#2a6a32';
const GOLD = '#ffd700';
const GOLD_EMISSIVE = '#ffaa00';
const CENTER_CREAM = '#fffaf0';
const CENTER_RIM = '#d8c9a8';
const NUMBER_DARK = '#2a1e10';
const WOOD_TABLE = '#8a5a34';
const WOOD_TABLE_DARK = '#6b3f22';

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

let boardGroups = []; // [0] = moi, [1..] = adversaires dans l'ordre des sièges déjà calculé par l'appelant
let discardMeshes = [];
let drawPileMeshes = [];
let tableMesh = null;

let myCurrentSeatX = 0; // recalculé à chaque updateScene selon le nombre de sièges — voir getMyBoardCellRect

let cameraPanX = 0;
let panMin = 0;
let panMax = 0;

const tokenFaceTextures = new Map(); // value -> THREE.Texture (fond crème + nombre, indépendant de la couleur)
let wellGeometry = null;
let wellMaterial = null;
let glowGeometry = null;
let glowMaterial = null;
let petalGeometry = null;
let centerGeometry = null;
let woodTexture = null;
let boardPlateTexture = null;
let boardPlateLoadPromise = null;

function hexToRgbTuple(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Charge la photo du plateau (voir boardPlateUrl, demande explicite) et
 * remplace son fond blanc par le vert du plateau : la photo montre un
 * plateau aux coins coupés (octogone) posé sur fond blanc, alors que notre
 * géométrie est un simple rectangle — sans ce remplacement, les 4 coins de
 * notre plateau 3D montreraient des taches blanches issues de la photo.
 * Recadre aussi légèrement (cropFrac) pour réduire cette marge blanche.
 */
function loadBoardPlateTexture() {
  if (boardPlateTexture) return Promise.resolve(boardPlateTexture);
  if (boardPlateLoadPromise) return boardPlateLoadPromise;
  boardPlateLoadPromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 768;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const cropFrac = 0.92;
      const sx = img.width * (1 - cropFrac) * 0.5;
      const sy = img.height * (1 - cropFrac) * 0.35;
      const sw = img.width * cropFrac;
      const sh = img.height * cropFrac;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size);
      const px = imageData.data;
      const [gr, gg, gb] = hexToRgbTuple(BOARD_GREEN);
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 233 && px[i + 1] > 233 && px[i + 2] > 233) {
          px[i] = gr;
          px[i + 1] = gg;
          px[i + 2] = gb;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      const texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      boardPlateTexture = texture;
      resolve(texture);
    };
    img.src = boardPlateUrl;
  });
  return boardPlateLoadPromise;
}

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
 * MeshBasicMaterial (non éclairé) : une couleur fixe reste prévisible quel
 * que soit l'angle de vue, contrairement à un matériau éclairé qui peut
 * attraper la lumière directionnelle de façon inégale sur un tube épais.
 */
function createNotchMesh() {
  const geometry = new THREE.TorusGeometry(NOTCH_RADIUS, NOTCH_TUBE, 12, 28);
  const material = new THREE.MeshBasicMaterial({ color: RIM_GREEN, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
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

/** Matériau du plateau : vert uni au départ, remplacé par la vraie photo dès qu'elle est chargée (async, voir loadBoardPlateTexture). */
function createBoardMesh() {
  const radius = Math.min(BOARD_THICKNESS / 2, BOARD_SIZE * 0.02);
  const geometry = new RoundedBoxGeometry(BOARD_SIZE, BOARD_SIZE, BOARD_THICKNESS, 3, radius);
  const material = new THREE.MeshStandardMaterial({ color: BOARD_GREEN, roughness: 0.85 });
  const mesh = new THREE.Mesh(geometry, material);
  loadBoardPlateTexture().then((texture) => {
    material.map = texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  });
  return mesh;
}

function buildWoodTableTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.fillStyle = WOOD_TABLE;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = WOOD_TABLE_DARK;
  for (let y = 6; y < size; y += 16) {
    ctx.globalAlpha = 0.12 + ((y * 5) % 20) / 100;
    ctx.beginPath();
    ctx.moveTo(0, y);
    for (let x = 0; x <= size; x += 40) {
      ctx.lineTo(x, y + Math.sin((x + y) * 0.04) * 5);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

function getWoodTexture() {
  if (!woodTexture) woodTexture = buildWoodTableTexture();
  return woodTexture;
}

/** Grande table en bois derrière tous les plateaux — demande explicite de l'utilisateur. Redimensionnée dynamiquement selon le nombre de sièges (voir updateScene). */
function createTableMesh() {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const texture = getWoodTexture();
  const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.92 });
  const mesh = new THREE.Mesh(geometry, material);
  return mesh;
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
 * l'échelle `scale` (désormais IDENTIQUE pour tout le monde — voir
 * BOARD_SCALE). `placeableIndexes` (miennes uniquement) éclaircit
 * l'encoche en doré (rebord + halo), même intention que le contraste
 * jouable/grisé des autres jeux.
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

  tableMesh = createTableMesh();
  tableMesh.position.set(0, TABLE_Y, TABLE_Z - (BOARD_THICKNESS / 2) * BOARD_SCALE - 0.05);
  scene.add(tableMesh);

  const tick = () => {
    requestAnimationFrame(tick);
    const t = performance.now() * 0.001;
    if (glowMaterial) glowMaterial.emissiveIntensity = 0.55 + 0.35 * Math.sin(t * 3);
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
 * Fait glisser la caméra horizontalement (translation pure, jamais de
 * rotation) d'une quantité exprimée en pixels écran — convertit en unités
 * monde à la profondeur de la table (même distance pour tous les plateaux
 * maintenant qu'ils partagent tous TABLE_Z). Bornée à `panMin`/`panMax`,
 * recalculés à chaque updateScene selon le nombre de sièges réels.
 */
export function panCameraByScreenDelta(pixelDeltaX) {
  if (!mounted) return;
  const w = parseFloat(canvas.style.width) || canvas.clientWidth || 1;
  const visibleHalfW = visibleHalfHeightAt(TABLE_Z) * camera.aspect;
  const worldPerPixel = (visibleHalfW * 2) / w;
  cameraPanX = Math.max(panMin, Math.min(panMax, cameraPanX - pixelDeltaX * worldPerPixel));
  camera.position.x = cameraPanX;
}

/** Recentre la caméra sur mon propre siège (voir myCurrentSeatX) — utile après un rendu complet. */
export function panCameraToMySeat() {
  if (!mounted) return;
  cameraPanX = Math.max(panMin, Math.min(panMax, myCurrentSeatX));
  camera.position.x = cameraPanX;
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

  const totalSeats = 1 + opponents.length;
  myCurrentSeatX = seatX(0, totalSeats);

  while (boardGroups.length > totalSeats) disposeBoardGroup(boardGroups.pop());
  while (boardGroups.length < totalSeats) {
    const group = createBoardGroup();
    scene.add(group.board);
    boardGroups.push(group);
  }

  layoutBoardGroup(boardGroups[0], myBoardTiles, { centerX: myCurrentSeatX, centerY: TABLE_Y, centerZ: TABLE_Z, scale: BOARD_SCALE, placeableIndexes });
  opponents.forEach((opp, i) => {
    layoutBoardGroup(boardGroups[i + 1], opp.board, { centerX: seatX(i + 1, totalSeats), centerY: TABLE_Y, centerZ: TABLE_Z, scale: BOARD_SCALE });
  });

  // Un peu de marge de part et d'autre du premier/dernier siège pour ne pas
  // stopper le glisser pile sur le bord du plateau extrême.
  panMin = seatX(0, totalSeats) - SEAT_SPACING * 0.6;
  panMax = seatX(totalSeats - 1, totalSeats) + SEAT_SPACING * 0.6;
  cameraPanX = Math.max(panMin, Math.min(panMax, cameraPanX));
  camera.position.x = cameraPanX;

  // Table en bois assez large pour couvrir tous les sièges + la marge de glisser.
  const tableWidth = SEAT_SPACING * totalSeats + BOARD_SIZE * BOARD_SCALE * 2;
  const tableHeight = BOARD_SIZE * BOARD_SCALE * 2.4;
  tableMesh.scale.set(tableWidth, tableHeight, 1);
  tableMesh.material.map.repeat.set(tableWidth / 2, tableHeight / 2);

  // Pioche/défausse "au milieu de la table" (X=0, fixe) — sous les plateaux
  // plutôt qu'à la même hauteur qu'eux, pour ne jamais chevaucher un siège
  // qui tomberait pile sur X=0 (cas d'un nombre impair de sièges).
  const pileY = TABLE_Y - BOARD_HALF - 0.35;
  const pileZ = TABLE_Z + 0.15;

  ensureDiscardMeshCount(discardTiles.length);
  discardTiles.forEach((tile, i) => {
    const mesh = discardMeshes[i];
    mesh.visible = true;
    setTokenValue(mesh, tile);
    const spread = (i - (discardTiles.length - 1) / 2) * (TOKEN_RADIUS * 2.1);
    mesh.position.set(0.55 + spread, pileY, pileZ);
  });

  ensureDrawPileMeshCount(stockCount > 0 ? 4 : 0);
  drawPileMeshes.forEach((mesh, i) => {
    mesh.position.set(-0.65, pileY + i * 0.02, pileZ - 0.05 + i * 0.01);
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
 * appel explicite, la projection utiliserait encore la position de caméra
 * du rendu précédent (bug direct constaté et corrigé côté Pouilleux/Uno) —
 * d'autant plus important maintenant que la caméra peut glisser : ces
 * fonctions doivent être rappelées à CHAQUE mouvement, pas juste au rendu
 * initial (voir la boucle de glisser dans src/ui/games/luckynumbers.js).
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
  const half = TOKEN_RADIUS * 1.15 * BOARD_SCALE;
  const x = myCurrentSeatX + dx * BOARD_SCALE;
  const y = TABLE_Y + dy * BOARD_SCALE;
  const z = TABLE_Z + (BOARD_THICKNESS / 2 + 0.02) * BOARD_SCALE;
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
