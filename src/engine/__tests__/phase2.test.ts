import { describe, expect, it } from 'vitest';
import { COMMODITIES } from '../../data/commodities';
import { listedMonths, lotQty, optionMonths, optionExpiry, fixingDays } from '../contracts';
import { advanceDay, createGame, dispatch, migrateState, SAVE_VERSION } from '../game';
import { futuresPrice, fx } from '../market';
import { totalIm } from '../margin';
import { avgInputs, expectedAverage, otcValueUsd, apoUnitPrice, optionUnitPrice } from '../derivatives';
import { computeVar, bookGreeks, runStress } from '../risk';
import { previewSpread, previewFuture } from '../trading';
import { dayFromYMD, monthIndexOf, ymd } from '../calendar';
import type { CommodityId, GameState } from '../types';
import { exposures, nav } from '../valuation';
import { impliedVolAt, atmVol } from '../volsurface';

const quiet = { crisisFrequency: 0 };
const front = (s: GameState, c: CommodityId, i = 0) => listedMonths(COMMODITIES[c], s.day)[i]!;
const optMonth = (s: GameState, c: CommodityId, i = 0) => optionMonths(COMMODITIES[c], s.day)[i]!;
const atm = (s: GameState, c: CommodityId, mi: number) => {
  const step = COMMODITIES[c].options.strikeStep;
  return Math.round(futuresPrice(s.market, c, mi) / step) * step;
};

describe('expiration des options', () => {
  it('règles calquées sur les bourses', () => {
    const mi = 2027 * 12 + 2; // mars 2027
    expect(ymd(optionExpiry(COMMODITIES.BRENT, mi))).toEqual({ y: 2027, m: 1, d: 26 }); // LTD 29 janv − 3 j.o.
    expect(ymd(optionExpiry(COMMODITIES.TTF, mi))).toEqual({ y: 2027, m: 2, d: 24 }); // 1er mars − 5 j
    expect(ymd(optionExpiry(COMMODITIES.CU, mi))).toEqual({ y: 2027, m: 3, d: 3 }); // 1er mercredi
    expect(ymd(optionExpiry(COMMODITIES.WHEAT, mi))).toEqual({ y: 2027, m: 2, d: 19 }); // vendredi ≤ 24 fév.
  });
});

describe('surface de vol', () => {
  it('structure par terme décroissante (Samuelson) et skew de signe attendu', () => {
    const s = createGame({ seed: 'vol', ...quiet });
    const m0 = optMonth(s, 'BRENT', 0), m6 = optMonth(s, 'BRENT', 6);
    expect(atmVol(s.market, 'BRENT', m0, optionExpiry(COMMODITIES.BRENT, m0))).toBeGreaterThan(atmVol(s.market, 'BRENT', m6, optionExpiry(COMMODITIES.BRENT, m6)));
    const F = futuresPrice(s.market, 'BRENT', m0);
    const ex = optionExpiry(COMMODITIES.BRENT, m0);
    expect(impliedVolAt(s.market, 'BRENT', m0, ex, F * 0.8)).toBeGreaterThan(impliedVolAt(s.market, 'BRENT', m0, ex, F * 1.2)); // put skew
    const mt = optMonth(s, 'TTF', 0);
    const Ft = futuresPrice(s.market, 'TTF', mt);
    const ext = optionExpiry(COMMODITIES.TTF, mt);
    expect(impliedVolAt(s.market, 'TTF', mt, ext, Ft * 1.3)).toBeGreaterThan(impliedVolAt(s.market, 'TTF', mt, ext, Ft * 0.77)); // call skew
  });
});

