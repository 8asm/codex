/**
 * Phase 7 — Options exotiques de gré à gré sur futures.
 *
 * Toutes les formules sont fermées (ou quasi : quadrature numérique), ce qui permet la revalorisation
 * complète en VaR. Un Monte Carlo sur la dynamique EXACTE du modèle à deux facteurs sert de contrôle
 * (tests, et « contrôle MC » dans le ticket de l'interface).
 *
 * Volatilité : le future d'une échéance donnée a une vol déterministe dépendant du temps (effet Samuelson).
 * Pour une option dépendante du chemin sur UN future, ln F est un mouvement brownien changé de temps :
 * barrières et lookbacks continus se valorisent exactement avec la formule à vol constante appliquée à la
 * variance TOTALE v = ∫σ²(s)ds (le minimum/maximum est invariant par changement de temps monotone).
 * Simplification (DESIGN_NOTES) : on utilise la vol ATM du modèle × niveau de vol implicite, sans smile,
 * sauf pour la digitale, répliquée par un call-spread serré sur la surface avec smile (prix cohérent avec
 * les vanilles cotées).
 *
 * Surveillance discrète (une fois par jour, à la clôture) : correction de Broadie-Glasserman-Kou,
 * décalage de la barrière (ou de l'extrême) d'un facteur e^{±0,5826 σ √Δt}.
 */
import { COMMODITIES, CORRELATION, COMMODITY_IDS, FX_INDEX } from '../data/commodities';
import { COUNTERPARTIES } from '../data/counterparties';
import { addBusinessDays, nextBusinessDay, yearFrac, type Day, type MonthIndex } from './calendar';
import { optionExpiry } from './contracts';
import type { View } from './derivatives';
import { SPREAD_BY_ID } from '../data/spreads';
import { addCash, log, newId } from './ledger';
import { FX_PARAMS, futuresPrice, fx, priceShift, zeroRate } from './market';
import { normCdf, roundTo } from './math';
import { integratedVariance, lnForward, stepFactors } from './model';
import { black76 } from './pricing';
import { normal, seedRng } from './rng';
import type { ActionResult, CommodityId, Currency, ExoticPosition, ExoticSpec, GameState, MarketState, OptType } from './types';
import { atmVol, impliedVolAt } from './volsurface';
import { pricingDay } from './contracts';

export const BGK_BETA = 0.5826;
const DT_DAY = 1 / 252;

// ------------------------------------------------------------------ outils numériques

const GL_X = [
  [-0.9324695142031522, -0.6612093864662647, -0.238619186083197],
  [-0.9815606342467191, -0.904117256370475, -0.769902674194305, -0.5873179542866171, -0.3678314989981802, -0.1252334085114692],
  [-0.9931285991850949, -0.9639719272779138, -0.9122344282513259, -0.8391169718222188, -0.7463319064601508, -0.636053680726515, -0.5108670019508271, -0.3737060887154196, -0.2277858511416451, -0.07652652113349733],
];
const GL_W = [
  [0.1713244923791705, 0.3607615730481384, 0.4679139345726904],
  [0.04717533638651177, 0.1069393259953183, 0.1600783285433464, 0.2031674267230659, 0.2334925365383547, 0.2491470458134029],
  [0.01761400713915212, 0.04060142980038694, 0.06267204833410906, 0.08327674157670475, 0.1019301198172404, 0.1181945319615184, 0.1316886384491766, 0.1420961093183821, 0.1491729864726037, 0.1527533871307259],
];

/** P(X > h, Y > k) pour un couple normal standard de corrélation r (algorithme de Genz, précision ~1e-15). */
function bvnUpper(h: number, k: number, r: number): number {
  const twopi = 2 * Math.PI;
  const ng = Math.abs(r) < 0.3 ? 0 : Math.abs(r) < 0.75 ? 1 : 2;
  const x = GL_X[ng]!, w = GL_W[ng]!;
  let hk = h * k;
  let bvn = 0;
  if (Math.abs(r) < 0.925) {
    const hs = (h * h + k * k) / 2;
    const asr = Math.asin(r);
    for (let i = 0; i < x.length; i++) {
      let sn = Math.sin((asr * (1 + x[i]!)) / 2);
      bvn += w[i]! * Math.exp((sn * hk - hs) / (1 - sn * sn));
      sn = Math.sin((asr * (1 - x[i]!)) / 2);
      bvn += w[i]! * Math.exp((sn * hk - hs) / (1 - sn * sn));
    }
    return (bvn * asr) / (2 * twopi) + normCdf(-h) * normCdf(-k);
  }
  if (r < 0) {
    k = -k;
    hk = -hk;
  }
  if (Math.abs(r) < 1) {
    const as = (1 - r) * (1 + r);
    let a = Math.sqrt(as);
    const bs = (h - k) ** 2;
    const c = (4 - hk) / 8;
    const d = (12 - hk) / 16;
    bvn = a * Math.exp(-(bs / as + hk) / 2) * (1 - (c * (bs - as) * (1 - (d * bs) / 5)) / 3 + (c * d * as * as) / 5);
    if (hk > -160) {
      const b = Math.sqrt(bs);
      bvn -= Math.exp(-hk / 2) * Math.sqrt(twopi) * normCdf(-b / a) * b * (1 - (c * bs * (1 - (d * bs) / 5)) / 3);
    }
    a /= 2;
    for (let i = 0; i < x.length; i++) {
      for (const sg of [1, -1]) {
        const xs = (a * (sg * x[i]! + 1)) ** 2;
        const rs = Math.sqrt(1 - xs);
        const e = -(bs / xs + hk) / 2;
        if (e > -100) bvn += a * w[i]! * Math.exp(e) * (Math.exp((-hk * (1 - rs)) / (2 * (1 + rs))) / rs - (1 + c * xs * (1 + d * xs)));
      }
    }
    bvn = -bvn / twopi;
  }
  if (r > 0) return bvn + normCdf(-Math.max(h, k));
  bvn = -bvn;
  if (k > h) bvn += h < 0 ? normCdf(k) - normCdf(h) : normCdf(-h) - normCdf(-k);
  return bvn;
}

