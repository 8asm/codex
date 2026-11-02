import { describe, expect, it } from 'vitest';
import { CITIES, CITY_BY_ID } from '../../data/cities';
import { COMMODITIES, COMMODITY_IDS, CORRELATION, FX_INDEX } from '../../data/commodities';
import { COMPANIES } from '../../data/companies';
import { LOCATION_PORT } from '../../data/routes';
import { SPREADS } from '../../data/spreads';
import { CITY_ZONE, ZONE_BY_ID } from '../../data/world';
import { ASSET_DEFS } from '../../data/assets';
import { yearFrac } from '../calendar';
import { lastTradingDay, listedMonths, optionExpiry, pricingDay } from '../contracts';
import { crossCov, crossCovPair, exoticUnitPrice } from '../exotics';
import { advanceDay, createGame, dispatch, migrateState, SAVE_VERSION } from '../game';
import { forwardAt, futuresPrice, listedFront } from '../market';
import { cholesky } from '../math';
import { optionUnitPrice } from '../derivatives';
import { conversionMargin, dispatchValue } from '../assets';
import { ASSET_DEF_BY_ID } from '../../data/assets';
import { computeVar, bookCommodities } from '../risk';
import { continentsCovered, hasBranch, refreshCandidates, staffMonth, traderFlow } from '../staff';
import { isPresent, notionalUsd, offerPrice } from '../physical';
import type { ExoticSpec, GameState } from '../types';
import { bookOf, nav } from '../valuation';

const quiet = { crisisFrequency: 0 };
const game = (seed = 'p8', extra: Record<string, unknown> = {}) => createGame({ seed, ...quiet, ...extra });

describe('données étendues', () => {
  it('38 commodités, 61 villes, plus de 25 sociétés ; références croisées cohérentes', () => {
    expect(COMMODITY_IDS.length).toBe(38);
    expect(CITIES.length).toBeGreaterThanOrEqual(60);
    expect(COMPANIES.length).toBeGreaterThanOrEqual(25);
    for (const city of CITIES) {
      expect(CITY_ZONE[city.id], city.id).toBeDefined();
      expect(ZONE_BY_ID[CITY_ZONE[city.id]!], city.id).toBeDefined();
    }
    for (const c of COMMODITY_IDS) {
      const spec = COMMODITIES[c];
      expect(spec.id).toBe(c);
      expect(spec.physical.locations.length, c).toBeGreaterThan(0);
      for (const l of spec.physical.locations) {
        expect(CITY_BY_ID[l.cityId], `${c} ${l.id}`).toBeDefined();
        expect(l.id in LOCATION_PORT, `${l.id} sans port`).toBe(true);
      }
      if (spec.settlement.kind === 'physical') expect(spec.physical.locations.some((l) => l.id === (spec.settlement as { locationId: string }).locationId), c).toBe(true);
    }
    for (const co of COMPANIES) expect(CITY_BY_ID[co.cityId], co.id).toBeDefined();
    for (const a of ASSET_DEFS) expect(COMMODITIES[a.commodity].physical.locations.some((l) => l.id === a.locationId), a.id).toBe(true);
  });

  it('chaque commodité a des échéances cotées, un dernier jour de cotation avant la date de prix et des options valides', () => {
    const s = game();
    for (const c of COMMODITY_IDS) {
      const spec = COMMODITIES[c];
      const months = listedMonths(spec, s.day);
      expect(months.length, c).toBeGreaterThan(2);
      for (const mi of months.slice(0, 4)) {
        expect(lastTradingDay(spec, mi), c).toBeGreaterThan(s.day);
        // dernier jour de cotation au plus tard en fin de mois de livraison (contrats moyennés comme API2)
        expect(lastTradingDay(spec, mi), c).toBeLessThanOrEqual(pricingDay(spec, mi) + 31);
        expect(optionExpiry(spec, mi), c).toBeLessThanOrEqual(lastTradingDay(spec, mi));
        expect(Number.isFinite(futuresPrice(s.market, c, mi)), c).toBe(true);
      }
    }
  });

  it('corrélation à facteurs : définie positive, symétrique, EURUSD en dernier', () => {
    const n = COMMODITY_IDS.length + 1;
    expect(CORRELATION.length).toBe(n);
    expect(FX_INDEX).toBe(n - 1);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) expect(CORRELATION[i]![j]).toBeCloseTo(CORRELATION[j]![i]!, 12);
    const L = cholesky(CORRELATION);
    for (let i = 0; i < n; i++) expect(L[i]![i]!).toBeGreaterThan(0);
    // intuition métier : les bruts entre eux ≫ brut / cacao
    const ix = (c: string) => COMMODITY_IDS.indexOf(c as never);
    expect(CORRELATION[ix('BRENT')]![ix('WTI')]!).toBeGreaterThan(0.8);
    expect(CORRELATION[ix('BRENT')]![ix('COCOA')]!).toBeLessThan(0.1);
  });

  it('une partie avec les 38 marchés tourne sans valeur non finie', () => {
    const s = game('all');
    for (let i = 0; i < 60; i++) {
      // petites cargaisons seulement : une cargaison de 30 M$ non couverte ferait sauter le covenant bancaire
      for (const o of s.offers.filter((x) => notionalUsd(s, x.commodity, x.qty, offerPrice(s, x)) < 4e6).slice(0, 1)) dispatch(s, { type: 'ACCEPT_OFFER', offerId: o.id });
      advanceDay(s);
    }
    expect(Number.isFinite(nav(s))).toBe(true);
    expect(s.status).toBe('running');
    const cs = new Set(s.forwards.map((d) => d.commodity));
    expect(cs.size).toBeGreaterThan(0);
  });
});

