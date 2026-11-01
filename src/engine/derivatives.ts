/**
 * Dérivés : options listées sur futures et dérivés de gré à gré (swaps sur moyenne mensuelle, APO).
 *
 * Options listées : prime payée à l'achat (style « equity », comme ICE Brent), marge SPAN sur les ventes,
 * exercice automatique à l'expiration si dans la monnaie (on reçoit le future au strike), exercice anticipé
 * manuel possible pour les américaines.
 * OTC : réglés en cash sur la moyenne des fixings spot quotidiens du mois ; pas de marge (pas de CSA en phase 2),
 * donc risque de crédit bancaire (traité en phase 3).
 */
import { COMMODITIES } from '../data/commodities';
import { COUNTERPARTIES } from '../data/counterparties';
import { monthIndexOf, monthLabel, yearFrac, type Day, type MonthIndex } from './calendar';
import { fixingDays, listedMonths, lotQty, optionExpiry, optionMonths } from './contracts';
import { addCash, log, newId } from './ledger';
import { depthLots, halfSpread, monthOffset } from './liquidity';
import { discount, forwardAt, futuresPrice, fx, rate, spotPrice } from './market';
import { fixingCovariance } from './model';
import { asianMoments, asianPrice, vanillaGreeks, vanillaPrice, type Greeks } from './pricing';
import { roundTo } from './math';
import type { ActionResult, CommodityId, GameState, MarketState, OptType, OptionPosition, OtcPosition, Fixing } from './types';
import { impliedVolAt, smileFactor } from './volsurface';

/** Vue minimale pour valoriser : marché, date, fixings. */
export interface View {
  market: MarketState;
  day: Day;
  fixings: Record<CommodityId, Fixing[]>;
}

export interface OptionLike {
  commodity: CommodityId;
  month: MonthIndex;
  type: OptType;
  strike: number;
  expiry: Day;
  style: 'A' | 'E';
}

export function optionInputs(m: MarketState, o: OptionLike) {
  const F = futuresPrice(m, o.commodity, o.month);
  const T = Math.max(0, yearFrac(m.day, o.expiry));
  const sigma = impliedVolAt(m, o.commodity, o.month, o.expiry, o.strike, F);
  const r = rate(m, COMMODITIES[o.commodity].currency);
  return { F, T, sigma, r };
}

/** Prix unitaire (devise de cotation par unité physique). */
export function optionUnitPrice(m: MarketState, o: OptionLike): number {
  const { F, T, sigma, r } = optionInputs(m, o);
  return vanillaPrice(F, o.strike, T, sigma, r, o.type, o.style);
}

export function optionUnitGreeks(m: MarketState, o: OptionLike): Greeks & { sigma: number; F: number; T: number } {
  const { F, T, sigma, r } = optionInputs(m, o);
  return { ...vanillaGreeks(F, o.strike, T, sigma, r, o.type, o.style), sigma, F, T };
}

export function optionValueUsd(m: MarketState, p: OptionPosition): number {
  const spec = COMMODITIES[p.commodity];
  return optionUnitPrice(m, p) * p.lots * lotQty(spec, p.month) * spec.valuePerUnit * fx(m, spec.currency);
}

export interface OptionQuote {
  mid: number;
  bid: number;
  ask: number;
  iv: number;
  halfSpread: number;
  depth: number;
  greeks: Greeks;
}

/** Cotation : fourchette en points de vol, plus large loin de la monnaie, sur les échéances lointaines et en crise. */
export function optionQuote(m: MarketState, o: OptionLike): OptionQuote {
  const spec = COMMODITIES[o.commodity];
  const g = optionUnitGreeks(m, o);
  const x = g.T > 0 ? Math.log(o.strike / g.F) / (g.sigma * Math.sqrt(Math.max(g.T, 1 / 365))) : 0;
  const stress = m.volRegime === 'stressed' ? 2 : 1;
  const hsVol = spec.options.volHalfSpread * (1 + 0.5 * Math.abs(x)) * (1 + 0.05 * monthOffset(m, o.commodity, o.month)) * stress;
  const hs = Math.max(spec.tick, hsVol * g.vega * 100);
  const depth = Math.max(2, depthLots(m, o.commodity, o.month) * 0.3 * Math.exp(-Math.abs(x) / 1.5));
  return { mid: g.price, bid: Math.max(0, g.price - hs), ask: g.price + hs, iv: g.sigma, halfSpread: hs, depth, greeks: g };
}

