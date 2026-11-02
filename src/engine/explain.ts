/**
 * P&L expliqué quotidien : on part du livre de la veille au soir et on décompose sa variation de valeur
 * en effets successifs, instrument par instrument, dans ses propres coordonnées :
 *
 *   prix   : variation des prix futures / forwards / spot (facteurs du modèle + impact de marché)
 *   base   : variation des différentiels physiques
 *   change : variation de l'EURUSD sur les positions en euros
 *   vol    : variation de la vol implicite (options, APO)
 *   temps  : écoulement du temps (theta des options, actualisation des forwards et swaps)
 *   autre  : tout le reste = nouveaux deals de la journée, coûts, intérêts, frais généraux (résidu exact)
 *
 * Le total est EXACT (égal à la variation de NAV) ; la ventilation des options est séquentielle
 * (prix → vol → temps), celle des APO est au premier ordre (voir DESIGN_NOTES.md).
 */
import { COMMODITIES } from '../data/commodities';
import { yearFrac } from './calendar';
import { lotQty } from './contracts';
import { apoUnitPrice, avgInputs, expectedAverage, type View } from './derivatives';
import { basis, basisAt, cloneMarket, discount, forwardAt, futuresPrice, fx, spotPrice, zeroRate } from './market';
import { vanillaPrice } from './pricing';
import { ffaFair } from './freight';
import type { Book, GameState, PnlExplain } from './types';
import { impliedVolAt } from './volsurface';
import { bookOf } from './valuation';
import { exoticDeltaUnits, exoticValueUsd } from './exotics';

export function snapshotForExplain(state: GameState) {
  state.explainBase = { market: cloneMarket(state.market), book: JSON.parse(JSON.stringify(bookOf(state))) as Book, day: state.day };
}

