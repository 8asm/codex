import { describe, expect, it } from 'vitest';
import { COMMODITIES } from '../../data/commodities';
import { FREIGHT } from '../../data/freight';
import { businessDaysBetween, monthIndexOf } from '../calendar';
import { lastTradingDay, listedMonths } from '../contracts';
import { advanceDay, createGame, dispatch, migrateState, SAVE_VERSION } from '../game';
import { ffaFair, freightForward, freightRate, stepFreight } from '../freight';
import { seaRoute, shipQuote } from '../logistics';
import { assetNpv, ownedCapacity, opportunityValue } from '../assets';
import { handleDefault } from '../credit';
import { applyImpact } from '../world';
import { normal, seedRng } from '../rng';
import type { GameState } from '../types';
import { forwardMtm, nav } from '../valuation';

const quiet = { crisisFrequency: 0 };
const front = (s: GameState, c: 'BRENT' | 'CU' | 'TTF' | 'WHEAT' | 'API2', i = 0) => listedMonths(COMMODITIES[c], s.day)[i]!;
const addLot = (s: GameState, c: 'BRENT' | 'CU' | 'WHEAT' | 'API2' | 'TTF', loc: string, qty: number) => {
  const l = { id: `L${s.nextId++}`, commodity: c, locationId: loc, qty, cost: 1, sinceDay: s.day };
  s.inventory.push(l);
  return l;
};

describe('fret', () => {
  it('modèle de Schwartz 1 facteur : F(t,t) = spot et martingale des forwards', () => {
    const s = createGame({ seed: 'fr', ...quiet });
    const m = s.market;
    expect(freightForward(m, 'CAPE', m.day)).toBeCloseTo(freightRate(m, 'CAPE'), 6);
    const T = m.day + 120;
    const f0 = freightForward(m, 'CAPE', T);
    const rng = seedRng('ffa-mc');
    let sum = 0;
    const N = 60_000;
    for (let i = 0; i < N; i++) {
      const mm = { ...m, freight: { ...m.freight }, day: m.day };
      stepFreight(mm, rng, 30 / 365);
      mm.day = m.day + 30;
      sum += freightForward(mm, 'CAPE', T);
    }
    void normal;
    expect(Math.abs(sum / N - f0) / f0).toBeLessThan(0.01);
  });

  it('routes réelles et détour quand le canal de Suez est fermé', () => {
    const open = seaRoute('FUJ', 'RTM')!;
    expect(open.path).toContain('SUEZN');
    const closed = seaRoute('FUJ', 'RTM', new Set(['suez']))!;
    expect(closed.path).toContain('CAPE');
    expect(closed.nm).toBeGreaterThan(open.nm * 1.5);
    expect(seaRoute('USGC', 'RTM')!.nm).toBeGreaterThan(4500);
  });

  it('calibration : sur les grandes routes, l’écart moyen de différentiel ≈ coût du fret (±20 %)', () => {
    const s = createGame({ seed: 'cal', ...quiet });
    for (const i of Object.keys(s.market.freight) as (keyof typeof FREIGHT)[]) s.market.freight[i] = Math.log(FREIGHT[i].mean);
    for (const c of Object.keys(s.market.commodities) as 'BRENT'[]) for (const l of Object.keys(s.market.commodities[c].basisDev)) s.market.commodities[c].basisDev[l] = 0;
    const routes: ['BRENT' | 'WHEAT' | 'API2' | 'CU', string, string, number][] = [
      ['BRENT', 'BRENT_USGC', 'BRENT_RTM', 600000], ['BRENT', 'BRENT_FUJ', 'BRENT_SIN', 600000],
      ['WHEAT', 'WHT_GULF', 'WHT_RTM', 2204600], ['API2', 'COAL_RB', 'COAL_CN', 75000], ['CU', 'CU_SCL', 'CU_SHA', 2000],
    ];
    for (const [c, a, b, q] of routes) {
      const ls = COMMODITIES[c].physical.locations;
      const spread = ls.find((l) => l.id === b)!.basisMean - ls.find((l) => l.id === a)!.basisMean;
      const fr = shipQuote(s, c, a, b, q).perUnit;
      expect(Math.abs(spread / fr - 1)).toBeLessThan(0.2);
    }
  });

  it('expédition : fret payé, cargaison en mer valorisée à destination, arrivée avec pertes en transit', () => {
    const s = createGame({ seed: 'ship', ...quiet });
    const lot = addLot(s, 'BRENT', 'BRENT_USGC', 600_000);
    const q = shipQuote(s, 'BRENT', 'BRENT_USGC', 'BRENT_RTM', 600_000);
    const cash0 = s.company.cash;
    expect(dispatch(s, { type: 'SHIP_CARGO', lotId: lot.id, to: 'BRENT_RTM' }).ok).toBe(true);
    expect(cash0 - s.company.cash).toBeCloseTo(q.totalUsd - q.financingUsd, 4);
    expect(s.voyages).toHaveLength(1);
    let guard = 0;
    while (s.voyages.length && guard++ < 60) advanceDay(s);
    const arrived = s.inventory.find((l) => l.locationId === 'BRENT_RTM')!;
    expect(arrived.qty).toBeCloseTo(600_000 * (1 - COMMODITIES.BRENT.logistics.transitLoss), 3);
  });

  it('un canal fermé retarde les navires qui doivent le franchir', () => {
    const s = createGame({ seed: 'delay', ...quiet });
    const lot = addLot(s, 'BRENT', 'BRENT_FUJ', 600_000);
    dispatch(s, { type: 'SHIP_CARGO', lotId: lot.id, to: 'BRENT_RTM' });
    const eta = s.voyages[0]!.arriveDay;
    applyImpact(s, { k: 'effect', effect: { label: 'test', icon: 'x', lat: 0, lon: 0, untilDay: s.day + 20, layer: 'logistique', closes: ['suez'] } });
    for (let i = 0; i < 5; i++) advanceDay(s);
    expect(s.voyages[0]!.arriveDay).toBeGreaterThan(eta);
  });

  it('FFA : marge de variation quotidienne, règlement total = jours × (moyenne − prix)', () => {
    const s = createGame({ seed: 'ffa', ...quiet });
    const mi = monthIndexOf(s.day) + 1;
    expect(dispatch(s, { type: 'TRADE_FFA', index: 'CAPE', month: mi, days: 30 }).ok).toBe(true);
    const p = s.ffa[0]!;
    while (s.ffa.length) advanceDay(s);
    const fixes = s.freightFixings.CAPE.filter((f) => monthIndexOf(f.day) === mi);
    const avg = fixes.reduce((a, f) => a + f.px, 0) / fixes.length;
    expect(s.company.cumCashByCategory.freight).toBeCloseTo(30 * (avg - p.price), 0);
    expect(ffaFair(s, 'CAPE', mi)).toBeCloseTo(avg, 6);
  });
});

