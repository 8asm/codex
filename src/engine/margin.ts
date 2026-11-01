/**
 * Marge initiale « SPAN-lite », par commodité, sur futures ET options :
 *
 *  1. Risque de scan : 16 scénarios comme SPAN — prix ∈ {0, ±⅓, ±⅔, ±1} × fourchette de scan
 *     (taux de marge bourse × prix), chacun avec vol ±25 %, plus deux scénarios extrêmes (±2× la fourchette,
 *     perte comptée à 35 %). Le scan risk est la pire perte du portefeuille de la commodité.
 *  2. Charge de spread intra-commodité : 30 % × min(L, S) des notionnels futures longs/courts marginés
 *     (les échéances ne bougent pas parfaitement ensemble, alors que le scan les déplace en bloc).
 *  3. Moins la valeur nette des options (NOV) : options achetées en crédit, options vendues en charge.
 *  4. Minimum par option vendue.
 *
 * Pour des futures seuls, cela redonne exactement |L − S| + 30 % × min(L, S).
 * Les options achetées ont une prime déjà payée : elles peuvent réduire la marge (crédit) mais jamais la rendre négative.
 */
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { yearFrac } from './calendar';
import { lotQty } from './contracts';
import { futuresPrice, fx, rate } from './market';
import { vanillaPrice } from './pricing';
import { ffaIm } from './freight';
import type { CommodityId, FuturesPosition, GameState, MarketState, OptionPosition } from './types';
import { impliedVolAt } from './volsurface';

export const SPREAD_CHARGE = 0.3;
export const VOL_SCAN = 0.25;
export const SHORT_OPTION_MIN = 0.1; // fraction de la marge d'un future par option vendue

const SCAN_MOVES: [number, number, number][] = (() => {
  const out: [number, number, number][] = [];
  for (const p of [0, 1 / 3, -1 / 3, 2 / 3, -2 / 3, 1, -1]) for (const v of [1, -1]) out.push([p, v, 1]);
  out.push([2, 0, 0.35], [-2, 0, 0.35]);
  return out;
})();

export function imByCommodity(m: MarketState, positions: FuturesPosition[], options: OptionPosition[] = []): Record<CommodityId, number> {
  const out = {} as Record<CommodityId, number>;
  for (const c of COMMODITY_IDS) {
    const spec = COMMODITIES[c];
    const rateIm = m.commodities[c].imRate;
    const k = spec.valuePerUnit * fx(m, spec.currency);
    const futs = positions.filter((p) => p.commodity === c && p.lots !== 0);
    const opts = options.filter((o) => o.commodity === c && o.lots !== 0 && o.expiry >= m.day);
    if (!futs.length && !opts.length) {
      out[c] = 0;
      continue;
    }
    let L = 0, S = 0;
    const fut = futs.map((p) => {
      const F = futuresPrice(m, c, p.month);
      const q = p.lots * lotQty(spec, p.month);
      const e = Math.abs(q) * F * k * rateIm;
      if (p.lots > 0) L += e;
      else S += e;
      return { F, q };
    });
    const r = rate(m, spec.currency);
    const opt = opts.map((o) => {
      const F = futuresPrice(m, c, o.month);
      const T = Math.max(0, yearFrac(m.day, o.expiry));
      const sigma = impliedVolAt(m, c, o.month, o.expiry, o.strike, F);
      const q = o.lots * lotQty(spec, o.month);
      return { o, F, T, sigma, q, v0: vanillaPrice(F, o.strike, T, sigma, r, o.type, o.style) };
    });
    let worst = 0;
    for (const [pm, vm, w] of SCAN_MOVES) {
      let pnl = 0;
      for (const f of fut) pnl += f.q * f.F * pm * rateIm * k;
      for (const x of opt) {
        const F2 = x.F * (1 + pm * rateIm);
        const v2 = vanillaPrice(F2, x.o.strike, x.T, x.sigma * (1 + vm * VOL_SCAN), r, x.o.type, x.o.style);
        pnl += (v2 - x.v0) * x.q * k;
      }
      worst = Math.max(worst, -pnl * w);
    }
    const shortMin = opt.filter((x) => x.q < 0).reduce((s, x) => s + Math.abs(x.q) * x.F * k * rateIm * SHORT_OPTION_MIN, 0);
    // Valeur nette des options (NOV) : les options achetées sont un actif déjà payé (crédit), les options
    // vendues doivent pouvoir être rachetées (charge).
    const nov = opt.reduce((s, x) => s + x.v0 * x.q * k, 0);
    out[c] = Math.max(0, worst + SPREAD_CHARGE * Math.min(L, S) - nov, shortMin);
  }
  return out;
}

export function totalIm(m: MarketState, positions: FuturesPosition[], options: OptionPosition[] = []): number {
  const by = imByCommodity(m, positions, options);
  return COMMODITY_IDS.reduce((s, c) => s + by[c], 0);
}

export function recomputeIm(state: GameState) {
  state.company.im = totalIm(state.market, state.futures, state.options) + ffaIm(state);
}

/** Marge par lot de future (devise de cotation) pour affichage. */
export function imPerLot(m: MarketState, c: CommodityId, mi: number): number {
  const spec = COMMODITIES[c];
  return lotQty(spec, mi) * futuresPrice(m, c, mi) * spec.valuePerUnit * m.commodities[c].imRate;
}
