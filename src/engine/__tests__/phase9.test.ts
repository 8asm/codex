import { describe, expect, it } from 'vitest';
import { COMMODITIES } from '../../data/commodities';
import { GRADE_BY_ID, GRADES } from '../../data/grades';
import { listedMonths, lotQty, physicalDeliveryDay } from '../contracts';
import { monthIndexOf } from '../calendar';
import { closeDesk, deskMonth, deskPositions, deskTrading, settleDesks, traderView } from '../desks';
import { advanceDay, createGame, dispatch, migrateState, SAVE_VERSION } from '../game';
import { gradeDiff, gradeProductDeltas, PRODUCTS } from '../grades';
import { recomputeIm } from '../margin';
import { discount, forwardAt, fx } from '../market';
import { bookCommodities, computeVar } from '../risk';
import { runAutomation } from '../automation';
import { taxSplit } from '../staff';
import { processDeliveries } from '../physical';
import type { Employee, ForwardDeal, GameState } from '../types';
import { bookOf, exposures, forwardMtm, nav } from '../valuation';

const quiet = { crisisFrequency: 0 };
const game = (seed = 'p9') => createGame({ seed, ...quiet });

function trader(s: GameState, over: Partial<Employee> = {}): Employee {
  const e: Employee = { id: 'tr1', name: 'Test', role: 'trader', family: 'energy', skill: 100, ambition: 0, loyalty: 100, salary: 20_000, network: 0, hiredDay: s.day, cityId: s.company.hqCity, mandate: { on: true, budget: 250_000 }, ...over };
  s.staff.employees.push(e);
  return e;
}

describe('desks délégués', () => {
  it('un trader parfaitement informé se positionne dans le sens de la dérive réelle, dans sa limite de VaR', () => {
    const s = game();
    s.market.drift = { BRENT: 0.25, WTI: -0.25 };
    const e = trader(s);
    expect(Math.abs(traderView(s, e, 'BRENT') - 0.25)).toBeLessThan(0.1); // compétence 100 : bruit de 2 %
    deskTrading(s);
    const pos = deskPositions(s, e.id);
    const brent = pos.find((p) => p.commodity === 'BRENT');
    const wti = pos.find((p) => p.commodity === 'WTI');
    expect(brent && brent.lots > 0).toBe(true);
    expect(wti && wti.lots < 0).toBe(true);
    // VaR du desk (modèle de la maison) dans la limite ; positions incluses dans le livre, la marge et les expositions
    const v = computeVar(s, { ...bookOf(s), futures: pos, forwards: [], inventory: [] }).var99;
    expect(v).toBeLessThanOrEqual(250_000 * 1.05);
    expect(bookOf(s).futures.length).toBe(pos.length);
    recomputeIm(s);
    expect(s.company.im).toBeGreaterThan(0);
    const ex = exposures(s).find((x) => x.commodity === 'BRENT')!;
    expect(ex.deskQty).toBe(brent!.lots * lotQty(COMMODITIES.BRENT, brent!.month));
    expect(ex.futuresQty).toBe(0); // la couverture automatique ne confond pas un desk avec une couverture
    expect(ex.netQty).toBe(0); // ni « Neutraliser Δ »
  });

  it('comptabilité : le P&L du desk est exactement le cash qu’il a fait bouger (VM + commissions)', () => {
    const s = game('p9-acc');
    s.market.drift = { BRENT: 0.3, GASOIL: 0.3 };
    const e = trader(s);
    const cash0 = s.company.cumCashByCategory.vm + s.company.cumCashByCategory.commission;
    deskTrading(s);
    for (let i = 0; i < 25; i++) {
      advanceDay(s);
      if (s.status !== 'running') break;
    }
    closeDesk(s, e.id);
    const moved = s.company.cumCashByCategory.vm + s.company.cumCashByCategory.commission - cash0;
    expect(deskPositions(s, e.id).length).toBe(0);
    expect(s.desks!.records[e.id]!.pnlTotal).toBeCloseTo(moved, 2);
  });

  it('stop-loss mensuel, puis reprise le mois suivant ; licenciement = positions fermées', () => {
    const s = game('p9-stop');
    s.market.drift = { BRENT: 0.3 };
    const e = trader(s);
    deskTrading(s);
    expect(deskPositions(s, e.id).length).toBeGreaterThan(0);
    s.desks!.records[e.id]!.pnlMonth = -5 * 250_000;
    deskTrading(s);
    expect(deskPositions(s, e.id).length).toBe(0);
    expect(s.desks!.records[e.id]!.stopped).toBe(true);
    deskMonth(s);
    expect(s.desks!.records[e.id]!.stopped).toBe(false);
    deskTrading(s);
    expect(deskPositions(s, e.id).length).toBeGreaterThan(0);
    expect(dispatch(s, { type: 'FIRE_EMPLOYEE', id: e.id }).ok).toBe(true);
    expect(deskPositions(s, e.id).length).toBe(0);
  });

  it('VM du soir : marquage au règlement, P&L du desk = Σ (règlement − marque) × quantité', () => {
    const s = game('p9-vm');
    s.market.drift = { BRENT: 0.3 };
    const e = trader(s);
    deskTrading(s);
    const before = s.desks!.records[e.id]!.pnlTotal;
    const marks = deskPositions(s, e.id).map((p) => ({ p, mark: p.mark }));
    s.market.commodities.BRENT.chi += 0.05;
    settleDesks(s);
    const expected = marks.reduce((a, { p, mark }) => a + (p.mark - mark) * p.lots * lotQty(COMMODITIES[p.commodity], p.month) * COMMODITIES[p.commodity].valuePerUnit * fx(s.market, COMMODITIES[p.commodity].currency), 0);
    expect(s.desks!.records[e.id]!.pnlTotal - before).toBeCloseTo(expected, 4);
  });
});

