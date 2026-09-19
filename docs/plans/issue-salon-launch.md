# Plan : Refonte du lancement de salon — jeu d'abord, bots automatiques, statut témoin

## Objectif
Changer l'ordre de création d'un salon : on choisit le jeu **avant** d'entrer dans la salle d'attente (écran de jaquettes), la salle affiche le nombre de bots nécessaires, les bots se remplissent automatiquement, et tout·e peut se déclarer témoin.

## Réponses aux questions non tranchées

### Trop de joueurs, personne ne se déclare témoin ?
Le premier à rejoindre qui dépasse le max du jeu choisi passe automatiquement en mode spectateur. C'est le mécanisme le moins arbitraire : la file d'entrée décide, pas l'hôte, pas un tirage. On affiche un toast "Tu regardes la partie — rejoins si une place se libère."

### L'hôte change de jeu en cours de route ?
Autorisé. Le sélecteur de jeu est déjà dans la salle d'attente. Le seul garde-fou : si le nouveau jeu a un minPlayers différent, les bots se recalculent. Pas besoin de fermer/recréer.

## Fichiers concernés
- `src/ui/lobby.js` — ajouter l'écran de sélection de jeu (jaquettes)
- `src/ui/game.js` — refondre `renderWaitingRoom` : compteur de bots, toggle témoin
- `src/game/core.js` — ajouter `role` (joueur/témoin) sur les entrées players, logique auto-bot
- `src/game/engine.js` — `createNewRoom(gameId)` accepte un jeu, expose `computeBotCount`
- `src/supabase/sync.js` — `createRoom()` accepte `game` explicite (déjà supporté, vérifier)
- `src/main.js` — `onCreateRoom` passe par l'écran de jaquettes d'abord
- `src/style.css` — styles pour toggle témoin, compteur de bots, jaquettes dans lobby

## Étapes

### 1. Écran de sélection de jeu avant création de salon
- Ajouter `renderGameSelector(container, { onSelect: (gameId) => ... })` dans `lobby.js`
- Réutilise `AVAILABLE_GAMES` + `gameCoverImage()` — mêmes jaquettes que `game-picker` mais en plein écran
- Quand on clique une jaquette : créer le salon **avec ce jeu** (`createNewRoom(gameId)`), rejoindre, entrer
- Le salon listé dans `renderRoomList` affiche le jeu choisi (déjà fait via `row.game`)
- **Modifications**: `lobby.js` (nouvelle fonction), `engine.js` (`createNewRoom` accepte `gameId`), `main.js` (`onCreateRoom` appelle d'abord le sélecteur)

### 2. Salle d'attente : afficher le compteur de bots nécessaires
- Dans `renderWaitingRoom`, afficher en permanence : `X joueurs · Y bots nécessaires pour démarrer`
- `Y = maxPlayersDuJeuChoisi - joueursHumainsActuels + témoins`
- Le compteur se met à jour à chaque changement (join/leave/spectator toggle)
- Ajouter un bouton "Remplir les bots" (une action, pas un par bot) qui ajoute tous les bots manquants d'un coup
- **Modifications**: `game.js` (`renderWaitingRoom`), `core.js` (`computeBotCount`)

### 3. Champ `role` sur les entrées players
- Ajouter `role: 'player' | 'spectator'` sur chaque entrée de `state.players`
- `ensureMembership()` ajoute `role: 'player'` par défaut
- `replaceBotWithPlayer()` préserve le role existant
- **Modifications**: `core.js` (fonctions de membership)

### 4. Toggle témoin dans la salle d'attente
- Chaque joueur voit une case à cocher "Regarder la partie" dans sa ligne
- Cocher = `role: 'spectator'`, décocher = `role: 'player'`
- Le compteur de bots se recalcule à chaque changement
- Si le toggle fait passer sous le minPlayers : message "Impossible : il faut au moins X joueurs"
- L'hôte n'a pas ce toggle (toujours joueur)
- **Modifications**: `game.js` (UI dans `renderWaitingRoom`), `core.js` (update role)

### 5. Remplissage automatique de bots
- Ajouter `state.pendingBots: number` dans l'état du salon (nombre de bots à ajouter)
- Fonction `computePendingBots(state, selectedGameId)` = `max(0, maxPlayers - countHumansNotSpectator(state.players))`
- Quand le compte change (join/leave/toggle), `pendingBots` se met à jour automatiquement
- Bouton "Remplir les bots" → ajoute `pendingBots` bots en boucle (appel séquentiel `addBot`)
- Le bouton "Lancer la partie" compte les bots pending + humains non-spectateurs
- **Modifications**: `core.js` (`computePendingBots`, logique update), `sync.js` (champ `pendingBots` dans state), `game.js` (UI)

### 6. Gestion du surplus de joueurs
- Dans `ensureMembership()`, si `countNonSpectatorHumans > maxPlayers(game)`, le nouveau joueur passe en `role: 'spectator'`
- Toast affiché : "La table est pleine — tu regardes. Rejoins si une place se libère."
- Le compteur de bots se recalcule (le spectateur ne compte plus)
- **Modifications**: `core.js` (`ensureMembership`), `game.js` (toast)

### 7. Changement de jeu par l'hôte
- Le sélecteur de jeu reste dans la salle d'attente (déjà là)
- Quand l'hôte change de jeu : recalculer `pendingBots` pour le nouveau jeu
- Griser les jeux incompatibles avec le nombre actuel d'humains non-spectateurs
- **Modifications**: `game.js` (gestion du changement de jeu)

## Critères de vérification
- [ ] Créer un salon affiche d'abord les jaquettes ; le salon créé a le jeu choisi
- [ ] Le salon apparaît dans la liste avec le nom du jeu
- [ ] La salle d'attente affiche le compteur "X joueurs · Y bots nécessaires"
- [ ] Le compteur se met à jour quand quelqu'un rejoint/quitter/se déclare témoin
- [ ] Le bouton "Remplir les bots" ajoute tous les bots manquants en un clic
- [ ] Tout·e peut cocher/décocher "Regarder la partie"
- [ ] Un témoin ne compte pas dans le décompte des joueurs
- [ ] Si trop de joueurs rejoignent, le surplus passe en spectateur automatiquement
- [ ] L'hôte peut changer de jeu ; les bots se recalculent
- [ ] Build passe (`npm run build`), syntaxe OK (`node --check` sur fichiers modifiés)
