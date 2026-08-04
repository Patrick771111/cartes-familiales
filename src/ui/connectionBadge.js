// Petit indicateur discret : s'allume quand la liaison directe (WebRTC) vers
// l'hôte est active, pour que la famille sache que ses coups partent vite
// sans dépendre de la connexion internet du moment (voir src/webrtc/relay.js).
// Élément unique, en dehors du conteneur de jeu (qui est entièrement
// remplacé à chaque rendu) pour ne pas avoir à le recréer à chaque écran.
let el = null;

function ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'connection-badge';
  el.textContent = '⚡ Connexion directe';
  document.body.appendChild(el);
  return el;
}

export function updateConnectionBadge(active) {
  ensureEl().classList.toggle('connection-badge--visible', Boolean(active));
}
