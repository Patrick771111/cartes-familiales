// Petit indicateur discret, à côté du prénom du joueur (coin supérieur droit,
// juste à gauche du bouton réglages ⚙️) : un 🔌 s'allume quand la liaison
// directe (WebRTC) vers l'hôte est active, pour que la famille sache que ses
// coups partent vite sans dépendre de la connexion internet du moment (voir
// src/webrtc/relay.js). Remplace l'ancien bandeau flottant, qui cachait une
// partie de l'écran de jeu. Élément unique, en dehors du conteneur de jeu
// (qui est entièrement remplacé à chaque rendu) pour ne pas le recréer à
// chaque écran.
let el = null;

function ensureEl() {
  if (el) return el;
  el = document.createElement('div');
  el.className = 'player-badge';
  el.innerHTML = '<span class="player-badge__name"></span><span class="player-badge__plug" title="Connexion directe active">🔌</span>';
  document.body.appendChild(el);
  return el;
}

export function updateConnectionBadge(active, playerName) {
  const node = ensureEl();
  node.querySelector('.player-badge__name').textContent = playerName || '';
  node.classList.toggle('player-badge--visible', Boolean(playerName));
  node.classList.toggle('player-badge--plugged', Boolean(active));
}
