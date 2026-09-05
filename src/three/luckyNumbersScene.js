import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import boardPlateUrl from '../assets/games/luckynumbers/board-plate.png';
import tableWoodUrl from '../assets/games/luckynumbers/table-wood.jpg';
import discardPlateUrl from '../assets/games/luckynumbers/discard-plate.png';
import piocheUrl from '../assets/games/luckynumbers/pioche.png';
import tokensSheetUrl from '../assets/games/luckynumbers/tokens-sheet.png';

/**
 * Scène 3D persistante pour Lucky Numbers — une seule scène/caméra (comme
 * unoScene.js). Tableau centré sur UN plateau 4×4 (le joueur local par
 * défaut) avec pioche et assiette juste au-dessus ; les autres jardins sont
 * des miniatures en haut. Un clic sur une miniature l'agrandit à la place
 * du plateau principal ; un autre clic ramène à sa propre grille.
 * La CAMÉRA ne fait que TRANSLATER/zoomer (pinch, voir panCameraByScreenDelta/
 * zoomCameraByFactor) — jamais de rotation/inclinaison.
 *
 * Le plateau utilise une VRAIE photo (voir boardPlateUrl) comme texture —
 * demande explicite de l'utilisateur — avec un remplacement "blanc → vert"
 * au chargement (voir loadBoardPlateTexture) pour que le fond blanc de la
 * photo (hors de la forme octogonale du plateau) ne laisse pas de taches
 * blanches aux 4 coins de notre géométrie rectangulaire. Les encoches sont
 * déjà PEINTES dans cette photo — plus d'anneau/puits 3D dessinés par-dessus
 * (demande explicite : "sans dessiner toi même les trous") ; seul le halo
 * de surbrillance (voir createGlowMesh) reste une vraie géométrie, calée au
 * centre EXACT de chaque trou peint (voir CELL_OFFSETS, calibré par trou sur
 * la photo entière — voir loadBoardPlateTexture).
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

// Image source du plateau : PHOTO ENTIÈRE, non recadrée (voir
// loadBoardPlateTexture) — un recadrage serré coupait dans une ombre peinte
// près du bord de la photo, ce qui laissait un liseré noir dur autour de
// chaque plateau une fois affiché, sans qu'un simple fondu ne le corrige
// vraiment sans risquer de recasser le calage des trous. Repartir de l'image
// complète (1408×1408) élimine le problème à la racine. Le plateau (mesh)
// est donc CARRÉ, comme la photo, pour ne pas la déformer.
const BOARD_IMAGE_SIZE = 1408;
const BOARD_WIDTH = 5.9691;
const BOARD_HEIGHT = 5.9691;
const PIXELS_TO_WORLD = BOARD_HEIGHT / BOARD_IMAGE_SIZE;

// Position de chacun des 16 trous, en unités locales du plateau (avant mise
// à l'échelle) — calée PAR TROU (pas une grille régulière) sur les
// coordonnées pixel natives fournies par l'utilisateur, puis calibrées
// interactivement (page de test avec un jeton réel affiché dans chaque
// trou, ajustements successifs jusqu'à validation visuelle). row 0 = haut,
// col 0 = gauche, index = row*4+col (voir cellLocalOffset).
const CELL_OFFSETS = [
  { dx: -1.50076, dy: 1.80176 },
  { dx: -0.50449, dy: 1.81023 },
  { dx: 0.50025, dy: 1.81023 },
  { dx: 1.49652, dy: 1.81023 },
  { dx: -1.49228, dy: 0.90300 },
  { dx: -0.47482, dy: 0.90724 },
  { dx: 0.50025, dy: 0.90300 },
  { dx: 1.50929, dy: 0.90724 },
  { dx: -1.49228, dy: -0.01696 },
  { dx: -0.48753, dy: -0.01272 },
  { dx: 0.52145, dy: -0.01271 },
  { dx: 1.50929, dy: -0.01696 },
  { dx: -1.49652, dy: -0.95387 },
  { dx: -0.48753, dy: -0.95387 },
  { dx: 0.51297, dy: -0.94963 },
  { dx: 1.50924, dy: -0.94963 }
];

// Rayon du jeton (et du halo de surbrillance) dérivé du même calibrage
// pixel — un jeton de 82px natifs "à l'œil" dans chaque trou, converti dans
// l'échelle du plateau ci-dessus. Le halo garde le même ratio qu'avant
// (0.42/0.432) par rapport au jeton.
const TOKEN_RADIUS = 82 * PIXELS_TO_WORLD;
const NOTCH_RADIUS = TOKEN_RADIUS * (0.42 / 0.432);
// Réduite (0.14 → 0.05) — pas un problème de texture (la photo a bien un
// vrai fond alpha transparent) mais la tranche latérale de ce volume 3D
// (moins éclairée que la face avant sous la lumière directionnelle) qui
// apparaît comme un fin liseré sombre tout autour de chaque plateau, plus
// visible depuis les derniers réglages. Une tranche plus fine réduit ce
// liseré sans supprimer complètement le relief 3D du plateau.
const BOARD_THICKNESS = 0.05;

const CAMERA_DISTANCE = 8.5;
const CAMERA_FOV = 45;
// Bornes du pinch-to-zoom (voir zoomCameraByFactor) — distance caméra réelle,
// pas un facteur d'échelle : plus PETIT = plus proche/zoomé. Max relevé
// (11.5 → 20, demande explicite : "dézoomer davantage pour voir les
// plateaux de tous les joueurs") — voir aussi le brouillard (scene.fog,
// plus bas) repoussé en conséquence pour ne pas estomper les plateaux
// adverses au dézoom maximal.
const ZOOM_MIN_DISTANCE = 5.2;
const ZOOM_MAX_DISTANCE = 20;

const TABLE_Z = 1.6;
const BOARD_SCALE = 0.47;
const MINI_BOARD_SCALE = BOARD_SCALE * 0.34;
const BOARD_HALF_X = (BOARD_WIDTH / 2) * BOARD_SCALE;
const BOARD_HALF_Y = (BOARD_HEIGHT / 2) * BOARD_SCALE;
const MINI_HALF_X = (BOARD_WIDTH / 2) * MINI_BOARD_SCALE;
const MINI_HALF_Y = (BOARD_HEIGHT / 2) * MINI_BOARD_SCALE;

/**
 * Le FOV d'une PerspectiveCamera est TOUJOURS vertical (indépendant de
 * l'aspect ratio) — un plateau placé à un centerY fixe peut sortir du
 * frustum même si le conteneur CSS a de la place, car le clipping se
 * fait en espace caméra 3D, pas en layout CSS (bug déjà rencontré et
 * corrigé sur la main du Uno via maxHandCenterY, même cause ici).
 *
 * `distance` par défaut = CAMERA_DISTANCE (position de départ, utilisée pour
 * les constantes de layout calculées au chargement du module — MY_ROW_Y ci-
 * dessous, avant même que `camera` existe) ; les appels EN COURS DE PARTIE
 * (pan, redimensionnement de la table) passent `camera.position.z` pour
 * rester corrects une fois le pinch-to-zoom appliqué (voir zoomCameraByFactor).
 */
