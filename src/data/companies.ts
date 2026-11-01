/**
 * Sociétés du monde : maisons de négoce, bras trading des majors, maisons agricoles, mineurs, banques,
 * hedge funds. Noms fictifs inspirés de sociétés réelles (clairement reconnaissables mais modifiés).
 * `ai: true` = concurrent simulé (bilan, positions, scandales, faillites, fusions).
 * Les autres sont des contreparties à notation fixe (producteurs, utilities, coopératives).
 */
import type { CommodityId } from '../engine/types';
import type { Rating } from './world';

export type CompanyKind = 'trader' | 'major' | 'agri' | 'miner' | 'bank' | 'fund' | 'producer' | 'utility';
export type Temperament = 'agressif' | 'prudent' | 'familial' | 'opaque' | 'procédurier' | 'discret';

export interface CompanyDef {
  id: string;
  name: string;
  cityId: string;
  zone?: string; // zone d'origine si différente du pays de la ville (contreparties étrangères)
  kind: CompanyKind;
  ai: boolean;
  desks: Partial<Record<CommodityId, number>>;
  capital: number; // fonds propres initiaux (USD)
  appetite: number; // 0..1
  reputation: number; // 0..100
  rating: Rating; // notation initiale
  temperament: Temperament;
  culture: string;
  star?: string; // trader vedette (rivalités nominatives)
  color: string;
}

