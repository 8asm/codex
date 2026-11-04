# ⛵ TRADEWINDS

Jeu de stratégie navigateur : dirigez une maison de négoce de matières premières sur un globe 3D stylisé.
Pas de guerre : des cargaisons, des courbes forward, des appels de marge et du cash.

## Jouer en ligne

https://tradewinds-nu.vercel.app (version de la branche de développement ; les sauvegardes restent dans votre navigateur).

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 113 tests du moteur (pricing, options, marge SPAN, VaR, événements, crédit, fret, actifs, carrière, déterminisme)
npm run build      # build de production dans dist/
```

## Phase 1 — ce qui est jouable

- **Sandbox** : choisissez la ville du siège (10 villes), le capital, la durée, la volatilité, la fréquence des crises et la graine.
- **5 marchés** : Brent, gaz TTF (EUR), cuivre, blé (c/bu), charbon API2. Courbes forward dynamiques (contango et backwardation), comparées à la courbe d'il y a 30 jours.
- **Futures** : ticket en quelques clics, avec aperçu du prix d'exécution, de l'équivalent physique, de la marge initiale avant/après, des coûts, de la liquidité de l'échéance, du pire cas sur deux jours et d'un choc de 20 %. Clôture et roll vers l'échéance suivante depuis le livre.
- **Physique** : offres de cargaisons à prix fixe avec diff vs courbe, achat ou vente en un clic (avec ou sans couverture automatique), spot, stocks, livraisons, rachat d'urgence.
- **Risque** : marge de variation quotidienne, marges relevées par la bourse en période de stress, appels de marge, liquidation forcée, faillite. RCF avec covenant, trésorerie automatique désactivable.
- **Voyages** : avion animé sur le globe. On ne peut pas être partout : sur place, on négocie mieux.
- **News** : chocs d'offre et de demande, stocks pétroliers du mercredi, rapport agricole mensuel, météo gaz en hiver. Pause automatique sur événement majeur.
- **Codex** : chaque terme souligné se débloque au survol.
- Sauvegarde automatique (IndexedDB), sauvegarde manuelle, export/import JSON.

## Phase 2 — ce qui s'ajoute

- **Options listées** sur les 5 futures : chaîne de strikes avec bid/ask, vol implicite et delta ; smile ; profil de gain ; greeks et VaR incrémentale avant validation. Américaines (BAW) ou européennes (Black-76) selon la bourse. Exercice automatique ou anticipé.
- **OTC bancaire** : swaps sur moyenne mensuelle et options asiatiques (APO), réglés sur la moyenne des cotations du mois.
- **Surface de vol** : structure par terme du modèle, skew propre à chaque marché, vol implicite qui saute sur les news.
- **Liquidité** : fourchette en points de vol pour les options, impact de marché permanent sur les futures, ordres de spread calendaire.
- **Panneau Risque** : VaR/ES 99 % par Monte Carlo à revalorisation complète, greeks agrégés, échéancier des deltas, 6 stress tests, P&L expliqué (prix/base/change/vol/temps/deals), limites internes avec discipline stricte.
- **Conséquences** : covenant bancaire (gel puis réduction de la RCF), limites de position des bourses, couverture delta en un clic.
- **Conseillers animés** : Margot (risk), Dex (trader), Kenji (analyste), Rosa (opérations), Anselme (juriste). Ils réagissent aussi dans le ticket, se contredisent, et tiennent un palmarès de leurs prédictions.

## Phase 3 — ce qui s'ajoute

- **Événements vivants** : rumeurs confirmées ou démenties, fausses nouvelles, impacts différés, effets visibles sur le globe. Réunions du cartel (avec fuites), décisions de la Fed et de la BCE qui font bouger les taux, élections qui changent la fiscalité.
- **Remakes d'événements réels** : stockages saturés, squeeze sur le cuivre avec suspension de cotation, fraude au double nantissement, faillite d'un négociant qui cachait ses pertes, canal bloqué, sanctions puis plafond de prix, interdiction d'export, embargo charbon, El Niño, ouragans, coup d'État minier…
- **Géopolitique** : 14 zones (dont 5 fictives), tension entre blocs, sanctions qui s'appliquent selon la ville du siège, contrats frustrés par la force majeure.
- **Réglementation par ville** : impôt évolutif et régimes spéciaux, délais KYC, coût de reporting des dérivés, contrôle des capitaux, transfert de siège.
- **28 concurrents simulés** inspirés de maisons réelles : classement, rival, faillites, rachats, scandales. Ils raflent les bonnes cargaisons.
- **Risque de contrepartie** : notations, défauts avec close-out netting et récupération partielle, assurance-crédit, CSA par banque.
- **Calques du globe** : tensions, sanctions, météo, prix, concurrents.

## Phase 4 — ce qui s'ajoute

- **Fret** : quatre marchés d'affrètement (Capesize, Panamax, Supramax, Aframax), très volatils ; FFA pour couvrir ou spéculer.
- **Logistique** : routes maritimes réelles (Suez, Panama, Malacca, Ormuz, Bab-el-Mandeb, le Cap) avec détours quand un passage ferme. Devis de fret détaillé et arbitrage géographique. Navires animés sur le globe, surestaries, pertes en transit, accidents, assurance marine.
- **Physique réaliste** : Incoterms qui déterminent qui transporte, laycan, tolérance de quantité valorisée comme une option, courbe de basis liée au fret, livraison physique des futures cuivre, gaz et blé.
- **18 actifs industriels** : gisements, mines, raffinerie, cuves, entrepôts, silos, stockage de gaz, terminal, navires. Acquisition, coentreprise, construction, stream, royalty, offtake prépayé, affrètement à temps. Valorisation DCF sur la courbe forward, amortissement et dépréciation, accidents, grèves, nationalisations.
- **Managers** à qui déléguer un actif avec une politique (prudente, équilibrée, agressive) : bons ou mauvais.
- **Automatisation** (⚙️ ou `U`) : trésorerie, roll, couverture de base, logistique, vente de la production, assurance.
- **Calques** routes et stocks ; rails, barges et pipelines lumineux ; actifs animés.

## Phase 5 — ce qui s'ajoute

- **Mode Histoire** : choisissez votre société d'entrée et votre filière (trading, risques, opérations, financement, recherche), commencez stagiaire, visez CEO.
- **Situations quotidiennes** : demandes de seniors, erreurs à rattraper, clients pressés, corruption, presse, trader voyou, notes de recherche…
- **Livre de trading alloué** par l'employeur avec droits croissants : futures, puis options et physique, puis OTC et fret, puis toutes les commodités.
- **Évaluations, promotions, bonus, avertissements, licenciement.** Discipline des limites : convocation, gel, renvoi.
- **PNJ avec mémoire et confiance** : clients, banquiers, chasseurs de têtes, journalistes, officiels, investisseurs, collègues.
- **Tuyaux** parfois privilégiés (délit d'initié) et **compromissions qui ressurgissent** des années plus tard en enquête : amende, licenciement, interdiction d'exercer, prison.
- **Négociation en mini-jeu** (ancrage, concessions, bluff, arguments) : salaire, bonus, offres d'emploi, deals physiques, levée de fonds.
- **Marché de l'emploi** (débauchage, entretiens, références), **création de sa société** avec investisseurs, banques et dividendes soumis à retenue à la source.
- **Sandbox « trader salarié »** : rejoindre une maison existante comme trader.

## Phase 6 — ce qui s'ajoute

- **Vue ville 3D** : zoomez au maximum sur une ville du globe (ou 🏙️, touche `H`). La caméra plonge dans la ville low-poly, avec ses passants, ses voitures, son port ou son fleuve, et les sièges des concurrents. Dézoomez pour revenir au globe.
- **Un siège qui grandit avec vous** : étage loué → plusieurs étages → tour → campus. Les bailleurs exigent une valeur liquidative minimale.
- **Salle de marché visitable** (cliquez sur le siège). On y voit les traders à leur poste, les écrans et un mur de cours en direct. Quatre styles : classique, open space, salle blindée, verrière.
- **Personnalisation** (panneau 🏛️ Bureaux, touche `B`) : déménager, acheter son immeuble ou le revendre en cession-bail, réaménager la salle, installer des objets de prestige (art, salon, académie, cantine, héliport, auditorium…).
- **Le prestige a des effets de jeu** : clients reçus au siège plus confiants, meilleures concessions en négociation physique, investisseurs moins exigeants, candidatures spontanées de gérants de talent.
- **Finance rigoureuse** :
  - capex capitalisés et amortis sur 60 mois ;
  - perte des agencements au déménagement ;
  - comparaison louer ou acheter (taux de capitalisation, coût de l'argent, charges, usure) ;
  - art valorisé net des frais d'enchères ;
  - débordement en coworking quand les postes manquent.

## Phase 7 — ce qui s'ajoute

- **Produits structurés** (🧪, `X`) : barrières, digitales, lookbacks, options sur spread calendaire, composées, quantos, cliquets. Ils sont cotés par les banques avec des formules fermées, et le ticket propose un **contrôle Monte Carlo** de chaque prix. Barrière, extrême et constatations sont suivis à chaque clôture, avec règlement à l'échéance.
- **Courbe des taux** (Nelson-Siegel) : chaque maturité a son taux, et les banques centrales aplatissent ou pentifient la courbe.
- **Financement** (🏧, `Y`) :
  - lettres de crédit exigées par certains vendeurs, ou fournies par les acheteurs (protection contre leur défaut) ;
  - **financement de stock** avec décote et appels de marge ;
  - **préfinancement de producteurs**, remboursé en cargaisons.
- **Qualité** : des cargaisons arrivent hors spécification ou contaminées ; l'inspection indépendante permet d'obtenir une réfaction ou de refuser la marchandise.
- **Conformité et enquêtes** (⚖️, `Z`) :
  - raccourcis tentants (barils sanctionnés bradés, commissions d'intermédiaires, positions dominantes à l'échéance) ;
  - **sanctions secondaires** et limites de position des bourses ;
  - enquêtes en plusieurs étapes (enquête, poursuites, jugement, appel) : coopérer ou contester, transiger, se dénoncer ;
  - amendes, banques coupées, licence suspendue, prison ;
  - programme de conformité minimal, standard ou renforcé.
- **Scénarios historiques** (onglet « Scénarios » de l'accueil) : la crise du détroit, le super-cycle, la grande pause, l'hiver sans gaz, le squeeze du métal.
- **Objectifs de victoire** au choix : taille, rendement, fortune, réputation, domination, survie.
- **26 succès**, collection conservée entre les parties, et panneau 🏆 **Partie** (`Q`).
- **Récapitulatif de fin de partie** : verdict, meilleurs et pires deals, P&L par commodité, erreurs de risque, chronologie.
- **Équilibrage** : `npx vite-node scripts/balance.ts [années] [graines]` fait jouer des stratégies-robots (inactif, négociant couvert, négociant discipliné, raccourcis, spéculateur).

## Phase 8 — ce qui s'ajoute

- **38 marchés** (énergie, métaux, agricoles et softs) au lieu de 5, et **61 villes**, **67 sociétés**, 26 nouveaux ports. À l'accueil, choisissez les marchés suivis : Essentiels, Étendus ou Tous.
- **Le WTI peut passer sous zéro** (log-normale décalée) quand les cuves de Cushing débordent.
- **Électricité non stockable**, **GNL et méthaniers**, carbone européen, cobalt et lithium, or, café, cacao…
- **Options sur spreads entre commodités** : crack, spark, WTI-Brent, Brent-Dubaï, arbitrage GNL, blé-maïs.
- **Nouvelles usines** : raffinerie valorisée sur les vrais produits, trituration de soja, centrale à gaz avec option de dispatch, fonderie d'aluminium, mines et plantations.
- **Équipes** (👥, `E`) : recrutez traders, analystes, opérateurs, risk managers, juristes et affréteurs ; gérez leur loyauté et répondez aux débauchages.
- **Bureaux dans d'autres villes** : présence permanente sur place. Visez le succès « cinq continents ».
- **Nouveaux événements** : envolée du cacao, gelée du café, squeeze du nickel, interdiction d'export du riz, taxe sur la palme, réforme du carbone…
- **Plus rapide** : la simulation est deux fois plus rapide avec sept fois plus de marchés ; le bundle est découpé.

## Phase 9 — ce qui s'ajoute

- **Desks délégués** (👥 Équipes) : donnez une limite de VaR à un trader, il prend seul des positions futures sur sa famille de marchés. Bonus en janvier, stop-loss mensuel, et méfiez-vous du trader qui dissimule un dépassement.
- **Bureaux, suite** : le bénéfice des desks d'un bureau est imposé sur place, les transactions y sont déclarées, et le contrôle des capitaux coûte une retenue au rapatriement. Bouton **Visiter** pour entrer dans le bureau en 3D.
- **Couverture en strip** : la couverture automatique couvre chaque mois de livraison sur sa propre échéance.
- **18 qualités de brut** (Forties, Maya, Arab Heavy, WCS, Murban…) : densité, soufre, rendements, et un différentiel qui suit la valeur des produits raffinés.
- **Leçons guidées** (🎓, `W`) : crack spread, WTI négatif, électricité, GNL, qualités de brut, strip, desks, bureaux.
- **Plus de narratifs macro** (vague de GNL, El Niño, relance de l'acier chinois, biocarburants, ralentissement des véhicules électriques…), sur les 38 marchés.

## Phase 10 — ce qui s'ajoute

- **Mode débutant** (proposé d'office à la première partie) : cinq marchés, cargaisons à votre taille, contreparties conciliantes, frais réduits, monde calme, panneaux dévoilés progressivement. Normal et Expert pour la suite.
- **Visite guidée « Premiers pas »** : acheter une cargaison, la couvrir, trouver un acheteur, livrer, déboucler. Environ dix minutes.
- **Valeur nette honnête** sur chaque offre : tous les coûts certains sont déduits (détail au survol), et les offres qui adossent votre achat sont signalées.
- **Corrections** issues d'une partie jouée de bout en bout dans le navigateur (voir DESIGN_NOTES, phase 10).
- Une ville de plus : Lyon.

## Phase 11 — ce qui s'ajoute

- **🌐 En ligne, jusqu'à 4 joueurs**, sans serveur : un joueur héberge, les autres rejoignent avec un code à 6 caractères. Même société (rôles PDG ou trader), sociétés concurrentes dans le même monde, ou un mélange. L'hôte règle le temps ; discussion intégrée.
- **Complexité progressive** (option à la création) : les panneaux apparaissent quand vous en avez besoin, avec une explication et une leçon.
- **Paramètres 🛠️** : français ou anglais, taille de l'interface (automatique selon l'écran), mode simplifié, musique.
- **24 leçons** : visite guidée vérifiée (diagnostic de l'étape, étape passable) et leçons facultatives dans n'importe quel ordre.
- **Gouvernements** (🏛️, `D`) : appels d'offres publics, licences d'import-export, lobbying, rescrit fiscal.
- **Siège personnalisable** : forme, hauteur, couleurs, toit, ailes d'extension, intérieur. Zoomez sur votre bâtiment pour y entrer.
- **Une quarantaine de villes avec monuments**, villes voisines écartées sur le globe, dock défilant.
- Faillites des sociétés IA bien plus rares (recapitalisations, réduction des risques).

### Raccourcis

`J` carrière · `Espace` pause · `1` `2` `3` vitesse · `N` jour suivant · `M` marchés · `P` physique · `F` fret · `I` actifs · `O` options · `L` livre · `R` risque · `T` trésorerie · `V` voyages · `A` actualités · `G` monde · `K` concurrents · `B` bureaux · `E` équipes · `X` structurés · `Y` financement · `Z` conformité · `Q` partie · `H` vue ville · `U` automatisation · `D` gouvernements · `W` leçons · `C` codex · `Échap` fermer

## Structure

```
src/engine   moteur pur et déterministe (testé)
src/data     commodités, villes, contreparties, codex
src/render   globe et vue ville Three.js
src/ui       React + Zustand
src/save     IndexedDB / JSON
```

Voir `DESIGN_NOTES.md` pour toutes les décisions et simplifications.
