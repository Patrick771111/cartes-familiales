export const title = 'Flip 7';
export const html = `
  <p>2 à 6 joueurs. But : accumuler des points sur plusieurs manches jusqu'à 200.</p>
  <ul>
    <li>À ton tour, <strong>Flip !</strong> révèle une carte du paquet dans ta main, ou <strong>Reste</strong> pour t'arrêter là et garder tes points.</li>
    <li>Les cartes numéros vont de 0 à 12. Si tu pioches un numéro que tu as déjà, tu es <strong>passé</strong> pour la manche : 0 point, quelles que soient les cartes déjà en main (sauf Seconde Chance).</li>
    <li>7 numéros différents en main : <strong>FLIP 7 !</strong> La manche s'arrête aussitôt pour tout le monde, et tu marques un gros bonus.</li>
    <li>Cartes spéciales : <strong>+2/+4/+6/+8/+10</strong> et <strong>×2</strong> ajoutent des points sans compter comme numéro (le ×2 double le total de tes numéros). <strong>Freeze</strong> t'arrête net. <strong>Flip Three</strong> te force à révéler 3 cartes de plus d'affilée (peut en déclencher d'autres à la chaîne). <strong>Seconde Chance</strong> te sauve une fois d'un numéro en double.</li>
    <li>Score de la manche : perdu (passé) = 0 ; sinon, somme des numéros (×2 si applicable) + bonus fixes + bonus Flip 7 — ajouté à ton score total.</li>
    <li>Premier à atteindre 200 points cumulés : gagne la partie (le jeu continue quand même si vous voulez enchaîner d'autres manches).</li>
    <li>"Continuer" garde les scores cumulés d'une manche à l'autre ; "Retour au lobby" remet tout le monde à 0.</li>
  </ul>
`;