export function optionExecPrice(m: MarketState, o: OptionLike, lots: number): number {
  const spec = COMMODITIES[o.commodity];
  const q = optionQuote(m, o);
  const px = q.mid + Math.sign(lots) * q.halfSpread * (1 + Math.abs(lots) / q.depth);
  return lots > 0 ? Math.ceil(px / spec.tick - 1e-9) * spec.tick : Math.max(0, Math.floor(px / spec.tick + 1e-9) * spec.tick);
}

// ------------------------------------------------------------------ OTC : swaps et APO

export interface AvgInputs {
  pastSum: number;
  nPast: number;
  n: number;
  days: Day[]; // fixings restants
  times: number[];
  fwds: number[];
  payDay: Day;
}

/** Fixings connus et forwards des fixings restants d'un mois de moyenne. */
export function avgInputs(v: View, c: CommodityId, mi: MonthIndex): AvgInputs {
  const all = fixingDays(mi);
  const known = new Map(v.fixings[c].map((f) => [f.day, f.px]));
  let pastSum = 0, nPast = 0;
  const days: Day[] = [];
  for (const d of all) {
    const px = known.get(d);
    if (px !== undefined && d <= v.day) {
      pastSum += px;
      nPast++;
    } else if (d >= v.day) days.push(d);
    else {
      // jour passé sans fixing enregistré (avant le début de partie) : on utilise le spot courant
      pastSum += spotPrice(v.market, c);
      nPast++;
    }
  }
  return {
    pastSum, nPast, n: all.length, days,
    times: days.map((d) => Math.max(0, yearFrac(v.day, d))),
    fwds: days.map((d) => forwardAt(v.market, c, d)),
    payDay: all[all.length - 1]!,
  };
}

/** Moyenne attendue (prix équitable d'un swap, non actualisé). */
export function expectedAverage(a: AvgInputs): number {
  return (a.pastSum + a.fwds.reduce((s, x) => s + x, 0)) / a.n;
}

/**
 * Prix unitaire d'une APO. Moments exacts du modèle (covariance des fixings Schwartz-Smith), puis couche de
 * marché : covariance multipliée par (ivLevel × smile(K))², + choc de vol additif éventuel.
 * `timeShiftDays` décale les fixings restants (theta).
 */
export function apoUnitPrice(v: View, c: CommodityId, mi: MonthIndex, K: number, type: OptType, opts: { timeShiftDays?: number; fwdScale?: number } = {}): number {
  const m = v.market;
  const spec = COMMODITIES[c];
  const a = avgInputs(v, c, mi);
  const ts = a.times.map((t) => Math.max(0, t - (opts.timeShiftDays ?? 0) / 365));
  const fw = a.fwds.map((f) => f * (opts.fwdScale ?? 1));
  const p = spec.model;
  const cov = ts.map((ti) => ts.map((tj) => fixingCovariance(p, ti, tj, m.volMult)));
  const raw = asianMoments(fw, cov, a.n);
  const Kadj = K - a.pastSum / a.n;
  const v0 = Math.max(1e-12, Math.log(raw.M2 / (raw.M1 * raw.M1)));
  const tLast = Math.max(1 / 365, ts[ts.length - 1] ?? 0);
  const sigEff = Math.sqrt(v0 / tLast);
  const x = Kadj > 0 && raw.M1 > 0 ? Math.log(Kadj / raw.M1) / Math.sqrt(v0) : 0;
  const scale = m.ivLevel[c] * smileFactor(m, c, x) + (m.volShift ?? 0) / Math.max(1e-6, sigEff);
  const s2 = scale * scale;
  const covAdj = cov.map((row) => row.map((x2) => x2 * s2));
  const { M1, M2 } = asianMoments(fw, covAdj, a.n);
  const df = discount(m, spec.currency, v.day, a.payDay);
  return asianPrice(M1, M2, K, a.pastSum, a.n, df, type);
}

