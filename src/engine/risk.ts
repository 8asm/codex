/**
 * Mesures de risque du portefeuille.
 *
 *  - VaR et Expected Shortfall 99 % à 1 jour par Monte Carlo avec REVALORISATION COMPLÈTE : 400 scénarios
 *    tirés de la dynamique même du modèle (facteurs χ/ξ corrélés, différentiels, EURUSD, vol implicite).
 *    Les scénarios d'un jour donné sont fixes (nombres aléatoires communs) : la VaR incrémentale d'un ordre est
 *    donc stable et l'aléa de la partie n'est pas consommé.
 *  - Stress tests déterministes (chocs historiques stylisés).
 *  - Greeks agrégés par commodité par revalorisation avec chocs (delta, gamma, vega, theta, rho).
 *  - Échéancier des deltas (risque de calendrier).
 */
import { PRODUCTS } from './grades';
import { COMMODITIES, COMMODITY_IDS, CORRELATION, FX_INDEX } from '../data/commodities';
import { exoticLegs } from './exotics';
import { monthIndexOf, type MonthIndex } from './calendar';
import { lotQty } from './contracts';
import { apoUnitPrice, optionInputs, optionUnitGreeks, type View } from './derivatives';
import { cholesky, mulLower } from './math';
import { cloneMarket, discount, fx, IV_PARAMS, listedFront } from './market';
import { stepFactors } from './model';
import { vanillaPrice } from './pricing';
import { normal, seedRng } from './rng';
import type { Book, CommodityId, GameState, MarketState } from './types';
import { bookOf, freightBookValue, otcDeltaUnits, valueBy } from './valuation';
import { FREIGHT, FREIGHT_IDS } from '../data/freight';

export const VAR_SCENARIOS = 400;
/** Horizon d'un jour ouvré moyen (≈ 1,4 jour calendaire, week-ends compris). */
export const VAR_DT = 1.4 / 365;
const CHOL = cholesky(CORRELATION);

interface Scenario {
  fr: number[];
  zc: number[];
  zx: number[];
  basis: number[];
  iv: number[];
}

const scenarioCache = new Map<string, Scenario[]>();

/**
 * Scénarios de VaR : tirés une fois par partie (graine) et réutilisés chaque jour (nombres aléatoires communs) :
 * la VaR ne « saute » pas d'un jour à l'autre par simple bruit d'échantillonnage, et le calcul est bien plus rapide.
 */
function scenarios(seed: string, _day: number): Scenario[] {
  const key = seed;
  const hit = scenarioCache.get(key);
  if (hit) return hit;
  const rng = seedRng(`var:${key}`);
  const out: Scenario[] = [];
  for (let i = 0; i < VAR_SCENARIOS; i++) {
    out.push({
      fr: FREIGHT_IDS.map(() => normal(rng)),
      zc: mulLower(CHOL, CORRELATION.map(() => normal(rng))),
      zx: mulLower(CHOL, CORRELATION.map(() => normal(rng))),
      basis: Array.from({ length: 20 }, () => normal(rng)),
      iv: COMMODITY_IDS.map(() => normal(rng)),
    });
  }
  if (scenarioCache.size > 8) scenarioCache.delete(scenarioCache.keys().next().value!);
  scenarioCache.set(key, out);
  return out;
}