describe('fiscalité des bureaux', () => {
  it('imputation directe des desks, clé de masse salariale pour le reste, retenue en cas de contrôle des capitaux', () => {
    const s = game('p9-tax');
    const branch = 'singapore' === s.company.hqCity ? 'dubai' : 'singapore';
    s.staff.branches.push({ cityId: branch, size: 'bureau', openedDay: s.day, fitOut: 0 } as never);
    const e = trader(s, { cityId: branch, salary: 30_000 });
    s.desks = { positions: [], records: { [e.id]: { pnlMonth: 0, pnlYear: 0, pnlTotal: 2e6, trades: 0, pnlLastYear: 2e6 } } };
    s.world.cityRegs[branch]!.capitalControls = true;
    const parts = taxSplit(s, 10e6, 0.2, 90_000);
    const total = parts.reduce((a, p) => a + p.base, 0);
    expect(total).toBeCloseTo(10e6, 2);
    const b = parts.find((p) => p.cityId === branch)!;
    expect(b.direct).toBeCloseTo(2e6, 2);
    expect(b.base).toBeCloseTo(2e6 + (8e6 * 30_000) / 120_000, 2);
    expect(b.rate).toBe(s.world.cityRegs[branch]!.taxRate);
    expect(b.withholding).toBeCloseTo(0.1 * (b.base - b.tax), 4);
    // aucune base si le résultat est négatif
    expect(taxSplit(s, -1e6, 0.2, 90_000).every((p) => p.tax === 0)).toBe(true);
  });
});

describe('couverture automatique en strip', () => {
  it('chaque forward est couvert sur son échéance ; la livraison de l’un ne déboucle que sa couverture', () => {
    const s = game('p9-strip');
    s.automation.autoHedge = { on: true, ratio: 1, threshold: 0.05 };
    const mk = (id: string, months: number): ForwardDeal => {
      const mi = monthIndexOf(s.day) + months;
      return { id, commodity: 'BRENT', locationId: 'BRENT_RTM', side: 1, qty: 300_000, price: 80, month: mi, deliveryDay: physicalDeliveryDay(mi), counterpartyId: 'x', tradeDay: s.day };
    };
    s.forwards.push(mk('a', 2), mk('b', 5));
    runAutomation(s);
    const months = s.futures.filter((p) => p.commodity === 'BRENT').map((p) => p.month);
    expect(new Set(months).size).toBe(2);
    expect(s.futures.reduce((a, p) => a + p.lots, 0)).toBe(-600);
    s.forwards = s.forwards.filter((d) => d.id !== 'b');
    runAutomation(s);
    expect(s.futures.reduce((a, p) => a + p.lots, 0)).toBe(-300);
    expect(s.futures.length).toBe(1);
  });
});

