/**
 * Futures : exécution, marge de variation « trade-date » et quotidienne, échéances.
 *
 * Astuce comptable : une position porte un seul prix de marquage `mark`. Quand on ajoute Δ lots au
 * prix p alors que la position est marquée à m, on crédite immédiatement (m − p)·Δ : la marge de
 * variation du soir, calculée sur toute la position depuis m, redonne alors exactement
 * (règlement − p)·Δ pour les nouveaux lots. Valable pour augmenter, réduire ou retourner une position.
 */
import { COMMODITIES } from '../data/commodities';
import { listedMonths, lastTradingDay, lotQty } from './contracts';
import { monthLabel } from './calendar';
import { addCash, log } from './ledger';
import { execPrice, liquidityLabel, quote } from './liquidity';
import { contractVol, futuresPrice, fx, IM_HORIZON, IM_Z } from './market';
import { recomputeIm, totalIm } from './margin';
import { rcfHeadroom } from './treasury';
import type { ActionResult, CommodityId, FuturesPosition, GameState } from './types';

export function commissionUsd(state: GameState, c: CommodityId, lots: number): number {
  const spec = COMMODITIES[c];
  return Math.abs(lots) * spec.liquidity.commission * fx(state.market, spec.currency);
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
  liquidityAfter: number; // cash − IM + RCF disponible après l'ordre
  var99_2d: number; // perte à 99 % sur ~2 jours ouvrés de la jambe seule
  stress20: number; // perte si la courbe bouge de 20 % contre soi
  liquidity: ReturnType<typeof liquidityLabel>;
  depth: number;
  vol: number;
  ltd: number;
}

function applyLots(positions: FuturesPosition[], c: CommodityId, month: number, lots: number, price: number): FuturesPosition[] {
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
  const imBefore = state.company.im;
  const imAfter = totalIm(m, applyLots(state.futures, c, month, lots, exec));
  const slippage = Math.abs(exec - q.mid) * Math.abs(qty) * k;
  const comm = commissionUsd(state, c, lots);
  const vol = contractVol(m, c, month);
  return {
    mid: q.mid,
    exec,
    qty,
    notionalUsd: notional,
    slippageUsd: slippage,
    commissionUsd: comm,
    imBefore,
    imAfter,
    liquidityAfter: state.company.cash - slippage - comm - imAfter + rcfHeadroom(state),
    var99_2d: notional * vol * IM_Z * Math.sqrt(IM_HORIZON),
    stress20: notional * 0.2,
    liquidity: liquidityLabel(lots, q.depth),
    depth: q.depth,
    vol,
    ltd: lastTradingDay(spec, month),
  };
}

export function tradeFuture(state: GameState, c: CommodityId, month: number, lots: number): ActionResult {
  const spec = COMMODITIES[c];
  if (!Number.isInteger(lots) || lots === 0) return { ok: false, message: 'Nombre de lots invalide.' };
  if (!listedMonths(spec, state.day).includes(month)) return { ok: false, message: 'Échéance non cotée.' };
  const pv = previewFuture(state, c, month, lots);
  const reducing = state.futures.some((p) => p.commodity === c && p.month === month && Math.sign(p.lots) !== Math.sign(lots) && Math.abs(lots) <= Math.abs(p.lots));
  if (!reducing && pv.liquidityAfter < 0) {
    return { ok: false, message: 'Le courtier refuse : marge initiale non couverte (cash + RCF insuffisants).' };
  }
  const k = lotQty(spec, month) * spec.valuePerUnit * fx(state.market, spec.currency);
  addCash(state, -pv.commissionUsd, 'commission', c);
  const pos = state.futures.find((p) => p.commodity === c && p.month === month);
  if (!pos) {
    state.futures.push({ commodity: c, month, lots, mark: pv.exec, avgPrice: pv.exec });
  } else {
    addCash(state, (pos.mark - pv.exec) * lots * k, 'vm', c);
    const before = pos.lots;
    const after = before + lots;
    if (Math.sign(before) === Math.sign(lots)) pos.avgPrice = (pos.avgPrice * before + pv.exec * lots) / after;
    else if (after !== 0 && Math.sign(after) !== Math.sign(before)) pos.avgPrice = pv.exec;
    pos.lots = after;
    if (after === 0) state.futures = state.futures.filter((p) => p !== pos);
  }
  recomputeIm(state);
  log(state, `${lots > 0 ? 'Achat' : 'Vente'} ${Math.abs(lots)} lots ${spec.short} ${monthLabel(month)} à ${pv.exec.toFixed(spec.decimals)}`);
  return { ok: true, message: `Exécuté à ${pv.exec.toFixed(spec.decimals)} ${spec.priceUnit}.` };
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

/** Liquidation forcée par le courtier : toutes les positions futures sont fermées au marché. */
export function liquidateAllFutures(state: GameState) {
  for (const p of [...state.futures]) {
    const spec = COMMODITIES[p.commodity];
    const exec = execPrice(state.market, p.commodity, p.month, -p.lots);
    const k = lotQty(spec, p.month) * spec.valuePerUnit * fx(state.market, spec.currency);
    addCash(state, (exec - p.mark) * p.lots * k, 'liquidation', p.commodity);
    addCash(state, -commissionUsd(state, p.commodity, p.lots) * 2, 'liquidation', p.commodity);
  }
  state.futures = [];
  recomputeIm(state);
}