/** `only` : commodités du livre (les autres ne bougent pas, ce qui ne change rien à la VaR et accélère le calcul). */
function applyScenario(base: MarketState, s: Scenario, only?: Set<string>): MarketState {
  const m = cloneMarket(base, only);
  COMMODITY_IDS.forEach((c, i) => {
    if (only && !only.has(c)) return;
    const cm = m.commodities[c];
    const spec = COMMODITIES[c];
    const next = stepFactors(spec.model, cm.chi, cm.xi, VAR_DT, s.zc[i]!, s.zx[i]!, m.volMult);
    cm.chi = next.chi;
    cm.xi = next.xi;
    spec.physical.locations.forEach((l, j) => {
      cm.basisDev[l.id] = (cm.basisDev[l.id] ?? 0) + l.basisVol * Math.sqrt(VAR_DT * m.volMult) * s.basis[(i * 4 + j) % 20]!;
    });
    m.ivLevel[c] = Math.max(IV_PARAMS.min, m.ivLevel[c] + IV_PARAMS.sigma * Math.sqrt(VAR_DT) * s.iv[i]!);
  });
  m.fxLog += 0.08 * Math.sqrt(VAR_DT) * s.zc[FX_INDEX]!;
  FREIGHT_IDS.forEach((i, j) => (m.freight[i] += FREIGHT[i].sigma * m.volMult * Math.sqrt(VAR_DT) * s.fr[j]!));
  return m;
}

export interface VarResult {
  var99: number;
  es99: number;
  varBy: Record<CommodityId, number>;
  pnls: number[];
}

/** Commodités présentes dans un livre (FX et fret sont toujours choqués). */
export function bookCommodities(book: Book): Set<string> {
  const out = new Set<string>();
  for (const arr of [book.futures, book.forwards, book.inventory, book.options, book.otc, book.voyages ?? [], book.exotics ?? [], book.prepays ?? []] as { commodity: string }[][]) for (const x of arr) out.add(x.commodity);
  for (const x of book.exotics ?? []) for (const c of exoticLegs(x)) out.add(c);
  // qualités de brut : le différentiel dépend des produits raffinés, qui doivent être choqués avec le brut
  if ([...book.forwards, ...book.inventory, ...(book.voyages ?? [])].some((x) => (x as { grade?: string }).grade)) for (const p of PRODUCTS) out.add(p);
  return out;
}

/** VaR / ES 99 % à 1 jour par revalorisation complète. */
export function computeVar(state: GameState, book: Book = bookOf(state)): VarResult {
  const v0 = valueBy(state, book);
  const f0 = freightBookValue(state, book);
  const scen = scenarios(state.config.seed, state.day);
  const totals: number[] = [];
  const by: Record<CommodityId, number[]> = Object.fromEntries(COMMODITY_IDS.map((c) => [c, []])) as never;
  const empty = !book.futures.length && !book.forwards.length && !book.inventory.length && !book.options.length && !book.otc.length && !(book.voyages?.length) && !(book.ffa?.length) && !(book.exotics?.length) && !(book.prepays?.length);
  if (empty) return { var99: 0, es99: 0, varBy: Object.fromEntries(COMMODITY_IDS.map((c) => [c, 0])) as never, pnls: [] };
  const only = bookCommodities(book);
  for (const s of scen) {
    const m = applyScenario(state.market, s, only);
    const view = { market: m, day: state.day, fixings: state.fixings, freightFixings: state.freightFixings } as unknown as GameState;
    const v = valueBy(view, book);
    let t = freightBookValue(view, book) - f0;
    for (const c of COMMODITY_IDS) {
      const d = v[c] - v0[c];
      by[c].push(d);
      t += d;
    }
    totals.push(t);
  }
  const q = (arr: number[]) => {
    const sorted = [...arr].sort((a, b) => a - b);
    const k = Math.floor(sorted.length * 0.01);
    const tail = sorted.slice(0, Math.max(1, k + 1));
    return { v: Math.max(0, -sorted[k]!), es: Math.max(0, -tail.reduce((a, b) => a + b, 0) / tail.length) };
  };
  const tot = q(totals);
  const varBy = Object.fromEntries(COMMODITY_IDS.map((c) => [c, q(by[c]).v])) as Record<CommodityId, number>;
  return { var99: tot.v, es99: tot.es, varBy, pnls: totals };
}

// ------------------------------------------------------------------ stress tests

