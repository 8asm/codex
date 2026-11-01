/**
 * Exécution : futures, spreads calendaires, options listées, exercice et expirations.
 *
 * Astuce comptable des futures : une position porte un seul prix de marquage `mark`. Quand on ajoute Δ lots
 * au prix p alors que la position est marquée à m, on crédite immédiatement (m − p)·Δ : la marge de variation
 * du soir, calculée depuis m sur toute la position, redonne exactement (règlement − p)·Δ pour les nouveaux lots.
 *
 * Impact de marché : chaque ordre futures déplace durablement le mid de l'échéance traitée
 * (proportionnel à taille/profondeur × demi-fourchette), effet qui s'estompe la nuit (×0,35).
 */
import { COMMODITIES } from '../data/commodities';
import { listedMonths, lastTradingDay, lotQty } from './contracts';
import { monthLabel } from './calendar';
import { listedOptionSpec, optionExecPrice, optionQuote, optionUnitGreeks, type OptionLike } from './derivatives';
import { addCash, log, newId } from './ledger';
import { depthLots, execPrice, halfSpread, liquidityLabel, quote } from './liquidity';
import { contractVol, futuresPrice, fx, IM_HORIZON, IM_Z, isHalted } from './market';
import { recomputeIm, totalIm } from './margin';
import { rcfHeadroom } from './treasury';
import type { ActionResult, CommodityId, FuturesPosition, GameState, OptType, OptionPosition } from './types';

/** Coefficient d'impact permanent (fraction de la demi-fourchette relative, par profondeur traitée). */
export const IMPACT_COEF = 1;

export function commissionUsd(state: GameState, c: CommodityId, lots: number): number {
  const spec = COMMODITIES[c];
  return Math.abs(lots) * spec.liquidity.commission * fx(state.market, spec.currency);
}

/** Applique un remplissage futures au prix `price` (marge trade-date, prix moyen). Sans commission. */
export function applyFuturesFill(state: GameState, c: CommodityId, month: number, lots: number, price: number) {
  const spec = COMMODITIES[c];
  const k = lotQty(spec, month) * spec.valuePerUnit * fx(state.market, spec.currency);
  const pos = state.futures.find((p) => p.commodity === c && p.month === month);
  if (!pos) {
    state.futures.push({ commodity: c, month, lots, mark: price, avgPrice: price });
    return;
  }
  addCash(state, (pos.mark - price) * lots * k, 'vm', c);
  const before = pos.lots;
  const after = before + lots;
  if (Math.sign(before) === Math.sign(lots)) pos.avgPrice = (pos.avgPrice * before + price * lots) / after;
  else if (after !== 0 && Math.sign(after) !== Math.sign(before)) pos.avgPrice = price;
  pos.lots = after;
  if (after === 0) state.futures = state.futures.filter((p) => p !== pos);
}

function addImpact(state: GameState, c: CommodityId, month: number, lots: number) {
  const m = state.market;
  const mid = futuresPrice(m, c, month);
  const key = `${c}:${month}`;
  const d = Math.sign(lots) * IMPACT_COEF * (halfSpread(m, c, month) / mid) * (Math.abs(lots) / depthLots(m, c, month));
  m.impact[key] = (m.impact[key] ?? 0) + d;
}

/** Limites de position de la bourse : mois spot (première échéance) et toutes échéances (net). */
export function positionLimitCheck(state: GameState, c: CommodityId, month: number, lots: number): string | null {
  const spec = COMMODITIES[c];
  const front = listedMonths(spec, state.day)[0];
  const cur = state.futures.find((p) => p.commodity === c && p.month === month)?.lots ?? 0;
  const after = cur + lots;
  if (month === front && Math.abs(after) > spec.positionLimits.spotMonth && Math.abs(after) > Math.abs(cur)) {
    return `Limite de position de la bourse sur le mois spot : ${spec.positionLimits.spotMonth} lots.`;
  }
  const net = state.futures.filter((p) => p.commodity === c).reduce((s, p) => s + p.lots, 0);
  if (Math.abs(net + lots) > spec.positionLimits.allMonths && Math.abs(net + lots) > Math.abs(net)) {
    return `Limite de position de la bourse toutes échéances : ${spec.positionLimits.allMonths} lots nets.`;
  }
  return null;
}

