export const title = 'Blackjack';
export const html = `
  <p>1 à 6 joueurs, tous contre la banque — <strong>tenue automatiquement par un bot</strong>, ce n'est pas un siège à la table.</p>
  <ul>
    <li>Chacun reçoit 2 cartes, la banque aussi (une carte visible, une cachée). Les figures valent 10, l'As vaut 11 ou 1 (ce qui t'arrange le mieux).</li>
    <li>À ton tour : <strong>Tirer</strong> une carte de plus, ou <strong>Rester</strong> sur ta main actuelle.</li>
    <li>Si ton total dépasse 21, tu as sauté — perdu d'office pour cette manche, quel que soit le score final de la banque.</li>
    <li>Une fois que tout le monde a fini (resté ou sauté), la banque révèle sa carte cachée et tire automatiquement tant que son total est inférieur à 17.</li>
    <li>Résultat : tu gagnes si la banque saute ou si ton total est plus proche de 21 que le sien (sans dépasser) ; égalité si vous êtes à égalité ; perdu sinon.</li>
    <li>Chacun démarre avec 500 💰 et règle sa <strong>propre</strong> mise (slider de 5 à 100 💰, indépendant des autres joueurs) — gagné : +ta mise, perdu : -ta mise, égalité : inchangé. Le solde peut devenir négatif — pas d'élimination, la partie continue tant que la table ne retourne pas au salon.</li>
    <li>"Continuer" à la fin d'une manche enchaîne directement la suivante en gardant les mêmes soldes ; chacun peut ajuster sa mise sur l'écran de fin de manche avant de relancer. "Retour au salon" remet tout le monde à 500 💰.</li>
  </ul>
`;
