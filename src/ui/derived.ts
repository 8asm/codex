import { useMemo } from 'react';
import { computeVar, type VarResult } from '../engine/risk';
import { bookOf } from '../engine/valuation';
import type { Book, OptType } from '../engine/types';
import { optionExpiry } from '../engine/contracts';
import { useStore } from './store';
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

// ------------------------------------------------------------------ risque « live » et livres hypothétiques

/** VaR du livre courant, recalculée à chaque mutation de l'état. */
export function useLiveVar(): VarResult | null {
  const g = useStore((s) => s.game);
  const rev = useStore((s) => s.rev);
  return useMemo(() => (g ? computeVar(g) : null), [g, rev]);
}

export function bookWithFuture(state: GameState, c: CommodityId, month: number, lots: number, price: number): Book {
  const b = bookOf(state);
  const futures = b.futures.map((p) => ({ ...p }));
  const p = futures.find((x) => x.commodity === c && x.month === month);
  if (p) p.lots += lots;
  else futures.push({ commodity: c, month, lots, mark: price, avgPrice: price });
  return { ...b, futures: futures.filter((x) => x.lots !== 0) };
}

export function bookWithOption(state: GameState, c: CommodityId, month: number, type: OptType, strike: number, lots: number, price: number): Book {
  const b = bookOf(state);
  return {
    ...b,
    options: [...b.options, { id: 'hyp', commodity: c, month, type, strike, expiry: optionExpiry(COMMODITIES[c], month), style: COMMODITIES[c].options.style, lots, avgPremium: price }],
  };
}

export function bookWithOtc(state: GameState, kind: 'swap' | 'apo', c: CommodityId, month: number, qty: number, strike: number, type?: OptType): Book {
  const b = bookOf(state);
  return { ...b, otc: [...b.otc, { id: 'hyp', kind, commodity: c, month, qty, strike, type, bankId: 'bln', tradeDay: state.day, avgPremium: 0 }] };
}