export interface FuturePreview {
  mid: number;
  exec: number;
  qty: number;
  notionalUsd: number;
  slippageUsd: number;
  commissionUsd: number;
  imBefore: number;
  imAfter: number;
  liquidityAfter: number;
  var99_2d: number;
  stress20: number;
  liquidity: ReturnType<typeof liquidityLabel>;
  depth: number;
  vol: number;
  ltd: number;
  limitIssue: string | null;
}

function withLots(positions: FuturesPosition[], c: CommodityId, month: number, lots: number, price: number): FuturesPosition[] {
  const out = positions.map((p) => ({ ...p }));
  const pos = out.find((p) => p.commodity === c && p.month === month);
  if (!pos) out.push({ commodity: c, month, lots, mark: price, avgPrice: price });
  else pos.lots += lots;
  return out.filter((p) => p.lots !== 0);
}

export function previewFuture(state: GameState, c: CommodityId, month: number, lots: number): FuturePreview {
  const spec = COMMODITIES[c];
  const m = state.market;
  const q = quote(m, c, month);
  const exec = lots === 0 ? q.mid : execPrice(m, c, month, lots);
  const qty = lots * lotQty(spec, month);
  const k = spec.valuePerUnit * fx(m, spec.currency);
  const notional = Math.abs(qty * q.mid * k);
  const imAfter = totalIm(m, withLots(state.futures, c, month, lots, exec), state.options);
  const slippage = Math.abs(exec - q.mid) * Math.abs(qty) * k;
  const comm = commissionUsd(state, c, lots);
  const vol = contractVol(m, c, month);
  return {
    mid: q.mid, exec, qty, notionalUsd: notional, slippageUsd: slippage, commissionUsd: comm,
    imBefore: state.company.im, imAfter,
    liquidityAfter: state.company.cash - slippage - comm - imAfter + rcfHeadroom(state),
    var99_2d: notional * vol * IM_Z * Math.sqrt(IM_HORIZON),
    stress20: notional * 0.2,
    liquidity: liquidityLabel(lots, q.depth),
    depth: q.depth, vol, ltd: lastTradingDay(spec, month),
    limitIssue: positionLimitCheck(state, c, month, lots),
  };
}

function reduces(state: GameState, c: CommodityId, month: number, lots: number) {
  return state.futures.some((p) => p.commodity === c && p.month === month && Math.sign(p.lots) !== Math.sign(lots) && Math.abs(lots) <= Math.abs(p.lots));
}

export function tradeFuture(state: GameState, c: CommodityId, month: number, lots: number): ActionResult {
  const spec = COMMODITIES[c];
  if (!Number.isInteger(lots) || lots === 0) return { ok: false, message: 'Nombre de lots invalide.' };
  if (!listedMonths(spec, state.day).includes(month)) return { ok: false, message: 'Échéance non cotée.' };
  if (isHalted(state.market, c)) return { ok: false, message: `Cotation du ${spec.short} suspendue par la bourse.` };
  const pv = previewFuture(state, c, month, lots);
  if (pv.limitIssue) return { ok: false, message: pv.limitIssue };
  if (!reduces(state, c, month, lots) && pv.liquidityAfter < 0) {
    return { ok: false, message: 'Le courtier refuse : marge initiale non couverte (cash + RCF insuffisants).' };
  }
  addCash(state, -pv.commissionUsd, 'commission', c);
  applyFuturesFill(state, c, month, lots, pv.exec);
  addImpact(state, c, month, lots);
  recomputeIm(state);
  log(state, `${lots > 0 ? 'Achat' : 'Vente'} ${Math.abs(lots)} lots ${spec.short} ${monthLabel(month)} à ${pv.exec.toFixed(spec.decimals)}`);
  return { ok: true, message: `Exécuté à ${pv.exec.toFixed(spec.decimals)} ${spec.priceUnit}.` };
}

/**
 * Spread calendaire : achat de `near` et vente de `far` (lots > 0), en un seul ordre. Le carnet de spread
 * est plus serré que la somme des jambes : demi-fourchette ×0,5 par jambe, profondeur ×1,5.
 */
