/**
 * État de marché : facteurs Schwartz-Smith par commodité, différentiels physiques (basis), EURUSD,
 * régime de volatilité. Fournit les prix de courbe utilisés partout (futures, forwards, spot).
 */
import { COMMODITIES, COMMODITY_IDS, CORRELATION, RATES } from '../data/commodities';
import type { Day, MonthIndex } from './calendar';
import { yearFrac } from './calendar';
import { pricingDay } from './contracts';
import { cholesky, mulLower } from './math';
import { forwardVol, lnForward, stepFactors } from './model';
import { chance, normal, type RngState } from './rng';
import type { CommodityId, CommodityMarket, Currency, MarketState } from './types';

const CHOL = cholesky(CORRELATION);
export const FX_PARAMS = { mean: Math.log(1.08), kappa: 0.5, sigma: 0.08 };
/** Retour à la moyenne des différentiels physiques (1/an). */
const BASIS_KAPPA = 4;
/** Paramètres de marge : quantile 99 % sur 3 jours calendaires (≈ 2 jours ouvrés, période de liquidation). */
export const IM_Z = 2.326;
export const IM_HORIZON = 3 / 365;
const STRESS_MULT = 1.8;

export function createMarket(startDay: Day, volatility = 1): MarketState {
  const commodities = {} as Record<CommodityId, CommodityMarket>;
  for (const id of COMMODITY_IDS) {
    const p = COMMODITIES[id].model;
    const basisDev: Record<string, number> = {};
    for (const l of COMMODITIES[id].physical.locations) basisDev[l.id] = 0;
    commodities[id] = {
      chi: p.chi0,
      xi: Math.log(p.s0) - p.chi0,
      basisDev,
      imRate: 0,
    };
  }
  const m: MarketState = {
    day: startDay,
    volRegime: 'calm',
    volMult: volatility,
    fxLog: FX_PARAMS.mean,
    commodities,
    history: [],
  };
  for (const id of COMMODITY_IDS) m.commodities[id].imRate = exchangeImRate(m, id);
  snapshot(m);
  return m;
}

export function baseVolMult(m: MarketState, volatility: number): number {
  return volatility * (m.volRegime === 'stressed' ? STRESS_MULT : 1);
}

function snapshot(m: MarketState) {
  const f = {} as Record<CommodityId, [number, number]>;
  for (const id of COMMODITY_IDS) f[id] = [m.commodities[id].chi, m.commodities[id].xi];
  m.history.push({ day: m.day, f, fxLog: m.fxLog, volMult: m.volMult });
  if (m.history.length > 320) m.history.shift();
}

/** Prix forward de la commodité pour une date de livraison (unité de cotation). */
export function forwardAt(m: MarketState, c: CommodityId, deliveryDay: Day, asOf: Day = m.day, chi?: number, xi?: number, volMult?: number): number {
  const p = COMMODITIES[c].model;
  const cm = m.commodities[c];
  return Math.exp(lnForward(p, chi ?? cm.chi, xi ?? cm.xi, yearFrac(asOf, deliveryDay), deliveryDay, volMult ?? m.volMult));
}

export function futuresPrice(m: MarketState, c: CommodityId, mi: MonthIndex): number {
  return forwardAt(m, c, pricingDay(COMMODITIES[c], mi));
}

export function spotPrice(m: MarketState, c: CommodityId): number {
  return forwardAt(m, c, m.day);
}

export function basis(m: MarketState, c: CommodityId, locationId: string): number {
  const loc = COMMODITIES[c].physical.locations.find((l) => l.id === locationId)!;
  return loc.basisMean + (m.commodities[c].basisDev[locationId] ?? 0);
}

/** USD par unité de devise. */
export function fx(m: MarketState, ccy: Currency): number {
  return ccy === 'USD' ? 1 : Math.exp(m.fxLog);
}

export function discount(ccy: Currency, from: Day, to: Day): number {
  return Math.exp(-RATES[ccy] * Math.max(0, yearFrac(from, to)));
}

