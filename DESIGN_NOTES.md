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
- **Différentiels physiques (basis)** : processus d'Ornstein-Uhlenbeck autour d'une moyenne par lieu. **Simplification** : courbe de basis plate (le diff du jour s'applique à toutes les échéances). *Phase 4 : courbe de basis et fret explicite.*
- **Taux** : un taux plat par devise (USD 4 %, EUR 2,25 % au départ), actualisation continue en ACT/365, intérêts de trésorerie en ACT/360. **Phase 3** : les taux bougent par pas de 25 pb aux réunions de la Fed et de la BCE (biais selon le narratif macro), avec effet sur l'EURUSD et les matières premières. *Phase 7 : vraies courbes de taux.*
- **FX** : EURUSD en OU sur le log. Le TTF se règle en EUR, converti en USD au spot du jour. **Simplification** : un seul compte de trésorerie en USD (en réalité, un compte de marge en EUR).

## Contrats

- Dernier jour de cotation fidèle aux règles réelles : Brent (dernier jour ouvré de M−2), TTF (deux jours ouvrés avant M), cuivre LME (3ᵉ mercredi moins deux jours ouvrés), blé CBOT (jour ouvré avant le 15), API2 (dernier vendredi). Tous testés.
- **Simplification** : un seul calendrier de jours ouvrés (week-ends, 1ᵉʳ janvier, 25 décembre) pour toutes les bourses.
- **Simplification** : tous les futures se règlent en cash à l'expiration, au prix de règlement du dernier jour. En réalité, l'ICE Brent se règle en cash contre un index, le TTF et le LME se livrent physiquement, et l'API2 se règle sur la moyenne mensuelle de l'index. *Phase 2 (EFP) et phase 4 (livraison bourse).*
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
- **Simplification** : les Incoterms sont corrects dans le codex et les libellés, mais le fret, l'assurance et le transfert de risque sont implicites dans le basis du lieu. Pas de laycan ni de tolérance ±10 %, pas d'inspection, de surestaries ou de pertes en transit. *Phase 4 (logistique et fret) et phase 7 (opérationnel).*
- **Simplification** : le gaz physique est livré « en bloc » le 15, au lieu d'un flux horaire sur le mois.
- **Simplification** : stockage loué sans limite de capacité, à coût fixe par unité et par mois. *Phase 4 (actifs de stockage).*
- Plafond d'encours physique = 6 × fonds propres (lignes de trade finance).
- Risque de contrepartie : traité en phase 3 (voir plus bas).

## Comptabilité et fiscalité

- NAV = cash − dette + MTM futures (depuis le dernier marquage) + MTM forwards (actualisé) + stocks au spot local.
- Frais généraux mensuels : loyer de la ville + 90 k$ × indice de coût du personnel.
- Impôt annuel sur la variation de NAV de l'exercice (comptabilité en juste valeur, IFRS 9), avec report illimité des pertes. **Phase 3** :
  - le taux de chaque ville évolue avec les élections et les réformes ;
  - deux régimes spéciaux : Singapour à 10 % si le volume physique annuel dépasse 500 M$ ; zone franche de Dubaï à 0 % moyennant une redevance de 250 k$ par an ;
  - transfert de siège possible (1,5 M$ + taxe de sortie de 1 % de la NAV, une fois par an).
  **Simplification restante** : pas de retenues à la source. Elles n'ont de sens qu'avec des dividendes ou des investisseurs : *phase 5 (création de société avec investisseurs)*.

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
  **Simplification** : en Sandbox, le joueur est le patron. Les sanctions de type remontrance ou licenciement arriveront avec le mode Histoire (phase 5).

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
- **Simplification — délits d'initiés** : les informations obtenues en avance via les relations (risque de délit d'initié) arrivent avec les PNJ et relations en *phase 5*, et la conformité (enquêtes, sanctions) en *phase 7*.

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
- **Simplification** : les concurrents n'ont pas de livre détaillé (expositions agrégées par commodité) et n'interagissent pas avec le carnet des futures, sauf choc de liquidation. Recrutements et débauchages qui touchent le joueur : *phases 5 et 8*.

### Risque de contrepartie (`engine/credit.ts`)
- Probabilités de défaut annuelles par notation (AAA 0,01 % … B 4 %, CCC 15 %), doublées en régime de stress. Les contreparties non simulées sont dégradées par l'instabilité de leur pays.
- **Close-out netting** par contrepartie, avec deux ensembles distincts : physique (accord type GTMA/EFET) et OTC (ISDA). Montant net dû au joueur : récupération de 35 %. Montant dû par le joueur : payé intégralement. Testé, y compris le cas où on doit de l'argent.
- **Assurance-crédit** : 0,4 % par an de l'encours physique, couvre 90 % de la perte de défaut sur le physique.
- **CSA par banque** : collatéral égal à −MTM net des OTC avec cette banque, échangé chaque soir. La NAV ne bouge pas, mais le cash, oui (liquidité). Le défaut de la banque devient alors quasi sans perte (testé). Sans CSA, la banque facture une **CVA** (fourchette ×1,3).
- **Simplifications** : seuil et montant minimum de transfert du CSA nuls ; récupération fixe à 35 % ; pas de lettres de crédit ni de garanties bancaires (*phase 7, financement*).

### Interface
- Panneaux **Actualités** (filtres par catégorie, statut rumeur / confirmé / démenti, impacts, calendrier des réunions), **Monde** (tension, taux, ENSO, narratifs, sanctions, zones, comparaison réglementaire, transfert de siège) et **Concurrents** (classement, fiches, expositions, assurance, CSA, défauts subis).
- Calques du globe : tensions (pays et zones colorés par stabilité), sanctions, météo (marqueurs animés), prix (variation du jour par hub), concurrents (badges des sièges, rival entouré). Les calques « routes » et « stocks » viendront avec la logistique (*phase 4*).

### Sauvegardes
- Version 3. Migration automatique depuis les versions 1 et 2.
