import { describe, expect, it } from 'vitest';
import { COMMODITIES } from '../../data/commodities';
import { listedMonths } from '../contracts';
import { advanceDay, createGame, dispatch, effectiveTaxRate, migrateState, SAVE_VERSION } from '../game';
import { _templateForTests, fire } from '../events';
import { applyImpact, sanctionFor, stepWorld } from '../world';
import { companyDefault, leaderboard, stepCompanies } from '../companies';
import { handleDefault, stepCredit, RECOVERY, INSURANCE_COVER } from '../credit';
import { offerBlock } from '../physical';
import { futuresPrice, isHalted, discount, rate } from '../market';
import { otcValueUsd } from '../derivatives';
import { forwardMtm, nav } from '../valuation';
import type { GameState } from '../types';
import { monthIndexOf } from '../calendar';

const quiet = { crisisFrequency: 0 };
const front = (s: GameState, c: 'BRENT' | 'CU' | 'TTF' | 'API2', i = 0) => listedMonths(COMMODITIES[c], s.day)[i]!;
const fwd = (s: GameState, cp: string, side: 1 | -1, price: number) => {
  const d = { id: `t${s.nextId++}`, commodity: 'BRENT' as const, locationId: 'BRENT_RTM', side, qty: 300_000, price, month: front(s, 'BRENT', 2), deliveryDay: s.day + 80, counterpartyId: cp, tradeDay: s.day };
  s.forwards.push(d);
  return d;
};

describe('événements : rumeurs, démentis, impacts différés', () => {
  it('une rumeur démentie annule exactement le mouvement intégré', () => {
    const s = createGame({ seed: 'rum', ...quiet });
    const chi0 = s.market.commodities.CU.chi;
    fire(s, {
      news: { headline: 'test', tone: 'up', major: false, category: 'marché' },
      impacts: [{ k: 'chi', c: 'CU', v: 0.1 }],
      rumor: { pReal: 0, frac: 0.4, resolveIn: 2, confirm: { headline: 'c', tone: 'up', major: false }, deny: { headline: 'd', tone: 'down', major: false } },
    });
    expect(s.market.commodities.CU.chi - chi0).toBeCloseTo(0.04, 12);
    expect(s.news[0]!.stage).toBe('rumor');
    // on fige le marché pour isoler l'effet : on avance le monde seulement
    s.day += 3;
    stepWorld(s);
    expect(s.market.commodities.CU.chi - chi0).toBeCloseTo(0, 2);
    expect(s.news.some((n) => n.stage === 'denied')).toBe(true);
  });

  it('effet temporaire : décalage de différentiel retiré à la fin de l’événement', () => {
    const s = createGame({ seed: 'canal', ...quiet });
    const f = _templateForTests('canal').build(s)!;
    fire(s, f);
    expect(s.market.basisShift.CU_RTM).toBeCloseTo(45, 9);
    expect(s.world.effects).toHaveLength(1);
    for (let i = 0; i < 15; i++) advanceDay(s);
    expect(s.market.basisShift.CU_RTM ?? 0).toBeCloseTo(0, 9);
  });

  it('suspension de cotation : ordres refusés, prix figés, choc accumulé à la réouverture', () => {
    const s = createGame({ seed: 'halt', ...quiet });
    applyImpact(s, { k: 'halt', c: 'CU', days: 3 });
    const mi = front(s, 'CU', 0);
    expect(isHalted(s.market, 'CU')).toBe(true);
    expect(dispatch(s, { type: 'TRADE_FUTURE', commodity: 'CU', month: mi, lots: 1 }).ok).toBe(false);
    const chi0 = s.market.commodities.CU.chi;
    advanceDay(s);
    advanceDay(s);
    expect(s.market.commodities.CU.chi).toBe(chi0 + 0 * 1); // figé (hors événements, crises désactivées)
    for (let i = 0; i < 3; i++) advanceDay(s);
    expect(isHalted(s.market, 'CU')).toBe(false);
    expect(s.market.commodities.CU.chi).not.toBe(chi0);
  });

  it('banque centrale : un relèvement de taux change l’actualisation', () => {
    const s = createGame({ seed: 'cb', ...quiet });
    const df0 = discount(s.market, 'USD', s.day, s.day + 365);
    applyImpact(s, { k: 'rate', ccy: 'USD', v: 0.0025 });
    expect(rate(s.market, 'USD')).toBeCloseTo(0.0425, 10);
    expect(discount(s.market, 'USD', s.day, s.day + 365)).toBeLessThan(df0);
  });

  it('les réunions programmées ont lieu (cartel, banques centrales)', () => {
    const s = createGame({ seed: 'cal', years: 1 });
    for (let i = 0; i < 120 && s.status === 'running'; i++) advanceDay(s);
    expect(s.news.some((n) => /cartel/i.test(n.headline))).toBe(true);
    expect(s.news.some((n) => /Réserve fédérale|Banque centrale européenne/.test(n.headline))).toBe(true);
  });
});

