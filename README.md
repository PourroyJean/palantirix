# Palantir — Analyse GPX/TCX

Application web statique en français : les calculs se font entièrement dans le navigateur, sans API ni serveur Python.

Identité visuelle : une pierre de vision et un chemin stylisés dans le logo SVG original (`logo.svg`). Aucun visuel de la franchise n'est utilisé.

## Licence

À partir de cette version, le projet est distribué sous licence **PolyForm Noncommercial 1.0.0** (voir `LICENSE`) : usage non commercial autorisé sous ses conditions ; pour un usage commercial, demandez une autorisation distincte à l’auteur. La licence prévoit une exclusion de garantie et de responsabilité dans la mesure permise par la loi. Le code publié antérieurement sous MIT reste soumis à la licence accordée pour cette ancienne version : ce changement ne la révoque pas rétroactivement.

## Démarrage

    npm ci
    npm run dev

Node.js 22+ recommandé. Ouvrir l’adresse Vite affichée, puis choisir un GPX ou TCX de 50 Mio maximum **par fichier**. Les fichiers restent en mémoire et ne sont pas envoyés à un service externe. Après rechargement, il faut les sélectionner à nouveau. Sur certains mobiles, les très gros exports peuvent dépasser la mémoire disponible. L’application statique est également accessible après publication sous /palentir/ sans exécuter de serveur Python.

Vérifications : `npm run typecheck`, `npm test` et `npm run build`. Le workflow **CI** vérifie ces étapes sur chaque pull request et push vers `main`. Un second workflow **Deploy to GitHub Pages** reconstruit et publie uniquement `dist` pour le commit de `main` qui vient de réussir la CI. La source Pages est GitHub Actions. Site : https://pourroyjean.github.io/palentir/.

## Contribuer et déployer

Travailler sur une branche dédiée, ouvrir une PR vers `main` et attendre la vérification `verify`. Les PR ne sont jamais déployées. Après revue et fusion, la CI du nouveau commit sur `main` déclenche le déploiement Pages si elle réussit. Une CI rouge ne doit pas être contournée. La CI seule n’interdit pas les pushes directs : pour les bloquer, configurer une règle de protection de `main` sur GitHub avec PR et contrôle `verify` obligatoires. Les consignes pour les futurs changements sont dans `.agents/skills/palantir-development/SKILL.md`.

## Méthode

- Durée totale = dernier timestamp − premier timestamp, en incluant les pauses.
- Chaque mesure valide représente l'intervalle jusqu'au timestamp suivant, dans le même segment. Les intervalles strictement supérieurs à 30 s sont exclus des moyennes et des zones. Les valeurs absentes ne deviennent pas zéro ; les zéros de puissance et de cadence mesurés sont conservés.
- Les moyennes sont pondérées par la durée couverte par **chaque** capteur. Les maxima utilisent toutes les mesures valides, y compris le dernier point (qui ne couvre aucun intervalle).
- Z1 < 136, Z2 = 136–151, Z3 = 152–161, Z4 = 162–169 et Z5 ≥ 170 bpm avec les seuils par défaut. Les bornes inférieures sont incluses et les bornes supérieures exclues ; les quatre débuts de zone sont modifiables. Le temps sans couverture FC inclut les points sans FC, les longues interruptions et les limites de segments. Les durées sont calculées sur les timestamps avec maintien de la dernière FC, pas sur une FC continue réellement observée.
- En vélo, la cadence est affichée en tr/min (zéros conservés). En course, le sélecteur permet de choisir si la cadence GPX/TCX correspond à un cycle de deux pas (**×2** par défaut pour cet export) ou directement à des pas/min (**×1**). La convention n'est pas inscrite dans le GPX : c'est une hypothèse à contrôler avec la montre. La cadence de course affichée exclut les zéros (pause ou défaut de mesure possible) et inclut les cadences positives plus lentes, donc la marche éventuelle. Une seconde carte indique la moyenne de la foulée à **≥ 130 pas/min** (simple critère de cadence, pas une détection certaine du mode de déplacement) et sa durée couverte. Les lacunes restent visibles dans la courbe et dans la couverture.
- Les courbes sont des SVG produits localement ; aucune lacune de mesure ou interruption de plus de 30 s n'est interpolée.

Les fichiers sont analysés par un Web Worker en mémoire et ne sont pas enregistrés par l'application.

## Comparer deux traces

L'onglet **Comparer deux traces** demande deux GPX horodatés choisis manuellement ; aucun GPX de Downloads n'est préchargé. Chaque fichier est limité à 50 Mio. Les traces restent en mémoire pendant la session pour déplacer librement les bornes sans réimporter.

