/**
 * Valorisation : mark-to-market des futures (depuis le dernier marquage), des forwards physiques
 * (actualisés) et des stocks (au spot local). NAV = trésorerie − dette + MTM.
 */
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { lotQty } from './contracts';
import { basis, discount, forwardAt, futuresPrice, fx, spotPrice } from './market';
import type { CommodityId, ForwardDeal, FuturesPosition, GameState, InventoryLot } from './types';

export function futuresUnrealized(state: GameState, p: FuturesPosition): number {
  const spec = COMMODITIES[p.commodity];
  const f = futuresPrice(state.market, p.commodity, p.month);
  return (f - p.mark) * p.lots * lotQty(spec, p.month) * spec.valuePerUnit * fx(state.market, spec.currency);
}

/** P&L depuis le prix moyen d'entrée (affichage). */
export function futuresPnlVsEntry(state: GameState, p: FuturesPosition): number {
  const spec = COMMODITIES[p.commodity];
  const f = futuresPrice(state.market, p.commodity, p.month);
  return (f - p.avgPrice) * p.lots * lotQty(spec, p.month) * spec.valuePerUnit * fx(state.market, spec.currency);
}

/** Prix forward local = courbe benchmark à la date de livraison + différentiel courant (courbe de basis supposée plate). */
export function localForward(state: GameState, c: CommodityId, locationId: string, deliveryDay: number): number {
  return forwardAt(state.market, c, deliveryDay) + basis(state.market, c, locationId);
}

export function forwardMtm(state: GameState, d: ForwardDeal): number {
  const spec = COMMODITIES[d.commodity];
  const fwd = localForward(state, d.commodity, d.locationId, d.deliveryDay);
  return (
    d.side * (fwd - d.price) * d.qty * spec.valuePerUnit * fx(state.market, spec.currency) *
    discount(spec.currency, state.day, d.deliveryDay)
  );
}

export function localSpot(state: GameState, c: CommodityId, locationId: string): number {
  return spotPrice(state.market, c) + basis(state.market, c, locationId);
}

export function inventoryValue(state: GameState, lot: InventoryLot): number {
  const spec = COMMODITIES[lot.commodity];
  return lot.qty * localSpot(state, lot.commodity, lot.locationId) * spec.valuePerUnit * fx(state.market, spec.currency);
}

export function nav(state: GameState): number {
  let v = state.company.cash - state.company.rcfDrawn;
  for (const p of state.futures) v += futuresUnrealized(state, p);
  for (const d of state.forwards) v += forwardMtm(state, d);
  for (const l of state.inventory) v += inventoryValue(state, l);
  return v;
}

/** Valeur économique cumulée par commodité (flux cumulés + MTM ouvert). Sa variation = P&L de la commodité. */
export function valueByCommodity(state: GameState): Record<CommodityId, number> {
  const out = {} as Record<CommodityId, number>;
  for (const id of COMMODITY_IDS) out[id] = state.company.cumCashByCommodity[id];
  for (const p of state.futures) out[p.commodity] += futuresUnrealized(state, p);
  for (const d of state.forwards) out[d.commodity] += forwardMtm(state, d);
  for (const l of state.inventory) out[l.commodity] += inventoryValue(state, l);
  return out;
}

export interface Exposure {
  commodity: CommodityId;
  futuresQty: number;
  forwardQty: number;
  inventoryQty: number;
  netQty: number;
  /** Delta en USD : variation de valeur pour +1 % sur toute la courbe. */
  delta1pct: number;
}

/** Exposition nette en unités physiques : futures + forwards + stocks. Le cœur du hedging. */
export function exposures(state: GameState): Exposure[] {
  return COMMODITY_IDS.map((c) => {
    const spec = COMMODITIES[c];
    const k = spec.valuePerUnit * fx(state.market, spec.currency);
    let fq = 0, wq = 0, iq = 0, d = 0;
    for (const p of state.futures.filter((x) => x.commodity === c)) {
      const q = p.lots * lotQty(spec, p.month);
      fq += q;
      d += q * futuresPrice(state.market, c, p.month) * k * 0.01;
    }
    for (const f of state.forwards.filter((x) => x.commodity === c)) {
      wq += f.side * f.qty;
      d += f.side * f.qty * forwardAt(state.market, c, f.deliveryDay) * k * 0.01 * discount(spec.currency, state.day, f.deliveryDay);
    }
    for (const l of state.inventory.filter((x) => x.commodity === c)) {
      iq += l.qty;
      d += l.qty * spotPrice(state.market, c) * k * 0.01;
    }
    return { commodity: c, futuresQty: fq, forwardQty: wq, inventoryQty: iq, netQty: fq + wq + iq, delta1pct: d };
  });
}