describe('WTI : log-normale décalée et prix négatifs', () => {
  it('le front peut passer sous zéro ; parité call-put exacte ; la VaR reste calculable', () => {
    const s = game('neg');
    s.market.commodities.WTI.chi -= 2.3;
    const front = listedFront(s.market, 'WTI');
    expect(front).toBeLessThan(0);
    const spec = COMMODITIES.WTI;
    const mi = listedMonths(spec, s.day)[0]!;
    const expiry = optionExpiry(spec, mi);
    const F = futuresPrice(s.market, 'WTI', mi);
    const K = -5;
    const C = optionUnitPrice(s.market, { commodity: 'WTI', month: mi, type: 'C', strike: K, expiry, style: 'E' });
    const P = optionUnitPrice(s.market, { commodity: 'WTI', month: mi, type: 'P', strike: K, expiry, style: 'E' });
    const T = yearFrac(s.day, expiry);
    expect(C - P).toBeCloseTo((F - K) * Math.exp(-s.market.rates.USD * T - 0.004 * T * 0), 1);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'WTI', month: listedMonths(spec, s.day)[1]!, lots: 5 });
    expect(computeVar(s).var99).toBeGreaterThan(0);
  });

  it('le décalage borne le prix à −décalage', () => {
    const s = game('neg2');
    s.market.commodities.WTI.chi -= 10;
    expect(forwardAt(s.market, 'WTI', s.day)).toBeGreaterThan(-(COMMODITIES.WTI.model.shift ?? 0));
  });
});

describe('électricité non stockable', () => {
  it('pas d’achat spot ; une livraison se règle contre le spot, sans stock', () => {
    const s = game('pwr');
    expect(dispatch(s, { type: 'SPOT_BUY', commodity: 'POWER', locationId: 'PWR_DE', qty: 1000 }).ok).toBe(false);
    s.forwards.push({ id: 'fpw', commodity: 'POWER', locationId: 'PWR_DE', side: 1, qty: 10_000, price: 50, month: listedMonths(COMMODITIES.POWER, s.day)[0]!, deliveryDay: s.day, counterpartyId: 'suedwerk', tradeDay: s.day });
    const c0 = s.company.cash;
    advanceDay(s);
    expect(s.inventory.some((l) => l.commodity === 'POWER')).toBe(false);
    expect(s.forwards.some((d) => d.id === 'fpw')).toBe(false);
    expect(Math.abs(s.company.cash - c0)).toBeGreaterThan(0);
  });
});

