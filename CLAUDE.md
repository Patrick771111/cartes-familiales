# Consignes Claude Code

## Restitution

Les pull requests générées par Claude Code doivent respecter ces règles :

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

## Déclenchement

Mention `@claude` pour déclencher Claude Code :
- En commentaire sur une issue : `@claude, peux-tu implémenter X ?`
- Dans le corps d'une nouvelle issue : `@claude : créer un composant pour Y`

Un dialogue par fil de commentaires : Claude continue à répondre à chaque mention @claude dans le même fil.

## Authentification

Le token d'abonnement Claude ($20/mois) est stocké dans `CLAUDE_CODE_OAUTH_TOKEN` (secrets GitHub). Les exécutions utilisent cet abonnement, pas une facturation à l'usage.

## Runner

Actuellement : `ubuntu-latest` (pour validation).
À terme : `self-hosted` (runner auto-hébergé sur la machine locale, pour accès réseau local à Ollama).

Pour basculer : modifier une seule ligne dans `.github/workflows/claude-code.yml` à la section `runs-on:`.

## Voie locale (qwen)

Mention `@local go` en commentaire sur une issue pour déclencher une exécution **gratuite**, sur le matériel local (hubert + gamer), sans consommer de quota Claude.

- Le corps de l'issue sert de consigne de tâche
- L'exécution tourne sur le runner auto-hébergé `hubert` (label `local`), via Aider + qwen2.5-coder dans Docker, pointant vers l'Ollama de gamer
- Une pull request est ouverte automatiquement si des changements ont été produits
- Réservé aux tâches simples et bien délimitées (qwen improvise mal ; plus la consigne est précise, plus le résultat est fidèle)
