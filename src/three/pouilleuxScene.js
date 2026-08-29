import * as THREE from 'three';

/**
 * Scène 3D persistante pour la pioche du Pouilleux (voir "Refonte graphique
 * 3D" — première tranche). Montée UNE SEULE FOIS, ajoutée à `document.body`
 * (donc en dehors de `#app`, jamais touchée par les `container.innerHTML = ...`
 * du reste de l'appli) — un canvas WebGL recréé à chaque coup perdrait son
 * contexte GL et clignoterait. `mountPouilleuxScene`/`updatePouilleuxScene`
 * ne font jamais table rase : on ajoute/retire seulement les cartes dont le
 * nombre a changé.
 *
 * Volontairement décoratif pour cette tranche : le clic réel reste sur les
 * boutons DOM `.target-card--pickable` existants (rendus transparents en
 * mode 3D, voir pouilleux.js) — pas de raycasting ici, la logique de jeu ne
 * bouge pas.
 */

const CARD_ASPECT = 240 / 360; // largeur/hauteur, cohérent avec les autres cartes de l'appli
const FELT_600 = '#1F4D3A';
const FELT_900 = '#0F2E21';
const BRASS = '#C9A227';
const BRASS_SOFT = '#E4C765';

let canvas = null;
let renderer = null;
let scene = null;
let camera = null;
let cardTexture = null;
let cardMeshes = [];
let animationHandle = null;

function buildCardBackTexture() {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = Math.round(size / CARD_ASPECT);
  const ctx = c.getContext('2d');

  // Trame diagonale feutre (même esprit que .card--back en CSS).
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

  // Bordure laiton.
  ctx.strokeStyle = BRASS;
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, c.width - 6, c.height - 6);

  // Médaillon central + monogramme, comme le dos de carte 2D.
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

/** Idempotent : ne recrée rien si déjà montée. */
export function mountPouilleuxScene() {
  if (renderer) return;

  canvas = document.createElement('canvas');
  canvas.id = 'pouilleux-3d-canvas';
  canvas.style.position = 'fixed';
  canvas.style.pointerEvents = 'none'; // les clics traversent vers les boutons DOM invisibles dessous
  canvas.style.display = 'none';
  canvas.style.zIndex = '5'; // sous les bulles HUD (z-index 50), au-dessus du feutre
  document.body.appendChild(canvas);

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(0, 1.1, 3.2);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dirLight = new THREE.DirectionalLight(0xffffff, 0.6);
  dirLight.position.set(1, 2, 2);
  scene.add(dirLight);

  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  cardTexture = buildCardBackTexture();

  const tick = () => {
    animationHandle = requestAnimationFrame(tick);
    renderer.render(scene, camera);
  };
  tick();
}

/** Ajuste le canvas fixe pour qu'il recouvre exactement `rect` (un DOMRect, coordonnées viewport). */
export function positionPouilleuxScene(rect) {
  if (!renderer || !rect || rect.width <= 0 || rect.height <= 0) return;
  canvas.style.left = `${rect.left}px`;
  canvas.style.top = `${rect.top}px`;
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;
  renderer.setSize(rect.width, rect.height, false);
  camera.aspect = rect.width / rect.height;
  camera.updateProjectionMatrix();
}

function disposeCardMesh(mesh) {
  scene.remove(mesh);
  mesh.geometry.dispose();
  mesh.material.dispose();
}

/**
 * Aligne `count` cartes dos-visible en éventail. `pickable` éclaircit
 * légèrement les cartes (même intention que le contraste jouable/grisé
 * utilisé ailleurs dans l'appli — voir style.css .hand-card--unplayable).
 */
export function updatePouilleuxScene({ count = 0, pickable = false } = {}) {
  if (!renderer) return;

  while (cardMeshes.length > count) disposeCardMesh(cardMeshes.pop());
  while (cardMeshes.length < count) {
    const geometry = new THREE.PlaneGeometry(CARD_ASPECT, 1);
    const material = new THREE.MeshStandardMaterial({ map: cardTexture, transparent: true });
    const mesh = new THREE.Mesh(geometry, material);
    scene.add(mesh);
    cardMeshes.push(mesh);
  }

  const n = cardMeshes.length;
  const spread = Math.min(0.55, n * 0.16);
  cardMeshes.forEach((mesh, i) => {
    const t = n > 1 ? i / (n - 1) - 0.5 : 0;
    mesh.position.set(t * spread * 4, pickable ? 0.03 : 0, 0);
    mesh.rotation.z = -t * 0.5;
    mesh.material.color.set(pickable ? 0xffffff : 0xb9b9b9);
  });
}

export function showPouilleuxScene() {
  if (canvas) canvas.style.display = 'block';
}

export function hidePouilleuxScene() {
  if (canvas) canvas.style.display = 'none';
}
