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
  // ------------------------------------------------ phase 8 : nouveaux marchés
  { id: 'mitsuhana', name: 'Mitsuhana Corporation', cityId: 'tokyo', kind: 'trader', ai: true, desks: { JKM: 1, NEWC: 0.8, FE: 0.6, AL: 0.5, DUBAI: 0.6 }, capital: 7e9, appetite: 0.35, reputation: 66, rating: 'A', temperament: 'procédurier', culture: 'Maison de commerce japonaise (sogo shosha) : GNL, charbon, métaux, participations partout.', star: 'Kenji Morimoto', color: '#dc2626' },
  { id: 'wilmore', name: 'Wilmore International', cityId: 'singapore', kind: 'agri', ai: true, desks: { PALM: 1, SOY: 0.7, SOYOIL: 0.8, SUGAR: 0.6, RICE: 0.4 }, capital: 3.5e9, appetite: 0.5, reputation: 58, rating: 'BBB', temperament: 'familial', culture: 'Géant asiatique des huiles végétales, de la plantation au rayon.', color: '#16a34a' },
  { id: 'olamaro', name: 'Olamaro Agri', cityId: 'singapore', kind: 'agri', ai: true, desks: { COCOA: 1, COFFEE: 0.9, COTTON: 0.8, RICE: 0.5 }, capital: 1.6e9, appetite: 0.6, reputation: 54, rating: 'BB', temperament: 'agressif', culture: 'Négociant des softs né en Afrique de l’Ouest : cacao, café, coton, noix de cajou.', star: 'Ravi Menon', color: '#ca8a04' },
  { id: 'neuhafen', name: 'Neuhafen Kaffee Gruppe', cityId: 'hamburg', kind: 'agri', ai: true, desks: { COFFEE: 1 }, capital: 0.6e9, appetite: 0.45, reputation: 62, rating: 'BBB', temperament: 'familial', culture: 'Premier négociant de café vert du monde, maison familiale hambourgeoise.', color: '#78350f' },
  { id: 'sucdenor', name: 'Sucdenor', cityId: 'paris', kind: 'agri', ai: true, desks: { SUGAR: 1, COCOA: 0.6, COFFEE: 0.4 }, capital: 0.7e9, appetite: 0.55, reputation: 57, rating: 'BB', temperament: 'discret', culture: 'Maison parisienne du sucre et des softs, très présente sur les futures.', color: '#a855f7' },
  { id: 'callebart', name: 'Callebart Chocolat', cityId: 'zug', kind: 'agri', ai: true, desks: { COCOA: 1, SUGAR: 0.4 }, capital: 1.2e9, appetite: 0.35, reputation: 64, rating: 'BBB', temperament: 'prudent', culture: 'Premier transformateur de cacao : achète des récoltes entières et couvre tout.', color: '#92400e' },
  { id: 'traxis', name: 'Traxis Metals', cityId: 'zug', kind: 'trader', ai: true, desks: { ZN: 1, PB: 0.9, NI: 0.7, CO: 0.8, AL: 0.6, CU: 0.6 }, capital: 1.8e9, appetite: 0.75, reputation: 50, rating: 'BB', temperament: 'opaque', culture: 'Concentrés et métaux de base, mines en Afrique et en Amérique latine.', star: 'Paul Wren', color: '#0f766e' },
  { id: 'aurovalt', name: 'Aurovalt Refinery', cityId: 'lugano', kind: 'trader', ai: true, desks: { AU: 1, AG: 0.8 }, capital: 0.9e9, appetite: 0.3, reputation: 67, rating: 'A', temperament: 'discret', culture: 'Raffineur et négociant de métaux précieux du Tessin.', color: '#eab308' },
  { id: 'reliant', name: 'Reliant Petro', cityId: 'mumbai', kind: 'major', ai: true, desks: { DUBAI: 1, GASOIL: 0.9, GASOLINE: 0.8, JET: 0.6 }, capital: 6e9, appetite: 0.4, reputation: 60, rating: 'BBB', temperament: 'procédurier', culture: 'Le plus grand complexe de raffinage du monde : achète du brut sanctionné quand il est bradé.', color: '#1d4ed8' },
  { id: 'suedwerk', name: 'Südwerk Energie', cityId: 'frankfurt', kind: 'utility', ai: true, desks: { POWER: 1, EUA: 0.9, TTF: 0.8, API2: 0.6 }, capital: 3e9, appetite: 0.35, reputation: 61, rating: 'BBB', temperament: 'procédurier', culture: 'Énergéticien allemand : centrales, renouvelables, desk de trading d’électricité.', color: '#7c3aed' },
  { id: 'pilbara', name: 'Rio Pilbara Mining', cityId: 'perth', kind: 'miner', ai: true, desks: { FE: 1, AL: 0.5, CU: 0.4, LI: 0.4 }, capital: 9e9, appetite: 0.25, reputation: 60, rating: 'A', temperament: 'procédurier', culture: 'Minerai de fer du Pilbara, bauxite et cuivre ; contrats de long terme avec les aciéristes chinois.', color: '#b91c1c' },
  { id: 'vallemar', name: 'Vallemar', cityId: 'saopaulo', kind: 'miner', ai: true, desks: { FE: 1, NI: 0.6 }, capital: 6e9, appetite: 0.3, reputation: 52, rating: 'BBB', temperament: 'procédurier', culture: 'Mineur brésilien de fer et de nickel, marqué par des ruptures de barrages.', color: '#15803d' },
  { id: 'gasplata', name: 'Aceitera del Plata', cityId: 'buenosaires', kind: 'producer', ai: false, desks: { SOYMEAL: 1, SOYOIL: 1, SOY: 0.7, CORN: 0.6 }, capital: 0, appetite: 0, reputation: 52, rating: 'B', temperament: 'familial', culture: 'Triturateur argentin sur le Paraná, sous contrôle des changes.', color: '#0284c7' },
  { id: 'raizal', name: 'Raizal Açúcar e Energia', cityId: 'saopaulo', kind: 'producer', ai: false, desks: { SUGAR: 1, CORN: 0.4, COFFEE: 0.3 }, capital: 0, appetite: 0, reputation: 58, rating: 'BB', temperament: 'prudent', culture: 'Usines de canne : sucre ou éthanol selon le prix.', color: '#65a30d' },
  { id: 'cocoboard', name: 'Office ivoirien du café-cacao', cityId: 'abidjan', kind: 'producer', ai: false, desks: { COCOA: 1, COFFEE: 0.3 }, capital: 0, appetite: 0, reputation: 50, rating: 'BB', temperament: 'procédurier', culture: 'Vend la récolte à l’avance aux négociants ; fixe le prix payé aux planteurs.', color: '#f97316' },
  { id: 'raslng', name: 'Ras Gas Marketing', cityId: 'doha', kind: 'producer', ai: false, desks: { JKM: 1 }, capital: 0, appetite: 0, reputation: 62, rating: 'AA', temperament: 'discret', culture: 'Premier vendeur de GNL du monde, contrats indexés sur le pétrole.', color: '#7e22ce' },
  { id: 'sabinelng', name: 'Sabine Liquefaction', cityId: 'houston', kind: 'producer', ai: false, desks: { JKM: 1, HH: 1 }, capital: 0, appetite: 0, reputation: 58, rating: 'BBB', temperament: 'prudent', culture: 'Usine de liquéfaction du Golfe : achète du Henry Hub, vend du GNL FOB.', color: '#0369a1' },
  { id: 'appalgas', name: 'Appalachian Gas Producers', cityId: 'newyork', kind: 'producer', ai: false, desks: { HH: 1 }, capital: 0, appetite: 0, reputation: 50, rating: 'BB', temperament: 'agressif', culture: 'Gaz de schiste du Marcellus, endetté et très couvert.', color: '#0891b2' },
  // ------------------------------------------------ agences d'État (appels d'offres publics, phase 11)
  { id: 'gov_eg', name: 'Office public des céréales (Égypte)', cityId: 'cairo', kind: 'utility', ai: false, desks: { WHEAT: 1, CORN: 0.6, SUGAR: 0.4 }, capital: 0, appetite: 0, reputation: 60, rating: 'BB', temperament: 'procédurier', culture: 'Premier acheteur de blé au monde, par appels d’offres réguliers.', color: '#a16207' },
  { id: 'gov_in', name: 'Réserve stratégique de l’Inde', cityId: 'mumbai', kind: 'utility', ai: false, desks: { BRENT: 1, DUBAI: 0.8, RICE: 0.4, GASOIL: 0.4 }, capital: 0, appetite: 0, reputation: 62, rating: 'BBB', temperament: 'procédurier', culture: 'Remplit les cavernes de brut quand les prix baissent.', color: '#ea580c' },
  { id: 'gov_cn', name: 'Bureau des réserves d’État (Chine)', cityId: 'beijing', kind: 'utility', ai: false, desks: { CU: 1, AL: 0.6, SOY: 0.8, CORN: 0.6, BRENT: 0.6, WHEAT: 0.5 }, capital: 0, appetite: 0, reputation: 58, rating: 'A', temperament: 'opaque', culture: 'Achète et revend des métaux et des grains pour lisser les prix intérieurs.', color: '#dc2626' },
  { id: 'gov_jp', name: 'Agence des réserves énergétiques (Japon)', cityId: 'tokyo', kind: 'utility', ai: false, desks: { BRENT: 0.8, JKM: 1, API2: 0.5 }, capital: 0, appetite: 0, reputation: 70, rating: 'A', temperament: 'procédurier', culture: 'Sécurité d’approvisionnement avant tout : contrats longs, paiements impeccables.', color: '#be123c' },
  { id: 'gov_pk', name: 'Office d’État des carburants (Pakistan)', cityId: 'karachi', kind: 'utility', ai: false, desks: { GASOIL: 1, FUELOIL: 0.8, JKM: 0.6, BRENT: 0.4 }, capital: 0, appetite: 0, reputation: 45, rating: 'B', temperament: 'opaque', culture: 'Appels d’offres fréquents… et paiements parfois lents.', color: '#15803d' },
  { id: 'gov_ng', name: 'Compagnie pétrolière d’État (Nigeria)', cityId: 'lagos', kind: 'producer', ai: false, desks: { BRENT: 1, GASOLINE: 0.5 }, capital: 0, appetite: 0, reputation: 42, rating: 'B', temperament: 'opaque', culture: 'Vend ses cargaisons de brut par appels d’offres, importe son essence.', color: '#166534' },
  { id: 'gov_gulf', name: 'Compagnie nationale du Golfe', cityId: 'riyadh', kind: 'producer', ai: false, desks: { BRENT: 1, DUBAI: 1 }, capital: 0, appetite: 0, reputation: 66, rating: 'A', temperament: 'discret', culture: 'Vend son brut aux prix officiels ; quelques cargaisons au plus offrant.', color: '#065f46' },
  { id: 'gov_cl', name: 'Société d’État du cuivre (Chili)', cityId: 'santiago', kind: 'miner', ai: false, desks: { CU: 1 }, capital: 0, appetite: 0, reputation: 64, rating: 'A', temperament: 'procédurier', culture: 'Premier producteur de cuivre, ventes par contrats annuels et lots spot.', color: '#b45309' },
  { id: 'gov_de', name: 'Agence fédérale des stocks stratégiques', cityId: 'frankfurt', kind: 'utility', ai: false, desks: { TTF: 1, GASOIL: 0.8, BRENT: 0.4 }, capital: 0, appetite: 0, reputation: 72, rating: 'A', temperament: 'procédurier', culture: 'Remplit les stockages de gaz avant l’hiver, par enchères.', color: '#1d4ed8' },
  { id: 'gov_br', name: 'Compagnie nationale d’approvisionnement (Brésil)', cityId: 'saopaulo', kind: 'agri', ai: false, desks: { SOY: 1, CORN: 0.8, SUGAR: 0.8, COFFEE: 0.5 }, capital: 0, appetite: 0, reputation: 55, rating: 'BB', temperament: 'familial', culture: 'Écoule les stocks publics de grains et de sucre.', color: '#16a34a' },
  { id: 'gauleelec', name: 'Électricité de Gaule', cityId: 'paris', kind: 'utility', ai: false, desks: { POWER: 1, EUA: 0.6 }, capital: 0, appetite: 0, reputation: 64, rating: 'A', temperament: 'procédurier', culture: 'Parc nucléaire national ; exporte l’été, importe l’hiver.', color: '#2563eb' },
  { id: 'kantopower', name: 'Kanto Power & Gas', cityId: 'tokyo', kind: 'utility', ai: false, desks: { JKM: 1, NEWC: 1, DUBAI: 0.4 }, capital: 0, appetite: 0, reputation: 63, rating: 'A', temperament: 'prudent', culture: 'Premier acheteur de GNL et de charbon du Japon.', color: '#e11d48' },
  { id: 'katangaco', name: 'Katanga Cobalt Holdings', cityId: 'lubumbashi', kind: 'producer', ai: false, desks: { CO: 1, CU: 0.7 }, capital: 0, appetite: 0, reputation: 32, rating: 'CCC', temperament: 'opaque', culture: 'Cobalt artisanal et industriel, actionnaires invisibles.', color: '#1e40af' },
  { id: 'atacamali', name: 'Atacama Litio', cityId: 'santiago', kind: 'producer', ai: false, desks: { LI: 1 }, capital: 0, appetite: 0, reputation: 56, rating: 'BBB', temperament: 'prudent', culture: 'Saumures du désert d’Atacama.', color: '#db2777' },
  { id: 'insupalm', name: 'Insulinde Palm & Nickel', cityId: 'jakarta', zone: 'INSU', kind: 'producer', ai: false, desks: { PALM: 1, NI: 0.8, SN: 0.6 }, capital: 0, appetite: 0, reputation: 48, rating: 'BB', temperament: 'opaque', culture: 'Conglomérat : plantations et fonderies de nickel, très proche du pouvoir.', color: '#059669' },
  { id: 'sarmetal', name: 'Sarm Nickel & Palladium', cityId: 'moscow', zone: 'SARM', kind: 'producer', ai: false, desks: { NI: 1, AL: 0.6, CU: 0.4 }, capital: 0, appetite: 0, reputation: 45, rating: 'BB', temperament: 'opaque', culture: 'Géant arctique du nickel ; sanctions selon les saisons.', color: '#475569' },
  { id: 'goldafrica', name: 'Ashanti Gold Export', cityId: 'accra', kind: 'producer', ai: false, desks: { AU: 1, COCOA: 0.4 }, capital: 0, appetite: 0, reputation: 50, rating: 'BB', temperament: 'familial', culture: 'Or et cacao ghanéens.', color: '#ca8a04' },
  { id: 'saigonrice', name: 'Mekong Rice & Coffee', cityId: 'hochiminh', kind: 'producer', ai: false, desks: { RICE: 1, COFFEE: 0.8 }, capital: 0, appetite: 0, reputation: 52, rating: 'BB', temperament: 'familial', culture: 'Exportateur du delta : riz et robusta.', color: '#16a34a' },
  { id: 'gulfcrude', name: 'Petro Oman Marketing', cityId: 'muscat', kind: 'producer', ai: false, desks: { DUBAI: 1, FUELOIL: 0.5 }, capital: 0, appetite: 0, reputation: 60, rating: 'A', temperament: 'discret', culture: 'Commercialise le brut d’Oman, référence de l’Asie.', color: '#9a3412' },
  { id: 'cushingtank', name: 'Cushing Midstream', cityId: 'houston', kind: 'producer', ai: false, desks: { WTI: 1 }, capital: 0, appetite: 0, reputation: 55, rating: 'BB', temperament: 'agressif', culture: 'Producteurs du Permien et cuves de Cushing.', color: '#f59e0b' },
];

