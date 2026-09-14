# Plan : Écran de démarrage (splash screen)

## Objectif
À l'ouverture du site, un écran plein écran évoquant l'identité de l'application
(« Cartes en famille », plusieurs jeux réunis) s'affiche pendant environ 2 secondes,
puis s'efface en douceur pour laisser place à l'écran habituel (saisie du nom ou
liste des salons), sans changer le comportement de ces écrans.

## Fichiers concernés
- index.html — ajoute le balisage de l'écran de démarrage.
- src/style.css — ajoute les styles (plein écran, identité visuelle, fondu de sortie).
- src/main.js — ajoute la temporisation qui masque puis retire l'écran de démarrage.

## Étapes
1. [index.html] Juste avant la ligne `<div id="app"></div>` dans `<body>`, insère un nouveau bloc `<div id="splash" class="splash">` contenant : un élément avec la classe `splash__mark` et le texte `♠ ♥ ♦ ♣` (symboles des 4 familles de cartes), un titre (`<p class="splash__title">`) avec le texte « Cartes en famille », et un sous-titre (`<p class="splash__subtitle">`) avec le texte « Tous les jeux, une seule table ». Ferme le `</div>` du bloc `splash`. Ne touche à rien d'autre dans le fichier (le `<div id="app"></div>` et le `<script type="module" src="/src/main.js"></script>` restent inchangés, juste après).

2. [src/style.css] Ajoute une nouvelle section de styles pour l'écran de démarrage, à la fin du fichier. Règles nécessaires :
   - `.splash` : position `fixed`, `inset: 0`, `z-index: 9999`, `display: flex`, `flex-direction: column`, `align-items: center`, `justify-content: center`, `gap: 12px`, fond identique à celui de `html, body` (le même dégradé radial déjà défini au tout début du fichier avec `var(--felt-600)` et `var(--felt-900)`), et une transition sur `opacity` d'environ 400ms (ease).
   - `.splash--hide` : `opacity: 0` et `pointer-events: none` (classe ajoutée par le JS pour déclencher le fondu de sortie).
   - `.splash__mark` : `font-size` around 40px, `color: var(--brass-soft)`, `letter-spacing: 0.2em`.
   - `.splash__title` : police `var(--font-display)`, poids 600, taille `clamp(28px, 7vw, 38px)`, couleur `var(--cream)`, marge nulle.
   - `.splash__subtitle` : police `var(--font-mono)`, taille 12px, majuscules (`text-transform: uppercase`), `letter-spacing: 0.14em`, couleur `var(--brass-soft)`.
   Ne duplique pas la règle `prefers-reduced-motion` déjà présente en haut du fichier (elle réduit déjà automatiquement toutes les durées de transition, y compris celle de `.splash`).

3. [src/main.js] Juste avant l'appel final `boot();` (dernière ligne du fichier), ajoute un petit bloc de code autonome qui : récupère l'élément `document.getElementById('splash')` ; si l'élément existe, programme un `setTimeout` d'environ 2000ms qui ajoute la classe `splash--hide` à cet élément, puis programme un second `setTimeout` d'environ 400ms (après le premier) qui retire l'élément du DOM (`element.remove()`). Ne modifie pas la fonction `boot()` elle-même ni son appel — ce bloc est indépendant et s'exécute en parallèle du chargement normal de l'application.

## Critères de vérification
- Au chargement de la page, un écran plein écran avec le fond vert de la charte, les symboles ♠ ♥ ♦ ♣, le titre « Cartes en famille » et le sous-titre s'affiche immédiatement.
- Après environ 2 secondes, cet écran s'efface en fondu (~400ms) puis disparaît complètement, révélant l'écran habituel (saisie du nom si première visite, sinon liste des salons ou salon repris).
- Aucune régression sur le flux existant : la saisie du nom, la liste des salons et la reprise de salon fonctionnent exactement comme avant, l'écran de démarrage n'étant qu'une superposition temporaire au-dessus.
- Avec « Réduire les animations » actif côté système (`prefers-reduced-motion: reduce`), l'écran de démarrage disparaît sans fondu visible (transition quasi instantanée), sans erreur JS.