describe('spreads entre commodités', () => {
  it('covariance croisée : égale à la covariance d’une même commodité, corrélation plausible entre jambes', () => {
    const s = game('xc');
    const m = s.market;
    const mi = listedMonths(COMMODITIES.BRENT, s.day)[2]!;
    const exp = optionExpiry(COMMODITIES.BRENT, mi);
    expect(crossCovPair(m, 'BRENT', mi, 'BRENT', mi, exp)).toBeCloseTo(crossCov(m, 'BRENT', mi, mi, exp), 6);
    const gm = listedMonths(COMMODITIES.GASOIL, s.day).find((x) => x >= mi)!;
    const v1 = crossCovPair(m, 'GASOIL', gm, 'GASOIL', gm, exp), v2 = crossCovPair(m, 'BRENT', mi, 'BRENT', mi, exp), c12 = crossCovPair(m, 'GASOIL', gm, 'BRENT', mi, exp);
    const rho = c12 / Math.sqrt(v1 * v2);
    expect(rho).toBeGreaterThan(0.5);
    expect(rho).toBeLessThan(1);
  });

  it('option sur crack : parité call − put = DF × (spread − K), VaR sur les deux jambes', () => {
    const s = game('crack');
    const d = SPREADS.find((x) => x.id === 'crack_go')!;
    const m1 = listedMonths(COMMODITIES.GASOIL, s.day)[1]!;
    const m2 = listedMonths(COMMODITIES.BRENT, s.day).find((x) => x >= m1)!;
    const expiry = Math.min(optionExpiry(COMMODITIES.GASOIL, m1), optionExpiry(COMMODITIES.BRENT, m2));
    const spread = d.a1 * futuresPrice(s.market, 'GASOIL', m1) - d.a2 * futuresPrice(s.market, 'BRENT', m2);
    const x: ExoticSpec = { kind: 'spread', commodity: 'GASOIL', month: m1, month2: m2, spreadId: 'crack_go', type: 'C', strike: Math.round(spread), expiry };
    const C = exoticUnitPrice(s.market, x), P = exoticUnitPrice(s.market, { ...x, type: 'P' });
    const T = yearFrac(s.day, expiry);
    expect(C - P).toBeCloseTo((spread - Math.round(spread)) * Math.exp(-0.04 * T), 0);
    expect(C).toBeGreaterThan(0);
    expect(dispatch(s, { type: 'TRADE_EXOTIC', spec: x, qty: 1_000_000 }).ok).toBe(true);
    const legs = bookCommodities(bookOf(s));
    expect(legs.has('GASOIL') && legs.has('BRENT')).toBe(true);
    expect(computeVar(s).var99).toBeGreaterThan(0);
  });
});

describe('usines de transformation', () => {
  it('marges : raffinerie (produits − brut), trituration, centrale avec option de dispatch', () => {
    const s = game('conv');
    const ref = conversionMargin(s, ASSET_DEF_BY_ID['ref_baytown']!);
    expect(ref).toBeGreaterThan(-30);
    expect(ref).toBeLessThan(40);
    const crush = conversionMargin(s, ASSET_DEF_BY_ID['crush_rosario']!);
    expect(Math.abs(crush)).toBeLessThan(5); // $/bu
    const mu = conversionMargin(s, ASSET_DEF_BY_ID['ccgt_rhein']!);
    const dv = dispatchValue(s, mu);
    expect(dv).toBeGreaterThanOrEqual(Math.max(mu, 0) - 1e-9); // la flexibilité vaut au moins l'intrinsèque
  });
});

