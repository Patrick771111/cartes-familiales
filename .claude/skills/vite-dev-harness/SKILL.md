---
name: vite-dev-harness
description: Teste cartes-familiales avec le vrai serveur de dev Vite et un faux backend Supabase (au lieu de l'approche http.server Python de e2e-regression) — utilisable dès que Node.js est disponible dans l'environnement. Plus rapide et plus fiable que la génération de bundle (pas de réécriture de import.meta.glob), mais quelques pièges Vite/PWA à connaître (voir Pièges connus). Permet aussi de scripter des scénarios précis (plusieurs "joueurs" humains, host qui part, reprise de bot) via import() direct de src/game/engine.js dans la console, sans cliquer dans l'UI.
---

# Harnais de test — vrai Vite + faux Supabase

## Pourquoi cette variante (vs `e2e-regression`)

Le skill `e2e-regression` part du principe que Node.js n'est pas disponible
dans l'environnement et contourne ça avec `http.server` Python + réécriture
des `import.meta.glob(...)`. **Si `node --version` répond dans cet
environnement, préfère ce skill-ci** : sert l'appli avec le vrai `vite dev`
(zéro réécriture de code, zéro risque de "marqueur introuvable" après un
refactor), et permet en plus d'appeler `engine.js` directement depuis la
console du navigateur pour construire des scénarios précis (plusieurs
joueurs humains, départs, reprises...) sans passer par des clics UI.

**Rien de tout ceci n'a vocation à être commité.** `vite.config.js` reçoit
un alias temporaire, à retirer avant tout commit (voir *Nettoyage*).

## Étape 1 — Poser le faux backend

Copier les deux templates de ce skill dans un dossier scratch à la racine
du projet (n'importe quel nom hors `src/`, ex. `.tmp-test/`) :

```bash
mkdir -p .tmp-test
cp .claude/skills/vite-dev-harness/templates/client_fake.js .tmp-test/
cp .claude/skills/vite-dev-harness/templates/sync_fake.js .tmp-test/
```

Puis ajouter l'alias dans `vite.config.js` (garder une copie du fichier
original en tête pour le restaurer ensuite) :

```js
import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  base: '/',
  server: { host: true, port: 5173 },
  resolve: {
    alias: [
      // TEMPORAIRE — harnais de test, à retirer avant commit.
      // Vite matche l'alias sur le SPÉCIFICATEUR LITTÉRAL de l'import, pas
      // le chemin résolu — un `find` par variante réellement utilisée dans
      // le code (voir webrtc/relay.js et game/core.js, les deux seuls
      // importeurs directs de client.js/sync.js).
      { find: '../supabase/client.js', replacement: path.resolve(__dirname, '.tmp-test/client_fake.js') },
      { find: '../supabase/sync.js', replacement: path.resolve(__dirname, '.tmp-test/sync_fake.js') }
    ]
  }
});
```

## Étape 2 — Servir et ouvrir le navigateur

`preview_start` (outil Browser) avec le nom de la config `.claude/launch.json`
existante (`cartes-familiales-dev`), ou directement `npm run dev`. Puis
`navigate` vers `http://localhost:5173/`.

## Pièges connus (rencontrés en construisant ce harnais)

- **Service worker qui sert du contenu périmé** : `main.js` appelle
  `navigator.serviceWorker.register('/sw.js')` à CHAQUE `boot()` — dès
  qu'un premier chargement a eu lieu dans l'onglet, les rechargements
  suivants peuvent être interceptés et servis depuis le cache du SW au lieu
  du réseau, masquant silencieusement toute édition de code faite entre
  temps. Avant tout rechargement de vérification :
  ```js
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  const keys = await caches.keys();
  for (const k of keys) await caches.delete(k);
  ```
- **Cache de transformation Vite** : même après avoir écarté le SW, une
  page déjà chargée AVANT une édition de fichier peut continuer à exécuter
  l'ancien module (le `<script type="module">` ne se re-résout pas tout
  seul). Un `fetch('/src/...?bust=' + Date.now())` permet de vérifier que
  le FICHIER SERVI est à jour ; si le comportement observé dans la page ne
  correspond toujours pas, ne pas chercher plus loin : `preview_stop` puis
  `preview_start` (redémarrage complet du serveur Vite), puis `navigate`
  avec `force: true`. C'est le seul fix fiable rencontré cette session.
- **`vite.config.js` modifié pendant qu'un serveur tourne** : redémarrer
  aussi (le process a la config en mémoire depuis son lancement).
- **Deux onglets du même navigateur = même `localStorage`** : impossible de
  simuler "2 appareils différents" avec deux onglets sur la même origine.
  Pour tester un scénario multi-joueurs (ex. l'hôte part, un autre humain
  prend le relais), soit (a) construire l'état directement via
  `import('/src/game/engine.js')` (voir *Scénarios scriptés* plus bas) sans
  jamais passer par de vrais "onglets-joueurs", soit (b) swapper la clé
  `cartes-familiales:profile` dans `localStorage` entre deux rechargements
  successifs du même onglet pour incarner tour à tour chaque joueur.
- **`storage` event ne se déclenche pas dans l'onglet qui écrit** : le
  `sync_fake.js` fourni ici a un pub-sub interne en plus (`localSubscribers`)
  pour que les actions faites dans CE MÊME onglet redéclenchent bien un
  re-render (`draw()` dans `main.js`) — sans ça, cliquer "Ajouter un bot"
  ou "Lancer" ne semble avoir aucun effet tant qu'aucune autre source ne
  déclenche un re-render.
- **Le faux backend est en `localStorage`, pas en mémoire pure** : condition
  nécessaire pour tester tout ce qui dépend d'un VRAI rechargement de page
  (ex. `main.js:boot()` et la reprise automatique de salon) — un simple
  `Map` de module serait réinitialisé à chaque `navigate`.

## Scénarios scriptés (sans cliquer dans l'UI)

Importer `engine.js` directement dans la page pour construire un état
précis (plusieurs joueurs humains, un hôte qui part, etc.) :

```js
import('/src/game/engine.js').then(m => { window.__engine = m; });
```

`window.__engine` expose alors `createNewRoom`, `ensureMembership`,
`startGame`, `leaveTable`, `findMyRoom`, etc. — les mêmes fonctions que
l'UI appelle, donc un test fidèle au comportement réel sans dépendre du
DOM. Exemple (hôte qui quitte en pleine partie, vérifie qu'un nouvel hôte
humain prend le relais plutôt que de fermer le salon) :

```js
(async () => {
  const E = window.__engine;
  const alice = { id: 'alice-1', name: 'Alice' };
  const bob = { id: 'bob-1', name: 'Bob' };
  let room = await E.createNewRoom('pouilleux');
  room = await E.ensureMembership(room, alice); // devient hôte
  room = await E.ensureMembership(room, bob);
  room = await E.startGame(room, 'pouilleux');
  const after = await E.leaveTable(room, alice);
  console.log(after.state.hostId, after.state.players.map(p => p.name));
})();
```

Pour inspecter le faux backend directement : `localStorage.getItem('cartes-familiales:fake-rooms')`.

## Nettoyage (obligatoire avant tout commit)

```bash
rm -rf .tmp-test
git checkout -- vite.config.js   # ou ré-écrire le contenu d'origine à la main
git status --short   # ne doit montrer aucun fichier lié au harnais
```

Puis arrêter le serveur de preview (`preview_stop`).
