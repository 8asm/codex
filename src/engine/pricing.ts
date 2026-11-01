/**
 * Bibliothèque de pricing d'options (fonctions pures).
 *
 *  - Black-76 : options européennes sur futures (la référence de marché pour les commodités).
 *  - Barone-Adesi & Whaley (1987) : approximation analytique des options américaines sur futures
 *    (coût de portage b = 0). Validée contre un arbre binomial CRR dans les tests.
 *  - CRR : arbre binomial pour options américaines sur futures (validation / référence).
 *  - Volatilité implicite : inversion par Newton sécurisée par bissection.
 *  - Asiatiques (APO) : approximation de Lévy / Turnbull-Wakeman par appariement des deux premiers
 *    moments de la moyenne arithmétique, avec matrice de covariance EXACTE du modèle à deux facteurs
 *    (voir `asianMoments`). Validée par Monte Carlo dans les tests.
 */
import { normCdf } from './math';

export type OptType = 'C' | 'P';

const SQRT2PI = Math.sqrt(2 * Math.PI);
export const normPdf = (x: number) => Math.exp(-0.5 * x * x) / SQRT2PI;

export interface Greeks {
  price: number;
  delta: number; // dV/dF
  gamma: number; // d²V/dF²
  vega: number; // dV/dσ pour +1 point de vol (0,01)
  theta: number; // dV pour un jour calendaire qui passe (négatif pour un acheteur)
  rho: number; // dV pour +1 % de taux
}

function intrinsic(F: number, K: number, type: OptType) {
  return type === 'C' ? Math.max(0, F - K) : Math.max(0, K - F);
}

/** Black-76 : C = e^{-rT}[F N(d1) − K N(d2)], P = e^{-rT}[K N(−d2) − F N(−d1)]. */
export function black76(F: number, K: number, T: number, sigma: number, r: number, type: OptType): number {
  const df = Math.exp(-r * Math.max(0, T));
  if (T <= 0 || sigma <= 0) return df * intrinsic(F, K, type);
  const sd = sigma * Math.sqrt(T);
  const d1 = (Math.log(F / K) + 0.5 * sd * sd) / sd;
  const d2 = d1 - sd;
  return type === 'C' ? df * (F * normCdf(d1) - K * normCdf(d2)) : df * (K * normCdf(-d2) - F * normCdf(-d1));
}

export function black76Greeks(F: number, K: number, T: number, sigma: number, r: number, type: OptType): Greeks {
  const df = Math.exp(-r * Math.max(0, T));
  if (T <= 0 || sigma <= 0) {
    const itm = type === 'C' ? F > K : F < K;
    return { price: df * intrinsic(F, K, type), delta: itm ? (type === 'C' ? df : -df) : 0, gamma: 0, vega: 0, theta: 0, rho: 0 };
  }
  const sqT = Math.sqrt(T);
  const sd = sigma * sqT;
  const d1 = (Math.log(F / K) + 0.5 * sd * sd) / sd;
  const price = black76(F, K, T, sigma, r, type);
  const delta = type === 'C' ? df * normCdf(d1) : -df * normCdf(-d1);
  const gamma = (df * normPdf(d1)) / (F * sd);
  const vegaUnit = df * F * normPdf(d1) * sqT; // par 1,00 de vol
  // dV/dT (T = maturité restante) ; theta = −dV/dT × 1 jour
  const dVdT = (df * F * normPdf(d1) * sigma) / (2 * sqT) - r * price;
  return { price, delta, gamma, vega: vegaUnit * 0.01, theta: -dVdT / 365, rho: -T * price * 0.01 };
}

/**
 * Arbre binomial de Cox-Ross-Rubinstein pour une option américaine sur future.
 * Sous la mesure risque-neutre un future ne dérive pas : p = (1 − d) / (u − d).
 */