describe('options listées', () => {
  it('achat : la prime sort du cash, la NAV ne perd que fourchette et commission', () => {
    const s = createGame({ seed: 'opt1', ...quiet });
    const mi = optMonth(s, 'BRENT', 1);
    const K = atm(s, 'BRENT', mi);
    const nav0 = nav(s), cash0 = s.company.cash;
    expect(dispatch(s, { type: 'TRADE_OPTION', commodity: 'BRENT', month: mi, optType: 'C', strike: K, lots: 10 }).ok).toBe(true);
    const o = s.options[0]!;
    expect(cash0 - s.company.cash).toBeCloseTo(o.avgPremium * 10 * 1000 + 25, 4);
    const lost = nav0 - nav(s);
    expect(lost).toBeGreaterThan(0);
    expect(lost).toBeLessThan(0.15 * o.avgPremium * 10000);
  });

  it('exercice automatique dans la monnaie : future reçu au strike, P&L = intrinsèque', () => {
    const s = createGame({ seed: 'opt2', ...quiet });
    const mi = optMonth(s, 'CU', 0);
    const K = atm(s, 'CU', mi) - 500; // call dans la monnaie
    dispatch(s, { type: 'TRADE_OPTION', commodity: 'CU', month: mi, optType: 'C', strike: K, lots: 4 });
    const exp = s.options[0]!.expiry;
    while (s.day < exp) advanceDay(s);
    advanceDay(s); // clôture du jour d'expiration
    expect(s.options).toHaveLength(0);
    const fut = s.futures.find((p) => p.commodity === 'CU' && p.month === mi);
    expect(fut?.lots).toBe(4);
    expect(fut!.avgPrice).toBe(K);
  });

  it('vente d’option : marge SPAN > 0 ; un put protège un long future et réduit la marge', () => {
    const s = createGame({ seed: 'span', ...quiet });
    const mi = optMonth(s, 'BRENT', 1);
    const K = atm(s, 'BRENT', mi);
    const opt = (lots: number, type: 'C' | 'P') => ({ id: 'z', commodity: 'BRENT' as const, month: mi, type, strike: K, expiry: optionExpiry(COMMODITIES.BRENT, mi), style: 'A' as const, lots, avgPremium: 0 });
    const fut = [{ commodity: 'BRENT' as const, month: mi, lots: 10, mark: 0, avgPrice: 0 }];
    expect(totalIm(s.market, [], [opt(-10, 'C')])).toBeGreaterThan(0);
    expect(totalIm(s.market, [], [opt(10, 'C')])).toBe(0);
    expect(totalIm(s.market, fut, [opt(10, 'P')])).toBeLessThan(totalIm(s.market, fut, []) * 0.8);
  });

  it('exercice anticipé d’une américaine dans la monnaie', () => {
    const s = createGame({ seed: 'early', ...quiet });
    const mi = optMonth(s, 'WHEAT', 1);
    const K = atm(s, 'WHEAT', mi) + 80;
    dispatch(s, { type: 'TRADE_OPTION', commodity: 'WHEAT', month: mi, optType: 'P', strike: K, lots: 3 });
    const r = dispatch(s, { type: 'EXERCISE_OPTION', id: s.options[0]!.id });
    expect(r.ok).toBe(true);
    expect(s.futures[0]!.lots).toBe(-3);
  });
});

describe('OTC : swaps et APO', () => {
  it('parité APO : call − put = swap (même strike), et règlement du swap sur la moyenne', () => {
    const s = createGame({ seed: 'otc', ...quiet });
    const mi = monthIndexOf(s.day) + 1;
    const a = avgInputs(s, 'API2', mi);
    const K = Math.round(expectedAverage(a));
    const c = apoUnitPrice(s, 'API2', mi, K, 'C'), p = apoUnitPrice(s, 'API2', mi, K, 'P');
    const swap = otcValueUsd(s, { id: 'q', kind: 'swap', commodity: 'API2', month: mi, qty: 1, strike: K, bankId: 'bln', tradeDay: s.day, avgPremium: 0 });
    expect(c - p).toBeCloseTo(swap, 6);
    expect(dispatch(s, { type: 'TRADE_OTC', kind: 'swap', commodity: 'API2', month: mi, qty: 50_000 }).ok).toBe(true);
    const sw = s.otc[0]!;
    const last = fixingDays(mi).at(-1)!;
    while (s.day <= last) advanceDay(s);
    expect(s.otc).toHaveLength(0);
    const fixes = s.fixings.API2.filter((f) => fixingDays(mi).includes(f.day));
    expect(fixes).toHaveLength(fixingDays(mi).length);
    const avg = fixes.reduce((t, f) => t + f.px, 0) / fixes.length;
    expect(s.company.cumCashByCategory.otc).toBeCloseTo((avg - sw.strike) * 50_000, 2);
  });
});