/**
 * Phase 8 : les desks historiques s'étendent aux marchés voisins (un desk pétrole traite aussi le WTI, le Dubaï et les
 * produits ; un desk gaz l'électricité et le carbone ; un desk cuivre les autres métaux de base ; un desk blé les grains).
 */
const AFFINITY: Partial<Record<CommodityId, Partial<Record<CommodityId, number>>>> = {
  BRENT: { WTI: 0.8, DUBAI: 0.7, GASOIL: 0.7, GASOLINE: 0.5, JET: 0.4, FUELOIL: 0.5 },
  TTF: { POWER: 0.6, EUA: 0.6, JKM: 0.5, HH: 0.4 },
  API2: { NEWC: 0.8, METCOAL: 0.3 },
  CU: { AL: 0.6, ZN: 0.5, NI: 0.4, PB: 0.3, SN: 0.2, FE: 0.3 },
  WHEAT: { CORN: 0.9, SOY: 0.7, SOYMEAL: 0.5, SOYOIL: 0.4, RICE: 0.2 },
};
for (const c of COMPANIES) {
  for (const [base, extra] of Object.entries(AFFINITY) as [CommodityId, Partial<Record<CommodityId, number>>][]) {
    const w = c.desks[base];
    if (!w) continue;
    for (const [k, f] of Object.entries(extra) as [CommodityId, number][]) if (c.desks[k] === undefined) c.desks[k] = Math.round(w * f * 100) / 100;
  }
}

export const COMPANY_BY_ID: Record<string, CompanyDef> = Object.fromEntries(COMPANIES.map((c) => [c.id, c]));
