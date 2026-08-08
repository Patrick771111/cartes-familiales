export const title = 'Les Cinq Rois';
export const html = `
  <p>2 à 7 joueurs. Moins de points à la fin = gagnant. Manches de <strong>3 à 13 cartes</strong>.</p>
  <ul>
    <li>Deck : 2 jeux × 5 couleurs (♥ ♦ ♣ ♠ ★) du 3 au Roi + 6 jokers.</li>
    <li>À chaque manche, l'<strong>atout</strong> est le rang égal au nombre de cartes distribuées (manche à 3 → les 3 sont atouts, manche à 13 → les Rois).</li>
    <li>À ton tour : <strong>pioche</strong> (talon ou défausse), puis <strong>défausse</strong> une carte.</li>
    <li>Tu peux <strong>poser ta main entière</strong> si elle ne forme que des suites (≥3 même couleur qui se suivent) et/ou des familles (≥3 même rang). Atouts et jokers sont des jokers (wilds).</li>
    <li>Quand quelqu'un pose, les autres jouent encore un tour, puis on compte les pénalités des cartes restantes.</li>
    <li>Pénalités : 3–10 = valeur, V=11, D=12, R=13, atout non posé = 20, joker = 50.</li>
    <li>Après la manche à 13 cartes, le total le plus bas gagne.</li>
  </ul>
  <p><em>Source : AccessiJeux NFC — Les Cinq Rois.</em></p>
`;