/** Fonction de répartition normale bivariée M(a, b ; ρ) = P(X < a, Y < b). */
export function bvnCdf(a: number, b: number, rho: number): number {
  return Math.max(0, Math.min(1, bvnUpper(-a, -b, rho)));
}

/** Simpson composite. */
function simpson(f: (x: number) => number, a: number, b: number, n = 400): number {
  if (b <= a) return 0;
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

// ------------------------------------------------------------------ formules fermées (b = 0 : options sur futures)

/**
 * Barrière continue sur future (Reiner-Rubinstein, coût de portage b = 0, sans rebate).
 * `v` : variance totale du log-prix jusqu'à l'échéance, `df` : facteur d'actualisation.
 */
export function barrierPrice(F: number, K: number, H: number, v: number, df: number, type: OptType, bt: ExoticSpec['barrierType']): number {
  const up = bt === 'up-out' || bt === 'up-in';
  const out = bt === 'up-out' || bt === 'down-out';
  const vanilla = df * Math.max(0, type === 'C' ? F - K : K - F);
  if (v <= 1e-12) {
    const crossed = up ? F >= H : F <= H;
    return out ? (crossed ? 0 : vanilla) : crossed ? vanilla : 0;
  }
  if (up ? F >= H : F <= H) return out ? 0 : black(F, K, v, df, type);
  const s = Math.sqrt(v);
  const phi = type === 'C' ? 1 : -1;
  const eta = up ? -1 : 1;
  // μ = (b − σ²/2)/σ² = −1/2 ⇒ (H/F)^{2(μ+1)} = H/F et (H/F)^{2μ} = F/H
  const x1 = Math.log(F / K) / s + 0.5 * s;
  const x2 = Math.log(F / H) / s + 0.5 * s;
  const y1 = Math.log((H * H) / (F * K)) / s + 0.5 * s;
  const y2 = Math.log(H / F) / s + 0.5 * s;
  const A = phi * F * df * normCdf(phi * x1) - phi * K * df * normCdf(phi * (x1 - s));
  const B = phi * F * df * normCdf(phi * x2) - phi * K * df * normCdf(phi * (x2 - s));
  const C = phi * F * df * (H / F) * normCdf(eta * y1) - phi * K * df * (F / H) * normCdf(eta * (y1 - s));
  const D = phi * F * df * (H / F) * normCdf(eta * y2) - phi * K * df * (F / H) * normCdf(eta * (y2 - s));
  const KH = K > H;
  let p: number;
  if (type === 'C') {
    if (bt === 'down-in') p = KH ? C : A - B + D;
    else if (bt === 'up-in') p = KH ? A : B - C + D;
    else if (bt === 'down-out') p = KH ? A - C : B - D;
    else p = KH ? 0 : A - B + C - D;
  } else {
    if (bt === 'down-in') p = KH ? B - C + D : A;
    else if (bt === 'up-in') p = KH ? A - B + D : C;
    else if (bt === 'down-out') p = KH ? A - B + C - D : 0;
    else p = KH ? B - D : A - C;
  }
  return Math.max(0, p);
}

/** Black-76 exprimé en variance totale. */
function black(F: number, K: number, v: number, df: number, type: OptType): number {
  return v > 0 ? black76(F, K, 1, Math.sqrt(v), 0, type) * df : df * Math.max(0, type === 'C' ? F - K : K - F);
}

/**
 * E[min(m0, min_{s≤T} F_s)] pour un future martingale log-normal de variance totale v (quadrature).
 * Changement de temps : ln(F/F0) = −u/2 + B_u, u ∈ [0, v] ; P(min ≥ y) = N((−y − v/2)/√v) − e^{−y} N((y − v/2)/√v).
 */
export function expectedMin(F: number, m0: number, v: number): number {
  const m = Math.min(m0, F);
  if (v <= 1e-12) return m;
  const s = Math.sqrt(v);
  const G = (y: number) => 1 - (normCdf((-y - v / 2) / s) - Math.exp(-y) * normCdf((y - v / 2) / s));
  const l = Math.log(m / F);
  return m - simpson((y) => F * Math.exp(y) * G(y), l - 10 * s - 1, l, 600);
}

/** E[max(M0, max_{s≤T} F_s)] ; P(max ≤ y) = N((y + v/2)/√v) − e^{−y} N((−y + v/2)/√v). */
export function expectedMax(F: number, M0: number, v: number): number {
  const M = Math.max(M0, F);
  if (v <= 1e-12) return M;
  const s = Math.sqrt(v);
  const H = (y: number) => normCdf((y + v / 2) / s) - Math.exp(-y) * normCdf((-y + v / 2) / s);
  const l = Math.log(M / F);
  return M + simpson((y) => F * Math.exp(y) * (1 - H(y)), l, l + 10 * s + 2, 600);
}

/**
 * Lookback à strike flottant : call = F_T − min, put = max − F_T. Surveillance quotidienne :
 * E[min_d] ≈ e^{βσ√Δt} · E[min_c(m0 e^{−βσ√Δt})] (et symétriquement pour le max).
 */
export function lookbackPrice(F: number, extreme: number, v: number, df: number, type: OptType, sigmaDaily = 0): number {
  const sh = Math.exp(BGK_BETA * sigmaDaily);
  if (type === 'C') return df * Math.max(0, F - sh * expectedMin(F, extreme / sh, v));
  return df * Math.max(0, expectedMax(F, extreme * sh, v) / sh - F);
}

/**
 * Option sur spread F1 − F2 − K (approximation de Kirk ; exacte pour K = 0 : formule de Margrabe).
 * v1, v2 : variances totales, c12 : covariance des log-prix jusqu'à l'échéance.
 */
export function kirkSpread(F1: number, F2: number, K: number, v1: number, v2: number, c12: number, df: number, type: OptType): number {
  const base = F2 + K;
  if (base <= 0) {
    // spread garanti positif : le call vaut son intrinsèque actualisé (forward), le put zéro
    const fwd = df * (F1 - F2 - K);
    return type === 'C' ? Math.max(0, fwd) : 0;
  }
  const w = F2 / base;
  const vK = Math.max(0, v1 - 2 * w * c12 + w * w * v2);
  const call = black(F1, base, vK, df, 'C');
  return type === 'C' ? call : call - df * (F1 - F2 - K);
}

/**
 * Option composée « call sur call » (Geske, b = 0) : droit d'acheter en T1, au prix P, un call (K, T2).
 * Vol constante σ jusqu'à T2. dfs : actualisation à T1 et T2.
 */
export function compoundCallOnCall(F: number, K: number, P: number, T1: number, T2: number, sigma: number, df1: number, df2: number): number {
  if (T1 <= 0) {
    const c = black76(F, K, Math.max(0, T2 - T1), sigma, 0, 'C') * (df2 / df1);
    return Math.max(0, c - P) * df1;
  }
  // F* tel que la valeur en T1 du call sous-jacent égale la prime P
  const val = (f: number) => black76(f, K, T2 - T1, sigma, 0, 'C') * (df2 / df1) - P;
  let lo = 1e-9 * K, hi = 50 * Math.max(F, K);
  if (val(hi) < 0) return 0;
  for (let i = 0; i < 120; i++) {
    const mid = 0.5 * (lo + hi);
    if (val(mid) > 0) hi = mid;
    else lo = mid;
  }
  const Fs = 0.5 * (lo + hi);
  const s1 = sigma * Math.sqrt(T1), s2 = sigma * Math.sqrt(T2);
  const y1 = (Math.log(F / Fs) + 0.5 * s1 * s1) / s1, y2 = y1 - s1;
  const z1 = (Math.log(F / K) + 0.5 * s2 * s2) / s2, z2 = z1 - s2;
  const rho = Math.sqrt(T1 / T2);
  return Math.max(0, F * df2 * bvnCdf(z1, y1, rho) - K * df2 * bvnCdf(z2, y2, rho) - P * df1 * normCdf(y2));
}

// ------------------------------------------------------------------ entrées de marché

const spec = (c: CommodityId) => COMMODITIES[c];
const corrIndex = (c: CommodityId) => COMMODITY_IDS.indexOf(c);

/** Variance totale ATM (modèle × niveau de vol implicite) de ln F(month) entre maintenant et `until`. */
export function totalVar(m: MarketState, c: CommodityId, month: MonthIndex, until: Day): number {
  const T = Math.max(0, yearFrac(m.day, until));
  if (T <= 0) return 0;
  const s = atmVol(m, c, month, until);
  return s * s * T;
}

/** Covariance (modèle, × niveaux de vol) des log-prix de deux échéances jusqu'à te (années). */
export function crossCov(m: MarketState, c: CommodityId, mi1: MonthIndex, mi2: MonthIndex, until: Day): number {
  const p = spec(c).model;
  const te = Math.max(0, yearFrac(m.day, until));
  if (te <= 0) return 0;
  const t1 = yearFrac(m.day, pricingDay(spec(c), mi1));
  const t2 = yearFrac(m.day, pricingDay(spec(c), mi2));
  const k = p.kappa;
  const vm = m.volMult * m.ivLevel[c];
  const sc = p.sigmaChi * vm, sx = p.sigmaXi * vm;
  return (
    (sc * sc * Math.exp(-k * (t1 + t2)) * (Math.exp(2 * k * te) - 1)) / (2 * k) +
    sx * sx * te +
    (p.rho * sc * sx * (Math.exp(-k * t1) + Math.exp(-k * t2)) * (Math.exp(k * te) - 1)) / k
  );
}

/**
 * Covariance des log-prix de deux futures (commodités éventuellement différentes) jusqu'à `until`, sous le modèle :
 *   d ln F_i = (σχ_i e^{−κ_i(τ_i − s)} + ρ_i σξ_i) dB1_i + σξ_i √(1 − ρ_i²) dB2_i,
 *   corr(B1_i, B1_j) = corr(B2_i, B2_j) = C_ij (matrice des chocs), B1 ⟂ B2.
 * Intégrée par Simpson (64 pas) ; × niveaux de vol implicite. Pour une même commodité, égale à `crossCov`.
 */
export function crossCovPair(m: MarketState, c1: CommodityId, mi1: MonthIndex, c2: CommodityId, mi2: MonthIndex, until: Day): number {
  const te = Math.max(0, yearFrac(m.day, until));
  if (te <= 0) return 0;
  const p1 = spec(c1).model, p2 = spec(c2).model;
  const t1 = yearFrac(m.day, pricingDay(spec(c1), mi1)), t2 = yearFrac(m.day, pricingDay(spec(c2), mi2));
  const k1 = m.volMult * m.ivLevel[c1], k2 = m.volMult * m.ivLevel[c2];
  const C = c1 === c2 ? 1 : CORRELATION[corrIndex(c1)]![corrIndex(c2)]!;
  const f = (s: number) => {
    const a1 = p1.sigmaChi * k1 * Math.exp(-p1.kappa * Math.max(0, t1 - s)) + p1.rho * p1.sigmaXi * k1;
    const a2 = p2.sigmaChi * k2 * Math.exp(-p2.kappa * Math.max(0, t2 - s)) + p2.rho * p2.sigmaXi * k2;
    const b = p1.sigmaXi * k1 * p2.sigmaXi * k2 * Math.sqrt((1 - p1.rho * p1.rho) * (1 - p2.rho * p2.rho));
    return C * (a1 * a2 + b);
  };
  return simpson(f, 0, te, 64);
}

/** Variance de ln F(month) entre deux dates futures (en jours), pour les périodes de cliquet. */
function periodVar(m: MarketState, c: CommodityId, month: MonthIndex, from: Day, to: Day): number {
  const p = spec(c).model;
  const tc = yearFrac(m.day, pricingDay(spec(c), month));
  const a = Math.max(0, yearFrac(m.day, from)), b = Math.max(0, yearFrac(m.day, to));
  const iv = m.ivLevel[c];
  return Math.max(0, integratedVariance(p, tc, b, m.volMult) - integratedVariance(p, tc, a, m.volMult)) * iv * iv;
}

/** Devise de paiement d'un quanto : l'autre devise. */
export function quantoCcy(c: CommodityId): Currency {
  return spec(c).currency === 'USD' ? 'EUR' : 'USD';
}

/**
 * Ajustement quanto : sous la mesure de la devise de paiement, ln F dérive de −cov(ln F, ln X),
 * X = prix de la devise de cotation exprimé en devise de paiement. EURUSD = USD par EUR (fxLog).
 * Covariance : seul le facteur court de la commodité est corrélé au choc de change (cf. stepMarket) :
 *   cov = ρ_{c,FX} σ_X ∫₀ᵀ (σχ e^{−κ(τ−s)} + ρ σξ) ds.
 */
export function quantoCov(m: MarketState, c: CommodityId, month: MonthIndex, until: Day): number {
  const p = spec(c).model;
  const T = Math.max(0, yearFrac(m.day, until));
  if (T <= 0) return 0;
  const tc = yearFrac(m.day, pricingDay(spec(c), month));
  const vm = m.volMult * m.ivLevel[c];
  const rhoFx = CORRELATION[corrIndex(c)]![FX_INDEX]!;
  const integral = ((p.sigmaChi * vm * Math.exp(-p.kappa * tc) * (Math.exp(p.kappa * T) - 1)) / p.kappa) + p.rho * p.sigmaXi * vm * T;
  const covWithFxLog = rhoFx * FX_PARAMS.sigma * integral;
  // X = devise de paiement par unité de devise de cotation : EURUSD si cotation EUR, 1/EURUSD si cotation USD
  return spec(c).currency === 'EUR' ? covWithFxLog : -covWithFxLog;
}

// ------------------------------------------------------------------ prix unitaire

export interface ExoticState {
  hit?: boolean;
  extreme?: number;
  resetDays?: Day[];
  refs?: number[];
}

/** Devise dans laquelle s'exprime le prix unitaire. */
export function exoticCcy(x: ExoticSpec): Currency {
  return x.kind === 'quanto' ? quantoCcy(x.commodity) : spec(x.commodity).currency;
}

/** Prix unitaire (par unité physique) dans la devise de règlement, en tenant compte de l'état du chemin. */
export function exoticUnitPrice(m: MarketState, x: ExoticSpec, st: ExoticState = {}): number {
  const c = x.commodity;
  const ccy = exoticCcy(x);
  const T = Math.max(0, yearFrac(m.day, x.expiry));
  const df = Math.exp(-zeroRate(m, ccy, T) * T);
  // log-normale décalée (WTI) : les formules s'appliquent à X = F + décalage, strikes et barrières décalés
  const sh = priceShift(c);
  const F = futuresPrice(m, c, x.month) + sh;
  const K = x.kind === 'spread' || x.kind === 'lookback' || x.kind === 'cliquet' ? x.strike : x.strike + sh;
  const v = totalVar(m, c, x.month, x.expiry);
  const sigma = T > 0 ? Math.sqrt(v / T) : 0;
  const sDay = sigma * Math.sqrt(DT_DAY);
  switch (x.kind) {
    case 'barrier': {
      const bt = x.barrierType!;
      const vanilla = black(F, K, v, df, x.type);
      if (st.hit) return bt.endsWith('out') ? 0 : vanilla;
      const H = (x.barrier! + sh) * Math.exp((bt.startsWith('up') ? 1 : -1) * BGK_BETA * sDay);
      return barrierPrice(F, K, H, v, df, x.type, bt);
    }
    case 'digital': {
      const pay = x.payout ?? 1;
      if (T <= 0) return (x.type === 'C' ? F > K : F < K) ? pay : 0;
      // réplication par call-spread serré sur la surface avec smile : −∂C/∂K (skew inclus)
      const h = Math.max(Math.abs(x.strike), F * 0.2) * 0.005;
      const pr = (k: number) => black76(F, k, T, impliedVolAt(m, c, x.month, x.expiry, k - sh, F - sh), 0, x.type) * df;
      const dCdK = (pr(K + h) - pr(K - h)) / (2 * h);
      return pay * (x.type === 'C' ? -dCdK : dCdK);
    }
    case 'lookback':
      return lookbackPrice(F, st.extreme !== undefined ? st.extreme + sh : F, v, df, x.type, sDay);
    case 'spread': {
      if (x.spreadId) {
        // spread entre commodités : a1·F1 − a2·F2 − K, Kirk avec la covariance croisée du modèle
        const d = SPREAD_BY_ID[x.spreadId]!;
        const s1 = priceShift(d.c1), s2 = priceShift(d.c2);
        const X1 = futuresPrice(m, d.c1, x.month) + s1, X2 = futuresPrice(m, d.c2, x.month2!) + s2;
        const v1 = crossCovPair(m, d.c1, x.month, d.c1, x.month, x.expiry);
        const v2 = crossCovPair(m, d.c2, x.month2!, d.c2, x.month2!, x.expiry);
        const c12 = crossCovPair(m, d.c1, x.month, d.c2, x.month2!, x.expiry);
        return kirkSpread(d.a1 * X1, d.a2 * X2, x.strike + d.a1 * s1 - d.a2 * s2, v1, v2, c12, df, x.type);
      }
      const F2 = futuresPrice(m, c, x.month2!) + sh;
      const v1 = crossCov(m, c, x.month, x.month, x.expiry);
      const v2 = crossCov(m, c, x.month2!, x.month2!, x.expiry);
      const c12 = crossCov(m, c, x.month, x.month2!, x.expiry);
      return kirkSpread(F, F2, x.strike, v1, v2, c12, df, x.type);
    }
    case 'compound': {
      const T2 = Math.max(T, yearFrac(m.day, x.expiry2!));
      const df2 = Math.exp(-zeroRate(m, ccy, T2) * T2);
      const s2 = atmVol(m, c, x.month, x.expiry2!);
      return compoundCallOnCall(F, K, x.strike2!, T, T2, s2, df, df2);
    }
    case 'quanto': {
      const Ft = F * Math.exp(-quantoCov(m, c, x.month, x.expiry));
      return (x.quantoFx ?? 1) * black(Ft, K, v, df, x.type);
    }
    case 'cliquet': {
      const days = st.resetDays ?? [];
      const refs = (st.refs ?? [F - sh]).map((r) => r + sh); // rendements sur X = F + décalage
      const F0 = refs[0]!;
      const phi = x.type === 'C' ? 1 : -1;
      let acc = 0;
      for (let i = 1; i < refs.length; i++) acc += Math.max(0, phi * (refs[i]! / refs[i - 1]! - 1));
      let fut = 0;
      const j = refs.length - 1; // dernière constatation
      if (j < days.length) {
        // période en cours : option sur F à strike F_j, jusqu'à la prochaine constatation
        const vNow = periodVar(m, c, x.month, m.day, days[j]!);
        fut += (1 / refs[j]!) * black(F, refs[j]!, vNow, 1, x.type);
        for (let k = j; k < days.length - 1; k++) fut += black(1, 1, periodVar(m, c, x.month, days[k]!, days[k + 1]!), 1, x.type);
      }
      return F0 * df * (acc + fut);
    }
  }
}

/** Valeur en USD d'une position. */
export function exoticValueUsd(v: Pick<View, 'market'>, p: ExoticPosition): number {
  const ccy = exoticCcy(p);
  return exoticUnitPrice(v.market, p, p) * p.qty * fx(v.market, ccy);
}

/** Delta (unités physiques équivalentes en future) par différences centrées, choc parallèle de la courbe. */
export function exoticDeltaUnits(m: MarketState, p: ExoticPosition, leg: CommodityId = p.commodity): number {
  // jambe éventuelle d'un spread entre commodités : la 2ᵉ commodité a son propre mois
  const d = p.spreadId ? SPREAD_BY_ID[p.spreadId] : undefined;
  const mi = d && leg === d.c2 ? p.month2! : p.month;
  const F = futuresPrice(m, leg, mi) + priceShift(leg);
  const val = (k: number) => {
    const mm: MarketState = { ...m, commodities: { ...m.commodities, [leg]: { ...m.commodities[leg], xi: m.commodities[leg].xi + Math.log(k) } } };
    return exoticUnitPrice(mm, p, p) * fx(m, exoticCcy(p)) / fx(m, spec(leg).currency);
  };
  return ((val(1.005) - val(0.995)) / (0.01 * F)) * p.qty;
}

/** Commodités dont dépend une exotique (deux pour un spread entre commodités). */
export function exoticLegs(p: ExoticSpec): CommodityId[] {
  const d = p.spreadId ? SPREAD_BY_ID[p.spreadId] : undefined;
  return d ? [d.c1, d.c2] : [p.commodity];
}

/** Vega (variation de valeur USD pour +1 point de vol). */
export function exoticVegaUsd(m: MarketState, p: ExoticPosition): number {
  const c = p.commodity;
  const up: MarketState = { ...m, ivLevel: { ...m.ivLevel, [c]: m.ivLevel[c] * 1.01 } };
  const dn: MarketState = { ...m, ivLevel: { ...m.ivLevel, [c]: m.ivLevel[c] * 0.99 } };
  const atm = atmVol(m, c, p.month, p.expiry);
  const dv = (exoticUnitPrice(up, p, p) - exoticUnitPrice(dn, p, p)) / (0.02 * atm * 100);
  return dv * p.qty * fx(m, exoticCcy(p));
}

// ------------------------------------------------------------------ Monte Carlo de contrôle

/**
 * Monte Carlo sur la dynamique exacte du modèle de Schwartz-Smith (pas quotidiens ouvrés, variables antithétiques),
 * vol du modèle × niveau de vol implicite (volMult effectif), surveillance aux clôtures quotidiennes.
 * Hors quanto (la dynamique jointe commodité/change sous la mesure de paiement n'est pas simulée).
 */
export function mcExotic(m: MarketState, x: ExoticSpec, st: ExoticState = {}, paths = 4000, seed = 'mc'): { price: number; se: number } {
  const c = x.commodity;
  const p = spec(c).model;
  const rng = seedRng(seed);
  const vm = m.volMult * m.ivLevel[c];
  const days: Day[] = [];
  for (let d = nextBusinessDay(m.day); d <= x.expiry; d = nextBusinessDay(d)) days.push(d);
  if (!days.length || days[days.length - 1] !== x.expiry) days.push(x.expiry);
  const ccy = exoticCcy(x);
  const T = Math.max(0, yearFrac(m.day, x.expiry));
  const df = Math.exp(-zeroRate(m, ccy, T) * T);
  const del1 = pricingDay(spec(c), x.month);
  const del2 = x.month2 !== undefined ? pricingDay(spec(c), x.month2) : del1;
  const F0 = futuresPrice(m, c, x.month);
  const F20 = x.month2 !== undefined ? futuresPrice(m, c, x.month2) : 0;
  // décalage pour retrouver exactement les prix d'aujourd'hui (impact de marché, différentiels de cotation)
  const cm = m.commodities[c];
  const sh = priceShift(c);
  const base1 = Math.log(F0 + sh) - lnForward(p, cm.chi, cm.xi, yearFrac(m.day, del1), del1, vm);
  const base2 = x.month2 !== undefined ? Math.log(F20 + sh) - lnForward(p, cm.chi, cm.xi, yearFrac(m.day, del2), del2, vm) : 0;
  const resetSet = new Map<Day, number>();
  (st.resetDays ?? []).forEach((d, i) => resetSet.set(d, i));
  let sum = 0, sum2 = 0;
  const n = Math.max(2, paths >> 1);
  const zs: number[] = new Array(days.length * 2);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < zs.length; k++) zs[k] = normal(rng);
    let pair = 0;
    for (const sgn of [1, -1]) {
      let chi = cm.chi, xi = cm.xi, prev = m.day;
      let hit = !!st.hit, mn = st.extreme ?? F0, mx = st.extreme ?? F0;
      const refs = [...(st.refs ?? [F0])];
      let F = F0, F2 = F20, cAtT1 = 0;
      days.forEach((d, k) => {
        const dt = yearFrac(prev, d);
        const nx = stepFactors(p, chi, xi, dt, sgn * zs[2 * k]!, sgn * zs[2 * k + 1]!, vm);
        chi = nx.chi;
        xi = nx.xi;
        prev = d;
        F = Math.exp(base1 + lnForward(p, chi, xi, yearFrac(d, del1), del1, vm)) - sh;
        if (x.month2 !== undefined) F2 = Math.exp(base2 + lnForward(p, chi, xi, yearFrac(d, del2), del2, vm)) - sh;
        if (x.kind === 'barrier') hit ||= x.barrierType!.startsWith('up') ? F >= x.barrier! : F <= x.barrier!;
        mn = Math.min(mn, F);
        mx = Math.max(mx, F);
        if (resetSet.has(d) && resetSet.get(d)! === refs.length - 1) refs.push(F);
      });
      if (x.kind === 'compound') {
        const mT1: MarketState = { ...m, day: x.expiry };
        const s2 = atmVol(mT1, c, x.month, x.expiry2!);
        const T2 = yearFrac(x.expiry, x.expiry2!);
        cAtT1 = black76(F + sh, x.strike + sh, T2, s2, zeroRate(m, ccy, T2), 'C');
      }
      const phi = x.type === 'C' ? 1 : -1;
      let pay = 0;
      switch (x.kind) {
        case 'barrier': {
          const van = Math.max(0, phi * (F - x.strike));
          pay = x.barrierType!.endsWith('out') ? (hit ? 0 : van) : hit ? van : 0;
          break;
        }
        case 'digital':
          pay = phi * (F - x.strike) > 0 ? x.payout ?? 1 : 0;
          break;
        case 'lookback':
          pay = x.type === 'C' ? F - mn : mx - F;
          break;
        case 'spread':
          pay = Math.max(0, phi * (F - F2 - x.strike));
          break;
        case 'compound':
          pay = Math.max(0, cAtT1 - x.strike2!);
          break;
        case 'quanto':
          pay = (x.quantoFx ?? 1) * Math.max(0, phi * (F - x.strike));
          break;
        case 'cliquet': {
          let s = 0;
          for (let j = 1; j < refs.length; j++) s += Math.max(0, phi * ((refs[j]! + sh) / (refs[j - 1]! + sh) - 1));
          pay = (refs[0]! + sh) * s;
          break;
        }
      }
      // composée : réglée en T1 ; actualisation identique (échéance de l'exotique)
      pair += pay * df;
    }
    const y = pair / 2;
    sum += y;
    sum2 += y * y;
  }
  const mean = sum / n;
  return { price: mean, se: Math.sqrt(Math.max(0, sum2 / n - mean * mean) / n) };
}