describe('qualités de brut', () => {
  it('données : benchmarks et lieux cohérents', () => {
    for (const g of GRADES) {
      expect(['BRENT', 'WTI', 'DUBAI']).toContain(g.benchmark);
      for (const l of g.locations) expect(COMMODITIES[g.benchmark].physical.locations.some((x) => x.id === l)).toBe(true);
      expect(g.yields.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1);
    }
  });

  it('valeur d’usage : la sensibilité aux produits est exacte (différences finies) ; un brut lourd perd quand le fioul baisse', () => {
    const s = game('p9-grade');
    const day = physicalDeliveryDay(monthIndexOf(s.day) + 2);
    const d0 = gradeDiff(s.market, 'maya', day);
    const f0 = forwardAt(s.market, 'FUELOIL', day);
    s.market.commodities.FUELOIL.xi += Math.log(0.8);
    const dF = forwardAt(s.market, 'FUELOIL', day) - f0;
    const d1 = gradeDiff(s.market, 'maya', day);
    expect(d1 - d0).toBeCloseTo(gradeProductDeltas('maya').FUELOIL! * dF, 8);
    expect(d1).toBeLessThan(d0);
    // un brut léger, au contraire, gagne relativement
    expect(gradeProductDeltas('cpc').FUELOIL!).toBeLessThan(0);
    expect(GRADE_BY_ID.maya!.diff0).toBe(-8);
  });

  it('forward d’une qualité : MTM au benchmark + base + différentiel ; VaR sur les produits ; livraison d’une autre qualité ajustée', () => {
    const s = game('p9-grade2');
    const mi = monthIndexOf(s.day) + 1;
    const day = physicalDeliveryDay(mi);
    const deal: ForwardDeal = { id: 'g1', commodity: 'BRENT', locationId: 'BRENT_USGC', side: 1, qty: 500_000, price: 70, month: mi, deliveryDay: day, counterpartyId: 'x', tradeDay: s.day, grade: 'maya' };
    s.forwards.push(deal);
    const plain = forwardMtm(s, { ...deal, grade: undefined });
    expect(forwardMtm(s, deal) - plain).toBeCloseTo(gradeDiff(s.market, 'maya', day) * 500_000 * COMMODITIES.BRENT.valuePerUnit * discount(s.market, 'USD', s.day, day), 4);
    const set = bookCommodities(bookOf(s));
    for (const p of PRODUCTS) expect(set.has(p)).toBe(true);
    const ex = exposures(s);
    expect(ex.find((x) => x.commodity === 'FUELOIL')!.gradeQty).toBeCloseTo(500_000 * gradeProductDeltas('maya').FUELOIL!, 6);
    // livraison : un lot de Mars livré sur une vente de Maya est ajusté de la différence de valeur d'usage
    s.forwards = [{ ...deal, id: 'g2', side: -1, deliveryDay: s.day, grade: 'maya' }];
    s.inventory.push({ id: 'L', commodity: 'BRENT', locationId: 'BRENT_USGC', qty: 500_000, cost: 70, sinceDay: s.day, grade: 'mars' });
    const cash0 = s.company.cash;
    processDeliveries(s);
    const k = COMMODITIES.BRENT.valuePerUnit;
    const adj = 500_000 * (gradeDiff(s.market, 'mars', s.day) - gradeDiff(s.market, 'maya', s.day)) * k;
    expect(s.company.cash - cash0).toBeCloseTo(500_000 * 70 * k + adj, 2);
    expect(adj).toBeGreaterThan(0); // Mars, plus léger, vaut plus que Maya
  });

  it('les offres de brut portent des qualités, et la valeur juste de l’offre en tient compte', () => {
    const s = createGame({ seed: 'p9-off', ...quiet, commodities: ['BRENT', 'WTI', 'DUBAI', 'GASOIL', 'FUELOIL', 'GASOLINE', 'JET'] } as never);
    let graded = 0;
    for (let i = 0; i < 40 && s.status === 'running'; i++) {
      advanceDay(s);
      graded += s.offers.filter((o) => o.grade).length;
    }
    expect(graded).toBeGreaterThan(0);
    expect(nav(s)).toBeGreaterThan(0);
    expect(listedMonths(COMMODITIES.BRENT, s.day).length).toBeGreaterThan(0);
  });
});

describe('sauvegarde v9', () => {
  it('migration 8 → 9 : mémoire de couverture par échéance, desks vides', () => {
    const s = game('p9-mig');
    const mi = listedMonths(COMMODITIES.BRENT, s.day)[1]!;
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: -10 });
    const raw = JSON.parse(JSON.stringify(s)) as GameState & { version: number };
    raw.version = 8;
    raw.automation.hedged = { BRENT: -10_000 } as never;
    delete raw.desks;
    const m = migrateState(raw) as GameState & { version: number };
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.automation.hedged).toEqual({ [`BRENT:${mi}`]: -10_000 });
    expect(m.desks).toEqual({ positions: [], records: {} });
  });
});

describe('leçons guidées', () => {
  it('les étapes se valident sur l’état ; une leçon indisponible est refusée ; la leçon terminée est mémorisée', async () => {
    const { LESSONS } = await import('../../data/lessons');
    const s = createGame({ seed: 'p9-lesson', ...quiet, commodities: ['BRENT', 'GASOIL', 'CU', 'TTF', 'WHEAT'] } as never);
    expect(dispatch(s, { type: 'START_LESSON', id: 'power' }).ok).toBe(false); // électricité non suivie
    expect(dispatch(s, { type: 'START_LESSON', id: 'crack' }).ok).toBe(true);
    expect(s.lessons!.step).toBe(0);
    const mb = listedMonths(COMMODITIES.BRENT, s.day)[1]!;
    const mg = listedMonths(COMMODITIES.GASOIL, s.day)[1]!;
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mb, lots: 10 });
    expect(s.lessons!.step).toBe(1);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'GASOIL', month: mg, lots: -75 });
    expect(s.lessons!.active).toBeNull();
    expect(s.lessons!.done).toContain('crack');
    // chaque leçon a au moins une étape et un panneau valide
    for (const l of LESSONS) expect(l.steps.length).toBeGreaterThan(0);
  });
});