describe('livraison bourse, tolérance, stockage', () => {
  it('un long cuivre gardé jusqu’à l’échéance est livré en entrepôt ; un court TTF sans stock est racheté', () => {
    const s = createGame({ seed: 'dlv', ...quiet });
    const mi = front(s, 'CU', 0);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'CU', month: mi, lots: 4 });
    const mt = front(s, 'TTF', 0);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'TTF', month: mt, lots: -1 });
    const end = Math.max(lastTradingDay(COMMODITIES.CU, mi), lastTradingDay(COMMODITIES.TTF, mt));
    while (s.day <= end) advanceDay(s);
    const cu = s.inventory.find((l) => l.commodity === 'CU' && l.locationId === 'CU_RTM');
    expect(cu?.qty).toBeCloseTo(100, 6);
    expect(s.log.some((l) => /rachat d'urgence/.test(l.text))).toBe(true);
  });

  it('clause de tolérance : coût pour l’acheteur, et quantité livrée au choix du vendeur', () => {
    const s = createGame({ seed: 'tol', ...quiet });
    const mi = front(s, 'BRENT', 1);
    const d = { id: 'tt', commodity: 'BRENT' as const, locationId: 'BRENT_RTM', side: 1 as const, qty: 600_000, price: 80, month: mi, deliveryDay: s.day + 40, counterpartyId: 'vitaro', tradeDay: s.day };
    s.forwards.push(d);
    const plain = forwardMtm(s, d);
    s.forwards[0] = { ...d, tolerance: 0.1 };
    expect(forwardMtm(s, s.forwards[0]!)).toBeLessThan(plain);
    while (s.forwards.length) advanceDay(s);
    const got = s.inventory.find((l) => l.locationId === 'BRENT_RTM')!.qty;
    expect([540_000, 660_000].some((x) => Math.abs(x - got) < 1)).toBe(true);
  });

  it('capacité de stockage détenue : le stock couvert ne paie plus le stockage tiers', () => {
    const s = createGame({ seed: 'sto', ...quiet, capital: 200e6 });
    addLot(s, 'BRENT', 'BRENT_RTM', 1_000_000);
    s.opportunities.push({ id: 'tk', defId: 'tank_rtm', kind: 'acquisition', share: 1, price: 50e6, expiresDay: s.day + 10 });
    expect(dispatch(s, { type: 'BUY_OPPORTUNITY', id: 'tk' }).ok).toBe(true);
    expect(ownedCapacity(s, 'BRENT_RTM')).toBe(3_000_000);
    const st0 = s.company.cumCashByCategory.storage;
    for (let i = 0; i < 5; i++) advanceDay(s);
    expect(s.company.cumCashByCategory.storage).toBeCloseTo(st0, 6);
  });
});