describe('sanctions et réglementation par ville', () => {
  it('sanctions totales : contrats frustrés pour un siège occidental, pas pour Dubaï', () => {
    for (const [hq, expected] of [['geneva', 0], ['dubai', 1]] as const) {
      const s = createGame({ seed: 'sa', hqCity: hq, ...quiet });
      fwd(s, 'sarmneft', 1, 60);
      applyImpact(s, { k: 'sanction', zone: 'SARM', by: 'west', kind: 'full' });
      expect(s.forwards).toHaveLength(expected);
      expect(!!sanctionFor(s, 'sarmneft', 'BRENT')).toBe(hq === 'geneva');
    }
  });

  it('plafond de prix : achat sarmate autorisé seulement sous le plafond', () => {
    const s = createGame({ seed: 'cap', ...quiet });
    applyImpact(s, { k: 'sanction', zone: 'SARM', by: 'west', kind: 'pricecap', c: 'BRENT', capPct: 0.25 });
    const mi = monthIndexOf(s.day) + 2;
    const o = { id: 'z', cityId: 'rotterdam', commodity: 'BRENT' as const, locationId: 'BRENT_RTM', side: 1 as const, qty: 300_000, month: mi, diff: 0, counterpartyId: 'sarmneft', expiresDay: s.day + 5, createdDay: s.day };
    expect(offerBlock(s, o)).toMatch(/plafond/);
    const cheap = { ...o, diff: -0.3 * futuresPrice(s.market, 'BRENT', front(s, 'BRENT', 1)) };
    expect(offerBlock(s, cheap)).toBeNull();
  });

  it('KYC strict : délai avant de pouvoir traiter une contrepartie à risque', () => {
    const s = createGame({ seed: 'kyc', ...quiet });
    s.world.cityRegs.geneva!.kyc = 0.95;
    const o = { id: 'k', cityId: 'dubai', commodity: 'WHEAT' as const, locationId: 'WHT_DXB', side: 1 as const, qty: 1_102_300, month: monthIndexOf(s.day) + 2, diff: 0, counterpartyId: 'taurgrain', expiresDay: s.day + 5, createdDay: s.day, kycReadyDay: s.day + 3 };
    expect(offerBlock(s, o)).toMatch(/KYC/);
  });

  it('élection : le taux d’impôt du siège change ; régime spécial de Singapour sous condition de volume', () => {
    const s = createGame({ seed: 'tax', hqCity: 'singapore', ...quiet });
    expect(effectiveTaxRate(s).rate).toBeCloseTo(0.17, 9);
    s.company.physVolumeYtd = 600e6;
    expect(effectiveTaxRate(s).rate).toBeCloseTo(0.1, 9);
    applyImpact(s, { k: 'tax', city: 'singapore', v: -0.08 });
    expect(effectiveTaxRate(s).rate).toBeCloseTo(0.09, 9);
  });

  it('reporting dérivés facturé chaque mois selon le régulateur du siège', () => {
    const s = createGame({ seed: 'rep', hqCity: 'london', ...quiet });
    const mi = front(s, 'BRENT', 1);
    for (let i = 0; i < 5; i++) dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: i % 2 ? -1 : 1 });
    while (monthIndexOf(s.day) === monthIndexOf(s.startDay)) advanceDay(s);
    advanceDay(s);
    expect(s.company.cumCashByCategory.compliance).toBeCloseTo(-5 * 45, 6);
  });

  it('transfert du siège : coût, puis nouveau régime', () => {
    const s = createGame({ seed: 'move', ...quiet });
    const cash = s.company.cash;
    expect(dispatch(s, { type: 'RELOCATE_HQ', city: 'dubai' }).ok).toBe(true);
    expect(s.company.hqCity).toBe('dubai');
    expect(cash - s.company.cash).toBeGreaterThan(1.5e6);
    expect(dispatch(s, { type: 'RELOCATE_HQ', city: 'geneva' }).ok).toBe(false);
  });

  it('contrôle des capitaux : cash gelé indisponible mais toujours dans la NAV', () => {
    const s = createGame({ seed: 'frz', hqCity: 'shanghai', ...quiet });
    const n0 = nav(s);
    applyImpact(s, { k: 'freezeCash', pct: 0.2, days: 10 });
    expect(nav(s)).toBeCloseTo(n0, 6);
    expect(s.company.frozenCash!.amount).toBeCloseTo(0.2 * s.company.cash, 6);
  });
});