function visibleHalfHeightAt(z, distance = CAMERA_DISTANCE) {
  const halfVFov = (CAMERA_FOV * Math.PI) / 360;
  return (distance - z) * Math.tan(halfVFov);
}

// Mon plateau est PLAQUÉ près du bas du champ visible (petite marge de
// sécurité 3%) plutôt que centré symétriquement avec les adversaires — à
// cette taille de plateau (BOARD_SCALE inchangé), le centrer avec un écart
// symétrique ne laisserait presque plus de place pour la rangée adverse de
// toute façon, et seul MON plateau + la pioche doivent tenir dans l'écran
// (demande explicite). Les adversaires, plus haut, peuvent dépasser le haut
// du champ — ils restent accessibles en glissant la caméra horizontalement,
// leur visibilité verticale complète n'est pas requise.
const MY_ROW_Y = -(visibleHalfHeightAt(TABLE_Z) * 0.97 - BOARD_HALF_Y);
const PILE_Y = MY_ROW_Y + BOARD_HALF_Y + 0.48;
const MINI_ROW_Y = MY_ROW_Y + BOARD_HALF_Y + 1.95;
const PLATE_CENTER_X = 0.62;
const PIOCHE_X = -0.72;
const PLATE_DIAMETER = 1.12;
const PIOCHE_DIAMETER = 0.82;

// Thème "jardin en trèfle" (référence de l'utilisateur) — plateau texturé
// (vraie photo, voir boardPlateUrl) + jetons = vrais palets en bois
// photographiés (voir tokensSheetUrl), un par valeur 1-20.
const SCENE_BG = '#0f1f0f';
const BOARD_GREEN = '#3a8a42';
const GOLD = '#ffd700';
const GOLD_EMISSIVE = '#ffaa00';
const CENTER_CREAM = '#fffaf0';

let canvas = null;
let renderer = null;
let scene = null;
let camera = null;
let mounted = false;

let boardGroups = []; // [0] = moi, [1..] = adversaires dans l'ordre des sièges déjà calculé par l'appelant
let discardMeshes = [];
let tableMesh = null;
let plateMesh = null;
let focusedSeat = 0;
let lastSceneArgs = null;
let piocheMesh = null;
let drawnTileMesh = null;

const flights = [];
const hideUntil = new Set();
let hasSnapshot = false;
let drawnDragHidden = false;
let playerDropPending = false;
let previousMyBoardTiles = [];
let previousOpponentBoards = [];
let previousDiscardIds = [];
let previousDrawnTile = null;

let myCurrentSeatX = 0; // recalculé à chaque updateScene selon le nombre de sièges — voir getMyBoardCellRect

let cameraPanX = 0;
let panMin = 0;
let panMax = 0;
let cameraPanY = 0;
let panMinY = 0;
let panMaxY = 0;

const tokenFaceTextures = new Map(); // value (1-20) -> THREE.Texture (recadrée depuis tokensSheetUrl)
let glowGeometry = null;
let glowMaterial = null;
let tokenDiscGeometry = null;
let woodTexture = null;
let boardPlateTexture = null;
let boardPlateLoadPromise = null;
let discardPlateTexture = null;
let discardPlateLoadPromise = null;
let piocheTexture = null;
let piocheLoadPromise = null;
let tokensSheetImage = null;
let tokensSheetLoadPromise = null;

/**
 * Charge la photo du plateau (voir boardPlateUrl, demande explicite) — un
 * PNG à fond RÉELLEMENT transparent. Image COMPLÈTE, aucun recadrage (voir
 * BOARD_IMAGE_SIZE/CELL_OFFSETS plus haut) : un recadrage serré coupait dans
 * une ombre peinte près du bord de la photo, donnant un liseré noir dur
 * autour du plateau une fois affiché — repartir de l'image entière évite le
 * problème à la racine plutôt que de le masquer par un fondu.
 */
function loadBoardPlateTexture() {
  if (boardPlateTexture) return Promise.resolve(boardPlateTexture);
  if (boardPlateLoadPromise) return boardPlateLoadPromise;
  boardPlateLoadPromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = BOARD_IMAGE_SIZE;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      ctx.drawImage(img, 0, 0, size, size);
      const texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      // Pas de mipmaps sur cette texture à découpe alpha (RGB=0 sous les
      // pixels transparents) : à cette échelle réduite (BOARD_SCALE=0.47),
      // le GPU génère des mipmaps qui mélangent ces texels noirs avec le
      // bord opaque voisin, créant un liseré noir visible tout autour du
      // plateau (bug constaté : "liseré noir autour de chaque plateau").
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      boardPlateTexture = texture;
      resolve(texture);
    };
    img.src = boardPlateUrl;
  });
  return boardPlateLoadPromise;
}

/**
 * Assiette (voir discardPlateUrl, fournie par l'utilisateur) posée entre les
 * deux rangées pour accueillir les jetons de défausse — demande explicite.
 * Contrairement au plateau (fond blanc remplacé par du vert plein), ici on
 * garde une vraie TRANSPARENCE (alpha) : l'assiette est ronde sur un fond
 * carré, on veut voir la table en bois autour, pas une couleur de secours.
 */
function loadDiscardPlateTexture() {
  if (discardPlateTexture) return Promise.resolve(discardPlateTexture);
  if (discardPlateLoadPromise) return discardPlateLoadPromise;
  discardPlateLoadPromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 512;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      // La photo fournie a une grosse marge transparente autour de
      // l'assiette (le disque opaque ne remplit qu'environ la moitié du
      // carré) — mesuré une fois par analyse de pixels (bbox alpha>20 ≈
      // 20%..71% en X, 23%..74% en Y). Sans ce recadrage, `plateDiameter`
      // dans updateScene ne correspondrait qu'à la moitié de l'assiette
      // réellement visible, faisant déborder les jetons largement hors de
      // l'assiette (bug constaté : "les jetons débordent tout autour").
      const cropFrac = 0.59;
      const sx = img.width * (0.501 - cropFrac / 2);
      const sy = img.height * (0.487 - cropFrac / 2);
      const sw = img.width * cropFrac;
      const sh = img.height * cropFrac;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
      const imageData = ctx.getImageData(0, 0, size, size);
      const px = imageData.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 240 && px[i + 1] > 240 && px[i + 2] > 240) {
          px[i + 3] = 0;
        }
      }
      ctx.putImageData(imageData, 0, 0);
      const texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      discardPlateTexture = texture;
      resolve(texture);
    };
    img.src = discardPlateUrl;
  });
  return discardPlateLoadPromise;
}

