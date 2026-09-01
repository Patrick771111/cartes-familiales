export const title = 'Blackjack';
export const html = `
  <p>1 à 5 joueurs, tous contre la banque — <strong>tenue automatiquement</strong>, ce n'est pas un siège à la table.</p>
  <ul>
    <li>Avant chaque main, chacun mise avec des jetons (5, 10, 25, 100) puis valide. Solde de départ : 500 💰.</li>
    <li>Chacun reçoit 2 cartes, la banque aussi (une visible, une cachée). Figures = 10, As = 11 ou 1.</li>
    <li>Blackjack naturel (21 en 2 cartes) paie <strong>3:2</strong>.</li>
    <li>Si la banque montre un As : tu peux prendre l’<strong>assurance</strong> (la moitié de ta mise, paie 2:1 si la banque a blackjack).</li>
    <li>À ton tour : <strong>Tirer</strong>, <strong>Rester</strong>, <strong>Doubler</strong> (premières 2 cartes, une carte de plus) ou <strong>Split</strong> (deux cartes de même rang, jusqu’à 4 mains ; les As splittés reçoivent une carte chacun).</li>
    <li>Si tu dépasses 21, tu sautes. Puis la banque révèle et tire jusqu’à 17.</li>
    <li>Gagné : tu récupères mise + gain ; égalité : mise rendue ; perdu : la mise reste à la banque.</li>
    <li>"Continuer" enchaîne une nouvelle mise en gardant les soldes. "Retour au salon" remet 500 💰.</li>
  </ul>
`;
