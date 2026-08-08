export const title = 'Le 8 américain';
export const html = `
  <p>2 à 6 joueurs. Jeu de 52 cartes standard.</p>
  <ul>
    <li>À ton tour, pose une carte qui correspond à la <strong>couleur</strong> ou au <strong>rang</strong> de la carte au sommet de la défausse.</li>
    <li>Si tu n'as aucun coup possible, pioche une carte dans la pioche : ton tour s'arrête là (la carte piochée n'est pas rejouable dans la foulée).</li>
    <li>Si la pioche est épuisée, la défausse est remélangée pour en reformer une (sauf la carte du dessus, qui reste en jeu).</li>
    <li>Premier à vider sa main : gagné ! La manche s'arrête là.</li>
  </ul>
  <p><strong>Cartes spéciales</strong> (sans effet si c'est ta toute dernière carte — tu as déjà gagné) :</p>
  <ul>
    <li><strong>8</strong> : toujours jouable, quelle que soit la situation — choisis la nouvelle couleur demandée pour le joueur suivant.</li>
    <li><strong>Valet</strong> : inverse le sens du jeu.</li>
    <li><strong>2</strong> : le joueur suivant pioche 2 cartes et son tour est sauté.</li>
    <li><strong>As</strong> : pioche une carte au hasard dans la main du joueur suivant (comme au Pouilleux) — son tour n'est pas sauté.</li>
  </ul>
`;