/**
 * Illustration de la pioche (sac en tissu vert avec breloque trèfle, voir
 * piocheUrl, demande explicite) — vrai fond alpha transparent (comme
 * board-plate.png), recadrée sur son contenu réel (bbox alpha mesurée une
 * fois par analyse de pixels) plutôt que le carré source qui a une grosse
 * marge transparente inutile autour du sac.
 */
function loadPiocheTexture() {
  if (piocheTexture) return Promise.resolve(piocheTexture);
  if (piocheLoadPromise) return piocheLoadPromise;
  piocheLoadPromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const size = 512;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const ctx = c.getContext('2d');
      const sx = 88;
      const sy = 72;
      const sw = 1244;
      const sh = 1244;
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, size, size);
      const texture = new THREE.CanvasTexture(c);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.generateMipmaps = false;
      texture.minFilter = THREE.LinearFilter;
      piocheTexture = texture;
      resolve(texture);
    };
    img.src = piocheUrl;
  });
  return piocheLoadPromise;
}

/**
 * Charge la planche-contact des 20 jetons (voir tokensSheetUrl, fournie par
 * l'utilisateur) — vraie photo de palets en bois numérotés 1-20, grille
 * 5 colonnes × 4 rangées (valeur = rangée×5 + colonne + 1), fond déjà
 * RÉELLEMENT transparent. Centres/rayons mesurés une fois par analyse de
 * pixels (bbox alpha>20 par bande de projection ligne/colonne).
 */
const TOKEN_SHEET_COL_X = [158, 431, 704, 976, 1248];
const TOKEN_SHEET_ROW_Y = [244, 534, 827, 1121];
const TOKEN_SHEET_CROP_HALF = 125;

function loadTokensSheetImage() {
  if (tokensSheetImage) return Promise.resolve(tokensSheetImage);
  if (tokensSheetLoadPromise) return tokensSheetLoadPromise;
  tokensSheetLoadPromise = new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      tokensSheetImage = img;
      resolve(img);
    };
    img.src = tokensSheetUrl;
  });
  return tokensSheetLoadPromise;
}

function buildTokenFaceTexture(value) {
  const col = (value - 1) % 5;
  const row = Math.floor((value - 1) / 5);
  const cx = TOKEN_SHEET_COL_X[col];
  const cy = TOKEN_SHEET_ROW_Y[row];
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  ctx.drawImage(
    tokensSheetImage,
    cx - TOKEN_SHEET_CROP_HALF, cy - TOKEN_SHEET_CROP_HALF,
    TOKEN_SHEET_CROP_HALF * 2, TOKEN_SHEET_CROP_HALF * 2,
    0, 0, size, size
  );
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

/** Résout immédiatement si déjà en cache, sinon attend le chargement de la planche-contact (une seule fois). */
function getTokenFaceTexture(value) {
  const cached = tokenFaceTextures.get(value);
  if (cached) return Promise.resolve(cached);
  return loadTokensSheetImage().then(() => {
    let texture = tokenFaceTextures.get(value);
    if (!texture) {
      texture = buildTokenFaceTexture(value);
      tokenFaceTextures.set(value, texture);
    }
    return texture;
  });
}

function getTokenDiscGeometry() {
  if (!tokenDiscGeometry) {
    tokenDiscGeometry = new THREE.CircleGeometry(TOKEN_RADIUS, 32);
    tokenDiscGeometry.userData.shared = true;
  }
  return tokenDiscGeometry;
}

/**
 * Jeton = simple disque texturé avec le vrai palet en bois photographié
 * (couleur + nombre déjà dans la photo, voir tokensSheetUrl) — remplace
 * l'ancien trèfle à 4 pétales généré par code, suite à la fourniture de
 * cette photo par l'utilisateur ("découpe cette image en 20 jetons").
 */
function createTokenMesh() {
  const material = new THREE.MeshStandardMaterial({ color: CENTER_CREAM, roughness: 0.55, transparent: true });
  return new THREE.Mesh(getTokenDiscGeometry(), material);
}

function applyTokenTexture(mesh, texture) {
  mesh.material.map = texture;
  mesh.material.color.set(0xffffff);
  mesh.material.needsUpdate = true;
}

function setTokenValue(mesh, tile) {
  const cached = tokenFaceTextures.get(tile.value);
  if (cached) {
    applyTokenTexture(mesh, cached);
    return;
  }
  getTokenFaceTexture(tile.value).then((texture) => applyTokenTexture(mesh, texture));
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

/**
 * Matériau du plateau : vert uni au départ, remplacé par la vraie photo dès
 * qu'elle est chargée (async, voir loadBoardPlateTexture). `alphaTest` (seuil
 * bas, 0.02) plutôt que `transparent` : la texture n'a que 2 valeurs d'alpha
 * utiles (0 dans les grandes marges transparentes de l'image complète, 255
 * sur l'octogone) — `alphaTest` donne une vraie découpe sans les soucis de
 * tri/profondeur des matériaux `transparent` (déjà rencontrés ailleurs dans
 * cette scène). Seuil réduit (0.5 → 0.02) par rapport à un essai précédent :
 * un seuil élevé incluait des pixels d'anti-aliasing du bord à pleine
 * opacité, créant un liseré sombre dur autour du plateau.
 */
function createBoardMesh() {
  const radius = Math.min(BOARD_THICKNESS / 2, Math.min(BOARD_WIDTH, BOARD_HEIGHT) * 0.02);
  const geometry = new RoundedBoxGeometry(BOARD_WIDTH, BOARD_HEIGHT, BOARD_THICKNESS, 3, radius);
  const material = new THREE.MeshStandardMaterial({ color: BOARD_GREEN, roughness: 0.85, alphaTest: 0.02 });
  const mesh = new THREE.Mesh(geometry, material);
  loadBoardPlateTexture().then((texture) => {
    material.map = texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  });
  return mesh;
}

function loadWoodTexture() {
  if (woodTexture) return Promise.resolve(woodTexture);
  return new THREE.TextureLoader().loadAsync(tableWoodUrl).then((texture) => {
    texture.colorSpace = THREE.SRGBColorSpace;
    woodTexture = texture;
    return texture;
  });
}

function createTableMesh() {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.92 });
  const mesh = new THREE.Mesh(geometry, material);
  loadWoodTexture().then((texture) => {
    material.map = texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  });
  return mesh;
}

