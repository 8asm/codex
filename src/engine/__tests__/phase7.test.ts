import { describe, expect, it } from 'vitest';
import { COMMODITIES } from '../../data/commodities';
import { SCENARIOS } from '../../data/scenarios';
import { addBusinessDays, yearFrac } from '../calendar';
import { listedMonths, optionExpiry } from '../contracts';
import {
  barrierPrice, bvnCdf, compoundCallOnCall, crossCov, exoticUnitPrice, exoticValueUsd, kirkSpread, mcExotic, quantoCov, totalVar, cliquetDays,
} from '../exotics';
import { advanceDay, createGame, dispatch, migrateState, SAVE_VERSION } from '../game';
import { futuresPrice, zeroRate } from '../market';
import { normCdf } from '../math';
import { black76 } from '../pricing';
import { computeVar } from '../risk';
import { acceptPrepay, financeLot, loansOutstanding, prepayTerms, prepayValue } from '../financing';
import { estimateFine, recordCase, LEVELS, complianceMonth, stepInvestigations } from '../compliance';
import { handleDefault } from '../credit';
import { buildRecap, goalProgress } from '../progress';
import type { ExoticSpec, GameState } from '../types';
import { nav } from '../valuation';

const quiet = { crisisFrequency: 0 };
const game = (seed = 'p7', extra: Record<string, unknown> = {}) => createGame({ seed, ...quiet, ...extra });
const months = (s: GameState, c: 'BRENT' | 'CU' | 'TTF' = 'BRENT') => listedMonths(COMMODITIES[c], s.day);

/** Tolérance MC : 3,5 écarts-types + une marge relative (approximations de surveillance discrète, Kirk, Geske). */
const closeTo = (a: number, mc: { price: number; se: number }, rel: number) => {
  expect(Math.abs(a - mc.price)).toBeLessThan(3.5 * mc.se + rel * Math.max(Math.abs(mc.price), 1e-6));
};

describe('outils numériques', () => {
  it('normale bivariée : cas analytiques', () => {
    for (const r of [-0.95, -0.6, -0.2, 0, 0.3, 0.7, 0.95]) expect(bvnCdf(0, 0, r)).toBeCloseTo(0.25 + Math.asin(r) / (2 * Math.PI), 8);
    expect(bvnCdf(0.4, -0.7, 0)).toBeCloseTo(normCdf(0.4) * normCdf(-0.7), 8);
    expect(bvnCdf(1.2, 0.5, 0.999999)).toBeCloseTo(normCdf(0.5), 4);
    expect(bvnCdf(1, -1, -0.999999)).toBeCloseTo(0, 3);
    // référence par quadrature : P(X<a, Y<b) = ∫ φ(x) N((b − ρx)/√(1−ρ²)) dx
    expect(bvnCdf(1, -1, -0.99)).toBeCloseTo(0.01365173, 6);
    expect(bvnCdf(0.3, 0.5, -0.97)).toBeCloseTo(0.30938805, 6);
  });
});

describe('exotiques : formules fermées', () => {
  const F = 80, v = 0.3 ** 2 * 0.5, df = 0.98;
  it('barrières : parité in + out = vanille, pour toutes les combinaisons', () => {
    for (const type of ['C', 'P'] as const)
      for (const [H, K] of [[95, 80], [95, 100], [65, 80], [65, 60]] as const) {
        const up = H > F;
        const out = barrierPrice(F, K, H, v, df, type, up ? 'up-out' : 'down-out');
        const inn = barrierPrice(F, K, H, v, df, type, up ? 'up-in' : 'down-in');
        expect(out + inn).toBeCloseTo(black76(F, K, 0.5, 0.3, -Math.log(df) / 0.5, type), 8);
        expect(out).toBeGreaterThanOrEqual(0);
        expect(inn).toBeGreaterThanOrEqual(0);
      }
  });

  it('barrière éloignée : la knock-out tend vers la vanille', () => {
    expect(barrierPrice(F, 80, 400, v, df, 'C', 'up-out')).toBeCloseTo(black76(F, 80, 0.5, 0.3, -Math.log(df) / 0.5, 'C'), 6);
  });

  it('Kirk : exacte (Margrabe) pour un strike nul', () => {
    const F1 = 82, F2 = 79, v1 = 0.09 * 0.4, v2 = 0.07 * 0.4, c12 = 0.9 * Math.sqrt(v1 * v2);
    const vm = v1 - 2 * c12 + v2;
    expect(kirkSpread(F1, F2, 0, v1, v2, c12, df, 'C')).toBeCloseTo(black76(F1, F2, 1, Math.sqrt(vm), -Math.log(df), 'C'), 8);
    // parité call − put = DF (F1 − F2 − K)
    expect(kirkSpread(F1, F2, 2, v1, v2, c12, df, 'C') - kirkSpread(F1, F2, 2, v1, v2, c12, df, 'P')).toBeCloseTo(df * (F1 - F2 - 2), 8);
  });

  it('composée : prime nulle = call sous-jacent ; prime énorme = 0', () => {
    const c = compoundCallOnCall(80, 85, 1e-9, 0.25, 0.75, 0.32, 0.99, 0.97);
    expect(c).toBeCloseTo(black76(80, 85, 0.75, 0.32, 0, 'C') * 0.97, 5);
    expect(compoundCallOnCall(80, 85, 50, 0.25, 0.75, 0.32, 0.99, 0.97)).toBeLessThan(0.01);
  });
});

