# Palantir — Analyse GPX/TCX

Mini-application web locale en français, sans dépendance Python externe. Python 3.10+ recommandé.

Identité visuelle : une pierre de vision et un chemin stylisés dans le logo SVG original (`logo.svg`). Aucun visuel de la franchise n'est utilisé.

## Licence

À partir de cette version, le projet est distribué sous licence **PolyForm Noncommercial 1.0.0** (voir `LICENSE`) : usage non commercial autorisé sous ses conditions ; pour un usage commercial, demandez une autorisation distincte à l’auteur. La licence prévoit une exclusion de garantie et de responsabilité dans la mesure permise par la loi. Le code publié antérieurement sous MIT reste soumis à la licence accordée pour cette ancienne version : ce changement ne la révoque pas rétroactivement.

## Démarrage

    python3 app.py

Ouvrir ensuite http://127.0.0.1:8765 dans le navigateur et importer **un** fichier GPX ou TCX de 50 Mio maximum. Choisir le sport et ajuster au besoin les seuils de début Z2/Z3/Z4/Z5 (136, 152, 162 et 170 bpm par défaut, d'après les cinq zones fournies). Pour arrêter, faire Ctrl+C dans le terminal.

Tests : python3 -m unittest -v. Si le port 8765 est déjà occupé, l'arrêter avant de relancer l'application.

## Méthode

- Durée totale = dernier timestamp − premier timestamp, en incluant les pauses.
- Chaque mesure valide représente l'intervalle jusqu'au timestamp suivant, dans le même segment. Les intervalles strictement supérieurs à 30 s sont exclus des moyennes et des zones. Les valeurs absentes ne deviennent pas zéro ; les zéros de puissance et de cadence mesurés sont conservés.
- Les moyennes sont pondérées par la durée couverte par **chaque** capteur. Les maxima utilisent toutes les mesures valides, y compris le dernier point (qui ne couvre aucun intervalle).
- Z1 < 136, Z2 = 136–151, Z3 = 152–161, Z4 = 162–169 et Z5 ≥ 170 bpm avec les seuils par défaut. Les bornes inférieures sont incluses et les bornes supérieures exclues ; les quatre débuts de zone sont modifiables. Le temps sans couverture FC inclut les points sans FC, les longues interruptions et les limites de segments. Les durées sont calculées sur les timestamps avec maintien de la dernière FC, pas sur une FC continue réellement observée.
- En vélo, la cadence est affichée en tr/min (zéros conservés). En course, le sélecteur permet de choisir si la cadence GPX/TCX correspond à un cycle de deux pas (**×2** par défaut pour cet export) ou directement à des pas/min (**×1**). La convention n'est pas inscrite dans le GPX : c'est une hypothèse à contrôler avec la montre. La cadence de course affichée exclut les zéros (pause ou défaut de mesure possible) et inclut les cadences positives plus lentes, donc la marche éventuelle. Une seconde carte indique la moyenne de la foulée à **≥ 130 pas/min** (simple critère de cadence, pas une détection certaine du mode de déplacement) et sa durée couverte. Les lacunes restent visibles dans la courbe et dans la couverture.
- Les courbes sont des SVG produits localement ; aucune lacune de mesure ou interruption de plus de 30 s n'est interpolée.

Les fichiers sont analysés en mémoire et ne sont pas enregistrés par l'application. Le serveur n'écoute que sur 127.0.0.1 ; ce n'est pas un serveur à exposer sur Internet.
Le serveur refuse les requêtes dont l’hôte ou l’origine ne correspond pas à sa page locale sur le port 8765.

## Comparer deux traces

L'onglet **Comparer deux traces** peut précharger deux GPX locaux depuis `~/Downloads`, sans les copier ni les publier. Le préchargement est facultatif : créez `local-traces.json` à partir de `local-traces.example.json` et remplacez les valeurs `first` et `second` par les **seuls noms** de vos fichiers présents dans Downloads. Ce fichier de configuration est ignoré par Git. Sans configuration, ou si un fichier est absent, illisible ou sans activité horodatée, l'interface propose l'import manuel. Chaque fichier est limité à 50 Mio et seuls les deux identifiants configurés peuvent être lus par l'API locale.

Chaque trace possède ses propres bornes **début / fin** en kilomètres GPS, modifiables par deux curseurs ou par saisie numérique (pas de 10 m ; fin exacte possible). Les tracés entiers apparaissent atténués sur une carte locale ; les portions sélectionnées sont en bleu plein pour la référence et orange pointillé pour la deuxième trace. Curseurs, bornes et légende reprennent ces couleurs. Les extrémités sont interpolées sur les points GPS, et les segments séparés et lacunes de plus de 30 s ne sont pas reliés. Aucun fond cartographique externe ni requête de tuiles n'est utilisé.