export function crrAmerican(F: number, K: number, T: number, sigma: number, r: number, type: OptType, steps = 500): number {
  if (T <= 0) return intrinsic(F, K, type);
  const dt = T / steps;
  const u = Math.exp(sigma * Math.sqrt(dt));
  const d = 1 / u;
  const p = (1 - d) / (u - d);
  const disc = Math.exp(-r * dt);
  const v = new Float64Array(steps + 1);
  for (let i = 0; i <= steps; i++) v[i] = intrinsic(F * u ** (steps - 2 * i), K, type);
  for (let n = steps - 1; n >= 0; n--) {
    for (let i = 0; i <= n; i++) {
      const cont = disc * (p * v[i]! + (1 - p) * v[i + 1]!);
      v[i] = Math.max(cont, intrinsic(F * u ** (n - 2 * i), K, type));
    }
  }
  return v[0]!;
}

/**
 * Barone-Adesi & Whaley pour option américaine sur future (b = 0).
 * Le prix critique S* (resp. S**) ne dépend pas du prix courant : on le résout par Newton.
 */
export function bawAmerican(F: number, K: number, T: number, sigma: number, r: number, type: OptType): number {
  const euro = black76(F, K, T, sigma, r, type);
  if (T <= 0 || sigma <= 0 || r <= 0) return Math.max(euro, intrinsic(F, K, type));
  const s2 = sigma * sigma;
  const M = (2 * r) / s2;
  const Kp = 1 - Math.exp(-r * T);
  const eb = Math.exp(-r * T); // e^{(b−r)T} avec b = 0
  const sqT = Math.sqrt(T);
  const d1 = (S: number) => (Math.log(S / K) + 0.5 * s2 * T) / (sigma * sqT);
  if (type === 'C') {
    const q2 = (1 + Math.sqrt(1 + (4 * M) / Kp)) / 2;
    // seed de Haug
    const qInf = (1 + Math.sqrt(1 + 4 * M)) / 2;
    const sInf = K / (1 - 1 / qInf);
    const h2 = -(0 * T + 2 * sigma * sqT) * (K / (sInf - K));
    let S = K + (sInf - K) * (1 - Math.exp(h2));
    for (let i = 0; i < 40; i++) {
      const c = black76(S, K, T, sigma, r, 'C');
      const nd1 = normCdf(d1(S));
      const lhs = S - K;
      const rhs = c + ((1 - eb * nd1) * S) / q2;
      const bi = eb * nd1 * (1 - 1 / q2) + (1 - (eb * normPdf(d1(S))) / (sigma * sqT)) / q2;
      const next = (K + rhs - bi * S) / (1 - bi);
      if (!Number.isFinite(next) || next <= K) { S = K * 1.0001; break; }
      if (Math.abs(lhs - rhs) / K < 1e-9) break;
      S = next;
    }
    if (F >= S) return F - K;
    const A2 = (S / q2) * (1 - eb * normCdf(d1(S)));
    return euro + A2 * (F / S) ** q2;
  }
  const q1 = (1 - Math.sqrt(1 + (4 * M) / Kp)) / 2;
  const qInf = (1 - Math.sqrt(1 + 4 * M)) / 2;
  const sInf = K / (1 - 1 / qInf);
  const h1 = (0 * T - 2 * sigma * sqT) * (K / (K - sInf));
  let S = sInf + (K - sInf) * Math.exp(h1);
  for (let i = 0; i < 40; i++) {
    const p = black76(S, K, T, sigma, r, 'P');
    const nmd1 = normCdf(-d1(S));
    const lhs = K - S;
    const rhs = p - ((1 - eb * nmd1) * S) / q1;
    const bi = -eb * nmd1 * (1 - 1 / q1) - (1 + (eb * normPdf(-d1(S))) / (sigma * sqT)) / q1;
    const next = (K - rhs + bi * S) / (1 + bi);
    if (!Number.isFinite(next) || next <= 0 || next >= K) { S = K * 0.9999; break; }
    if (Math.abs(lhs - rhs) / K < 1e-9) break;
    S = next;
  }
  if (F <= S) return K - F;
  const A1 = -(S / q1) * (1 - eb * normCdf(-d1(S)));
  return euro + A1 * (F / S) ** q1;
}