describe('exotiques : contrôle Monte Carlo sur la dynamique exacte du modèle', () => {
  const s = game('mc');
  const m = s.market;
  const mi = months(s)[2]!;
  const exp = optionExpiry(COMMODITIES.BRENT, mi);
  const F = futuresPrice(m, 'BRENT', mi);
  const base = { commodity: 'BRENT' as const, month: mi, expiry: exp };

  it('barrière up-and-out (surveillance quotidienne, correction BGK)', () => {
    const x: ExoticSpec = { ...base, kind: 'barrier', type: 'C', strike: Math.round(F), barrier: Math.round(F * 1.2), barrierType: 'up-out' };
    closeTo(exoticUnitPrice(m, x), mcExotic(m, x, {}, 8000, 'b1'), 0.03);
    const y: ExoticSpec = { ...x, type: 'P', barrier: Math.round(F * 0.85), barrierType: 'down-in' };
    closeTo(exoticUnitPrice(m, y), mcExotic(m, y, {}, 8000, 'b2'), 0.04);
  });

  it('digitale : parité call + put = montant actualisé, et proche du MC', () => {
    const x: ExoticSpec = { ...base, kind: 'digital', type: 'C', strike: Math.round(F), payout: 10 };
    const call = exoticUnitPrice(m, x), put = exoticUnitPrice(m, { ...x, type: 'P' });
    const T = yearFrac(s.day, exp);
    expect(call + put).toBeCloseTo(10 * Math.exp(-zeroRate(m, 'USD', T) * T), 3);
    // le MC n'a pas de smile : l'écart reste petit pour une digitale à la monnaie
    closeTo(call, mcExotic(m, x, {}, 8000, 'd1'), 0.08);
  });

  it('lookback à strike flottant', () => {
    const x: ExoticSpec = { ...base, kind: 'lookback', type: 'C', strike: 1 };
    closeTo(exoticUnitPrice(m, x, { extreme: F }), mcExotic(m, x, { extreme: F }, 6000, 'l1'), 0.03);
    const y: ExoticSpec = { ...x, type: 'P' };
    closeTo(exoticUnitPrice(m, y, { extreme: F }), mcExotic(m, y, { extreme: F }, 6000, 'l2'), 0.03);
  });

  it('spread calendaire : Kirk avec la covariance exacte du modèle entre échéances', () => {
    const mi2 = months(s)[4]!;
    const F2 = futuresPrice(m, 'BRENT', mi2);
    const x: ExoticSpec = { ...base, kind: 'spread', type: 'C', strike: Math.round((F - F2) * 10) / 10, month2: mi2 };
    closeTo(exoticUnitPrice(m, x), mcExotic(m, x, {}, 8000, 's1'), 0.03);
    // corrélation forte mais < 1 entre échéances (effet Samuelson)
    const c = crossCov(m, 'BRENT', mi, mi2, exp) / Math.sqrt(crossCov(m, 'BRENT', mi, mi, exp) * crossCov(m, 'BRENT', mi2, mi2, exp));
    expect(c).toBeGreaterThan(0.7);
    expect(c).toBeLessThan(1);
  });

  it('composée call sur call (Geske)', () => {
    const mi3 = months(s)[5]!;
    const exp2 = optionExpiry(COMMODITIES.BRENT, mi3);
    const F3 = futuresPrice(m, 'BRENT', mi3);
    const x: ExoticSpec = { kind: 'compound', commodity: 'BRENT', month: mi3, type: 'C', strike: Math.round(F3), expiry: exp, expiry2: exp2, strike2: 3 };
    closeTo(exoticUnitPrice(m, x), mcExotic(m, x, {}, 6000, 'c1'), 0.06);
  });

  it('cliquet : somme d’options à départ différé', () => {
    const days = cliquetDays(s.day, exp, 3);
    const x: ExoticSpec = { ...base, kind: 'cliquet', type: 'C', strike: 1, resets: 3 };
    const st = { resetDays: days, refs: [F] };
    closeTo(exoticUnitPrice(m, x, st), mcExotic(m, x, st, 6000, 'q1'), 0.03);
  });

  it('quanto : corrélation nulle (TTF/EURUSD) = vanille convertie ; corrélation positive (cuivre payé en EUR) relève le forward', () => {
    const tm = months(s, 'TTF')[2]!;
    const texp = optionExpiry(COMMODITIES.TTF, tm);
    expect(quantoCov(m, 'TTF', tm, texp)).toBeCloseTo(0, 12);
    const cm = months(s, 'CU')[2]!;
    const cexp = optionExpiry(COMMODITIES.CU, cm);
    expect(quantoCov(m, 'CU', cm, cexp)).toBeLessThan(0);
    const Fc = futuresPrice(m, 'CU', cm);
    const q: ExoticSpec = { kind: 'quanto', commodity: 'CU', month: cm, type: 'C', strike: Math.round(Fc), expiry: cexp, quantoFx: 0.9 };
    const T = yearFrac(s.day, cexp);
    const plain = 0.9 * black76(Fc, Math.round(Fc), 1, Math.sqrt(totalVar(m, 'CU', cm, cexp)), 0, 'C') * Math.exp(-zeroRate(m, 'EUR', T) * T);
    expect(exoticUnitPrice(m, q)).toBeGreaterThan(plain);
  });
});

