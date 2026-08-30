import * as THREE from 'three';

/**
 * Scènes 3D persistantes pour la main du Pouilleux tenue en éventail — soit
 * la sienne (face visible, quand on est la cible du tour), soit celle d'un
 * autre joueur (dos de carte, quand on pioche ou qu'on regarde piocher —
 * voir "Refonte graphique 3D" dans README). Chaque éventail est identifié
 * par une clé libre choisie par l'appelant (ex. `'stage'`) : ce module reste
 * générique, il ne connaît aucune zone en particulier. Montées UNE SEULE
 * FOIS chacune, ajoutées à `document.body` (donc en dehors de `#app`,
 * jamais touchées par les `container.innerHTML = ...` du reste de
 * l'appli) — un canvas WebGL recréé à chaque coup perdrait son contexte GL
 * et clignoterait.
 *
 * Volontairement décoratif : le clic réel reste sur les boutons DOM
 * `.target-card--pickable` existants (rendus transparents en mode 3D, voir
 * pouilleux.js) — pas de raycasting, la logique de jeu ne bouge pas. Aucune
 * interaction (glisser-déposer) sur sa propre main affichée en 3D pour
 * cette passe (ordre de tri fixe). `flipCardAt` anime le retournement de la
 * carte piochée (dos → face) lors de la révélation.
 */

const CARD_ASPECT = 240 / 360; // largeur/hauteur, cohérent avec les autres cartes de l'appli
const FELT_600 = '#1F4D3A';
const FELT_900 = '#0F2E21';
const BRASS = '#C9A227';
const BRASS_SOFT = '#E4C765';
const CREAM = '#F7F1E1';
const RED_SUIT = '#B33A3A';
const DARK_SUIT = '#201E18';
const SUIT_COLOR = { S: DARK_SUIT, H: RED_SUIT, D: RED_SUIT, C: DARK_SUIT };
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const BASE_CAMERA_DISTANCE = 3.2; // distance mini (mains courtes) — voir fitCameraToExtent pour les mains plus grandes

// Rang -> lettre française affichée (cohérent avec rankLabel dans src/ui/cards.js).
const COURT_LABEL = { J: 'V', Q: 'D', K: 'R' };
// Disposition des pips par nombre (façon Bicycle), [gauche%, haut%] dans un
// cadre centré sur la carte — mêmes coordonnées que .card__pips--N dans
// style.css (2D), pour un rendu 3D cohérent avec le reste de l'appli.
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
// Axes réutilisés pour composer tilt (éventail) et retournement par
// quaternions plutôt que par angles d'Euler — voir layoutFan/advanceFlips.
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_Z = new THREE.Vector3(0, 0, 1);
const flipTiltQuat = new THREE.Quaternion();
const flipRotateQuat = new THREE.Quaternion();

const scenes = new Map(); // key -> { canvas, renderer, scene, camera, meshes: [] }
let cardBackTexture = null;
const cardFaceTextures = new Map(); // `${rank}${suit}` -> THREE.CanvasTexture
let animationHandle = null;

function buildCardBackTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size / CARD_ASPECT);
  const ctx = c.getContext('2d');

  ctx.fillStyle = FELT_900;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = FELT_600;
  ctx.lineWidth = 8;
  for (let x = -c.height; x < c.width; x += 14) {
    ctx.beginPath();
    ctx.moveTo(x, c.height);
    ctx.lineTo(x + c.height, 0);
    ctx.stroke();
  }

  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);

  const cx = c.width / 2;
  const cy = c.height / 2;
  const r = c.width * 0.23;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = FELT_900;
  ctx.fill();
  ctx.strokeStyle = BRASS_SOFT;
  ctx.lineWidth = 4;
  ctx.stroke();

  ctx.fillStyle = BRASS_SOFT;
  ctx.font = `600 ${Math.round(c.width * 0.22)}px Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CF', cx, cy + 2);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** Pips (cartes numérales, voir PIP_LAYOUTS) — disposition à l'identique de .card__pips en 2D : cadre centré, inset 10% de la largeur des 4 côtés. */
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

/** Figure (Valet/Dame/Roi) — cadre + ornements + monogramme, même vocabulaire que le repli non illustré de courtHtml en 2D (src/ui/cards.js). */
function drawCourtFigure(ctx, c, rank, symbol, color) {
  const cqw = c.width / 100; // unité "% de la largeur", cohérente avec les cqw utilisés en 2D
  const label = COURT_LABEL[rank] || rank;

  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, cqw * 0.6);
  const frameInset = 13 * cqw;
  const radius = 6 * cqw;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(frameInset, frameInset, c.width - frameInset * 2, c.height - frameInset * 2, radius);
  else ctx.rect(frameInset, frameInset, c.width - frameInset * 2, c.height - frameInset * 2);
  ctx.stroke();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `${Math.round(19 * cqw)}px Georgia, serif`;
  const ornamentText = `${symbol}  ${symbol}  ${symbol}`;
  const ornamentOffset = 22 * cqw;
  ctx.fillText(ornamentText, c.width / 2, ornamentOffset);
  ctx.save();
  ctx.translate(c.width / 2, c.height - ornamentOffset);
  ctx.rotate(Math.PI);
  ctx.fillText(ornamentText, 0, 0);
  ctx.restore();
  ctx.restore();

  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(38 * cqw)}px Georgia, serif`;
  ctx.fillText(label, c.width / 2, c.height / 2);
}

function buildCardFaceTexture(rank, suit) {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size / CARD_ASPECT);
  const ctx = c.getContext('2d');
  const color = SUIT_COLOR[suit] || DARK_SUIT;
  const symbol = SUIT_SYMBOL[suit] || '?';

  ctx.fillStyle = CREAM;
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 5;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);

  ctx.fillStyle = color;
  ctx.textAlign = 'center';

  // Coins (haut-gauche, bas-droite retourné) : rang (lettre française pour
  // une figure, voir COURT_LABEL) + symbole empilés.
  const cornerLabel = COURT_LABEL[rank] || rank;
  const cornerFont = Math.round(c.width * 0.17);
  ctx.font = `700 ${cornerFont}px Georgia, serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(cornerLabel, c.width * 0.16, c.height * 0.05);
  ctx.font = `${Math.round(cornerFont * 0.7)}px Georgia, serif`;
  ctx.fillText(symbol, c.width * 0.16, c.height * 0.05 + cornerFont * 1.05);

  ctx.save();
  ctx.translate(c.width, c.height);
  ctx.rotate(Math.PI);
  ctx.font = `700 ${cornerFont}px Georgia, serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(cornerLabel, c.width * 0.16, c.height * 0.05);
  ctx.font = `${Math.round(cornerFont * 0.7)}px Georgia, serif`;
  ctx.fillText(symbol, c.width * 0.16, c.height * 0.05 + cornerFont * 1.05);
  ctx.restore();

  // Pips pour une carte numérale (dont l'As, pip unique en grand), monogramme
  // encadré pour une figure (Valet/Dame/Roi) — voir drawPips/drawCourtFigure.
  if (COURT_LABEL[rank]) drawCourtFigure(ctx, c, rank, symbol, color);
  else drawPips(ctx, c, rank, symbol, color);

  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function getCardBackTexture() {
  if (!cardBackTexture) cardBackTexture = buildCardBackTexture();
  return cardBackTexture;
}

function getCardFaceTexture(rank, suit) {
  const key = `${rank}${suit}`;
  let texture = cardFaceTextures.get(key);
  if (!texture) {
    texture = buildCardFaceTexture(rank, suit);
    cardFaceTextures.set(key, texture);
  }
  return texture;
}