export const COMPANIES: CompanyDef[] = [
  // ------------------------------------------------ maisons de négoce
  { id: 'glenmoor', name: 'Glenmoor', cityId: 'geneva', kind: 'trader', ai: true, desks: { CU: 1, API2: 0.9, BRENT: 0.6 }, capital: 3.2e9, appetite: 0.75, reputation: 55, rating: 'BBB', temperament: 'agressif', culture: 'Négociant-mineur intégré, réputé pour ses paris audacieux et ses ennuis judiciaires.', star: 'Ivan Kessler', color: '#e11d48' },
  { id: 'vitaro', name: 'Vitaro', cityId: 'geneva', kind: 'trader', ai: true, desks: { BRENT: 1, TTF: 0.7 }, capital: 2.6e9, appetite: 0.6, reputation: 62, rating: 'BBB', temperament: 'discret', culture: 'Premier négociant pétrolier indépendant ; partenariat discret, peu de bruit, beaucoup de barils.', star: 'Hugo Marchetti', color: '#2563eb' },
  { id: 'trafigera', name: 'Trafigera', cityId: 'singapore', kind: 'trader', ai: true, desks: { BRENT: 0.9, CU: 0.9 }, capital: 2.2e9, appetite: 0.7, reputation: 50, rating: 'BBB', temperament: 'opaque', culture: 'Pétrole et métaux, logistique propre, relations parfois sulfureuses avec les autorités.', star: 'Saskia Vann', color: '#0ea5e9' },
  { id: 'gunvald', name: 'Gunvald', cityId: 'geneva', kind: 'trader', ai: true, desks: { BRENT: 0.9, TTF: 0.8 }, capital: 1.4e9, appetite: 0.65, reputation: 52, rating: 'BB', temperament: 'agressif', culture: 'Énergie, historiquement très exposé à la Sarmatie.', star: 'Viktor Brandt', color: '#f59e0b' },
  { id: 'mercuris', name: 'Mercuris', cityId: 'geneva', kind: 'trader', ai: true, desks: { BRENT: 1, TTF: 0.6 }, capital: 1.1e9, appetite: 0.8, reputation: 58, rating: 'BB', temperament: 'agressif', culture: 'Jeune maison pétrolière à croissance fulgurante, preneuse de risques assumée.', star: 'Marco Dunne', color: '#8b5cf6' },
  { id: 'castlemoor', name: 'Castlemoor', cityId: 'london', kind: 'trader', ai: true, desks: { TTF: 1, BRENT: 0.6 }, capital: 0.9e9, appetite: 0.7, reputation: 60, rating: 'BB', temperament: 'discret', culture: 'Gaz et électricité, équipes quantitatives, rendements spectaculaires.', star: 'Aoife Clarke', color: '#14b8a6' },
  { id: 'heartree', name: 'Heartree', cityId: 'london', kind: 'trader', ai: true, desks: { TTF: 0.9, BRENT: 0.7, API2: 0.5 }, capital: 0.8e9, appetite: 0.6, reputation: 63, rating: 'BB', temperament: 'prudent', culture: 'Négociant multi-énergies issu d’un hedge fund, culture du risque rigoureuse.', star: 'Tom Ashby', color: '#22c55e' },
  { id: 'kochran', name: 'Kochran Supply & Trading', cityId: 'houston', kind: 'trader', ai: true, desks: { BRENT: 0.9, WHEAT: 0.4 }, capital: 2.0e9, appetite: 0.55, reputation: 57, rating: 'A', temperament: 'familial', culture: 'Bras trading d’un conglomérat familial américain, horizon long.', star: 'Wade Hollis', color: '#b45309' },
  { id: 'hinlong', name: 'Hin Long Trading', cityId: 'singapore', kind: 'trader', ai: true, desks: { BRENT: 1 }, capital: 0.5e9, appetite: 0.9, reputation: 48, rating: 'BB', temperament: 'opaque', culture: 'Empire familial du soutage et des produits pétroliers, croissance financée par la dette.', star: 'OK Lim', color: '#ef4444' },
  { id: 'straits', name: 'Straits Energy', cityId: 'singapore', kind: 'trader', ai: true, desks: { BRENT: 0.7, API2: 0.6 }, capital: 0.35e9, appetite: 0.6, reputation: 55, rating: 'BB', temperament: 'discret', culture: 'Négociant régional des produits et du charbon.', color: '#06b6d4' },
  { id: 'unisino', name: 'Unisino Trading', cityId: 'shanghai', kind: 'trader', ai: true, desks: { BRENT: 0.8, CU: 0.7, API2: 0.6 }, capital: 3.0e9, appetite: 0.5, reputation: 60, rating: 'A', temperament: 'procédurier', culture: 'Bras commercial d’un groupe d’État, volumes énormes, prudence politique.', star: 'Chen Wei', color: '#dc2626' },
  { id: 'yangtze', name: 'Yangtze Metals', cityId: 'shanghai', kind: 'trader', ai: true, desks: { CU: 1 }, capital: 0.6e9, appetite: 0.85, reputation: 45, rating: 'B', temperament: 'opaque', culture: 'Spécialiste du cuivre et du nickel, connu pour ses positions massives.', star: 'Xiang Lu', color: '#f97316' },
  // ------------------------------------------------ bras trading des majors
  { id: 'northsea', name: 'Nordhavn Petroleum Trading', cityId: 'london', kind: 'major', ai: true, desks: { BRENT: 1, TTF: 0.8 }, capital: 6e9, appetite: 0.4, reputation: 68, rating: 'AA', temperament: 'procédurier', culture: 'Bras trading d’une major européenne, conformité omniprésente.', color: '#16a34a' },
  { id: 'shellbourne', name: 'Shellbourne Trading', cityId: 'london', kind: 'major', ai: true, desks: { BRENT: 1, TTF: 1 }, capital: 8e9, appetite: 0.45, reputation: 66, rating: 'AA', temperament: 'procédurier', culture: 'Le plus grand trading floor énergétique d’une major, du GNL aux produits.', color: '#facc15' },
  { id: 'totalis', name: 'Totalis Trading', cityId: 'geneva', kind: 'major', ai: true, desks: { BRENT: 0.9, TTF: 0.7 }, capital: 5e9, appetite: 0.4, reputation: 64, rating: 'AA', temperament: 'procédurier', culture: 'Filiale genevoise d’une major française.', color: '#e11d48' },
  { id: 'gulfstar', name: 'Gulfstar Refining', cityId: 'houston', kind: 'major', ai: true, desks: { BRENT: 0.8 }, capital: 1.5e9, appetite: 0.35, reputation: 60, rating: 'A', temperament: 'prudent', culture: 'Raffineur du Golfe du Mexique, couvre ses marges de raffinage.', color: '#0284c7' },
  { id: 'emiroil', name: 'Emirates Bunker & Oil', cityId: 'dubai', kind: 'producer', ai: true, desks: { BRENT: 0.9 }, capital: 2.5e9, appetite: 0.4, reputation: 58, rating: 'A', temperament: 'discret', culture: 'Bras commercial d’un producteur du Golfe.', color: '#a16207' },
  // ------------------------------------------------ maisons agricoles
  { id: 'cargall', name: 'Cargall', cityId: 'chicago', kind: 'agri', ai: true, desks: { WHEAT: 1 }, capital: 4e9, appetite: 0.5, reputation: 62, rating: 'A', temperament: 'familial', culture: 'Géant familial des grains, discret et omniprésent.', star: 'Brent Nolan', color: '#65a30d' },
  { id: 'delfus', name: 'Louis Delfus', cityId: 'rotterdam', kind: 'agri', ai: true, desks: { WHEAT: 1 }, capital: 1.8e9, appetite: 0.5, reputation: 60, rating: 'BBB', temperament: 'familial', culture: 'Maison bicentenaire des grains et des softs.', star: 'Margaux Delfus', color: '#84cc16' },
  { id: 'bunje', name: 'Bunje', cityId: 'houston', kind: 'agri', ai: true, desks: { WHEAT: 0.9 }, capital: 1.6e9, appetite: 0.45, reputation: 59, rating: 'BBB', temperament: 'prudent', culture: 'Trituration et grains, maîtrise logistique.', color: '#4d7c0f' },
  { id: 'archer', name: 'Archer Midwest', cityId: 'chicago', kind: 'agri', ai: true, desks: { WHEAT: 0.9 }, capital: 2.4e9, appetite: 0.4, reputation: 61, rating: 'A', temperament: 'procédurier', culture: 'Transformateur agricole coté, très actif à Chicago.', color: '#15803d' },
  { id: 'cofaro', name: 'Cofaro', cityId: 'shanghai', kind: 'agri', ai: true, desks: { WHEAT: 0.9 }, capital: 2.0e9, appetite: 0.45, reputation: 55, rating: 'A', temperament: 'procédurier', culture: 'Négociant agricole d’État, sécurise l’approvisionnement national.', color: '#b91c1c' },
  // ------------------------------------------------ mineurs, banques, fonds
  { id: 'andescu', name: 'Andes Cobre', cityId: 'santiago', kind: 'miner', ai: true, desks: { CU: 1 }, capital: 2.5e9, appetite: 0.3, reputation: 60, rating: 'A', temperament: 'procédurier', culture: 'Mineur public de cuivre, vend sa production à terme.', color: '#c2410c' },
  { id: 'bln', name: 'Banque Lémanique de Négoce', cityId: 'geneva', kind: 'bank', ai: true, desks: { BRENT: 0.5, CU: 0.4, WHEAT: 0.4 }, capital: 6e9, appetite: 0.2, reputation: 65, rating: 'A', temperament: 'prudent', culture: 'Banque de trade finance historique du Léman.', color: '#1d4ed8' },
  { id: 'atlas', name: 'Atlas Commodities Bank', cityId: 'london', kind: 'bank', ai: true, desks: { BRENT: 0.6, TTF: 0.5, CU: 0.5 }, capital: 9e9, appetite: 0.25, reputation: 63, rating: 'A', temperament: 'procédurier', culture: 'Desk dérivés matières premières d’une grande banque d’investissement.', color: '#4338ca' },
  { id: 'orientpac', name: 'Orient Pacific Bank', cityId: 'singapore', kind: 'bank', ai: true, desks: { BRENT: 0.4, API2: 0.4, CU: 0.4 }, capital: 4e9, appetite: 0.3, reputation: 57, rating: 'BBB', temperament: 'discret', culture: 'Banque asiatique de financement du négoce.', color: '#7c3aed' },
  { id: 'brevan', name: 'Brevan Hollis', cityId: 'london', kind: 'fund', ai: true, desks: { BRENT: 0.7, CU: 0.7, TTF: 0.5 }, capital: 1.2e9, appetite: 0.85, reputation: 58, rating: 'BB', temperament: 'agressif', culture: 'Fonds macro : positions directionnelles, sorties brutales.', star: 'Nate Orwell', color: '#db2777' },
  { id: 'citadelle', name: 'Citadelle Capital', cityId: 'chicago', kind: 'fund', ai: true, desks: { TTF: 0.8, WHEAT: 0.6, BRENT: 0.6 }, capital: 2.5e9, appetite: 0.7, reputation: 61, rating: 'BBB', temperament: 'discret', culture: 'Fonds multi-stratégies, desk matières premières redouté.', star: 'Ray Calloway', color: '#0f766e' },
  // ------------------------------------------------ contreparties à notation fixe
  { id: 'huadian', name: 'Huanan Power', cityId: 'shanghai', kind: 'utility', ai: false, desks: { API2: 1 }, capital: 0, appetite: 0, reputation: 60, rating: 'A', temperament: 'procédurier', culture: 'Producteur d’électricité au charbon.', color: '#991b1b' },
  { id: 'rhineutil', name: 'Rhein Energie AG', cityId: 'rotterdam', kind: 'utility', ai: false, desks: { TTF: 1, API2: 0.6 }, capital: 0, appetite: 0, reputation: 66, rating: 'A', temperament: 'procédurier', culture: 'Énergéticien rhénan.', color: '#1e3a8a' },
  { id: 'lemanutil', name: 'Services Industriels du Léman', cityId: 'geneva', kind: 'utility', ai: false, desks: { TTF: 1 }, capital: 0, appetite: 0, reputation: 70, rating: 'AA', temperament: 'prudent', culture: 'Distributeur public de gaz et d’électricité.', color: '#0369a1' },
  { id: 'albion', name: 'Albion Gas Supply', cityId: 'london', kind: 'utility', ai: false, desks: { TTF: 1 }, capital: 0, appetite: 0, reputation: 55, rating: 'BB', temperament: 'agressif', culture: 'Fournisseur de gaz aux particuliers, marges minces.', color: '#7e22ce' },
  { id: 'prairie', name: 'Prairie Grain Coop', cityId: 'chicago', kind: 'producer', ai: false, desks: { WHEAT: 1 }, capital: 0, appetite: 0, reputation: 64, rating: 'BBB', temperament: 'familial', culture: 'Coopérative de céréaliers.', color: '#ca8a04' },
  { id: 'rbcoal', name: 'Zulu Coal Exports', cityId: 'johannesburg', kind: 'producer', ai: false, desks: { API2: 1 }, capital: 0, appetite: 0, reputation: 50, rating: 'BB', temperament: 'agressif', culture: 'Exportateur de charbon par Richards Bay.', color: '#374151' },
  { id: 'sarmneft', name: 'Sarmneft Export', cityId: 'rotterdam', zone: 'SARM', kind: 'producer', ai: false, desks: { BRENT: 1, TTF: 0.8 }, capital: 0, appetite: 0, reputation: 45, rating: 'BB', temperament: 'opaque', culture: 'Exportateur d’État sarmate, barils et gaz à prix cassés.', color: '#7f1d1d' },
  { id: 'taurgrain', name: 'Tauride Grain Export', cityId: 'dubai', zone: 'TAUR', kind: 'producer', ai: false, desks: { WHEAT: 1 }, capital: 0, appetite: 0, reputation: 52, rating: 'B', temperament: 'familial', culture: 'Exportateur de blé de la mer Noire.', color: '#a3e635' },
  { id: 'kassmine', name: 'Kassaï Mining Corp', cityId: 'santiago', zone: 'KASS', kind: 'producer', ai: false, desks: { CU: 1 }, capital: 0, appetite: 0, reputation: 38, rating: 'B', temperament: 'opaque', culture: 'Mineur d’État de la ceinture de cuivre.', color: '#92400e' },
  { id: 'insucoal', name: 'Insulinde Coal', cityId: 'shanghai', zone: 'INSU', kind: 'producer', ai: false, desks: { API2: 1 }, capital: 0, appetite: 0, reputation: 50, rating: 'BB', temperament: 'discret', culture: 'Exportateur de charbon thermique de l’archipel.', color: '#525252' },
];

export const COMPANY_BY_ID: Record<string, CompanyDef> = Object.fromEntries(COMPANIES.map((c) => [c.id, c]));