export function otcUnitValue(v: View, p: OtcPosition): number {
  const spec = COMMODITIES[p.commodity];
  if (p.kind === 'swap') {
    const a = avgInputs(v, p.commodity, p.month);
    return (expectedAverage(a) - p.strike) * discount(v.market, spec.currency, v.day, a.payDay);
  }
  return apoUnitPrice(v, p.commodity, p.month, p.strike, p.type!);
}

export function otcValueUsd(v: View, p: OtcPosition): number {
  const spec = COMMODITIES[p.commodity];
  return otcUnitValue(v, p) * p.qty * spec.valuePerUnit * fx(v.market, spec.currency);
}

/** Mois de moyenne proposés par les banques : le mois courant (s'il reste des fixings) et les 11 suivants. */
export function otcMonths(v: View): MonthIndex[] {
  const cur = monthIndexOf(v.day);
  const out: MonthIndex[] = [];
  for (let mi = cur; mi < cur + 12; mi++) if (fixingDays(mi).some((d) => d >= v.day)) out.push(mi);
  return out;
}

/** Demi-fourchette banque pour un swap : deux fois celle du future le plus proche (plus en crise). */
export function swapHalfSpread(m: MarketState, c: CommodityId, mi: MonthIndex): number {
  const spec = COMMODITIES[c];
  const months = listedMonths(spec, m.day);
  const near = months.reduce((b, x) => (Math.abs(x - mi) < Math.abs(b - mi) ? x : b), months[0]!);
  return 2 * halfSpread(m, c, near);
}

export interface OtcQuote {
  mid: number;
  bid: number;
  ask: number;
  vega?: number;
}

/** Cotation banque. Swap : prix fixe ; APO : prime par unité (1,5 point de vol de demi-fourchette). */
export function otcQuote(v: View, kind: 'swap' | 'apo', c: CommodityId, mi: MonthIndex, K?: number, type?: OptType, cva = 1): OtcQuote {
  if (kind === 'swap') {
    const mid = expectedAverage(avgInputs(v, c, mi));
    const hs = swapHalfSpread(v.market, c, mi) * cva;
    return { mid, bid: mid - hs, ask: mid + hs };
  }
  const mid = apoUnitPrice(v, c, mi, K!, type!);
  const up = apoUnitPrice({ ...v, market: { ...v.market, volShift: (v.market.volShift ?? 0) + 0.01 } }, c, mi, K!, type!);
  const vega = up - mid;
  const stress = v.market.volRegime === 'stressed' ? 2 : 1;
  const hs = Math.max(COMMODITIES[c].tick, 1.5 * vega * stress * cva);
  return { mid, bid: Math.max(0, mid - hs), ask: mid + hs, vega };
}

/** Plafond d'encours OTC (notionnel) : 3× les fonds propres, toutes banques confondues. */
export const OTC_LEVERAGE = 3;

export function otcNotional(state: GameState): number {
  return state.otc.reduce((s, p) => {
    const spec = COMMODITIES[p.commodity];
    return s + Math.abs(p.qty * p.strike * spec.valuePerUnit * fx(state.market, spec.currency));
  }, 0);
}

/** Banque contrepartie du prochain OTC (rotation entre les banques encore en vie). */
export function pickBank(state: GameState): string {
  const banks = COUNTERPARTIES.filter((c) => c.kind === 'bank' && (state.companies?.find((x) => x.id === c.id)?.alive ?? true));
  return (banks.length ? banks : COUNTERPARTIES.filter((c) => c.kind === 'bank'))[state.nextId % Math.max(1, banks.length)]!.id;
}

/** Charge de CVA : sans CSA, la banque élargit sa fourchette pour couvrir son risque de crédit sur vous. */
export function otcCva(state: GameState, bankId: string): number {
  return state.credit?.csa[bankId] ? 1 : 1.3;
}