function ensureScene(key) {
  let entry = scenes.get(key);
  if (entry) return entry;

  const canvas = document.createElement('canvas');
  canvas.id = `pouilleux-3d-canvas-${key}`;
  canvas.style.position = 'fixed';
  canvas.style.pointerEvents = 'none'; // les clics traversent vers les boutons DOM dessous
  canvas.style.display = 'none';
  canvas.style.zIndex = '5'; // sous les bulles HUD (z-index 50), au-dessus du feutre
  document.body.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  // Caméra bien en face (pas surélevée) : une carte tournée sur elle-même
  // (rotation.z, l'éventail) doit rester une simple rotation "à plat" à
  // l'écran — vue depuis un angle en plongée, la même rotation change aussi
  // l'inclinaison apparente de la carte par rapport à la caméra, et donc sa
  // taille projetée (certaines cartes de l'éventail semblaient plus grandes
  // que les autres).
  camera.position.set(0, 0, BASE_CAMERA_DISTANCE);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(1, 2, 2);
  scene.add(dirLight);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  entry = { canvas, renderer, scene, camera, meshes: [], flips: new Map(), fades: new Map() };
  scenes.set(key, entry);

  if (!animationHandle) {
    const tick = () => {
      animationHandle = requestAnimationFrame(tick);
      const now = performance.now();
      for (const s of scenes.values()) {
        advanceFlips(s, now);
        advanceFades(s, now);
        s.renderer.render(s.scene, s.camera);
      }
    };
    tick();
  }

  return entry;
}

/** Avance les animations de retournement de carte en cours pour cette scène (voir flipCardAt). */
function advanceFlips(entry, now) {
  for (const [index, flip] of entry.flips) {
    const mesh = entry.meshes[index];
    if (!mesh) {
      entry.flips.delete(index);
      continue;
    }
    const t = Math.min(1, (now - flip.startTime) / flip.duration);
    // À 90° la carte est de profil (invisible) : c'est le seul moment où
    // changer la texture sans "voir" le dos se transformer en face.
    if (!flip.swapped && t >= 0.5) {
      mesh.material.map = flip.faceTexture;
      mesh.material.color.set(0xffffff);
      mesh.material.needsUpdate = true;
      flip.swapped = true;
    }
    // Tilt de l'éventail (voir layoutFan) appliqué EN PREMIER (intrinsèque à
    // la carte), puis retournement composé PAR-DESSUS autour de l'axe Y du
    // MONDE (flipRotateQuat en multiplicande de gauche) — sans cette
    // composition en deux temps, régler rotation.y et rotation.z ensemble
    // (angles d'Euler) fait tourner la carte inclinée autour de sa propre
    // diagonale au lieu d'un axe vertical qui passe par son centre.
    flipTiltQuat.setFromAxisAngle(AXIS_Z, mesh.userData.tiltAngle || 0);
    flipRotateQuat.setFromAxisAngle(AXIS_Y, t * Math.PI);
    mesh.quaternion.copy(flipRotateQuat).multiply(flipTiltQuat);
    if (t >= 1) entry.flips.delete(index);
  }
}

/**
 * Avance les animations transitoires de disparition (`fadeOutCard`, paire
 * défaussée) ou de descente (`descendCard`, carte qui rejoint la main) en
 * cours pour cette scène. Purement décoratif comme `advanceFlips` : le
 * prochain `updateFan` fait autorité et remplace ce rendu.
 */
function advanceFades(entry, now) {
  for (const [index, fade] of entry.fades) {
    const mesh = entry.meshes[index];
    if (!mesh) {
      entry.fades.delete(index);
      continue;
    }
    const t = Math.min(1, (now - fade.startTime) / fade.duration);
    if (fade.kind === 'fadeOut') {
      const s = 1 - t;
      mesh.scale.set(s, s, s);
      mesh.material.opacity = s;
    } else {
      mesh.position.y = fade.startY - fade.distance * t;
      mesh.material.opacity = 1 - t;
    }
    if (t >= 1) {
      mesh.visible = false;
      entry.fades.delete(index);
    }
  }
}

