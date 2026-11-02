/**
 * Valorisation : mark-to-market des futures (depuis le dernier marquage), forwards physiques (actualisés),
 * stocks (spot local), options listées et OTC. NAV = trésorerie − dette + MTM.
 *
 * `valueBy(view, book)` valorise un livre quelconque dans une vue de marché quelconque : c'est la brique
 * commune de la NAV, de la VaR (revalorisation complète), des stress tests, des greeks et du P&L expliqué.
 */
import { exoticDeltaUnits, exoticLegs, exoticValueUsd } from './exotics';
import { officeBookValue } from './offices';
import { loansOutstanding, prepayValueIn } from './financing';
import { cpRating } from './credit';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { lotQty } from './contracts';
import { optionUnitGreeks, optionValueUsd, otcValueUsd, avgInputs, apoUnitPrice, type View } from './derivatives';
import { basis, basisAt, discount, forwardAt, futuresPrice, fx, spotPrice, zeroRate } from './market';
import { integratedVariance } from './model';
import { black76 } from './pricing';
import { voyageValue } from './logistics';
import { ffaValue } from './freight';
import { streamBook } from './assets';
import type { Book, CommodityId, ForwardDeal, FuturesPosition, GameState, InventoryLot, MarketState } from './types';

const zero = () => {
  const o = {} as Record<CommodityId, number>;
  for (const c of COMMODITY_IDS) o[c] = 0;
  return o;
};

export function futuresUnrealizedIn(m: MarketState, p: FuturesPosition): number {
  const spec = COMMODITIES[p.commodity];
  return (futuresPrice(m, p.commodity, p.month) - p.mark) * p.lots * lotQty(spec, p.month) * spec.valuePerUnit * fx(m, spec.currency);
}

export function futuresUnrealized(state: GameState, p: FuturesPosition): number {
  return futuresUnrealizedIn(state.market, p);
}

/** P&L depuis le prix moyen d'entrée (affichage). */
export function futuresPnlVsEntry(state: GameState, p: FuturesPosition): number {
  const spec = COMMODITIES[p.commodity];
  const f = futuresPrice(state.market, p.commodity, p.month);
  return (f - p.avgPrice) * p.lots * lotQty(spec, p.month) * spec.valuePerUnit * fx(state.market, spec.currency);
}

/** Prix forward local = courbe benchmark à la date de livraison + différentiel courant (courbe de basis plate). */
export function localForwardIn(m: MarketState, c: CommodityId, locationId: string, deliveryDay: number): number {
  return forwardAt(m, c, deliveryDay) + basisAt(m, c, locationId, deliveryDay);
}

export function localForward(state: GameState, c: CommodityId, locationId: string, deliveryDay: number): number {
  return localForwardIn(state.market, c, locationId, deliveryDay);
}

export function forwardMtmIn(m: MarketState, day: number, d: ForwardDeal): number {
  const spec = COMMODITIES[d.commodity];
  const fwd = localForwardIn(m, d.commodity, d.locationId, d.deliveryDay);
  const linear = d.side * (fwd - d.price) * d.qty * spec.valuePerUnit * fx(m, spec.currency) * discount(m, spec.currency, day, d.deliveryDay);
  return linear + (d.tolerance ? toleranceValueIn(m, day, d.commodity, d.locationId, d.deliveryDay, d.price, d.qty, d.tolerance, d.side < 0) : 0);
}

/**
 * Valeur de la clause de tolérance (± tol × qté au choix du vendeur) : le vendeur livre plus quand le prix
 * convenu dépasse le marché et moins dans le cas inverse. C'est un call + un put au strike du contrat sur
 * tol × qté (Black-76 sur le prix local, vol du modèle). Positive pour le joueur s'il est vendeur, négative s'il achète.
 */
