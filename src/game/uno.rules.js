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
    <li><strong>+2</strong> : le joueur suivant pioche 2 cartes et son tour est sauté.</li>
    <li><strong>Joker</strong> : toujours jouable — choisis la nouvelle couleur en cours.</li>
    <li><strong>Joker +4</strong> : toujours jouable — choisis la nouvelle couleur, le joueur suivant pioche 4 cartes et son tour est sauté.</li>
  </ul>
`;