/** Idempotent par clé : ne recrée rien si déjà montée. */
export function mountFan(key) {
  ensureScene(key);
}

/** Ajuste le canvas fixe de `key` pour qu'il recouvre exactement `rect` (un DOMRect, coordonnées viewport). */
export function positionFan(key, rect) {
  const entry = scenes.get(key);
  if (!entry || !rect || rect.width <= 0 || rect.height <= 0) return;
  const { canvas, renderer, camera } = entry;
  canvas.style.left = `${rect.left}px`;
  canvas.style.top = `${rect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
  entry.canvasHeightPx = rect.height; // voir fitCameraToExtent — calibre la distance de caméra sur la hauteur RÉELLE du canvas
}

/**
 * Rectangle écran (coordonnées CSS px, relatives au canvas/à la zone de
 * `positionFan`) couvert par chaque carte de l'éventail `key`, dans le même
 * ordre que `updateFan` — sert à superposer précisément les vrais boutons
 * DOM cliquables (`.target-card--pickable`) sur les cartes 3D dessinées :
 * sans ça, ces boutons restent dans le flux HTML normal (empilés en haut à
 * gauche du "stage") au lieu de correspondre à l'éventail réellement
 * affiché, rendant la pioche impossible à toucher. Englobant (AABB) des 4
 * coins projetés — ignore la rotation propre du bouton (invisible, seule sa
 * zone de clic compte).
 */
export function getCardScreenRects(key) {
  const entry = scenes.get(key);
  if (!entry) return [];
  const { camera, meshes, canvas } = entry;
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

/** Cadre doré enfant, discret par défaut (voir setCardHighlight) — hérite automatiquement de la position/rotation de la carte porteuse. */
function createHighlightFrame() {
  const geometry = new THREE.PlaneGeometry(CARD_ASPECT + 0.06, 1.06);
  const material = new THREE.MeshBasicMaterial({ color: BRASS, side: THREE.DoubleSide, transparent: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.z = -0.005;
  mesh.visible = false;
  return mesh;
}

function disposeMesh(scene, mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
  const frame = mesh.userData.frame;
  if (frame) {
    frame.geometry.dispose();
    frame.material.dispose();
  }
}

/**
 * Dispose `n` cartes en éventail (angle total plafonné, chevauchement accru
 * plutôt qu'un éventail qui continue de s'élargir sans fin une fois la main
 * grande — même intention que applyDynamicHandOverlap côté 2D, voir
 * src/ui/dragReorder.js, sans le réutiliser tel quel puisqu'ici c'est un
 * calcul 3D). Retourne l'étendue horizontale maximale atteinte (demi-largeur
 * en unités monde) — utilisé par `updateFan` pour reculer la caméra si
 * besoin, sans quoi les cartes des extrémités d'une grande main dépassent le
 * champ de vision (invisibles, et donc impossibles à toucher).
 */
function layoutFan(meshes) {
  const n = meshes.length;
  if (n === 0) return 0;
  const maxSpanDeg = 70;
  const minAnglePerCardDeg = 4;
  const anglePerCardDeg = n > 1 ? Math.max(minAnglePerCardDeg, Math.min(maxSpanDeg / (n - 1), 10)) : 0;
  const anglePerCard = (anglePerCardDeg * Math.PI) / 180;
  const radius = 3;
  const halfDiagonal = Math.sqrt((CARD_ASPECT / 2) ** 2 + 0.5 ** 2);

  let maxExtent = halfDiagonal;
  meshes.forEach((mesh, i) => {
    const angle = (i - (n - 1) / 2) * anglePerCard;
    const x = Math.sin(angle) * radius;
    mesh.position.set(x, (Math.cos(angle) - 1) * radius * 0.15, i * 0.01);
    // Stocké à part (pas juste rotation.z) : pendant un retournement,
    // advanceFlips recompose ce tilt avec la rotation de la carte autour
    // d'un axe vertical MONDE (voir AXIS_Y/AXIS_Z plus haut) — mélanger les
    // deux directement en rotation.y/.z (angles d'Euler) fait tourner la
    // carte autour de sa propre diagonale une fois inclinée dans l'éventail,
    // au lieu d'un axe vertical qui passe par son centre.
    mesh.userData.tiltAngle = -angle;
    mesh.quaternion.setFromAxisAngle(AXIS_Z, -angle);
    maxExtent = Math.max(maxExtent, Math.abs(x) + halfDiagonal);
  });
  return maxExtent;
}

/**
 * `cards` : tableau de `{ rank, suit }` (face visible) ou `null` (dos de
 * carte générique, pour une main dont on ne voit pas le contenu). `pickable`
 * éclaircit légèrement les cartes (même intention que le contraste
 * jouable/grisé utilisé ailleurs dans l'appli).
 */
export function updateFan(key, cards = [], { pickable = false } = {}) {
  const entry = scenes.get(key);
  if (!entry) return;
  const { scene, meshes } = entry;

  while (meshes.length > cards.length) disposeMesh(scene, meshes.pop());
  while (meshes.length < cards.length) {
    const geometry = new THREE.PlaneGeometry(CARD_ASPECT, 1);
    // side: DoubleSide — une fois la carte passé 90° (retournement, voir
    // flipCardAt/advanceFlips), la caméra regarde la face géométriquement
    // "arrière" du plan ; par défaut (FrontSide) Three.js ne la dessine pas
    // du tout, donnant l'impression que l'animation s'arrête net à la
    // tranche au lieu de terminer sur la face dévoilée.
    const material = new THREE.MeshStandardMaterial({ transparent: true, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    const frame = createHighlightFrame();
    mesh.add(frame);
    mesh.userData.frame = frame;
    scene.add(mesh);
    meshes.push(mesh);
  }

  meshes.forEach((mesh, i) => {
    // Une animation de retournement ou de disparition/descente en cours pour
    // cet index gère elle-même sa texture/transform (voir advanceFlips et
    // advanceFades) — ne pas l'écraser ici.
    if (entry.flips.has(i) || entry.fades.has(i)) return;
    const card = cards[i];
    const texture = card ? getCardFaceTexture(card.rank, card.suit) : getCardBackTexture();
    mesh.material.map = texture;
    mesh.material.color.set(card ? 0xffffff : pickable ? 0xffffff : 0xb9b9b9);
    mesh.material.needsUpdate = true;
    mesh.material.opacity = 1;
    mesh.scale.set(1, 1, 1);
    mesh.visible = true;
    // L'orientation (tilt + éventuel retournement terminé) est réécrite juste
    // après par layoutFan (mesh.quaternion), pas la peine de la réinitialiser ici.
    mesh.userData.frame.visible = false; // efface une mise en valeur précédente déjà terminée
  });

  const maxExtent = layoutFan(meshes);
  fitCameraToExtent(entry.camera, maxExtent, entry.canvasHeightPx);
}

// Hauteur de canvas (px) pour laquelle BASE_CAMERA_DISTANCE donne la taille de
// carte "de référence" — voir fitCameraToExtent. Proche du min-height/aspect-ratio
// d'origine de .pouilleux-3d-stage (avant l'ajout du second éventail "mine").
const REFERENCE_CANVAS_HEIGHT = 240;

/**
 * Recule la caméra au besoin pour que `maxExtent` (demi-largeur en unités
 * monde, voir layoutFan) tienne dans le champ de vision horizontal, avec une
 * marge de sécurité — sans ça, les cartes des extrémités d'une grande main
 * (le Pouilleux peut en distribuer plus de 20 par joueur) dépassent le cadre
 * et deviennent invisibles ET impossibles à toucher (voir getCardScreenRects,
 * qui reflète fidèlement ce que rend la caméra).
 *
 * `canvasHeightPx` calibre la distance de base : à FOV égal, une même
 * distance de caméra donne une carte plus PETITE en pixels sur un canvas plus
 * bas (moins de pixels disponibles pour la même taille angulaire) — sans ce
 * calibrage, l'éventail "mine" (canvas nettement plus bas que "stage")
 * affichait des cartes visiblement plus petites, cassant l'illusion d'une
 * carte qui "descend" d'un éventail à l'autre (voir descendCard). La distance
 * de base est donc mise à l'échelle proportionnellement à la hauteur réelle
 * du canvas par rapport à REFERENCE_CANVAS_HEIGHT. Ne rapproche jamais sous
 * cette base (pas la peine de zoomer davantage pour une main courte).
 */
function fitCameraToExtent(camera, maxExtent, canvasHeightPx) {
  const heightScale = (canvasHeightPx || REFERENCE_CANVAS_HEIGHT) / REFERENCE_CANVAS_HEIGHT;
  const baseDistance = BASE_CAMERA_DISTANCE * heightScale;
  const halfVFov = (camera.fov * Math.PI) / 360;
  const halfHFov = Math.atan(Math.tan(halfVFov) * camera.aspect);
  const margin = 0.82; // <1 : garde une marge, n'utilise pas tout le cadre pile au bord
  const neededDistance = maxExtent / Math.tan(halfHFov * margin);
  camera.position.z = Math.max(baseDistance, neededDistance);
}

/**
 * Anime le retournement de la carte à `index` dans l'éventail `key` (dos ->
 * face de `card`), sur `duration` ms — voir "et la carte choisie pivote pour
 * se dévoiler". Purement visuel et transitoire : le prochain `updateFan`
 * (au nouvel état de la partie) fait autorité et remplace ce rendu.
 */
export function flipCardAt(key, index, card, { duration = 700 } = {}) {
  const entry = scenes.get(key);
  const mesh = entry?.meshes[index];
  if (!mesh) return;
  entry.flips.set(index, {
    startTime: performance.now(),
    duration,
    faceTexture: getCardFaceTexture(card.rank, card.suit),
    swapped: false
  });
}

export function showFan(key) {
  const entry = scenes.get(key);
  if (entry) entry.canvas.style.display = 'block';
}

/** Cache UN SEUL éventail (contrairement à hideAllFans) — pour une clé qui n'a plus lieu d'être affichée ce rendu-ci sans toucher aux autres scènes (ex. "mine" quand ce n'est plus mon tour de piocher). */
export function hideFan(key) {
  const entry = scenes.get(key);
  if (entry) entry.canvas.style.display = 'none';
}

export function hideAllFans() {
  for (const entry of scenes.values()) entry.canvas.style.display = 'none';
}

/** Bascule le contour doré de la carte à `index` dans l'éventail `key` (mise en valeur, ex. paire détectée — voir renderDrawReveal3D). */
export function setCardHighlight(key, index, on) {
  const frame = scenes.get(key)?.meshes[index]?.userData.frame;
  if (frame) frame.visible = on;
}

/** Fait disparaître (rétrécit + fondu) la carte à `index` — paire défaussée. */
export function fadeOutCard(key, index, { duration = 400 } = {}) {
  const entry = scenes.get(key);
  if (!entry?.meshes[index]) return;
  entry.fades.set(index, { kind: 'fadeOut', startTime: performance.now(), duration });
}

/** Fait descendre (translation + fondu) la carte à `index` — rejoint la main affichée en dessous. */
export function descendCard(key, index, { duration = 450, distance = 1.2 } = {}) {
  const entry = scenes.get(key);
  const mesh = entry?.meshes[index];
  if (!mesh) return;
  entry.fades.set(index, { kind: 'descend', startTime: performance.now(), duration, distance, startY: mesh.position.y });
}