export function toleranceValueIn(m: MarketState, day: number, c: CommodityId, locationId: string, deliveryDay: number, K: number, qty: number, tol: number, playerIsSeller: boolean): number {
  const spec = COMMODITIES[c];
  const T = Math.max(0, (deliveryDay - day) / 365);
  const F = localForwardIn(m, c, locationId, deliveryDay);
  const sigma = T > 0 ? Math.sqrt(integratedVariance(spec.model, T, T, m.volMult) / T) * m.ivLevel[c] : 0;
  const r = zeroRate(m, spec.currency, T);
  const sh = spec.model.shift ?? 0;
  const straddle = black76(F + sh, K + sh, T, sigma, r, 'C') + black76(F + sh, K + sh, T, sigma, r, 'P');
  return (playerIsSeller ? 1 : -1) * tol * qty * straddle * spec.valuePerUnit * fx(m, spec.currency);
}

export function forwardMtm(state: GameState, d: ForwardDeal): number {
  return forwardMtmIn(state.market, state.day, d);
}

export function localSpotIn(m: MarketState, c: CommodityId, locationId: string): number {
  return spotPrice(m, c) + basis(m, c, locationId);
}

export function localSpot(state: GameState, c: CommodityId, locationId: string): number {
  return localSpotIn(state.market, c, locationId);
}

export function inventoryValueIn(m: MarketState, lot: InventoryLot): number {
  const spec = COMMODITIES[lot.commodity];
  return lot.qty * localSpotIn(m, lot.commodity, lot.locationId) * (lot.quality ?? 1) * spec.valuePerUnit * fx(m, spec.currency);
}

export function inventoryValue(state: GameState, lot: InventoryLot): number {
  return inventoryValueIn(state.market, lot);
}

export function bookOf(state: GameState): Book {
  return { futures: state.futures, forwards: state.forwards, inventory: state.inventory, options: state.options, otc: state.otc, voyages: state.voyages ?? [], ffa: state.ffa ?? [], exotics: state.exotics ?? [], prepays: state.financing?.prepays ?? [] };
}

/** Valeur de marché (hors cash) d'un livre, ventilée par commodité. */
export function valueBy(v: View, book: Book): Record<CommodityId, number> {
  const out = zero();
  for (const p of book.futures) out[p.commodity] += futuresUnrealizedIn(v.market, p);
  for (const d of book.forwards) out[d.commodity] += forwardMtmIn(v.market, v.day, d);
  for (const l of book.inventory) out[l.commodity] += inventoryValueIn(v.market, l);
  for (const o of book.options) out[o.commodity] += optionValueUsd(v.market, o);
  for (const x of book.otc) out[x.commodity] += otcValueUsd(v, x);
  for (const y of book.voyages ?? []) out[y.commodity] += voyageValue(v, y);
  for (const x of book.exotics ?? []) out[x.commodity] += exoticValueUsd(v, x);
  for (const p of book.prepays ?? []) {
    // notation courante si l'état complet est disponible, sinon celle de l'origine (scénarios de risque)
    const rating = 'companies' in v ? cpRating(v as GameState, p.counterpartyId) : p.rating0;
    out[p.commodity] += prepayValueIn(v.market, v.day, p, rating);
  }
  return out;
}

/** Valeur des FFA (fret, hors commodités). */
export function freightBookValue(v: View, book: Book): number {
  return (book.ffa ?? []).reduce((s, p) => s + ffaValue(v as GameState, p) - p.mark, 0);
}

export function bookValue(v: View, book: Book): number {
  const by = valueBy(v, book);
  return COMMODITY_IDS.reduce((s, c) => s + by[c], 0) + freightBookValue(v, book);
}

/** Actifs industriels et contrats de stream au bilan (valeur comptable, pas de marquage au marché). */
export function fixedAssetsValue(state: GameState): number {
  return (state.assets ?? []).reduce((s, a) => s + a.bookValue, 0) + (state.streams ?? []).reduce((s, x) => s + streamBook(x), 0) + officeBookValue(state);
}

export function nav(state: GameState): number {
  const coll = Object.values(state.credit?.collateral ?? {}).reduce((a, b) => a + b, 0);
  return state.company.cash - state.company.rcfDrawn - loansOutstanding(state) + coll + bookValue(state, bookOf(state)) + fixedAssetsValue(state);
}

/** Valeur économique cumulée par commodité (flux cumulés + MTM ouvert). Sa variation = P&L de la commodité. */
export function valueByCommodity(state: GameState): Record<CommodityId, number> {
  const out = valueBy(state, bookOf(state));
  for (const id of COMMODITY_IDS) out[id] += state.company.cumCashByCommodity[id];
  return out;
}