export interface StressScenario {
  id: string;
  name: string;
  desc: string;
  /** chocs de log-prix : `front` agit sur le facteur court (front de courbe), `level` sur toute la courbe */
  shocks: Partial<Record<CommodityId, { front?: number; level?: number }>>;
  fx?: number;
  ivMult?: number;
}

export const STRESS_SCENARIOS: StressScenario[] = [
  { id: 'oilcrash', name: 'Krach pétrolier', desc: 'Guerre des prix entre producteurs : Brent −35 %, contango profond, vol ×1,8.', shocks: { BRENT: { front: -0.3, level: -0.12 }, API2: { level: -0.08 } }, ivMult: 1.8 },
  { id: 'coldwinter', name: 'Hiver glacial en Europe', desc: 'Stocks de gaz au plus bas : TTF +70 %, charbon +30 %.', shocks: { TTF: { front: 0.5, level: 0.05 }, API2: { front: 0.22, level: 0.04 } }, ivMult: 1.5 },
  { id: 'chinaslow', name: 'Ralentissement chinois', desc: 'Demande industrielle en chute : cuivre −22 %, charbon −15 %, euro −5 %.', shocks: { CU: { level: -0.2, front: -0.05 }, API2: { level: -0.15 } }, fx: -0.05, ivMult: 1.3 },
  { id: 'drought', name: 'Sécheresse mondiale', desc: 'Récoltes coupées : blé +40 %, vol ×1,6.', shocks: { WHEAT: { front: 0.25, level: 0.1 } }, ivMult: 1.6 },
  { id: 'volspike', name: 'Choc de volatilité', desc: 'Prix inchangés mais vol implicite ×2 partout : test de la position en options.', shocks: {}, ivMult: 2 },
  { id: 'usd', name: 'Dollar fort', desc: 'EURUSD −10 %, matières premières −8 %.', shocks: { BRENT: { level: -0.08 }, CU: { level: -0.08 }, WHEAT: { level: -0.08 }, API2: { level: -0.08 }, TTF: { level: -0.03 } }, fx: -0.1 },
];

export function stressMarket(base: MarketState, s: StressScenario): MarketState {
  const m = cloneMarket(base);
  for (const c of COMMODITY_IDS) {
    const sh = s.shocks[c];
    if (sh?.front) m.commodities[c].chi += sh.front;
    if (sh?.level) m.commodities[c].xi += sh.level;
    if (s.ivMult) m.ivLevel[c] *= s.ivMult;
  }
  if (s.fx) m.fxLog += Math.log(1 + s.fx);
  return m;
}

export function runStress(state: GameState, book: Book = bookOf(state)): { s: StressScenario; pnl: number; by: Record<CommodityId, number> }[] {
  const v0 = valueBy(state, book);
  return STRESS_SCENARIOS.map((s) => {
    const v = valueBy({ market: stressMarket(state.market, s), day: state.day, fixings: state.fixings }, book);
    const by = Object.fromEntries(COMMODITY_IDS.map((c) => [c, v[c] - v0[c]])) as Record<CommodityId, number>;
    return { s, pnl: COMMODITY_IDS.reduce((a, c) => a + by[c], 0), by };
  });
}

// ------------------------------------------------------------------ greeks agrégés

export interface BookGreeks {
  commodity: CommodityId;
  delta1pct: number; // $ pour +1 % de toute la courbe
  deltaUnits: number; // équivalent physique au prix du front
  gamma1pct: number; // Γ·F²·0,01² : variation du delta ($ pour 1 %) quand le prix monte de 1 %
  vega: number; // $ pour +1 point de vol implicite
  theta: number; // $ par jour (options et APO, prix inchangés)
  rho: number; // $ pour +1 % de taux
}

function shifted(base: MarketState, f: (m: MarketState) => void): MarketState {
  const m = cloneMarket(base);
  f(m);
  return m;
}