// ------------------------------------------------------------------ négociation et cycle de vie

const BANKS = () => COUNTERPARTIES.filter((c) => c.kind === 'bank');

/** Validation des caractéristiques ; renvoie un message d'erreur ou null. */
export function exoticError(m: MarketState, x: ExoticSpec): string | null {
  const c = x.commodity;
  const lastExp = optionExpiry(spec(c), x.month);
  if (x.expiry <= m.day) return 'Échéance passée.';
  if (x.expiry > lastExp) return 'L’échéance dépasse l’expiration des options sur ce future.';
  if (x.strike <= 0 && x.kind !== 'spread') return 'Strike invalide.';
  if (x.kind === 'barrier') {
    if (!x.barrier || !x.barrierType) return 'Barrière manquante.';
    const F = futuresPrice(m, c, x.month);
    if (x.barrierType.startsWith('up') ? x.barrier <= F : x.barrier >= F) return 'La barrière est déjà franchie.';
  }
  if (x.kind === 'spread' && x.spreadId) {
    const d = SPREAD_BY_ID[x.spreadId];
    if (!d || x.month2 === undefined) return 'Spread inconnu.';
    if (x.expiry > optionExpiry(spec(d.c2), x.month2)) return 'L’échéance dépasse l’expiration de la 2ᵉ jambe.';
  } else if (x.kind === 'spread' && (x.month2 === undefined || x.month2 <= x.month)) return 'Le second mois doit être plus lointain.';
  if (x.kind === 'compound' && (!x.expiry2 || x.expiry2 <= x.expiry || x.expiry2 > lastExp || !x.strike2 || x.strike2 <= 0)) return 'Composée : échéance et prime du call sous-jacent invalides.';
  if (x.kind === 'cliquet' && (!x.resets || x.resets < 2 || x.resets > 12)) return 'Cliquet : 2 à 12 périodes.';
  return null;
}

