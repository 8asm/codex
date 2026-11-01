/**
 * Marge initiale façon SPAN simplifié, par commodité :
 *   IM = |L − S| + 30 % × min(L, S)
 * où L (resp. S) = somme des expositions longues (resp. courtes) × taux de marge de la bourse.
 * Un spread calendaire (long un mois, short un autre) n'est donc chargé qu'à 30 % : c'est le
 * « crédit de spread » des chambres de compensation (les échéances ne bougent pas parfaitement ensemble).
 */
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { lotQty } from './contracts';
import { futuresPrice, fx } from './market';
import type { CommodityId, FuturesPosition, GameState, MarketState } from './types';

export const SPREAD_CHARGE = 0.3;

export function imByCommodity(m: MarketState, positions: FuturesPosition[]): Record<CommodityId, number> {
  const out = {} as Record<CommodityId, number>;
  for (const c of COMMODITY_IDS) {
    const spec = COMMODITIES[c];
    let L = 0, S = 0;
    for (const p of positions) {
      if (p.commodity !== c || p.lots === 0) continue;
      const e =
        Math.abs(p.lots) * lotQty(spec, p.month) * futuresPrice(m, c, p.month) * spec.valuePerUnit *
        fx(m, spec.currency) * m.commodities[c].imRate;
      if (p.lots > 0) L += e;
      else S += e;
    }
    out[c] = Math.abs(L - S) + SPREAD_CHARGE * Math.min(L, S);
  }
  return out;
}

export function totalIm(m: MarketState, positions: FuturesPosition[]): number {
  const by = imByCommodity(m, positions);
  return COMMODITY_IDS.reduce((s, c) => s + by[c], 0);
}

export function recomputeIm(state: GameState) {
  state.company.im = totalIm(state.market, state.futures);
}

/** Marge par lot (devise de cotation) pour affichage. */
export function imPerLot(m: MarketState, c: CommodityId, mi: number): number {
  const spec = COMMODITIES[c];
  return lotQty(spec, mi) * futuresPrice(m, c, mi) * spec.valuePerUnit * m.commodities[c].imRate;
}
