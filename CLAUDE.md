# Consignes Claude Code

## Cycle de vie
1. Triage (Claude, auto) → `VERDICT: SIMPLE` / `COMPLEXE` / `IMPLEMENTE`
2. Plan (Claude, si COMPLEXE) → étapes atomiques, un fichier chacune
3. Validation humaine (`@local go`) — seul point d'arbitrage réel
4. Exécution (qwen) — étapes enchaînées automatiquement, sans revalidation
5. Relances auto si besoin (repli de modèle, ou Claude re-diagnostique)
6. Non-régression (syntaxe + build) avant publication
7. PR ouverte → merge = validation humaine finale

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
- **IMPLEMENTE** = hors de portée de tout moteur local (fichier trop gros, génération d'image). Implémente toi-même, committe, ouvre la PR (règles de restitution plus bas) ; explique en une phrase pourquoi la voie locale ne convenait pas.

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
- Avant toute PR : `node --check` sur les `.js` modifiés + `npm run build` si `package.json` le déclare. Échec → **rien n'est publié**, le code reste local au runner.
- Échec (aucun changement, étape ratée même après repli, ou non-régression KO) → **Claude auto-invoqué** avec le diagnostic complet ; rien à redemander.

## Analyser un échec
Invoqué avec un diagnostic en pièce jointe : comprendre la vraie cause avant d'agir, pas retrier par réflexe.
- `exceeds the ... token limit` malgré le repli → structurellement trop gros → `VERDICT: IMPLEMENTE`.
- `Empty response received from LLM` → aléa probable, pas forcément la taille → plan plus ciblé (moins à charger).
- Aucun changement, pas d'erreur visible → consigne ambiguë ou mauvaise cible → plan plus précis, ou question à l'utilisateur si lui seul a l'info manquante.
- Build/syntaxe cassé → corriger l'étape en cause, ou `VERDICT: IMPLEMENTE` si le problème est structurel.

Rends un nouveau `VERDICT:` comme un triage normal.

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
- **Anti-boucle** : tout déclenchement ignore les commentaires contenant `VERDICT:` (= commentaires de Claude lui-même) — sinon une phrase explicative mentionnant `@local go` ou `@claude` se déclencherait toute seule.
- Le routage auto (`@local go` posté après un verdict SIMPLE) utilise le secret `TRIAGE_TOKEN`, pas le token GitHub par défaut (qui ne relance jamais de workflow).

## Infra
- `claude-code.yml` : `ubuntu-latest`, aucun accès réseau local requis.
- `local.yml` : `[self-hosted, local]` (hubert) → Ollama sur gamer (`192.168.4.27:11434`), Docker/Aider, Node.js (`~/.hermes/node/bin`, déjà dans le PATH du runner).
- `CLAUDE_CODE_OAUTH_TOKEN` : abonnement ($20/mois), pas facturation à l'usage — tient car Claude ne fait que du triage/plans, jamais d'implémentation lourde.
- Une GitHub App (Claude) ne peut pas pousser de commit touchant `.github/workflows/*.yml`, même inchangé, sans permission `workflows` — si la branche du plan diverge de la branche par défaut sur ces fichiers, le push échoue silencieusement (géré par le repli de recherche de plan ci-dessus).