/** Dates de constatation d'un cliquet, équiréparties entre aujourd'hui et l'échéance. */
export function cliquetDays(start: Day, expiry: Day, n: number): Day[] {
  const out: Day[] = [];
  for (let i = 1; i <= n; i++) {
    let d = Math.round(start + ((expiry - start) * i) / n);
    if (i === n) d = expiry;
    out.push(Math.min(expiry, addBusinessDays(d - 1, 1)));
  }
  return out;
}

export interface ExoticQuote {
  mid: number;
  bid: number;
  ask: number;
  ccy: Currency;
  deltaUnits: number; // par unité achetée
  vegaUsd: number; // par unité, pour +1 point de vol
  bankId: string;
}

/**
 * Cotation bancaire : fourchette large (produit sur mesure, couverture dynamique coûteuse) :
 * max(3 % de la prime, 0,6 point de vol de vega) en régime calme, doublée en crise.
 */
export function exoticQuote(m: MarketState, x: ExoticSpec, st: ExoticState = {}): ExoticQuote {
  const mid = exoticUnitPrice(m, x, st);
  const pos = { ...x, ...st, id: 'q', qty: 1, premium: 0, bankId: '', tradeDay: m.day } as ExoticPosition;
  const vegaUsd = exoticVegaUsd(m, pos);
  const vegaCcy = vegaUsd / fx(m, exoticCcy(x));
  const stress = m.volRegime === 'stressed' ? 2 : 1;
  const hs = Math.max(0.03 * Math.abs(mid), 0.6 * Math.abs(vegaCcy), spec(x.commodity).tick) * stress;
  const banks = BANKS();
  const bankId = banks[(Math.abs(Math.round(x.strike * 7 + x.expiry)) % Math.max(1, banks.length))]?.id ?? 'bank';
  return { mid, bid: Math.max(0, mid - hs), ask: mid + hs, ccy: exoticCcy(x), deltaUnits: exoticDeltaUnits(m, pos), vegaUsd, bankId };
}