/** Assiette pour la défausse, entre les 2 rangées (voir loadDiscardPlateTexture). */
function createPlateMesh() {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.6, alphaTest: 0.5 });
  const mesh = new THREE.Mesh(geometry, material);
  loadDiscardPlateTexture().then((texture) => {
    material.map = texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  });
  return mesh;
}

/** Sac de pioche (voir loadPiocheTexture, demande explicite) — remplace l'ancienne pile de jetons face cachée. */
function createPiocheMesh() {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x6a9a5a, roughness: 0.7, alphaTest: 0.5 });
  const mesh = new THREE.Mesh(geometry, material);
  loadPiocheTexture().then((texture) => {
    material.map = texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
  });
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

/**
 * Décalage local (avant mise à l'échelle) d'une case dans la grille 4×4,
 * relatif au CENTRE du plateau — simple lookup dans CELL_OFFSETS (voir plus
 * haut), calé PAR TROU sur la photo entière plutôt qu'une grille régulière.
 */
function cellLocalOffset(index) {
  return CELL_OFFSETS[index];
}

function createBoardGroup() {
  return {
    board: createBoardMesh(),
    glowMeshes: Array(GRID_SIZE).fill(null),
    tokenMeshes: Array(GRID_SIZE).fill(null)
  };
}

function disposeBoardGroup(group) {
  disposeMesh(group.board);
  group.glowMeshes.forEach(disposeMesh);
  group.tokenMeshes.forEach(disposeMesh);
}

/**
 * Fait tourner (dx,dy) de `angle` radians — conserve le calage CELL_OFFSETS
 * si un plateau est orienté autrement que 0.
 */
function rotateOffset(dx, dy, angle) {
  if (!angle) return { dx, dy };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { dx: dx * cos - dy * sin, dy: dx * sin + dy * cos };
}

/**
 * Place/actualise un plateau complet à (centerX, centerY, centerZ), mis à
 * l'échelle `scale` (désormais IDENTIQUE pour tout le monde — voir
 * BOARD_SCALE) et tourné de `rotation` radians autour de Z (0 pour moi,
 * variable pour les adversaires — voir seatAngle/opponentPosition : table
 * ronde, chacun voit son propre plateau "à l'endroit" depuis SA place, donc
 * tourné depuis la mienne — demande explicite : "à 4 le plateau d'en face
 * est inversé"). Les "encoches" sont déjà peintes dans la photo du plateau
 * (voir loadBoardPlateTexture) — plus d'anneau/puits 3D dessinés par-dessus
 * (demande explicite : "sans dessiner toi même les trous"), seuls les
 * jetons et le halo de surbrillance sont de vraie géométrie, positionnés au
 * centre EXACT de chaque trou peint (voir cellLocalOffset/CELL_OFFSETS),
 * tourné avec le plateau.
 */
function layoutBoardGroup(group, board, { centerX, centerY, centerZ, scale, rotation = 0, placeableIndexes = [] }) {
  group.board.position.set(centerX, centerY, centerZ);
  group.board.scale.setScalar(scale);
  group.board.rotation.z = rotation;
  const surfaceZ = centerZ + (BOARD_THICKNESS / 2) * scale;
  // Retenu pour getBoardLabelRects() (bulle de nom sous chaque plateau) —
  // la bulle elle-même ne tourne JAMAIS (demande explicite : "l'étiquette du
  // nom reste droite"), seule sa POSITION suit la rotation du plateau pour
  // rester du côté extérieur (loin de la pioche), voir plus bas.
  group.centerX = centerX;
  group.centerY = centerY;
  group.labelScale = scale;
  group.rotation = rotation;

  for (let i = 0; i < GRID_SIZE; i++) {
    const local = cellLocalOffset(i);
    const { dx, dy } = rotateOffset(local.dx, local.dy, rotation);
    const x = centerX + dx * scale;
    const y = centerY + dy * scale;
    const highlighted = placeableIndexes.includes(i);

    if (!group.glowMeshes[i]) {
      const glow = createGlowMesh();
      glow.renderOrder = 3;
      scene.add(glow);
      group.glowMeshes[i] = glow;
    }
    const glow = group.glowMeshes[i];
    // Décalage plus généreux qu'avant (0.004 → 0.01) : avec l'anneau/puits
    // retirés, ce halo n'a plus de "coussin" de mesh intermédiaire pour
    // éviter un z-fighting avec la face du plateau à cette échelle réduite
    // (BOARD_SCALE=0.5) — bug constaté : halo invisible malgré `visible=true`.
    glow.position.set(x, y, surfaceZ + 0.01 * scale);
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
      token.visible = !hideUntil.has(token.uuid);
      if (!isFlying(token)) {
        token.position.set(x, y, surfaceZ + 0.02 * scale);
        token.scale.setScalar(scale);
        token.rotation.z = rotation;
      }
      setTokenValue(token, tile);
    } else if (group.tokenMeshes[i]) {
      group.tokenMeshes[i].visible = false;
    }
  }
}

function easeSmooth(t) {
  return t * t * (3 - 2 * t);
}

function isFlying(mesh) {
  return Boolean(mesh && flights.some((f) => f.mesh === mesh));
}

function capturePos(mesh) {
  return mesh ? mesh.position.clone() : null;
}

function discardWorldPos(index, count) {
  const DISCARD_GRID_COLS = 4;
  const DISCARD_SPACING = 0.18;
  const plateCenterX = PLATE_CENTER_X;
  const n = Math.max(1, count);
  const discardRows = Math.max(1, Math.ceil(n / DISCARD_GRID_COLS));
  const row = Math.floor(Math.max(0, index) / DISCARD_GRID_COLS);
  const col = Math.max(0, index) % DISCARD_GRID_COLS;
  const colsInRow = Math.min(DISCARD_GRID_COLS, n - row * DISCARD_GRID_COLS);
  return new THREE.Vector3(
    plateCenterX + (col - (colsInRow - 1) / 2) * DISCARD_SPACING,
    PILE_Y + ((discardRows - 1) / 2 - row) * DISCARD_SPACING,
    TABLE_Z + 0.15
  );
}

