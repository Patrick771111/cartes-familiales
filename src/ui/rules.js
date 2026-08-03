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
        <li>Un <strong>8</strong> est toujours jouable, quelle que soit la situation — et te permet de choisir la nouvelle couleur demandée pour le joueur suivant.</li>
        <li>Si tu n'as aucun coup possible, pioche une carte dans la pioche : ton tour s'arrête là (la carte piochée n'est pas rejouable dans la foulée).</li>
        <li>Si la pioche est épuisée, la défausse est remélangée pour en reformer une (sauf la carte du dessus, qui reste en jeu).</li>
        <li>Premier à vider sa main : gagné ! La manche s'arrête là.</li>
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
        <li>Pas de mise ni de jeton ici — chaque manche se solde juste par gagné, perdu ou égalité, pour rester simple.</li>
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
