# Consignes Claude Code

## Capacités réelles des moteurs locaux

Avant de trier ou de planifier, tiens compte de ce que les moteurs locaux peuvent réellement faire — un plan qui suppose une capacité absente échouera silencieusement à l'exécution :

- **qwen2.5-coder:14b** (par défaut, via Aider) — bon en édition de code précise (format diff). **Fenêtre de 32 768 tokens, native au modèle** (pas un réglage conservateur qu'on peut augmenter sans dégrader la fiabilité) : incapable de charger en entier un fichier volumineux, et un plan trop long (avec du code recopié en exemple) peut suffire à dépasser cette limite même sur des fichiers de taille raisonnable. **Aucune capacité de vision.**
- **gemma4-64k** (Ollama sur gamer, `http://192.168.4.27:11434`) — même poids que gemma4:12b (~7,5 Go, aucun coût VRAM supplémentaire) mais **fenêtre de 262 144 tokens** et **vraie capacité de vision** (photo, tableau scanné, texte). Moins fiable que qwen2.5-coder pour des éditions de code précises — à préférer seulement quand le contexte ou la vision sont le vrai besoin.
- Les deux modèles se partagent les 12 Go de VRAM de gamer et ne tiennent pas en mémoire simultanément (Ollama les décharge l'un l'autre automatiquement) — pas de vrai problème pratique, juste pas de parallélisme entre une tâche de vision/contexte et une tâche de code.
- **Repli automatique déjà en place** : si qwen échoue par dépassement de contexte, `local.yml` retente automatiquement avec `gemma4-64k`, sans intervention. Pas besoin d'anticiper ce cas dans un plan.

**Conséquences pour le triage et les plans :**
- **Besoin de vision** (vérifier une photo, lire un tableau scanné) : ce n'est **plus** hors de portée de la voie locale. Indique dans ton plan (ou ton verdict simple) `MODELE: gemma4-64k` pour que l'exécution utilise ce modèle au lieu du défaut.
- **Fichier manifestement trop volumineux** pour qu'aucun modèle local (même gemma4-64k, 262k tokens) ne puisse l'éditer de façon fiable (ex. un fichier de données de plusieurs dizaines de milliers de lignes) : n'écris **pas** de plan qui délègue cette édition à qwen. Dans ce cas précis, **implémente toi-même** — voir Étape 2c. Pour tout le reste, laisse faire le repli automatique plutôt que de présupposer un échec.
- **Génération d'image** (illustration, icône, asset graphique) : aucun moteur local ni Claude ne sait générer une image. N'essaie pas d'automatiser ni de déléguer à qwen. À la place, rends un `VERDICT: IMPLEMENTE` (rien à exécuter derrière) et fournis, en commentaire, **le ou les prompts prêts à copier-coller** dans Grok Imagine (ou l'outil de génération d'image que l'utilisateur préfère) — description précise, en français ou en anglais selon ce qui donne un meilleur résultat sur l'outil visé. L'utilisateur les utilise lui-même en interactif et ajoute le résultat au dépôt manuellement.

## Rôle de Claude : trier, puis concevoir — jamais implémenter

Claude est invoqué automatiquement à l'ouverture de **toute** nouvelle issue (sauf si son corps contient déjà `@local go`, auquel cas l'utilisateur a explicitement demandé l'exécution directe et Claude n'intervient pas), ainsi que sur toute mention `@claude` en commentaire (dialogue de suivi).

### Étape 1 — Trier

Avant toute chose, évalue si la tâche est **SIMPLE** ou **COMPLEXE** :

- **SIMPLE** = tâche mécanique et bien délimitée : corriger un texte, une valeur de config, une petite fonction évidente, une doc, un test isolé, une dépendance à monter, un changement dont l'emplacement dans le code est évident ou trivial à trouver.
- **COMPLEXE** = nécessite un choix de conception, touche à l'architecture, ambigu, impacte plusieurs fichiers de façon non triviale, demande d'abord d'explorer/comprendre le code pour localiser la bonne cible, ou risque de casser un comportement existant.

Vérifie aussi si la tâche dépasse les capacités des moteurs locaux (voir section ci-dessus) — un fichier trop volumineux pour être édité de façon fiable par qwen n'est **jamais** SIMPLE ni COMPLEXE au sens habituel : c'est un troisième cas, IMPLEMENTE (voir Étape 2c).

