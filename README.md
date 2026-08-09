# Cartes en famille

PWA multi-joueurs pour jouer aux cartes à plusieurs, chacun sur son téléphone.
10 jeux disponibles à ce jour (voir *Jeux disponibles* plus bas), pensée pour
en accueillir facilement d'autres (voir *Ajouter un jeu* plus bas).

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
  même rang en quantité égale ou supérieure au pli, sinon on passe. Poser un 8
  **ou un 2** brûle le pli et permet de rejouer immédiatement (le 2 ne peut de
  toute façon jamais être battu). On peut aussi **copier** le rang du pli au
  lieu de le dépasser (ex : 4 → 6 → 6) — dans ce cas seul le joueur **suivant**
  est verrouillé sur ce rang (un seul tour, pas plus) : il doit soit copier à
  son tour (ce qui reverrouille alors la personne d'après, et ainsi de suite
  tant que la chaîne de copies continue), soit passer — et dans ce cas la
  liberté revient totalement à la personne suivante (copier ou dépasser). À la toute première manche,
  les 4 rôles (Président, Vice-Président, Secrétaire, Trou du Cul) sont tirés
  au sort ; ensuite chaque joueur encore présent conserve le rôle qu'il avait à
  la manche précédente — si le groupe a changé entre-temps (quelqu'un est
  parti, quelqu'un d'autre a rejoint), seul le siège laissé vacant est retiré
  au sort parmi les nouveaux venus, sans perturber les rôles de ceux qui
  étaient déjà là. Avant chaque donne : le Trou du Cul donne ses 2 meilleures
  cartes au Président (qui lui rend 2 cartes en retour), et le Secrétaire fait
  de même avec le Vice-Président pour 1 carte. L'ordre de jeu suit toujours les
  rôles dans cet ordre précis — Trou du Cul, Secrétaire, Vice-Président,
  Président — et la disposition des adversaires à l'écran est calculée à
  partir de cet ordre pour que la partie se joue toujours dans le sens des
  aiguilles d'une montre en partant de soi (bas → gauche → haut → droite)
  *(hypothèse — certaines familles font démarrer le Président à la place ;
  à changer dans `initGame`, l'ordre du tableau `turnOrder`, si besoin)*.
- **Le 8 américain** (`src/game/americain.js`) : 2 à 6 joueurs, jeu de 52
  cartes standard (7 chacun jusqu'à 4 joueurs, 5 au-delà). À son tour, on pose
  une carte qui correspond à la couleur ou au rang de la carte au sommet de la
  défausse. Sans coup possible, on pioche une carte dans la pioche (qui se
  reconstitue en mélangeant la défausse si besoin) — la carte piochée n'est
  *pas* rejouable dans la foulée, le tour passe directement au joueur suivant
  *(hypothèse — à ajuster dans `applyDraw` si vous préférez la variante "on
  peut la rejouer aussitôt")*. Premier à vider sa main : gagné, la manche
  s'arrête là (pas de classement complet des autres). Cartes spéciales (sans
  effet sur la toute dernière carte jouée, la partie est déjà gagnée) :
  - **8** : toujours jouable, quelle que soit la situation — choisit la
    nouvelle couleur demandée.
  - **Valet** : inverse le sens du jeu.
  - **2** : le joueur suivant pioche 2 cartes et son tour est sauté.
  - **As** : pioche une carte au hasard dans la main du joueur suivant (comme
    au Pouilleux) — son tour n'est en revanche pas sauté.
- **Blackjack** (`src/game/blackjack.js`) : 1 à 6 joueurs, tous contre la
  banque — **tenue automatiquement par un bot**, ce n'est pas un siège à la
  table (`state.dealer`, distinct de `state.players`). Distribution de 2
  cartes chacun, dont une carte cachée pour la banque. À son tour, chaque
  joueur **tire** ou **reste** ; en cas de dépassement de 21, perdu d'office.
  Une fois tout le monde fixé, la banque révèle sa carte cachée et tire
  automatiquement tant que son total est inférieur à 17 *(hypothèse : pas de
  "peek" — même si la banque a un blackjack naturel caché dès la donne, ça ne
  se révèle qu'à la toute fin comme n'importe quelle autre main ; pas de
  double/split non plus, pour rester simple)*. Chacun démarre avec
  `STARTING_MONEY` (500) et règle sa **propre** mise indépendamment des autres
  (`p.bet`, slider `MIN_BET` 5 à `MAX_BET` 100, pas de 5, `DEFAULT_BET` 25 par
  défaut) — gagné : `+p.bet`, perdu : `-p.bet`, égalité : inchangé. Le solde
  peut devenir négatif : pas d'élimination, seul un retour au lobby le remet
  à zéro (voir plus bas). `setBlackjackBet` (`blackjack.js`) permet à chacun
  d'ajuster sa mise sur l'écran de fin de manche, avant de relancer.
- **Flip 7** (`src/game/flip7.js`) : 2 à 6 joueurs, reconstitution du jeu
  physique du même nom *(hypothèse — décomptes de cartes et bonus approximés
  de mémoire, à ajuster dans `flip7.js` si votre exemplaire diffère)*. À son
  tour, on **flippe** une carte du paquet dans sa main ou on **reste**. Un
  numéro (0-12) déjà en main = perdu pour la manche (0 point), sauf avec une
  carte Seconde Chance en réserve (elle absorbe le doublon une fois). 7
  numéros différents en main = **Flip 7**, la manche s'arrête aussitôt pour
  tout le monde avec un bonus de `FLIP7_BONUS` (15) pour l'auteur. Cartes
  spéciales en plus des numéros : +2/+4/+6/+8/+10 et ×2 (points bonus, ne
  comptent pas comme numéro), Freeze (arrêt immédiat), Flip Three (3 tirages
  forcés d'affilée, résolus automatiquement dans le même appel — peut
  s'enchaîner si un nouveau Flip Three sort pendant la séquence), Seconde
  Chance (sauve d'un doublon, une seule à la fois). Score cumulé sur
  plusieurs manches ; `TARGET_SCORE` (200) atteint = victoire de partie,
  affichée mais n'empêche pas de continuer à jouer si le groupe le souhaite.
- **Skyjo** (`src/game/skyjo.js`) : 2 à 6 joueurs, reconstitution du jeu
  physique du même nom *(hypothèse — décomptes de cartes approximés de
  mémoire, à ajuster dans `skyjo.js` si votre exemplaire diffère)*. Seul jeu
  ici où **moins de points c'est mieux**. Chacun a une grille de 12 cartes
  cachées (3×4), dont 2 révélées au hasard au départ *(choisir manuellement
  lesquelles n'apporterait aucune information puisqu'elles sont inconnues
  avant d'être retournées — simplification volontaire)*. À son tour : prendre
  la défausse (à poser obligatoirement) ou piocher le sabot (à poser, ou à
  défausser en retournant une case cachée à la place). Une colonne dont les 3
  cartes sont face visible et égales est effacée (ne compte plus). Dès qu'une
  grille est entièrement retournée, chacun des autres joue un dernier tour,
  puis tout se révèle : score = somme des cartes encore en jeu, **doublé**
  pour celui qui a terminé en premier s'il n'a pas le score le plus bas de la
  manche. Score cumulé sur plusieurs manches ; `TARGET_SCORE` (100) atteint =
  victoire de partie pour le score cumulé le plus bas.
- **La Suite Infernale** (`src/game/suiteinfernale.js`) : règles officielles
  du jeu physique, **mode individuel uniquement** (2 à 4 joueurs) — le mode
  équipe (4 joueurs 2v2 ou 6 joueurs 3v3, sièges alternés, suites partagées
  entre partenaires) n'est pas implémenté, pour rester dans le modèle "un
  joueur = un siège = un état" du reste de l'appli. But : être le premier à
  compléter, dans sa suite personnelle (`p.sequence`, 10 cases pour les
  valeurs 1 à 10, potentiellement trouées par une attaque adverse), tous les
  nombres de 1 à 10. Chacun a toujours 8 cartes en main ; paquet commun de 65
  cartes numéros (comptes exacts par valeur dans `NUMBER_COUNTS`) et 45
  cartes spéciales (comptes exacts dans `SPECIAL_TYPES`). À son tour :
  **piocher** une carte (obligatoire), puis soit poser une carte numéro/Joker
  +1/Joker +2 dans sa suite, soit jouer "Rejouer 2 coups" (pioche 2, joue 2
  fois), soit jouer une carte ciblant un adversaire (retirer 1/2 carte(s) de
  sa suite, voler la dernière/une carte de sa suite, échanger les mains,
  échanger les places **et les suites** — la suite reste attachée à la
  place à table, pas au joueur, seule la main le suit), soit défausser une
  carte. Les cartes ciblant un
  adversaire ne se résolvent pas immédiatement : elles restent en attente
  (`state.pendingAttack`) le temps que la cible réponde via
  `applyRespondToAttack` — bloque avec une carte STOP (et repioche alors pour
  revenir à 8 cartes), ou laisse l'effet se résoudre. `SEQUENCE_TARGET` (10)
  atteint = victoire immédiate et définitive de la partie ("Continuer" relance
  donc toujours une suite neuve, sans contexte à conserver).
- **Les Cinq Rois** (`src/game/cinqrois.js`) : règles AccessiJeux NFC. 2 à 7
  joueurs. Manches de 3 à 13 cartes ; atout = rang
  égal à la taille de main. Tour : piocher (talon ou défausse) puis
  défausser. Poser toute sa main si suites (≥3 même couleur) et/ou familles
  (≥3 même rang), atouts et jokers wilds. Après un pose, les autres jouent un
  dernier tour puis pénalités. Moins de points après la manche à 13 =
  gagnant.

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
- **8 américain** : joue la première carte légale trouvée en main (garde les 8
  pour la fin si un autre coup est possible), et choisit pour un 8 la couleur
  la plus représentée dans le reste de sa main. Sans coup possible, pioche.
- **Blackjack** : tire tant que son total est inférieur à 17, reste sinon —
  même seuil que la banque, aucune stratégie plus fine (ne tient pas compte de
  la carte visible de la banque). La banque elle-même n'est jamais "un bot
  planifié" : elle joue de façon synchrone et déterministe dès que le dernier
  joueur a fini son tour, pas besoin de lui laisser la main.
- **Flip 7** : flippe tant qu'il a moins de 5 numéros uniques en main, reste
  au-delà — aucune stratégie plus fine (ignore les cartes déjà sorties et son
  score par rapport aux autres).
- **Skyjo** : prend la défausse si elle vaut 3 ou moins, sinon pioche à
  l'aveugle. Remplace sa pire carte visible si la carte en main est
  meilleure ; sinon défausse et retourne une case cachée au hasard (une
  pioche du sabot seulement, jamais une carte de la défausse) ; à défaut de
  case cachée, place quand même sur sa pire carte visible. Aucune
  anticipation plus fine (ignore les cartes déjà vues et les grilles
  adverses).
- **Cinq Rois** : prend la défausse si utile (même rang en main / atout /
  faible pénalité), sinon pioche ; défausse la carte la plus chère ; pose dès
  que possible.

## Comment ça marche

- Au chargement, chaque appareil voit un **écran de salons** : la liste des
  tables actives (jeu, statut, joueurs présents), avec la possibilité d'en
  rejoindre une ou d'en créer une nouvelle (`src/ui/lobby.js`,
  `renderRoomList`). Un salon est juste une ligne `game_rooms` de plus — le
  code aléatoire à 4 caractères généré par `createRoom`
  (`src/supabase/sync.js`) n'a pas besoin d'être tapé ou partagé, la liste
  sert de point d'entrée. Rejoindre un salon dont la partie a déjà démarré
  bascule automatiquement en mode spectateur (lecture seule) plutôt que de
  bloquer.
- Chaque appareil mémorise son prénom dans `localStorage` dès la première visite
  (modifiable à tout moment depuis la modale de réglages ⚙️, en haut à droite de l'écran).
- Modale de réglages (`src/ui/settings.js`) : prénom, couleur du tapis et style des
  cartes (4 thèmes, dont 3 qui n'habillent que les figures Valet/Dame/Roi), tout est
  mémorisé dans `localStorage` et s'applique instantanément via des variables CSS.
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

## Fiabilité en cours de partie : liaison directe (WebRTC)

Le Wi-Fi de la maison ou la 4G d'un téléphone peut devenir instable en
pleine partie (quelqu'un qui bouge, un bascule Wi-Fi ↔ 4G...), ce qui rend
Supabase lent à ces moments-là — un coup joué met du temps à se valider ou
semble ne pas partir. `src/webrtc/relay.js` ajoute une couche de fiabilité
**transparente**, sans aucun mode à choisir :

- Une fois tout le monde dans le lobby, chaque invité établit une liaison
  directe (`RTCPeerConnection`/`RTCDataChannel`) vers l'appareil de l'hôte
  courant (le même `hostId` que celui qui peut lancer la partie — pas de
  rôle séparé à gérer). La signalisation (échange de l'offre/réponse WebRTC
  et des candidats ICE) passe par un canal Supabase Realtime *broadcast*
  éphémère (`webrtc-signal:<roomId>`, ne touche jamais la table
  `game_rooms`), avec un serveur STUN public
  (`stun:stun.l.google.com:19302`) puisque les appareils peuvent être sur
  des réseaux différents (Wi-Fi et 4G en même temps, pas forcément le même
  Wi-Fi).
- Une fois la liaison ouverte, les coups d'un invité (`updateRoomState`)
  partent directement vers l'hôte au lieu de Supabase — l'hôte les applique
  et les persiste dans Supabase pour son compte, puis relaie le nouvel état
  à tous les invités connectés. **Si la liaison n'est pas encore prête, ou
  se coupe : repli automatique et silencieux sur Supabase**, exactement le
  comportement d'avant cette fonctionnalité — jamais pire qu'aujourd'hui.
- L'hôte lui-même ne change pas de comportement : il continue de parler à
  Supabase directement pour ses propres actions, et sert en plus les
  requêtes des invités connectés.
- Petit indicateur "⚡ Connexion directe" (`src/ui/connectionBadge.js`,
  coin supérieur gauche) quand la liaison est active, pour que la famille
  sache que ses coups partent vite.
- Limites assumées : reconnexion par un nouvel appairage (pas de retry
  automatique infini) si la liaison se coupe ou si `hostId` change ; le
  mode équipe/relais multi-sauts n'est pas nécessaire ici, la topologie
  reste toujours en étoile autour de l'hôte du moment.

## Déroulé d'une partie

1. Chacun ouvre l'appli, choisit un salon existant ou en crée un nouveau.
   Dans un salon nouvellement créé, le créateur devient hôte.
   Si l'hôte quitte l'appli sans prévenir (batterie morte, oubli...), la
   première personne qui recharge la page après 2 minutes d'inactivité de
   l'hôte reprend automatiquement la main — pas besoin d'attendre qu'il
   revienne. Ça marche aussi immédiatement si l'hôte est un bot.
2. La salle d'attente affiche la liste des joueurs déjà connectés en temps réel.
3. L'hôte clique sur "Lancer la partie" quand tout le monde est là (pas besoin
   d'attendre exactement 4 joueurs, ça marche dès 2).
4. À la fin d'une manche, n'importe qui peut choisir :
   - **"Continuer"** (`continueGame` dans `engine.js`) : enchaîne directement
     une nouvelle manche du même jeu avec les mêmes joueurs, sans repasser par
     la salle d'attente — et en conservant le contexte propre au jeu (rôles du
     Trou du Cul, argent du Blackjack).
   - **"Retour au lobby"** (`playAgain`) : remet tout le monde en salle
     d'attente avec les mêmes joueurs, et **réinitialise** ce contexte (rôles
     retirés au sort à la prochaine manche, argent remis à `STARTING_MONEY`) —
     pratique pour changer de jeu, ou repartir sur des bases neutres.

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

L'état de chaque salon (y compris les mains de tous ses joueurs) transite par
une ligne Supabase, et la table `game_rooms` entière est lisible par
quiconque connaît (ou devine) l'URL de l'appli — RLS y est intentionnellement
ouverte (`select`/`insert`/`update` avec `using (true)`), la seule vraie
barrière est de ne pas rendre l'URL publique. Suffisant pour un usage
familial derrière une URL non indexée comme `cartes.blavier.one`. L'écran de
liste des salons (`listActiveRooms` dans `src/game/engine.js`) n'affiche que
les prénoms et le statut de chaque salon — jamais les mains — même si la
requête sous-jacente (`listRooms` dans `src/supabase/sync.js`) reçoit
techniquement la colonne `state` complète pour chaque salon listé (au plus
20, triés par activité récente) : ça reste dans le navigateur sans jamais
s'afficher, mais ce n'est pas une vraie barrière de confidentialité, cohérent
avec la note ci-dessus. Si un jour tu veux un vrai "fair-play" (empêcher un
joueur curieux d'inspecter les mains adverses, y compris celles d'un salon
auquel il n'a jamais joué, dans les devtools), il faudrait déplacer la
logique de pioche côté serveur (Edge Function Supabase) et/ou exposer la
liste des salons via une vue Postgres ne projetant que `status`/`players`.
Pas fait ici pour garder le MVP simple.

## Ajouter un jeu

Chaque jeu vit dans **4 fichiers indépendants**, tous découverts dynamiquement
au démarrage (`import.meta.glob`, jamais de liste en dur à maintenir) :

| Fichier | Rôle |
| --- | --- |
| `src/game/<id>.js` | Logique pure : état, règles, `initGame`. Aucune dépendance à Supabase/DOM. |
| `src/game/<id>.bot.js` | IA du bot : quel coup jouer, et quand le jouer tout seul. |
| `src/game/<id>.rules.js` | Texte des règles affiché dans la modale "❓ Règles du jeu". |
| `src/ui/games/<id>.js` | Rendu HTML de la table + branchement des actions (clic/glisser-déposer). |

**Ajouter ces 4 fichiers suffit** pour que le lobby, le registre de bots, le
dispatcher d'écran de jeu (`src/ui/game.js`) et la modale de règles
découvrent le nouveau jeu tout seuls (`import.meta.glob`, aucune liste en dur
à mettre à jour). **Retirer un jeu = supprimer les 4 fichiers** (+
éventuellement son bloc CSS, voir plus bas) — pas de registre central à
purger à la main, y compris pour les actions : chaque `src/game/<id>.js`
déclare et exporte lui-même ses propres fonctions d'action (voir §1) ;
`src/game/engine.js` n'a jamais besoin d'être modifié pour ajouter ou retirer
un jeu.

### 1. `src/game/<id>.js` — logique pure

```js
export const meta = {
  id: 'moncoolgame',                 // doit correspondre au nom de fichier
  label: 'Mon Cool Jeu',             // affiché dans le sélecteur de jeu du lobby
  hint: '2 à 5 joueurs',             // sous-titre affiché sous le label
  minPlayers: 2,
  maxPlayers: 5                      // optionnel — omis = pas de maximum
};

export function initGame(players) {
  // `players` = [{ id, name, isBot, bet? }, ...] (pas encore mélangés — mélanger
  // ici si l'ordre de jeu doit être aléatoire). Retourne le state initial complet :
  // `status` ('playing', ou un statut propre au jeu), `players` (forme enrichie :
  // main, score…), et tout ce dont le jeu a besoin. `hostId` n'a pas besoin d'être
  // inclus : core.js le réinjecte toujours depuis le salon, quoi que retourne initGame.
  return { status: 'playing', currentPlayerId: players[0].id, players: /* ... */[], /* ... */ };
}

export function applyMonAction(state, playerId, /* ... */) {
  // Fonction pure : (state, ...) -> nouveau state. Jamais d'appel réseau ici.
}

// Le "wrapper" d'action que src/ui/games/<id>.js importera et appellera
// depuis ses gestionnaires de clic — un par action possible. `commitGameAction`
// pioche l'état frais, applique la fonction pure et gère le verrou optimiste
// (préférer à `updateRoomState` direct sauf besoin spécifique, voir "Fonctions
// communes à réutiliser" plus bas).
import { commitGameAction } from './core.js';

export async function faireMonAction(room, playerId, /* ... */) {
  return commitGameAction(room, (state) => applyMonAction(state, playerId, /* ... */));
}
```

Optionnel :
- `validatePlayerCount(players)` — pour une contrainte plus fine que
  `minPlayers`/`maxPlayers` (ex. Trou du Cul : exactement 4 joueurs). Si
  présent, remplace entièrement la vérification par défaut.
- `continueRound(room, playersList)` — appelé par "Continuer" en fin de
  manche pour enchaîner sans repasser par le lobby (garde les scores/l'argent
  cumulés). Sans cette fonction, "Continuer" relance `initGame` à zéro.

### 2. `src/game/<id>.bot.js` — IA

```js
import { fetchRoomById, commitGameAction } from './core.js';
import { applyMonAction } from './moncoolgame.js';

export function chooseMove(state, botId) {
  // Fonction pure : retourne le coup à jouer (forme libre, propre au jeu).
}

let scheduled = null;

export function schedule(room) {
  if (room.state.status !== 'playing') return;
  const bot = room.state.players.find((p) => p.id === room.state.currentPlayerId && p.isBot);
  if (!bot) return;

  const signature = `${room.id}:${room.version}`;
  if (scheduled === signature) return; // évite de programmer deux fois le même coup
  scheduled = signature;

  window.setTimeout(async () => {
    try {
      const fresh = await fetchRoomById(room.id);
      if (fresh.state.status !== 'playing' || fresh.state.currentPlayerId !== bot.id) return; // un autre appareil a déjà joué
      const move = chooseMove(fresh.state, bot.id);
      await commitGameAction(fresh, (state) => applyMonAction(state, bot.id, move));
    } catch {
      // Conflit optimiste attendu si un autre appareil a joué en même temps — la resynchro Realtime prend le relais.
    }
  }, 900 + Math.random() * 700); // délai variable : évite un bot qui joue "trop vite" pour paraître humain
}
```

**Règle impérative : un fichier `.bot.js` ne doit JAMAIS importer depuis
`engine.js`.** `engine.js` découvre tous les `src/game/*.js` par glob — s'il
importait en retour un `.bot.js`, ça créerait un cycle d'imports. Toujours
passer par `core.js` (`fetchRoomById`, `updateRoomState`, `commitGameAction`)
et par les fonctions `applyXxx` du fichier logique du même jeu.

### 3. `src/game/<id>.rules.js`

```js
export const title = 'Mon Cool Jeu';
export const html = `<p>But du jeu…</p><ol><li>…</li></ol>`;
```

Aucun import — juste du texte. Affiché tel quel dans la modale de règles.

### 4. `src/ui/games/<id>.js` — rendu + actions

```js
import { faireMonAction } from '../../game/moncoolgame.js';
import { connectionBadge, endGameActionsHtml, wireAbandonButton, abandonButtonLabel, wireEndGameActions } from '../gameShared.js';
import { openRulesModal } from '../rules.js';

export function resetSelection() {
  // Remet à zéro tout état local (sélection de carte en cours, etc.) — appelé
  // par le dispatcher à chaque retour en salle d'attente, pour TOUS les jeux
  // (pas seulement celui qui vient d'être joué), donc toujours sûr même si
  // ce jeu n'a rien à réinitialiser (fonction vide).
}

export function renderTable(container, { room, player, state, onLeave }) {
  // `state.status` gère ici TOUTES ses sous-vues (en cours, échange, fin…) —
  // le dispatcher générique (game.js) ne connaît que "lobby" vs "le reste".
  container.innerHTML = `...`;
  // Écouteurs d'événements, glisser-déposer, etc.
  wireAbandonButton(container, { room, player, state, onLeave });
}
```

Les wrappers d'action s'importent directement depuis `../../game/<id>.js`
(pas depuis `engine.js`) — seules les fonctions vraiment génériques,
partagées entre tous les jeux (`playAgain`, `continueGame`, `ConflictError`),
viennent d'`engine.js`. Ce fichier vit dans `src/ui/games/`, **hors** du
dossier `src/game/` balayé par le glob d'`engine.js` : il peut importer
`engine.js` (ou n'importe quel `src/game/<id>.js`) normalement, sans risque
de cycle (contrairement au `.bot.js`).

### Fonctions communes à réutiliser

Ne jamais dupliquer ce qui existe déjà :

**Côté logique** (`src/game/core.js`) : `fetchRoomById`, `updateRoomState`,
`commitGameAction(room, computeNewState, extraColumns?)` (pioche l'état frais,
applique `computeNewState`, gère le verrou optimiste — préférer à
`updateRoomState` direct dans un `.bot.js`), `ConflictError`.

**Côté UI** (`src/ui/gameShared.js`) : `connectionBadge(state, playerId)`
(badge 🔌 liaison directe), `sortedHand(hand)` (tri classique A→K pour un jeu
de 52), `endGameActionsHtml(opts)` + `wireEndGameActions(container, room)`
(boutons "Continuer"/"Retour au lobby" en fin de manche — `opts.continueBtn`/
`opts.lobby` à `false` pour masquer l'un des deux), `wireAbandonButton` +
`abandonButtonLabel` (bouton abandonner/quitter en pleine partie, commun à
tous les jeux), `vibrate(pattern)`, `getRevealHands`/`toggleRevealHands`/
`resetRevealHands` (état "afficher les mains" partagé par le mode spectateur
et les jeux qui l'utilisent, ex. Pouilleux/Trou du Cul).

Pour les cartes à jouer classiques (52 cartes) : `cardFaceHtml`/`cardBackHtml`
(`src/ui/cards.js`) plutôt que ré-écrire le HTML d'une carte à la main —
gèrent déjà les thèmes illustrés (`src/ui/cardThemes.js`).

### Layout / conventions visuelles

- Racine du rendu : `<div class="screen screen--table <id>-screen">` — la
  classe `<id>-screen` permet un habillage CSS propre au jeu (fond, mise en
  page) sans toucher aux autres. Voir les blocs `.pouilleux-screen`,
  `.trio-screen`, etc. dans `src/style.css` (section "fonds d'écran par
  jeu") : ajouter un bloc pour un nouveau jeu est optionnel, son absence
  retombe simplement sur le fond par défaut.
- Zone adversaires : `.pouilleux-zone.pouilleux-zone--others` (nom historique,
  réutilisé tel quel par la plupart des jeux — pas la peine d'en inventer un
  autre s'il convient).
- Bannière de tour : `.turn-banner` (+ `.turn-banner--you` quand c'est le tour
  du joueur local).
- Main du joueur local : `.my-hand`.
- Bouton règles : toujours `❓ Règles du jeu`, `onclick` → `openRulesModal(room.game)`.

### Checklist pour un nouveau jeu

1. `src/game/<id>.js` : `meta` + `initGame` + `applyXxx(...)` + les wrappers
   d'action (`commitGameAction`/`updateRoomState`, importés depuis `./core.js`).
2. `src/game/<id>.bot.js` : `chooseMove` + `schedule` (jamais d'import d'`engine.js`,
   ni même de `../../game/<id>.js` via `engine.js` — importer directement
   `./core.js` et `./<id>.js`, voir *Règle impérative* ci-dessus).
3. `src/game/<id>.rules.js` : `title` + `html`.
4. `src/ui/games/<id>.js` : `resetSelection` + `renderTable`, en important les
   wrappers d'action depuis `../../game/<id>.js`.
5. (Optionnel) bloc CSS `.screen--table.<id>-screen` dans `src/style.css`.
6. Tester en salle d'attente : le nouveau jeu doit apparaître tout seul dans
   le sélecteur "Quel jeu ?" (trié alphabétiquement, via `AVAILABLE_GAMES`
   exporté par `src/game/engine.js`) — pas besoin de le lister ailleurs, ni
   de toucher `src/game/engine.js` ou `src/ui/game.js`.