/** Achat (qty > 0) ou vente (qty < 0) d'une exotique à la banque, prime payée/encaissée comptant. */
export function tradeExotic(state: GameState, x: ExoticSpec, qty: number): ActionResult {
  const m = state.market;
  const err = exoticError(m, x);
  if (err) return { ok: false, message: err };
  if (!qty) return { ok: false, message: 'Quantité nulle.' };
  const st: ExoticState = {};
  const F = futuresPrice(m, x.commodity, x.month);
  if (x.kind === 'cliquet') {
    st.resetDays = cliquetDays(state.day, x.expiry, x.resets!);
    st.refs = [F];
  }
  if (x.kind === 'lookback') st.extreme = F;
  const spec2: ExoticSpec = { ...x, quantoFx: x.kind === 'quanto' ? x.quantoFx ?? roundTo(fx(m, spec(x.commodity).currency) / fx(m, quantoCcy(x.commodity)), 0.0001) : undefined };
  const q = exoticQuote(m, spec2, st);
  const px = qty > 0 ? q.ask : q.bid;
  const cash = px * qty * fx(m, q.ccy);
  // vente d'exotique : la banque exige que la perte potentielle reste couverte par les fonds propres
  if (qty > 0 && cash > state.company.cash - state.company.im) return { ok: false, message: 'Trésorerie insuffisante pour la prime.' };
  addCash(state, -cash, 'premium', x.commodity);
  const p: ExoticPosition = { ...spec2, ...st, id: newId(state, 'x'), qty, premium: px, bankId: q.bankId, tradeDay: state.day };
  state.exotics.push(p);
  state.company.tradesThisMonth++;
  log(state, `${qty > 0 ? 'Achat' : 'Vente'} ${exoticLabel(p)} (${Math.abs(qty).toLocaleString('fr-FR')} ${spec(x.commodity).qtyUnit}) à ${px.toFixed(3)}`, -cash);
  return { ok: true, message: `${exoticLabel(p)} : ${qty > 0 ? 'prime payée' : 'prime encaissée'} ${Math.abs(cash / 1e3).toFixed(0)} k$.` };
}

