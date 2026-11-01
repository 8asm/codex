# ⛵ TRADEWINDS

Jeu de stratégie navigateur : dirigez une maison de négoce de matières premières sur un globe 3D stylisé.
Pas de guerre : des cargaisons, des courbes forward, des appels de marge et du cash.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 96 tests du moteur (pricing, options, marge SPAN, VaR, événements, crédit, fret, logistique, actifs, déterminisme)
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

### Raccourcis

`Espace` pause · `1` `2` `3` vitesse · `N` jour suivant · `M` marchés · `P` physique · `F` fret · `I` actifs · `O` options · `L` livre · `R` risque · `T` trésorerie · `V` voyages · `A` actualités · `G` monde · `K` concurrents · `U` automatisation · `C` codex · `Échap` fermer

## Structure

```
src/engine   moteur pur et déterministe (testé)
src/data     commodités, villes, contreparties, codex
src/render   globe Three.js
src/ui       React + Zustand
src/save     IndexedDB / JSON
```

Voir `DESIGN_NOTES.md` pour toutes les décisions et simplifications.