/** Prix d'une option vanille sur future selon son style. */
export function vanillaPrice(F: number, K: number, T: number, sigma: number, r: number, type: OptType, style: 'A' | 'E'): number {
  return style === 'A' ? bawAmerican(F, K, T, sigma, r, type) : black76(F, K, T, sigma, r, type);
}

/** Greeks d'une vanille : analytiques en européen, différences finies sur BAW en américain. */
export function vanillaGreeks(F: number, K: number, T: number, sigma: number, r: number, type: OptType, style: 'A' | 'E'): Greeks {
  if (style === 'E') return black76Greeks(F, K, T, sigma, r, type);
  const p = (f = F, t = T, s = sigma, rr = r) => bawAmerican(f, K, t, s, rr, type);
  const h = F * 1e-3;
  const v0 = p();
  const up = p(F + h);
  const dn = p(F - h);
  const day = 1 / 365;
  return {
    price: v0,
    delta: (up - dn) / (2 * h),
    gamma: (up - 2 * v0 + dn) / (h * h),
    vega: p(F, T, sigma + 0.01) - v0,
    theta: T > day ? p(F, T - day) - v0 : intrinsic(F, K, type) - v0,
    rho: p(F, T, sigma, r + 0.01) - v0,
  };
}

/** Vol implicite Black-76 (Newton + bissection de secours). */
export function impliedVol(price: number, F: number, K: number, T: number, r: number, type: OptType): number {
  const df = Math.exp(-r * T);
  const lo0 = df * intrinsic(F, K, type);
  if (price <= lo0 + 1e-12) return 0;
  let lo = 1e-4, hi = 5, s = 0.3;
  for (let i = 0; i < 100; i++) {
    const g = black76Greeks(F, K, T, s, r, type);
    const diff = g.price - price;
    if (Math.abs(diff) < 1e-10 * Math.max(1, price)) return s;
    if (diff > 0) hi = s;
    else lo = s;
    const vega = g.vega * 100;
    let next = vega > 1e-12 ? s - diff / vega : (lo + hi) / 2;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    s = next;
  }
  return s;
}

// ------------------------------------------------------------------ asiatiques

/**
 * Moments de la moyenne arithmétique A = (1/n) Σ F_i des fixings restants (n = nombre TOTAL de fixings,
 * y compris passés ; seuls les fixings futurs sont aléatoires) :
 *   M1 = (1/n) Σ F_i ,   M2 = (1/n²) Σ_i Σ_j F_i F_j exp(C_ij)
 * où C_ij = Cov(ln F_i(t_i), ln F_j(t_j)).
 */
export function asianMoments(fwds: number[], cov: number[][], nTotal: number): { M1: number; M2: number } {
  let s1 = 0, s2 = 0;
  for (let i = 0; i < fwds.length; i++) {
    s1 += fwds[i]!;
    for (let j = 0; j < fwds.length; j++) s2 += fwds[i]! * fwds[j]! * Math.exp(cov[i]![j]!);
  }
  return { M1: s1 / nTotal, M2: s2 / (nTotal * nTotal) };
}

/**
 * Prix d'une option sur moyenne : la partie aléatoire B (moments M1, M2) est approximée par une
 * lognormale de même moyenne et variance (Lévy). `pastSum` = somme des fixings déjà connus.
 * Paiement max(B + pastSum/n − K, 0) actualisé par `df`.
 */
export function asianPrice(M1: number, M2: number, K: number, pastSum: number, nTotal: number, df: number, type: OptType): number {
  const Kadj = K - pastSum / nTotal;
  if (M1 <= 0) return df * intrinsic(0, Kadj, type);
  if (Kadj <= 0) return type === 'C' ? df * (M1 - Kadj) : 0;
  const v = Math.max(0, Math.log(M2 / (M1 * M1)));
  // Black avec F = M1, σ²T = v (T = 1 conventionnel), sans actualisation interne
  return df * black76(M1, Kadj, 1, Math.sqrt(v), 0, type);
}