describe('risque', () => {
  it('VaR : nulle sans position, ~linéaire en taille, une couverture la réduit fortement', () => {
    const s = createGame({ seed: 'var', ...quiet });
    expect(computeVar(s).var99).toBe(0);
    const mi = front(s, 'BRENT', 2);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: 10 });
    const v10 = computeVar(s).var99;
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: 10 });
    const v20 = computeVar(s).var99;
    expect(v20 / v10).toBeGreaterThan(1.9);
    expect(v20 / v10).toBeLessThan(2.1);
    // ordre de grandeur : 20 kbbl × ~78 $ × vol journalière × 2,33
    expect(v20).toBeGreaterThan(20_000 * 70 * 0.01);
    expect(v20).toBeLessThan(20_000 * 90 * 0.06);
    // spread calendaire : beaucoup moins risqué qu'une position sèche
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: front(s, 'BRENT', 3), lots: -20 });
    expect(computeVar(s).var99).toBeLessThan(v20 * 0.3);
  });

  it('greeks du livre : delta d’un future = qté × F × 1 %, vega nulle ; stress cohérent', () => {
    const s = createGame({ seed: 'gk', ...quiet });
    const mi = front(s, 'CU', 1);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'CU', month: mi, lots: 8 });
    const g = bookGreeks(s).find((x) => x.commodity === 'CU')!;
    expect(g.delta1pct).toBeCloseTo(8 * 25 * futuresPrice(s.market, 'CU', mi) * 0.01, 0);
    expect(Math.abs(g.vega)).toBeLessThan(1e-6);
    const st = runStress(s).find((x) => x.s.id === 'chinaslow')!;
    expect(st.pnl).toBeLessThan(0);
  });

  it('couverture delta : neutralise une option', () => {
    const s = createGame({ seed: 'hd', ...quiet });
    const mi = optMonth(s, 'BRENT', 1);
    dispatch(s, { type: 'TRADE_OPTION', commodity: 'BRENT', month: mi, optType: 'C', strike: atm(s, 'BRENT', mi), lots: 100 });
    const before = exposures(s).find((e) => e.commodity === 'BRENT')!.delta1pct;
    expect(dispatch(s, { type: 'HEDGE_DELTA', commodity: 'BRENT', month: mi }).ok).toBe(true);
    const after = exposures(s).find((e) => e.commodity === 'BRENT')!.delta1pct;
    expect(Math.abs(after)).toBeLessThan(Math.abs(before) * 0.05);
  });

  it('discipline stricte : un ordre qui dépasse la limite de VaR est annulé', () => {
    const s = createGame({ seed: 'strict', ...quiet });
    dispatch(s, { type: 'SET_LIMITS', limits: { strict: true, varPctNav: 0.005 } });
    const cash = s.company.cash;
    const r = dispatch(s, { type: 'TRADE_FUTURE', commodity: 'TTF', month: front(s, 'TTF', 0), lots: 200 });
    expect(r.ok).toBe(false);
    expect(s.futures).toHaveLength(0);
    expect(s.company.cash).toBe(cash);
  });

  it('covenant : la banque gèle la RCF après 3 jours de VaR au-dessus de 8 % des fonds propres', () => {
    const s = createGame({ seed: 'cov', ...quiet, capital: 10_000_000 });
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'TTF', month: front(s, 'TTF', 0), lots: 120 });
    for (let i = 0; i < 4 && s.status === 'running'; i++) advanceDay(s);
    if (s.risk.var99 > 0.08 * nav(s)) {
      expect(s.risk.covenantBreachDays).toBeGreaterThanOrEqual(3);
      expect(s.risk.rcfFrozen).toBe(true);
    }
  });

  it('limite de position de la bourse', () => {
    const s = createGame({ seed: 'pl', ...quiet, capital: 1_000_000_000 });
    const r = dispatch(s, { type: 'TRADE_FUTURE', commodity: 'API2', month: front(s, 'API2', 0), lots: 800 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/limite de position/i);
  });
});

