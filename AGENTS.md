# Instructions du dépôt Palentirix

Pour toute modification (code, tests, workflows, PR, déploiement), charger le skill `.agents/skills/palantir-development/SKILL.md` : politique de confidentialité des GPX et flux branche → PR → contrôle `verify` → Pages. Ne rien pousser, fusionner ni déployer sans demande explicite ; ne pas déployer sur `main` à l’occasion d’une simple vérification de PR.

## Commandes
- `npm ci`, puis le même ordre que la CI `verify` (Node 22) : `npm run typecheck` → `npm test` → `npm run build`.
- Test ciblé : `npx vitest run tests/edge.test.ts` (ou `-t "<nom du test>"`).
- `npm run dev` / `npm run preview` écoutent sur 127.0.0.1 ; l’app est servie sous `/palentirix/` (base Vite requise par Pages et vérifiée par `tests/examples.test.ts`).

## Architecture
- Pas de framework UI : `index.html` charge `app.js` (onglet « Une trace ») et `compare.js` (comparaison) ; `map.js` encapsule Leaflet/OpenStreetMap. Ces JS racine ne sont ni typecheckés (`tsconfig` n’inclut que `src` et `tests`) ni testés : mettre la logique testable dans `src/*.ts` (modèle : `src/chart-cursor.ts`).
- Calculs hors du thread UI : `src/client.ts` (`engine.request('load'|'analyze'|'compare'|'clear')`) → `src/worker.ts` → `src/core.ts` (parsing SAX `saxes`, `analyze`) et `src/comparison.ts` (`preview`, `compareRanges`). Le worker conserve les routes à comparer par côté `first`/`second`.
- L’ancienne version Python a été supprimée (`__pycache__/` n’en est qu’un résidu). Les résultats en gardent les clés snake_case (`distance_m`, `duration_s`…) ; `tests/fixtures/expected.json` est un golden à mettre à jour délibérément quand un calcul change (tolérance 5 décimales, seules les clés présentes dans le golden sont vérifiées).
- Interface, messages d’erreur et README en français ; messages de commit en anglais, courts et à l’impératif.

## Données et tests
- `.gitignore` exclut tous les `*.gpx`, `*.tcx`, `*.fit`, `local-traces.json` et `dist/`. Seules exceptions : `public/examples/Saint_Mens_Player1.gpx` et `Saint_Mens_Player2.gpx`, traces réelles publiées volontairement ; ne pas étendre l’exception sans accord explicite.
- Fixtures synthétiques uniquement : fichiers `.xml` dans `tests/fixtures/` (un `.gpx` y serait ignoré par Git) ou XML généré dans le test comme dans `tests/edge.test.ts`.
- `tests/examples.test.ts` lit les vrais GPX Saint Mens (cadence et puissance uniquement chez Player 1) et casse si ces fichiers changent.
- `tests/real-local.test.ts` est ignoré sauf si `PALANTIR_LOCAL_GPX_1`, `PALANTIR_LOCAL_GPX_2` et `PALANTIR_LOCAL_EXPECTED` pointent vers des fichiers locaux, qui ne doivent jamais être commités.
- Vitest tourne sous Node, sans DOM : vérifier dans le navigateur tout changement d’interface.

## Règles de calcul à préserver
- Capteur absent (`null`) ≠ zéro mesuré ; intervalles > 30 s (`MAX_GAP`) exclus des moyennes et zones, jamais interpolés ; segments GPX jamais reliés ; 50 Mio max par fichier (`MAX_BYTES`).
- Tout changement de calcul ou de sérialisation worker/UI exige un test, et les explications de méthode du `README.md` (limites, interprétation des résultats) doivent suivre les changements de comportement visibles.
- Les imports manuels restent en mémoire dans le navigateur, sans envoi ni stockage par l’application. Exception distincte : les deux GPX Saint Mens sont déjà publics et servis depuis Pages ; seules les tuiles OSM de la zone affichée font appel à un fournisseur de cartes externe. Conserver l’attribution OSM et les textes de confidentialité.
