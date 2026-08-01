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

## Comment ça marche

- `src/game/deck.js` et `src/game/pouilleux.js` : logique du jeu, en fonctions
  pures — aucune dépendance à Supabase ni au DOM. C'est le cœur à copier/adapter
  pour ajouter un nouveau jeu.
- `src/supabase/sync.js` : lecture/écriture d'une "room" avec un **verrou optimiste**
  (colonne `version`) pour éviter que deux actions simultanées ne s'écrasent, et
  un abonnement Realtime (`postgres_changes`) pour pousser les mises à jour à
  tous les téléphones connectés.
- `src/game/engine.js` : colle les deux ensemble (créer/rejoindre une table,
  démarrer la partie, jouer un tour) et gère l'identité du joueur en local
  (stockée dans `localStorage`, pas de compte à créer).
- `src/ui/` : rendu DOM simple (pas de framework), un écran = une fonction.

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
ligne Supabase lisible par quiconque a le code de la table. Pour un usage
familial, la friction du code à 4 lettres + l'absence d'exposition publique
suffisent. Si un jour tu veux un vrai "fair-play" (empêcher un joueur curieux
d'inspecter les mains adverses dans les devtools), il faudrait déplacer la
logique de pioche côté serveur (Edge Function Supabase) pour ne renvoyer à
chaque client que sa propre main. Pas fait ici pour garder le MVP simple.

## Étendre à d'autres jeux

L'idée : un module `src/game/<nom-du-jeu>.js` par jeu, avec la même forme que
`pouilleux.js` (`initGame(players)` et une ou plusieurs fonctions `applyXxx(state, ...)`
qui retournent un nouvel état). La colonne `game` dans `game_rooms` permet déjà
de stocker plusieurs types de parties dans la même table. Le lobby pourra
proposer un choix de jeu avant de créer la table.
