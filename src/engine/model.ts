/**
 * Modèle de prix de Schwartz & Smith (2000), « Short-Term Variations and Long-Term Dynamics in Commodity Prices ».
 *
 *   ln S_t = χ_t + ξ_t + s(t)
 *   dχ = -κ χ dt + σχ dWχ         (écart court terme, retour à la moyenne : stocks, pannes, météo)
 *   dξ =  μ* dt  + σξ dWξ         (niveau d'équilibre long terme : coûts marginaux, technologie)
 *   dWχ dWξ = ρ dt
 *
 * Sous la mesure risque-neutre (primes de risque nulles en phase 1), le prix futures est l'espérance
 * du spot à maturité :
 *   ln F(t,T) = e^{-κτ} χ_t + ξ_t + A(τ) + s(T)
 *   A(τ) = μ* τ + ½ [ (1-e^{-2κτ}) σχ²/(2κ) + σξ² τ + 2 (1-e^{-κτ}) ρ σχ σξ / κ ]
 *
 * Conséquences « métier » :
 *  - χ > 0 (marché tendu, stocks bas) => le front est au-dessus du long terme : BACKWARDATION ;
 *  - χ < 0 (surplus, stocks pleins) => CONTANGO ;
 *  - la vol des échéances lointaines tend vers σξ (« effet Samuelson » : le front bouge plus que le back).
 * On choisit μ* = longDrift − ½σξ² pour que l'extrémité longue croisse au taux `longDrift`.
 * s(T) est une saisonnalité déterministe en cosinus (hivers gaziers, récoltes…).
 */
import type { Day } from './calendar';
import { ymd, daysInMonth, monthIndexOf } from './calendar';
import type { ModelParams } from './types';

export function seasonal(p: ModelParams, day: Day): number {
  if (p.seasonalAmp === 0) return 0;
  const { m, d } = ymd(day);
  const monthFrac = m - 1 + (d - 1) / daysInMonth(monthIndexOf(day));
  return p.seasonalAmp * Math.cos((2 * Math.PI * (monthFrac - p.seasonalPeak)) / 12);
}

function muStar(p: ModelParams, volMult: number): number {
  const sx = p.sigmaXi * volMult;
  return p.longDrift - 0.5 * sx * sx;
}

export function A(p: ModelParams, tau: number, volMult = 1): number {
  const k = p.kappa;
  const sc = p.sigmaChi * volMult;
  const sx = p.sigmaXi * volMult;
  return (
    muStar(p, volMult) * tau +
    0.5 *
      ((1 - Math.exp(-2 * k * tau)) * (sc * sc) / (2 * k) +
        sx * sx * tau +
        (2 * (1 - Math.exp(-k * tau)) * p.rho * sc * sx) / k)
  );
}

/** ln F(t,T). `tau` en années, `deliveryDay` sert à la saisonnalité. */
export function lnForward(p: ModelParams, chi: number, xi: number, tau: number, deliveryDay: Day, volMult = 1): number {
  const t = Math.max(0, tau);
  return Math.exp(-p.kappa * t) * chi + xi + A(p, t, volMult) + seasonal(p, deliveryDay);
}

/**
 * Volatilité instantanée (annualisée) du log-prix futures de maturité τ :
 *   σ_F(τ)² = e^{-2κτ} σχ² + σξ² + 2 e^{-κτ} ρ σχ σξ
 */
export function forwardVol(p: ModelParams, tau: number, volMult = 1): number {
  const e = Math.exp(-p.kappa * Math.max(0, tau));
  const sc = p.sigmaChi * volMult;
  const sx = p.sigmaXi * volMult;
  return Math.sqrt(e * e * sc * sc + sx * sx + 2 * e * p.rho * sc * sx);
}

/**
 * Pas de simulation EXACT (pas d'erreur de discrétisation) sur un intervalle dt :
 *  χ' = χ e^{-κdt} + sdχ · Zχ,  sdχ² = σχ² (1-e^{-2κdt})/(2κ)
 *  ξ' = ξ + μ* dt + σξ √dt · Zξ
 *  corr(Zχ, Zξ) = ρ σχ σξ (1-e^{-κdt})/κ / (sdχ · σξ √dt)
 * `z1` et `z2` sont deux normales indépendantes ; la corrélation est construite ici.
 */
export function stepFactors(
  p: ModelParams,
  chi: number,
  xi: number,
  dt: number,
  z1: number,
  z2: number,
  volMult = 1,
): { chi: number; xi: number } {
  const k = p.kappa;
  const sc = p.sigmaChi * volMult;
  const sx = p.sigmaXi * volMult;
  const sdChi = sc * Math.sqrt((1 - Math.exp(-2 * k * dt)) / (2 * k));
  const sdXi = sx * Math.sqrt(dt);
  const cov = (p.rho * sc * sx * (1 - Math.exp(-k * dt))) / k;
  const r = sdChi > 0 && sdXi > 0 ? Math.max(-1, Math.min(1, cov / (sdChi * sdXi))) : 0;
  const zChi = z1;
  const zXi = r * z1 + Math.sqrt(1 - r * r) * z2;
  return {
    chi: chi * Math.exp(-k * dt) + sdChi * zChi,
    xi: xi + muStar(p, volMult) * dt + sdXi * zXi,
  };
}
