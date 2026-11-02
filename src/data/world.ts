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
  // Phase 8 : pays des nouvelles villes
  { id: 'FR', name: 'France', bloc: 'west', lat: 46.5, lon: 2.5, iso: [250], fictional: false, baseStability: 82, produces: { POWER: 0.3, WHEAT: 0.2 }, blurb: 'Électricité nucléaire et premier producteur de blé de l’Union.' },
  { id: 'DE', name: 'Allemagne', bloc: 'west', lat: 51, lon: 10.3, iso: [276], fictional: false, baseStability: 90, produces: { POWER: 0.4 }, blurb: 'Premier consommateur d’énergie d’Europe.' },
  { id: 'NO', name: 'Norvège', bloc: 'west', lat: 62, lon: 9, iso: [578], fictional: false, baseStability: 95, produces: { BRENT: 0.2, TTF: 0.35 }, blurb: 'Gaz et pétrole de la mer du Nord, fonds souverain géant.' },
  { id: 'TR', name: 'Turquie', bloc: 'neutral', lat: 39, lon: 35, iso: [792], fictional: false, baseStability: 65, produces: {}, blurb: 'Gardienne du Bosphore, entre deux blocs.' },
  { id: 'GR', name: 'Grèce', bloc: 'west', lat: 39, lon: 22, iso: [300], fictional: false, baseStability: 78, produces: {}, blurb: 'Armateurs et flotte marchande.' },
  { id: 'ES', name: 'Espagne', bloc: 'west', lat: 40, lon: -3.7, iso: [724], fictional: false, baseStability: 85, produces: {}, blurb: 'Solaire, terminaux GNL, huile d’olive.' },
  { id: 'IT', name: 'Italie', bloc: 'west', lat: 42.8, lon: 12.5, iso: [380], fictional: false, baseStability: 78, produces: {}, blurb: 'Gaz méditerranéen, industrie.' },
  { id: 'AT', name: 'Autriche', bloc: 'west', lat: 47.5, lon: 14.5, iso: [40], fictional: false, baseStability: 92, produces: {}, blurb: 'Hub gazier d’Europe centrale.' },
  { id: 'PL', name: 'Pologne', bloc: 'west', lat: 52, lon: 19, iso: [616], fictional: false, baseStability: 84, produces: { API2: 0.1 }, blurb: 'Charbon et électricité.' },
  { id: 'OM', name: 'Oman', bloc: 'neutral', lat: 21, lon: 57, iso: [512], fictional: false, baseStability: 80, produces: { DUBAI: 0.2 }, blurb: 'Brut d’Oman, référence pour l’Asie.' },
  { id: 'AZ', name: 'Azerbaïdjan', bloc: 'neutral', lat: 40.3, lon: 47.7, iso: [31], fictional: false, baseStability: 62, produces: { BRENT: 0.05 }, blurb: 'Pétrole de la Caspienne.' },
  { id: 'EG', name: 'Égypte', bloc: 'neutral', lat: 26.8, lon: 30.8, iso: [818], fictional: false, baseStability: 58, produces: {}, blurb: 'Le canal de Suez, importateur de blé.' },
  { id: 'NG', name: 'Nigeria', bloc: 'neutral', lat: 9, lon: 8, iso: [566], fictional: false, baseStability: 45, produces: { BRENT: 0.1 }, blurb: 'Brut léger d’Afrique de l’Ouest.' },
  { id: 'CI', name: 'Côte d’Ivoire', bloc: 'neutral', lat: 7.5, lon: -5.5, iso: [384], fictional: false, baseStability: 60, produces: { COCOA: 0.45 }, blurb: 'Premier producteur de cacao.' },
  { id: 'GH', name: 'Ghana', bloc: 'neutral', lat: 7.9, lon: -1, iso: [288], fictional: false, baseStability: 66, produces: { COCOA: 0.2, AU: 0.05 }, blurb: 'Cacao et or.' },
  { id: 'KE', name: 'Kenya', bloc: 'neutral', lat: 0.2, lon: 37.9, iso: [404], fictional: false, baseStability: 62, produces: { COFFEE: 0.03 }, blurb: 'Thé et café d’Afrique de l’Est.' },
  { id: 'AO', name: 'Angola', bloc: 'neutral', lat: -12.3, lon: 17.5, iso: [24], fictional: false, baseStability: 50, produces: { BRENT: 0.05 }, blurb: 'Brut offshore vendu à l’Asie.' },
  { id: 'IN', name: 'Inde', bloc: 'neutral', lat: 21, lon: 78, iso: [356], fictional: false, baseStability: 72, produces: { SUGAR: 0.2, COTTON: 0.25, RICE: 0.2 }, blurb: 'Géant importateur d’énergie, exportateur de riz et de sucre.' },
  { id: 'PK', name: 'Pakistan', bloc: 'neutral', lat: 30, lon: 70, iso: [586], fictional: false, baseStability: 45, produces: { COTTON: 0.08, RICE: 0.08 }, blurb: 'Coton et riz.' },
  { id: 'JP', name: 'Japon', bloc: 'west', lat: 36, lon: 138, iso: [392], fictional: false, baseStability: 92, produces: {}, blurb: 'Premier importateur de GNL.' },
  { id: 'KR', name: 'Corée du Sud', bloc: 'west', lat: 36.5, lon: 127.8, iso: [410], fictional: false, baseStability: 82, produces: {}, blurb: 'Raffinage, chantiers navals.' },
  { id: 'MY', name: 'Malaisie', bloc: 'neutral', lat: 4, lon: 102, iso: [458], fictional: false, baseStability: 75, produces: { PALM: 0.3, SN: 0.1 }, blurb: 'Huile de palme et étain.' },
  { id: 'TH', name: 'Thaïlande', bloc: 'neutral', lat: 15.5, lon: 101, iso: [764], fictional: false, baseStability: 62, produces: { RICE: 0.25, SUGAR: 0.15 }, blurb: 'Riz et sucre.' },
  { id: 'VN', name: 'Viêt Nam', bloc: 'neutral', lat: 16, lon: 106.5, iso: [704], fictional: false, baseStability: 72, produces: { COFFEE: 0.2, RICE: 0.15 }, blurb: 'Robusta et riz.' },
  { id: 'PH', name: 'Philippines', bloc: 'neutral', lat: 12.5, lon: 122, iso: [608], fictional: false, baseStability: 60, produces: { NI: 0.1 }, blurb: 'Nickel latéritique.' },
  { id: 'KZ', name: 'Kazakhstan', bloc: 'neutral', lat: 48, lon: 67, iso: [398], fictional: false, baseStability: 60, produces: { WHEAT: 0.08, BRENT: 0.05 }, blurb: 'Pétrole, uranium, blé des steppes.' },
  { id: 'AU', name: 'Australie', bloc: 'west', lat: -25, lon: 134, iso: [36], fictional: false, baseStability: 92, produces: { NEWC: 0.5, FE: 0.5, LI: 0.4, METCOAL: 0.5, JKM: 0.3, AU: 0.1 }, blurb: 'Charbon, minerai de fer, GNL, lithium.' },
  { id: 'NZ', name: 'Nouvelle-Zélande', bloc: 'west', lat: -41, lon: 174, iso: [554], fictional: false, baseStability: 95, produces: {}, blurb: 'Agriculture d’exportation.' },
  { id: 'CA', name: 'Canada', bloc: 'west', lat: 56, lon: -106, iso: [124], fictional: false, baseStability: 90, produces: { WTI: 0.15, WHEAT: 0.1, NI: 0.05 }, blurb: 'Sables bitumineux, blé, mines.' },
  { id: 'MX', name: 'Mexique', bloc: 'neutral', lat: 23.6, lon: -102.5, iso: [484], fictional: false, baseStability: 62, produces: { AG: 0.25 }, blurb: 'Pétrole d’État et argent.' },
  { id: 'BR', name: 'Brésil', bloc: 'neutral', lat: -10, lon: -52, iso: [76], fictional: false, baseStability: 64, produces: { SOY: 0.4, SUGAR: 0.4, COFFEE: 0.35, FE: 0.25, CORN: 0.15, OJ: 0.6 }, blurb: 'Soja, sucre, café, jus d’orange, minerai de fer.' },
  { id: 'AR', name: 'Argentine', bloc: 'neutral', lat: -36, lon: -64, iso: [32], fictional: false, baseStability: 52, produces: { SOY: 0.15, SOYMEAL: 0.4, SOYOIL: 0.4, CORN: 0.1 }, blurb: 'Farine et huile de soja.' },
  { id: 'PE', name: 'Pérou', bloc: 'neutral', lat: -9.2, lon: -75, iso: [604], fictional: false, baseStability: 55, produces: { CU: 0.1, ZN: 0.1, AU: 0.03 }, blurb: 'Cuivre, zinc, or.' },
  { id: 'CO', name: 'Colombie', bloc: 'neutral', lat: 4.6, lon: -74.3, iso: [170], fictional: false, baseStability: 58, produces: { COFFEE: 0.1 }, blurb: 'Café lavé, charbon.' },
  { id: 'VE', name: 'Venezuela', bloc: 'neutral', lat: 7, lon: -66, iso: [862], fictional: false, baseStability: 25, produces: { WTI: 0.05 }, blurb: 'Réserves géantes, production effondrée.' },
  { id: 'PA', name: 'Panama', bloc: 'neutral', lat: 8.5, lon: -80, iso: [591], fictional: false, baseStability: 72, produces: {}, blurb: 'Le canal et les pavillons.' },
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
  zug: 'CH', lugano: 'CH', paris: 'FR', hamburg: 'DE', frankfurt: 'DE', oslo: 'NO', moscow: 'SARM', istanbul: 'TR', athens: 'GR', madrid: 'ES', milan: 'IT',
  vienna: 'AT', warsaw: 'PL', riyadh: 'GULF', doha: 'GULF', muscat: 'OM', baku: 'AZ', cairo: 'EG', lagos: 'NG', abidjan: 'CI', accra: 'GH', nairobi: 'KE',
  lubumbashi: 'KASS', luanda: 'AO', mumbai: 'IN', karachi: 'PK', hongkong: 'CN', tokyo: 'JP', seoul: 'KR', beijing: 'CN', dalian: 'CN', jakarta: 'INSU',
  kualalumpur: 'MY', bangkok: 'TH', hochiminh: 'VN', manila: 'PH', almaty: 'KZ', sydney: 'AU', perth: 'AU', auckland: 'NZ', newyork: 'US', calgary: 'CA',
  toronto: 'CA', vancouver: 'CA', mexicocity: 'MX', saopaulo: 'BR', buenosaires: 'AR', lima: 'PE', bogota: 'CO', caracas: 'VE', panama: 'PA',
};

/** Notations et probabilités de défaut annuelles (ordre de grandeur des agences). */
export const RATINGS = ['AAA', 'AA', 'A', 'BBB', 'BB', 'B', 'CCC', 'D'] as const;
export type Rating = (typeof RATINGS)[number];
export const RATING_PD: Record<Rating, number> = { AAA: 0.0001, AA: 0.0003, A: 0.0008, BBB: 0.0025, BB: 0.01, B: 0.04, CCC: 0.15, D: 1 };
