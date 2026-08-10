export const title = 'Uno';
export const html = `
  <p>2 à 6 joueurs. 108 cartes : 4 couleurs (rouge/jaune/vert/bleu), symboles et Jokers. 7 cartes en main pour chacun.</p>
  <ul>
    <li>À ton tour, pose une carte de la même <strong>couleur</strong> ou du même <strong>symbole/valeur</strong> que le sommet de la défausse.</li>
    <li>Si tu n'as aucun coup possible, pioche une carte : ton tour s'arrête là (la carte piochée n'est pas rejouable dans la foulée).</li>
    <li>Si la pioche est épuisée, la défausse est remélangée pour en reformer une (sauf la carte du dessus, qui reste en jeu).</li>
    <li>Premier à vider sa main : gagné ! La manche s'arrête là.</li>
  </ul>
  <p><strong>Cartes spéciales</strong> (sans effet si c'est ta toute dernière carte — tu as déjà gagné) :</p>
  <ul>
    <li><strong>Passer</strong> : le joueur suivant passe son tour.</li>
    <li><strong>Inverser</strong> : inverse le sens du jeu — à 2 joueurs, ça revient à passer (tu rejoues aussitôt).</li>
    <li><strong>+2</strong> / <strong>Joker +4</strong> : toujours jouables (le +4 quelle que soit ta main) — au lieu de piocher aussitôt, la pénalité s'ajoute à une <strong>pile de pioche</strong>. Le joueur suivant peut soit empiler à son tour une autre carte +2 ou +4 (les deux se mélangent librement) pour faire grimper la pile et la refiler encore plus loin, soit piocher toute la pile d'un coup (et perdre son tour) — même s'il a une carte pour empiler, piocher reste toujours possible.</li>
    <li><strong>Joker</strong> : toujours jouable — choisis la nouvelle couleur en cours.</li>
  </ul>
  <p><strong>UNO !</strong> Dès que tu poses ta carte avant-dernière (il ne t'en reste plus qu'une), signale-le avec le bouton "UNO !". Tant que tu ne l'as pas fait, n'importe quel autre joueur peut te "contre-signaler" pour t'infliger 2 cartes de pénalité — mais seulement avant que quelqu'un d'autre n'ait joué ou pioché entre-temps : passé ce moment, tu es tiré d'affaire pour ce tour-ci.</p>
`;