Chaque trace possède ses propres bornes **début / fin** en kilomètres GPS, modifiables par deux curseurs ou par saisie numérique (pas de 10 m ; fin exacte possible). Les tracés entiers apparaissent atténués sur une carte locale ; les portions sélectionnées sont en bleu plein pour la référence et orange pointillé pour la deuxième trace. Curseurs, bornes et légende reprennent ces couleurs. Les extrémités sont interpolées sur les points GPS, et les segments séparés et lacunes de plus de 30 s ne sont pas reliés. Aucun fond cartographique externe ni requête de tuiles n'est utilisé.

Le bouton **Calculer les performances** analyse uniquement les portions choisies : chronos écoulés, allures, distances, FC, cadence positive (×1 ou ×2 indépendamment), puissance lorsqu'elle existe, D+/D− bruts si l'altitude existe et couverture des capteurs. Les moyennes sont pondérées par le temps exploitable, les pauses restent dans le chrono, et les lacunes de plus de 30 s ne contribuent pas aux moyennes. L'écart de chrono est donné **avec réserve**, jamais comme un verdict de vitesse : deux segments choisis librement peuvent avoir des longueurs, départs ou arrivées différents. Changer une borne efface immédiatement l'ancien résultat.

Sous le tableau, le graphique FC miroir utilise les kilomètres depuis le départ de **chaque GPX entier**. Un minimum FC commun est soustrait aux deux séries : bleu = FC₁ − minimum, orange = −(FC₂ − minimum). Les graduations des deux moitiés indiquent directement les **FC réelles en bpm** ; la partie basse n'est qu'une inversion visuelle, pas une FC négative. Un trait horizontal fin et pointillé pour chaque trace indique sa FC moyenne pondérée dans le segment, étiquetée sur l'axe vertical. Le point rouge fléché indique son maximum à la position GPS de l'échantillon, même si celui-ci est isolé ou situé à la borne de fin. Les lacunes et coupures de trace ne sont pas reliées. Le graphique ne s'affiche qu'après le calcul et disparaît si la sélection change.

Le graphique suivant montre l'allure locale (min/km) sur une fenêtre mobile d'environ 100 m, limitée aux séquences continues en déplacement. Une sélection de 50 à 99 m peut utiliser cette longueur réelle si ses deux bornes sont celles choisies par l'utilisateur ; les reprises de moins de 100 m après un arrêt ne sont pas extrapolées. À l'intérieur d'une longue séquence, la fenêtre de 100 m se décale vers l'intérieur à proximité d'une pause : elle n'inclut jamais les points de l'autre côté de l'arrêt et ne laisse pas de vide artificiel de 50 m. En mode superposé, les petites valeurs (plus rapides) sont en bas et les grandes (plus lentes) en haut. En miroir, l'axe central représente la plus petite allure commune ; les allures plus lentes s'en écartent vers le haut en bleu et vers le bas en orange. Les graduations affichent les allures réelles sur les deux moitiés. La ligne pointillée indique l'allure moyenne **en mouvement** (temps des intervalles valides ÷ distance correspondante), qui peut différer de l'allure au chrono écoulé dans le tableau. Le point rouge indique la meilleure allure locale. Les pauses, ruptures et intervalles de plus de 30 s ne sont jamais interpolés dans la courbe.

Chacun des graphiques FC et allure possède un bouton **Miroir / Superposé** indépendant. Le mode superposé affiche les deux traces sur la même échelle de valeurs réelles, en conservant les couleurs, les moyennes, les maxima, les coupures et les kilomètres GPS absolus. Le basculement est instantané et ne relance ni import ni calcul ; tout changement de segment masque les résultats précédents jusqu'au prochain calcul.

Le graphique d’allure propose aussi un bouton **min/km / km/h**, indépendant du mode Miroir / Superposé. La conversion en vitesse se fait sur les allures locales et sur l’allure moyenne en mouvement (3 600 ÷ secondes par kilomètre) ; les graduations, l’axe et le point rouge de la meilleure performance adoptent l’unité choisie. En km/h, une valeur plus élevée correspond à une vitesse plus rapide. Le tableau récapitulatif conserve son allure calculée sur le chrono écoulé. La bascule est instantanée, sans nouveau calcul serveur.

Un gel GPS de **15 secondes au plus** (coordonnées répétées) est traité comme une poursuite de l'effort sur le graphique d'allure seulement si la cadence et la puissance restent strictement positives sur tout le gel et si le GPS se déplace avant et après. Le temps écoulé pendant ce gel est conservé dans l'allure et sa durée est signalée sous le graphique. Ce n'est pas une preuve certaine de déplacement ; les gels plus longs, valeurs nulles/absentes et coupures de segment restent des interruptions. Le parcours, les kilomètres GPS et les autres métriques ne sont pas modifiés par cette règle.
