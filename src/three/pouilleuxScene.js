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

/** Rendu simplifié (pas les pips exacts ni les figures illustrées de cardFaceHtml) — assez lisible à l'échelle d'une carte 3D. */
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

  // Coins (haut-gauche, bas-droite retourné) : rang + symbole empilés.
  const cornerFont = Math.round(c.width * 0.17);
  ctx.font = `700 ${cornerFont}px Georgia, serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(rank, c.width * 0.16, c.height * 0.05);
  ctx.font = `${Math.round(cornerFont * 0.7)}px Georgia, serif`;
  ctx.fillText(symbol, c.width * 0.16, c.height * 0.05 + cornerFont * 1.05);

  ctx.save();
  ctx.translate(c.width, c.height);
  ctx.rotate(Math.PI);
  ctx.font = `700 ${cornerFont}px Georgia, serif`;
  ctx.textBaseline = 'top';
  ctx.fillText(rank, c.width * 0.16, c.height * 0.05);
  ctx.font = `${Math.round(cornerFont * 0.7)}px Georgia, serif`;
  ctx.fillText(symbol, c.width * 0.16, c.height * 0.05 + cornerFont * 1.05);
  ctx.restore();

  // Symbole de famille en grand au centre.
  ctx.font = `${Math.round(c.width * 0.4)}px Georgia, serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, c.width / 2, c.height * 0.52);

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
  camera.position.set(0, 1.3, 3.2);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(1, 2, 2);
  scene.add(dirLight);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  entry = { canvas, renderer, scene, camera, meshes: [], flips: new Map() };
  scenes.set(key, entry);

  if (!animationHandle) {
    const tick = () => {
      animationHandle = requestAnimationFrame(tick);
      const now = performance.now();
      for (const s of scenes.values()) {
        advanceFlips(s, now);
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
    mesh.rotation.y = t * Math.PI;
    if (t >= 1) entry.flips.delete(index);
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
}

function disposeMesh(scene, mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
}

/**
 * Dispose `n` cartes en éventail (angle total plafonné, chevauchement accru
 * plutôt qu'un éventail qui continue de s'élargir sans fin une fois la main
 * grande — même intention que applyDynamicHandOverlap côté 2D, voir
 * src/ui/dragReorder.js, sans le réutiliser tel quel puisqu'ici c'est un
 * calcul 3D).
 */
function layoutFan(meshes) {
  const n = meshes.length;
  if (n === 0) return;
  const maxSpanDeg = 70;
  const minAnglePerCardDeg = 4;
  const anglePerCardDeg = n > 1 ? Math.max(minAnglePerCardDeg, Math.min(maxSpanDeg / (n - 1), 10)) : 0;
  const anglePerCard = (anglePerCardDeg * Math.PI) / 180;
  const radius = 3;

  meshes.forEach((mesh, i) => {
    const angle = (i - (n - 1) / 2) * anglePerCard;
    mesh.position.set(Math.sin(angle) * radius, (Math.cos(angle) - 1) * radius * 0.15, i * 0.01);
    mesh.rotation.z = -angle;
  });
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
    const material = new THREE.MeshStandardMaterial({ transparent: true });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    meshes.push(mesh);
  }

  meshes.forEach((mesh, i) => {
    // Une animation de retournement en cours pour cet index gère elle-même
    // sa texture/rotation (voir advanceFlips) — ne pas l'écraser ici.
    if (entry.flips.has(i)) return;
    const card = cards[i];
    const texture = card ? getCardFaceTexture(card.rank, card.suit) : getCardBackTexture();
    mesh.material.map = texture;
    mesh.material.color.set(card ? 0xffffff : pickable ? 0xffffff : 0xb9b9b9);
    mesh.material.needsUpdate = true;
    mesh.rotation.y = 0; // efface un retournement précédent déjà terminé
  });

  layoutFan(meshes);
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

export function hideAllFans() {
  for (const entry of scenes.values()) entry.canvas.style.display = 'none';
}