export function tradeOtc(state: GameState, kind: 'swap' | 'apo', c: CommodityId, mi: MonthIndex, qty: number, navValue: number, strike?: number, type?: OptType): ActionResult {
  const spec = COMMODITIES[c];
  if (!otcMonths(state).includes(mi)) return { ok: false, message: 'Mois de moyenne non proposé.' };
  if (!qty) return { ok: false, message: 'Quantité nulle.' };
  if (kind === 'apo' && (!strike || !type)) return { ok: false, message: 'Strike et type requis.' };
  const bankId = pickBank(state);
  const q = otcQuote(state, kind, c, mi, strike, type, otcCva(state, bankId));
  const px = roundTo(qty > 0 ? q.ask : q.bid, spec.tick);
  const ref = kind === 'swap' ? px : strike!;
  const notional = Math.abs(qty * ref * spec.valuePerUnit * fx(state.market, spec.currency));
  if (otcNotional(state) + notional > OTC_LEVERAGE * Math.max(0, navValue)) {
    return { ok: false, message: `Les banques refusent : encours OTC plafonné à ${OTC_LEVERAGE}× vos fonds propres.` };
  }
  if (kind === 'apo') {
    const prem = px * qty * spec.valuePerUnit * fx(state.market, spec.currency);
    if (qty > 0 && prem > state.company.cash - state.company.im) return { ok: false, message: 'Cash insuffisant pour payer la prime.' };
    addCash(state, -prem, 'premium', c);
  }
  state.otc.push({ id: newId(state, 'x'), kind, commodity: c, month: mi, qty, strike: kind === 'swap' ? px : strike!, type, bankId, tradeDay: state.day, avgPremium: kind === 'apo' ? px : 0 });
  const label = kind === 'swap' ? `swap ${spec.short} ${monthLabel(mi)} à ${px.toFixed(spec.decimals)}` : `APO ${type === 'C' ? 'call' : 'put'} ${spec.short} ${monthLabel(mi)} K=${strike} (prime ${px.toFixed(spec.decimals)})`;
  log(state, `${qty > 0 ? 'Achat' : 'Vente'} ${label}`);
  return { ok: true, message: `${qty > 0 ? 'Achat' : 'Vente'} ${label}.` };
}

/** Enregistre les fixings spot du jour (à la clôture). */
export function recordFixings(state: GameState) {
  for (const c of Object.keys(state.fixings) as CommodityId[]) {
    const arr = state.fixings[c];
    if (arr[arr.length - 1]?.day !== state.day) arr.push({ day: state.day, px: spotPrice(state.market, c) });
    if (arr.length > 90) arr.shift();
  }
}

/** Règlement des OTC dont le dernier fixing est passé : cash = qté × (moyenne − prix fixe) ou payoff de l'APO. */
export function settleOtc(state: GameState): string[] {
  const msgs: string[] = [];
  state.otc = state.otc.filter((p) => {
    const a = avgInputs(state, p.commodity, p.month);
    if (a.payDay > state.day) return true;
    const spec = COMMODITIES[p.commodity];
    const avg = a.pastSum / a.n;
    const payoff = p.kind === 'swap' ? avg - p.strike : Math.max(0, p.type === 'C' ? avg - p.strike : p.strike - avg);
    const cash = payoff * p.qty * spec.valuePerUnit * fx(state.market, spec.currency);
    addCash(state, cash, 'otc', p.commodity);
    const m = `${p.kind === 'swap' ? 'Swap' : 'APO'} ${spec.short} ${monthLabel(p.month)} réglé : moyenne ${avg.toFixed(spec.decimals)}, flux ${(cash / 1e3).toFixed(0)} k$.`;
    msgs.push(m);
    log(state, m, cash);
    return false;
  });
  return msgs;
}

export function listedOptionSpec(state: GameState, c: CommodityId, mi: MonthIndex): { expiry: Day; style: 'A' | 'E' } | null {
  const spec = COMMODITIES[c];
  if (!optionMonths(spec, state.day).includes(mi)) return null;
  return { expiry: optionExpiry(spec, mi), style: spec.options.style };
}