/** Vol (annuelle) du log-prix d'une échéance. */
export function contractVol(m: MarketState, c: CommodityId, mi: MonthIndex): number {
  return forwardVol(COMMODITIES[c].model, yearFrac(m.day, pricingDay(COMMODITIES[c], mi)), m.volMult);
}

/**
 * Taux de marge initiale « bourse » : quantile 99 % de la perte sur l'horizon de liquidation,
 * calculé sur la vol du front (la plus forte de la courbe), arrondi au 0,1 % supérieur.
 */
export function exchangeImRate(m: MarketState, c: CommodityId): number {
  const sigma = forwardVol(COMMODITIES[c].model, 1 / 12, m.volMult);
  const raw = IM_Z * sigma * Math.sqrt(IM_HORIZON);
  return Math.ceil(raw * 1000) / 1000;
}

export interface MarketMoveInfo {
  regimeChanged: null | 'calm' | 'stressed';
}

/**
 * Fait évoluer le marché de `m.day` à `toDay` (pas exact sur dt = jours calendaires / 365).
 * Les week-ends portent donc ~3 jours de variance, comme dans la réalité.
 */
export function stepMarket(m: MarketState, rng: RngState, toDay: Day, volatility: number, crisisFreq: number): MarketMoveInfo {
  const dt = yearFrac(m.day, toDay);
  const info: MarketMoveInfo = { regimeChanged: null };

  // Régime de volatilité (chaîne de Markov à deux états).
  if (m.volRegime === 'calm' && chance(rng, 0.006 * crisisFreq)) {
    m.volRegime = 'stressed';
    info.regimeChanged = 'stressed';
  } else if (m.volRegime === 'stressed' && chance(rng, 0.04)) {
    m.volRegime = 'calm';
    info.regimeChanged = 'calm';
  }
  m.volMult = baseVolMult(m, volatility);

  // Chocs corrélés : 5 facteurs courts + FX, puis bruits idiosyncratiques des facteurs longs.
  const zCorr = mulLower(CHOL, CORRELATION.map(() => normal(rng)));
  const zLong = mulLower(CHOL, CORRELATION.map(() => normal(rng)));
  COMMODITY_IDS.forEach((id, i) => {
    const cm = m.commodities[id];
    const p = COMMODITIES[id].model;
    const next = stepFactors(p, cm.chi, cm.xi, dt, zCorr[i]!, zLong[i]!, m.volMult);
    cm.chi = next.chi;
    cm.xi = next.xi;
    // Différentiels physiques : OU autour de leur moyenne.
    for (const loc of COMMODITIES[id].physical.locations) {
      const dev = cm.basisDev[loc.id] ?? 0;
      const sd = loc.basisVol * Math.sqrt((1 - Math.exp(-2 * BASIS_KAPPA * dt)) / (2 * BASIS_KAPPA));
      cm.basisDev[loc.id] = dev * Math.exp(-BASIS_KAPPA * dt) + sd * Math.sqrt(m.volMult) * normal(rng);
    }
  });
  // EURUSD : OU sur le log.
  const fxSd = FX_PARAMS.sigma * Math.sqrt((1 - Math.exp(-2 * FX_PARAMS.kappa * dt)) / (2 * FX_PARAMS.kappa));
  m.fxLog = FX_PARAMS.mean + (m.fxLog - FX_PARAMS.mean) * Math.exp(-FX_PARAMS.kappa * dt) + fxSd * zCorr[5]!;

  m.day = toDay;
  snapshot(m);
  return info;
}

/** Courbe forward à une date passée (recalculée depuis l'historique des facteurs), pour comparaison. */
export function pastCurve(m: MarketState, c: CommodityId, daysAgo: number, months: MonthIndex[]): number[] | null {
  const target = m.day - daysAgo;
  const snap = [...m.history].reverse().find((h) => h.day <= target);
  if (!snap) return null;
  const [chi, xi] = snap.f[c];
  return months.map((mi) => forwardAt(m, c, pricingDay(COMMODITIES[c], mi), snap.day, chi, xi, snap.volMult));
}
