# ⛵ TRADEWINDS

Jeu de stratégie navigateur : dirigez une maison de négoce de matières premières sur un globe 3D stylisé.
Pas de guerre : des cargaisons, des courbes forward, des appels de marge et du cash.

## Lancer

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 57 tests du moteur (pricing, options, APO, marge SPAN, VaR, P&L expliqué, livraisons, déterminisme)
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

### Raccourcis

`Espace` pause · `1` `2` `3` vitesse · `N` jour suivant · `M` marchés · `P` physique · `O` options · `L` livre · `R` risque · `T` trésorerie · `V` voyages · `C` codex · `Échap` fermer

## Structure

```
src/engine   moteur pur et déterministe (testé)
src/data     commodités, villes, contreparties, codex
src/render   globe Three.js
src/ui       React + Zustand
src/save     IndexedDB / JSON
```

Voir `DESIGN_NOTES.md` pour toutes les décisions et simplifications.