export function previewSpread(state: GameState, c: CommodityId, near: number, far: number, lots: number) {
  const m = state.market;
  const spec = COMMODITIES[c];
  const legs = [[near, lots], [far, -lots]] as const;
  const fills = legs.map(([mi, l]) => {
    const mid = futuresPrice(m, c, mi);
    const hs = halfSpread(m, c, mi) * 0.5 * (1 + Math.abs(l) / (depthLots(m, c, mi) * 1.5));
    const raw = mid + Math.sign(l) * hs;
    const px = (l > 0 ? Math.ceil(raw / spec.tick - 1e-9) : Math.floor(raw / spec.tick + 1e-9)) * spec.tick;
    return { mi, l, mid, px };
  });
  let positions = state.futures;
  for (const f of fills) positions = withLots(positions, c, f.mi, f.l, f.px);
  const imAfter = totalIm(m, positions, state.options);
  const comm = commissionUsd(state, c, lots) * 2;
  const k = spec.valuePerUnit * fx(m, spec.currency);
  const cost = fills.reduce((s, f) => s + Math.abs(f.px - f.mid) * Math.abs(f.l) * lotQty(spec, f.mi) * k, 0);
  return {
    fills,
    spreadMid: fills[0]!.mid - fills[1]!.mid,
    spreadExec: fills[0]!.px - fills[1]!.px,
    imAfter,
    cost: cost + comm,
    liquidityAfter: state.company.cash - cost - comm - imAfter + rcfHeadroom(state),
  };
}

export function tradeSpread(state: GameState, c: CommodityId, near: number, far: number, lots: number): ActionResult {
  const spec = COMMODITIES[c];
  const months = listedMonths(spec, state.day);
  if (near === far || !months.includes(near) || !months.includes(far) || !Number.isInteger(lots) || lots === 0) return { ok: false, message: 'Spread invalide.' };
  if (isHalted(state.market, c)) return { ok: false, message: `Cotation du ${spec.short} suspendue par la bourse.` };
  const pv = previewSpread(state, c, near, far, lots);
  for (const f of pv.fills) {
    const issue = positionLimitCheck(state, c, f.mi, f.l);
    if (issue) return { ok: false, message: issue };
  }
  if (pv.liquidityAfter < 0 && pv.imAfter > state.company.im) return { ok: false, message: 'Le courtier refuse : marge non couverte.' };
  addCash(state, -commissionUsd(state, c, lots) * 2, 'commission', c);
  for (const f of pv.fills) {
    applyFuturesFill(state, c, f.mi, f.l, f.px);
    addImpact(state, c, f.mi, f.l * 0.5);
  }
  recomputeIm(state);
  log(state, `Spread ${spec.short} ${monthLabel(near)}/${monthLabel(far)} : ${lots > 0 ? 'achat' : 'vente'} de ${Math.abs(lots)} lots à ${pv.spreadExec.toFixed(spec.decimals)}`);
  return { ok: true, message: `Spread exécuté à ${pv.spreadExec.toFixed(spec.decimals)}.` };
}

/** Marge de variation du soir : chaque position est réglée en cash sur le prix de règlement. */
export function settleVariationMargin(state: GameState) {
  for (const p of state.futures) {
    const spec = COMMODITIES[p.commodity];
    const settle = futuresPrice(state.market, p.commodity, p.month);
    const vm = (settle - p.mark) * p.lots * lotQty(spec, p.month) * spec.valuePerUnit * fx(state.market, spec.currency);
    addCash(state, vm, 'vm', p.commodity);
    p.mark = settle;
  }
}

/** Échéances arrivées à leur dernier jour : réglées en cash au prix final (déjà payé par la VM du jour). */
export function expireContracts(state: GameState): string[] {
  const msgs: string[] = [];
  state.futures = state.futures.filter((p) => {
    const spec = COMMODITIES[p.commodity];
    if (lastTradingDay(spec, p.month) > state.day) return true;
    const m = `Échéance ${spec.short} ${monthLabel(p.month)} expirée : ${p.lots} lots réglés en cash à ${p.mark.toFixed(spec.decimals)}.`;
    msgs.push(m);
    log(state, m);
    return false;
  });
  return msgs;
}