describe('exotiques : cycle de vie', () => {
  it('achat : la VL ne perd que la fourchette ; règlement à l’échéance = payoff ; VaR > 0', () => {
    const s = game('life');
    const mi = months(s)[1]!;
    const exp = Math.min(optionExpiry(COMMODITIES.BRENT, mi), addBusinessDays(s.day, 15));
    const F = futuresPrice(s.market, 'BRENT', mi);
    const spec: ExoticSpec = { kind: 'digital', commodity: 'BRENT', month: mi, type: 'C', strike: Math.round(F), expiry: exp, payout: 5 };
    const v0 = nav(s);
    const r = dispatch(s, { type: 'TRADE_EXOTIC', spec, qty: 100_000 });
    expect(r.ok).toBe(true);
    const p = s.exotics[0]!;
    const half = (p.premium - exoticUnitPrice(s.market, p, p)) * 100_000;
    expect(nav(s)).toBeCloseTo(v0 - half, -1);
    expect(computeVar(s).var99).toBeGreaterThan(0);
    while (s.day < exp && s.status === 'running') advanceDay(s);
    advanceDay(s);
    expect(s.exotics.length).toBe(0);
    expect(s.stats.exoticPnl.length).toBe(1);
  });

  it('barrière désactivée dès qu’elle est touchée à une clôture', () => {
    const s = game('ko');
    const mi = months(s)[1]!;
    const F = futuresPrice(s.market, 'BRENT', mi);
    const spec: ExoticSpec = { kind: 'barrier', commodity: 'BRENT', month: mi, type: 'C', strike: Math.round(F), expiry: optionExpiry(COMMODITIES.BRENT, mi), barrier: Math.round(F * 1.05), barrierType: 'up-out' };
    dispatch(s, { type: 'TRADE_EXOTIC', spec, qty: 10_000 });
    s.market.commodities.BRENT.chi += 0.1; // +10 % : barrière franchie
    advanceDay(s);
    expect(s.exotics[0]!.hit).toBe(true);
    expect(exoticValueUsd(s, s.exotics[0]!)).toBe(0);
  });
});

describe('courbe des taux', () => {
  it('Nelson-Siegel : court = taux directeur, long = taux + pente ; une hausse aplatit la courbe', () => {
    const s = game('rates');
    const m = s.market;
    expect(zeroRate(m, 'USD', 1e-6)).toBeCloseTo(m.rates.USD, 6);
    expect(zeroRate(m, 'USD', 60)).toBeCloseTo(m.rates.USD + m.curve!.USD.slope, 2);
    expect(zeroRate(m, 'USD', 5)).toBeGreaterThan(zeroRate(m, 'USD', 1));
  });
});