describe('actifs industriels', () => {
  it('DCF cohérent et achat neutre pour la NAV (cash → valeur comptable)', () => {
    const s = createGame({ seed: 'npv', ...quiet, capital: 500e6 });
    const v = assetNpv(s, 'oil_permian');
    expect(v).toBeGreaterThan(0.3 * 260e6);
    expect(v).toBeLessThan(4 * 260e6);
    s.opportunities.push({ id: 'op', defId: 'oil_permian', kind: 'acquisition', share: 1, price: 0.9 * v, expiresDay: s.day + 10 });
    const n0 = nav(s);
    expect(dispatch(s, { type: 'BUY_OPPORTUNITY', id: 'op' }).ok).toBe(true);
    expect(nav(s)).toBeCloseTo(n0, 0);
    const a = s.assets[0]!;
    const sold0 = s.company.cumCashByCategory.physical;
    for (let i = 0; i < 25; i++) advanceDay(s);
    expect(a.produced).toBeGreaterThan(0);
    expect(s.company.cumCashByCategory.physical).toBeGreaterThan(sold0); // production vendue automatiquement
    expect(a.bookValue).toBeLessThan(0.9 * v);
  });

  it('nationalisation dans un pays très instable', () => {
    const s = createGame({ seed: 'nat', ...quiet, capital: 2e9, years: 8 });
    s.opportunities.push({ id: 'k', defId: 'mine_kass', kind: 'acquisition', share: 1, price: 300e6, expiresDay: s.day + 10 });
    dispatch(s, { type: 'BUY_OPPORTUNITY', id: 'k' });
    let n = 0;
    while (s.assets.length && n++ < 2000) {
      s.world.zones.KASS!.stability = 5;
      advanceDay(s);
      if (s.status !== 'running') break;
    }
    expect(s.assets).toHaveLength(0);
    expect(s.news.some((x) => /nationalisé/.test(x.headline))).toBe(true);
  });

  it('construction (greenfield) puis mise en service', () => {
    const s = createGame({ seed: 'gf', ...quiet, capital: 300e6 });
    s.opportunities.push({ id: 'g', defId: 'wh_rtm', kind: 'greenfield', share: 1, price: 30e6, expiresDay: s.day + 10 });
    dispatch(s, { type: 'BUY_OPPORTUNITY', id: 'g' });
    const a = s.assets[0]!;
    expect(a.status).toBe('building');
    let n = 0;
    while (a.status === 'building' && n++ < 400) advanceDay(s);
    expect(a.status).not.toBe('building');
  });

  it('manager prudent : maintenance automatique et couverture de la production par swaps', () => {
    const s = createGame({ seed: 'mgr', ...quiet, capital: 800e6 });
    s.opportunities.push({ id: 'm', defId: 'coal_mpuma', kind: 'acquisition', share: 1, price: 200e6, expiresDay: s.day + 10 });
    dispatch(s, { type: 'BUY_OPPORTUNITY', id: 'm' });
    const a = s.assets[0]!;
    const mg = [...s.managers].sort((x, y) => y.skill - x.skill)[0]!;
    dispatch(s, { type: 'HIRE_MANAGER', id: mg.id, assetId: a.id });
    dispatch(s, { type: 'SET_ASSET', id: a.id, policy: 'prudent' });
    a.condition = 60;
    advanceDay(s);
    expect(['maintenance', 'operating', 'damaged', 'strike']).toContain(a.status);
    let n = 0;
    while (!s.otc.length && n++ < 30) advanceDay(s);
    expect(s.otc.some((x) => x.commodity === 'API2' && x.qty < 0)).toBe(true);
  });

  it('offtake prépayé : défaut du producteur, le prépaiement restant est une créance (récupération partielle)', () => {
    const s = createGame({ seed: 'off', ...quiet, capital: 300e6 });
    const o = { id: 'of', defId: 'coal_mpuma', kind: 'offtake' as const, share: 0, price: 20e6, expiresDay: s.day + 10, counterpartyId: 'rbcoal', months: 12, qtyPerMonth: 50_000, discount: 3 };
    expect(opportunityValue(s, o)).toBeGreaterThan(0);
    s.opportunities.push(o);
    dispatch(s, { type: 'BUY_OPPORTUNITY', id: 'of' });
    const n0 = nav(s);
    handleDefault(s, 'rbcoal');
    expect(s.streams).toHaveLength(0);
    expect(n0 - nav(s)).toBeCloseTo(20e6 * 0.65, -3);
  });
});