/** Liquidation forcée par le courtier : futures fermés au marché, options vendues fermées au marché. */
export function liquidateAllFutures(state: GameState) {
  for (const p of [...state.futures]) {
    const spec = COMMODITIES[p.commodity];
    const exec = execPrice(state.market, p.commodity, p.month, -p.lots);
    const k = lotQty(spec, p.month) * spec.valuePerUnit * fx(state.market, spec.currency);
    addCash(state, (exec - p.mark) * p.lots * k, 'liquidation', p.commodity);
    addCash(state, -commissionUsd(state, p.commodity, p.lots) * 2, 'liquidation', p.commodity);
  }
  state.futures = [];
  for (const o of state.options.filter((x) => x.lots < 0)) {
    const spec = COMMODITIES[o.commodity];
    const px = optionExecPrice(state.market, o, -o.lots);
    addCash(state, -px * Math.abs(o.lots) * lotQty(spec, o.month) * spec.valuePerUnit * fx(state.market, spec.currency), 'liquidation', o.commodity);
  }
  state.options = state.options.filter((x) => x.lots > 0);
  recomputeIm(state);
}

// ------------------------------------------------------------------ options listées

export interface OptionPreview {
  exec: number;
  mid: number;
  iv: number;
  premiumUsd: number; // signé : négatif = on paie
  commissionUsd: number;
  imAfter: number;
  liquidityAfter: number;
  delta: number; // unités physiques
  gamma1pct: number; // variation du delta (unités) pour +1 %
  vegaUsd: number; // $ pour +1 point de vol
  thetaUsd: number; // $ par jour
  qty: number;
  expiry: number;
  style: 'A' | 'E';
  breakeven: number;
  depth: number;
}

export function optionLike(state: GameState, c: CommodityId, month: number, type: OptType, strike: number): OptionLike | null {
  const ls = listedOptionSpec(state, c, month);
  return ls ? { commodity: c, month, type, strike, expiry: ls.expiry, style: ls.style } : null;
}

export function previewOption(state: GameState, c: CommodityId, month: number, type: OptType, strike: number, lots: number): OptionPreview | null {
  const o = optionLike(state, c, month, type, strike);
  if (!o) return null;
  const spec = COMMODITIES[c];
  const m = state.market;
  const q = optionQuote(m, o);
  const exec = lots === 0 ? q.mid : optionExecPrice(m, o, lots);
  const qty = lots * lotQty(spec, month);
  const k = spec.valuePerUnit * fx(m, spec.currency);
  const opts = mergeOption(state.options, o, lots, exec);
  const imAfter = totalIm(m, state.futures, opts);
  const premium = -exec * qty * k;
  const comm = commissionUsd(state, c, lots);
  const g = optionUnitGreeks(m, o);
  return {
    exec, mid: q.mid, iv: q.iv, premiumUsd: premium, commissionUsd: comm, imAfter,
    liquidityAfter: state.company.cash + premium - comm - imAfter + rcfHeadroom(state),
    delta: g.delta * qty,
    gamma1pct: g.gamma * g.F * 0.01 * qty,
    vegaUsd: g.vega * qty * k,
    thetaUsd: g.theta * qty * k,
    qty, expiry: o.expiry, style: o.style,
    breakeven: type === 'C' ? strike + exec : strike - exec,
    depth: q.depth,
  };
}

function mergeOption(list: OptionPosition[], o: OptionLike, lots: number, price: number): OptionPosition[] {
  const out = list.map((x) => ({ ...x }));
  const pos = out.find((x) => x.commodity === o.commodity && x.month === o.month && x.type === o.type && x.strike === o.strike);
  if (pos) {
    const after = pos.lots + lots;
    if (Math.sign(pos.lots) === Math.sign(lots)) pos.avgPremium = (pos.avgPremium * pos.lots + price * lots) / after;
    else if (after !== 0 && Math.sign(after) !== Math.sign(pos.lots)) pos.avgPremium = price;
    pos.lots = after;
  } else out.push({ id: '', ...o, lots, avgPremium: price });
  return out.filter((x) => x.lots !== 0);
}

