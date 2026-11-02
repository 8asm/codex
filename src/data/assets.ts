/**
 * Catalogue des actifs industriels (noms fictifs). Valeurs : ordres de grandeur réalistes, simplifiés.
 * capacity : unités/jour (production, débit de raffinage, débit de terminal en t/j) ou unités stockables.
 */
import type { AssetType, CommodityId } from '../engine/types';

export interface AssetDef {
  id: string;
  type: AssetType;
  name: string;
  cityId: string;
  zone: string;
  locationId: string;
  commodity: CommodityId;
  capacity: number;
  capex: number; // coût de construction à 100 % (USD)
  opexPerUnit: number; // coût variable (unité de cotation par unité produite / stockée par mois)
  fixedMonthly: number; // coûts fixes mensuels à 100 % (USD)
  decline: number; // déclin annuel de la production
  lifeYears: number;
  buildDays: number;
  accidentPA: number;
  strikePA: number;
  crackMean?: number; // raffinerie : marge en % du Brent
  feePerT?: number; // terminal : redevance $/t
  freightIndex?: 'CAPE' | 'PMX' | 'SMX' | 'AFRA' | 'LNGC'; // navire
  lat?: number;
  lon?: number;
  blurb: string;
}

export const ASSET_DEFS: AssetDef[] = [
  { id: 'oil_permian', type: 'oilfield', name: 'Champ de schiste « Permian Ridge »', cityId: 'houston', zone: 'US', locationId: 'BRENT_USGC', commodity: 'BRENT', capacity: 8000, capex: 160e6, opexPerUnit: 44, fixedMonthly: 400_000, decline: 0.14, lifeYears: 12, buildDays: 220, accidentPA: 0.03, strikePA: 0.01, lat: 31.9, lon: -102.1, blurb: 'Puits de schiste : production rapide, déclin rapide.' },
  { id: 'oil_northsea', type: 'oilfield', name: 'Plateforme « Forties-B » (mer du Nord)', cityId: 'london', zone: 'UK', locationId: 'BRENT_RTM', commodity: 'BRENT', capacity: 6000, capex: 190e6, opexPerUnit: 35, fixedMonthly: 700_000, decline: 0.1, lifeYears: 14, buildDays: 400, accidentPA: 0.04, strikePA: 0.02, lat: 57.7, lon: 1.0, blurb: 'Champ mature offshore, livré au terminal de Rotterdam.' },
  { id: 'oil_gulf', type: 'oilfield', name: 'Concession « Wadi Sahra » (Golfe)', cityId: 'dubai', zone: 'GULF', locationId: 'BRENT_FUJ', commodity: 'BRENT', capacity: 30000, capex: 2.6e9, opexPerUnit: 10, fixedMonthly: 1_200_000, decline: 0.03, lifeYears: 20, buildDays: 500, accidentPA: 0.02, strikePA: 0.005, lat: 23.5, lon: 49, blurb: 'Brut conventionnel à très bas coût, partenariat avec l’État.' },
  { id: 'mine_cerro', type: 'mine_cu', name: 'Mine de cuivre « Cerro Azul »', cityId: 'santiago', zone: 'CL', locationId: 'CU_SCL', commodity: 'CU', capacity: 130, capex: 1.15e9, opexPerUnit: 5500, fixedMonthly: 2_000_000, decline: 0.02, lifeYears: 20, buildDays: 600, accidentPA: 0.03, strikePA: 0.06, lat: -24.3, lon: -69.1, blurb: 'Mine à ciel ouvert dans le désert d’Atacama. Syndicats puissants.' },
  { id: 'mine_kass', type: 'mine_cu', name: 'Mine « Kolwe Nord » (Kassaï)', cityId: 'johannesburg', zone: 'KASS', locationId: 'CU_DUR', commodity: 'CU', capacity: 160, capex: 1.0e9, opexPerUnit: 4400, fixedMonthly: 2_500_000, decline: 0.02, lifeYears: 18, buildDays: 550, accidentPA: 0.05, strikePA: 0.04, lat: -10.7, lon: 25.5, blurb: 'Gisement à haute teneur, pays instable : rendement élevé, risque de nationalisation.' },
  { id: 'coal_mpuma', type: 'mine_coal', name: 'Mine de charbon « Mpumalanga Ridge »', cityId: 'johannesburg', zone: 'ZA', locationId: 'COAL_RB', commodity: 'API2', capacity: 12000, capex: 250e6, opexPerUnit: 70, fixedMonthly: 1_500_000, decline: 0.02, lifeYears: 15, buildDays: 400, accidentPA: 0.04, strikePA: 0.05, lat: -26.0, lon: 29.3, blurb: 'Charbon exporté par rail vers Richards Bay.' },
  { id: 'coal_insu', type: 'mine_coal', name: 'Mine « Kalimantan Timur » (Insulinde)', cityId: 'shanghai', zone: 'INSU', locationId: 'COAL_CN', commodity: 'API2', capacity: 15000, capex: 300e6, opexPerUnit: 90, fixedMonthly: 1_800_000, decline: 0.02, lifeYears: 15, buildDays: 400, accidentPA: 0.04, strikePA: 0.02, lat: 0.5, lon: 117, blurb: 'Charbon livré CFR Chine. Sensible aux embargos et aux interdictions d’export.' },
  { id: 'ref_baytown', type: 'refinery', name: 'Raffinerie « Baytown »', cityId: 'houston', zone: 'US', locationId: 'BRENT_USGC', commodity: 'BRENT', capacity: 80000, capex: 450e6, opexPerUnit: 6, fixedMonthly: 1_500_000, decline: 0, lifeYears: 30, buildDays: 900, accidentPA: 0.05, strikePA: 0.01, crackMean: 0.12, lat: 29.73, lon: -95.0, blurb: 'Transforme le brut en produits : on vit de la marge de raffinage (crack).' },
  { id: 'tank_rtm', type: 'tank', name: 'Cuves pétrolières « Europoort »', cityId: 'rotterdam', zone: 'NL', locationId: 'BRENT_RTM', commodity: 'BRENT', capacity: 3_000_000, capex: 60e6, opexPerUnit: 0.12, fixedMonthly: 200_000, decline: 0, lifeYears: 30, buildDays: 300, accidentPA: 0.01, strikePA: 0.005, blurb: 'Stockage de brut : le contango se loue cher.' },
  { id: 'wh_rtm', type: 'warehouse', name: 'Entrepôt de métaux de Rotterdam', cityId: 'rotterdam', zone: 'NL', locationId: 'CU_RTM', commodity: 'CU', capacity: 40_000, capex: 38e6, opexPerUnit: 5, fixedMonthly: 100_000, decline: 0, lifeYears: 30, buildDays: 200, accidentPA: 0.005, strikePA: 0.01, blurb: 'Entrepôt agréé par la bourse des métaux.' },
  { id: 'silo_gulf', type: 'silo', name: 'Silos portuaires de Houston', cityId: 'houston', zone: 'US', locationId: 'WHT_GULF', commodity: 'WHEAT', capacity: 5_000_000, capex: 11e6, opexPerUnit: 1.2, fixedMonthly: 50_000, decline: 0, lifeYears: 30, buildDays: 200, accidentPA: 0.01, strikePA: 0.01, blurb: 'Élévateur portuaire d’export.' },
  { id: 'silo_chi', type: 'silo', name: 'Élévateur de Chicago', cityId: 'chicago', zone: 'US', locationId: 'WHT_CHI', commodity: 'WHEAT', capacity: 8_000_000, capex: 19e6, opexPerUnit: 1, fixedMonthly: 60_000, decline: 0, lifeYears: 30, buildDays: 200, accidentPA: 0.01, strikePA: 0.01, blurb: 'Élévateur agréé pour la livraison des futures de blé.' },
  { id: 'gas_berg', type: 'gas_storage', name: 'Stockage de gaz souterrain « Bergmeer »', cityId: 'rotterdam', zone: 'NL', locationId: 'TTF_HUB', commodity: 'TTF', capacity: 1_500_000, capex: 65e6, opexPerUnit: 0.05, fixedMonthly: 150_000, decline: 0, lifeYears: 30, buildDays: 500, accidentPA: 0.005, strikePA: 0.005, lat: 52.65, lon: 4.75, blurb: 'Injecter l’été, soutirer l’hiver : la valeur vient de l’écart saisonnier.' },
  { id: 'term_rb', type: 'terminal', name: 'Terminal charbonnier de Richards Bay', cityId: 'johannesburg', zone: 'ZA', locationId: 'COAL_RB', commodity: 'API2', capacity: 25_000, capex: 110e6, opexPerUnit: 0, fixedMonthly: 500_000, decline: 0, lifeYears: 30, buildDays: 500, accidentPA: 0.02, strikePA: 0.05, feePerT: 2.8, lat: -28.8, lon: 32.05, blurb: 'Redevances de passage ; nos propres cargaisons y évitent les surestaries.' },
  { id: 'vessel_afra', type: 'vessel', name: 'Pétrolier Aframax « TW Mistral »', cityId: 'singapore', zone: 'SG', locationId: 'BRENT_SIN', commodity: 'BRENT', capacity: 0, capex: 64e6, opexPerUnit: 0, fixedMonthly: 0, decline: 0, lifeYears: 20, buildDays: 600, accidentPA: 0.01, strikePA: 0, freightIndex: 'AFRA', blurb: 'Pétrolier de 600 kbbl : à affréter au marché ou à réserver à nos cargaisons.' },
  { id: 'vessel_pmx', type: 'vessel', name: 'Vraquier Panamax « TW Sirocco »', cityId: 'rotterdam', zone: 'NL', locationId: 'COAL_ARA', commodity: 'API2', capacity: 0, capex: 24e6, opexPerUnit: 0, fixedMonthly: 0, decline: 0, lifeYears: 20, buildDays: 500, accidentPA: 0.01, strikePA: 0, freightIndex: 'PMX', blurb: 'Vraquier de 75 000 t pour le charbon et les grains.' },
  { id: 'vessel_cape', type: 'vessel', name: 'Vraquier Capesize « TW Alizé »', cityId: 'shanghai', zone: 'CN', locationId: 'COAL_CN', commodity: 'API2', capacity: 0, capex: 45e6, opexPerUnit: 0, fixedMonthly: 0, decline: 0, lifeYears: 20, buildDays: 600, accidentPA: 0.01, strikePA: 0, freightIndex: 'CAPE', blurb: 'Le plus gros vraquier : 170 000 t, marché du fret très volatil.' },
  { id: 'vessel_smx', type: 'vessel', name: 'Vraquier Supramax « TW Bora »', cityId: 'singapore', zone: 'SG', locationId: 'CU_SIN', commodity: 'CU', capacity: 0, capex: 24e6, opexPerUnit: 0, fixedMonthly: 0, decline: 0, lifeYears: 20, buildDays: 450, accidentPA: 0.01, strikePA: 0, freightIndex: 'SMX', blurb: 'Vraquier polyvalent avec grues : cuivre, grains.' },
  // ------------------------------------------------ phase 8 : nouvelles familles d'actifs
  { id: 'mine_pilbara', type: 'mine', name: 'Mine de fer « Pilbara Nord »', cityId: 'perth', zone: 'AU', locationId: 'FE_PHED', commodity: 'FE', capacity: 60_000, capex: 3.2e9, opexPerUnit: 28, fixedMonthly: 9_000_000, decline: 0.01, lifeYears: 25, buildDays: 700, accidentPA: 0.02, strikePA: 0.01, lat: -22.6, lon: 118.3, blurb: 'Minerai à bas coût, rail privé jusqu’à Port Hedland. Tout dépend de l’acier chinois.' },
  { id: 'mine_atacama_li', type: 'mine', name: 'Salar de lithium « Atacama Sur »', cityId: 'santiago', zone: 'CL', locationId: 'LI_SCL', commodity: 'LI', capacity: 90, capex: 650e6, opexPerUnit: 5_500, fixedMonthly: 2_500_000, decline: 0, lifeYears: 25, buildDays: 650, accidentPA: 0.01, strikePA: 0.04, lat: -23.5, lon: -68.3, blurb: 'Évaporation de saumures : coûts bas, prix du lithium très volatil, redevances à l’État.' },
  { id: 'mine_ashanti', type: 'mine', name: 'Mine d’or « Ashanti Deep »', cityId: 'accra', zone: 'GH', locationId: 'AU_LDN', commodity: 'AU', capacity: 650, capex: 900e6, opexPerUnit: 1_250, fixedMonthly: 4_000_000, decline: 0.03, lifeYears: 15, buildDays: 600, accidentPA: 0.04, strikePA: 0.04, lat: 6.2, lon: -1.7, blurb: 'Mine souterraine : l’or est raffiné en Suisse et livré loco Londres.' },
  { id: 'mine_katanga_co', type: 'mine', name: 'Mine de cuivre-cobalt « Katanga Ouest »', cityId: 'lubumbashi', zone: 'KASS', locationId: 'CO_LUB', commodity: 'CO', capacity: 22, capex: 700e6, opexPerUnit: 14_000, fixedMonthly: 3_000_000, decline: 0.02, lifeYears: 18, buildDays: 600, accidentPA: 0.05, strikePA: 0.05, lat: -10.7, lon: 25.9, blurb: 'Cobalt en coproduit, risques politiques et éthiques maximaux.' },
  { id: 'plant_palm', type: 'plantation', name: 'Plantations de palme « Riau »', cityId: 'jakarta', zone: 'INSU', locationId: 'PALM_JKT', commodity: 'PALM', capacity: 900, capex: 420e6, opexPerUnit: 520, fixedMonthly: 1_200_000, decline: 0, lifeYears: 25, buildDays: 400, accidentPA: 0.02, strikePA: 0.02, lat: 0.5, lon: 101.4, blurb: 'Huile de palme brute pressée sur place. Taxes à l’export et campagnes contre la déforestation.' },
  { id: 'plant_coffee', type: 'plantation', name: 'Fazenda de café « Sul de Minas »', cityId: 'saopaulo', zone: 'BR', locationId: 'COF_SAN', commodity: 'COFFEE', capacity: 30_000, capex: 75e6, opexPerUnit: 145, fixedMonthly: 450_000, decline: 0, lifeYears: 25, buildDays: 300, accidentPA: 0.03, strikePA: 0.01, lat: -21.8, lon: -45.4, blurb: 'Arabica naturel : une gelée de juin peut ruiner la récolte… et faire flamber les prix.' },
  { id: 'plant_cocoa', type: 'plantation', name: 'Coopératives de cacao « San Pedro »', cityId: 'abidjan', zone: 'CI', locationId: 'COC_ABJ', commodity: 'COCOA', capacity: 45, capex: 90e6, opexPerUnit: 3_200, fixedMonthly: 500_000, decline: 0, lifeYears: 20, buildDays: 300, accidentPA: 0.03, strikePA: 0.03, lat: 4.75, lon: -6.6, blurb: 'Achats bord-champ au prix fixé par l’Office, revente au marché mondial.' },
  { id: 'mill_sugar', type: 'plantation', name: 'Sucrerie « Ribeirão Preto »', cityId: 'saopaulo', zone: 'BR', locationId: 'SUG_SAN', commodity: 'SUGAR', capacity: 3_500_000, capex: 380e6, opexPerUnit: 14, fixedMonthly: 1_800_000, decline: 0, lifeYears: 30, buildDays: 500, accidentPA: 0.02, strikePA: 0.01, lat: -21.2, lon: -47.8, blurb: 'Canne broyée en sucre brut ; l’éthanol sert de soupape quand le sucre baisse.' },
  { id: 'crush_rosario', type: 'crush', name: 'Usine de trituration « Rosario Norte »', cityId: 'buenosaires', zone: 'AR', locationId: 'SOY_AR', commodity: 'SOY', capacity: 360_000, capex: 520e6, opexPerUnit: 0.42, fixedMonthly: 2_200_000, decline: 0, lifeYears: 30, buildDays: 700, accidentPA: 0.02, strikePA: 0.04, lat: -32.9, lon: -60.7, blurb: 'Soja → farine + huile : on vit de la marge de trituration (crush), couvrable sur les trois futures.' },
  { id: 'crush_decatur', type: 'crush', name: 'Usine de trituration « Decatur »', cityId: 'chicago', zone: 'US', locationId: 'SOY_CHI', commodity: 'SOY', capacity: 220_000, capex: 380e6, opexPerUnit: 0.38, fixedMonthly: 1_500_000, decline: 0, lifeYears: 30, buildDays: 650, accidentPA: 0.02, strikePA: 0.01, lat: 39.8, lon: -88.9, blurb: 'Au cœur de la Corn Belt, l’huile part vers le biodiesel.' },
  { id: 'ccgt_rhein', type: 'powerplant', name: 'Centrale à cycle combiné « Rheinhafen »', cityId: 'frankfurt', zone: 'DE', locationId: 'PWR_DE', commodity: 'POWER', capacity: 19_200, capex: 650e6, opexPerUnit: 3, fixedMonthly: 1_400_000, decline: 0, lifeYears: 30, buildDays: 900, accidentPA: 0.02, strikePA: 0.01, lat: 49.0, lon: 8.4, blurb: '800 MW à 55 % de rendement : ne tourne que quand électricité − gaz − carbone est positif (une option sur le spark spread).' },
  { id: 'smelter_elbe', type: 'smelter', name: 'Fonderie d’aluminium « Elbe »', cityId: 'hamburg', zone: 'DE', locationId: 'AL_RTM', commodity: 'AL', capacity: 600, capex: 900e6, opexPerUnit: 260, fixedMonthly: 2_000_000, decline: 0, lifeYears: 30, buildDays: 900, accidentPA: 0.02, strikePA: 0.02, lat: 53.5, lon: 9.9, blurb: '14 MWh par tonne : quand l’électricité flambe, la fonderie s’arrête (et revend son électricité).' },
  { id: 'vessel_lngc', type: 'vessel', name: 'Méthanier « TW Boréas »', cityId: 'doha', zone: 'GULF', locationId: 'JKM_RAS', commodity: 'JKM', capacity: 0, capex: 230e6, opexPerUnit: 0, fixedMonthly: 0, decline: 0, lifeYears: 25, buildDays: 900, accidentPA: 0.01, strikePA: 0, freightIndex: 'LNGC', blurb: '174 000 m³ : affrètement à prix d’or en hiver asiatique, ou transport de nos propres cargaisons.' },
];

