# Consignes Claude Code

## Cycle de vie
1. Triage (Claude, auto) → `VERDICT: SIMPLE` / `COMPLEXE` / `IMPLEMENTE`
2. Plan (Claude, si COMPLEXE) → étapes décrivant l'intention
3. Validation humaine (`@local go`) — seul point d'arbitrage réel
4. Exécution (OpenCode + qwen3.6, en conteneur) → le plan entier en une passe, **un seul commit**
5. Revue finale (gemma4, autre famille que le codeur) : diff complet contre les critères de vérification du plan
6. Non-régression : syntaxe, build, et test navigateur headless quand le projet en déclare un
7. Échec à l'une de ces étapes → rien n'est publié, Claude re-diagnostique sur l'issue
8. PR ouverte → merge = validation humaine finale

## Capacités du moteur local
- **`qwen3.6-coder`** — MoE de 35 milliards de paramètres dont 3 actifs. Agent de code complet : il lit le dépôt, trouve ses fichiers et enchaîne ses éditions. **Texte et image.** Environ 52 tokens/s en génération, 565 en lecture de contexte.
- **Fenêtre servie : 32k tokens.** Le modèle en supporte 256k, mais la VRAM disponible borne le service à 32k. C'est la seule limite dure à considérer au triage.
- **`gemma4-reviewer`** — relecteur uniquement, jamais codeur : autre famille que le codeur, pour que la seconde opinion ne partage pas ses angles morts.
- Un seul modèle réside à la fois sur les 12 Go de VRAM ; llama-swap échange en une quinzaine de secondes. Sans conséquence ici : le codeur travaille, puis le relecteur relit.
- **Aucun repli de modèle.** Si l'exécution échoue, elle échoue et Claude re-diagnostique sur l'issue.

Conséquences pour le triage/plan :
- Contexte utile au-delà de 32k (fichier énorme, refonte touchant tout le dépôt) → `VERDICT: IMPLEMENTE`, ne jamais déléguer.
- Génération d'image → aucun moteur ne sait le faire → `VERDICT: IMPLEMENTE`, fournir le(s) prompt(s) prêts à coller dans Grok Imagine (ou l'outil préféré de l'utilisateur).
- **Lecture** d'image (capture d'écran, maquette) → la voie locale sait faire ; ce n'est plus un motif d'exclusion ni un choix de modèle à préciser.

## Triage
Invoqué auto à l'ouverture de toute issue (sauf `@local go` déjà dans le corps) et sur tout `@claude` en commentaire.

Commence **toujours** par une ligne seule, exacte, sans gras ni puce :
```
VERDICT: SIMPLE
```
(ou `COMPLEXE`, ou `IMPLEMENTE`) — lue par le workflow pour router la suite.

- **SIMPLE** = l'objectif est clair, il ne reste qu'à l'exécuter. Cela inclut **plusieurs fichiers**, une fonction utilisée à plusieurs endroits, un renommage transverse, des tests, une dépendance, de la configuration. L'agent local explore le dépôt seul : lui désigner les fichiers n'est plus nécessaire. Une phrase d'explication ; **aucun fichier touché, aucun plan**. Renvoi auto vers la voie locale.
- **COMPLEXE** = il reste une **décision** à prendre. Conception, arbitrage entre options, ambiguïté que seul l'utilisateur peut lever, ou risque de régression qui demande un jugement. Écris un plan (format ci-dessous), committe-le dans `docs/plans/issue-<n>.md`, poste-le en entier après le VERDICT. Aucun code, aucune PR de ta part.
- **IMPLEMENTE** = hors de portée de la voie locale : contexte utile au-delà de 32k, ou génération d'image. Implémente toi-même, **vérifie toi-même** (`node --check` sur les `.js` modifiés, `npm run build` si `package.json` le déclare — ces commandes te sont explicitement autorisées, voir Infra), committe, ouvre la PR (règles de restitution plus bas) ; explique en une phrase pourquoi la voie locale ne convenait pas.

**Où passe la frontière, et pourquoi.** Elle a bougé le 19/09/2026 : la voie locale exécute désormais un plan entier avec un agent qui lit le dépôt et enchaîne ses éditions. « Plusieurs fichiers » n'est donc plus un motif de COMPLEXE. Ce qui justifie de dépenser du quota d'abonnement, c'est le **jugement** — pas le découpage en étapes, pas la recherche des fichiers à modifier. Dans le doute, SIMPLE : un échec local coûte un re-diagnostic, un COMPLEXE inutile coûte du quota à chaque fois.

## Format du plan
```
# Plan : <titre bref>

## Objectif
[résultat attendu, langage fonctionnel]

## Fichiers concernés
- chemin/fichier — ce qui change

## Étapes
1. instruction précise, dans l'ordre logique
2. instruction précise, dans l'ordre logique

## Critères de vérification
- comment on sait que c'est correct
```