describe('financement', () => {
  it('prêt sur stock : VL neutre à l’origine, intérêts, remboursement à la vente', () => {
    const s = game('loan');
    dispatch(s, { type: 'SPOT_BUY', commodity: 'CU', locationId: 'CU_RTM', qty: 500 });
    const lot = s.inventory[0]!;
    const v0 = nav(s), c0 = s.company.cash;
    expect(financeLot(s, lot.id).ok).toBe(true);
    expect(s.company.cash).toBeGreaterThan(c0);
    expect(nav(s)).toBeCloseTo(v0, 2);
    const owed = loansOutstanding(s);
    expect(owed).toBeGreaterThan(0);
    const fin0 = s.company.cumCashByCategory.financing;
    advanceDay(s);
    expect(s.company.cumCashByCategory.financing).toBeLessThan(fin0); // intérêts
    dispatch(s, { type: 'SPOT_SELL', lotId: lot.id });
    advanceDay(s);
    expect(loansOutstanding(s)).toBe(0);
  });

  it('prêt sur stock : appel de marge si le prix chute', () => {
    const s = game('loan2');
    dispatch(s, { type: 'SPOT_BUY', commodity: 'CU', locationId: 'CU_RTM', qty: 500 });
    financeLot(s, s.inventory[0]!.id);
    const p0 = loansOutstanding(s);
    s.market.commodities.CU.chi -= 0.2;
    advanceDay(s);
    expect(loansOutstanding(s)).toBeLessThan(p0);
  });

  it('préfinancement : prix payé = valeur (pas de gain du premier jour), livraisons en stock, défaut du producteur', () => {
    const s = game('prepay');
    s.financing.offers.push({ id: 'po1', counterpartyId: s.companies.find((c) => c.alive)!.id, commodity: 'CU', locationId: 'CU_RTM', months: 6, qtyPerMonth: 200, discount: 0.04, expiresDay: s.day + 30 });
    const t = prepayTerms(s, s.financing.offers[0]!);
    expect(t.paid).toBeCloseTo(t.pv * 0.96, 0);
    const v0 = nav(s);
    expect(acceptPrepay(s, 'po1').ok).toBe(true);
    expect(prepayValue(s, s.financing.prepays[0]!)).toBeCloseTo(t.paid, -2);
    expect(nav(s)).toBeCloseTo(v0, -2);
    let n = 0;
    while (s.inventory.length === 0 && n++ < 40) advanceDay(s);
    expect(s.inventory[0]!.qty).toBe(200);
    const cp = s.financing.prepays[0]!.counterpartyId;
    handleDefault(s, cp);
    expect(s.financing.prepays.length).toBe(0);
    expect(s.credit.losses.length).toBeGreaterThan(0);
  });

  it('lettre de crédit exigée : commission prélevée, ligne consommée', () => {
    const s = game('lc');
    for (let i = 0; i < 40 && s.stats.lcsIssued === 0; i++) {
      for (const o of s.offers.filter((x) => x.side > 0)) {
        const r = dispatch(s, { type: 'ACCEPT_OFFER', offerId: o.id });
        if (r.ok && s.stats.lcsIssued) break;
      }
      advanceDay(s);
    }
    expect(s.stats.lcsIssued).toBeGreaterThan(0);
    expect(s.company.cumCashByCategory.financing).toBeLessThan(0);
  });
});

describe('qualité et inspection', () => {
  it('sans inspection, une cargaison hors spécification perd de la valeur ; avec, le vendeur consent une réfaction', () => {
    let seen = { plain: false, inspected: false };
    for (let k = 0; k < 30 && !(seen.plain && seen.inspected); k++) {
      for (const inspect of [false, true]) {
        const s = game(`q${k}`);
        for (let i = 0; i < 30; i++) {
          for (const o of s.offers.filter((x) => x.side > 0)) dispatch(s, { type: 'ACCEPT_OFFER', offerId: o.id, inspect });
          advanceDay(s);
        }
        while (s.forwards.length && s.status === 'running') advanceDay(s);
        const bad = s.inventory.filter((l) => (l.quality ?? 1) < 1);
        if (bad.length && !inspect) seen.plain = true;
        // inspecté : lot hors spécification payé moins cher (coût de revient réduit)
        if (bad.length && inspect) seen.inspected = bad.every((l) => l.cost > 0);
      }
    }
    expect(seen.plain).toBe(true);
  });
});

