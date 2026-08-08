export const title = 'Le Trou du Cul';
export const html = `
  <p>Exactement 4 joueurs. Jeu de 52 cartes, où le 2 est la carte la plus forte.</p>
  <p><strong>Ordre des rangs</strong> (du plus faible au plus fort) : 3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · V · D · R · A · 2.</p>
  <ul>
    <li>À ton tour, pose une ou plusieurs cartes de <strong>même rang</strong>, en quantité égale ou supérieure au pli en cours (le tout premier pli d'une manche est libre : tu poses ce que tu veux).</li>
    <li>Poser un <strong>8</strong> ou un <strong>2</strong> brûle le pli : il est ramassé aussitôt et tu rejoues immédiatement, sur n'importe quel rang.</li>
    <li>Tu peux aussi <strong>copier</strong> le rang du pli au lieu de le dépasser (ex : 4 → 6 → 6). Dans ce cas, seul le joueur suivant est verrouillé sur ce rang pour un tour — il doit copier à son tour (ce qui reverrouille la personne d'après) ou passer (la liberté revient alors totalement).</li>
    <li>Si tu ne peux pas — ou ne veux pas — jouer plus fort, passe. Quand tout le monde a passé, le pli est ramassé et son dernier auteur relance librement.</li>
    <li>À la toute première manche, les 4 rôles (Président, Vice-Président, Secrétaire, Trou du Cul) sont tirés au sort. Ensuite, chacun garde son rôle d'une manche à l'autre (sauf si un joueur change : son siège est alors retiré au sort parmi les nouveaux venus).</li>
    <li>Avant chaque donne : le Trou du Cul donne ses 2 meilleures cartes au Président (qui lui en rend 2 en retour), et le Secrétaire fait de même avec le Vice-Président pour 1 carte.</li>
    <li>Premier à vider sa main : il devient (ou reste) Président à la prochaine manche !</li>
  </ul>
`;
