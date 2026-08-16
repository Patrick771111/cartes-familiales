export const title = 'Skyjo';
export const html = `
  <p>2 à 6 joueurs. Contrairement aux autres jeux ici, <strong>moins de points c'est mieux</strong> !</p>
  <ul>
    <li>Chacun a une grille de 12 cartes cachées (3 lignes × 4 colonnes), dont 2 déjà révélées au départ.</li>
    <li>À ton tour : prends la carte visible du dessus de la <strong>défausse</strong> (à poser obligatoirement), ou pioche du <strong>sabot</strong> (à poser, ou à défausser en retournant une case cachée à la place).</li>
    <li>Pour poser : glisse la carte piochée vers une case de ta grille, ou touche simplement la case. Pour défausser une carte piochée du sabot et retourner une case cachée à la place : touche cette case <strong>deux fois</strong>.</li>
    <li>Poser une carte remplace celle de la case choisie, qui part à la défausse face visible.</li>
    <li>Si les 3 cartes d'une même colonne sont face visible avec la <strong>même valeur</strong>, la colonne entière est effacée (elle ne compte plus dans ton score).</li>
    <li>Dès que ta grille est entièrement retournée (ou effacée), chacun des autres joue encore un dernier tour, puis toutes les grilles sont révélées et comptées.</li>
    <li>Score de la manche : somme des cartes encore en jeu (de -2 à 12). Si tu es celui qui a terminé sa grille en premier <strong>sans avoir le score le plus bas</strong> de la manche, ton score est doublé !</li>
    <li>"Continuer" garde les scores cumulés d'une manche à l'autre ; "Retour au salon" remet tout le monde à 0. Premier à atteindre 100 points cumulés : la partie s'arrête, et c'est celui qui a le score cumulé <strong>le plus bas</strong> qui gagne.</li>
  </ul>
`;