describe('conformité et enquêtes', () => {
  it('le programme renforcé bloque une offre avec commission ; le minimal l’accepte et ouvre un dossier', () => {
    const s = game('bribe');
    const mk = () => {
      const o = { ...s.offers[0]!, id: `ob${Math.random()}`, bribe: 100_000, side: 1 as const, kycReadyDay: undefined };
      s.offers.push(o);
      return o.id;
    };
    if (!s.offers.length) advanceDay(s);
    dispatch(s, { type: 'SET_COMPLIANCE', level: 'renforcé' });
    expect(dispatch(s, { type: 'ACCEPT_OFFER', offerId: mk() }).ok).toBe(false);
    dispatch(s, { type: 'SET_COMPLIANCE', level: 'minimal' });
    const r = dispatch(s, { type: 'ACCEPT_OFFER', offerId: mk() });
    expect(r.ok).toBe(true);
    expect(s.compliance.cases.some((c) => c.kind === 'corruption')).toBe(true);
  });

  it('enquête : étapes, frais d’avocats, issue (amende ou relaxe), déterministe', () => {
    const run = () => {
      const s = game('inv');
      recordCase(s, 'sanctions', 5, 3e6, 'test');
      let n = 0;
      while (!s.compliance.investigations.length && n++ < 200) {
        s.day = addBusinessDays(s.day, 21);
        complianceMonth(s);
      }
      expect(s.compliance.investigations.length).toBe(1);
      const inv = s.compliance.investigations[0]!;
      expect(inv.fineEstimate).toBeCloseTo(estimateFine(s, inv), 2);
      n = 0;
      while (!inv.done && n++ < 40) {
        s.day = inv.stageEnds;
        stepInvestigations(s, 30);
      }
      expect(inv.done).toBe(true);
      expect(inv.legalSpent).toBeGreaterThan(0);
      return inv.outcome;
    };
    expect(run()).toEqual(run());
  });

  it('auto-déclaration : amende réduite de moitié, sans autre conséquence', () => {
    const s = game('self');
    dispatch(s, { type: 'SET_COMPLIANCE', level: 'renforcé' });
    const f = recordCase(s, 'sanctions', 3, 1e6, 'test');
    f.flagged = true; // repéré par la conformité (probabilité 95 % au niveau renforcé)
    const full = estimateFine(s, { caseIds: [f.id], strategy: 'contester', selfReported: false });
    expect(dispatch(s, { type: 'SELF_REPORT', caseId: f.id }).ok).toBe(true);
    const inv = s.compliance.investigations[0]!;
    s.day = inv.stageEnds;
    const c0 = s.company.cash;
    stepInvestigations(s, 1);
    expect(inv.done).toBe(true);
    expect(c0 - s.company.cash).toBeLessThan(full * 0.5);
    expect(s.compliance.banksCutUntil).toBeLessThan(s.day);
    expect(LEVELS.renforcé.fineMult).toBeLessThan(LEVELS.minimal.fineMult);
  });

  it('licence suspendue : le trading est refusé', () => {
    const s = game('susp');
    s.compliance.suspendedUntil = s.day + 30;
    expect(dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: months(s)[1]!, lots: 1 }).ok).toBe(false);
  });
});

describe('scénarios, succès, objectifs', () => {
  it('chaque scénario démarre (positions, chronologie) et tourne sans erreur', () => {
    for (const sc of SCENARIOS) {
      const s = createGame({ seed: `sc-${sc.id}`, scenario: sc.id });
      expect(s.config.scenario).toBe(sc.id);
      expect(s.world.pending.length).toBeGreaterThanOrEqual(sc.events.length);
      expect(Math.abs(nav(s) / s.company.initialCapital - 1)).toBeLessThan(0.03);
      if (sc.start.inventory) expect(s.inventory.length).toBe(sc.start.inventory.length);
      for (let i = 0; i < 40 && s.status === 'running'; i++) advanceDay(s);
      expect(['running', 'bankrupt']).toContain(s.status);
    }
  });

  it('succès et objectif : « le premier million » et la progression vers la taille', () => {
    const s = game('ach', { goal: 'taille' });
    s.company.cash += 2e6;
    advanceDay(s);
    expect(s.achievements.some((a) => a.id === 'million')).toBe(true);
    expect(goalProgress(s).progress).toBeGreaterThan(0.1);
    const r = buildRecap(s);
    expect(r.endNav).toBeCloseTo(nav(s), 0);
  });

  it('migration v6 → v7', () => {
    const s = game('m7') as unknown as Record<string, unknown> & GameState;
    for (const k of ['exotics', 'financing', 'compliance', 'stats', 'achievements']) delete (s as unknown as Record<string, unknown>)[k];
    s.version = 6;
    const m = migrateState(s);
    expect(m.version).toBe(SAVE_VERSION);
    advanceDay(m);
    expect(m.status).toBe('running');
  });
});
