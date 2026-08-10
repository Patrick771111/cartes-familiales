---
name: e2e-regression
description: Vérification E2E des 10 jeux de cartes-familiales dans un navigateur, sans Node/Vite — génère un bundle de test (glob Vite remplacés par des imports littéraux), sert l'appli via un http.server Python, et parcourt chaque jeu (lancement, rendu, une action réelle) en pilotant le navigateur. À utiliser après toute modification touchant engine.js/core.js, un fichier src/game/<id>.js, src/ui/game.js, src/ui/gameShared.js, ou plusieurs fichiers src/ui/games/<id>.js — avant de committer.
---

# Tests de non-régression E2E — cartes-familiales

## Pourquoi ce skill existe

Cet environnement de dev n'a pas Node.js — impossible de lancer `npm run
dev` (Vite) pour tester réellement l'appli. Le contournement établi :
remplacer chaque `import.meta.glob(...)` (fonctionnalité Vite, invalide dans
un `<script type="module">` de navigateur nu) par des imports littéraux
générés à partir du contenu réel des dossiers, puis servir le tout avec
`python -m http.server` et piloter un vrai navigateur dessus. Ce skill
encapsule ce contournement pour ne plus avoir à le reconstruire à la main
à chaque fois (risque d'oublier un repointage, cf. l'historique de bugs
"marqueur introuvable" rencontrés en construisant cette approche).

**Rien de tout ceci n'a vocation à être commité.** Tous les fichiers générés
commencent par `_test_` (ou sont `_test_e2e.html`) — toujours nettoyés en
fin de vérification (voir *Nettoyage* plus bas), jamais laissés dans
l'arbre au moment d'un commit.

## Étape 1 — Générer le bundle de test

```bash
python .claude/skills/e2e-regression/scripts/gen_test_bundle.py
```

Génère, à côté des fichiers réels (jamais à leur place) :
- `src/game/_test_<id>.js`, `_test_<id>.bot.js`, `_test_core_copy.js`,
  `_test_engine_copy.js` (tous les fichiers `src/game/*.js` détectés
  dynamiquement — zéro maintenance si un jeu est ajouté/retiré).
- `src/ui/games/_test_<id>.js`, `src/ui/_test_game_copy.js`,
  `_test_gameShared_copy.js`, `_test_rules_copy.js`, `_test_cards_copy.js`,
  `_test_cardThemes_copy.js`, `_test_settings_copy.js`,
  `_test_lobby_copy.js`.
- `src/webrtc/_test_relay_copy.js`.
- `src/supabase/_test_client_fake.js` + `_test_sync_fake.js` — backend
  Supabase simulé en mémoire (Map de salons, verrou optimiste par
  `version`, `subscribeRoom` fonctionnel) avec deux aides exposées côté
  page de test : `__reset()` et `__dump()`.
- `src/_test_main_copy.js`.
- `_test_e2e.html` — page d'entrée, expose `window.__sync` (le fake
  ci-dessus) pour manipuler l'état des salons directement depuis la console
  du navigateur (voir *Astuces* plus bas).

Le script échoue bruyamment (`assert`) si un marqueur `import.meta.glob(...)`
attendu ne correspond plus au contenu réel d'un fichier (ex. la ligne a
changé de forme après un refactor) — c'est le signal qu'il faut adapter le
script, pas l'ignorer.

## Étape 2 — Servir et ouvrir le navigateur

```bash
python -m http.server <PORT> --bind 127.0.0.1
```

**Toujours un port inédit à chaque session de test** (ex. incrémenter à
partir de 8800) — le navigateur met les modules ES en cache par URL, un port
réutilisé après régénération du bundle peut servir une ancienne version
sans erreur visible. `127.0.0.1`, pas `localhost` (évite certains
comportements de cache différents selon l'environnement).

Puis `preview_start` / `navigate` (outils Browser) vers
`http://127.0.0.1:<PORT>/_test_e2e.html`.

## Étape 3 — Parcours de vérification

Séquence JS à exécuter via l'outil `javascript_tool` du navigateur (une
page fraîchement chargée à chaque fois — le fake backend est en mémoire de
page, perdu au reload) :

```js
// 1) Prénom + création de salon + bots (6 joueurs couvre tous les jeux sauf
//    ceux à effectif max <6 : suiteinfernale/luckynumbers (max 4) et trouduc
//    (exactement 4) — kicker via .player-list__kick pour redescendre à 4).
const el = document.querySelector('#name-input');
el.value = 'TestE2E';
el.dispatchEvent(new Event('input', { bubbles: true }));
document.querySelector('#form-name').requestSubmit();
await new Promise(r => setTimeout(r, 300));
document.querySelector('#btn-create-room').click();
await new Promise(r => setTimeout(r, 400));
for (let i = 0; i < 5; i++) {
  document.querySelector('#btn-add-bot')?.click();
  await new Promise(r => setTimeout(r, 150));
}

// 2) Lancer un jeu précis
const radio = document.querySelector('input[name="game"][value="<id>"]');
radio.checked = true;
radio.dispatchEvent(new Event('change', { bubbles: true }));
document.querySelector('#btn-start').click();
```

Après chaque lancement : `get_page_text` (le rendu doit correspondre à ce
qui est attendu — noms des adversaires, main, boutons) et
`read_console_messages({ onlyErrors: true })` — **seul le 404 de `/sw.js`
est attendu** (service worker absent en test, catché par `main.js`), toute
autre erreur est un vrai régression à investiguer avant de continuer.

Tester ensuite une action réelle représentative (pas juste le rendu) :
cliquer l'élément de pioche/action principal, revérifier `get_page_text` et
la console. Exemples déjà éprouvés par jeu : `#btn-draw` (pouilleux via
`[data-pick-index]`, suiteinfernale, americain), `#btn-draw-deck` (skyjo),
`#btn-lucky-draw` (luckynumbers), `#cinqrois-stock` (cinqrois, nécessite un
`PointerEvent('pointerdown')`+`pointerup` car ce n'est pas un `<button>`),
`#btn-hit`/`#btn-stand` (blackjack/flip7), `[data-center-id]`/
`[data-row-target]` (trio).

**Retour au lobby entre deux jeux** : ne pas passer par `#btn-abandon`
(déclenche `window.confirm`, à stubber) pour un simple changement de jeu de
test — plus rapide et plus sûr d'écrire directement l'état via
`window.__sync` :

```js
const rooms = window.__sync.__dump();
const room = rooms[0];
const resetState = {
  status: 'lobby',
  players: room.state.players.map(p => ({ id: p.id, name: p.name, isBot: p.isBot, lastSeen: Date.now() })),
  hostId: room.state.hostId,
  hostLastSeen: Date.now(),
  roomName: room.state.roomName,
  roomEmoji: room.state.roomEmoji
};
await window.__sync.updateRoomState(room.id, room.version, resetState, { game: 'pouilleux' });
```

## Étape 4 — Nettoyage (obligatoire avant tout commit)

```bash
rm -f src/ui/games/_test_*.js src/game/_test_*.js src/ui/_test_*.js \
      src/webrtc/_test_*.js src/_test_*.js src/supabase/_test_*.js \
      _test_e2e.html
git status --short   # doit ne montrer AUCUN fichier _test_*
```

Puis arrêter le(s) serveur(s) `http.server` lancés (`pkill -f "http.server"`
ou cibler le port précis).

## Aller plus vite / paralléliser sur de futures livraisons

- **Un seul jeu à revérifier après une modification ciblée** : sauter
  directement à l'étape 3 pour ce jeu uniquement — pas besoin de repasser
  par les 10.
- **Beaucoup de jeux touchés à la fois** (ex. un changement dans
  `gameShared.js` ou `core.js`, comme documenté dans README.md) : chaque
  vérification de jeu ne dépend que de son propre onglet navigateur + son
  port de serveur — répartissable sur plusieurs agents `Agent` (type
  `general-purpose`) lancés **en parallèle dans un seul message** (voir la
  doc de l'outil Agent), chacun avec :
  1. son propre port `http.server` (ex. agent 1 → 8801, agent 2 → 8802...),
  2. sa propre régénération du bundle (rapide, quelques centaines de ms —
     pas besoin de la partager entre agents),
  3. un sous-ensemble de jeux à couvrir (ex. 3-4 jeux chacun),
  4. son propre nettoyage en fin de tâche (chaque agent supprime SES fichiers
     `_test_*` — comme ils portent tous les mêmes noms, ne jamais faire
     tourner deux agents dans le même repo/checkout en même temps sans
     coordination ; utiliser `isolation: "worktree"` sur l'Agent pour un
     vrai parallélisme sans collision de fichiers).
  Chaque agent doit recevoir ce fichier SKILL.md (ou son chemin) dans son
  prompt, plus la liste précise des jeux qui lui sont assignés — un sous-
  agent frais n'a aucun contexte de la conversation en cours.
- Ne jamais paralléliser sur le **même** répertoire de travail sans
  worktree : les fichiers `_test_*` généré par un agent seraient écrasés ou
  supprimés par le nettoyage d'un autre.
