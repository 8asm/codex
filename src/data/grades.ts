/**
 * Phase 9 — Qualités de brut.
 * Chaque qualité a une densité (°API), une teneur en soufre et un rendement de raffinage simple (essence, kérosène,
 * gazole, fioul lourd ; le reste = gaz, pertes). Son différentiel au benchmark (Brent, WTI ou Dubaï) est calé sur un
 * niveau de marché typique, puis évolue avec sa VALEUR D'USAGE (voir engine/grades.ts) : un brut lourd et soufré
 * rend beaucoup de fioul et peu de produits légers, il se déprécie quand le crack du fioul s'effondre.
 * Les rendements sont des ordres de grandeur publics (assays simplifiés), pas des assays de raffinerie.
 */
import type { CommodityId } from '../engine/types';

export interface CrudeGrade {
  id: string;
  name: string;
  origin: string;
  api: number;
  sulfur: number; // % massique
  /** rendements volumiques : essence, kérosène, gazole, fioul lourd */
  yields: [number, number, number, number];
  benchmark: CommodityId;
  /** différentiel typique au benchmark ($/bbl), aux prix de référence des produits */
  diff0: number;
  /** lieux de livraison où la qualité est offerte */
  locations: string[];
}

/** Qualité de référence de chaque benchmark : la valeur d'usage des autres s'y compare. */
export const BENCHMARK_GRADE: Partial<Record<CommodityId, CrudeGrade['yields']>> = {
  BRENT: [0.3, 0.1, 0.32, 0.23],
  WTI: [0.33, 0.1, 0.31, 0.2],
  DUBAI: [0.21, 0.09, 0.31, 0.36],
};

export const GRADES: CrudeGrade[] = [
  // ---------------------------------------------------------------- Brent (mer du Nord et bassin Atlantique)
  { id: 'forties', name: 'Forties', origin: 'Royaume-Uni', api: 39.6, sulfur: 0.6, yields: [0.31, 0.1, 0.32, 0.22], benchmark: 'BRENT', diff0: -0.4, locations: ['BRENT_RTM'] },
  { id: 'ekofisk', name: 'Ekofisk', origin: 'Norvège', api: 37.5, sulfur: 0.2, yields: [0.29, 0.11, 0.33, 0.22], benchmark: 'BRENT', diff0: 0.6, locations: ['BRENT_RTM'] },
  { id: 'sverdrup', name: 'Johan Sverdrup', origin: 'Norvège', api: 28, sulfur: 0.8, yields: [0.2, 0.09, 0.32, 0.36], benchmark: 'BRENT', diff0: -1.8, locations: ['BRENT_RTM'] },
  { id: 'cpc', name: 'CPC Blend', origin: 'Kazakhstan', api: 45, sulfur: 0.55, yields: [0.38, 0.11, 0.3, 0.15], benchmark: 'BRENT', diff0: -1.2, locations: ['BRENT_RTM'] },
  { id: 'azeri', name: 'Azeri Light', origin: 'Azerbaïdjan', api: 35, sulfur: 0.15, yields: [0.26, 0.12, 0.36, 0.22], benchmark: 'BRENT', diff0: 2, locations: ['BRENT_RTM'] },
  { id: 'bonny', name: 'Bonny Light', origin: 'Nigeria', api: 35, sulfur: 0.15, yields: [0.27, 0.12, 0.37, 0.2], benchmark: 'BRENT', diff0: 1.5, locations: ['BRENT_RTM', 'BRENT_SIN'] },
  { id: 'midland_b', name: 'WTI Midland', origin: 'États-Unis', api: 42, sulfur: 0.2, yields: [0.35, 0.1, 0.31, 0.18], benchmark: 'BRENT', diff0: 0.2, locations: ['BRENT_USGC', 'BRENT_RTM'] },
  { id: 'mars', name: 'Mars', origin: 'Golfe du Mexique', api: 29, sulfur: 1.9, yields: [0.21, 0.08, 0.3, 0.38], benchmark: 'BRENT', diff0: -2.5, locations: ['BRENT_USGC'] },
  { id: 'maya', name: 'Maya', origin: 'Mexique', api: 21, sulfur: 3.4, yields: [0.14, 0.06, 0.26, 0.5], benchmark: 'BRENT', diff0: -8, locations: ['BRENT_USGC'] },
  { id: 'murban_b', name: 'Murban', origin: 'Émirats', api: 40, sulfur: 0.8, yields: [0.33, 0.11, 0.31, 0.2], benchmark: 'BRENT', diff0: 0.5, locations: ['BRENT_FUJ', 'BRENT_SIN'] },
  // ---------------------------------------------------------------- WTI (Amérique du Nord)
  { id: 'midland', name: 'WTI Midland', origin: 'États-Unis', api: 42, sulfur: 0.2, yields: [0.35, 0.1, 0.31, 0.18], benchmark: 'WTI', diff0: 0.5, locations: ['WTI_HOU', 'WTI_RTM'] },
  { id: 'lls', name: 'Light Louisiana Sweet', origin: 'États-Unis', api: 37, sulfur: 0.4, yields: [0.3, 0.11, 0.33, 0.21], benchmark: 'WTI', diff0: 2.2, locations: ['WTI_HOU'] },
  { id: 'wcs', name: 'Western Canadian Select', origin: 'Canada', api: 20.5, sulfur: 3.5, yields: [0.13, 0.06, 0.26, 0.51], benchmark: 'WTI', diff0: -12, locations: ['WTI_HOU', 'WTI_CUS'] },
  // ---------------------------------------------------------------- Dubaï (Golfe, pour l'Asie)
  { id: 'murban', name: 'Murban', origin: 'Émirats', api: 40, sulfur: 0.8, yields: [0.33, 0.11, 0.31, 0.2], benchmark: 'DUBAI', diff0: 2.5, locations: ['DUB_FUJ', 'DUB_SIN', 'DUB_TKY'] },
  { id: 'arablight', name: 'Arab Light', origin: 'Arabie saoudite', api: 33, sulfur: 1.9, yields: [0.23, 0.09, 0.31, 0.34], benchmark: 'DUBAI', diff0: 0.8, locations: ['DUB_FUJ', 'DUB_SIN', 'DUB_TKY'] },
  { id: 'arabheavy', name: 'Arab Heavy', origin: 'Arabie saoudite', api: 27, sulfur: 2.9, yields: [0.17, 0.07, 0.28, 0.45], benchmark: 'DUBAI', diff0: -2.5, locations: ['DUB_FUJ', 'DUB_SIN'] },
  { id: 'basrah', name: 'Basrah Medium', origin: 'Irak', api: 29, sulfur: 2.9, yields: [0.19, 0.08, 0.29, 0.41], benchmark: 'DUBAI', diff0: -1.5, locations: ['DUB_FUJ', 'DUB_SIN'] },
  { id: 'oman', name: 'Oman', origin: 'Oman', api: 33, sulfur: 1.1, yields: [0.23, 0.09, 0.32, 0.33], benchmark: 'DUBAI', diff0: 0.5, locations: ['DUB_MCT'] },
];

export const GRADE_BY_ID: Record<string, CrudeGrade> = Object.fromEntries(GRADES.map((g) => [g.id, g]));

export function gradesAt(c: CommodityId, locationId: string): CrudeGrade[] {
  return GRADES.filter((g) => g.benchmark === c && g.locations.includes(locationId));
}