/** Débouclage auprès de la banque au prix de la fourchette. */
export function closeExotic(state: GameState, id: string): ActionResult {
  const p = state.exotics.find((x) => x.id === id);
  if (!p) return { ok: false, message: 'Position introuvable.' };
  const q = exoticQuote(state.market, p, p);
  const px = p.qty > 0 ? q.bid : q.ask;
  const cash = px * p.qty * fx(state.market, q.ccy);
  addCash(state, cash, 'premium', p.commodity);
  state.exotics = state.exotics.filter((x) => x !== p);
  log(state, `Débouclage ${exoticLabel(p)} à ${px.toFixed(3)}`, cash);
  return { ok: true, message: `Position débouclée (${(cash / 1e3).toFixed(0)} k$).` };
}

/** Surveillance de clôture (barrières, extrêmes, constatations) puis règlement des échéances. Renvoie les messages. */
export function stepExotics(state: GameState): string[] {
  const msgs: string[] = [];
  const m = state.market;
  for (const p of state.exotics ?? []) {
    const F = futuresPrice(m, p.commodity, p.month);
    if (p.kind === 'barrier' && !p.hit && (p.barrierType!.startsWith('up') ? F >= p.barrier! : F <= p.barrier!)) {
      p.hit = true;
      msgs.push(`Barrière ${p.barrier} touchée sur ${exoticLabel(p)} : option ${p.barrierType!.endsWith('out') ? 'désactivée' : 'activée'}.`);
    }
    if (p.kind === 'lookback') p.extreme = p.type === 'C' ? Math.min(p.extreme ?? F, F) : Math.max(p.extreme ?? F, F);
    if (p.kind === 'cliquet' && p.resetDays && p.refs) {
      const j = p.refs.length - 1;
      if (j < p.resetDays.length && state.day >= p.resetDays[j]!) p.refs.push(F);
    }
  }
  for (const p of (state.exotics ?? []).filter((x) => state.day >= x.expiry)) {
    let unit: number;
    if (p.kind === 'compound') {
      // composée réglée en cash : max(valeur du call sous-jacent − prime, 0)
      const T2 = yearFrac(state.day, p.expiry2!);
      const c = black76(futuresPrice(m, p.commodity, p.month) + priceShift(p.commodity), p.strike + priceShift(p.commodity), T2, atmVol(m, p.commodity, p.month, p.expiry2!), zeroRate(m, exoticCcy(p), T2), 'C');
      unit = Math.max(0, c - p.strike2!);
    } else unit = exoticUnitPrice(m, p, p);
    const cash = unit * p.qty * fx(m, exoticCcy(p));
    addCash(state, cash, 'premium', p.commodity);
    const pnl = (unit - p.premium) * p.qty * fx(m, exoticCcy(p));
    state.stats.exoticPnl.push(pnl);
    msgs.push(`Échéance ${exoticLabel(p)} : règlement ${(cash / 1e3).toFixed(0)} k$ (P&L ${(pnl / 1e3).toFixed(0)} k$).`);
    log(state, `Règlement ${exoticLabel(p)}`, cash);
  }
  state.exotics = (state.exotics ?? []).filter((x) => state.day < x.expiry);
  return msgs;
}

const KIND_LABEL: Record<ExoticSpec['kind'], string> = {
  barrier: 'barrière', digital: 'digitale', lookback: 'lookback', spread: 'spread calendaire', compound: 'composée', quanto: 'quanto', cliquet: 'cliquet',
};

export function exoticLabel(x: ExoticSpec): string {
  const s = spec(x.commodity).short;
  const t = x.type === 'C' ? 'call' : 'put';
  switch (x.kind) {
    case 'barrier': return `${t} ${s} ${x.strike} ${x.barrierType} ${x.barrier}`;
    case 'digital': return `digitale ${t} ${s} ${x.strike}`;
    case 'lookback': return `lookback ${t} ${s}`;
    case 'spread': return x.spreadId ? `${t} ${SPREAD_BY_ID[x.spreadId]!.label} K=${x.strike}` : `${t} spread ${s} K=${x.strike}`;
    case 'compound': return `call sur call ${s} ${x.strike}`;
    case 'quanto': return `${t} ${s} ${x.strike} quanto ${quantoCcy(x.commodity)}`;
    case 'cliquet': return `cliquet ${t} ${s} ×${x.resets}`;
  }
  return `${KIND_LABEL[x.kind]} ${s}`;
}
