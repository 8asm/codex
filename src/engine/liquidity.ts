/**
 * Liquidité par échéance : la fourchette s'élargit et la profondeur fond quand on s'éloigne du front.
 * En régime de stress, la fourchette double et la profondeur est divisée par deux.
 * Impact de marché (temporaire) : coût supplémentaire linéaire en taille / profondeur.
 */
import { COMMODITIES } from '../data/commodities';
import { listedMonths } from './contracts';
import type { MonthIndex } from './calendar';
import { futuresPrice } from './market';
import type { CommodityId, MarketState } from './types';

export function monthOffset(m: MarketState, c: CommodityId, mi: MonthIndex): number {
  const idx = listedMonths(COMMODITIES[c], m.day).indexOf(mi);
  return idx < 0 ? 99 : idx;
}

export function halfSpread(m: MarketState, c: CommodityId, mi: MonthIndex): number {
  const spec = COMMODITIES[c];
  const o = monthOffset(m, c, mi);
  const stress = m.volRegime === 'stressed' ? 2 : 1;
  return spec.tick * spec.liquidity.halfSpreadTicks * (1 + 0.12 * o + 0.01 * o * o) * stress;
}

export function depthLots(m: MarketState, c: CommodityId, mi: MonthIndex): number {
  const spec = COMMODITIES[c];
  const o = monthOffset(m, c, mi);
  const stress = m.volRegime === 'stressed' ? 0.5 : 1;
  return Math.max(5, spec.liquidity.depthLots * Math.exp(-o / 8) * stress);
}

export interface Quote {
  mid: number;
  bid: number;
  ask: number;
  halfSpread: number;
  depth: number;
}

export function quote(m: MarketState, c: CommodityId, mi: MonthIndex): Quote {
  const mid = futuresPrice(m, c, mi);
  const hs = halfSpread(m, c, mi);
  return { mid, bid: mid - hs, ask: mid + hs, halfSpread: hs, depth: depthLots(m, c, mi) };
}

/**
 * Prix d'exécution d'un ordre au marché de `lots` (signé). Arrondi au tick défavorable.
 * exec = mid ± demi-fourchette × (1 + |lots| / profondeur)
 */
export function execPrice(m: MarketState, c: CommodityId, mi: MonthIndex, lots: number): number {
  const spec = COMMODITIES[c];
  const q = quote(m, c, mi);
  const cost = q.halfSpread * (1 + Math.abs(lots) / q.depth);
  const raw = q.mid + Math.sign(lots) * cost;
  const ticks = raw / spec.tick;
  return (lots > 0 ? Math.ceil(ticks - 1e-9) : Math.floor(ticks + 1e-9)) * spec.tick;
}

export function liquidityLabel(lots: number, depth: number): 'profonde' | 'correcte' | 'mince' | 'illiquide' {
  const r = Math.abs(lots) / depth;
  if (r < 0.1) return 'profonde';
  if (r < 0.5) return 'correcte';
  if (r < 1.5) return 'mince';
  return 'illiquide';
}