describe('risque de contrepartie', () => {
  it('défaut : close-out netting, récupération de 35 % sur le net dû, assurance-crédit à 90 %', () => {
    for (const insured of [false, true]) {
      const s = createGame({ seed: 'def', ...quiet });
      s.credit.insurance = insured;
      const F = futuresPrice(s.market, 'BRENT', front(s, 'BRENT', 2));
      const a = fwd(s, 'rbcoal', 1, F - 5); // gagnant pour nous
      const b = fwd(s, 'rbcoal', -1, F - 3); // perdant : se compense
      const net = forwardMtm(s, a) + forwardMtm(s, b);
      expect(net).toBeGreaterThan(0);
      const n0 = nav(s);
      handleDefault(s, 'rbcoal');
      expect(s.forwards).toHaveLength(0);
      const loss = net * (1 - RECOVERY) * (insured ? 1 - INSURANCE_COVER : 1);
      expect(n0 - nav(s)).toBeCloseTo(loss, 2);
    }
  });

  it('défaut quand on doit de l’argent : on paie, pas de perte supplémentaire', () => {
    const s = createGame({ seed: 'def2', ...quiet });
    const F = futuresPrice(s.market, 'BRENT', front(s, 'BRENT', 2));
    fwd(s, 'rbcoal', 1, F + 4);
    const n0 = nav(s);
    handleDefault(s, 'rbcoal');
    expect(nav(s)).toBeCloseTo(n0, 2);
  });

  it('CSA : le collatéral suit le MTM des OTC, NAV inchangée ; défaut de la banque quasi sans perte', () => {
    const s = createGame({ seed: 'csa', ...quiet });
    const mi = monthIndexOf(s.day) + 2;
    dispatch(s, { type: 'TRADE_OTC', kind: 'swap', commodity: 'API2', month: mi, qty: 75_000 });
    const bank = s.otc[0]!.bankId;
    dispatch(s, { type: 'SET_CSA', bankId: bank, on: true });
    s.market.commodities.API2.xi += 0.2;
    const n0 = nav(s);
    stepCredit(s, 1);
    expect(nav(s)).toBeCloseTo(n0, 4);
    expect(s.credit.collateral[bank]).toBeCloseTo(-otcValueUsd(s, s.otc[0]!), 4);
    const n1 = nav(s);
    handleDefault(s, bank);
    expect(n1 - nav(s)).toBeLessThan(1);
  });
});

describe('sociétés concurrentes', () => {
  it('elles vivent : NAV qui bouge, classement incluant le joueur', () => {
    const s = createGame({ seed: 'ai', years: 1 });
    const nav0 = s.companies.map((c) => c.nav);
    for (let i = 0; i < 60; i++) advanceDay(s);
    expect(s.companies.some((c, i) => Math.abs(c.nav - nav0[i]!) > 1e6)).toBe(true);
    const board = leaderboard(s);
    expect(board.some((r) => r.id === 'player')).toBe(true);
    expect(board[0]!.nav).toBeGreaterThanOrEqual(board[board.length - 1]!.nav);
  });

  it('faillite d’un concurrent : contrats résiliés, choc de marché, société retirée', () => {
    const s = createGame({ seed: 'aidef', ...quiet });
    const F = futuresPrice(s.market, 'BRENT', front(s, 'BRENT', 2));
    fwd(s, 'hinlong', 1, F - 2);
    s.companies.find((c) => c.id === 'hinlong')!.exposure = { BRENT: 1e9 };
    const chi0 = s.market.commodities.BRENT.chi;
    companyDefault(s, 'hinlong', 'test');
    expect(s.companies.find((c) => c.id === 'hinlong')!.alive).toBe(false);
    expect(s.forwards).toHaveLength(0);
    expect(s.market.commodities.BRENT.chi).toBeLessThan(chi0);
    expect(s.credit.losses).toHaveLength(1);
  });

  it('une société dont la NAV s’effondre est recapitalisée une fois, puis fait faillite si elle rechute', () => {
    const s = createGame({ seed: 'aidef2', ...quiet });
    const c = s.companies.find((x) => x.id === 'mercuris')!;
    c.nav = 0.1 * c.initialNav;
    advanceDay(s);
    stepCompanies(s);
    // premier effondrement : sauvetage par les actionnaires (3 fois sur 4) ou faillite
    if (c.alive) {
      expect(c.recapitalized).toBe(true);
      expect(c.nav).toBeGreaterThan(0.4 * c.initialNav);
      c.nav = 0.1 * c.initialNav;
      advanceDay(s);
      stepCompanies(s);
    }
    expect(c.alive).toBe(false);
  });
});

describe('déterminisme et migration', () => {
  it('une partie complète (événements, sociétés, crédit) est déterministe et tourne 2 ans', () => {
    const run = () => {
      const s = createGame({ seed: 'p3det', years: 2, crisisFrequency: 2 });
      while (s.status === 'running') advanceDay(s);
      return { nav: nav(s), news: s.news.slice(0, 30).map((n) => n.headline).join('|'), alive: s.companies.filter((c) => c.alive).length, status: s.status };
    };
    const a = run();
    expect(a).toEqual(run());
    expect(a.status).toBe('ended');
  });

  it('migration v2 → v3', () => {
    const s = createGame({ seed: 'mig3' }) as unknown as Record<string, unknown>;
    for (const k of ['world', 'companies', 'credit']) delete s[k];
    const m = s.market as Record<string, unknown>;
    for (const k of ['rates', 'basisShift', 'halted', 'haltPending', 'drift']) delete m[k];
    s.version = 2;
    const g = migrateState(s as unknown as GameState);
    expect(g.version).toBe(SAVE_VERSION);
    advanceDay(g);
    expect(g.status).toBe('running');
  });
});