export const ASSET_DEF_BY_ID: Record<string, AssetDef> = Object.fromEntries(ASSET_DEFS.map((d) => [d.id, d]));

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  oilfield: 'Gisement pétrolier', mine_cu: 'Mine de cuivre', mine_coal: 'Mine de charbon', refinery: 'Raffinerie', tank: 'Cuves de stockage',
  warehouse: 'Entrepôt de métaux', silo: 'Silos', gas_storage: 'Stockage de gaz', terminal: 'Terminal portuaire', vessel: 'Navire',
  mine: 'Mine', plantation: 'Plantation / sucrerie', crush: 'Usine de trituration', powerplant: 'Centrale électrique', smelter: 'Fonderie d’aluminium',
};

export const MANAGER_NAMES = [
  'Ingrid Solberg', 'Rafael Ortega', 'Amara Nwosu', 'Pieter de Vries', 'Mei Tanaka', 'Hamid Rezaei', 'Lucía Fernández', 'Gregor Novak', 'Thandiwe Dube', 'Oliver Brennan',
  'Yusuf Demir', 'Camille Laurent', 'Arjun Mehta', 'Sofia Rossi', 'Dmitri Volkov', 'Grace Owusu', 'Lars Eriksen', 'Ana Paula Costa', 'Kwame Asante', 'Hélène Marchal',
];
