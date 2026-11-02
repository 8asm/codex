/**
 * Phase 9 — Valeur d'usage des qualités de brut.
 *
 * Valeur brute des produits (GPW, « gross product worth ») d'une qualité, en $/bbl de brut :
 *     GPW_g(T) = Σ_p y_{g,p} · F_p(T) / b_p
 * avec y les rendements, F_p le forward du produit p ($/t) à la date T et b_p les barils par tonne du produit.
 * Le différentiel d'une qualité au benchmark suit l'écart de valeur d'usage à la qualité de référence :
 *     diff_g(T) = diff0_g + λ · [ (GPW_g − GPW_ref)(T) − (GPW_g − GPW_ref)(prix de référence) ]
 * λ = 0,85 : les raffineurs ne paient qu'une partie de la valeur d'usage (contraintes d'unités, logistique).
 * Conséquence : un brut lourd et soufré porte une exposition aux cracks (long fioul, court essence et gazole)
 * qu'une couverture en benchmark seul ne neutralise pas. La VaR la voit, parce que les produits sont choqués
 * avec le brut (revalorisation complète).
 */
import { COMMODITIES } from '../data/commodities';
import { BENCHMARK_GRADE, GRADE_BY_ID, gradesAt } from '../data/grades';
import { forwardAt } from './market';
import { hashUniform } from './rng';
import type { CommodityId, MarketState } from './types';

export const PRODUCTS: CommodityId[] = ['GASOLINE', 'JET', 'GASOIL', 'FUELOIL'];
const BBL_PER_T = [8.45, 7.9, 7.45, 6.35];
const LAMBDA = 0.85;

function gpw(yields: readonly number[], price: (p: CommodityId) => number): number {
  return PRODUCTS.reduce((s, p, i) => s + (yields[i]! * price(p)) / BBL_PER_T[i]!, 0);
}

const refCache = new Map<string, number>();
/** Écart de valeur d'usage aux prix de référence des produits (paramètres s0 du modèle). */
function refSpread(gradeId: string): number {
  let v = refCache.get(gradeId);
  if (v === undefined) {
    const g = GRADE_BY_ID[gradeId]!;
    const s0 = (p: CommodityId) => COMMODITIES[p].model.s0;
    v = gpw(g.yields, s0) - gpw(BENCHMARK_GRADE[g.benchmark]!, s0);
    refCache.set(gradeId, v);
  }
  return v;
}

/** Différentiel de la qualité au benchmark ($/bbl) pour une livraison à la date `day`. */
export function gradeDiff(m: MarketState, gradeId: string | undefined, day: number): number {
  if (!gradeId) return 0;
  const g = GRADE_BY_ID[gradeId];
  if (!g) return 0;
  const px = (p: CommodityId) => forwardAt(m, p, Math.max(m.day, day));
  const spread = gpw(g.yields, px) - gpw(BENCHMARK_GRADE[g.benchmark]!, px);
  return g.diff0 + LAMBDA * (spread - refSpread(gradeId));
}

/**
 * Sensibilités du différentiel aux produits (∂diff/∂F_p, en bbl de brut par tonne de produit) : la quantité de
 * produit qui couvrirait le risque de qualité d'une cargaison.
 */
export function gradeProductDeltas(gradeId: string): Partial<Record<CommodityId, number>> {
  const g = GRADE_BY_ID[gradeId];
  if (!g) return {};
  const ref = BENCHMARK_GRADE[g.benchmark]!;
  const out: Partial<Record<CommodityId, number>> = {};
  PRODUCTS.forEach((p, i) => { out[p] = (LAMBDA * (g.yields[i]! - ref[i]!)) / BBL_PER_T[i]!; });
  return out;
}

/** Qualité attribuée à une offre (tirage haché : la séquence aléatoire du marché reste inchangée). */
export function pickGrade(seed: string, offerId: string, c: CommodityId, locationId: string): string | undefined {
  const list = gradesAt(c, locationId);
  if (!list.length) return undefined;
  // la qualité de référence (sans fiche) reste possible : un cargo sur trois est « au benchmark »
  const u = hashUniform(seed, offerId, 'grade');
  if (u < 1 / 3) return undefined;
  return list[Math.floor(((u - 1 / 3) * 1.5) * list.length)]?.id;
}