Le bouton **Calculer les performances** analyse uniquement les portions choisies : chronos écoulés, allures, distances, FC, cadence positive (×1 ou ×2 indépendamment), puissance lorsqu'elle existe, D+/D− bruts si l'altitude existe et couverture des capteurs. Les moyennes sont pondérées par le temps exploitable, les pauses restent dans le chrono, et les lacunes de plus de 30 s ne contribuent pas aux moyennes. L'écart de chrono est donné **avec réserve**, jamais comme un verdict de vitesse : deux segments choisis librement peuvent avoir des longueurs, départs ou arrivées différents. Changer une borne efface immédiatement l'ancien résultat.

Sous le tableau, le graphique FC miroir utilise les kilomètres depuis le départ de **chaque GPX entier**. Un minimum FC commun est soustrait aux deux séries : bleu = FC₁ − minimum, orange = −(FC₂ − minimum). Les graduations des deux moitiés indiquent directement les **FC réelles en bpm** ; la partie basse n'est qu'une inversion visuelle, pas une FC négative. Un trait horizontal fin et pointillé pour chaque trace indique sa FC moyenne pondérée dans le segment, étiquetée sur l'axe vertical. Le point rouge fléché indique son maximum à la position GPS de l'échantillon, même si celui-ci est isolé ou situé à la borne de fin. Les lacunes et coupures de trace ne sont pas reliées. Le graphique ne s'affiche qu'après le calcul et disparaît si la sélection change.

Le graphique suivant montre l'allure locale (min/km) sur une fenêtre mobile d'environ 100 m, limitée aux séquences continues en déplacement. Une sélection de 50 à 99 m peut utiliser cette longueur réelle si ses deux bornes sont celles choisies par l'utilisateur ; les reprises de moins de 100 m après un arrêt ne sont pas extrapolées. À l'intérieur d'une longue séquence, la fenêtre de 100 m se décale vers l'intérieur à proximité d'une pause : elle n'inclut jamais les points de l'autre côté de l'arrêt et ne laisse pas de vide artificiel de 50 m. En mode superposé, les petites valeurs (plus rapides) sont en bas et les grandes (plus lentes) en haut. En miroir, l'axe central représente la plus petite allure commune ; les allures plus lentes s'en écartent vers le haut en bleu et vers le bas en orange. Les graduations affichent les allures réelles sur les deux moitiés. La ligne pointillée indique l'allure moyenne **en mouvement** (temps des intervalles valides ÷ distance correspondante), qui peut différer de l'allure au chrono écoulé dans le tableau. Le point rouge indique la meilleure allure locale. Les pauses, ruptures et intervalles de plus de 30 s ne sont jamais interpolés dans la courbe.

Chacun des graphiques FC et allure possède un bouton **Miroir / Superposé** indépendant. Le mode superposé affiche les deux traces sur la même échelle de valeurs réelles, en conservant les couleurs, les moyennes, les maxima, les coupures et les kilomètres GPS absolus. Le basculement est instantané et ne relance ni import ni calcul ; tout changement de segment masque les résultats précédents jusqu'au prochain calcul.

Le graphique d’allure propose aussi un bouton **min/km / km/h**, indépendant du mode Miroir / Superposé. La conversion en vitesse se fait sur les allures locales et sur l’allure moyenne en mouvement (3 600 ÷ secondes par kilomètre) ; les graduations, l’axe et le point rouge de la meilleure performance adoptent l’unité choisie. En km/h, une valeur plus élevée correspond à une vitesse plus rapide. Le tableau récapitulatif conserve son allure calculée sur le chrono écoulé. La bascule est instantanée, sans nouveau calcul serveur.

Un gel GPS de **15 secondes au plus** (coordonnées répétées) est traité comme une poursuite de l'effort sur le graphique d'allure seulement si la cadence et la puissance restent strictement positives sur tout le gel et si le GPS se déplace avant et après. Le temps écoulé pendant ce gel est conservé dans l'allure et sa durée est signalée sous le graphique. Ce n'est pas une preuve certaine de déplacement ; les gels plus longs, valeurs nulles/absentes et coupures de segment restent des interruptions. Le parcours, les kilomètres GPS et les autres métriques ne sont pas modifiés par cette règle.