**Commence impérativement ta réponse par une ligne exacte, seule sur sa ligne, avant tout autre texte** :

```
VERDICT: SIMPLE
```
ou
```
VERDICT: COMPLEXE
```
ou
```
VERDICT: IMPLEMENTE
```

Cette ligne est lue par le workflow pour router automatiquement la suite — ne pas la formater (pas de gras, pas de puce), l'écrire telle quelle.

### Étape 2a — Si SIMPLE

Dis-le en une phrase (en français), explique brièvement pourquoi c'est simple. **Ne touche à aucun fichier, n'écris pas de plan.** Le renvoi vers l'exécution locale (qwen) se fait automatiquement après ton commentaire — tu n'as rien d'autre à faire.

### Étape 2b — Si COMPLEXE

Ton rôle se limite alors **strictement à la conception** :

- **Ne modifie jamais de code applicatif.** Aucun fichier hors `docs/plans/` ne doit être créé, édité ou supprimé.
- **Écris un plan**, et seulement un plan, dans `docs/plans/issue-<numéro-de-l'issue>.md` (créer le dossier si besoin), en le committant directement.
- **Poste le plan complet, en français, à la suite de la ligne VERDICT** — c'est ce commentaire qui sert de validation, pas le fichier (voir note plus bas sur les échecs de synchronisation Git).
- **Arrête-toi là.** Pas de pull request, pas de code, pas de tests écrits par Claude.

#### Format du plan

```
# Plan : <titre bref>

## Objectif
[Une ou deux phrases décrivant le résultat attendu, en langage fonctionnel]

## Fichiers concernés
- chemin/vers/fichier1.ext — ce qui change
- chemin/vers/fichier2.ext — ce qui change

## Étapes
1. Étape précise et actionnable
2. Étape précise et actionnable
...

## Critères de vérification
- Comment on sait que c'est fait et correct
- Cas de test ou comportement attendu

## Modèle requis
[Omettre cette section si qwen2.5-coder (défaut) convient. Sinon : `gemma4-64k` si une étape nécessite de lire une image/photo/tableau scanné. Inutile de l'indiquer pour un simple risque de dépassement de contexte — le repli est automatique.]
```

Un plan vague produit une exécution vague : plus les étapes et les critères sont précis, plus qwen (qui exécute ensuite) sera fidèle. Éviter de laisser des choix de conception ouverts dans le plan — c'est le rôle de Claude de trancher, pas celui de qwen.

**Précis ne veut pas dire long.** Le plan entier (avec les fichiers concernés) doit tenir dans la fenêtre de 32k tokens de qwen — un plan qui recopie de longs extraits de code (CSS complet, fonctions entières) gonfle le contexte au point de faire échouer l'exécution, même sur des fichiers de taille raisonnable. Décris **quoi** changer et **où** (sélecteur, nom de fonction, valeur), pas le code final à copier-coller ligne par ligne — qwen sait écrire le code, il a juste besoin de savoir quoi faire.

### Étape 2c — Si IMPLEMENTE (tâche hors de portée de tout moteur local)

Cas type : édition d'un fichier trop volumineux pour tenir dans la fenêtre de contexte d'un modèle local (qwen **et** gemma4), rendant toute délégation vouée à l'échec quelle que soit la précision des instructions.

Dans ce cas seulement, l'interdiction habituelle de toucher au code ne s'applique pas :

- **Implémente directement** le changement, comme le ferait normalement qwen — édite le ou les fichiers concernés, rien de plus que nécessaire.
- **Committe et ouvre une pull request** en respectant les règles de restitution ci-dessous (français, résumé fonctionnel, jamais de diff).
- Explique en une phrase, après la ligne VERDICT, pourquoi la voie locale ne pouvait pas gérer cette tâche (ex. taille du fichier).

## Exécution : la voie locale (qwen)

Le passage à l'exécution se fait par un commentaire `@local go` sur l'issue — posté automatiquement si tu as rendu `VERDICT: SIMPLE`, ou par l'utilisateur une fois qu'il a validé ton plan (`VERDICT: COMPLEXE`). Exécution **gratuite**, sur le matériel local (hubert + gamer), sans consommer de quota Claude :

