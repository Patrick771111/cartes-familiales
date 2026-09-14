# Consignes Claude Code

## Cycle de vie
1. Triage (Claude, auto) → `VERDICT: SIMPLE` / `COMPLEXE` / `IMPLEMENTE`
2. Plan (Claude, si COMPLEXE) → étapes atomiques, un fichier chacune
3. Validation humaine (`@local go`) — seul point d'arbitrage réel
4. Coding (qwen) — étapes enchaînées automatiquement, sans revalidation humaine
5. Relecture de chaque étape par un **second appel qwen** (jamais d'auto-jugement) → passe à la suivante seulement si validée
6. Relances auto si besoin (repli de modèle, ou Claude re-diagnostique)
7. Revue finale (second appel qwen sur le diff complet vs critères du plan) + non-régression (syntaxe + build) avant publication
8. PR ouverte → merge = validation humaine finale

## Capacités des moteurs locaux
- **qwen2.5-coder:14b** (défaut) — édition précise, **32k tokens (natif, non extensible sans perte de fiabilité)**, aucune vision.
- **gemma4-64k** (même poids que gemma4:12b, ~7,5 Go, 0 coût VRAM en plus) — **262k tokens**, **vision** (photo/tableau/texte), moins précis en édition de code.
- 12 Go de VRAM sur gamer : un seul modèle chargé à la fois (bascule auto Ollama, pas de parallélisme).
- **Repli auto** qwen → gemma4-64k sur dépassement de contexte ou réponse vide : rien à anticiper dans un plan.

Conséquences pour le triage/plan :
- Vision requise → `MODELE: gemma4-64k`.
- Fichier trop gros pour tout modèle local (même 262k) → `VERDICT: IMPLEMENTE`, ne jamais déléguer.
- Génération d'image → aucun moteur local ni Claude ne sait le faire → `VERDICT: IMPLEMENTE`, fournir le(s) prompt(s) prêts à coller dans Grok Imagine (ou l'outil préféré de l'utilisateur).

## Triage
Invoqué auto à l'ouverture de toute issue (sauf `@local go` déjà dans le corps) et sur tout `@claude` en commentaire.

Commence **toujours** par une ligne seule, exacte, sans gras ni puce :
```
VERDICT: SIMPLE
```
(ou `COMPLEXE`, ou `IMPLEMENTE`) — lue par le workflow pour router la suite.

- **SIMPLE** = mécanique, cible évidente (texte, config, petite fonction, doc, test isolé, dépendance). Une phrase d'explication ; **aucun fichier touché, aucun plan**. Renvoi auto vers qwen.
- **COMPLEXE** = conception, ambigu, exploration nécessaire, plusieurs fichiers, ou risque de régression. Écris un plan (format ci-dessous), committe-le dans `docs/plans/issue-<n>.md`, poste-le en entier après le VERDICT. Aucun code, aucune PR de ta part.
- **IMPLEMENTE** = hors de portée de tout moteur local (fichier trop gros, génération d'image). Implémente toi-même, **vérifie toi-même** (`node --check` sur les `.js` modifiés, `npm run build` si `package.json` le déclare — ces commandes te sont explicitement autorisées, voir Infra), committe, ouvre la PR (règles de restitution plus bas) ; explique en une phrase pourquoi la voie locale ne convenait pas.

## Format du plan
```
# Plan : <titre bref>

## Objectif
[résultat attendu, langage fonctionnel]

## Fichiers concernés
- chemin/fichier — ce qui change

## Étapes
1. [chemin/fichier] instruction précise et autonome
2. [chemin/fichier] instruction précise et autonome

## Critères de vérification
- comment on sait que c'est correct

## Modèle requis
[omettre si qwen convient ; sinon `gemma4-64k` si vision nécessaire]
```

Règles :
- **Un fichier par étape, format exact `N. [chemin] texte`**, crochet directement après le point (pas de gras autour). Chaque étape s'exécute isolément — ne voit ni les autres fichiers, ni le reste du plan.
- Étape B dépendante du résultat de A ? Répète l'info utile dans l'instruction de B (qwen ne voit pas A à ce moment-là).
- Décris **quoi/où** (sélecteur, fonction, valeur) — jamais le code final à recopier : ça gonfle le contexte pour rien.
- Chaque étape doit tenir largement dans 32k tokens à elle seule.
- Sans fichier entre crochets, le plan part en un seul appel (repli, à éviter sauf tâche ponctuelle).

## Exécution (qwen, déclenchée par `@local go`)
- Source de la consigne, dans l'ordre : `docs/plans/issue-<n>.md` sur la branche par défaut → branche `claude/issue-<n>-*` (non fusionnée) → dernier commentaire « Plan complet » (repli si le push du plan a échoué) → corps brut de l'issue.
- Étapes exécutées en séquence, un appel Aider par étape, scopé au seul fichier indiqué (repo-map désactivé) ; repli gemma4-64k par étape si besoin.
- **Relecture par un second appel qwen après chaque étape** (jamais le même appel qui a codé) : reçoit l'instruction + le diff produit, répond OUI/NON. NON → `git reset --hard` sur l'étape, marquée échouée. Objectif : éviter qu'un modèle valide son propre travail (faux positifs — ex. instruction seulement partiellement suivie).
- **Revue finale** une fois toutes les étapes enchaînées : un appel qwen relit le diff complet du plan contre les `## Critères de vérification` du plan (pas contre chaque instruction isolée). NON → traité comme un échec (voir ci-dessous), rien n'est publié.
- Avant toute PR : `node --check` sur les `.js` modifiés + `npm run build` si `package.json` le déclare. Échec → **rien n'est publié**, le code reste local au runner.
- Échec (aucun changement, étape ratée même après repli, revue finale KO, ou non-régression KO) → **Claude auto-invoqué** avec le diagnostic complet ; rien à redemander.

## Analyser un échec
Invoqué avec un diagnostic en pièce jointe : comprendre la vraie cause avant d'agir, pas retrier par réflexe.
- `exceeds the ... token limit` malgré le repli → structurellement trop gros → `VERDICT: IMPLEMENTE`.
- `Empty response received from LLM` → aléa probable, pas forcément la taille → plan plus ciblé (moins à charger).
- Aucun changement, pas d'erreur visible → consigne ambiguë ou mauvaise cible → plan plus précis, ou question à l'utilisateur si lui seul a l'info manquante.
- Rejet en relecture d'étape (le second qwen a répondu NON) → l'instruction était ambiguë ou trop large pour être vérifiable en un coup d'œil → étape reformulée plus précisément, ou scindée en deux.
- Rejet en revue finale (diff complet ne satisfait pas les critères de vérification) → un ou plusieurs critères n'étaient pas couverts par les étapes → plan corrigé pour les couvrir explicitement.
- Build/syntaxe cassé → corriger l'étape en cause, ou `VERDICT: IMPLEMENTE` si le problème est structurel.

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
- `local.yml` : `[self-hosted, local]` (hubert) → Ollama sur gamer (`192.168.4.27:11434`), Docker/Aider, Node.js (`~/.hermes/node/bin`, déjà dans le PATH du runner).
- `CLAUDE_CODE_OAUTH_TOKEN` : abonnement ($20/mois), pas facturation à l'usage — tient car Claude ne fait que du triage/plans, jamais d'implémentation lourde.
- Une GitHub App (Claude) ne peut pas pousser de commit touchant `.github/workflows/*.yml`, même inchangé, sans permission `workflows` — si la branche du plan diverge de la branche par défaut sur ces fichiers, le push échoue silencieusement (géré par le repli de recherche de plan ci-dessus).