export interface Exposure {
  commodity: CommodityId;
  futuresQty: number;
  forwardQty: number;
  inventoryQty: number;
  transitQty: number; // cargaisons en mer
  optionQty: number; // delta des options (unités)
  otcQty: number; // delta des swaps/APO (unités)
  netQty: number;
  /** Delta en USD : variation de valeur pour +1 % sur toute la courbe. */
  delta1pct: number;
}

/** Delta (unités physiques) d'une position OTC : part des fixings restants pour un swap, sensibilité pour une APO. */
export function otcDeltaUnits(v: View, x: Book['otc'][number]): number {
  const spec = COMMODITIES[x.commodity];
  const a = avgInputs(v, x.commodity, x.month);
  const df = discount(v.market, spec.currency, v.day, a.payDay);
  if (x.kind === 'swap') return (x.qty * a.days.length * df) / a.n;
  if (!a.fwds.length) return 0;
  const up = apoUnitPrice(v, x.commodity, x.month, x.strike, x.type!, { fwdScale: 1.001 });
  const dn = apoUnitPrice(v, x.commodity, x.month, x.strike, x.type!, { fwdScale: 0.999 });
  const favg = a.fwds.reduce((s, f) => s + f, 0) / a.fwds.length;
  return (x.qty * (up - dn)) / 0.002 / favg;
}

/** Exposition nette en unités physiques : futures + forwards + stocks + deltas des options et OTC. */
export function exposures(state: GameState): Exposure[] {
  return COMMODITY_IDS.map((c) => {
    const spec = COMMODITIES[c];
    const m = state.market;
    const k = spec.valuePerUnit * fx(m, spec.currency);
    let fq = 0, wq = 0, iq = 0, oq = 0, xq = 0, tq = 0, d = 0;
    for (const v of (state.voyages ?? []).filter((x) => x.commodity === c)) {
      tq += v.qty;
      d += v.qty * forwardAt(m, c, v.arriveDay) * k * 0.01;
    }
    for (const p of state.futures.filter((x) => x.commodity === c)) {
      const q = p.lots * lotQty(spec, p.month);
      fq += q;
      d += q * futuresPrice(m, c, p.month) * k * 0.01;
    }
    for (const f of state.forwards.filter((x) => x.commodity === c)) {
      wq += f.side * f.qty;
      d += f.side * f.qty * forwardAt(m, c, f.deliveryDay) * k * 0.01 * discount(m, spec.currency, state.day, f.deliveryDay);
    }
    for (const l of state.inventory.filter((x) => x.commodity === c)) {
      iq += l.qty;
      d += l.qty * spotPrice(m, c) * (l.quality ?? 1) * k * 0.01;
    }
    for (const o of state.options.filter((x) => x.commodity === c)) {
      const g = optionUnitGreeks(m, o);
      const q = g.delta * o.lots * lotQty(spec, o.month);
      oq += q;
      d += q * g.F * k * 0.01;
    }
    for (const x of state.otc.filter((y) => y.commodity === c)) {
      const q = otcDeltaUnits(state, x);
      xq += q;
      const a = avgInputs(state, c, x.month);
      const favg = a.fwds.length ? a.fwds.reduce((s, f) => s + f, 0) / a.fwds.length : spotPrice(m, c);
      d += q * favg * k * 0.01;
    }
    for (const p of (state.financing?.prepays ?? []).filter((y) => y.commodity === c)) {
      for (const s of p.schedule) {
        wq += s.qty;
        d += s.qty * forwardAt(m, c, s.day) * k * 0.01 * discount(m, spec.currency, state.day, s.day);
      }
    }
    for (const x of (state.exotics ?? []).filter((y) => exoticLegs(y).includes(c))) {
      const q = exoticDeltaUnits(m, x, c);
      xq += q;
      d += q * futuresPrice(m, c, x.spreadId && c !== x.commodity ? x.month2! : x.month) * k * 0.01;
    }
    return { commodity: c, futuresQty: fq, forwardQty: wq, inventoryQty: iq, transitQty: tq, optionQty: oq, otcQty: xq, netQty: fq + wq + iq + tq + oq + xq, delta1pct: d };
  });
}
