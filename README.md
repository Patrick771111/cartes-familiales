# Cartes en famille

PWA multi-joueurs pour jouer aux cartes à plusieurs, chacun sur son téléphone.
Premier jeu implémenté : **le Pouilleux**. Pensée pour accueillir d'autres jeux
de cartes ensuite (voir *Étendre à d'autres jeux* plus bas).

## Stack

- **Vite** + JS vanilla (pas de framework — cohérent avec l'approche de Repas malin,
  mais organisé en plusieurs fichiers pour rester maintenable avec Continue.dev/Aider).
- **Supabase** (Postgres + Realtime) pour synchroniser l'état de la partie entre les
  téléphones : on réutilise ton projet Supabase existant (celui de Repas malin), dans
  une nouvelle table dédiée `game_rooms`.
- PWA installable : `manifest.webmanifest` + service worker minimal fait main.

## Mise en route

1. **Installer les dépendances**
   ```bash
   npm install
   ```

2. **Créer la table dans Supabase**
   Ouvre le SQL editor de ton projet Supabase (celui de Repas malin) et exécute
   le contenu de [`sql/schema.sql`](./sql/schema.sql). Ça crée la table
   `game_rooms`, active le Realtime dessus, et pose des policies RLS permissives
   (adaptées à un usage familial derrière une URL privée, comme ton tunnel
   `repas-ia.blavier.one` — voir la note sécurité dans le fichier SQL).

3. **Configurer les variables d'environnement**
   ```bash
   cp .env.example .env
   ```
   Renseigne `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` (Project Settings > API
   dans le dashboard Supabase — les mêmes valeurs que Repas malin).

4. **Lancer en développement**
   ```bash
   npm run dev -- --host
   ```
   Le `--host` (ou `server.host: true` déjà mis dans `vite.config.js`) rend le
   serveur accessible depuis les autres appareils du réseau local, pratique
   pour tester directement sur les smartphones de la famille.

5. **Build pour la prod**
   ```bash
   npm run build
   ```
   Le dossier `dist/` est déployable tel quel (Netlify, ou exposé via ton tunnel
   Cloudflare comme `repas-ia`, en créant un second hostname).

## Jeux disponibles

- **Le Pouilleux** (`src/game/pouilleux.js`) : décrit plus bas.
- **Le Trou du Cul** (`src/game/trouduc.js`) : exactement 4 joueurs. Jeu de 52
  cartes, ordre 3 → 2 (le 2 est la carte la plus forte), on pose des cartes de
  même rang en quantité égale ou supérieure au pli, sinon on passe ; poser un 8
  brûle le pli et permet de rejouer immédiatement. À la toute première manche,
  les 4 rôles (Président, Vice-Président, Secrétaire, Trou du Cul) sont tirés
  au sort ; ensuite ils sont reconduits selon le classement de la manche
  précédente. Avant chaque donne : le Trou du Cul donne ses 2 meilleures
  cartes au Président (qui lui rend 2 cartes en retour), et le Secrétaire fait
  de même avec le Vice-Président pour 1 carte. Le Trou du Cul entame le
  premier pli de la nouvelle manche *(hypothèse — certaines familles font
  démarrer le Président à la place ; à changer dans `initGame`, ligne
  `currentPlayerId: trouDuCulId`, si besoin)*.

L'hôte choisit le jeu dans la salle d'attente juste avant de lancer la partie.
Si vous n'êtes que 2 ou 3, l'hôte peut ajouter 1 ou 2 bots pour compléter la
table (bouton "+ Ajouter un bot" en salle d'attente, jusqu'à 4 joueurs au
total). Les bots jouent tout seuls après un court délai :
- **Pouilleux** : tirage au hasard, comme n'importe quel joueur (aucune
  stratégie possible à ce jeu, c'est purement à l'aveugle).
- **Trou du Cul** : comportement basique — relance toujours avec l'ensemble de
  cartes le plus faible de sa main, et pour battre le pli choisit toujours le
  rang légal le plus faible possible. Pas d'anticipation plus poussée (ne
  retient pas ses grosses cartes en fin de manche, par exemple).

