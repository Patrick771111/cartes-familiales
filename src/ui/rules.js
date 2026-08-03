const RULES = {
  pouilleux: {
    title: 'Le Pouilleux',
    html: `
      <p>Le but : ne pas te retrouver seul avec le Valet de Pique en main à la fin.</p>
      <ul>
        <li>Le jeu compte 51 cartes : 3 des 4 Valets ont été retirés, seul le Valet de Pique reste — c'est "le Pouilleux".</li>
        <li>Les cartes sont distribuées entre tous les joueurs, et les paires déjà en main sont défaussées automatiquement.</li>
        <li>À ton tour, tu piocher <strong>à l'aveugle</strong> une carte chez le joueur suivant (tu ne vois que des dos de cartes).</li>
        <li>Si la carte piochée forme une paire avec une carte de ta main, la paire est défaussée aussitôt.</li>
        <li>Un joueur qui n'a plus de carte en main est hors-jeu (à l'abri).</li>
        <li>La partie se termine quand il ne reste qu'un seul joueur avec une carte en main : c'est le Pouilleux !</li>
      </ul>
    `
  },
  trouduc: {
    title: 'Le Trou du Cul',
    html: `
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
    `
  },
  americain: {
    title: 'Le 8 américain',
    html: `
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
    `
  },
  blackjack: {
    title: 'Blackjack',
    html: `
      <p>1 à 6 joueurs, tous contre la banque — <strong>tenue automatiquement par un bot</strong>, ce n'est pas un siège à la table.</p>
      <ul>
        <li>Chacun reçoit 2 cartes, la banque aussi (une carte visible, une cachée). Les figures valent 10, l'As vaut 11 ou 1 (ce qui t'arrange le mieux).</li>
        <li>À ton tour : <strong>Tirer</strong> une carte de plus, ou <strong>Rester</strong> sur ta main actuelle.</li>
        <li>Si ton total dépasse 21, tu as sauté — perdu d'office pour cette manche, quel que soit le score final de la banque.</li>
        <li>Une fois que tout le monde a fini (resté ou sauté), la banque révèle sa carte cachée et tire automatiquement tant que son total est inférieur à 17.</li>
        <li>Résultat : tu gagnes si la banque saute ou si ton total est plus proche de 21 que le sien (sans dépasser) ; égalité si vous êtes à égalité ; perdu sinon.</li>
        <li>Chacun démarre avec 500 💰 et joue une mise fixe de 25 💰 par manche (gagné : +25, perdu : -25, égalité : inchangé). Le solde peut devenir négatif — pas d'élimination, la partie continue tant que la table ne retourne pas au lobby.</li>
        <li>"Continuer" à la fin d'une manche enchaîne directement la suivante en gardant les mêmes soldes ; "Retour au lobby" remet tout le monde à 500 💰.</li>
      </ul>
    `
  },
  flip7: {
    title: 'Flip 7',
    html: `
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
    `
  }
};

export function openRulesModal(gameId) {
  const rules = RULES[gameId];
  if (!rules) return;

  const overlay = document.createElement('div');
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-modal rules-modal" role="dialog" aria-modal="true" aria-label="Règles — ${rules.title}">
      <div class="settings-modal__header">
        <h2>Règles — ${rules.title}</h2>
        <button type="button" class="settings-modal__close" aria-label="Fermer">✕</button>
      </div>
      <div class="rules-modal__content">${rules.html}</div>
    </div>
  `;

  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  overlay.querySelector('.settings-modal__close').addEventListener('click', close);
}
