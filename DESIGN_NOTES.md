# TRADEWINDS — Notes de conception

Ce fichier liste les **décisions d'architecture** et **chaque simplification** par rapport au métier réel.
Règle : on simplifie l'interface, jamais la justesse des calculs. Quand le moteur lui-même simplifie,
c'est écrit ici, avec la phase prévue pour corriger.

## Architecture

| Dossier | Rôle |
|---|---|
| `src/engine` | Moteur pur TypeScript, sans DOM, déterministe par seed. Calendrier, modèle de prix, marché, liquidité, marge, trading, physique, trésorerie, news, boucle de jeu. |
| `src/data` | Commodités, villes, contreparties, codex. Ajouter une entrée suffit à l'étendre. |
| `src/render` | Globe Three.js (shaders maison, modèles low-poly générés par code, aucun asset externe). |
| `src/ui` | React + Zustand. Panneaux, HUD, ticket, modales. |
| `src/save` | IndexedDB (auto toutes les 20 clôtures + manuel) et export/import JSON. |

Décisions :
- **Three.js pur plutôt que react-three-fiber** : le globe est une classe autonome (`Globe`) pilotée par `setView()`. Le rendu ne dépend pas de React et React ne re-rend pas la scène 3D.
- **Le moteur mute l'état** au lieu de le recopier (plus simple et rapide, partie sérialisable telle quelle). L'UI incrémente un compteur `rev` après chaque mutation.
- **Pas de Web Worker (phases 1–2)** : une journée simulée prend environ 26 ms avec un livre chargé (5 futures, 15 options), VaR à 400 scénarios comprise (test de performance). Le moteur n'a aucune dépendance au DOM, donc on pourra le déplacer dans un worker sans réécriture (phase 3–4, quand les sociétés IA et le Monte Carlo arriveront).
- **RNG sfc32 sérialisé dans l'état** : même seed + mêmes actions = même partie (testé).
- **Toute la trésorerie passe par `addCash`**, ventilée par catégorie et par commodité, ce qui donne l'attribution du P&L par commodité.

## Modèle de prix

- **Schwartz & Smith (2000), deux facteurs, sous mesure risque-neutre** : `ln S = χ + ξ + s(t)`, où χ est un écart de court terme qui revient vers zéro (κ) et ξ un niveau d'équilibre en marche aléatoire. Le prix futures est l'espérance exacte du spot à maturité, avec une formule fermée pour `A(τ)`.
  - Contango et backwardation émergent naturellement (χ < 0 ou χ > 0), ainsi que l'effet Samuelson.
  - **Pas exact** (discrétisation sans erreur, y compris la covariance χ/ξ sur dt). Tests : propriété de martingale par Monte Carlo (200 000 tirages) et variance du pas comparée à l'intégrale théorique.
  - `μ* = longDrift − ½σξ²`, pour que l'extrémité longue croisse au taux `longDrift`.
- Primes de risque nulles dans le pricing (λ = 0). **Phase 3** : des *narratifs* macro (super-cycle, récession, transition énergétique, surabondance pétrolière) ajoutent, pendant quelques mois, une dérive du facteur long **sous la probabilité réelle seulement** (`market.drift`, ±6 à 20 % par an selon le thème). Les formules de prix ne la voient pas : c'est une prime de risque que le joueur peut capter s'il lit le contexte. Hors narratif, les futures restent un jeu équitable en espérance.
- Saisonnalité : un cosinus déterministe sur le log-prix (pic de janvier pour le gaz et le charbon, creux de récolte pour le blé). **Phase 3** : une composante stochastique s'y ajoute : indice ENSO (El Niño / La Niña) en processus d'Ornstein-Uhlenbeck lent qui pousse le blé et le charbon, ouragans de juin à novembre, moussons, canicules, vagues de froid.
- **Régime de volatilité** : chaîne de Markov calme/stress (×1,8 sur les vols). Au changement de régime, `A(τ)` change, donc la courbe saute légèrement : la propriété de martingale ne tient qu'à l'intérieur d'un régime. C'est volontaire (un choc de vol déplace la convexité).
- **Chocs de news** : sauts additifs sur χ (temporaires) ou ξ (structurels), sans compensateur de drift. Le biais de convexité `e^{½J²}` est négligeable (< 0,3 %).
- **Corrélations** : matrice 6×6 (5 facteurs courts + EURUSD) décomposée par Cholesky. Les facteurs longs utilisent la même structure de corrélation.
- **Différentiels physiques (basis)** : processus d'Ornstein-Uhlenbeck autour d'une moyenne par lieu. **Phase 4** : courbe de basis `b(T) = moyenne + écart·e^{−4τ} + décalage d'événement + lien fret`. L'écart du jour se résorbe avec l'échéance. Le différentiel suit le forward du taux d'affrètement : les prix rendus montent et les prix FOB baissent quand le fret flambe, pondéré par la part de l'affrètement dans le coût d'un voyage (60 %). Les moyennes sont calibrées pour que l'écart entre deux ports d'une grande route ≈ coût complet du fret (±20 %, testé) : l'arbitrage géographique n'est pas gratuit, il s'ouvre sur les chocs.
- **Taux** : un taux plat par devise (USD 4 %, EUR 2,25 % au départ), actualisation continue en ACT/365, intérêts de trésorerie en ACT/360. **Phase 3** : les taux bougent par pas de 25 pb aux réunions de la Fed et de la BCE (biais selon le narratif macro), avec effet sur l'EURUSD et les matières premières. **Phase 7** : courbe zéro-coupon de Nelson-Siegel par devise (voir plus bas).
- **FX** : EURUSD en OU sur le log. Le TTF se règle en EUR, converti en USD au spot du jour. **Simplification** : un seul compte de trésorerie en USD (en réalité, un compte de marge en EUR).

## Contrats

- Dernier jour de cotation fidèle aux règles réelles : Brent (dernier jour ouvré de M−2), TTF (deux jours ouvrés avant M), cuivre LME (3ᵉ mercredi moins deux jours ouvrés), blé CBOT (jour ouvré avant le 15), API2 (dernier vendredi). Tous testés.
- **Simplification** : un seul calendrier de jours ouvrés (week-ends, 1ᵉʳ janvier, 25 décembre) pour toutes les bourses.
- **Phase 4 — livraison bourse** : cuivre (entrepôt agréé de Rotterdam), TTF (hub) et blé (silo de Chicago) se **livrent physiquement** à l'échéance. Le long reçoit et paie la marchandise au prix final ; le court livre depuis son stock dans ce lieu, sinon rachat d'urgence au spot + 3 %. Brent et API2 restent réglés en cash, comme en réalité. **Simplifications** : l'API2 se règle au prix du dernier jour et non sur la moyenne mensuelle de l'index ; pas de procédure d'avis de livraison (notice day) ni de choix de lieu ou de qualité par le vendeur ; l'EFP n'est pas modélisé.
- **Simplification** : cuivre en échéances mensuelles uniquement, sans prompt dates quotidiennes ni cash/3M ni tom-next. *Phase 2.*
- Lot TTF = 1 MW × heures du mois (changements d'heure ignorés). Blé coté en c/bu (valeur 0,01 $ par unité), affiché aussi en tonnes (1 t = 36,7437 bu).

## Liquidité et exécution

- Demi-fourchette = `tick × base × (1 + 0,12·o + 0,01·o²)`, où o est le rang de l'échéance. Profondeur = `depth × e^{−o/8}`. En régime de stress : fourchette ×2, profondeur ÷2.
- Prix d'exécution = mid ± demi-fourchette × (1 + lots/profondeur), arrondi au tick défavorable.
- **Impact permanent (phase 2)** : chaque ordre futures ajoute au contrat traité un décalage log `signe × (demi-fourchette/mid) × (lots/profondeur)`, qui s'applique au prix de règlement (donc à votre propre MTM) et décroît de 65 % chaque nuit. **Simplification** : l'impact reste propre à l'échéance traitée. Il ne se propage pas aux échéances voisines, ni au prix forward du modèle utilisé pour le physique, ni à la vol implicite (les ordres d'options n'ont pas d'impact).
- **Spreads calendaires** : un ordre unique paie 50 % de la demi-fourchette de chaque jambe, sur une profondeur ×1,5.
- Un prix par jour : on traite aux prix du jour (bid/ask), marqués au mid à la clôture.

## Marge et trésorerie

