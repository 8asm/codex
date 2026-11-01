import { describe, expect, it } from 'vitest';
import { COMMODITIES } from '../../data/commodities';
import { dayFromYMD } from '../calendar';
import { fixingCovariance, forwardVol, integratedVariance, lnForward, seasonal, stepFactors } from '../model';
import {
  asianMoments, asianPrice, bawAmerican, black76, black76Greeks, crrAmerican, impliedVol, vanillaGreeks,
} from '../pricing';
import { normal, seedRng } from '../rng';

describe('Black-76', () => {
  it('valeur de référence (Haug, ex. 1.3.2 : F=19, K=19, T=0.75, r=10 %, σ=28 % → put 1,7011)', () => {
    expect(black76(19, 19, 0.75, 0.28, 0.1, 'P')).toBeCloseTo(1.7011, 3);
  });
  it('parité call-put : C − P = e^{-rT}(F − K)', () => {
    const F = 82, K = 75, T = 0.4, s = 0.35, r = 0.04;
    expect(black76(F, K, T, s, r, 'C') - black76(F, K, T, s, r, 'P')).toBeCloseTo(Math.exp(-r * T) * (F - K), 10);
  });
  it('greeks analytiques = différences finies', () => {
    const F = 9300, K = 9500, T = 0.3, s = 0.22, r = 0.04;
    const g = black76Greeks(F, K, T, s, r, 'C');
    const h = 1;
    const p = (f: number, t = T, sg = s, rr = r) => black76(f, K, t, sg, rr, 'C');
    expect(g.delta).toBeCloseTo((p(F + h) - p(F - h)) / (2 * h), 5);
    expect(g.gamma).toBeCloseTo((p(F + h) - 2 * p(F) + p(F - h)) / (h * h), 6);
    expect(g.vega).toBeCloseTo((p(F, T, s + 1e-4) - p(F, T, s - 1e-4)) / 2e-4 * 0.01, 4);
    expect(g.theta).toBeCloseTo((p(F, T - 1e-5) - p(F, T + 1e-5)) / 2e-5 / 365, 4);
    expect(g.rho).toBeCloseTo((p(F, T, s, r + 1e-5) - p(F, T, s, r - 1e-5)) / 2e-5 * 0.01, 5);
  });
  it('vol implicite : aller-retour', () => {
    for (const [K, type] of [[60, 'P'], [80, 'C'], [100, 'C']] as const) {
      const p = black76(80, K, 0.5, 0.41, 0.04, type);
      expect(impliedVol(p, 80, K, 0.5, 0.04, type)).toBeCloseTo(0.41, 6);
    }
  });
});

describe('options américaines sur futures', () => {
  const cases: [number, number, number, number, number, 'C' | 'P'][] = [
    [100, 100, 0.5, 0.3, 0.08, 'P'],
    [100, 90, 1, 0.25, 0.08, 'C'],
    [80, 100, 0.75, 0.4, 0.05, 'P'],
    [120, 100, 2, 0.35, 0.1, 'C'],
    [100, 110, 0.25, 0.2, 0.04, 'P'],
  ];
  it('BAW ≈ arbre binomial CRR (erreur connue de BAW : < 1,5 % ; < 0,5 % aux taux du jeu)', () => {
    for (const [F, K, T, s, r, type] of cases) {
      const baw = bawAmerican(F, K, T, s, r, type);
      const crr = crrAmerican(F, K, T, s, r, type, 2000);
      expect(Math.abs(baw - crr)).toBeLessThan(Math.max((r <= 0.05 ? 0.005 : 0.015) * crr, 0.01));
    }
  });
  it('américaine ≥ européenne et ≥ valeur intrinsèque', () => {
    for (const [F, K, T, s, r, type] of cases) {
      const a = bawAmerican(F, K, T, s, r, type);
      expect(a).toBeGreaterThanOrEqual(black76(F, K, T, s, r, type) - 1e-12);
      expect(a).toBeGreaterThanOrEqual((type === 'C' ? F - K : K - F) - 1e-12);
    }
  });
  it('greeks américains cohérents (delta call ∈ [0,1], gamma > 0)', () => {
    const g = vanillaGreeks(78, 80, 0.3, 0.33, 0.04, 'C', 'A');
    expect(g.delta).toBeGreaterThan(0);
    expect(g.delta).toBeLessThan(1);
    expect(g.gamma).toBeGreaterThan(0);
    expect(g.vega).toBeGreaterThan(0);
    expect(g.theta).toBeLessThan(0);
  });
});

