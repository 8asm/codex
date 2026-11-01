/**
 * Surface de volatilité implicite.
 *
 *  σ_ATM(contrat, expiration) = √(∫ σ_F² / τe) × ivLevel   (structure par terme du modèle × niveau de marché)
 *  σ(K) = σ_ATM × (1 + skew·x + curvature·x²),  x = ln(K/F) / (σ_ATM √τe)   (smile en moneyness standardisée)
 *
 * - La structure par terme vient du modèle (effet Samuelson : les options courtes sont plus volatiles).
 * - `ivLevel` porte la prime de variance et la peur : il saute sur les grosses news et revient à la moyenne.
 * - Le skew dépend du marché : put skew sur le pétrole et le cuivre (peur de krach),
 *   call skew sur le gaz, le blé et le charbon (peur de pénurie). En crise, skew et smile s'accentuent de 50 %.
 * Le smile est une couche de cotation (règle « sticky moneyness ») : voir DESIGN_NOTES.md.
 */
import { COMMODITIES } from '../data/commodities';
import type { Day, MonthIndex } from './calendar';
import { yearFrac } from './calendar';
import { pricingDay } from './contracts';
import { futuresPrice } from './market';
import { forwardVol, integratedVariance } from './model';
import type { CommodityId, MarketState } from './types';

export const SMILE_X_CLAMP = 3;

export function atmVol(m: MarketState, c: CommodityId, mi: MonthIndex, expiry: Day): number {
  const p = COMMODITIES[c].model;
  const tauC = yearFrac(m.day, pricingDay(COMMODITIES[c], mi));
  const tauE = yearFrac(m.day, expiry);
  const base = tauE > 1e-6 ? Math.sqrt(integratedVariance(p, tauC, tauE, m.volMult) / tauE) : forwardVol(p, tauC, m.volMult);
  return base * m.ivLevel[c];
}

/** Multiplicateur de smile pour une moneyness standardisée x. */
export function smileFactor(m: MarketState, c: CommodityId, x: number): number {
  const o = COMMODITIES[c].options;
  const k = m.volRegime === 'stressed' ? 1.5 : 1;
  const xc = Math.max(-SMILE_X_CLAMP, Math.min(SMILE_X_CLAMP, x));
  return Math.max(0.3, 1 + k * (o.skew * xc + o.curvature * xc * xc));
}

export function impliedVolAt(m: MarketState, c: CommodityId, mi: MonthIndex, expiry: Day, K: number, F = futuresPrice(m, c, mi)): number {
  const atm = atmVol(m, c, mi, expiry);
  const tauE = Math.max(1 / 365, yearFrac(m.day, expiry));
  const x = Math.log(K / F) / (atm * Math.sqrt(tauE));
  return Math.max(0.01, atm * smileFactor(m, c, x) + (m.volShift ?? 0));
}