- **Marge initiale SPAN par scénarios (phase 2)**, par commodité, futures + options : 14 scénarios (prix ∈ {0, ±⅓, ±⅔, ±1} × fourchette de scan, vol ±25 %), plus deux extrêmes (±2×, comptés à 35 %), avec revalorisation complète des options. On retient la pire perte, on ajoute une charge de spread intra-commodité de 30 % × min(L, S) sur les futures, puis on retire la valeur nette des options (options achetées en crédit, vendues en charge). Plancher par option vendue. Pour des futures seuls, cela redonne exactement `|L − S| + 30 % × min(L, S)` (testé). Fourchette de scan = quantile 99 % × vol du front × √(3/365). Révision chaque lundi, et en urgence si la vol saute de plus de 25 %. **Simplifications** : pas de crédits inter-commodités ; le choc de vol est relatif (×1 ± 25 %) et non un écart absolu en points.
- **Marge de variation** : réglée en cash à chaque clôture. Les ordres intrajournaliers passent une marge « trade-date » `(mark − p)·Δ`, ce qui rend le P&L exact par lot, quel que soit l'ordre des opérations (testé).
- **Appel de marge** : si `cash < IM` (plus l'éventuel excédent de dette au-delà de la limite) après tirage automatique de la RCF, l'appel est émis. S'il n'est pas couvert à la clôture suivante, le courtier liquide tous les futures. Si cela ne suffit pas, c'est la faillite. Fonds propres négatifs entraînent aussi la faillite.
- **RCF** : limite = 2,5 × fonds propres, plafonnée à 4 × le capital initial (covenant). Taux USD + 2,5 %. La ligne rétrécit quand on perd : c'est la spirale de liquidité.
- Pas de collatéral sur les forwards **physiques** (pratique de marché courante : les accords-cadres physiques n'ont souvent pas de CSA). **Phase 3** : risque de défaut avec close-out netting et assurance-crédit optionnelle ; CSA disponible sur les OTC bancaires (voir plus bas).

## Physique

- Offres de cargaisons à prix fixe = courbe au mois de livraison + diff. Le diff proposé avantage la contrepartie de 0,15 % en moyenne. Sur place, le joueur gagne environ 0,4 % : en espérance, voyager rend les deals rentables, et le téléphone non.
- Livraison le 15 du mois (jour ouvré suivant). Un achat livré entre en stock et se paie comptant. Une vente se sert depuis le stock (même lieu en priorité). Sinon, transfert au coût de la différence de basis moyen, approximation du fret. À défaut de stock, rachat d'urgence au spot + 1,5 %.
- **Phase 4 — fret explicite** : les Incoterms déterminent qui organise le transport. Acheter FOB oblige le joueur à affréter pour revendre ailleurs ; vendre CIF/CFR/DAP l'oblige à livrer à destination (stock sur place ou cargaison arrivée à temps, sinon rachat d'urgence). Les obligations de chaque Incoterm sont affichées sur les offres. Laycan affiché. **Tolérance de quantité ±5/10 % au choix du vendeur**, valorisée comme une option (straddle Black-76 au prix du contrat sur la quantité de tolérance), exercée à la livraison. Surestaries au-delà du temps de planche, pertes en transit, accidents en mer, assurance marine. **Simplifications** : la date de livraison est le milieu du laycan ; le transfert de risque au chargement (CIF/FOB) n'est pas simulé sur les achats rendus ; inspection, qualité et contamination : *phase 7* (voir plus bas).
- **Simplification** : le gaz physique est livré « en bloc » le 15, au lieu d'un flux horaire sur le mois.
- **Phase 4 — stockage** : le tarif du stockage tiers renchérit avec le contango (×(1 + 3 × contango sur 6 échéances)). Les capacités détenues (cuves, entrepôts, silos, stockage de gaz) couvrent le stock sans frais tiers, et la capacité inutilisée est louée au marché (85 % d'occupation). **Simplification** : le stockage tiers reste disponible sans limite (à prix croissant).
- Plafond d'encours physique = 6 × fonds propres (lignes de trade finance).
- Risque de contrepartie : traité en phase 3 (voir plus bas).

## Comptabilité et fiscalité

- NAV = cash − dette + MTM futures (depuis le dernier marquage) + MTM forwards (actualisé) + stocks au spot local.
- Frais généraux mensuels : loyer de la ville + 90 k$ × indice de coût du personnel.
- Impôt annuel sur la variation de NAV de l'exercice (comptabilité en juste valeur, IFRS 9), avec report illimité des pertes. **Phase 3** :
  - le taux de chaque ville évolue avec les élections et les réformes ;
  - deux régimes spéciaux : Singapour à 10 % si le volume physique annuel dépasse 500 M$ ; zone franche de Dubaï à 0 % moyennant une redevance de 250 k$ par an ;
  - transfert de siège possible (1,5 M$ + taxe de sortie de 1 % de la NAV, une fois par an).
  **Phase 5** : retenue à la source sur les dividendes du fondateur selon la ville du siège (Genève 35 %, Londres 0 %, Rotterdam 15 %, Singapour 0 %, Houston et Chicago 30 %, Dubaï 0 %, Shanghai 10 %, Santiago 35 %, Johannesburg 20 %). **Simplification** : taux nominaux, sans conventions fiscales ni crédits d'impôt.

## Rendu

- Textures du globe générées au lancement sur canvas, à partir des tracés de `world-atlas` (Natural Earth 50m, domaine public) : biomes par latitude, hauts-fonds turquoise, lumières nocturnes, nuages.
- Shader maison : éclairage jour/nuit, houle animée, reflet spéculaire sur l'eau, lumières des villes côté nuit, liseré atmosphérique.
- **Choix de jouabilité** : le soleil suit la caméra avec un balancement lent, pour que la face regardée reste lumineuse ; le terminateur balaie quand même le globe.
- Avion : arc de grand cercle surélevé en cloche. Durée en jeu = 1 jour ouvré si le vol fait 9 h ou moins, sinon 2.

## Notions métier ajoutées en avance

Effet Samuelson, crédit de spread SPAN, marge trade-date, révision des marges par la bourse, covenant de RCF, cash-and-carry, rachat d'urgence d'un short physique (squeeze du vendeur à découvert), risque de change sur le TTF, roll des positions.

## Phase 2 — options, risque, conseillers

### Pricing (`engine/pricing.ts`, testé)
- **Black-76** pour les européennes sur futures. Greeks analytiques (delta, gamma, vega pour 1 point, theta par jour calendaire, rho pour 1 %), vérifiés par différences finies et sur une valeur de référence publiée (Haug).
- **Barone-Adesi & Whaley** pour les américaines sur futures (b = 0), prix critique résolu par Newton avec la graine de Haug. Validé contre un arbre **CRR** à 2 000 pas : écart < 0,5 % aux taux du jeu. **Limite connue de BAW** : jusqu'à environ 1,5 % pour des options longues (2 ans) très dans la monnaie à taux élevé (10 %). Greeks américains par différences finies.
- **Volatilité implicite** : Newton sécurisé par bissection.
- **APO (asiatiques sur moyenne mensuelle du spot)** : approximation de Lévy / Turnbull-Wakeman, c'est-à-dire une lognormale ajustée sur les deux premiers moments de la moyenne arithmétique. La **covariance des fixings est exacte sous Schwartz-Smith** (formule fermée `fixingCovariance`). Les fixings passés sont gérés par ajustement du strike ; si le strike ajusté est négatif ou nul, la valeur forward est exacte. Validé par Monte Carlo sur le modèle (40 000 trajectoires) et par la parité call − put = swap.

### Surface de volatilité (`engine/volsurface.ts`)
- σ_ATM(contrat, expiration) = √(variance intégrée du modèle / τ) × `ivLevel` : la structure par terme vient du modèle (effet Samuelson), `ivLevel` porte la prime de variance (moyenne 1,08) et la peur. `ivLevel` suit un processus d'Ornstein-Uhlenbeck, monte sur les gros mouvements et saute avec les news majeures.
- Smile : σ(K) = σ_ATM × (1 + skew·x + courbure·x²), avec x = ln(K/F)/(σ_ATM √τ) borné à ±3. Put skew sur le Brent et le cuivre, call skew sur le TTF, le blé et le charbon. ×1,5 en régime de stress.
- **Simplification** : le smile est une couche de cotation (« sticky moneyness ») superposée au modèle. Le monde simulé n'a pas de dynamique de smile propre, au-delà des sauts de news et des changements de régime qui épaississent les queues. Pas de contrôle formel d'arbitrage de papillon : les paramètres sont choisis petits pour rester convexes sur la grille cotée.
- APO : covariance du modèle × (ivLevel × smile(K))². Approximation de cotation, notée comme telle.

### Instruments
- **Options listées sur futures** : styles et expirations calqués sur les bourses (Brent américaine, 3 jours ouvrés avant le future ; TTF européenne, 5 jours calendaires avant le mois ; cuivre européenne, 1ᵉʳ mercredi ; blé américaine, règle du vendredi CBOT ; API2 européenne, avec le future). Prime payée à l'achat (style ICE), commission par lot, fourchette en points de vol (plus large hors de la monnaie, sur les échéances lointaines et en crise), profondeur décroissante avec la distance au strike.
- Exercice automatique à l'expiration si l'option est dans la monnaie : on reçoit le future au strike (avant la VM du soir), ou un règlement en cash de la valeur intrinsèque si le future a expiré. Exercice anticipé manuel pour les américaines. **Simplification** : pas d'exercice anticipé automatique ; l'assignation d'un vendeur n'a lieu qu'à l'expiration.
- **Swaps sur moyenne mensuelle et APO** de gré à gré avec trois banques fictives, réglés en cash sur la moyenne des fixings spot quotidiens (jours ouvrés du mois). Fourchette banque : 2× celle du future voisin pour un swap, 1,5 point de vol pour une APO. Plafond d'encours OTC de 3× les fonds propres. **Simplification** : pas de CSA ni de risque de défaut bancaire (phase 3) ; l'index de fixing est le spot du modèle.

### Risque (`engine/risk.ts`, `engine/limits.ts`)
- **VaR et ES 99 % à 1 jour** par Monte Carlo avec revalorisation complète : 400 scénarios tirés de la dynamique du modèle (χ/ξ corrélés, différentiels, EURUSD, vol implicite), sur un horizon de 1,4 jour calendaire. Les scénarios d'un jour donné sont fixés (graine propre, aléa de la partie non consommé), ce qui rend la VaR incrémentale d'un ordre stable. VaR « seule » par commodité, ce qui montre l'effet de diversification. **Simplification** : pas de changement de régime ni de saut dans les scénarios de VaR ; les stress tests couvrent ces cas.
- **Stress tests** : six scénarios déterministes (krach pétrolier, hiver glacial, ralentissement chinois, sécheresse, choc de vol, dollar fort).
- **Greeks agrégés** par chocs : delta et gamma par dérivée en log-prix (choc parallèle de ξ, tous les prix de la courbe ±0,5 %) ; vega par +1 point de vol ; theta « prix inchangés » (options et APO uniquement : les futures n'ont pas de theta) ; rho par +1 % de taux.
- **Échéancier des deltas** par mois (futures, forwards actualisés, stocks au mois courant, options, swaps au prorata des fixings restants, APO par sensibilité).
- **Couverture delta en un clic** : lots = −delta(+1 %) / delta(+1 %) d'un lot de l'échéance choisie. Couverture de premier ordre : gamma, base et calendrier restent, et c'est voulu, c'est la leçon.
- **Limites** :
  - covenant bancaire, VaR ≤ 8 % des fonds propres : avertissement à J1, gel de la RCF et marge +1 % à J3, ligne divisée par deux à J7, retour à la normale quand la VaR repasse sous la limite ;
  - limites internes (VaR, stop-loss mensuel, delta par commodité) avec mode « discipline stricte » : l'ordre est exécuté puis annulé s'il aggrave une limite dépassée ;
  - limites de position des bourses (mois spot et toutes échéances nettes).
  En Sandbox « ma société », le joueur est le patron (covenant et limites internes). **Phase 5** : en salarié (Histoire ou Sandbox « trader salarié »), les dépassements de limites de l'employeur entraînent convocation, gel du livre puis licenciement (voir plus bas).

### P&L expliqué (`engine/explain.ts`)
- Décomposition quotidienne du livre de la veille en prix, base, change, vol et temps, chaque instrument dans ses propres coordonnées (forward du contrat, basis, actualisation, vol au strike, maturité). Le résidu « deals & coûts » rend le total exact (testé). Pour les options, l'ordre est séquentiel (prix → vol → temps).
- **Simplification** : pour les APO, l'attribution est au premier ordre (theta et vega de la veille, avec une conversion approximative du choc de niveau de vol en points), le reste allant dans « prix ».

### Conseillers (`engine/advisors.ts`)
- Cinq personnages originaux (risk, trader, analyste, opérations, juriste), avec des règles déterministes qui lisent l'état. Au plus 3 conseils par jour, un délai minimum par règle, et une priorité colère > inquiétude > le reste.
- Ils se contredisent volontairement (risk « coupe » contre trader « tiens bon »). Les paris directionnels du trader sont évalués à 10 jours ouvrés (palmarès affiché) : le monde étant martingale, il a raison environ une fois sur deux. C'est la leçon. Les conseils de portage de l'analyste sont calculés exactement (courbe − stockage − financement − frictions).

### Sauvegardes
- Version 2. Les sauvegardes v1 sont migrées automatiquement (champs ajoutés avec leurs valeurs par défaut).

## Phase 3 — événements, géopolitique, réglementation, concurrents, contreparties

### Moteur d'événements (`engine/events.ts`, `engine/world.ts`)
- Une trentaine de modèles d'événements avec probabilité quotidienne, saison, conditions, délai minimum entre deux occurrences et pondération par la tension entre blocs pour les événements géopolitiques. Au plus deux événements aléatoires par jour.
- Les impacts sont des données (`Impact`) appliquées par une seule fonction : facteurs χ/ξ, vol implicite, différentiel, régime de vol, taux, suspension de cotation, stabilité, tension, fiscalité, KYC, reporting, contrôle des capitaux, sanctions, embargos, narratifs, ENSO, effets visibles sur le globe, chocs sur une société, défaut, gel de trésorerie, fraude en entrepôt.
- **Rumeurs** : 40 % de l'impact est intégré tout de suite ; la confirmation apporte le reste, le démenti l'annule exactement (testé). Il y a aussi de fausses nouvelles pures.
- **Impacts différés** : prévision puis frappe (ouragans), fuite puis décision (cartel), étapes de suite (réouverture d'un canal, retour d'un différentiel).
- **Calendrier** : cartel des producteurs environ toutes les 8 semaines, avec une fuite parfois trompeuse 3 jours avant ; Fed et BCE environ toutes les 6 semaines ; élections dans chaque pays réel tous les 4 à 5 ans.
- **Remakes historiques** (noms et détails modifiés) :
  - saturation des stockages (le front du Brent s'effondre) ;
  - squeeze sur le cuivre avec suspension de cotation ;
  - double nantissement en entrepôt à Shanghai (une partie du stock du joueur peut disparaître) ;
  - faillite d'un négociant asiatique qui cachait ses pertes ;
  - enquêtes pour corruption ;
  - canal bloqué par un porte-conteneurs ;
  - sanctions massives puis plafond de prix sur un grand producteur ;
  - interdiction d'export de minerai brut ;
  - embargo charbon d'un importateur contre un exportateur ;
  - El Niño / La Niña, ouragans dans le Golfe, explosion de raffinerie, coup d'État dans un pays minier.
- **Simplification — prix négatifs** : le modèle lognormal ne peut pas produire de prix négatif. Le remake « pétrole à prix négatif » est un effondrement du front avec un contango extrême. **Phase 8** : le WTI utilise une log-normale décalée, qui peut devenir négative (voir plus bas).
- **Simplification — suspension** : pendant une suspension, les prix publiés sont figés et tous les chocs (marché et news) s'accumulent, puis tombent à la réouverture. Il n'y a pas d'annulation rétroactive des transactions de la journée (contrairement à l'épisode réel du nickel). Seuls les futures et options de la commodité sont bloqués ; le physique continue.
- **Délits d'initiés** : informations obtenues en avance par les relations, traitées en phase 5 (voir plus bas). La conformité complète (procédures, sanctions de la société, contrôles automatiques) : *phase 7* (voir plus bas).

### Géopolitique et réglementation
- **Zones** : les 9 pays réels des villes, plus 5 zones de production fictives remaniées (Fédération de Sarmatie, Royaumes du Golfe, République du Kassaï, Tauride, Archipel d'Insulinde), chacune avec un bloc et une stabilité qui dérive et réagit aux événements. Tension entre blocs de 0 à 100.
- **Sanctions selon la juridiction du siège** : régime occidental (Genève, Londres, Rotterdam, Houston, Chicago), ONU seulement (Singapour, Santiago, Johannesburg ; ne s'applique qu'aux sanctions totales en période de très forte tension), oriental (Shanghai), aucun (Dubaï).
  - Sanctions totales : les offres des entités visées disparaissent, et les contrats en cours sont **frustrés** (force majeure, annulés sans indemnité, le MTM disparaît).
  - Plafond de prix : achat autorisé uniquement sous le plafond. Les barils sanctionnés se négocient avec une décote de 15 à 25 %.
  - **Simplification** : traiter des barils sanctionnés depuis Dubaï : sanctions secondaires traitées en *phase 7* (voir plus bas).
- **Embargos et interdictions d'export** : les offres concernées sont filtrées, les différentiels régionaux s'écartent.
- **Réglementation par ville**, évolutive :
  - impôt ;
  - exigence KYC (contrepartie à risque = notée BB ou moins, ou pays de stabilité < 50) : délai d'1 à 3 jours ouvrés avant de pouvoir traiter, ou exclusion pure dans une juridiction très stricte ;
  - coût de déclaration des dérivés par transaction, facturé chaque mois ;
  - contrôle des capitaux : financement +0,5 %, et risque de gel de 20 % de la trésorerie pendant 10 jours.
- **Simplification** : bureaux dans d'autres villes : *phase 8* (licence locale payée à l'ouverture, sans régulation propre au bureau). Le siège peut être transféré.

### Sociétés concurrentes (`engine/companies.ts`)
- 28 sociétés simulées (maisons de négoce, bras trading des majors, maisons agricoles, mineur, 3 banques, 2 fonds) et 10 contreparties à notation fixe (producteurs, utilities, coopératives), dont 4 issues des zones fictives.
- Chaque jour : P&L = expositions × rendement du marché + marge commerciale bruitée − frais. Rééquilibrage tous les 4 à 8 jours selon les desks, l'appétit, un levier par métier et un signal (tendance + conviction propre).
- Notation dynamique (santé financière, réputation). Faillite sous 20 % des fonds propres initiaux (10 % pour les acteurs moins risqués). Scandales via les événements.
- Rachats : les contrats du joueur passent chez l'acheteur par **novation**. Débauchages et gros deals génèrent des news.
- **Faillite** : liquidation forcée de ses expositions (choc de prix proportionnel à la taille), résiliation et compensation des contrats du joueur.
- **Concurrence sur le physique** : une offre avantageuse a 25 % de chances par jour d'être raflée par un concurrent.
- Classement (joueur inclus) et **rival nominatif** (maison de la même ville au profil le plus proche, avec son trader vedette).
- **Simplification** : les concurrents n'ont pas de livre détaillé (expositions agrégées par commodité) et n'interagissent pas avec le carnet des futures, sauf choc de liquidation. Débauchage du joueur par les chasseurs de têtes : phase 5. Recrutement par le joueur de ses propres équipes : *phase 8* (voir plus bas).

### Risque de contrepartie (`engine/credit.ts`)
- Probabilités de défaut annuelles par notation (AAA 0,01 % … B 4 %, CCC 15 %), doublées en régime de stress. Les contreparties non simulées sont dégradées par l'instabilité de leur pays.
- **Close-out netting** par contrepartie, avec deux ensembles distincts : physique (accord type GTMA/EFET) et OTC (ISDA). Montant net dû au joueur : récupération de 35 %. Montant dû par le joueur : payé intégralement. Testé, y compris le cas où on doit de l'argent.
- **Assurance-crédit** : 0,4 % par an de l'encours physique, couvre 90 % de la perte de défaut sur le physique.
- **CSA par banque** : collatéral égal à −MTM net des OTC avec cette banque, échangé chaque soir. La NAV ne bouge pas, mais le cash, oui (liquidité). Le défaut de la banque devient alors quasi sans perte (testé). Sans CSA, la banque facture une **CVA** (fourchette ×1,3).
- **Simplifications** : seuil et montant minimum de transfert du CSA nuls ; récupération fixe à 35 % ; lettres de crédit : *phase 7* ; garanties bancaires de bonne fin non modélisées.

### Interface
- Panneaux **Actualités** (filtres par catégorie, statut rumeur / confirmé / démenti, impacts, calendrier des réunions), **Monde** (tension, taux, ENSO, narratifs, sanctions, zones, comparaison réglementaire, transfert de siège) et **Concurrents** (classement, fiches, expositions, assurance, CSA, défauts subis).
- Calques du globe : tensions (pays et zones colorés par stabilité), sanctions, météo (marqueurs animés), prix (variation du jour par hub), concurrents (badges des sièges, rival entouré). Routes et stocks : phase 4.

### Sauvegardes
- Version 3. Migration automatique depuis les versions 1 et 2.

## Phase 4 — logistique, fret, actifs industriels, automatisation

### Fret (`engine/freight.ts`, `data/freight.ts`)
- Quatre indices de taux d'affrètement (TCE, $/jour) : Capesize, Panamax, Supramax, Aframax. Modèle de Schwartz à un facteur sur le log, simulé sous la mesure de pricing, avec formule fermée du forward. μ est choisi pour que l'espérance stationnaire vaille la moyenne de l'indice. Martingale vérifiée par Monte Carlo. Vol de 55 à 75 % par an, retour à la moyenne rapide.
- **FFA** : swaps compensés sur la moyenne mensuelle de l'indice quotidien. Marge de variation chaque soir (avec marge « trade-date »), marge initiale de 25 % du notionnel, commission de 0,25 %. Règlement total = jours × (moyenne − prix) (testé).
- Événements de fret : mer Rouge fermée (détour par le Cap), sécheresse à Panama, boom ou surcapacité du vrac, flotte fantôme et pétroliers. Le canal bloqué de la phase 3 ferme désormais réellement Suez.
- **Simplifications** : pas de saisonnalité du fret ; indices indépendants entre eux et des commodités (le lien passe par les soutes indexées sur le Brent et par les différentiels) ; méthaniers (indice LNGC) et GNL JKM : *phase 8*.

### Logistique (`engine/logistics.ts`, `data/routes.ts`)
- Graphe maritime de 38 nœuds réels (ports, détroits, canaux, caps), plus court chemin par Dijkstra. Les passages fermés par un événement (Suez, Bab-el-Mandeb, Panama…) imposent le détour (testé : Fujairah–Rotterdam passe par le Cap si Suez est fermé). Pré-acheminement par barge de Chicago au Golfe.
- **Devis d'expédition** :
  - affrètement au voyage (TCE × (jours de mer × 1,6 pour le retour à vide + 4 jours d'escale) × part du navire, +15 % pour un lot partiel) ;
  - soutes (consommation × prix indexé sur le Brent) ;
  - frais de port, manutention par tonne, assurance marine (0,12 %) ;
  - financement de la marchandise pendant le voyage ;
  - arbitrage = valeur forward à destination à l'arrivée (pertes déduites, actualisée) − valeur spot à l'origine − coûts.
  Avec un navire de notre flotte : pas de loyer, mais le coût d'opportunité (loyer de marché non perçu) est affiché.
- **Voyages** :
  - la cargaison quitte le stock, le fret est payé, le navire suit la route sur le globe ;
  - la cargaison en mer est valorisée au forward de destination (incluse dans la NAV, la VaR, le P&L expliqué et l'exposition) ;
  - retard si un passage fermé est encore devant le navire ;
  - accidents (perte remboursée à 99 % si assurée) ;
  - à l'arrivée, congestion portuaire aléatoire (plus forte en crise) : surestaries au-delà de 2 jours de planche, au TCE × 1,1 ;
  - pertes en transit (0,1 à 0,2 % selon la marchandise).
- **Simplifications** : un navire qui doit franchir un passage fermé attend (pas de déroutement en cours de route) ; la route est fixée au départ ; les trains et pipelines sont décoratifs (pas de capacité ni de tarif), sauf la barge de Chicago.

### Actifs industriels (`engine/assets.ts`, `data/assets.ts`)
- 18 actifs fictifs : 3 gisements, 2 mines de cuivre, 2 mines de charbon, raffinerie, cuves, entrepôt de métaux, 2 silos, stockage de gaz, terminal charbonnier, 4 navires.
- Modes d'entrée :
  - acquisition (100 % ou coentreprise 20 à 50 %) au prix DCF ± bruit ;
  - construction (CAPEX, délai, 30 % de risque de dépassement de 10 à 40 %) ;
  - stream (10 % de la production payée 20 % du spot) ;
  - royalty (2 % du chiffre d'affaires) ;
  - offtake prépayé (prépaiement remboursé en cargaisons avec décote : risque de crédit du producteur, avec netting et récupération en cas de défaut) ;
  - affrètement à temps d'un navire.
- **Exploitation quotidienne** :
  - production = capacité × utilisation × part × déclin, avec coûts variables et fixes ;
  - production vendue au spot (automatisation) ou mise en stock, donc à couvrir ;
  - raffinerie : marge de raffinage (crack). *Phase 8* : calculée sur les vrais marchés de produits (gazole, essence, kérosène, fioul) ;
  - stockage : capacité pour le joueur, le reste loué au marché ;
  - stockage de gaz géré : injection d'avril à septembre, soutirage de novembre à mars ;
  - terminal : redevances ;
  - navire : loué au TCE du marché, ou réservé à nos voyages.
- **Risques** :
  - usure (l'état baisse avec l'utilisation) ; accident (probabilité ×(1 + (50 − état)/25) × facteur manager), réparation de 2 à 6 % du CAPEX, amende environnementale dans 30 % des cas pour mines, gisements et raffinerie ;
  - grèves (plus fréquentes en pays instable) ;
  - **nationalisation** : (45 − stabilité)/45)² × 75 % par an sous une stabilité de 45, indemnisation de 0 à 35 % de la DCF ;
  - interdiction d'export du pays : production arrêtée.
- **Comptabilité** : valeur comptable = coût amorti linéairement ; test de dépréciation mensuel (DCF < 75 % de la valeur comptable ⇒ dépréciation). La NAV n'est pas marquée au marché sur les actifs, comme dans de vrais comptes. Cession à environ 92 % de la DCF.
- **DCF** : flux mensuels sur la courbe forward (forward + basis − coûts) sur la durée de vie restante (30 ans maximum), actualisés au taux sans risque + 4,5 % + jusqu'à 10 % selon l'instabilité du pays. Les CAPEX sont calibrés autour de 80 % de la DCF typique (construire peut créer de la valeur, mais le délai, le dépassement et la courbe sont des risques).
- **Managers** (PNJ générés) : compétence, salaire, spécialité. La politique prudente, équilibrée ou agressive fixe l'utilisation, le seuil de maintenance et la couverture mensuelle de la production par swaps (80 / 50 / 0 % sur 3 mois). Le facteur d'accident vaut 1,5 − compétence/100. Les erreurs (maintenance reportée, sur-régime) ont une probabilité proportionnelle à l'incompétence.
- **Simplifications** :
  - un navire affrété à temps n'est pas inscrit au bilan (IFRS 16 non appliqué) ;
  - *phase 8* : usines de trituration, centrale à cycle combiné et fonderie d'aluminium ; toujours pas de fonderie de concentrés (pas de marché des concentrés) ;
  - coentreprises sans gouvernance (pas de vote des partenaires) ;
  - les concurrents ne possèdent pas d'actifs modélisés.

### Automatisation (`engine/automation.ts`)
- Trésorerie (existante) ; roll des futures 2 jours ouvrés avant le dernier jour de cotation ; couverture de base (futures du 2ᵉ mois pour ramener la couverture du physique au ratio cible au-delà d'un seuil) ; logistique (affrètement au dernier moment raisonnable pour honorer les ventes livrables à destination) ; vente de la production ; assurance marine. Les règles sont volontairement simples : risque de base et de calendrier non couverts.

### Rendu
- Trafic maritime d'ambiance instancié (36 navires sur les grandes routes réelles) et cargaisons du joueur sur leur route, avec sillage pointillé. Calque des routes (graphe complet). Rails, barges et pipelines lumineux ; le gazoduc sarmate vire au rouge sous sanctions. Actifs du joueur en 3D low-poly animés (balancier du derrick, torchère), avec un anneau de statut. Calque « stocks ».

### Sauvegardes
- Version 4. Migration automatique depuis les versions 1 à 3.

## Phase 5 — mode Histoire : carrière, PNJ, relations, création de société

### Architecture
- `GameState.career` (null en Sandbox « ma société ») décrit le personnage :
  - statut (salarié, sans emploi, fondateur, CEO), employeur, filière, niveau ;
  - salaire, **patrimoine personnel** distinct de la société ;
  - 6 compétences, réputation, mérite, avertissements, sanctions, offres d'emploi, équipe, actionnariat.
- **Livre alloué** : un salarié qui trade gère `state.company` comme un livre doté par l'employeur. Le capital dépend du niveau : 8 M$ en junior, 25 M$ en trader, 60 M$ en senior, 150 M$ en head of desk, 400 M$ en direction. Pas de frais généraux, d'impôt ni de reporting à sa charge. Les marges sont financées par la trésorerie de l'employeur (ligne interne). Le P&L du livre est reversé chaque jour à la société simulée de l'employeur. Tout le moteur des phases 1 à 4 reste utilisé tel quel.
- **Droits** selon le niveau, vérifiés avant toute action :
  - stagiaire et analyste ne tradent pas ;
  - junior : futures et spreads de son desk ;
  - trader : + options et physique ;
  - senior : + OTC, FFA, expéditions ;
  - head of desk : toutes les commodités ;
  - direction : actifs, trésorerie, CSA ;
  - limites internes et transfert de siège : réservés au CEO ou au fondateur.
  Les filières hors trading ne tradent pas.
- **Départ, licenciement, transfert** : le livre est soldé au prix de marché et repris par l'employeur (simplification : pas de passation progressive).
- **Sandbox « trader salarié »** : même mécanique, niveau trader, capital choisi, sans narration ni promotions, mais avec la discipline des limites.

### Progression
- Cinq filières (trading, risques, opérations, financement structuré, recherche), 8 niveaux chacune : de stagiaire à la direction de la filière, puis CEO.
- **Évaluations semestrielles** (janvier et juillet) :
  - note = 45 % performance + 25 % compétence de la filière + 30 % confiance du manager − 8 points par sanction ;
  - performance en trading : rendement annualisé du livre et de l'équipe face à un objectif de 8 %/an ; hors trading : mérite accumulé dans les situations ;
  - promotion si note ≥ 65 et ancienneté minimale dans le poste ; avertissement sous 40, licenciement au second ;
  - le stage se transforme en poste d'analyste si la note atteint 45, sinon il prend fin.
- **Bonus annuel** : trading = P&L positif × taux selon le niveau × (0,6 + confiance du manager/125) ; hors trading = salaire annuel × note × 30 %. Négociable en mini-jeu.
- **Discipline des limites** (VaR 3 %, stop-loss mensuel 8 %, delta 4 % du capital alloué) : chaque dépassement vaut une convocation et une sanction (une au plus tous les 3 jours) ; au 3ᵉ ou en cas de stop-loss, gel du livre 10 jours ; au 5ᵉ, licenciement. Une sanction est effacée chaque trimestre sans incident. Perte supérieure à 20 % du capital alloué, ou liquidation après appel de marge : licenciement.
- **CEO** : au niveau direction, avec une note ≥ 80 et une réputation ≥ 60, le conseil propose la direction générale. La société simulée de l'employeur devient celle du joueur (capital = ses fonds propres) et tout le mode société s'ouvre. Le conseil démet le CEO si la NAV recule de plus de 25 % sur l'année. **Simplification** : les positions agrégées de la société simulée ne sont pas transférées (on démarre en cash).
- **Marché de l'emploi** :
  - les chasseurs de têtes apportent des offres chaque mois, selon la réputation et leur confiance ;
  - le joueur peut aussi postuler ;
  - la chance de réussir l'entretien dépend des compétences, de la réputation, des références (meilleur ancien manager), du contact dans la société et de la préparation ;
  - une offre ferme sert de **levier réel** dans toute négociation.
  Démission et transfert de filière (si le manager soutient la demande et que les compétences suffisent) sont possibles.
- Coût de la vie mensuel selon la ville, épargne rémunérée à 3 %/an.

### PNJ et relations (`engine/npcs.ts`)
- Générés par la graine :
  - un contact par société du monde (client ou banquier) ;
  - chasseurs de têtes, journalistes, officiels, investisseurs ;
  - chez l'employeur : manager, collègues, risk manager, conformité, mentor.
- Chaque PNJ a une confiance (−100..100), une honnêteté, une ambition, un intérêt propre et une **mémoire** (les 12 dernières interactions avec leur effet). Les relations s'érodent lentement vers la neutralité.
- Effets :
  - un contact de confiance propose de meilleurs différentiels (jusqu'à 0,3 % du prix) et des offres qui durent plus longtemps ; chaque deal conclu renforce la relation ;
  - les chasseurs apportent des offres, les banquiers fixent la ligne du futur fondateur, les investisseurs suivent ;
  - un témoin devenu hostile double la probabilité d'enquête sur une compromission qu'il connaît ;
  - un déjeuner en personne compte double par rapport à un appel vidéo : il faut voyager.

### Situations (`engine/situations.ts`)
- 20 modèles procéduraux tirés au sort selon le poste, la filière et le contexte, avec un délai entre deux occurrences du même modèle :
  - générales : demande d'un senior, erreur à rattraper, appel client, proposition de corruption, journaliste, conférence, collègue qui s'attribue votre travail, mentorat, banquier, contournement de sanctions, manipulation de cours, réclamation qualité, inspection du régulateur, conflit d'équipe ;
  - propres aux filières : trader voyou (risques), surestaries (opérations), prépaiement (financement), notes de recherche jugées trois mois plus tard (recherche) ;
  - générées par d'autres mécaniques : chasseur de têtes, entretien, promotion, bonus, convocation du risk management, avertissement, tuyau, enquête.
- Les situations urgentes mettent le jeu en pause ; une situation ignorée est résolue par défaut, avec un léger malus de relation.
- **Conséquences différées** : certaines situations en programment d'autres des mois plus tard (prépaiement sans garantie qui tourne mal, bilan d'une note de recherche).

### Compromissions et enquêtes
- Chaque raccourci éthique laisse une **compromission** : type, gravité 1 à 5, témoins. Une enquête peut s'ouvrir au plus tôt 4 mois après ; probabilité quotidienne = gravité² × 0,006 %, ×2 si un témoin est hostile, ×1,5 si la presse ou le régulateur est au courant. Pour une gravité 5, cela donne environ 15 % par an.
- Le joueur choisit coopérer, nier ou engager un avocat. Issues : amende (proportionnelle au patrimoine), réputation, licenciement, **interdiction d'exercer** ou **prison** (fins de partie).
- **Tuyaux** : un PNJ de confiance peut annoncer un mouvement. S'il est réel, l'impact est réellement programmé sur le marché quelques jours plus tard ; sinon c'est une fausse piste (fiabilité liée à l'honnêteté du PNJ). Si l'information est **privilégiée** et que l'exposition du joueur bouge dans le sens annoncé avant publication, un délit d'initié (gravité 4) est enregistré.
- **Simplification** : pas de procès en plusieurs étapes ni d'appel ; conformité interne et procédures en plusieurs étapes avec appel : *phase 7*.

### Négociation en mini-jeu (`engine/negotiation.ts`)
- Cinq tours au plus et une jauge de patience. Coups : ancrer, concéder, bluffer, argumenter, accepter, rompre. La contrepartie a une limite cachée qui dépend de la confiance, de la compétence de négociation, de la présence physique (deals) et du levier. Le résultat ne dépasse jamais cette limite (testé). Bluff éventé : −12 de confiance.
- Utilisée pour : salaire (promotion, augmentation, offre d'emploi), bonus, différentiel d'une offre physique (une tentative par offre, en Sandbox aussi), part du capital cédée aux investisseurs.

### Création de société
- Conditions : patrimoine ≥ 500 k$ (80 % investis), réputation ≥ 30.
- Levée de fonds : négociation de la part cédée à chaque investisseur ; le capital proposé dépend de la réputation et de la confiance. Ligne bancaire × (0,7 + confiance moyenne des banquiers/100 + réputation/200), bornée entre 0,4 et 1,6.
- Le fondateur fixe un taux de distribution. Dividendes annuels sur le bénéfice : sa part après retenue à la source va dans son patrimoine. Les investisseurs attendent au moins 20 % de distribution.
- **Simplification** : pas de gouvernance (pas d'éviction du fondateur par des investisseurs majoritaires), pas de valorisation de la part du fondateur dans un score.

### Sauvegardes
- Version 5. Migration automatique depuis les versions 1 à 4 (les PNJ sont générés à la migration).

## Phase 6 — vue ville 3D, bureaux, personnalisation

### Vue ville (`render/CityView.ts`, `ui/CityCanvas.tsx`)
- **Zoom continu** : zoomer au maximum sur une ville du globe (ou bouton 🏙️, touche `H`) déclenche un plongeon de la caméra vers la ville. Le globe se met en pause et la vue ville prend le relais par une descente depuis le ciel, dans le brouillard. Dézoomer au maximum dans la ville (ou `Échap`) fait remonter la caméra et revenir au globe, au-dessus de la même ville.
- **Ville low-poly générée** à partir de l'identifiant de la ville, donc stable d'une partie à l'autre. Elle comprend un quartier d'affaires plus haut au centre, des parcs, des rues avec marquage, des voitures et environ 140 passants (PNJ) sur les trottoirs.
  - Ville portuaire : front de mer avec quais, grues, conteneurs et porte-conteneurs en mouvement.
  - Autres villes : fleuve ou lac, avec ses ponts.
  - Immeubles : un seul `InstancedMesh` avec un shader maison (fenêtres procédurales en coordonnées monde, éclairées au crépuscule). Quelques milliers de faces, une seule draw call.
- **Siège du joueur** (sa géométrie suit le palier) :

  | Palier | Rendu |
  |---|---|
  | Étage loué | Un plateau aux couleurs de la société dans un immeuble partagé, avec une plaque dans le hall |
  | Plusieurs étages | Trois étages, enseigne sur le toit |
  | Tour | Tour de verre en gradins, couronne, hall vitré, fontaine |
  | Campus | Tour plus haute, pavillons à toits végétalisés, passerelles, jardins |

  Sur le siège, on voit aussi :
  - les objets de prestige extérieurs : sculpture (œuvre d'art) sur le parvis, héliport avec hélicoptère, dôme de l'auditorium ;
  - un drapeau si la société est propriétaire de son immeuble ;
  - le personnel devant l'entrée.
- **Sièges des concurrents** de la ville (les plus grands d'abord), avec leur couleur et une hauteur liée à leur VL.
- **Salaire et employeur** : un salarié voit le siège de son employeur, dont le palier est déduit de la VL de la société simulée.
- **Salle de marché** : on y entre en cliquant sur le siège. Elle est rendue dans une scène séparée, en maison de poupée.
  - Le nombre de rangées et de bureaux dépend du palier.
  - Les traders occupent les postes réellement utilisés ; ils tournent la tête, et d'autres circulent dans les allées.
  - Les écrans affichent des graphiques ; le tableau ou le mur d'écrans affiche les **vrais prix du jour** et leur variation.
  - Le style change matériaux, lumière et décor : boiseries et lampes de banquier, open space clair et plantes, bunker sombre éclairé par les écrans, verrière à structure dorée.
  - Les objets de prestige sont visibles : maquettes de navires, tableau, salon, tableau blanc de l'académie, cantine.
- **Lumière** : elle suit la séance. Matin clair, crépuscule en fin de journée, fenêtres qui s'allument.

### Bureaux (`engine/offices.ts`, `data/offices.ts`, testés)
- **Paliers** :

  | Palier | Loyer (× loyer de la ville) | Postes | Agencement | Bailleur exige une VL d'au moins |
  |---|---|---|---|---|
  | Étage loué | ×1 | 8 | 0,25 M$ | — |
  | Plusieurs étages | ×3 | 20 | 1,5 M$ | 40 M$ |
  | Tour | ×8 | 60 | 6 M$ | 120 M$ |
  | Campus | ×16 | 150 | 18 M$ | 400 M$ |

  Les agencements sont ajustés du coût local (0,6 + 0,4 × indice du coût du personnel). La condition de VL représente la solvabilité exigée du preneur. On ne déménage pas plus d'une fois tous les deux mois.
- **Postes** occupés : l'équipe de base (3), un poste par gérant d'actif en fonction, un opérateur par automatisme actif. Au-delà de la capacité :
  - coworking de débordement à 6 k$ par poste et par mois (× indice du coût du personnel) ;
  - prestige −4 par poste en trop.

  La croissance (actifs, automatisation) pousse donc à s'agrandir.
- **Comptabilité exacte** (tests) :
  - **Capex capitalisés** : agencements et réaménagements de style sont amortis linéairement sur 60 mois. Le jour de la dépense, la VL ne bouge pas : le cash devient un actif. Elle baisse ensuite avec l'amortissement.
  - **Déménagement** : la valeur nette restante des anciens agencements passe en perte. Un nouveau style démonte l'ancien.
  - **Achat de l'immeuble** (tour, campus) :
    - prix = loyer annuel / taux de capitalisation de 6 % ; la VL ne change pas le jour de l'achat ;
    - le bâti (60 % du prix) s'amortit sur 40 ans, soit 1,5 % par an, le terrain non ; plancher de valeur à 40 % ;
    - charges de propriétaire 1,2 % par an ; plus de loyer ;
    - revente (cession-bail) à la valeur nette moins 3 % de frais.
  - **Louer ou acheter** : le panneau compare le loyer annuel au coût complet de la propriété (taux USD courant + charges + usure). À 4 %, acheter coûte un peu plus cher que louer. Le choix se joue sur le prestige (+5), la trésorerie immobilisée (qui ne sert plus de marge) et l'anticipation des taux. Une entrée du codex est consacrée à ce choix.
  - **Œuvre d'art** : valorisée à 75 % de son prix, soit la juste valeur nette des frais d'enchères. La VL perd 25 % le jour de l'achat ; l'œuvre est revendable.
  - Le loyer, les charges, le débordement et la conférence sont prélevés avec les frais généraux mensuels. L'ancien « loyer + équipe » devient « équipe » plus le module bureaux, avec un loyer identique au palier 0 : les parties existantes ne changent pas.
  - Les investissements ont leur propre catégorie de flux de trésorerie (« Bureaux »).
- **Styles de salle de marché** (le réaménagement coûte le prix de base × l'échelle du palier : 1 ; 2,5 ; 6 ; 14) :

  | Style | Effet | Prestige |
  |---|---|---|
  | Classique | relations +15 % | +6 |
  | Open space | progression des compétences +25 % | +2 |
  | Salle blindée | erreurs des gérants d'actifs −35 % | 0 |
  | Verrière | négociations ×1,3 | +10 |

- **Prestige** (0–100) : palier (5 / 15 / 32 / 50) + style + objets + 5 si propriétaire − pénalité de débordement. **Il ne modifie jamais un prix de marché.** Il agit uniquement sur les humains :
  - **Recevoir au siège** (`INVITE_HQ`, le joueur doit être au siège) : gain de confiance = 5 × (0,6 + P/60) × multiplicateurs (style, salon) × (1 − confiance/120). Cela coûte 4 k$ et partage le délai des rendez-vous. Au-delà de 40 de prestige, le contact repart « impressionné ». La confiance améliore ensuite les offres physiques, le crédit, les tuyaux…
  - **Négociation des contrats physiques** : la concession maximale du client augmente de P/100 × 15 pb, et de moitié seulement si le joueur n'est pas au siège ; ×1,3 avec la verrière.
  - **Levée de fonds** : prix de réserve des investisseurs −P/600.
  - **Talents** : chaque mois, probabilité min(0,7 ; P/120 + 15 % avec la cantine) d'une candidature spontanée de gérant. Sa compétence vaut 50 + 30u + P/5 (+5 avec l'académie) ; son salaire est réduit de 10 % avec la cantine.
- **Objets de prestige** :

  | Objet | Coût | Effet |
  |---|---|---|
  | Maquettes et trophées | 0,12 M$ | prestige +3 |
  | Mur d'écrans | 0,45 M$ | prestige +3, erreurs des gérants −10 %, cours en direct dans la salle |
  | Salon de réception | 0,6 M$ | invitations ×1,5 |
  | Cantine et sport | 0,9 M$ + 18 k$/mois | candidats −10 % de salaire et plus nombreux |
  | Académie interne | 1,2 M$ + 25 k$/mois | compétences +20 %, gérants en poste +0,4 point par mois |
  | Œuvre d'art | 2,5 M$ | prestige +10 |
  | Héliport (tour) | 3,5 M$ | vols au départ du siège : 1 h de moins, ce qui fait passer certains vols sous 9 h, donc arrivée un jour plus tôt |
  | Auditorium (campus) | 8 M$ | conférence annuelle en janvier (0,6 M$) : confiance +4 avec tous les contacts, réputation +3 |

- **Transfert du siège** : l'immeuble est vendu, les agencements et objets fixes sont perdus, l'art déménage. De nouveaux agencements sont payés au même palier, et ce coût s'ajoute au coût du transfert.
- **Carrière** : un salarié n'a pas la main sur les bureaux (actions réservées à la direction). Créer sa société repart d'un étage loué ; devenir CEO donne le siège de l'employeur, au palier correspondant à sa taille.
- **Aléa sans état** : les candidatures spontanées utilisent un tirage haché (seed, jour, motif) qui ne consomme pas la séquence aléatoire principale. Le marché d'une partie reste identique à celui d'avant la phase 6, à seed et actions égales.
- **Simplifications** :
  - pas de retraitement IFRS 16 du bail (droit d'utilisation et dette locative) : sans effet sur la trésorerie, et la VL du jeu est une mesure économique ;
  - pas de marché immobilier : l'immeuble est valorisé à sa valeur nette comptable, et le loyer de marché n'est pas indexé ;
  - pas de durée de bail ni d'indemnité de sortie anticipée ; la perte des agencements en tient lieu ;
  - l'art garde une valeur constante ;
  - l'équipe de base reste de 3 personnes. Le recrutement et les bureaux dans d'autres villes sont traités en *phase 8* ;
  - pas d'interaction directe avec les passants de la vue ville : ils sont décoratifs, et les PNJ avec lesquels on interagit sont ceux du panneau Bureaux ou Carrière.

### Sauvegardes
- Version 6. Migration automatique depuis les versions 1 à 5 : bureaux par défaut (étage loué, style classique).

## Phase 7 — exotiques, financement, conformité et enquêtes, scénarios, succès, équilibrage

### Courbe des taux (`engine/market.ts`)
- **Taux zéro-coupon de Nelson-Siegel** par devise : z(t) = r₀ + pente·(1 − f) + bosse·(f − e^{−t/λ}), avec f = (1 − e^{−t/λ})/(t/λ) et λ = 2 ans.
  - z(0) = taux directeur ; z(∞) = taux + pente.
  - Pentes initiales : +0,4 % (USD) et +0,6 % (EUR).
- **Effet des banques centrales** : une hausse de taux aplatit la courbe (pente −0,6 × la variation), une baisse la pentifie.
- **Usage** : toutes les actualisations (forwards, options, tolérances, marge SPAN, P&L expliqué, préfinancements) utilisent le taux de la bonne maturité.
- **Taux à court terme** : les intérêts de trésorerie et de la RCF restent au taux court (ACT/360).

### Options exotiques (`engine/exotics.ts`, testées contre Monte Carlo)
- **Sept produits de gré à gré sur futures**, cotés par les banques :
  - barrière (knock-in/out, hausse/baisse) ;
  - digitale (cash-or-nothing) ;
  - lookback à strike flottant ;
  - option sur spread calendaire ;
  - composée (call sur call) ;
  - quanto (payée dans l'autre devise à taux fixé) ;
  - cliquet.
- **Formules fermées** (revalorisation complète en VaR possible) :
  - barrière : Reiner-Rubinstein avec b = 0 ;
  - lookback : loi du minimum/maximum d'un brownien à dérive, intégrée par quadrature ;
  - spread : approximation de Kirk (exacte pour K = 0, Margrabe) ;
  - composée : Geske, avec une normale bivariée de Genz (précision ~1e-15) ;
  - quanto : forward ajusté de −cov(ln F, ln X) ;
  - cliquet : somme d'options à départ différé, chacune avec la variance de sa propre période.
- **Vol dépendante du temps** (effet Samuelson du modèle à deux facteurs) : le log-prix d'un future est un brownien changé de temps. Le minimum et le maximum sont invariants par changement de temps monotone : barrières et lookbacks continus sont exacts avec la variance totale v = ∫σ².
- **Corrélation du spread calendaire** : covariance exacte du modèle entre deux échéances, ∫ σ_F(T₁−s)·σ_F(T₂−s) ds, en forme fermée.
- **Quanto** : seul le facteur court de la commodité est corrélé au choc de change dans la simulation. La covariance est donc ρ σ_X ∫(σχ e^{−κ(τ−s)} + ρ_ss σξ) ds. Le signe dépend de la devise de cotation : une option USD payée en EUR, ou EUR payée en USD.
- **Surveillance quotidienne** (à la clôture), correction de Broadie-Glasserman-Kou :
  - barrière décalée de e^{±0,5826 σ√Δt} ;
  - extrême du lookback : E[min_d] ≈ e^{βσ√Δt}·E[min_c(m₀e^{−βσ√Δt})].
- **Digitale** : répliquée par un call-spread serré sur la surface avec smile (−∂C/∂K), donc cohérente avec les vanilles et sensible au skew.
- **Monte Carlo de contrôle** sur la dynamique EXACTE du modèle :
  - pas quotidiens ouvrés, variables antithétiques, vol × niveau de vol implicite ;
  - décalage initial pour retrouver exactement les prix cotés ;
  - disponible dans le ticket (« contrôle MC », 3 000 chemins, ±2 écarts-types) ;
  - tests : barrière, digitale, lookback, spread, composée et cliquet, tous dans la tolérance (3,5 écarts-types + 3 à 8 % selon l'approximation).
- **Cycle de vie** :
  - prime payée ou encaissée comptant ;
  - barrière touchée, extrême et constatations du cliquet enregistrés à chaque clôture ;
  - règlement en cash à l'échéance (la composée est réglée en cash à sa propre échéance : max(valeur du call − prime, 0)) ;
  - débouclage possible à la fourchette.
- **Fourchette** : max(3 % de la prime, 0,6 point de vol de vega), doublée en crise. Les exotiques sont chères à traiter et à défaire.
- **Intégration au risque** : valeur dans la VL et la VaR (revalorisation complète), delta (différences centrées) dans les expositions et la couverture automatique, P&L expliqué (delta × ΔF en « prix », le reste en « vol »), risque de contrepartie bancaire (défaut, CSA).
- **Simplifications** :
  - pas de smile pour les exotiques autres que la digitale (vol ATM du modèle × niveau implicite) ;
  - la composée et la quanto ne sont pas validées par le MC (Geske suppose une vol constante ; la dynamique jointe commodité/change n'est pas simulée sous la mesure de paiement), seulement par des cas limites ;
  - *phase 8* : options sur spreads entre commodités (crack, spark, WTI-Brent, Brent-Dubaï, JKM-Henry Hub, blé-maïs) ;
  - pas de barrière à fenêtre ni de rebate.

### Financement (`engine/financing.ts`)
- **Crédit documentaire (LC)** :
  - certains vendeurs l'exigent : 20 % de base, +35 % pour un producteur ou un mineur, +10 % pour une petite maison (capital < 50 M$) ;
  - coût : 0,15 % à l'émission + 0,08 %/mois, avec une ligne dédiée de 3× les fonds propres (plafond 6× le capital initial) ;
  - à la vente, un acheteur peut fournir une LC confirmée (plus souvent s'il est mal noté) : s'il fait défaut, sa banque paie et le contrat continue ;
  - tirages hachés sur l'offre : aucune consommation de l'aléa principal.
- **Financement de stock** (borrowing base / repo de matières premières) :
  - prêt = (1 − décote) × valeur du lot, avec des décotes de 12 % (énergie), 10 % (métaux), 15 % (agricoles) ;
  - taux USD + 1,75 %, moins cher que la RCF (+2,5 %) ;
  - VL inchangée à l'origine (cash contre dette) ; dette déduite de la VL ;
  - appel de marge si le prêt dépasse (1 − décote/2) × valeur ; à défaut de paiement, la banque vend le lot au spot ;
  - remboursement au prorata de toute sortie de stock.
- **Préfinancement** (achat à terme payé d'avance, remboursé en nature) :
  - prix = Σ q·F_local·DF × (1 − décote) ; la décote vaut (spread de crédit + 3 à 5 % de financement) × la maturité moyenne ;
  - valorisation : livraisons restantes au forward local, actualisées au taux sans risque + spread ;
  - le spread est **calibré à l'origine** (valeur = prix payé : pas de gain du premier jour), puis suit la notation du producteur (spread ≈ PD × 60 %) ;
  - expositions : la quantité restante compte comme du physique (VaR, couverture automatique) ;
  - défaut du producteur : récupération de 35 % de la valeur restante, assurable par l'assurance-crédit.
- **Simplifications** :
  - pas d'affacturage ni de délais de paiement sur les ventes (le paiement à la livraison rend l'affacturage sans objet) ;
  - la fraude documentaire sur LC n'est pas simulée (la fraude au double nantissement existe en événement) ;
  - les offres de préfinancement sont générées au changement de mois, par tirages hachés.

### Qualité et inspection (`engine/physical.ts`)
- **Risque qualité** : probabilité de cargaison hors spécification de 4 %, +6 % pour un vendeur noté B ou CCC, +3 % pour BB, +4 % en zone instable. Un cas sur cinq est une contamination grave (décote de 15 à 30 %, contre 3 à 9 % sinon).
- **Inspection indépendante** (0,03 % du notionnel, cochée sur l'offre) : réfaction obtenue du vendeur, ou cargaison contaminée refusée au chargement (contrat annulé, rien à payer).
- **Sans inspection** : le lot entre en stock avec un facteur de qualité < 1 (valeur, vente spot), et un acheteur à qui on le livre obtient la même réfaction.
- **Simplifications** :
  - grades de brut : *phase 8* avec le WTI (léger, enclavé) et le Dubaï (moyen, soufré) ; le spread Brent-Dubaï est la prime de qualité. Pas de grades plus fins (Forties, Urals…) ;
  - pas de litige ni d'arbitrage.

### Conformité et enquêtes (`engine/compliance.ts`)
- **Raccourcis tentants, sans morale imposée** :
  - barils d'une zone sous sanctions (décote de 15 à 25 %), achetables depuis un siège hors régime occidental ;
  - offres « avec commission » d'intermédiaires (contrat décoté de 2,5 à 4,5 %, commission de 2 %), jusqu'à une fois par mois ;
  - contreparties opaques ;
  - positions dominantes à l'échéance.

  Chaque raccourci crée un **dossier latent**, avec une gravité de 1 à 5 et le gain obtenu.
- **Découverte** : chaque mois, probabilité 1 − exp(−g² × 0,006 × facteur d'autorité). Le facteur vaut 1,2 pour les sanctions (le Trésor américain poursuit quiconque utilise le dollar : **sanctions secondaires**) et 0,5 + la sévérité KYC de la ville pour le reste. Prescription : 5 ans. Une enquête ouverte sur le même thème absorbe les nouveaux faits.
- **Procédure** : enquête (60 à 120 jours) → poursuites → jugement → appel possible sous 30 jours.
  - Frais d'avocats : (20 k$ + 15 k$ × gravité) par mois, ×2,2 si l'on conteste.
  - Force des preuves : 0,3 + 0,1 × gravité, +0,1 si l'on coopère, −0,1 si l'on conteste.
  - Transaction possible avant le jugement : 80 % de l'amende estimée, conséquences divisées par deux.
  - Appel : 10 % de relaxe, 35 % d'amende réduite de moitié, sinon condamnation confirmée.
- **Amende** = (2 × gain + 0,5 M$ × gravité) × facteur du programme, ×0,75 si l'on coopère, ×1,3 si l'on conteste et perd. Conséquences d'une condamnation :
  - sanctions : banques coupées un an (RCF, LC, prêts sur stock), lignes de crédit −20 % ;
  - manipulation : licence suspendue un mois ;
  - réputation −15 ;
  - en carrière, gravité ≥ 4 en corruption ou sanctions : prison (25 %) ou interdiction d'exercer (35 %) ;
  - troisième condamnation : retrait de licence.
- **Programme de conformité** :

  | Niveau | Coût mensuel (× indice du coût du personnel) | Postes | Détection interne | Amendes | Contrôle avant opération |
  |---|---|---|---|---|---|
  | Minimal | 0 | 0 | 15 % | ×1,3 | aucun |
  | Standard | 60 k$ | 1 | 60 % | ×1 | alerte |
  | Renforcé | 180 k$ | 3 | 95 % | ×0,6 | blocage |

  Un dossier repéré en interne peut faire l'objet d'une **auto-déclaration** : amende divisée par deux, sans poursuites ni sanctions annexes.
- **Limites de position des bourses** (mois spot, 15 derniers jours de cotation) : Brent 1 000 lots, TTF 600, cuivre 400, blé 600, charbon 300. Une **exemption de couverture de bonne foi** couvre la part qui compense une exposition physique de sens opposé. Le dépassement crée un dossier de manipulation et une alerte de la bourse ; le niveau renforcé bloque l'ordre.
- **Aléa sans état** (graine, jour, dossier) : la séquence du marché reste identique.
- **Simplifications** :
  - pas de législation propre à chaque pays ni de coopération entre autorités ;
  - pas de lanceur d'alerte nominatif hors mode carrière (où les compromissions de la phase 5 restent gérées par les situations) ;
  - délit d'initié de la société non distingué de celui du dirigeant.

### Scénarios historiques (`data/scenarios.ts`, `engine/scenarios.ts`)
- **Cinq scénarios remaniés** :

  | Scénario | Inspiré de | Situation de départ | Objectif |
  |---|---|---|---|
  | La crise du détroit | 1990 | Stock de Brent couvert, invasion et embargo, envolée puis effondrement | 1,4× le capital |
  | Le super-cycle | 2003-2008 | Dérive haussière sur 3 ans puis krach | 3× le capital |
  | La grande pause | 2020 | Effondrement de la demande, contango extrême | +30 % et un portage réussi |
  | L'hiver sans gaz | 2022 | Stockage de gaz couvert par des futures ; l'envolée appelle la marge | Finir à 1× le capital |
  | Le squeeze du métal | 2022 | Cuivre couvert, squeeze et suspension de cotation | 1,1× le capital |

- **Mise en place** : configuration imposée, positions de départ apportées au bilan à leur valeur de marché (le capital de référence est la VL initiale), chronologie d'impacts du moteur d'événements, crises aléatoires réduites. L'objectif est évalué à la fin de la partie.

### Succès, objectifs, récapitulatif (`data/achievements.ts`, `engine/progress.ts`)
- **26 succès**, évalués à chaque clôture ; la collection est conservée entre les parties (stockage du navigateur). Exemples :
  - survivre à un squeeze (suspension de cotation traversée avec une position) ;
  - un hedge parfait (250 jours de bourse d'affilée avec un physique couvert à ±10 %) ;
  - le portage paie (stock gardé 60 jours et revendu avec profit) ;
  - structuré gagnant, préfinanceur, relaxé, irréprochable, rival dépassé, de stagiaire à CEO…
- **Objectifs de victoire** choisis au départ :

  | Objectif | Condition |
  |---|---|
  | Taille | 250 M$ de VL |
  | Rendement | 25 %/an sur au moins un an |
  | Fortune personnelle | 50 M$ (salaire, bonus, part de la société) |
  | Réputation | 90 en carrière ; prestige 80 sans condamnation en société |
  | Domination | Top 15 mondial des maisons |
  | Survie | Terminer la partie sans faillite ni condamnation |
  | Scénario | Objectif propre au scénario |

  Une victoire est annoncée, et la partie peut continuer.
- **Récapitulatif de fin** : verdict ; rendement (annualisé au-delà d'un an seulement) ; pire repli ; meilleurs et pires deals (marge réalisée sur chaque sortie de stock et règlement de chaque exotique) ; P&L par commodité ; erreurs de risque (appels de marge, repli > 25 %, amendes, taux de deals perdants) ; chronologie ; compétences ; rang mondial.
- **Simplification** : les futures n'ont pas de « deal » réalisé (marge de variation quotidienne) ; ils apparaissent dans le P&L par commodité et les meilleures et pires journées.

### Interface
- **Nouveaux panneaux** :
  - 🧪 **Structurés** (`X`) : ticket paramétrable, contrôle MC, positions et état du chemin ;
  - 🏧 **Financement** (`Y`) ;
  - ⚖️ **Conformité** (`Z`) : niveau du programme, dossiers repérés, enquêtes avec étapes, défense, transaction, appel ;
  - 🏆 **Partie** (`Q`) : objectif, succès, chronologie.
- **Fiches d'offres physiques** : LC exigée ou confirmée, origine sanctionnée, commission, case d'inspection avec son coût et le risque qualité.
- **Écran d'accueil** : onglet « Scénarios » et choix de l'objectif de victoire.
- **Conseillers** : la juriste signale dossiers, enquêtes, barils sanctionnés et commissions ; le trader, lui, trouve que « tout le monde le fait ».
- **Codex** : 15 nouvelles entrées (exotiques, Monte Carlo, LC, financement de stock, préfinancement, inspection, sanctions secondaires, limites de position, courbe des taux).

### Sauvegardes
- Version 7. Migration automatique depuis les versions 1 à 6.

### Équilibrage (`scripts/balance.ts`)
- **Banc d'essai** : stratégies-robots sur 8 graines, 1 an, 25 M$ de capital (`npx vite-node scripts/balance.ts 1 8`). Résultats à la livraison de la phase 7 :

  | Robot | Rendement moyen | Écart-type | Faillites | Lecture |
  |---|---|---|---|---|
  | Inactif | −2,4 % | 0,3 % | 0/8 | Les frais fixes (équipe, loyer) coûtent : ne rien faire n'est pas gratuit. |
  | Discipliné | +1,4 % | 15,8 % | 0/8 | Valeur nette > 30 k$, 8 contrats ouverts au plus, ventes sourcées au comptant avant livraison, stocks financés en banque. La discipline paie, modestement pour un robot : un joueur adosse achats et ventes, négocie et choisit son moment. |
  | Négociant naïf | −9,4 % | 41,2 % | 2/8 | Toute offre à valeur brute positive. La valeur « brute » ignore la sortie au comptant (fourchette de 0,3 à 0,6 %) et le rachat d'urgence (+1,5 %) des ventes non sourcées. Le levier physique (jusqu'à 4× les fonds propres) tue par le cash, même couvert. |
  | Couverture manuelle | −18,3 % | 50,1 % | 6/8 | Couvertures jamais débouclées après livraison : elles deviennent spéculatives. |
  | Raccourcis | −21,9 % | 31,0 % | 0/8 | Barils sanctionnés et commissions. Quatre enquêtes ouvertes en un an ; les amendes tombent la 2ᵉ ou la 3ᵉ année. |
  | Spéculateur | +15,7 % | 109,8 % | 0/8 | Long Brent et cuivre à 3× les fonds propres : loterie (de −94 % à +255 %). |

- **Ajustements issus du banc** :
  - **exemption de couverture de bonne foi** dans les limites de position : la couverture automatique déclenchait une enquête pour manipulation à chaque échéance ;
  - KYC réservé aux contreparties réellement opaques (notation B ou CCC et zone instable), et regroupement des faits dans l'enquête ouverte du même thème : une quinzaine d'enquêtes mineures par an noyaient le joueur ;
  - frais d'avocats proportionnels à la gravité ;
  - **valeur nette** d'une sortie isolée affichée sur chaque offre physique, pour enseigner l'adossement achat-vente.
- **Constats** :
  - une vente physique non sourcée paie le rachat d'urgence : le métier consiste à adosser ;
  - le financement de stock supprime les faillites par manque de liquidité des livres couverts : le robot discipliné n'en fait aucune, contre 2 sur 8 pour le naïf.

## Phase 8 — extension des données, optimisation, finitions

### Commodités (`data/commodities.ts`)
- **38 marchés**, contre 5 auparavant :

  | Famille | Sous-secteur | Marchés |
  |---|---|---|
  | Énergie | Bruts | Brent, WTI, Dubaï |
  | Énergie | Produits raffinés | Gazole, essence Eurobob, kérosène, fioul 3,5 % |
  | Énergie | Gaz | TTF, Henry Hub, GNL JKM |
  | Énergie | Électricité | Électricité allemande en base |
  | Énergie | Carbone | Quotas EUA |
  | Énergie | Charbons | API2, Newcastle, charbon à coke |
  | Métaux | Base | Cuivre, aluminium, zinc, nickel, plomb, étain |
  | Métaux | Batteries | Cobalt, lithium |
  | Métaux | Précieux | Or, argent |
  | Métaux | Ferreux | Minerai de fer |
  | Agricoles | Grains | Blé, maïs, riz |
  | Agricoles | Oléagineux | Soja, farine, huile de soja, huile de palme |
  | Agricoles | Softs | Sucre, café, cacao, coton, jus d'orange |

  Chaque marché a son modèle à deux facteurs, sa saisonnalité, ses règles d'échéance, ses options et son smile, sa liquidité, ses limites de position, sa logistique, son règlement (cash ou livraison) et ses lieux physiques avec leur différentiel. Les paramètres sont des ordres de grandeur, pas des calibrations.
- **Nouvelles règles de dernier jour de cotation** : WTI (3 jours ouvrés avant le 25 du mois précédent), gazole ICE (2 jours ouvrés avant le 14), softs ICE US (dernier jour ouvré du mois précédent).
  - **Simplification** : les autres contrats réutilisent une règle voisine (Henry Hub et JKM sur la règle TTF, électricité, palme, or, fer et lithium sur « dernier vendredi » ou équivalent).
- **Corrélations à facteurs** : choc_i = Σ L_ik f_k + idiosyncratique.
  - Neuf facteurs : macro mondiale, pétrole, gaz et électricité européens, charbon, métaux, précieux, agricoles, oléagineux, batteries.
  - La matrice L Lᵀ + D est définie positive par construction ; un test le vérifie, ainsi que la symétrie et des ordres de grandeur (Brent-WTI > 0,8, Brent-cacao < 0,1).
  - L'EURUSD est le dernier indice et charge sur le facteur macro.
  - **Simplification** : les corrélations historiques des cinq marchés d'origine sont remplacées par celles du modèle à facteurs (même ordre de grandeur). Un facteur long utilise la même structure de corrélation que le facteur court (tirages indépendants).
- **WTI à prix négatif : log-normale décalée.** X = F + 20 $ est log-normal, donc F peut descendre jusqu'à −20 $.
  - Futures, forwards et impact de marché portent sur X.
  - Les options se valorisent par Black-76 sur (F + décalage, K + décalage), formule exacte pour une log-normale décalée ; c'est le cas des vanilles, APO, tolérances, SPAN, P&L expliqué, theta, exotiques et du Monte Carlo.
  - Le smile utilise la moneyness ln((K + s)/(F + s)).
  - Le remake « Cushing déborde » fait passer le front sous zéro (−2,1 sur χ, puis rebond à l'expiration). Le Brent, livrable par bateau, reste positif.
- **Électricité non stockable** : pas d'achat au comptant ni de stock. Une livraison physique se règle contre le prix spot local : l'acheteur revend aussitôt, le vendeur rachète ce qu'il livre.
  - **Simplification** : pas de profil horaire (base seulement), pas de pointe, pas de prix négatifs horaires.
- **GNL** : nouvel indice de fret « méthanier » (80 k$/jour en moyenne, très volatil), JKM livré DES Tokyo/Chine ou FOB Sabine/Ras Laffan, évaporation en route (0,4 %), arbitrage visible dans le spread JKM-Henry Hub.
- **Option de partie** : marchés suivis Essentiels (5), Étendus (20, par défaut en sandbox) ou Tous (38). Seules les commodités actives génèrent des offres et apparaissent dans les panneaux ; tout le marché reste simulé. Le flux d'offres croît comme la racine du nombre de marchés.

### Monde (`data/cities.ts`, `data/world.ts`, `data/routes.ts`, `data/companies.ts`)
- **Villes** : 61 au lieu de 10, avec fiscalité, régulateur, KYC, stabilité, contrôle des capitaux, place bancaire, port, hub aérien, régime de sanctions et loyers. Moscou appartient à la Fédération de Sarmatie, Jakarta à l'Archipel d'Insulinde, Riyad et Doha aux Royaumes du Golfe, Lubumbashi au Kassaï.
- **Pays** : 37 nouveaux, avec leurs codes ISO pour le globe et leurs élections.
- **Mer et terre** : 26 nouveaux ports et leurs liaisons maritimes ; trajets intérieurs (barges du Mississippi pour le maïs et le soja, oléoduc Cushing–Golfe, rail du cobalt Katanga–Durban).
- **Sociétés** : 67 au total.
  - Nouvelles maisons : sogo shosha, géant des huiles, négociants des softs, de métaux et de métaux précieux, raffineur indien, énergéticien allemand, mineurs de fer.
  - Nouvelles contreparties : liquéfacteurs, triturateur argentin, sucrerie, office du cacao, producteurs de cobalt, de lithium, de palme, de nickel, de riz, de brut d'Oman…
  - Les desks existants s'étendent par affinité (desk pétrole → WTI, Dubaï, produits ; gaz → électricité, carbone, GNL ; cuivre → métaux de base ; blé → grains).

### Actifs (`engine/assets.ts`)
- **Raffinerie** : marge = Σ rendement × produit / (bbl/t) − Brent, aux vrais prix, avec des rendements de 40 % gazole, 30 % essence, 10 % kérosène, 15 % fioul et 5 % de pertes. La marge est réglée au spot ; le DCF utilise les forwards.
- **Trituration** : 0,022 short ton de farine + 11 lb d'huile − 1 boisseau de soja.
- **Centrale à cycle combiné** (55 %, 0,37 t CO₂/MWh) : elle ne produit que si le clean spark est positif.
  - **Simplification** : la flexibilité horaire est approchée par E[max(X, 0)], avec X ~ N(clean spark ; (35 % du prix de l'électricité)²).
- **Fonderie d'aluminium** : aluminium − 14 MWh × électricité − 1,93 t d'alumine à 380 $/t (prix fixe).
- **Mines et plantations génériques** : fer, lithium, or, cobalt, palme, café, cacao, sucre. **Méthanier** possédable.
- **Simplification** : la marge des usines de transformation est encaissée au spot et n'entre pas dans les deltas de couverture automatique. Le joueur la couvre lui-même (futures ou options sur crack et spark).

### Exotiques : spreads entre commodités (`data/spreads.ts`)
- **Neuf spreads** : cracks gazole, essence, kérosène et fioul (en $/bbl, conversion bbl/t), WTI-Brent, Brent-Dubaï (qualité), spark allemand (électricité − 2 × gaz), JKM − 1,15 × Henry Hub, blé − maïs.
- **Valorisation** : payoff a₁F₁ − a₂F₂ − K, approximation de Kirk avec la **covariance croisée exacte du modèle** entre deux commodités, intégrée par Simpson : C_ij[(σχ_i e^{−κ_i(τ_i−s)} + ρ_iσξ_i)(…_j) + σξ_iσξ_j √((1−ρ_i²)(1−ρ_j²))]. Pour une même commodité, elle égale la formule fermée (test).
- **Intégration au risque** : les deux jambes figurent dans les expositions et sont choquées en VaR.
- **Simplifications** : pas de spread entre devises (dark spread, JKM-TTF) ; pas de Monte Carlo joint pour ces options (formule fermée seule, affichée comme telle) ; la valeur est attribuée à la première jambe dans le P&L par commodité.

### Équipes et bureaux (`engine/staff.ts`, panneau 👥 Équipes, touche `E`)
- **Candidats** : renouvelés chaque mois (5 au plus), avec métier, famille de marchés, compétence, ambition et salaire. Leur qualité dépend du prestige du siège et de la place bancaire. Prime d'arrivée de 2 mois de salaire.
- **Effets plafonnés par métier** :

  | Métier | Effet |
  |---|---|
  | Trader | Flux d'offres de sa famille +12 % (+60 % au plus), conditions meilleures (jusqu'à 0,25 %), clients qui suivent (confiance) |
  | Analyste | Note de recherche révélant la tendance de fond réelle d'un marché |
  | Opérations | Risque qualité −15 % |
  | Risque | Marge de la RCF −0,1 % |
  | Juriste | Détection +15 %, amendes −10 % |
  | Affréteur | Fret −4 % |

- **Loyauté** : elle évolue avec le salaire (rapporté au marché de la ville) et les résultats de l'année.
- **Débauchage** : probabilité mensuelle (60 − loyauté)/200 × (0,5 + ambition), offre concurrente à +25 %, contre-offre possible pendant 8 jours. Sinon le collaborateur part, et ses clients perdent confiance.
- **Postes** : les collaborateurs occupent des postes au siège (voir phase 6) ou dans un bureau.
- **Bureaux dans d'autres villes** : bureau de représentation (6 postes, VL ≥ 15 M$) ou bureau régional (20 postes, VL ≥ 60 M$). Licence et agencement à l'ouverture, loyer chaque mois.
  - Effets : **présence permanente** (conditions locales, pas de pénalité à distance), trois fois plus d'offres sur les lieux de la ville, postes pour l'équipe.
  - Succès « Bureaux sur cinq continents ».
- **Simplifications** : en phase 8, ni fiscalité ni régulation propres aux bureaux, pas de vue 3D, pas de trading autonome. Tout cela arrive en phase 9.

### Optimisation
- **VaR** :
  - seules les commodités du livre (et toutes les jambes des spreads) sont choquées et revalorisées ;
  - les copies de marché partagent les commodités non choquées ;
  - les scénarios sont tirés **une fois par partie** et réutilisés chaque jour (nombres aléatoires communs) : la VaR ne saute plus par bruit d'échantillonnage, et le calcul est bien plus rapide.
- **Saisonnalité** : la fraction de mois est mise en cache ; c'était le premier poste du profil.
- **Résultat** : une journée de simulation avec un livre chargé passe de 42 ms à 19 ms, avec 38 marchés au lieu de 5.
- **Bundle** : découpé en morceaux (Three.js, React, données géographiques, moteur), et la vue ville se charge à la demande.

### Interface
- **Sélecteur de marchés** par famille (Énergie, Métaux, Agricoles). Le panneau Marchés est groupé par sous-secteur ; le livre et l'échéancier de risque n'affichent que les commodités utilisées.
- **Globe** : niveau de détail des étiquettes (de loin, seules les grandes places et vos villes sont nommées) ; trois décors au plus par ville (cuves, sphère à gaz, entrepôt, silo, terril).
- **Accueil** : choix des marchés suivis. **Structurés** : choix du spread entre commodités.

### Sauvegardes
- Version 8. Migration automatique depuis les versions 1 à 7 : les nouveaux marchés démarrent à leurs paramètres, l'historique des facteurs est complété, les nouvelles villes, zones, sociétés et le fret méthanier sont ajoutés, et les équipes sont vides.

### Couverture automatique (`engine/automation.ts`)
- **Débouclage** : l'automate mémorise les futures qu'il a ouverts lui-même, par matière (`automation.hedged`). Quand le physique disparaît (livraison, vente), il les déboucle, et seulement eux : les positions manuelles du joueur ne sont pas touchées. Avant, les couvertures restaient ouvertes et devenaient spéculatives.
- **Échéance** : la couverture va sur l'échéance cotée dont la date de prix est la plus proche de la date moyenne d'exposition du physique (pondérée par les quantités ; un stock compte pour aujourd'hui), hors échéances dans leurs cinq derniers jours. Une seule échéance par matière : un risque de calendrier résiduel demeure. Avant, tout allait sur la 2ᵉ échéance, et le gaz (saisonnalité forte, facteur court très volatil) n'était presque pas couvert.

### Liquidité des nouveaux marchés
- **Calibrage** : profondeur d'écran et demi-fourchette des 33 nouveaux marchés recalés pour que la plus grosse cargaison se couvre en environ une profondeur d'écran, avec une demi-fourchette de 3 à 10 pb (21 pb pour le lithium).
  - Le premier calibrage (fioul à 3 ticks de 0,25 $/t, soit 16 pb ; cargaisons de 2 à 5 fois la profondeur) coûtait 50 à 150 pb par couverture, payés de nouveau à chaque roll mensuel.
- **Hiérarchie conservée** : cobalt, lithium, riz, jus d'orange, huile de palme et charbon métallurgique restent chers à couvrir, et le Brent, l'or et le WTI sont les plus profonds.

### Équilibrage avec 38 marchés (`npx vite-node scripts/balance.ts 1 6`)

| Robot | Rendement moyen | Écart-type | Faillites | Phase 7 (5 marchés) |
|---|---|---|---|---|
| Inactif | −2,3 % | 0,3 % | 0/6 | −2,4 % |
| Discipliné | +0,6 % | 11,0 % | 0/6 | +1,4 % |
| Négociant naïf | −29,1 % | 12,3 % | 2/6 | −9,4 % |
| Couverture manuelle | −61,3 % | 37,1 % | 6/6 | −18,3 % |
| Raccourcis | −27,6 % | 17,1 % | 0/6 | −21,9 % |
| Spéculateur | +31,2 % | 74,4 % | 1/6 | +15,7 % |

- **Lecture** : la hiérarchie de la phase 7 tient. Avec plus de marchés, les stratégies sans discipline souffrent davantage : plus d'offres, donc plus d'expositions mal couvertes et plus de cash immobilisé.
- **Correctifs issus du banc** :
  - taille des cargaisons plafonnée à 1,2 × les fonds propres (une cargaison de GNL à 39 M$ tuait une maison de 25 M$) ;
  - débouclage et choix d'échéance de la couverture automatique ;
  - recalibrage de la liquidité.


## Phase 9 — desks délégués, fiscalité des bureaux, couverture en strip, qualités de brut, leçons

### Desks délégués (`engine/desks.ts`)
- **Mandat** : une limite de VaR 99 % à 1 jour (100 k$ à 1 M$), mesurée avec le modèle de risque de la maison (revalorisation complète, corrélations comprises). Le trader prend des positions futures sur sa famille de marchés : trois marchés au plus, sur la première échéance qui ne cote pas ses cinq derniers jours. Il rééquilibre une fois par semaine et roule avant l'échéance.
- **D'où vient l'avantage** : les futures sont des martingales sous le modèle. Seule la dérive « réelle » des narratifs macro (`market.drift`) donne une espérance de gain. Le trader estime cette dérive avec un bruit :
  - vue v = μ + σ·Z, avec σ = 2 % + 20 % × (1 − compétence), tenue un mois ;
  - **décision** : il ne trade que si |v| > 2σ, puis estime μ par l'espérance a posteriori v·τ²/(τ² + σ²), avec τ = 10 % ;
  - taille : budget/√n de VaR par marché × min(1, μ̂ / 12 %), trois marchés au plus.
  - Sans le test à 2σ, scanner une douzaine de marchés et garder les « meilleures » vues revient à trader le bruit (biais de sélection) : même les bons traders perdaient. Un trader médiocre passe rarement le test, et le passe surtout sur du bruit : il paie fourchette, impact, commissions et rolls.
- **Banc** (9 desks par partie, 6 graines, VaR 250 k$, un an) : gain attendu mesuré chaque jour (position × dérive réelle), comparé aux coûts de transaction.

  | Compétence | Gain attendu (énergie / métaux / agri) | Coûts |
  |---|---|---|
  | 40 | 0,04 / 0,07 / 0,10 M$ | 0,11 à 0,21 M$ |
  | 70 | 0,09 / 0,13 / 0,16 M$ | 0,09 à 0,26 M$ |
  | 95 | 0,15 / 0,20 / 0,32 M$ | 0,08 à 0,21 M$ |

  - Le P&L réalisé est bien plus bruité : environ 1,7 M$ d'écart-type par desk et par an. Les desks d'une même partie suivent les mêmes narratifs, si bien que quelques graines ne tranchent pas.
  - Lecture : un trader compétent rapporte à peu près son coût à 250 k$ de VaR, et vaut nettement plus que son salaire à 1 M$. Le ratio de Sharpe d'un très bon trader est d'environ 0,3 à 0,5, réaliste pour une activité de prop trading.

- **Comptabilité** : vraies positions de la maison, dans un livre séparé.
  - VM du soir et astuce du marquage identiques au livre du joueur.
  - Incluses dans la marge initiale (SPAN global), la VaR, la valeur nette et la liquidation forcée.
  - Hors du net et du delta du joueur : « Neutraliser Δ » et la couverture automatique ne les annulent pas.
  - Test : le P&L du desk égale exactement le cash qu'il a fait bouger (VM + commissions).
- **Contrôles** :
  - stop-loss mensuel à 4 × la limite ;
  - bonus de janvier : 15 % du P&L positif de l'année ;
  - **trader voyou** : probabilité mensuelle 4 % × ambition × (1 − loyauté) × 3 s'il perd, réduite par les risk managers. Il triple ses positions, déclare une VaR divisée par 3 et ignore le stop.
  - Détection mensuelle : 20 % + 20 % par risk manager + 10 % par juriste (+15 % si la VaR réelle dépasse le double du mandat). Positions fermées, mandat retiré.
- **Narratifs macro** : 10 thèmes au lieu de 4, couvrant les 38 marchés. Fréquence ×3, jusqu'à trois en même temps : une tendance de fond existe la majeure partie du temps.

### Fiscalité et régulation des bureaux (`taxSplit` dans `engine/staff.ts`)
- **Établissements stables** : le P&L positif de l'exercice des desks rattachés à un bureau y est imputé directement (principe OCDE des fonctions humaines significatives). Le reste est réparti au prorata de la masse salariale de chaque site, le siège comptant son équipe de base.
- Chaque part est imposée au taux de sa ville ; le siège garde son régime spécial.
- **Contrôle des capitaux** : rapatrier le bénéfice net d'un bureau coûte une retenue de 10 %.
- **Reporting** : les transactions des desks d'un bureau sont déclarées au régulateur local, au tarif local.
- **Vue 3D** : la ville d'un bureau montre votre immeuble (représentation ou régional) et son bureau intérieur.
- **Simplifications** : report des pertes global ; pas de prix de transfert sur les flux physiques ; pas de régime spécial dans les bureaux.

### Couverture en strip (`engine/automation.ts`)
- Chaque exposition physique (forward, cargaison, stock, échéancier de préfinancement) est rattachée à l'échéance cotée dont la date de prix est la plus proche de sa date, hors échéances dans leurs cinq derniers jours. Elle est couverte sur cette échéance au ratio cible, swaps OTC du même mois déduits.
- La mémoire de l'automate est tenue par échéance (`hedged["BRENT:612"]`) et suit les rolls. Quand le physique d'une échéance disparaît, il ne déboucle que sa propre couverture.
- Le risque de calendrier résiduel se limite à l'intérieur d'un mois, plus la base locale.

### Qualités de brut (`data/grades.ts`, `engine/grades.ts`)
- **18 qualités** sur Brent, WTI et Dubaï, offertes selon le lieu, avec densité (°API), soufre et rendements simplifiés (essence, kérosène, gazole, fioul). Une offre de brut sur trois reste à la qualité de référence.
- **Valeur d'usage** :
  - GPW = Σ rendement × forward du produit ÷ barils par tonne ;
  - diff = diff₀ + 0,85 × [(GPW − GPW_réf)(T) − (GPW − GPW_réf)(prix de référence)].
  - Un brut lourd et soufré est donc long fioul et court produits légers. Sensibilités exactes, testées par différences finies.
- **Intégration** :
  - offre, forward, stock, voyage, financement, vente spot et rachat d'urgence valorisés avec le différentiel ;
  - livraison d'une autre qualité que celle du contrat : ajustement à la valeur d'usage courante ;
  - la VaR choque les produits avec le brut ;
  - l'exposition aux produits portée par les qualités est affichée dans le livre.
- **Correctif au passage** : la qualité (hors spécification) d'un lot se perdait quand on l'expédiait. Elle suit désormais le voyage.
- **Simplifications** : assays réduits à quatre produits ; λ fixe ; pas de contrainte d'unités de raffinerie.

### Leçons guidées (`data/lessons.ts`, `engine/lessons.ts`, 🎓 `W`)
- Huit leçons : crack spread, WTI négatif, électricité et spark spread, arbitrage GNL, qualités de brut, strip, desks, bureaux.
- Chaque leçon explique un concept, puis ses étapes sont vérifiées sur l'état après chaque action et à chaque clôture. Une carte flottante indique l'étape en cours et ouvre le bon panneau.
- Aucune récompense en argent : la leçon ne change jamais l'économie de la partie.
- Une leçon est refusée si ses marchés ne sont pas suivis, ou si elle demande de diriger la maison.

### Équilibrage de la phase 9 (`npx vite-node scripts/balance.ts 1 12 <robot>`)
- **Banc sur 12 graines** : 6 graines ne suffisaient plus, avec une erreur type d'environ 4 à 5 points sur le discipliné. Les narratifs plus fréquents changent aussi les trajectoires de marché ; le spéculateur, par exemple, passe de +31 % à −25 % sur 6 graines.

  | Robot | Rendement moyen | Écart-type | Faillites |
  |---|---|---|---|
  | Inactif | −2,4 % | 0,2 % | 0/12 |
  | Discipliné | −4,5 % | 12,3 % | 0/12 |
  | Chef de desks (discipliné + 3 traders ≥ 70 à 250 k$, sans risk manager) | −11,7 % | 23,5 % | 0/12 |
  | Négociant naïf | −24,6 % | 17,4 % | 9/12 |
  | Raccourcis | −21,4 % | 9,5 % | 0/12 |
  | Spéculateur | +17,4 % | 97,9 % | 1/12 |

- **Contrôle** : le code de la phase 8, sur les mêmes 12 graines, donne −3,2 % (écart-type 16,8 %) au discipliné. Pas de régression, et la couverture en strip divise la volatilité du discipliné par 1,4 à 2,5 selon les tirages.
- **Chef de desks** : les salaires et bonus coûtent environ 3,5 points par an. Les dépassements dissimulés durent en moyenne cinq mois sans risk manager (jusqu'à 197 jours sur une graine). Des desks rentables demandent de bons traders, assez de limite de VaR et un contrôle des risques.
- **Correctifs issus du banc** :
  - limites mois spot des 33 marchés de la phase 8 (NaN : la table ne connaissait que les cinq marchés d'origine) ;
  - une couverture automatique refusée (liquidité, marge, conformité) est désormais signalée, au plus une fois tous les cinq jours par matière ;
  - le desk repart dès la levée de son stop-loss.
- **Constat** : la plus grosse perte journalière observée (−11 M$) vient du fret méthanier. Une cargaison achetée FOB Ras Laffan et vendue DES Tokyo perd quand le fret flambe (indice à 90 % de volatilité), et ce risque se couvre en FFA méthanier. C'est voulu.

### Sauvegardes
- Version 9 : la mémoire de couverture par matière est reportée sur l'échéance détenue la plus grosse dans le même sens, et les desks démarrent vides.

## Phase 10 — jouabilité : mode débutant, visite guidée, partie jouée dans le navigateur, folklore

### Mode débutant (`engine/difficulty.ts`)
- **Trois niveaux** : Débutant, Normal, Expert, choisis à l'accueil. Une première partie (aucune sauvegarde) présélectionne « Sandbox : ma société » en Débutant.
- **Règle** : la difficulté ne touche jamais au pricing (modèle, options, marges, VaR). Elle ne règle que le monde dans lequel le joueur opère :

  | | Débutant | Normal | Expert |
  |---|---|---|---|
  | Biais moyen du diff proposé | +0,25 % pour le joueur | −0,15 % | −0,25 % |
  | Fourchette au comptant | × 0,5 | × 1 | × 1,2 |
  | Stockage tiers | × 0,5 | × 1 | × 1,1 |
  | Frais fixes (équipe de base, loyer, charges) | × 0,3 | × 1 | × 1,25 |
  | Cargaison maximale | 0,5 × fonds propres | 1,2 × | 1,2 × |
  | Offres garanties (un achat, une vente, hors KYC) | oui | non | non |
  | Réglages proposés | 5 marchés, monde calme, crises rares | 20 marchés | 38 marchés, monde agité |

- **Accompagnement du débutant** :
  - roll et logistique automatiques ;
  - couverture manuelle, car elle s'apprend ;
  - visite guidée lancée d'office ;
  - seuls les panneaux essentiels sont affichés jusqu'à la fin de la visite, puis tout est débloqué avec une annonce.

- **Banc** (12 graines, un an, `npx vite-node scripts/balance.ts 1 12 <robot> <difficulté>`). Le robot « élève du tutoriel » achète et couvre une cargaison à la fois, cherche un acheteur au même lieu, sinon revend au comptant :

  | Difficulté | Élève du tutoriel | Inactif | Discipliné |
  |---|---|---|---|
  | Débutant | +3,2 % (écart-type 4,4 %) | +1,8 % | — |
  | Normal | −2,9 % (écart-type 3,9 %) | −2,4 % | −4,4 % (écart-type 10,0 %) |

  - En débutant, suivre la visite guidée rapporte plus que ne rien faire, avec peu de risque. Avant ces réglages, l'élève perdait 3,4 % et l'inactif gagnait.
  - En normal, il faut faire mieux qu'un robot : négocier, voyager, choisir son moment.

### Visite guidée « Premiers pas » (leçon `first`)
- **Cinq étapes** : acheter (le bouton « Acheter + couvrir » fait les deux), couvrir, trouver un acheteur au même lieu et livré après l'achat, laisser filer le temps jusqu'aux livraisons, déboucler les futures orphelins (« Clôturer »).
- **Aides** :
  - à l'étape « acheteur », une offre adossable est garantie sur la table ;
  - les offres adossables portent un badge « ✓ adosse votre achat » ou « ✓ servie par votre stock ».

### Partie complète jouée dans le navigateur (pilote Playwright, souris et clavier uniquement)
Défauts trouvés et corrigés :
- un clic sur le mot « couvrir » dans « Acheter + couvrir » ouvrait le codex au lieu d'acheter : les termes du glossaire n'interceptent plus le clic dans un bouton ;
- au départ, aucune cargaison à acheter (deux offres, toutes deux des achats) : offres garanties en débutant ;
- la carte de leçon masquait le panneau : elle est passée à droite ;
- les conseillers parlaient de marchés non suivis (l'essence dans une partie à cinq marchés) : ils se limitent aux marchés de la partie ;
- un flash « Ruée sur les soutes » (fioul) interrompait une partie qui ne suit pas le fioul : une nouvelle majeure sur un marché non suivi reste dans le fil, sans interrompre le joueur ;
- la première cargaison du débutant (33 M$) dépassait son capital et vidait le cash libre : cargaison plafonnée à la moitié des fonds propres en débutant ;
- une vente servie par rachat d'urgence n'était pas comptée comme une opération : la visite restait bloquée à l'étape 4 pendant 20 mois de jeu. Elle est désormais enregistrée, avec son P&L ;
- un acheteur « au même lieu, livré plus tard » pouvait ne jamais se présenter (rien en 60 jours) : offre adossable garantie pendant la visite ;
- un débutant voyait une vingtaine de panneaux : affichage progressif.
Rythme mesuré : à vitesse maximale, environ un jour de jeu par seconde, soit une année en quatre à six minutes, alertes bloquantes comprises.

### Défauts moteur trouvés par les bancs et corrigés
- **Couverture et livraisons du soir** : la couverture automatique tournait avant les livraisons. La couverture d'une vente livrée restait ouverte toute la nuit sans physique en face (jusqu'à 5 M$ de perte sur le blé). Elle est recalée après les livraisons et arrivées, au prix de règlement.
- **Volatilité du fret** : elle ignorait le réglage « monde calme » et les régimes de crise. Elle suit maintenant le multiplicateur de volatilité, de façon cohérente dans la dynamique, le forward (la moyenne stationnaire est conservée) et la VaR.
- **Limites de bourse** : le contrôle d'ordre n'appliquait pas l'exemption de couverture de bonne foi, appliquée seulement par la conformité. Une grosse vente de GNL ne pouvait pas être couverte (limite mois spot de 600 lots) et restait exposée.
- **Valeur nette d'une offre** : elle déduit désormais tous les coûts certains, à savoir sortie au comptant, couverture futures aller-retour, lettre de crédit (émission et frais mensuels jusqu'à la livraison) et inspection. Le détail figure dans l'infobulle. Avant, un joueur qui ne prenait que des offres « en vert » perdait de l'argent.

### Folklore
- **Rumeurs** : une ville de plus, Lyon. Au fil des parties longues, des bruits de couloir très rares sur un négociant lyonnais du bois.
  - D'abord un acheteur sans nom, puis une société, enfin des initiales.
  - Sept échos au plus, espacés d'au moins deux mois, pas avant le cinquième mois de jeu.
- **Apartés** : au plus un tous les quatre-vingt-dix jours, glissés dans une conversation, une note d'analyste ou une fin de négociation.
- **Neutralité** : aucun effet sur les marchés, l'argent ou les probabilités. Tirages hachés, la séquence aléatoire est intacte.
