// Jaquettes façon Steam pour le sélecteur de jeu — un fichier par jeu
// (src/assets/games/<id>.webp), séparées du reste des ressources cartes.
// Absence de fichier = jeu sans jaquette pour l'instant (repli texte dans
// le sélecteur, voir game.js) : ajouter un jeu n'oblige jamais à en fournir
// une immédiatement.
const files = import.meta.glob('../assets/games/*.{webp,jpg,jpeg,png}', { eager: true, import: 'default' });

const COVERS = {};
for (const path in files) {
  const id = path.match(/\/([\w-]+)\.\w+$/)?.[1];
  if (id) COVERS[id] = files[path];
}

export function gameCoverImage(gameId) {
  return COVERS[gameId] || null;
}