describe('équipes et bureaux', () => {
  const rich = (seed: string) => {
    const s = game(seed, { capital: 120e6 });
    refreshCandidates(s);
    return s;
  };

  it('recruter un trader : postes, salaires mensuels, flux d’offres de sa famille', () => {
    const s = rich('hire');
    const cand = s.staff.candidates.find((c) => c.role === 'trader') ?? s.staff.candidates[0]!;
    if (cand.role !== 'trader') { cand.role = 'trader'; cand.family = 'energy'; }
    const f0 = traderFlow(s, cand.family!);
    expect(dispatch(s, { type: 'HIRE', candidateId: cand.id }).ok).toBe(true);
    expect(traderFlow(s, cand.family!)).toBeGreaterThan(f0);
    const o0 = s.company.cumCashByCategory.overhead;
    let n = 0;
    while (n++ < 30) advanceDay(s);
    expect(s.company.cumCashByCategory.overhead).toBeLessThan(o0 - cand.salary * 0.9);
  });

  it('bureau à l’étranger : présence permanente, continents, fermeture', () => {
    const s = rich('branch');
    expect(isPresent(s, 'tokyo')).toBe(false);
    expect(dispatch(s, { type: 'OPEN_BRANCH', cityId: 'tokyo', size: 'bureau' }).ok).toBe(true);
    expect(hasBranch(s, 'tokyo')).toBe(true);
    expect(isPresent(s, 'tokyo')).toBe(true);
    dispatch(s, { type: 'OPEN_BRANCH', cityId: 'saopaulo', size: 'bureau' });
    dispatch(s, { type: 'OPEN_BRANCH', cityId: 'lagos', size: 'bureau' });
    dispatch(s, { type: 'OPEN_BRANCH', cityId: 'sydney', size: 'bureau' });
    dispatch(s, { type: 'OPEN_BRANCH', cityId: 'newyork', size: 'bureau' });
    expect(continentsCovered(s)).toBeGreaterThanOrEqual(5);
    advanceDay(s);
    expect(s.achievements.some((a) => a.id === 'continents')).toBe(true);
    expect(dispatch(s, { type: 'CLOSE_BRANCH', cityId: 'tokyo' }).ok).toBe(true);
    expect(isPresent(s, 'tokyo')).toBe(false);
  });

  it('débauchage d’un collaborateur mal payé, contre-offre', () => {
    const s = rich('poach');
    const c = s.staff.candidates[0]!;
    dispatch(s, { type: 'HIRE', candidateId: c.id });
    const e = s.staff.employees[0]!;
    e.loyalty = 0;
    e.ambition = 1;
    e.salary = 1000;
    let k = 0;
    while (!s.staff.poach.length && k++ < 40) {
      s.day += 31;
      staffMonth(s);
    }
    expect(s.staff.poach.length).toBe(1);
    expect(dispatch(s, { type: 'COUNTER_OFFER', id: e.id }).ok).toBe(true);
    expect(e.salary).toBeGreaterThan(1000);
    expect(s.staff.poach.length).toBe(0);
  });
});

describe('sauvegardes', () => {
  it('migration v7 → v8 : nouveaux marchés, villes, sociétés et équipes', () => {
    const s = game('m8') as GameState;
    const extra = COMMODITY_IDS.slice(5);
    for (const c of extra) {
      delete (s.market.commodities as Partial<GameState['market']['commodities']>)[c];
      delete (s.fixings as Partial<GameState['fixings']>)[c];
      for (const h of s.market.history) delete (h.f as Partial<typeof h.f>)[c];
    }
    delete (s as Partial<GameState>).staff;
    s.companies = s.companies.filter((c) => !['mitsuhana', 'wilmore'].includes(c.id));
    s.version = 7;
    const m = migrateState(s);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.market.commodities.COCOA).toBeDefined();
    expect(m.companies.some((c) => c.id === 'mitsuhana')).toBe(true);
    for (let i = 0; i < 5; i++) advanceDay(m);
    expect(m.status).toBe('running');
    expect(Number.isFinite(nav(m))).toBe(true);
  });
});

describe('couverture automatique', () => {
  it('déboucle ses propres couvertures quand le physique disparaît, sans toucher aux positions manuelles', async () => {
    const { runAutomation } = await import('../automation');
    const s = createGame({ seed: 'hedge-unwind', years: 1 });
    s.automation.autoHedge = { on: true, ratio: 1, threshold: 0.1 };
    const spec = COMMODITIES.BRENT;
    const mi = listedMonths(spec, s.day)[2]!;
    // position spéculative manuelle sur une autre échéance
    expect(dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: 5 }).ok).toBe(true);
    s.inventory.push({ id: 'L1', commodity: 'BRENT', locationId: spec.physical.locations[0]!.id, qty: 100_000, cost: 0, sinceDay: s.day, quality: 1 } as GameState['inventory'][number]);
    runAutomation(s);
    const net = () => s.futures.filter((p) => p.commodity === 'BRENT').reduce((a, p) => a + p.lots, 0);
    // couverture en strip : −100 lots sur l'échéance du stock ; la position manuelle (autre échéance) reste à part
    const own = () => Object.entries(s.automation.hedged ?? {}).filter(([k]) => k.startsWith('BRENT:')).reduce((a, [, v]) => a + v, 0);
    expect(net()).toBe(-95);
    expect(own()).toBe(-100_000);
    s.inventory = [];
    runAutomation(s);
    // seule la part automatique est rendue : il reste les 5 lots manuels
    expect(net()).toBe(5);
    expect(own()).toBe(0);
  });
});