function startFlight(mesh, to, { duration = 880, lift = 0.55, onDone } = {}) {
  if (!mesh || !to) return;
  flights.push({
    mesh,
    from: mesh.position.clone(),
    to: to.clone(),
    start: performance.now(),
    duration,
    lift,
    onDone
  });
}

function advanceFlights(now) {
  for (let i = flights.length - 1; i >= 0; i--) {
    const f = flights[i];
    const t = Math.min(1, (now - f.start) / f.duration);
    const k = easeSmooth(t);
    f.mesh.position.lerpVectors(f.from, f.to, k);
    f.mesh.position.z += Math.sin(t * Math.PI) * f.lift;
    if (t >= 1) {
      f.mesh.position.copy(f.to);
      flights.splice(i, 1);
      f.onDone?.();
    }
  }
}

function makeFlyer(tile, fromPos) {
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthTest: true });
  const flyer = new THREE.Mesh(getTokenDiscGeometry(), material);
  flyer.scale.setScalar(BOARD_SCALE);
  flyer.position.copy(fromPos);
  flyer.position.z += 0.08;
  flyer.renderOrder = 30;
  flyer.visible = true;
  scene.add(flyer);
  if (tile) setTokenValue(flyer, tile);
  return flyer;
}

function releaseFlyer(flyer) {
  if (!flyer) return;
  scene.remove(flyer);
  if (flyer.material && !flyer.material.userData.shared) flyer.material.dispose();
}

function flyIncoming(destMesh, fromPos, tile) {
  if (!destMesh || !fromPos || !tile) return;
  hideUntil.add(destMesh.uuid);
  destMesh.visible = false;
  const flyer = makeFlyer(tile, fromPos);
  const to = destMesh.position.clone();
  to.z += 0.04;
  startFlight(flyer, to, {
    onDone: () => {
      releaseFlyer(flyer);
      hideUntil.delete(destMesh.uuid);
      destMesh.visible = true;
    }
  });
}

function flyToDiscard(tile, fromPos, pile) {
  if (!tile || !fromPos || !scene) return;
  const idx = pile.findIndex((t) => t.id === tile.id);
  const destIndex = idx >= 0 ? idx : Math.max(0, pile.length - 1);
  const destMesh = discardMeshes[destIndex];
  const to = destMesh ? destMesh.position.clone() : discardWorldPos(destIndex, pile.length);
  to.z += 0.04;
  if (destMesh) {
    hideUntil.add(destMesh.uuid);
    destMesh.visible = false;
  }
  const flyer = makeFlyer(tile, fromPos);
  startFlight(flyer, to, {
    onDone: () => {
      releaseFlyer(flyer);
      if (destMesh) {
        hideUntil.delete(destMesh.uuid);
        destMesh.visible = true;
      }
    }
  });
}

function sourcePosFor(tile, prevDrawn, prevDiscardIds, drawnPos, discardPositions, piochePos) {
  if (prevDrawn && tile && prevDrawn.id === tile.id) return drawnPos;
  if (tile?.id) {
    const di = prevDiscardIds.indexOf(tile.id);
    if (di >= 0 && discardPositions[di]) return discardPositions[di];
  }
  return piochePos;
}

export function hideDrawnToken(hide) {
  drawnDragHidden = Boolean(hide);
  if (drawnTileMesh && !isFlying(drawnTileMesh)) {
    drawnTileMesh.visible = Boolean(drawnTileMesh.userData.hasTile) && !drawnDragHidden;
  }
}