describe('structure par terme de la vol (modèle)', () => {
  const p = COMMODITIES.BRENT.model;
  it('variance intégrée = intégrale numérique de σ_F²', () => {
    const tc = 0.6, te = 0.45;
    let num = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) num += forwardVol(p, tc - (i + 0.5) * (te / n)) ** 2 * (te / n);
    expect(integratedVariance(p, tc, te)).toBeCloseTo(num, 7);
  });
  it('covariance de fixings : diagonale = variance intégrée du spot', () => {
    expect(fixingCovariance(p, 0.3, 0.3)).toBeCloseTo(integratedVariance(p, 0.3, 0.3), 10);
  });
});

describe('options asiatiques (Lévy, covariance exacte 2 facteurs) vs Monte Carlo', () => {
  it('APO call et put à la monnaie, moyenne mensuelle du spot', () => {
    const p = { ...COMMODITIES.BRENT.model, seasonalAmp: 0 };
    const today = dayFromYMD(2027, 3, 1);
    const fixDays: number[] = [];
    for (let d = dayFromYMD(2027, 5, 3); d <= dayFromYMD(2027, 5, 28); d++) if (((d + 4) % 7 + 7) % 7 % 6 !== 0) fixDays.push(d);
    const chi0 = 0.05, xi0 = Math.log(78);
    const ts = fixDays.map((d) => (d - today) / 365);
    const fwds = ts.map((t, i) => Math.exp(lnForward(p, chi0, xi0, t, fixDays[i]!)));
    const cov = ts.map((a) => ts.map((b) => fixingCovariance(p, a, b)));
    const { M1, M2 } = asianMoments(fwds, cov, fwds.length);
    const K = M1;
    const df = Math.exp(-0.04 * ts[ts.length - 1]!);
    const call = asianPrice(M1, M2, K, 0, fwds.length, df, 'C');
    const put = asianPrice(M1, M2, K, 0, fwds.length, df, 'P');
    // Monte Carlo exact sur le modèle
    const rng = seedRng('apo');
    const N = 40_000;
    let sc = 0, sp = 0, sc2 = 0;
    for (let k = 0; k < N; k++) {
      let chi = chi0, xi = xi0, t = 0, sum = 0;
      for (const ti of ts) {
        const s = stepFactors(p, chi, xi, ti - t, normal(rng), normal(rng));
        chi = s.chi; xi = s.xi; t = ti;
        sum += Math.exp(chi + xi + seasonal(p, 0));
      }
      const A = sum / ts.length;
      const c = Math.max(0, A - K) * df;
      sc += c; sc2 += c * c;
      sp += Math.max(0, K - A) * df;
    }
    const mcC = sc / N, mcP = sp / N;
    const se = Math.sqrt(sc2 / N - mcC * mcC) / Math.sqrt(N);
    expect(Math.abs(call - mcC)).toBeLessThan(4 * se + 0.01 * mcC);
    expect(Math.abs(put - mcP)).toBeLessThan(4 * se + 0.01 * mcP);
    // parité : C − P = df (M1 − K)
    expect(call - put).toBeCloseTo(df * (M1 - K), 8);
  });
  it('fixings passés : strike ajusté, option déjà dans la monnaie => valeur forward', () => {
    expect(asianPrice(80, 6400.5, 50, 20 * 90, 21, 1, 'C')).toBeCloseTo(80 - (50 - (20 * 90) / 21), 8);
  });
});
