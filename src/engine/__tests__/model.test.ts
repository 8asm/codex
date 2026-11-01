import { describe, expect, it } from 'vitest';
import { COMMODITIES, CORRELATION } from '../../data/commodities';
import { dayFromYMD } from '../calendar';
import { cholesky, normCdf } from '../math';
import { A, forwardVol, lnForward, stepFactors } from '../model';
import { normal, seedRng } from '../rng';

const p = COMMODITIES.BRENT.model;

describe('Schwartz-Smith', () => {
  it('F(t,t) = spot', () => {
    const d = dayFromYMD(2027, 1, 4);
    expect(lnForward(p, 0.1, 4.2, 0, d)).toBeCloseTo(0.1 + 4.2 + (lnForward(p, 0, 0, 0, d) ?? 0), 12);
    expect(A(p, 0)).toBe(0);
  });

  it('χ > 0 => backwardation, χ < 0 => contango (hors saisonnalité)', () => {
    const q = { ...p, seasonalAmp: 0, longDrift: 0 };
    const d = dayFromYMD(2027, 6, 1);
    const front = (chi: number) => lnForward(q, chi, 4.3, 0.1, d);
    const back = (chi: number) => lnForward(q, chi, 4.3, 2, d);
    expect(front(0.2)).toBeGreaterThan(back(0.2));
    expect(front(-0.2)).toBeLessThan(back(-0.2));
  });

  it('effet Samuelson : la vol décroît avec la maturité vers σξ', () => {
    expect(forwardVol(p, 0.05)).toBeGreaterThan(forwardVol(p, 1));
    expect(forwardVol(p, 50)).toBeCloseTo(p.sigmaXi, 6);
  });

  it('martingale : E[F(t+dt,T)] = F(t,T) sous la mesure de simulation', () => {
    const rng = seedRng('mart');
    const d = dayFromYMD(2027, 9, 15);
    const tau = 0.75;
    const dt = 10 / 365;
    const chi0 = 0.08, xi0 = Math.log(80);
    const f0 = Math.exp(lnForward(p, chi0, xi0, tau, d));
    let sum = 0;
    const N = 200_000;
    for (let i = 0; i < N; i++) {
      const s = stepFactors(p, chi0, xi0, dt, normal(rng), normal(rng));
      sum += Math.exp(lnForward(p, s.chi, s.xi, tau - dt, d));
    }
    const mean = sum / N;
    const se = (f0 * forwardVol(p, tau) * Math.sqrt(dt)) / Math.sqrt(N);
    expect(Math.abs(mean - f0)).toBeLessThan(4 * se);
  });

  it('variance du pas exact = variance théorique du log-futures', () => {
    const rng = seedRng('var');
    const dt = 30 / 365;
    const tau = 0.5;
    const d = dayFromYMD(2027, 12, 15);
    const xs: number[] = [];
    for (let i = 0; i < 100_000; i++) {
      const s = stepFactors(p, 0, 4.3, dt, normal(rng), normal(rng));
      xs.push(lnForward(p, s.chi, s.xi, tau - dt, d));
    }
    const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
    const v = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length;
    // ∫ σ_F(τ-s)² ds sur [0, dt]
    let th = 0;
    const n = 200;
    for (let k = 0; k < n; k++) th += forwardVol(p, tau - (k + 0.5) * (dt / n)) ** 2 * (dt / n);
    expect(v / th).toBeGreaterThan(0.97);
    expect(v / th).toBeLessThan(1.03);
  });
});

describe('outils', () => {
  it('matrice de corrélation définie positive', () => {
    const L = cholesky(CORRELATION);
    expect(L[5]![5]).toBeGreaterThan(0);
  });
  it('normCdf', () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(2.326)).toBeCloseTo(0.99, 3);
  });
});
