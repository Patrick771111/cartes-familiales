# Consignes Claude Code

## Rôle de Claude : concevoir, jamais implémenter

Quand `@claude` est mentionné, Claude Code a un rôle **strictement limité à la conception** :

- **Ne modifie jamais de code applicatif.** Aucun fichier hors `docs/plans/` ne doit être créé, édité ou supprimé.
- **Écrit un plan**, et seulement un plan, dans `docs/plans/issue-<numéro-de-l'issue>.md` (créer le dossier si besoin), en le committant directement.
- **Poste le plan complet, en français, en commentaire** sur l'issue — c'est ce commentaire qui sert de validation, pas le fichier.
- **S'arrête là.** Pas de pull request, pas de code, pas de tests écrits par Claude.

Exception : une tâche vraiment triviale (typo, formulation d'un message, valeur de config isolée) peut être traitée sans plan si elle est trop mince pour en justifier un — mais dans le doute, écrire le plan.

### Format du plan

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

## Exécution du plan : la voie locale

Une fois le plan validé, mentionner `@local go` en commentaire sur la même issue déclenche l'exécution **gratuite**, sur le matériel local (hubert + gamer), sans consommer de quota Claude :

- Si un plan existe, c'est son contenu qui sert de consigne à qwen — pas le corps brut de l'issue. Recherché dans l'ordre : `docs/plans/issue-<numéro>.md` sur `main`, puis sur la branche non fusionnée `claude/issue-<numéro>-*`, puis dans le dernier commentaire de l'issue contenant « Plan complet » (repli si le push de la branche a échoué — voir note ci-dessous)
- Sinon (tâche simple, sans passage par Claude), le titre et le corps de l'issue servent directement de consigne
- L'exécution tourne sur le runner auto-hébergé `hubert` (label `local`), via Aider + qwen2.5-coder dans Docker, pointant vers l'Ollama de gamer
- Une pull request est ouverte automatiquement si des changements ont été produits
- qwen improvise mal, et peine à reproduire de longs blocs de texte exacts (format diff) sur de gros fichiers : réservé aux tâches simples ou aux plans suffisamment précis et ciblés

**Note** : GitHub refuse qu'une GitHub App (Claude) pousse un commit dont l'arbre contient `.github/workflows/*.yml`, même inchangé, sans permission `workflows` explicite sur l'installation — ce qui peut arriver dès que la branche de Claude diverge de `main` sur ces fichiers (ex. si `main` a été modifié pendant que Claude travaillait). Dans ce cas, le plan n'atteint jamais le dépôt distant en Git ; le commentaire de l'issue reste alors la seule source, d'où le repli ci-dessus.

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

- `@claude` (commentaire ou corps d'issue) → Claude rédige un plan, le commit dans `docs/plans/`, le résume en français dans le fil, s'arrête
- `@local go` (commentaire) → qwen exécute (le plan s'il existe, sinon l'issue brute) et ouvre une pull request

Dialogue par fil de commentaires : chaque mention relance le moteur correspondant dans le même fil.

## Triage automatique

Une issue ouverte **sans** `@claude` ni `@local go` dans son corps déclenche un triage automatique et gratuit : qwen lit le titre et le corps, juge si la tâche est simple ou complexe, pose un label (`triage: simple` / `triage: complexe`), puis poste lui-même le commentaire de routage (`@claude` ou `@local go`) pour enchaîner sans intervention.

- Verdict imparfait ? Change le label et retape le commentaire de routage toi-même — rien n'est irréversible.
- Le commentaire de routage est posté avec un jeton dédié (secret `TRIAGE_TOKEN`), pas le token GitHub Actions par défaut : GitHub bloque les déclenchements en cascade venant du token automatique, un jeton distinct est nécessaire pour que le commentaire relance effectivement Claude ou qwen.

## Authentification

Le token d'abonnement Claude ($20/mois) est stocké dans `CLAUDE_CODE_OAUTH_TOKEN` (secrets GitHub). Les exécutions utilisent cet abonnement, pas une facturation à l'usage — c'est justement parce que Claude ne fait plus que des plans (courts) que cet abonnement reste soutenable.

## Runner

`claude-code.yml` (Claude, planification) tourne sur `ubuntu-latest` : il n'a aucun besoin d'atteindre le réseau local.
`local.yml` (qwen, exécution) tourne sur `[self-hosted, local]` (hubert), pour atteindre l'Ollama de gamer.