describe('liquidité', () => {
  it('impact permanent : un gros ordre déplace le prix, qui se reconstitue la nuit', () => {
    const s = createGame({ seed: 'imp', ...quiet, capital: 500_000_000 });
    const mi = front(s, 'BRENT', 12);
    const p0 = futuresPrice(s.market, 'BRENT', mi);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: 400 });
    const key = `BRENT:${mi}`;
    expect(s.market.impact[key]!).toBeGreaterThan(0);
    expect(futuresPrice(s.market, 'BRENT', mi)).toBeGreaterThan(p0);
    const i0 = s.market.impact[key]!;
    advanceDay(s);
    expect(s.market.impact[key] ?? 0).toBeLessThan(i0 * 0.5);
  });
  it('un spread calendaire coûte moins cher que deux jambes séparées', () => {
    const s = createGame({ seed: 'spr', ...quiet });
    const a = front(s, 'BRENT', 1), b = front(s, 'BRENT', 4);
    const legs = previewFuture(s, 'BRENT', a, 50).slippageUsd + previewFuture(s, 'BRENT', b, -50).slippageUsd;
    const sp = previewSpread(s, 'BRENT', a, b, 50);
    expect(sp.cost - 2 * 50 * 2.5).toBeLessThan(legs);
  });
});

describe('P&L expliqué, conseillers, migration', () => {
  it('somme exacte ; pour un future détenu, l’effet prix ≈ la marge de variation', () => {
    const s = createGame({ seed: 'expl', ...quiet });
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'CU', month: front(s, 'CU', 1), lots: 10 });
    advanceDay(s);
    const vm0 = s.company.cumCashByCategory.vm;
    advanceDay(s);
    const e = s.explain.at(-1)!;
    expect(e.price + e.basis + e.fx + e.vol + e.time + e.other).toBeCloseTo(e.total, 6);
    expect(e.price).toBeCloseTo(s.company.cumCashByCategory.vm - vm0, 2);
  });

  it('les paris du trader sont évalués (palmarès) et la partie reste déterministe', () => {
    const run = () => {
      const s = createGame({ seed: 'adv' });
      for (let i = 0; i < 120 && s.status === 'running'; i++) advanceDay(s);
      return s;
    };
    const a = run(), b = run();
    expect(a.advice.map((x) => x.text)).toEqual(b.advice.map((x) => x.text));
    expect(a.track.trader.right + a.track.trader.wrong).toBeGreaterThan(0);
    expect(a.advice.some((x) => x.advisor === 'analyst')).toBe(true);
  });

  it('migration d’une sauvegarde v1', () => {
    const s = createGame({ seed: 'mig' }) as unknown as Record<string, unknown>;
    for (const k of ['options', 'otc', 'fixings', 'risk', 'explain', 'explainBase', 'advice', 'adviceCooldown', 'track']) delete s[k];
    s.version = 1;
    const m = migrateState(s as unknown as GameState);
    expect(m.version).toBe(SAVE_VERSION);
    advanceDay(m);
    expect(m.status).toBe('running');
  });

  it('valeur d’option cohérente avec la parité (américaine ≥ européenne)', () => {
    const s = createGame({ seed: 'par', ...quiet });
    const mi = optMonth(s, 'BRENT', 2);
    const K = atm(s, 'BRENT', mi);
    const o = { commodity: 'BRENT' as const, month: mi, type: 'P' as const, strike: K, expiry: optionExpiry(COMMODITIES.BRENT, mi) };
    expect(optionUnitPrice(s.market, { ...o, style: 'A' })).toBeGreaterThanOrEqual(optionUnitPrice(s.market, { ...o, style: 'E' }));
    expect(fx(s.market, 'USD')).toBe(1);
    expect(lotQty(COMMODITIES.BRENT, mi)).toBe(1000);
    expect(dayFromYMD(2027, 1, 1)).toBeLessThan(s.day);
  });
});
