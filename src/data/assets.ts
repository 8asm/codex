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
  freightIndex?: 'CAPE' | 'PMX' | 'SMX' | 'AFRA'; // navire
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
];

export const ASSET_DEF_BY_ID: Record<string, AssetDef> = Object.fromEntries(ASSET_DEFS.map((d) => [d.id, d]));

export const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  oilfield: 'Gisement pétrolier', mine_cu: 'Mine de cuivre', mine_coal: 'Mine de charbon', refinery: 'Raffinerie', tank: 'Cuves de stockage',
  warehouse: 'Entrepôt de métaux', silo: 'Silos', gas_storage: 'Stockage de gaz', terminal: 'Terminal portuaire', vessel: 'Navire',
};

export const MANAGER_NAMES = [
  'Ingrid Solberg', 'Rafael Ortega', 'Amara Nwosu', 'Pieter de Vries', 'Mei Tanaka', 'Hamid Rezaei', 'Lucía Fernández', 'Gregor Novak', 'Thandiwe Dube', 'Oliver Brennan',
  'Yusuf Demir', 'Camille Laurent', 'Arjun Mehta', 'Sofia Rossi', 'Dmitri Volkov', 'Grace Owusu', 'Lars Eriksen', 'Ana Paula Costa', 'Kwame Asante', 'Hélène Marchal',
];
