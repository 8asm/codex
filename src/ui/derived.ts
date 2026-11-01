import { COMMODITIES } from '../data/commodities';
import type { Day, MonthIndex } from '../engine/calendar';
import { listedMonths, lotQty, pricingDay } from '../engine/contracts';
import { forwardAt } from '../engine/market';
import type { CommodityId, GameState, MarketState } from '../engine/types';

/** Prix d'une échéance à la clôture précédente (recalculé depuis l'historique des facteurs). */
export function prevPrice(m: MarketState, c: CommodityId, mi: MonthIndex): number | null {
  const snap = m.history[m.history.length - 2];
  if (!snap) return null;
  const [chi, xi] = snap.f[c];
  return forwardAt(m, c, pricingDay(COMMODITIES[c], mi), snap.day, chi, xi, snap.volMult);
}

/** Série de prix à maturité constante (2 mois) pour les sparklines. */
export function constantMaturitySeries(m: MarketState, c: CommodityId, n = 80): number[] {
  return m.history.slice(-n).map((s) => forwardAt(m, c, s.day + 60, s.day, s.f[c][0], s.f[c][1], s.volMult));
}

/** Échéance cotée la plus proche d'une date de livraison physique (pour la couverture). */
export function hedgeMonthFor(state: GameState, c: CommodityId, deliveryDay: Day): MonthIndex {
  const spec = COMMODITIES[c];
  const months = listedMonths(spec, state.day);
  let best = months[0]!;
  for (const mi of months) if (Math.abs(pricingDay(spec, mi) - deliveryDay) < Math.abs(pricingDay(spec, best) - deliveryDay)) best = mi;
  return best;
}

export function hedgeLots(c: CommodityId, mi: MonthIndex, qty: number): number {
  return Math.max(1, Math.round(qty / lotQty(COMMODITIES[c], mi)));
}

export function curveShape(prices: number[]): { label: 'contango' | 'backwardation' | 'plate'; slope: number } {
  if (prices.length < 2) return { label: 'plate', slope: 0 };
  const n = Math.min(prices.length - 1, 6);
  const slope = prices[n]! / prices[0]! - 1;
  if (slope > 0.005) return { label: 'contango', slope };
  if (slope < -0.005) return { label: 'backwardation', slope };
  return { label: 'plate', slope };
}
