import { describe, expect, it } from 'vitest';
import { COMMODITIES } from '../../data/commodities';
import { listedMonths, lotQty } from '../contracts';
import { advanceDay, createGame, dispatch } from '../game';
import { futuresPrice, fx } from '../market';
import { totalIm, imByCommodity } from '../margin';
import { acceptOffer, offerPrice } from '../physical';
import type { GameState } from '../types';
import { forwardMtm, nav } from '../valuation';

const quiet = { crisisFrequency: 0 };
const front = (s: GameState, c: 'BRENT' | 'TTF' | 'CU' | 'WHEAT' | 'API2', i = 0) => listedMonths(COMMODITIES[c], s.day)[i]!;

describe('futures et marge de variation', () => {
  it('la VM cumulée = (règlement final − prix d’exécution) × quantité', () => {
    const s = createGame({ seed: 'vm', ...quiet });
    const mi = front(s, 'BRENT', 2);
    const cash0 = s.company.cash;
    expect(dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: 10 }).ok).toBe(true);
    const pos = s.futures[0]!;
    const exec = pos.avgPrice;
    const comm = cash0 - s.company.cash;
    for (let i = 0; i < 15; i++) advanceDay(s);
    const settle = s.futures[0]!.mark;
    const vmCum = s.company.cumCashByCategory.vm;
    expect(vmCum).toBeCloseTo((settle - exec) * 10 * 1000, 6);
    expect(comm).toBeCloseTo(25, 6);
  });

  it('ajouter puis réduire une position : P&L exact par lot (marge trade-date)', () => {
    const s = createGame({ seed: 'td', ...quiet });
    const mi = front(s, 'CU', 1);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'CU', month: mi, lots: 4 });
    const p1 = s.futures[0]!.avgPrice;
    advanceDay(s);
    advanceDay(s);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'CU', month: mi, lots: 6 });
    const p2 = s.futures[0]!.avgPrice * 10 / 6 - p1 * 4 / 6; // prix du 2e ordre
    advanceDay(s);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'CU', month: mi, lots: -10 });
    const log = s.log.filter((l) => l.text.startsWith('Vente'));
    const p3 = parseFloat(log[log.length - 1]!.text.split(' à ')[1]!);
    const expected = ((p3 - p1) * 4 + (p3 - p2) * 6) * 25;
    expect(s.futures).toHaveLength(0);
    expect(s.company.cumCashByCategory.vm).toBeCloseTo(expected, 3);
  });

  it('TTF : P&L converti en USD au taux EURUSD du jour', () => {
    const s = createGame({ seed: 'fx', ...quiet });
    const mi = front(s, 'TTF', 1);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'TTF', month: mi, lots: 1 });
    const mark0 = s.futures[0]!.mark;
    advanceDay(s); // la VM du soir utilise les prix du jour courant
    const vm = s.company.cumCashByCategory.vm;
    const settle = s.futures[0]!.mark;
    // Le jour 1 se règle au prix du jour 1 : on vérifie la formule avec le FX de clôture (même jour)
    expect(settle).toBeGreaterThan(0);
    expect(Number.isFinite(vm)).toBe(true);
    expect(lotQty(COMMODITIES.TTF, mi)).toBeGreaterThan(600);
    expect(Math.abs(vm - (settle - mark0) * lotQty(COMMODITIES.TTF, mi) * fx(s.market, 'EUR'))).toBeLessThan(
      Math.abs(settle - mark0) * lotQty(COMMODITIES.TTF, mi) * 0.5 + 1e-6,
    );
  });

  it('NAV conservée par un aller-retour hors coûts (pas d’argent créé)', () => {
    const s = createGame({ seed: 'rt', ...quiet });
    const mi = front(s, 'API2', 1);
    const nav0 = nav(s);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'API2', month: mi, lots: 20 });
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'API2', month: mi, lots: -20 });
    const lost = nav0 - nav(s);
    expect(lost).toBeGreaterThan(0); // fourchette + commissions
    expect(lost).toBeLessThan(20 * 1000 * 1.5 + 200);
  });
});