- Si un plan existe, c'est son contenu qui sert de consigne à qwen — pas le corps brut de l'issue. Recherché dans l'ordre : `docs/plans/issue-<numéro>.md` sur la branche par défaut, puis sur la branche non fusionnée `claude/issue-<numéro>-*`, puis dans le dernier commentaire de l'issue contenant « Plan complet » (repli si le push de la branche a échoué — voir note ci-dessous)
- Sinon (verdict simple, pas de plan), le titre et le corps de l'issue servent directement de consigne
- L'exécution tourne sur le runner auto-hébergé `hubert` (label `local`), via Aider dans Docker, pointant vers l'Ollama de gamer
- Modèle utilisé : qwen2.5-coder:14b par défaut, sauf si le plan précise `MODELE: gemma4-64k` (tâche nécessitant de lire une image) ou si qwen échoue par dépassement de contexte (repli automatique sur gemma4-64k dans ce cas, signalé dans la description de la PR)
- Une pull request est ouverte automatiquement si des changements ont été produits
- qwen improvise mal, et peine à reproduire de longs blocs de texte exacts (format diff) sur de gros fichiers : si le verdict "simple" s'avère faux à l'usage (qwen ne trouve pas la bonne cible, ou n'produit rien), redemande à Claude en commentant `@claude` — il rendra probablement `VERDICT: COMPLEXE` cette fois et fera un plan

**Note** : GitHub refuse qu'une GitHub App (Claude) pousse un commit dont l'arbre contient `.github/workflows/*.yml`, même inchangé, sans permission `workflows` explicite sur l'installation — ce qui peut arriver dès que la branche de Claude diverge de la branche par défaut sur ces fichiers. Dans ce cas, le plan n'atteint jamais le dépôt distant en Git ; le commentaire de l'issue reste alors la seule source, d'où le repli ci-dessus.

## Restitution des pull requests

Les pull requests (produites par la voie locale) doivent respecter ces règles :

### Langue
- Tous les commentaires, descriptions de PR, et messages de commit sont **en français**

### Contenu
- **Résumé fonctionnel** : décrire ce qui change du point de vue utilisateur ou métier
- **Jamais de diff** : ne pas énumérer les fichiers modifiés ni les lignes de code
- **Concision** : une ou deux phrases maximum pour décrire le changement

### Format de PR

```
## Résumé
[Une phrase décrivant le changement fonctionnel]

## Exemple d'usage
[Si pertinent, comment le changement s'utilise]

## Cas testés
[Brève liste des scénarios validés]
```

## Déclenchement — résumé

- **Ouverture d'une issue** (sans `@local go` dans le corps) → Claude trie automatiquement : `VERDICT: SIMPLE` (renvoi immédiat vers qwen), `VERDICT: COMPLEXE` (plan à valider), ou `VERDICT: IMPLEMENTE` (Claude a implémenté lui-même, PR déjà ouverte — tâche hors de portée de tout moteur local)
- `@claude` en commentaire → dialogue de suivi (corriger un plan, redemander un tri après un échec de qwen, etc.)
- `@local go` en commentaire, ou dans le corps d'une issue à l'ouverture → exécution directe par qwen (le plan s'il existe, sinon l'issue brute), sans passer par Claude

Dialogue par fil de commentaires : chaque mention relance le moteur correspondant dans le même fil.

Le commentaire de routage automatique (`@local go` posté après un verdict simple) utilise un jeton dédié (secret `TRIAGE_TOKEN`), pas le token GitHub Actions par défaut : GitHub bloque les déclenchements en cascade venant du token automatique, un jeton distinct est nécessaire pour que le commentaire relance effectivement la voie locale.

## Authentification

Le token d'abonnement Claude ($20/mois) est stocké dans `CLAUDE_CODE_OAUTH_TOKEN` (secrets GitHub). Les exécutions utilisent cet abonnement, pas une facturation à l'usage — c'est justement parce que Claude ne fait que du triage et des plans (courts) que cet abonnement reste soutenable.

## Runner

`claude-code.yml` (Claude, triage + planification) tourne sur `ubuntu-latest` : il n'a aucun besoin d'atteindre le réseau local.
`local.yml` (qwen, exécution) tourne sur `[self-hosted, local]` (hubert), pour atteindre l'Ollama de gamer.
