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
- **Taux** : un taux plat par devise (USD 4 %, EUR 2,25 % au départ), actualisation continue en ACT/365, intérêts de trésorerie en ACT/360. **Phase 3** : les taux bougent par pas de 25 pb aux réunions de la Fed et de la BCE (biais selon le narratif macro), avec effet sur l'EURUSD et les matières premières. *Phase 7 : vraies courbes de taux.*
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
- **Phase 4 — fret explicite** : les Incoterms déterminent qui organise le transport. Acheter FOB oblige le joueur à affréter pour revendre ailleurs ; vendre CIF/CFR/DAP l'oblige à livrer à destination (stock sur place ou cargaison arrivée à temps, sinon rachat d'urgence). Les obligations de chaque Incoterm sont affichées sur les offres. Laycan affiché. **Tolérance de quantité ±5/10 % au choix du vendeur**, valorisée comme une option (straddle Black-76 au prix du contrat sur la quantité de tolérance), exercée à la livraison. Surestaries au-delà du temps de planche, pertes en transit, accidents en mer, assurance marine. **Simplifications** : la date de livraison est le milieu du laycan ; le transfert de risque au chargement (CIF/FOB) n'est pas simulé sur les achats rendus ; inspection, qualité et contamination arrivent en *phase 7*.
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
- **Simplification — prix négatifs** : le modèle lognormal ne peut pas produire de prix négatif. Le remake « pétrole à prix négatif » est un effondrement du front avec un contango extrême. Un modèle arithmétique (ou à décalage) sera nécessaire si un brut enclavé type WTI est ajouté (*phase 8*).
- **Simplification — suspension** : pendant une suspension, les prix publiés sont figés et tous les chocs (marché et news) s'accumulent, puis tombent à la réouverture. Il n'y a pas d'annulation rétroactive des transactions de la journée (contrairement à l'épisode réel du nickel). Seuls les futures et options de la commodité sont bloqués ; le physique continue.
- **Délits d'initiés** : informations obtenues en avance par les relations, traitées en phase 5 (voir plus bas). La conformité complète (procédures, sanctions de la société, contrôles automatiques) viendra en *phase 7*.

### Géopolitique et réglementation
- **Zones** : les 9 pays réels des villes, plus 5 zones de production fictives remaniées (Fédération de Sarmatie, Royaumes du Golfe, République du Kassaï, Tauride, Archipel d'Insulinde), chacune avec un bloc et une stabilité qui dérive et réagit aux événements. Tension entre blocs de 0 à 100.
- **Sanctions selon la juridiction du siège** : régime occidental (Genève, Londres, Rotterdam, Houston, Chicago), ONU seulement (Singapour, Santiago, Johannesburg ; ne s'applique qu'aux sanctions totales en période de très forte tension), oriental (Shanghai), aucun (Dubaï).
  - Sanctions totales : les offres des entités visées disparaissent, et les contrats en cours sont **frustrés** (force majeure, annulés sans indemnité, le MTM disparaît).
  - Plafond de prix : achat autorisé uniquement sous le plafond. Les barils sanctionnés se négocient avec une décote de 15 à 25 %.
  - **Simplification** : traiter des barils sanctionnés depuis Dubaï n'a pas encore de conséquence (sanctions secondaires, banques occidentales) : *phase 7 (conformité)*.
- **Embargos et interdictions d'export** : les offres concernées sont filtrées, les différentiels régionaux s'écartent.
- **Réglementation par ville**, évolutive :
  - impôt ;
  - exigence KYC (contrepartie à risque = notée BB ou moins, ou pays de stabilité < 50) : délai d'1 à 3 jours ouvrés avant de pouvoir traiter, ou exclusion pure dans une juridiction très stricte ;
  - coût de déclaration des dérivés par transaction, facturé chaque mois ;
  - contrôle des capitaux : financement +0,5 %, et risque de gel de 20 % de la trésorerie pendant 10 jours.
- **Simplification** : licences et bureaux multiples arriveront avec l'ouverture de bureaux (*phase 8*). Le siège unique peut être transféré.

### Sociétés concurrentes (`engine/companies.ts`)
- 28 sociétés simulées (maisons de négoce, bras trading des majors, maisons agricoles, mineur, 3 banques, 2 fonds) et 10 contreparties à notation fixe (producteurs, utilities, coopératives), dont 4 issues des zones fictives.
- Chaque jour : P&L = expositions × rendement du marché + marge commerciale bruitée − frais. Rééquilibrage tous les 4 à 8 jours selon les desks, l'appétit, un levier par métier et un signal (tendance + conviction propre).
- Notation dynamique (santé financière, réputation). Faillite sous 20 % des fonds propres initiaux (10 % pour les acteurs moins risqués). Scandales via les événements.
- Rachats : les contrats du joueur passent chez l'acheteur par **novation**. Débauchages et gros deals génèrent des news.
- **Faillite** : liquidation forcée de ses expositions (choc de prix proportionnel à la taille), résiliation et compensation des contrats du joueur.
- **Concurrence sur le physique** : une offre avantageuse a 25 % de chances par jour d'être raflée par un concurrent.
- Classement (joueur inclus) et **rival nominatif** (maison de la même ville au profil le plus proche, avec son trader vedette).
- **Simplification** : les concurrents n'ont pas de livre détaillé (expositions agrégées par commodité) et n'interagissent pas avec le carnet des futures, sauf choc de liquidation. Débauchage du joueur par les chasseurs de têtes : phase 5. Recrutement par le joueur de ses propres équipes : *phase 8*.

### Risque de contrepartie (`engine/credit.ts`)
- Probabilités de défaut annuelles par notation (AAA 0,01 % … B 4 %, CCC 15 %), doublées en régime de stress. Les contreparties non simulées sont dégradées par l'instabilité de leur pays.
- **Close-out netting** par contrepartie, avec deux ensembles distincts : physique (accord type GTMA/EFET) et OTC (ISDA). Montant net dû au joueur : récupération de 35 %. Montant dû par le joueur : payé intégralement. Testé, y compris le cas où on doit de l'argent.
- **Assurance-crédit** : 0,4 % par an de l'encours physique, couvre 90 % de la perte de défaut sur le physique.
- **CSA par banque** : collatéral égal à −MTM net des OTC avec cette banque, échangé chaque soir. La NAV ne bouge pas, mais le cash, oui (liquidité). Le défaut de la banque devient alors quasi sans perte (testé). Sans CSA, la banque facture une **CVA** (fourchette ×1,3).
- **Simplifications** : seuil et montant minimum de transfert du CSA nuls ; récupération fixe à 35 % ; pas de lettres de crédit ni de garanties bancaires (*phase 7, financement*).

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
- **Simplifications** : pas de saisonnalité du fret ; indices indépendants entre eux et des commodités (le lien passe par les soutes indexées sur le Brent et par les différentiels) ; pas de méthaniers (le GNL arrive avec JKM en *phase 8*).

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
  - raffinerie : marge de raffinage (crack) stochastique en % du Brent, en attendant les marchés de produits (*phase 8*) ;
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
  - pas de fonderie, d'usine de trituration ni de centrale : il manque les marchés de concentrés, de soja et d'électricité (*phase 8*) ;
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
- **Simplification** : pas de procès en plusieurs étapes ni d'appel ; la conformité interne automatisée viendra en *phase 7*.

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