export function computeExplain(state: GameState, totalPnl: number): PnlExplain | null {
  const base = state.explainBase;
  if (!base) return null;
  const m0 = base.market;
  const m1 = state.market;
  const d0 = base.day;
  const d1 = state.day;
  const v0: View = { market: m0, day: d0, fixings: Object.fromEntries(Object.entries(state.fixings).map(([c, arr]) => [c, arr.filter((f) => f.day <= d0)])) as View['fixings'] };
  const v1: View = state;
  const e = { price: 0, basis: 0, fx: 0, vol: 0, time: 0 };
  const b = base.book;

  for (const p of b.futures) {
    const spec = COMMODITIES[p.commodity];
    const q = p.lots * lotQty(spec, p.month) * spec.valuePerUnit;
    const dF = futuresPrice(m1, p.commodity, p.month) - futuresPrice(m0, p.commodity, p.month);
    e.price += dF * q * fx(m0, spec.currency);
    e.fx += dF * q * (fx(m1, spec.currency) - fx(m0, spec.currency));
  }
  for (const d of b.forwards) {
    const spec = COMMODITIES[d.commodity];
    const q = d.side * d.qty * spec.valuePerUnit;
    const F0 = forwardAt(m0, d.commodity, d.deliveryDay), F1 = forwardAt(m1, d.commodity, d.deliveryDay);
    const b0 = basisAt(m0, d.commodity, d.locationId, d.deliveryDay), b1 = basisAt(m1, d.commodity, d.locationId, d.deliveryDay);
    const D0 = discount(m0, spec.currency, d0, d.deliveryDay), D1 = discount(m1, spec.currency, d1, d.deliveryDay);
    const x0 = fx(m0, spec.currency), x1 = fx(m1, spec.currency);
    e.price += (F1 - F0) * q * D0 * x0;
    e.basis += (b1 - b0) * q * D0 * x0;
    e.time += (F1 + b1 - d.price) * q * (D1 - D0) * x0;
    e.fx += (F1 + b1 - d.price) * q * D1 * (x1 - x0);
  }
  for (const l of b.inventory) {
    const spec = COMMODITIES[l.commodity];
    const q = l.qty * spec.valuePerUnit;
    const x0 = fx(m0, spec.currency), x1 = fx(m1, spec.currency);
    const S0 = spotPrice(m0, l.commodity), S1 = spotPrice(m1, l.commodity);
    const b0 = basis(m0, l.commodity, l.locationId), b1 = basis(m1, l.commodity, l.locationId);
    e.price += (S1 - S0) * q * x0;
    e.basis += (b1 - b0) * q * x0;
    e.fx += (S1 + b1) * q * (x1 - x0);
  }
  for (const o of b.options) {
    const spec = COMMODITIES[o.commodity];
    const q = o.lots * lotQty(spec, o.month) * spec.valuePerUnit;
    const x0 = fx(m0, spec.currency), x1 = fx(m1, spec.currency);
    const F0 = futuresPrice(m0, o.commodity, o.month), F1 = futuresPrice(m1, o.commodity, o.month);
    const T0 = Math.max(0, yearFrac(d0, o.expiry)), T1 = Math.max(0, yearFrac(d1, o.expiry));
    const s0 = impliedVolAt(m0, o.commodity, o.month, o.expiry, o.strike, F0);
    const s1 = T1 > 0 ? impliedVolAt(m1, o.commodity, o.month, o.expiry, o.strike, F1) : s0;
    const r0 = zeroRate(m0, spec.currency, T0), r1 = zeroRate(m1, spec.currency, T1);
    const sh = spec.model.shift ?? 0;
    const P = (F: number, s: number, T: number, r: number) => vanillaPrice(F + sh, o.strike + sh, T, s, r, o.type, o.style);
    const a = P(F0, s0, T0, r0), bP = P(F1, s0, T0, r0), c = P(F1, s1, T0, r0), dP = P(F1, s1, T1, r1);
    e.price += (bP - a) * q * x0;
    e.vol += (c - bP) * q * x0;
    e.time += (dP - c) * q * x0;
    e.fx += dP * q * (x1 - x0);
  }
  for (const x of b.otc) {
    const spec = COMMODITIES[x.commodity];
    const q = x.qty * spec.valuePerUnit;
    const x0 = fx(m0, spec.currency), x1 = fx(m1, spec.currency);
    const a0 = avgInputs(v0, x.commodity, x.month);
    const a1 = avgInputs(v1, x.commodity, x.month);
    const D0 = discount(m0, spec.currency, d0, a0.payDay), D1 = discount(m1, spec.currency, d1, a1.payDay);
    const EA0 = expectedAverage(a0), EA1 = expectedAverage(a1);
    if (x.kind === 'swap') {
      e.price += (EA1 - EA0) * q * D0 * x0;
      e.time += (EA1 - x.strike) * q * (D1 - D0) * x0;
      e.fx += (EA1 - x.strike) * q * D1 * (x1 - x0);
    } else {
      // APO : premier ordre (delta, vega, theta de la veille) ; le reste va en « prix ».
      const P0 = apoUnitPrice(v0, x.commodity, x.month, x.strike, x.type!);
      const P1 = a1.days.length || a1.payDay >= d1 ? apoUnitPrice(v1, x.commodity, x.month, x.strike, x.type!) : P0;
      const theta = apoUnitPrice(v0, x.commodity, x.month, x.strike, x.type!, { timeShiftDays: d1 - d0 }) - P0;
      const vegaPt = apoUnitPrice({ ...v0, market: { ...m0, volShift: (m0.volShift ?? 0) + 0.01 } }, x.commodity, x.month, x.strike, x.type!) - P0;
      const dIvPts = ((m1.ivLevel[x.commodity] - m0.ivLevel[x.commodity]) / m0.ivLevel[x.commodity]) * 100 * 0.3;
      const vol = vegaPt * dIvPts;
      e.time += theta * q * x0;
      e.vol += vol * q * x0;
      e.price += (P1 - P0 - theta - vol) * q * x0;
      e.fx += P1 * q * (x1 - x0);
    }
  }
  for (const y of b.voyages ?? []) {
    const spec = COMMODITIES[y.commodity];
    const q = y.qty * (1 - spec.logistics.transitLoss) * spec.valuePerUnit;
    const x0 = fx(m0, spec.currency), x1 = fx(m1, spec.currency);
    const T = Math.max(d1, y.arriveDay);
    const F0 = forwardAt(m0, y.commodity, T), F1 = forwardAt(m1, y.commodity, T);
    const b0 = basisAt(m0, y.commodity, y.to, T), b1 = basisAt(m1, y.commodity, y.to, T);
    e.price += (F1 - F0) * q * x0;
    e.basis += (b1 - b0) * q * x0;
    e.fx += (F1 + b1) * q * (x1 - x0);
  }
  for (const p of b.ffa ?? []) {
    const v0f = { market: m0, day: d0, freightFixings: state.freightFixings };
    e.price += p.days * (ffaFair(state, p.index, p.month) - ffaFair(v0f, p.index, p.month));
  }
  // Exotiques : delta de la veille × variation du future en « prix », le reste (vol, temps, chemin) en « vol ».
  for (const x of b.exotics ?? []) {
    const spec = COMMODITIES[x.commodity];
    const V0 = exoticValueUsd({ market: m0 }, x);
    const live = (state.exotics ?? []).find((y) => y.id === x.id);
    const V1 = live ? exoticValueUsd(state, live) : V0;
    const dF = futuresPrice(m1, x.commodity, x.month) - futuresPrice(m0, x.commodity, x.month);
    const pricePart = exoticDeltaUnits(m0, x) * dF * spec.valuePerUnit * fx(m0, spec.currency);
    e.price += pricePart;
    e.vol += V1 - V0 - pricePart;
  }
  const sum = e.price + e.basis + e.fx + e.vol + e.time;
  return { day: d1, ...e, other: totalPnl - sum, total: totalPnl };
}
