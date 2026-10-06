# Palantirix

Analysez une activité GPX/TCX ou comparez deux portions de parcours dans votre navigateur. [Essayer Palantirix](https://pourroyjean.github.io/palantirix/) · [Code source](https://github.com/PourroyJean/palantirix).

## Utilisation

- **Une trace** : importez un GPX ou TCX horodaté, choisissez course ou vélo, puis ajustez au besoin les zones cardiaques et la convention de cadence. Le tableau de bord affiche durée, distance, D+/D−, FC, puissance, cadence, cinq zones et couverture des mesures. La carte colore le parcours selon la pente ; les courbes temporelles conservent les lacunes.
- **Comparer deux traces** : importez deux GPX horodatés avec coordonnées, ou cliquez sur « Charger l’exemple Saint Mens ». Réglez indépendamment les bornes début/fin par pas de 10 m, puis cliquez sur « Calculer les performances ». La carte superpose les portions ; le tableau et les graphiques comparent le chrono, l’allure, la FC et les autres mesures disponibles. Les graphiques FC et allure/vitesse ont chacun les modes miroir et superposé ; l’allure bascule entre min/km et km/h.

L’exemple « Trail Saint Mens 16 km 2026 » charge les fichiers `Saint_Mens_Player1.gpx` et `Saint_Mens_Player2.gpx` et calcule immédiatement les parcours entiers. Les deux ont une FC, mais seul Player 1 contient cadence et puissance. Ils mesurent environ **16,334 km et 15,829 km** : ne déduisez pas d’un écart de chrono un classement sur un parcours strictement identique. Vous pouvez sélectionner des portions et recalculer.

### Avant d’importer

- **Temps** : un GPX de parcours peut avoir des coordonnées et une altitude, sans timestamp par point, même si le site d’origine affiche une allure. Sans points horodatés, l’application ne peut pas calculer une durée ou une allure : demandez un export de l’activité d’origine.
- **Capteurs** : FC, cadence et puissance sont facultatives. Une absence apparaît comme « — », jamais comme un zéro mesuré ; les lacunes réduisent la couverture des moyennes.
- **Cadence course** : choisissez ×2 si le fichier compte des cycles de deux pas/minute, ×1 s’il contient déjà des pas/minute. Cette convention n’est pas toujours précisée par le GPX/TCX : vérifiez-la auprès de la montre ou de l’application source. En analyse solo, la moyenne en course exclut les zéros ; celle de vélo les conserve. Dans la comparaison, seule la cadence positive est retenue.
- **Limites** : 50 Mio par fichier ; les gros exports peuvent épuiser la mémoire d’un mobile. L’analyse solo accepte GPX et TCX (une seule activité TCX), la comparaison seulement deux GPX horodatés avec GPS.

## Interprétation des résultats

- **Durée** : dernier timestamp moins premier, pauses comprises. Chaque mesure représente l’intervalle jusqu’au point suivant. Les moyennes et temps en zone sont pondérés par les intervalles couverts ; les interruptions de plus de **30 s** et les ruptures de trace sont exclues. Les maxima comprennent aussi le dernier échantillon. Les valeurs absentes ne sont pas interpolées.
- **Zones FC par défaut**, modifiables : Z1 < 136, Z2 136–151, Z3 152–161, Z4 162–169, Z5 ≥ 170 bpm. Le temps en zone suppose le maintien de la dernière FC mesurée jusqu’au point suivant, dans un intervalle exploitable ; le temps sans couverture est affiché séparément.
- **Distance et D+/D−** : calculés à partir du GPS et des variations d’altitude brutes ; le bruit peut gonfler le dénivelé. La pente utilise une fenêtre d’environ 100 m (au moins 50 m). Les bornes des portions sont interpolées entre points GPS ; aucune courbe ne relie les lacunes.
- **Allure** : le tableau utilise le chrono écoulé, la courbe locale des fenêtres d’environ 100 m en mouvement ; leurs moyennes peuvent différer. Un gel GPS d’au plus 15 s peut être intégré à la courbe si cadence et puissance restent positives et si le déplacement reprend : ce n’est pas une preuve certaine de mouvement.
- **Graphiques de comparaison** : en miroir, l’axe central est le minimum FC commun ou la meilleure allure locale commune ; les étiquettes restent en bpm ou min/km réels, non en FC négative. En superposé, les deux courbes partagent une échelle. Le balayage suit le même kilomètre **depuis le départ de chaque GPX**, sans réaligner deux parcours distincts. Survolez ou glissez ; cliquez pour figer/libérer, utilisez ←/→ (10 m) et Échap pour effacer.

## Confidentialité et licence

Les fichiers importés manuellement sont analysés en mémoire dans un Web Worker, sans API d’analyse ni stockage par Palantirix ; ils sont perdus au rechargement. Le fond OpenStreetMap charge des tuiles : le fournisseur reçoit la zone demandée et votre adresse IP, **pas le fichier GPX ni ses mesures**. Sans tuiles disponibles, les tracés restent visibles sans fond.

**Exception publique** : les deux GPX Saint Mens dans [public/examples/](public/examples/README.md) ont été approuvés pour publication. Positions, horaires et mesures cardiaques y sont téléchargeables depuis GitHub Pages et l’historique Git. N’ajoutez pas d’autres traces personnelles sans autorisation explicite. Le code est sous [PolyForm Noncommercial 1.0.0](LICENSE) ; cette licence ne détermine pas automatiquement les droits sur les GPX. Les versions du code précédemment publiées sous MIT conservent les droits accordés à l’époque.

## Développement

    npm ci
    npm run dev
    npm run typecheck
    npm test
    npm run build

Node.js 22+ recommandé. Vite construit sous `/palantirix/` ; seul `dist/` est déployé. Travaillez sur une branche et ouvrez une PR vers `main` : la CI vérifie typage, tests et build. Après fusion, une CI verte sur `main` déclenche le déploiement Pages du commit validé ; une PR seule ne déploie rien. Voir les [consignes de contribution](.agents/skills/palantirix-development/SKILL.md). Les autres GPX/TCX privés et `dist/` restent hors de Git.