## Comment ça marche

- Il n'y a **qu'une seule table**, identifiée par un code fixe caché dans le code
  (`FAMILY_CODE` dans `src/game/engine.js`, personnalisable via `VITE_FAMILY_CODE`).
  Personne n'a besoin de créer ou saisir de code : le premier appareil qui ouvre
  l'appli la crée automatiquement, les suivants la rejoignent.
- Chaque appareil mémorise son prénom dans `localStorage` dès la première visite
  (bouton "Ce n'est pas [prénom] ? Changer de prénom" dans la salle d'attente si besoin).
- `src/game/deck.js` et `src/game/pouilleux.js` : logique du jeu, en fonctions
  pures — aucune dépendance à Supabase ni au DOM. C'est le cœur à copier/adapter
  pour ajouter un nouveau jeu.
- `src/supabase/sync.js` : lecture/écriture de la table avec un **verrou optimiste**
  (colonne `version`) pour éviter que deux actions simultanées ne s'écrasent, et
  un abonnement Realtime (`postgres_changes`) pour pousser les mises à jour à
  tous les téléphones connectés.
- `src/game/engine.js` : colle le tout ensemble (rejoindre la table familiale,
  démarrer une manche, jouer un tour, relancer une partie).
- `src/ui/` : rendu DOM simple (pas de framework), un écran = une fonction.

## Déroulé d'une partie

1. Chacun ouvre l'appli sur son téléphone. Premier arrivé = hôte.
2. La salle d'attente affiche la liste des joueurs déjà connectés en temps réel.
3. L'hôte clique sur "Lancer la partie" quand tout le monde est là (pas besoin
   d'attendre exactement 4 joueurs, ça marche dès 2).
4. À la fin d'une manche, n'importe qui peut cliquer "Rejouer" : ça remet tout
   le monde en salle d'attente avec les mêmes joueurs, prêt pour une nouvelle donne.

## Règles du Pouilleux implémentées

Jeu de 52 cartes dont on retire 3 des 4 Valets (on garde le Valet de Pique =
"le Pouilleux"). Distribution égale entre les joueurs, défausse automatique des
paires de même rang. À son tour, le joueur pioche à l'aveugle une carte chez le
joueur suivant ; s'il forme une paire, elle est défaussée. Un joueur sans carte
en main est hors-jeu. La partie se termine quand il ne reste qu'un joueur avec
une carte : c'est le Pouilleux.

Prévu pour 2 à 4 joueurs pour l'instant (l'engine gère en réalité 2 à 8, la
limite est seulement dans le confort d'affichage de la table — à élargir
facilement si besoin).

## Limite connue (MVP)

L'état de la partie (y compris les mains de tous les joueurs) transite par une
ligne Supabase lisible par quiconque connaît le code de la table. Ce code est
maintenant fixe et écrit en clair dans le bundle JS (`FAMILY_CODE`), donc la
seule vraie barrière est de ne pas rendre l'URL de l'appli publique. Suffisant
pour un usage familial derrière une URL non indexée comme `cartes.blavier.one`.
Si un jour tu veux un vrai "fair-play" (empêcher un joueur curieux d'inspecter
les mains adverses dans les devtools), il faudrait déplacer la logique de
pioche côté serveur (Edge Function Supabase) pour ne renvoyer à chaque client
que sa propre main. Pas fait ici pour garder le MVP simple.

## Étendre à d'autres jeux

L'idée : un module `src/game/<nom-du-jeu>.js` par jeu, avec la même forme que
`pouilleux.js` (`initGame(players)` et une ou plusieurs fonctions `applyXxx(state, ...)`
qui retournent un nouvel état). La colonne `game` dans `game_rooms` permet déjà
de stocker plusieurs types de parties dans la même table. Le lobby pourra
proposer un choix de jeu avant de créer la table.