export function bookGreeks(state: GameState, book: Book = bookOf(state)): BookGreeks[] {
  const v: View = state;
  const h = 0.005; // choc de log-prix : dérivées par rapport à ln F
  const v0 = valueBy(v, book);
  const inBook = bookCommodities(book);
  const vol = valueBy({ ...v, market: shifted(state.market, (m) => (m.volShift = (m.volShift ?? 0) + 0.01)) }, book);
  const rho = valueBy({ ...v, market: shifted(state.market, (m) => (m.rateShift = (m.rateShift ?? 0) + 0.01)) }, book);
  return COMMODITY_IDS.map((c) => {
    if (!inBook.has(c)) return { commodity: c, delta1pct: 0, deltaUnits: 0, gamma1pct: 0, vega: 0, theta: 0, rho: 0 };
    const up = valueBy({ ...v, market: shifted(state.market, (m) => (m.commodities[c].xi += h)) }, book)[c];
    const dn = valueBy({ ...v, market: shifted(state.market, (m) => (m.commodities[c].xi -= h)) }, book)[c];
    // V_x = dV/d lnF = F·V' ; V_xx − V_x = F²·V''
    const Vx = (up - dn) / (2 * h);
    const Vxx = (up - 2 * v0[c] + dn) / (h * h);
    const delta1pct = Vx * 0.01;
    const gamma1pct = (Vxx - Vx) * 0.0001;
    const spec = COMMODITIES[c];
    const k = spec.valuePerUnit * fx(state.market, spec.currency);
    const front = listedFront(state.market, c);
    let theta = 0;
    for (const o of book.options.filter((x) => x.commodity === c)) {
      // theta « prix inchangés » : même future, même vol, un jour de moins
      const { F, T, sigma, r } = optionInputs(state.market, o);
      const sh = spec.model.shift ?? 0;
      const p0 = vanillaPrice(F + sh, o.strike + sh, T, sigma, r, o.type, o.style);
      const p1 = vanillaPrice(F + sh, o.strike + sh, Math.max(0, T - 1 / 365), sigma, r, o.type, o.style);
      theta += (p1 - p0) * o.lots * lotQty(spec, o.month) * k;
    }
    for (const x of book.otc.filter((y) => y.commodity === c && y.kind === 'apo')) {
      theta += (apoUnitPrice(v, c, x.month, x.strike, x.type!, { timeShiftDays: 1 }) - apoUnitPrice(v, c, x.month, x.strike, x.type!)) * x.qty * k;
    }
    return {
      commodity: c,
      delta1pct,
      deltaUnits: delta1pct / (0.01 * (front + (spec.model.shift ?? 0)) * k),
      gamma1pct,
      vega: vol[c] - v0[c],
      theta,
      rho: rho[c] - v0[c],
    };
  });
}

// ------------------------------------------------------------------ échéancier

/** Delta en unités physiques par mois (futures, forwards, stocks au mois courant, options, OTC). */
export function deltaLadder(state: GameState, c: CommodityId): { month: MonthIndex; qty: number }[] {
  const spec = COMMODITIES[c];
  const map = new Map<MonthIndex, number>();
  const add = (mi: MonthIndex, q: number) => map.set(mi, (map.get(mi) ?? 0) + q);
  for (const p of state.futures.filter((x) => x.commodity === c)) add(p.month, p.lots * lotQty(spec, p.month));
  for (const d of state.forwards.filter((x) => x.commodity === c)) add(d.month, d.side * d.qty * discount(state.market, spec.currency, state.day, d.deliveryDay));
  for (const l of state.inventory.filter((x) => x.commodity === c)) add(monthIndexOf(state.day), l.qty);
  for (const o of state.options.filter((x) => x.commodity === c)) add(o.month, optionUnitGreeks(state.market, o).delta * o.lots * lotQty(spec, o.month));
  for (const x of state.otc.filter((y) => y.commodity === c)) add(x.month, otcDeltaUnits(state, x));
  return [...map.entries()].sort((a, b) => a[0] - b[0]).map(([month, qty]) => ({ month, qty }));
}