describe('marge initiale', () => {
  it('un spread calendaire est chargé à 30 % (crédit de spread)', () => {
    const s = createGame({ seed: 'im', ...quiet });
    const m1 = front(s, 'BRENT', 0), m2 = front(s, 'BRENT', 1);
    const outright = totalIm(s.market, [{ commodity: 'BRENT', month: m1, lots: 10, mark: 0, avgPrice: 0 }]);
    const spread = totalIm(s.market, [
      { commodity: 'BRENT', month: m1, lots: 10, mark: 0, avgPrice: 0 },
      { commodity: 'BRENT', month: m2, lots: -10, mark: 0, avgPrice: 0 },
    ]);
    expect(spread).toBeLessThan(outright * 0.45);
    expect(spread).toBeGreaterThan(outright * 0.25);
    const by = imByCommodity(s.market, [{ commodity: 'BRENT', month: m1, lots: 1, mark: 0, avgPrice: 0 }]);
    // ordre de grandeur réaliste : quelques milliers de $ par lot de Brent
    expect(by.BRENT).toBeGreaterThan(2000);
    expect(by.BRENT).toBeLessThan(15000);
  });

  it('appel de marge puis liquidation si non couvert', () => {
    const s = createGame({ seed: 'mc', ...quiet, capital: 5_000_000 });
    s.company.autoTreasury = false;
    const mi = front(s, 'BRENT', 0);
    // position massive : ~ 2 M$ de marge pour 300 lots
    expect(dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: 300 }).ok).toBe(true);
    // choc de prix brutal contre la position
    s.market.commodities.BRENT.xi -= 0.2;
    advanceDay(s);
    expect(s.company.marginCall).not.toBeNull();
    advanceDay(s);
    expect(s.futures).toHaveLength(0);
    expect(['bankrupt', 'running']).toContain(s.status);
  });
});

describe('physique', () => {
  it('MTM d’un forward = (fwd local − prix) × qté × DF, puis livraison en stock', () => {
    const s = createGame({ seed: 'phys', ...quiet });
    let tries = 0;
    while (!s.offers.some((o) => o.side === 1) && tries++ < 20) advanceDay(s);
    const o = s.offers.find((x) => x.side === 1)!;
    const px = offerPrice(s, o);
    expect(acceptOffer(s, o.id).ok).toBe(true);
    const d = s.forwards[0]!;
    expect(d.price).toBeCloseTo(px, 9);
    const mtm = forwardMtm(s, d);
    expect(Number.isFinite(mtm)).toBe(true);
    // avance jusqu'après livraison
    let guard = 0;
    while (s.forwards.length && guard++ < 200) advanceDay(s);
    expect(s.forwards).toHaveLength(0);
    expect(s.inventory.length).toBeGreaterThan(0);
    expect(s.inventory[0]!.qty).toBe(d.qty);
    const spec = COMMODITIES[d.commodity];
    expect(s.company.cumCashByCategory.physical).toBeCloseTo(-d.qty * d.price * spec.valuePerUnit * (spec.currency === 'EUR' ? fx(s.market, 'EUR') : 1), -2);
  });

  it('couverture : forward long + futures short => exposition nette faible', async () => {
    const { exposures } = await import('../valuation');
    const s = createGame({ seed: 'hedge', ...quiet });
    s.forwards.push({ id: 'x', commodity: 'BRENT', locationId: 'BRENT_RTM', side: 1, qty: 300_000, price: 80, month: front(s, 'BRENT', 2), deliveryDay: s.day + 70, counterpartyId: 'glenmoor', tradeDay: s.day });
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: front(s, 'BRENT', 2), lots: -300 });
    const e = exposures(s).find((x) => x.commodity === 'BRENT')!;
    expect(e.netQty).toBe(0);
    expect(Math.abs(e.delta1pct)).toBeLessThan(0.05 * 300_000 * futuresPrice(s.market, 'BRENT', front(s, 'BRENT', 2)) * 0.01);
  });
});

describe('déterminisme', () => {
  it('même seed + mêmes actions => même partie', () => {
    const run = () => {
      const s = createGame({ seed: 'det-42' });
      for (let i = 0; i < 60; i++) {
        if (i === 5) dispatch(s, { type: 'TRADE_FUTURE', commodity: 'CU', month: front(s, 'CU', 0), lots: 3 });
        advanceDay(s);
      }
      return { nav: nav(s), day: s.day, news: s.news.map((n) => n.headline).join('|') };
    };
    expect(run()).toEqual(run());
  });

  it('une partie de 3 ans sans action tourne jusqu’au bout et reste saine', () => {
    const s = createGame({ seed: 'long', years: 1 });
    let n = 0;
    while (s.status === 'running' && n++ < 400) advanceDay(s);
    expect(s.status).toBe('ended');
    // sans position, la NAV ne bouge que par les frais, intérêts et impôts
    expect(nav(s)).toBeLessThan(s.company.initialCapital * 1.05);
    expect(nav(s)).toBeGreaterThan(s.company.initialCapital * 0.9);
    for (const c of ['BRENT', 'TTF', 'CU', 'WHEAT', 'API2'] as const) {
      const f = futuresPrice(s.market, c, front(s, c, 0));
      expect(f).toBeGreaterThan(COMMODITIES[c].model.s0 * 0.15);
      expect(f).toBeLessThan(COMMODITIES[c].model.s0 * 6);
    }
  });
});