export function tradeOption(state: GameState, c: CommodityId, month: number, type: OptType, strike: number, lots: number): ActionResult {
  const spec = COMMODITIES[c];
  if (!Number.isInteger(lots) || lots === 0 || !(strike > 0)) return { ok: false, message: 'Ordre invalide.' };
  if (isHalted(state.market, c)) return { ok: false, message: `Cotation du ${spec.short} suspendue par la bourse.` };
  const pv = previewOption(state, c, month, type, strike, lots);
  if (!pv) return { ok: false, message: 'Pas d’options cotées sur cette échéance.' };
  if (lots < 0 && pv.exec <= 0) return { ok: false, message: 'Pas d’acheteur à ce prix.' };
  const existing = state.options.find((x) => x.commodity === c && x.month === month && x.type === type && x.strike === strike);
  const reducing = existing && Math.sign(existing.lots) !== Math.sign(lots) && Math.abs(lots) <= Math.abs(existing.lots);
  if (!reducing && pv.liquidityAfter < 0) return { ok: false, message: 'Liquidité insuffisante (prime ou marge non couverte).' };
  addCash(state, pv.premiumUsd, 'premium', c);
  addCash(state, -pv.commissionUsd, 'commission', c);
  const o = optionLike(state, c, month, type, strike)!;
  const merged = mergeOption(state.options, o, lots, pv.exec);
  state.options = merged.map((x) => (x.id ? x : { ...x, id: newId(state, 'op') }));
  recomputeIm(state);
  log(state, `${lots > 0 ? 'Achat' : 'Vente'} ${Math.abs(lots)} ${type === 'C' ? 'calls' : 'puts'} ${spec.short} ${monthLabel(month)} K=${strike} à ${pv.exec.toFixed(spec.decimals)}`);
  return { ok: true, message: `${type === 'C' ? 'Calls' : 'Puts'} exécutés à ${pv.exec.toFixed(spec.decimals)} (vol ${(pv.iv * 100).toFixed(1)} %).` };
}

/** Exercice (anticipé pour une américaine, ou à l'expiration) : on reçoit le future au strike. */
function exerciseInto(state: GameState, o: OptionPosition, lots: number): string {
  const spec = COMMODITIES[o.commodity];
  const futLots = (o.type === 'C' ? 1 : -1) * lots;
  if (listedMonths(spec, state.day).includes(o.month)) {
    applyFuturesFill(state, o.commodity, o.month, futLots, o.strike);
    return `${lots > 0 ? 'Exercice' : 'Assignation'} : ${futLots > 0 ? '+' : ''}${futLots} lots ${spec.short} ${monthLabel(o.month)} au strike ${o.strike}.`;
  }
  const F = futuresPrice(state.market, o.commodity, o.month);
  const intrinsic = Math.max(0, o.type === 'C' ? F - o.strike : o.strike - F);
  addCash(state, intrinsic * lots * lotQty(spec, o.month) * spec.valuePerUnit * fx(state.market, spec.currency), 'premium', o.commodity);
  return `Options ${spec.short} ${monthLabel(o.month)} K=${o.strike} réglées en cash (${intrinsic.toFixed(spec.decimals)}/unité).`;
}

export function exerciseOption(state: GameState, id: string): ActionResult {
  const o = state.options.find((x) => x.id === id);
  if (!o) return { ok: false, message: 'Option introuvable.' };
  if (o.lots <= 0) return { ok: false, message: 'Seul l’acheteur peut exercer.' };
  if (o.style !== 'A') return { ok: false, message: 'Option européenne : exercice uniquement à l’expiration.' };
  const F = futuresPrice(state.market, o.commodity, o.month);
  if ((o.type === 'C' ? F - o.strike : o.strike - F) <= 0) return { ok: false, message: 'Option hors de la monnaie : l’exercer détruirait de la valeur.' };
  const msg = exerciseInto(state, o, o.lots);
  state.options = state.options.filter((x) => x !== o);
  recomputeIm(state);
  log(state, msg);
  return { ok: true, message: msg };
}

/** Expiration du jour : exercice automatique des options dans la monnaie, les autres expirent sans valeur. */
export function expireOptions(state: GameState): string[] {
  const msgs: string[] = [];
  for (const o of state.options.filter((x) => x.expiry <= state.day)) {
    const F = futuresPrice(state.market, o.commodity, o.month);
    const itm = (o.type === 'C' ? F - o.strike : o.strike - F) > 0;
    const spec = COMMODITIES[o.commodity];
    const m = itm ? exerciseInto(state, o, o.lots) : `Options ${spec.short} ${monthLabel(o.month)} ${o.type === 'C' ? 'call' : 'put'} K=${o.strike} expirées sans valeur.`;
    msgs.push(m);
    log(state, m);
  }
  state.options = state.options.filter((x) => x.expiry > state.day);
  return msgs;
}
