# Consignes Claude Code

## Rôle de Claude : trier, puis concevoir — jamais implémenter

Claude est invoqué automatiquement à l'ouverture de **toute** nouvelle issue (sauf si son corps contient déjà `@local go`, auquel cas l'utilisateur a explicitement demandé l'exécution directe et Claude n'intervient pas), ainsi que sur toute mention `@claude` en commentaire (dialogue de suivi).

### Étape 1 — Trier

Avant toute chose, évalue si la tâche est **SIMPLE** ou **COMPLEXE** :

- **SIMPLE** = tâche mécanique et bien délimitée : corriger un texte, une valeur de config, une petite fonction évidente, une doc, un test isolé, une dépendance à monter, un changement dont l'emplacement dans le code est évident ou trivial à trouver.
- **COMPLEXE** = nécessite un choix de conception, touche à l'architecture, ambigu, impacte plusieurs fichiers de façon non triviale, demande d'abord d'explorer/comprendre le code pour localiser la bonne cible, ou risque de casser un comportement existant.

**Commence impérativement ta réponse par une ligne exacte, seule sur sa ligne, avant tout autre texte** :

```
VERDICT: SIMPLE
```
ou
```
VERDICT: COMPLEXE
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
```

Un plan vague produit une exécution vague : plus les étapes et les critères sont précis, plus qwen (qui exécute ensuite) sera fidèle. Éviter de laisser des choix de conception ouverts dans le plan — c'est le rôle de Claude de trancher, pas celui de qwen.

## Exécution : la voie locale (qwen)

Le passage à l'exécution se fait par un commentaire `@local go` sur l'issue — posté automatiquement si tu as rendu `VERDICT: SIMPLE`, ou par l'utilisateur une fois qu'il a validé ton plan (`VERDICT: COMPLEXE`). Exécution **gratuite**, sur le matériel local (hubert + gamer), sans consommer de quota Claude :

- Si un plan existe, c'est son contenu qui sert de consigne à qwen — pas le corps brut de l'issue. Recherché dans l'ordre : `docs/plans/issue-<numéro>.md` sur la branche par défaut, puis sur la branche non fusionnée `claude/issue-<numéro>-*`, puis dans le dernier commentaire de l'issue contenant « Plan complet » (repli si le push de la branche a échoué — voir note ci-dessous)
- Sinon (verdict simple, pas de plan), le titre et le corps de l'issue servent directement de consigne
- L'exécution tourne sur le runner auto-hébergé `hubert` (label `local`), via Aider + qwen2.5-coder dans Docker, pointant vers l'Ollama de gamer
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

- **Ouverture d'une issue** (sans `@local go` dans le corps) → Claude trie automatiquement : `VERDICT: SIMPLE` (renvoi immédiat vers qwen) ou `VERDICT: COMPLEXE` (plan à valider)
- `@claude` en commentaire → dialogue de suivi (corriger un plan, redemander un tri après un échec de qwen, etc.)
- `@local go` en commentaire, ou dans le corps d'une issue à l'ouverture → exécution directe par qwen (le plan s'il existe, sinon l'issue brute), sans passer par Claude

Dialogue par fil de commentaires : chaque mention relance le moteur correspondant dans le même fil.

Le commentaire de routage automatique (`@local go` posté après un verdict simple) utilise un jeton dédié (secret `TRIAGE_TOKEN`), pas le token GitHub Actions par défaut : GitHub bloque les déclenchements en cascade venant du token automatique, un jeton distinct est nécessaire pour que le commentaire relance effectivement la voie locale.

## Authentification

Le token d'abonnement Claude ($20/mois) est stocké dans `CLAUDE_CODE_OAUTH_TOKEN` (secrets GitHub). Les exécutions utilisent cet abonnement, pas une facturation à l'usage — c'est justement parce que Claude ne fait que du triage et des plans (courts) que cet abonnement reste soutenable.

## Runner

`claude-code.yml` (Claude, triage + planification) tourne sur `ubuntu-latest` : il n'a aucun besoin d'atteindre le réseau local.
`local.yml` (qwen, exécution) tourne sur `[self-hosted, local]` (hubert), pour atteindre l'Ollama de gamer.
