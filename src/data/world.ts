/**
 * Géopolitique : zones (pays réels des villes du jeu + zones de production fictives remaniées),
 * blocs, notations de crédit.
 */
import type { CommodityId } from '../engine/types';

export type Bloc = 'west' | 'east' | 'neutral';
export type SanctionsRegime = 'west' | 'un' | 'east' | 'none';

export interface ZoneDef {
  id: string;
  name: string;
  bloc: Bloc;
  lat: number;
  lon: number;
  /** Codes ISO numériques (world-atlas) pour colorier le pays sur le globe ; vide pour une zone fictive. */
  iso: number[];
  fictional: boolean;
  baseStability: number; // 0..100
  produces: Partial<Record<CommodityId, number>>; // poids de production (0..1)
  blurb: string;
}

export const ZONES: ZoneDef[] = [
  { id: 'CH', name: 'Suisse', bloc: 'west', lat: 46.8, lon: 8.2, iso: [756], fictional: false, baseStability: 95, produces: {}, blurb: 'Place de négoce neutre de tradition, alignée sur les sanctions occidentales.' },
  { id: 'UK', name: 'Royaume-Uni', bloc: 'west', lat: 53, lon: -1.5, iso: [826], fictional: false, baseStability: 88, produces: { BRENT: 0.2, TTF: 0.15 }, blurb: 'Producteur en mer du Nord, place financière majeure.' },
  { id: 'NL', name: 'Pays-Bas', bloc: 'west', lat: 52.2, lon: 5.3, iso: [528], fictional: false, baseStability: 92, produces: { TTF: 0.1 }, blurb: 'Hub gazier et portuaire de l’Europe.' },
  { id: 'SG', name: 'Singapour', bloc: 'neutral', lat: 1.35, lon: 103.8, iso: [702], fictional: false, baseStability: 96, produces: {}, blurb: 'Hub asiatique ; applique les seules sanctions de l’ONU.' },
  { id: 'US', name: 'États-Unis', bloc: 'west', lat: 39, lon: -98, iso: [840], fictional: false, baseStability: 85, produces: { BRENT: 0.35, WHEAT: 0.3, TTF: 0.2 }, blurb: 'Premier producteur de pétrole et grand exportateur de GNL et de blé.' },
  { id: 'AE', name: 'Émirats arabes unis', bloc: 'neutral', lat: 24, lon: 54, iso: [784], fictional: false, baseStability: 82, produces: { BRENT: 0.15 }, blurb: 'Carrefour du négoce, n’applique pas les sanctions occidentales.' },
  { id: 'CN', name: 'Chine', bloc: 'east', lat: 35, lon: 104, iso: [156], fictional: false, baseStability: 78, produces: { API2: 0.4, WHEAT: 0.1 }, blurb: 'Premier consommateur de métaux, de charbon et de soja.' },
  { id: 'CL', name: 'Chili', bloc: 'neutral', lat: -30, lon: -71, iso: [152], fictional: false, baseStability: 72, produces: { CU: 0.35 }, blurb: 'Premier producteur mondial de cuivre.' },
  { id: 'ZA', name: 'Afrique du Sud', bloc: 'neutral', lat: -29, lon: 25, iso: [710], fictional: false, baseStability: 62, produces: { API2: 0.25 }, blurb: 'Exportateur de charbon par Richards Bay.' },
  // Zones fictives (remaniements d'acteurs réels)
  { id: 'SARM', name: 'Fédération de Sarmatie', bloc: 'east', lat: 60, lon: 75, iso: [], fictional: true, baseStability: 60, produces: { BRENT: 0.45, TTF: 0.5, API2: 0.3, WHEAT: 0.35, CU: 0.1 }, blurb: 'Géant énergétique et agricole en tension permanente avec l’Occident.' },
  { id: 'GULF', name: 'Royaumes du Golfe', bloc: 'neutral', lat: 24, lon: 46, iso: [], fictional: true, baseStability: 75, produces: { BRENT: 0.6, TTF: 0.25 }, blurb: 'Cœur du cartel des producteurs de pétrole.' },
  { id: 'KASS', name: 'République du Kassaï', bloc: 'neutral', lat: -7, lon: 25, iso: [], fictional: true, baseStability: 35, produces: { CU: 0.3 }, blurb: 'Ceinture de cuivre et de cobalt, régime instable.' },
  { id: 'TAUR', name: 'Tauride', bloc: 'neutral', lat: 48, lon: 34, iso: [], fictional: true, baseStability: 50, produces: { WHEAT: 0.4 }, blurb: 'Grenier à blé de la mer Noire, voisin inquiet de la Sarmatie.' },
  { id: 'INSU', name: 'Archipel d’Insulinde', bloc: 'neutral', lat: -2, lon: 115, iso: [], fictional: true, baseStability: 66, produces: { API2: 0.45, CU: 0.15 }, blurb: 'Premier exportateur de charbon thermique, tenté par le nationalisme minier.' },
];

export const ZONE_BY_ID: Record<string, ZoneDef> = Object.fromEntries(ZONES.map((z) => [z.id, z]));

/** Pays de chaque ville (identifiant de zone). */
export const CITY_ZONE: Record<string, string> = {
  geneva: 'CH', london: 'UK', rotterdam: 'NL', singapore: 'SG', houston: 'US', dubai: 'AE', shanghai: 'CN', chicago: 'US', santiago: 'CL', johannesburg: 'ZA',
};

/** Notations et probabilités de défaut annuelles (ordre de grandeur des agences). */
export const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'D'] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_PD: Record<Rating, number> = { AAA: 0.0001, AA: 0.0003, A: 0.0008, BBB: 0.0025, BB: 0.01, B: 0.04, CCC: 0.15, D: 1 };
