# Architecture (pour Claude / qwen — pas un guide utilisateur)

À lire avant d'explorer le dépôt pour un triage ou un plan.

## Stack
Vite + JS vanilla (pas de framework), Supabase (Postgres + Realtime) pour l'état de partie partagé entre téléphones, PWA (service worker fait main).

## Déploiement
Site en prod : **`https://cartes.blavier.one`**, **Cloudflare Workers** (config `wrangler.jsonc`, sert `dist/` en assets statiques) avec **déploiement automatique** sur push vers `main` (confirmé le 2026-09-16 : un correctif poussé était visible en ligne moins d'une minute après — à ne pas confondre avec un simple hébergement statique à déployer à la main, hypothèse fausse un temps retenue avant vérification). Donc :
- `npm run build` + push suffit ; rien à faire côté Cloudflare.
- **Corollaire important** (identique à repas-malin) : un push cassé ou dangereux sur `main` est immédiatement live sur l'appli que la famille utilise activement. Toujours valider (`npm run build`, `node --check` sur les fichiers modifiés) avant de pousser un changement touchant `src/` ou `public/`.
- Pas de workflow GitHub Actions de déploiement (seuls `claude-code.yml`/`local.yml` existent, pour le triage/l'exécution qwen) : le déploiement passe entièrement par l'intégration Git de Cloudflare, invisible depuis ce dépôt — **avant d'affirmer qu'un dépôt n'a pas d'auto-déploiement, vérifier le site en ligne directement** (`fetch` sur son `sw.js`/bundle après un push) plutôt que de déduire ça de l'absence de fichiers de config ou de workflow dans le dépôt.

## Où vivent les choses
- `src/main.js` — point d'entrée, boot de l'appli (~450 lignes).
- `src/game/<jeu>.js` + `<jeu>.rules.js` + `<jeu>.bot.js` — un jeu = ces 3 fichiers (logique, règles, IA). `src/game/engine.js`/`core.js`/`deck.js` sont transverses à tous les jeux.
- `src/ui/` — affichage/interaction (un fichier par préoccupation : `cards.js`, `lobby.js`, `settings.js`, etc., pas par jeu).
- `src/three/<jeu>Scene.js` — rendu 3D (Three.js) pour les jeux qui en ont un.
- `src/supabase/sync.js` — synchronisation de l'état de partie (table `game_rooms`) ; `client.js` — connexion ; `versionGuard.js` — garde-fou de version à l'écriture (voir ci-dessous).
- `src/webrtc/relay.js` — communication directe entre joueurs (hors état persistant), retombe sur `sync.js` comme "backingStore" y compris en mode relais.
- `src/style.css` — **4782 lignes, un seul fichier pour tout le CSS**.

## Garde-fou de version à l'écriture (Supabase)
Écrit-on avec du code périmé ? `updateRoomState`/`createRoom`/`getOrCreateRoomByCode` (`sync.js`) appellent `verifierVersion()` avant d'écrire : compare la version déployée (lue en direct dans `public/sw.js` — `CACHE_NAME`, source de vérité unique, jamais dupliquée) à celle chargée au démarrage de l'onglet (`capturerVersionChargee()`, appelé dans `main.js`). Mismatch → lève `ConflictError` (réutilise le type existant, pas un nouveau — tous les appelants savent déjà le gérer via `commitGameAction`/les boucles de nouvelle tentative). Best-effort : un échec de la vérification elle-même (réseau) ne bloque jamais l'écriture, seul un vrai mismatch le fait. Désactivé en dev (`import.meta.env.PROD`).

Même principe que sur repas-malin (voir son `ARCHITECTURE.md`, incident du 2026-09-16) : un onglet resté ouvert depuis avant un déploiement ne doit jamais pouvoir écrire avec de la logique périmée. Ici le risque est structurellement plus faible (verrou optimiste par `version` déjà en place, donc pas de risque d'écraser silencieusement une donnée plus récente), mais le garde-fou reste utile contre une logique de jeu buguée qui pousserait un état invalide avec un incrément de version par ailleurs valide. **`deleteRoom` n'est pas gardé** (ne pousse pas d'état, juste une suppression) — pas la peine d'y ajouter de friction.

**Conséquence pour tout futur déploiement** : incrémenter `CACHE_NAME` dans `public/sw.js` à chaque changement de comportement (pas juste pour le service worker : le garde-fou de version en dépend directement).

## Pièges connus
- `src/style.css` dépasse la fenêtre de contexte de qwen (32k tokens) même isolé, avec repli gemma4-64k inclus (observé : réponse vide malgré `--map-tokens 0`). Toute tâche CSS doit cibler une plage précise (nom de règle/sélecteur à chercher), jamais une lecture/réécriture du fichier entier — et si l'étape échoue quand même, `VERDICT: IMPLEMENTE` plutôt que de réessayer en boucle.
- Ajouter un jeu = ajouter les 3 fichiers `src/game/<jeu>{,.rules,.bot}.js` + une scène `src/three/<jeu>Scene.js` si rendu 3D + entrée dans `src/ui/gameCovers.js`/`games/` — voir un jeu existant similaire comme modèle plutôt que de partir de zéro.
- Pas de état serveur custom : tout l'état partagé passe par la table Supabase `game_rooms` (Realtime), pas de fichier de session côté client à chercher.

## Mise à jour
Toute découverte structurante pendant un triage/plan (nouvelle convention, nouveau piège, fichier qui grossit trop) s'ajoute ici par Claude — pas seulement dans la réponse à l'issue.
