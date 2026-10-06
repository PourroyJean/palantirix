---
name: palantir-development
description: "Développer Palantir (analyse GPX/TCX 100 % navigateur) et gérer ses branches, PR, CI GitHub Actions et déploiements Pages. À utiliser pour toute modification de code, tests ou workflow de ce dépôt."
---

# Développement de Palantir

S’applique uniquement au dépôt PourroyJean/palentir. Respecter les instructions du dépôt et la demande de l’utilisateur ; ce skill n’autorise pas à pousser, ouvrir ou fusionner une PR sans demande ou accord adapté.

## Architecture et confidentialité

- Vite + TypeScript sans framework UI ; interface DOM/SVG dans `app.js`, `compare.js`, `index.html` et `styles.css`. Analyse et comparaison dans `src/`, parsing XML à flux et calcul dans un Web Worker. Ne pas réintroduire d’API serveur, de préchargement local ni de stockage des activités.
- Garder la base Vite `/palentir/`. Les fichiers GPX/TCX privés, configurations locales, références réelles et export `dist/` ne doivent pas entrer dans Git. Fixtures synthétiques seulement dans `tests/fixtures/` ; test de parité sur données réelles uniquement via variables locales facultatives.
- Préserver les règles de calcul (capteurs absents ≠ zéro mesuré, maintien de la dernière mesure, intervalles > 30 s exclus, ruptures GPX, bornes interpolées et fenêtres d’allure). Ajouter ou adapter un test pour tout changement de calcul ou de sérialisation worker/UI.

## Flux de contribution

1. Vérifier la branche et l’état du dépôt ; ne pas écraser les changements existants. Pour du nouveau travail destiné à publication, partir d’un `main` à jour et utiliser une branche courte `feat/...`, `fix/...` ou `chore/...`. Si l’utilisateur demande seulement un changement local, ne pas publier implicitement.
2. Avant une PR : `npm ci` puis `npm run typecheck`, `npm test` et `npm run build`. Vérifier l’interface dans le navigateur quand elle change, et `git diff --check`. Inspecter les fichiers indexés pour écarter les traces et données privées.
3. Si publication demandée : pousser la branche, ouvrir une PR vers `main`, attendre `CI / verify`, corriger les échecs sur cette branche. Ne pas contourner une CI rouge ; ne fusionner la PR que sur demande explicite, après vérification humaine des changements pertinents.
4. La CI vérifie les PR et les pushes sur `main` ; `Deploy to GitHub Pages` n’est déclenché qu’après une CI réussie sur `main` et reconstruit le commit validé. Après fusion autorisée, contrôler le workflow de déploiement puis la page `https://pourroyjean.github.io/palentir/`. Un workflow manuel CI sur `main` peut relancer ce déploiement ; prévenir l’utilisateur avant une telle action sur le site public.

Ne pas modifier les règles de protection GitHub sans demande explicite. Si elles existent, suivre les contrôles requis ; sinon conseiller de rendre `CI / verify` obligatoire et de bloquer les pushes directs vers `main`, sans prétendre que le workflow l’impose à lui seul.
