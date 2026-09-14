# Architecture (pour Claude / qwen — pas un guide utilisateur)

À lire avant d'explorer le dépôt pour un triage ou un plan.

## Stack
Vite + JS vanilla (pas de framework), Supabase (Postgres + Realtime) pour l'état de partie partagé entre téléphones, PWA (service worker fait main).

## Où vivent les choses
- `src/main.js` — point d'entrée, boot de l'appli (~450 lignes).
- `src/game/<jeu>.js` + `<jeu>.rules.js` + `<jeu>.bot.js` — un jeu = ces 3 fichiers (logique, règles, IA). `src/game/engine.js`/`core.js`/`deck.js` sont transverses à tous les jeux.
- `src/ui/` — affichage/interaction (un fichier par préoccupation : `cards.js`, `lobby.js`, `settings.js`, etc., pas par jeu).
- `src/three/<jeu>Scene.js` — rendu 3D (Three.js) pour les jeux qui en ont un.
- `src/supabase/sync.js` — synchronisation de l'état de partie (table `game_rooms`) ; `client.js` — connexion.
- `src/webrtc/relay.js` — communication directe entre joueurs (hors état persistant).
- `src/style.css` — **4782 lignes, un seul fichier pour tout le CSS**.

## Pièges connus
- `src/style.css` dépasse la fenêtre de contexte de qwen (32k tokens) même isolé, avec repli gemma4-64k inclus (observé : réponse vide malgré `--map-tokens 0`). Toute tâche CSS doit cibler une plage précise (nom de règle/sélecteur à chercher), jamais une lecture/réécriture du fichier entier — et si l'étape échoue quand même, `VERDICT: IMPLEMENTE` plutôt que de réessayer en boucle.
- Ajouter un jeu = ajouter les 3 fichiers `src/game/<jeu>{,.rules,.bot}.js` + une scène `src/three/<jeu>Scene.js` si rendu 3D + entrée dans `src/ui/gameCovers.js`/`games/` — voir un jeu existant similaire comme modèle plutôt que de partir de zéro.
- Pas de état serveur custom : tout l'état partagé passe par la table Supabase `game_rooms` (Realtime), pas de fichier de session côté client à chercher.

## Mise à jour
Toute découverte structurante pendant un triage/plan (nouvelle convention, nouveau piège, fichier qui grossit trop) s'ajoute ici par Claude — pas seulement dans la réponse à l'issue.