/** Le joueur vient de glisser un jeton : ne pas rejouer le trajet depuis l'origine. */
export function notePlayerTokenDrop() {
  playerDropPending = true;
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
  // Repoussé (11.5/20 → 28/48) avec ZOOM_MAX_DISTANCE : au dézoom maximal
  // (distance caméra 20, donc ~18.4 des plateaux), l'ancien brouillard
  // aurait commencé à estomper les plateaux adverses juste au moment où on
  // veut justement les voir clairement.
  scene.fog = new THREE.Fog(SCENE_BG, 28, 48);

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
  tableMesh.position.z = TABLE_Z - (BOARD_THICKNESS / 2) * BOARD_SCALE - 0.05;
  scene.add(tableMesh);

  plateMesh = createPlateMesh();
  scene.add(plateMesh);

  piocheMesh = createPiocheMesh();
  scene.add(piocheMesh);

  // Jeton piochée en attente de pose — invisible tant qu'aucune tuile n'est
  // piochée (bug constaté : "le jeton pris lorsque l'on pioche n'est pas
  // visible"), posé à côté du sac une fois piochée (voir updateScene).
  drawnTileMesh = createTokenMesh();
  drawnTileMesh.visible = false;
  drawnTileMesh.renderOrder = 4;
  scene.add(drawnTileMesh);

  const tick = () => {
    requestAnimationFrame(tick);
    const now = performance.now();
    const t = now * 0.001;
    if (glowMaterial) glowMaterial.emissiveIntensity = 0.55 + 0.35 * Math.sin(t * 3);
    advanceFlights(now);
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

export function resetBoardSnapshot() {
  hasSnapshot = false;
  focusedSeat = 0;
  lastSceneArgs = null;
  drawnDragHidden = false;
  playerDropPending = false;
  previousMyBoardTiles = [];
  previousOpponentBoards = [];
  previousDiscardIds = [];
  previousDrawnTile = null;
  hideUntil.clear();
  for (let i = flights.length - 1; i >= 0; i--) {
    const mesh = flights[i].mesh;
    flights.splice(i, 1);
    if (mesh && mesh !== drawnTileMesh) releaseFlyer(mesh);
  }
}

/**
 * Fait glisser la caméra horizontalement ET verticalement (translation pure,
 * jamais de rotation — la caméra garde exactement la même orientation que
 * `camera.lookAt(0,0,0)` au montage, seule sa position bouge) d'une quantité
 * exprimée en pixels écran — convertit en unités monde à la profondeur de la
 * table (même distance pour tous les plateaux maintenant qu'ils partagent
 * tous TABLE_Z). Bornée à panMin/panMax (X) et panMinY/panMaxY (Y),
 * recalculés à chaque updateScene — demande explicite : pouvoir se déplacer
 * de haut en bas ET de gauche à droite pour voir tous les plateaux (avant,
 * seul le glissement horizontal existait, les adversaires — au-dessus —
 * n'étaient pas atteignables verticalement).
 */
export function panCameraByScreenDelta(pixelDeltaX, pixelDeltaY = 0) {
  if (!mounted) return;
  const w = parseFloat(canvas.style.width) || canvas.clientWidth || 1;
  const h = parseFloat(canvas.style.height) || canvas.clientHeight || 1;
  const visibleHalfW = visibleHalfHeightAt(TABLE_Z, camera.position.z) * camera.aspect;
  const visibleHalfH = visibleHalfHeightAt(TABLE_Z, camera.position.z);
  const worldPerPixelX = (visibleHalfW * 2) / w;
  const worldPerPixelY = (visibleHalfH * 2) / h;
  cameraPanX = Math.max(panMin, Math.min(panMax, cameraPanX - pixelDeltaX * worldPerPixelX));
  cameraPanY = Math.max(panMinY, Math.min(panMaxY, cameraPanY + pixelDeltaY * worldPerPixelY));
  camera.position.x = cameraPanX;
  camera.position.y = cameraPanY;
}

/**
 * Table en bois assez large/haute pour couvrir tout le champ visible à
 * n'importe quelle position de glisser (horizontal ET vertical) ET n'importe
 * quel niveau de zoom (voir zoomCameraByFactor) — pas seulement la taille des
 * 2 rangées, pour ne jamais laisser voir le fond sombre de la scène ("il faut
 * retirer le fond déjà présent"). Extrait en fonction (au lieu d'un bloc
 * inline dans updateScene) pour pouvoir la ré-appeler après un pinch-zoom,
 * sans attendre le prochain changement d'état de partie.
 */
function resizeTableMesh() {
  if (!tableMesh || !camera) return;
  const visibleHalfH = visibleHalfHeightAt(TABLE_Z, camera.position.z);
  const tableWidth = panMax - panMin + visibleHalfH * camera.aspect * 2.6;
  const tableHeight = panMaxY - panMinY + visibleHalfH * 2.6;
  tableMesh.position.x = (panMin + panMax) / 2;
  tableMesh.position.y = (panMinY + panMaxY) / 2;
  tableMesh.scale.set(Math.max(8, tableWidth), Math.max(8, tableHeight), 1);
}

/**
 * Pinch-to-zoom (demande explicite) — rapproche/éloigne la caméra le long de
 * Z plutôt que de changer le FOV (garde les proportions des plateaux
 * cohérentes, pas d'effet "fisheye"). `factor` = ratio de la distance entre
 * les 2 doigts (nouvelle/ancienne) : >1 = doigts qui s'écartent = zoom avant
 * = caméra plus PROCHE, donc on DIVISE la distance par ce facteur. Bornée à
 * [ZOOM_MIN_DISTANCE, ZOOM_MAX_DISTANCE]. Re-résout aussitôt la taille de la
 * table (voir resizeTableMesh) pour qu'un zoom arrière ne laisse jamais voir
 * le fond sombre de la scène.
 */
export function zoomCameraByFactor(factor) {
  if (!mounted || !Number.isFinite(factor) || factor <= 0) return;
  camera.position.z = Math.max(ZOOM_MIN_DISTANCE, Math.min(ZOOM_MAX_DISTANCE, camera.position.z / factor));
  resizeTableMesh();
}

/** Recentre la caméra sur le tableau (mon plateau + pioche). */
export function panCameraToMySeat() {
  if (!mounted) return;
  cameraPanX = 0;
  cameraPanY = (MY_ROW_Y + PILE_Y) * 0.5;
  cameraPanX = Math.max(panMin, Math.min(panMax, cameraPanX));
  cameraPanY = Math.max(panMinY, Math.min(panMaxY, cameraPanY));
  camera.position.x = cameraPanX;
  camera.position.y = cameraPanY;
}

function layoutTableau(boards, placeableIndexes) {
  const n = boardGroups.length;
  if (!n) return;
  focusedSeat = Math.max(0, Math.min(n - 1, focusedSeat));
  const others = [];
  for (let i = 0; i < n; i++) if (i !== focusedSeat) others.push(i);
  const spacing = Math.max(MINI_HALF_X * 2.2, 0.95);
  const span = spacing * Math.max(0, others.length - 1);
  others.forEach((si, k) => {
    const x = others.length <= 1 ? 0 : -span / 2 + k * spacing;
    layoutBoardGroup(boardGroups[si], boards[si] || [], {
      centerX: x,
      centerY: MINI_ROW_Y,
      centerZ: TABLE_Z,
      scale: MINI_BOARD_SCALE,
      rotation: 0,
      placeableIndexes: []
    });
  });
  layoutBoardGroup(boardGroups[focusedSeat], boards[focusedSeat] || [], {
    centerX: 0,
    centerY: MY_ROW_Y,
    centerZ: TABLE_Z,
    scale: BOARD_SCALE,
    rotation: 0,
    placeableIndexes: focusedSeat === 0 ? placeableIndexes : []
  });
}

export function setFocusedSeat(index) {
  const next = Math.max(0, Math.floor(Number(index) || 0));
  if (next === focusedSeat) return focusedSeat;
  focusedSeat = next;
  if (mounted && lastSceneArgs) {
    const keep = hasSnapshot;
    hasSnapshot = false;
    updateScene(lastSceneArgs);
    hasSnapshot = keep;
  }
  return focusedSeat;
}

export function getFocusedSeat() {
  return focusedSeat;
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
 * - `drawnTile` : `{value,color}|null` — la tuile piochée en attente de pose
 *   (posée à mi-chemin entre le sac et l'assiette, voir plus bas), `null` si
 *   aucune tuile piochée.
 */
export function updateScene({ myBoardTiles = [], placeableIndexes = [], opponents = [], discardTiles = [], stockCount = 0, drawnTile = null }) {
  if (!mounted) return;
  lastSceneArgs = { myBoardTiles, placeableIndexes, opponents, discardTiles, stockCount, drawnTile };

  const animate = hasSnapshot;
  const prevMy = previousMyBoardTiles;
  const prevOpp = previousOpponentBoards;
  const prevDiscardIds = previousDiscardIds;
  const prevDrawn = previousDrawnTile;
  const myStartPos = (boardGroups[0]?.tokenMeshes || []).map(capturePos);
  const oppStartPos = boardGroups.slice(1).map((g) => (g.tokenMeshes || []).map(capturePos));
  const drawnStartPos = capturePos(drawnTileMesh);
  const discardStartPos = discardMeshes.map(capturePos);
  const piocheStartPos = capturePos(piocheMesh);

  myCurrentSeatX = 0;
  const totalSeats = 1 + opponents.length;
  const boards = [myBoardTiles, ...opponents.map((o) => o.board || [])];

  while (boardGroups.length > totalSeats) disposeBoardGroup(boardGroups.pop());
  while (boardGroups.length < totalSeats) {
    const group = createBoardGroup();
    scene.add(group.board);
    boardGroups.push(group);
  }

  layoutTableau(boards, placeableIndexes);

  const pileY = PILE_Y;
  const pileZ = TABLE_Z + 0.15;

  const miniCount = Math.max(0, totalSeats - 1);
  const miniSpan = Math.max(MINI_HALF_X * 2.2, 0.95) * Math.max(0, miniCount - 1);
  panMin = -Math.max(BOARD_HALF_X * 1.15, miniSpan / 2 + MINI_HALF_X * 1.25);
  panMax = -panMin;
  panMinY = MY_ROW_Y - BOARD_HALF_Y * 0.55;
  panMaxY = MINI_ROW_Y + MINI_HALF_Y * 0.85;
  cameraPanX = Math.max(panMin, Math.min(panMax, cameraPanX));
  camera.position.x = cameraPanX;
  if (cameraPanY === 0) cameraPanY = (MY_ROW_Y + PILE_Y) * 0.5;
  cameraPanY = Math.max(panMinY, Math.min(panMaxY, cameraPanY));
  camera.position.y = cameraPanY;
  resizeTableMesh();

  const plateCenterX = PLATE_CENTER_X;
  plateMesh.position.set(plateCenterX, pileY, pileZ - 0.08);
  plateMesh.scale.set(PLATE_DIAMETER, PLATE_DIAMETER, 1);

  // Grille 4 colonnes (16 places, "une quinzaine" — demande explicite) :
  // espacement resserré pour que même le coin le plus éloigné du centre
  // reste NETTEMENT dans le rayon visible de l'assiette (les jetons
  // peuvent se toucher/chevaucher un peu, demande explicite — "ils
  // débordaient tout autour" avec un espacement plus large). Chaque
  // RANGÉE est centrée selon son propre nombre de jetons (pas un nombre de
  // colonnes fixe) — sinon 1 ou 2 jetons se retrouvent collés à gauche de
  // l'assiette au lieu d'être au milieu (bug constaté avec peu de jetons).
  const DISCARD_GRID_COLS = 4;
  const DISCARD_SPACING = 0.18;
  const discardCount = discardTiles.length;
  const discardRows = Math.max(1, Math.ceil(discardCount / DISCARD_GRID_COLS));
  ensureDiscardMeshCount(discardCount);
  discardTiles.forEach((tile, i) => {
    const mesh = discardMeshes[i];
    mesh.visible = !hideUntil.has(mesh.uuid);
    setTokenValue(mesh, tile);
    mesh.scale.setScalar(BOARD_SCALE);
    if (!isFlying(mesh)) {
      const row = Math.floor(i / DISCARD_GRID_COLS);
      const col = i % DISCARD_GRID_COLS;
      const colsInRow = Math.min(DISCARD_GRID_COLS, discardCount - row * DISCARD_GRID_COLS);
      const x = plateCenterX + (col - (colsInRow - 1) / 2) * DISCARD_SPACING;
      const y = pileY + ((discardRows - 1) / 2 - row) * DISCARD_SPACING;
      mesh.position.set(x, y, pileZ);
    }
  });

  // Pioche décalée à gauche de l'assiette pour ne jamais s'y superposer —
  // un seul sac illustré (voir createPiocheMesh) plutôt qu'une pile de
  // jetons face cachée, demande explicite de l'utilisateur.
  piocheMesh.visible = stockCount > 0;
  piocheMesh.position.set(PIOCHE_X, pileY, pileZ - 0.05);
  piocheMesh.scale.set(PIOCHE_DIAMETER, PIOCHE_DIAMETER, 1);
  drawnTileMesh.userData.hasTile = Boolean(drawnTile);
  if (!drawnTile) drawnDragHidden = false;
  if (!isFlying(drawnTileMesh)) {
    drawnTileMesh.visible = Boolean(drawnTile) && !drawnDragHidden;
    if (drawnTile) {
      setTokenValue(drawnTileMesh, drawnTile);
      drawnTileMesh.scale.setScalar(BOARD_SCALE);
      drawnTileMesh.position.set((PIOCHE_X + plateCenterX) / 2, pileY, pileZ);
    }
  }

  if (animate) {
    const piochePos = piocheStartPos || new THREE.Vector3(PIOCHE_X, pileY, pileZ - 0.05);
    const drawnPos = drawnStartPos || new THREE.Vector3((PIOCHE_X + plateCenterX) / 2, pileY, pileZ);

    const skipPlayerIncoming = playerDropPending;
    playerDropPending = false;

    const playBoardDiff = (prevBoard, currBoard, group, startPosList, { skipIncoming = false } = {}) => {
      if (!group) return;
      for (let i = 0; i < GRID_SIZE; i++) {
        const before = prevBoard[i];
        const after = currBoard[i];
        const dest = group.tokenMeshes[i];
        if (!after) continue;
        if (before && before.id === after.id) continue;
        if (before && before.id !== after.id) {
          flyToDiscard(before, startPosList[i] || dest?.position.clone(), discardTiles);
        }
        if (skipIncoming) continue;
        const from = sourcePosFor(after, prevDrawn, prevDiscardIds, drawnPos, discardStartPos, piochePos);
        flyIncoming(dest, from, after);
      }
    };

    playBoardDiff(prevMy, myBoardTiles, boardGroups[0], myStartPos, { skipIncoming: skipPlayerIncoming });
    opponents.forEach((opp, i) => {
      playBoardDiff(prevOpp[i] || [], opp.board, boardGroups[i + 1], oppStartPos[i] || []);
    });

    const tileOnBoard = (tile, board) => Boolean(tile && (board || []).some((c) => c?.id === tile.id));
    const drawnWasPlaced =
      prevDrawn &&
      (tileOnBoard(prevDrawn, myBoardTiles) || opponents.some((opp) => tileOnBoard(prevDrawn, opp.board)));
    if (prevDrawn && !drawnTile && !drawnWasPlaced && !skipPlayerIncoming) {
      flyToDiscard(prevDrawn, drawnPos, discardTiles);
    }

    if (!prevDrawn && drawnTile && drawnTileMesh) {
      const dest = drawnTileMesh.position.clone();
      drawnTileMesh.position.copy(piochePos);
      drawnTileMesh.visible = true;
      startFlight(drawnTileMesh, dest, { duration: 560, lift: 0.22 });
    }
  }

  previousMyBoardTiles = myBoardTiles.map((t) => (t ? { id: t.id, value: t.value } : null));
  previousOpponentBoards = opponents.map((o) => (o.board || []).map((t) => (t ? { id: t.id, value: t.value } : null)));
  previousDiscardIds = discardTiles.map((t) => t.id);
  previousDrawnTile = drawnTile ? { id: drawnTile.id, value: drawnTile.value } : null;
  hasSnapshot = true;
}

function ensureDiscardMeshCount(count) {
  while (discardMeshes.length > count) disposeMesh(discardMeshes.pop());
  while (discardMeshes.length < count) {
    const mesh = createTokenMesh();
    scene.add(mesh);
    discardMeshes.push(mesh);
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

function getGroupCellRect(group, index) {
  if (!group || group.centerX === undefined) return null;
  const local = cellLocalOffset(index);
  const { dx, dy } = rotateOffset(local.dx, local.dy, group.rotation || 0);
  const scale = group.labelScale || BOARD_SCALE;
  const half = TOKEN_RADIUS * 1.15 * scale;
  const x = group.centerX + dx * scale;
  const y = group.centerY + dy * scale;
  const z = TABLE_Z + (BOARD_THICKNESS / 2 + 0.02) * scale;
  return projectPointsRect([
    [x - half, y + half, z],
    [x + half, y + half, z],
    [x + half, y - half, z],
    [x - half, y - half, z]
  ]);
}

/** Rectangle de la case `index` de MON plateau. */
export function getMyBoardCellRect(index) {
  return getGroupCellRect(boardGroups[0], index);
}

export function getMyBoardCellRects() {
  return Array.from({ length: GRID_SIZE }, (_, i) => getMyBoardCellRect(i));
}

export function getFocusBoardCellRects() {
  const group = boardGroups[focusedSeat] || boardGroups[0];
  return Array.from({ length: GRID_SIZE }, (_, i) => getGroupCellRect(group, i));
}

export function getBoardHitRects() {
  return boardGroups.map((g, i) => {
    if (!g || g.centerX === undefined) return { seat: i, focused: i === focusedSeat, left: 0, top: 0, width: 0, height: 0 };
    const scale = g.labelScale || BOARD_SCALE;
    const hx = (BOARD_WIDTH / 2) * scale;
    const hy = (BOARD_HEIGHT / 2) * scale;
    const r = projectPointsRect([
      [g.centerX - hx, g.centerY + hy, TABLE_Z],
      [g.centerX + hx, g.centerY + hy, TABLE_Z],
      [g.centerX + hx, g.centerY - hy, TABLE_Z],
      [g.centerX - hx, g.centerY - hy, TABLE_Z]
    ]);
    return { seat: i, focused: i === focusedSeat, ...(r || { left: 0, top: 0, width: 0, height: 0 }) };
  });
}

// Décalage (en unités locales du plateau, avant mise à l'échelle) sous le
// rebord bas visible de l'octogone jusqu'à la bulle de nom — sous la ligne
// 3 des trous (dy ≈ -0.95, voir CELL_OFFSETS) avec une marge pour dégager le
// rebord vert et les feuilles de trèfle décoratives.
const BOARD_LABEL_DY = -2.3;

/**
 * Rectangle écran (coordonnées CSS px) de la bulle de nom sous chaque
 * plateau, dans l'ordre de boardGroups (0 = le mien, 1..N = adversaires dans
 * l'ordre des sièges) — voir layoutBoardGroup pour centerX/centerY/labelScale.
 * Le décalage local (0, BOARD_LABEL_DY) est tourné avec le plateau (g.rotation)
 * pour rester du côté EXTÉRIEUR de la table ronde pour tout le monde, mais la
 * bulle elle-même n'est jamais tournée (juste sa position) — demande
 * explicite : "l'étiquette du nom reste droite".
 */
export function getBoardLabelRects() {
  return boardGroups.map((g, i) => {
    if (g.centerX === undefined) return null;
    const scale = g.labelScale || BOARD_SCALE;
    const dy = i === focusedSeat ? BOARD_LABEL_DY : -2.15;
    const half = 0.6 * scale;
    const offset = rotateOffset(0, dy, g.rotation || 0);
    const x = g.centerX + offset.dx * scale;
    const y = g.centerY + offset.dy * scale;
    return projectPointsRect([
      [x - half, y + half, TABLE_Z],
      [x + half, y + half, TABLE_Z],
      [x + half, y - half, TABLE_Z],
      [x - half, y - half, TABLE_Z]
    ]);
  });
}

function meshScreenRect(mesh) {
  if (!mesh) return null;
  // `mesh.scale.x` : les jetons de pioche/défausse sont désormais réduits à
  // BOARD_SCALE (même taille que ceux du plateau, demande explicite) — une
  // demi-taille fixe donnerait des cibles de clic 2x trop grandes,
  // chevauchant les jetons voisins de la grille de défausse.
  const half = TOKEN_RADIUS * 1.1 * mesh.scale.x;
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
  if (!piocheMesh || !piocheMesh.visible) return null;
  // Pas `meshScreenRect` : ce mesh est un plan carré (voir createPiocheMesh),
  // pas un jeton — son "rayon" de clic est la moitié de sa propre échelle,
  // pas TOKEN_RADIUS (qui n'a aucun rapport avec la taille du sac).
  const half = piocheMesh.scale.x / 2;
  const { x, y, z } = piocheMesh.position;
  return projectPointsRect([
    [x - half, y + half, z],
    [x + half, y + half, z],
    [x + half, y - half, z],
    [x - half, y - half, z]
  ]);
}

/** Rectangle écran de l'assiette de défausse — même calcul que getDrawPileRect (plan carré, pas un jeton), sert de zone de dépôt pour le glisser du jeton piochée. */
export function getDiscardPlateRect() {
  if (!plateMesh) return null;
  const half = plateMesh.scale.x / 2;
  const { x, y, z } = plateMesh.position;
  return projectPointsRect([
    [x - half, y + half, z],
    [x + half, y + half, z],
    [x + half, y - half, z],
    [x - half, y - half, z]
  ]);
}

/** Retourne la texture du jeton sous forme de data URL pour affichage dans le DOM */
export async function getTokenFaceDataUrl(value) {
  try {
    const texture = await getTokenFaceTexture(value);
    const img = texture.image || texture.source?.data;
    if (img instanceof HTMLCanvasElement) return img.toDataURL('image/png');
  } catch (e) {
    console.error('Error converting token texture to data URL:', e);
  }
  return null;
}

/** Rectangle écran du jeton piochée en attente de pose (voir drawnTileMesh) — `null` si aucune tuile piochée. */
export function getDrawnTileRect() {
  if (!drawnTileMesh || !drawnTileMesh.visible) return null;
  return meshScreenRect(drawnTileMesh);
}