Règles :
- **Décris l'intention, pas la mécanique.** L'agent lit le dépôt et trouve les fichiers seul. Nommer un fichier reste utile quand la cible est ambiguë, mais ce n'est plus obligatoire ni un format imposé.
- **Une étape peut s'appuyer sur la précédente** : l'agent voit tout le plan et son propre travail au fur et à mesure. Inutile de répéter l'information d'une étape à l'autre.
- Décris **quoi/où** (sélecteur, fonction, valeur) — jamais le code final à recopier : ça gonfle le contexte pour rien.
- Les `## Critères de vérification` alimentent la revue finale : ils doivent être vérifiables, pas décoratifs.

## Exécution (qwen, déclenchée par `@local go`)
- Source de la consigne, dans l'ordre : `docs/plans/issue-<n>.md` sur la branche par défaut → branche `claude/issue-<n>-*` (non fusionnée) → dernier commentaire « Plan complet » (repli si le push du plan a échoué) → corps brut de l'issue.
- OpenCode exécute le plan entier dans un conteneur, avec sa propre boucle d'agent : il lit les fichiers dont il a besoin, enchaîne ses éditions et s'arrête quand il a fini. Un seul commit en sortie, donc une PR lisible.
- **Revue finale** par `gemma4-reviewer`, d'une autre famille que le codeur : il relit le diff complet contre les `## Critères de vérification` du plan et répond OUI/NON. NON → traité comme un échec, rien n'est publié.
- Avant toute PR : `node --check` sur les `.js` modifiés + `npm run build` si `package.json` le déclare. Échec → **rien n'est publié**, le code reste local au runner.
- **Test navigateur headless (Playwright)** : sert le résultat (`npm run preview` si `package.json` en déclare un ; sinon `index.html` servi tel quel, à la racine ou dans un sous-dossier connu — voir ARCHITECTURE.md), ouvre la page dans Chromium headless (conteneur `mcr.microsoft.com/playwright`), vérifie qu'elle répond en HTTP OK, affiche du texte visible, et ne produit aucune erreur console/JS. Générique — ne connaît rien du contenu métier, c'est un filet minimal (« la page n'est pas blanche/cassée »), pas un test de la fonctionnalité livrée. Sauté (pas un échec) seulement si aucun de ces deux mécanismes n'est détectable.
- Échec (aucun changement, exécution en erreur, revue finale KO, non-régression KO, ou test navigateur KO) → **Claude auto-invoqué** avec le diagnostic complet ; rien à redemander.

## Analyser un échec
Invoqué avec un diagnostic en pièce jointe : comprendre la vraie cause avant d'agir, pas retrier par réflexe.
- **« OpenCode n'a modifié aucun fichier »** → le plan était trop vague pour que l'agent sache quoi faire, ou il a jugé le travail déjà fait. Le log joint dit lequel : il explique ce qu'il a lu et pourquoi il s'est arrêté. Remède : plan plus précis, pas plus découpé.
- **« OpenCode s'est arrêté en erreur (code N) »** → panne technique, pas ambiguïté. Lire le log avant toute reformulation du plan.
- **Revue finale KO** (gemma4 a répondu NON) → le diff ne satisfait pas les `## Critères de vérification`. Vérifier d'abord que les critères étaient vérifiables : un critère décoratif produit un faux négatif.
- **Non-régression KO** (syntaxe, build) ou **test navigateur KO** → le code produit est cassé. Diagnostic technique direct, sans repasser par le plan.
- Contexte structurellement trop gros pour la fenêtre de 32k → `VERDICT: IMPLEMENTE`.
- Un commentaire commençant par `VERDICT: INFRA` signale que le moteur d'inférence était injoignable. Ce n'est pas un échec de la tâche : il n'y a rien à rediagnostiquer, il faut relancer `@local go` une fois le gamer disponible.
- Rejet en revue finale (diff complet ne satisfait pas les critères de vérification) → un ou plusieurs critères n'étaient pas couverts par les étapes → plan corrigé pour les couvrir explicitement.
- Build/syntaxe cassé → corriger l'étape en cause, ou `VERDICT: IMPLEMENTE` si le problème est structurel.
- Test navigateur KO (page blanche, erreur console, statut HTTP anormal) → souvent une variable d'environnement manquante au runtime (voir Infra) plutôt qu'un bug de code — vérifier ça avant de rerédiger le plan.

Rends un nouveau `VERDICT:` comme un triage normal.

## Style de code
- Pas de verbosité : commentaires seulement si le pourquoi n'est pas déjà évident dans le code (jamais pour redire ce que fait une ligne).
- Petits fichiers plutôt qu'un gros fichier qui grossit indéfiniment (ex. le problème vécu sur `data_recettes.js`, 108k lignes, illisible pour tout modèle local) — préférer scinder tôt (par domaine, par vue) plutôt que corriger après coup.
- Ne pas tout relire à chaque tâche : cibler le fichier concerné (voir `ARCHITECTURE.md`, section suivante) plutôt que parcourir l'ensemble du dépôt par réflexe.

## Restitution (PR, commits, commentaires)
- Français partout.
- Résumé fonctionnel (point de vue utilisateur) — jamais de diff ni de liste de fichiers modifiés.
```
## Résumé
[une phrase]

## Exemple d'usage
[si pertinent]

## Cas testés
[bref]
```

## Déclenchement
- Issue ouverte sans `@local go` → triage auto.
- `@claude` en commentaire → dialogue de suivi.
- `@local go` (commentaire, ou corps d'issue à l'ouverture) → exécution directe, sans passer par Claude.
- **Anti-boucle** : tout déclenchement ignore les commentaires **commençant** par `VERDICT:` (= commentaires de Claude lui-même) — sinon une phrase explicative mentionnant `@local go` ou `@claude` se déclencherait toute seule. Test en `startsWith`, pas `contains` : un diagnostic d'échec auto-posté peut mentionner `VERDICT: IMPLEMENTE` au milieu de son texte sans être un commentaire de Claude — `contains()` l'exclurait à tort et bloquerait l'auto-invocation de Claude sur l'échec (bug vécu sur l'issue #25).
- Le routage auto (`@local go` posté après un verdict SIMPLE) utilise le secret `TRIAGE_TOKEN`, pas le token GitHub par défaut (qui ne relance jamais de workflow).

## Documentation technique (`ARCHITECTURE.md`)
Avant d'explorer le dépôt pour un triage ou un plan, **lire `ARCHITECTURE.md` à la racine** (s'il existe) plutôt que de parcourir les fichiers au hasard : il liste où vivent les choses (state, stockage, découpage des vues), les pièges connus (fichiers énormes, doublons de source de vérité), et les décisions déjà prises pour ne pas les rejouer à chaque tâche.
- Tenu à jour par Claude : toute découverte structurante pendant un triage/plan (ex. « telle donnée est en base, pas dans tel fichier ») s'ajoute là, pas seulement dans la réponse à l'issue — sinon elle est reperdue à la tâche suivante.
- Reste court et factuel (pas de narration) : une liste de faits, pas un tutoriel. Un fichier qui dépasse une page mérite d'être scindé par domaine (ex. `ARCHITECTURE.md` + section dédiée si un domaine grossit trop).
- Ne remplace pas un `README.md` utilisateur : `ARCHITECTURE.md` s'adresse aux moteurs qui codent, pas aux humains qui installent l'appli.

## Infra
- `claude-code.yml` : `ubuntu-latest`, aucun accès réseau local requis. Node/npm déjà présents sur ce runner ; `node --check`, `npm install`, `npm run build` explicitement autorisés (`--allowedTools`) pour que tu puisses vérifier ton propre code en `VERDICT: IMPLEMENTE`.
- `local.yml` : `[self-hosted, local]` (hubert) → inférence llama.cpp/llama-swap sur gamer (`llm.lan:8080`, endpoint OpenAI-compatible ; Ollama sur 11434 ne sert plus que Hermes), Docker/OpenCode, Node.js (`~/.hermes/node/bin`, déjà dans le PATH du runner).
- **Test navigateur** : image `mcr.microsoft.com/playwright:v1.49.1-jammy` (navigateurs préinstallés, `playwright-core` installé à la volée dans le conteneur — voir local.yml). Secrets `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` écrits dans `.env` avant le build de CI (clé publique "publishable", déjà exposée dans le bundle JS du site déployé — sans eux l'appli échoue silencieusement au chargement, faute de pouvoir initialiser Supabase).
- `CLAUDE_CODE_OAUTH_TOKEN` : abonnement ($20/mois), pas facturation à l'usage — tient car Claude ne fait que du triage/plans, jamais d'implémentation lourde.
- Une GitHub App (Claude) ne peut pas pousser de commit touchant `.github/workflows/*.yml`, même inchangé, sans permission `workflows` — si la branche du plan diverge de la branche par défaut sur ces fichiers, le push échoue silencieusement (géré par le repli de recherche de plan ci-dessus).

## Usine de dev : la documentation fait autorité
L'infrastructure qui fait tourner ces workflows (hubert, PC gamer, llama-swap, modèles locaux) est documentée dans un dépôt dédié, cloné en `Documents/projets/usine-dev` sur le laptop et en `~/usine-dev` sur hubert.
- **Ne pas raisonner de mémoire sur l'infra** : les réglages y sont chiffrés et datés. `DECISIONS.md` donne chaque choix et sa mesure, `RUNBOOK.md` les pannes connues, `ETAT.md` l'état réel (généré, jamais édité à la main).
- Toute modification de `local.yml` touchant l'endpoint, un nom de modèle ou une fenêtre de contexte doit être **répercutée dans les deux dépôts** (`cartes-familiales` et `repas-malin` : leurs `local.yml` sont identiques et doivent le rester) **et** reflétée dans `usine-dev/DECISIONS.md`.
- La section « Infra » ci-dessus résume ; en cas de contradiction, `usine-dev` fait foi.
- Les notes personnelles de Patrick (réflexion transverse, décisions hors dépôt) vivent dans `Documents/projets/notes`, coffre Obsidian partagé avec Hermes. **Chercher avec `Grep`, ne pas tout charger**, et ne jamais lire `notes/prive/`.