describe('automatisation', () => {
  it('roll automatique avant le dernier jour de cotation', () => {
    const s = createGame({ seed: 'roll', ...quiet });
    dispatch(s, { type: 'SET_AUTOMATION', patch: { autoRoll: true } });
    const mi = front(s, 'BRENT', 0);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: 5 });
    while (businessDaysBetween(s.day, lastTradingDay(COMMODITIES.BRENT, mi)) > 0) advanceDay(s);
    expect(s.futures.find((p) => p.month === mi)).toBeUndefined();
    expect(s.futures.find((p) => p.month > mi)?.lots).toBe(5);
  });

  it('couverture automatique du physique au ratio cible', () => {
    const s = createGame({ seed: 'ah', ...quiet });
    addLot(s, 'API2', 'COAL_ARA', 75_000);
    dispatch(s, { type: 'SET_AUTOMATION', patch: { autoHedge: { on: true, ratio: 1, threshold: 0.1 } } });
    advanceDay(s);
    const fut = s.futures.filter((p) => p.commodity === 'API2').reduce((a, p) => a + p.lots, 0);
    expect(fut).toBe(-75);
  });

  it('logistique automatique : la cargaison part à temps pour honorer une vente CIF', () => {
    const s = createGame({ seed: 'al', ...quiet });
    dispatch(s, { type: 'SET_AUTOMATION', patch: { autoLogistics: true } });
    addLot(s, 'API2', 'COAL_RB', 75_000);
    const q = shipQuote(s, 'API2', 'COAL_RB', 'COAL_ARA', 75_000);
    s.forwards.push({ id: 'sell', commodity: 'API2', locationId: 'COAL_ARA', side: -1, qty: 75_000, price: 120, month: front(s, 'API2', 2), deliveryDay: s.day + q.days + 10, counterpartyId: 'rhineutil', tradeDay: s.day });
    let n = 0;
    while (!s.voyages.length && n++ < 20) advanceDay(s);
    expect(s.voyages[0]?.to).toBe('COAL_ARA');
  });
});

describe('déterminisme et migration', () => {
  it('partie complète déterministe avec actifs, voyages et FFA', () => {
    const run = () => {
      const s = createGame({ seed: 'p4', years: 1, capital: 300e6 });
      for (let i = 0; i < 160 && s.status === 'running'; i++) {
        if (i === 3 && s.opportunities[0]) dispatch(s, { type: 'BUY_OPPORTUNITY', id: s.opportunities[0].id });
        if (i === 5) dispatch(s, { type: 'TRADE_FFA', index: 'PMX', month: monthIndexOf(s.day) + 1, days: 20 });
        advanceDay(s);
      }
      return { nav: nav(s), n: s.news.length, a: s.assets.length };
    };
    expect(run()).toEqual(run());
  });

  it('migration v3 → v4', () => {
    const s = createGame({ seed: 'm4' }) as unknown as Record<string, unknown>;
    for (const k of ['voyages', 'ffa', 'freightFixings', 'assets', 'managers', 'opportunities', 'streams', 'automation']) delete s[k];
    delete (s.market as Record<string, unknown>).freight;
    s.version = 3;
    const g = migrateState(s as unknown as GameState);
    expect(g.version).toBe(SAVE_VERSION);
    advanceDay(g);
    expect(g.status).toBe('running');
  });
});
