import type { City } from '../engine/types';

/** Villes du jeu (10 en phase 1, 61 en phase 8). Les chiffres sont des ordres de grandeur réalistes, simplifiés. */
export const CITIES: City[] = [
  {
    id: 'geneva', name: 'Genève', country: 'Suisse', lat: 46.2044, lon: 6.1432,
    corporateTax: 0.14, taxNote: 'IS cantonal + fédéral ≈ 14 %',
    officeRentMonthly: 45_000, staffCostIndex: 1.0, regulator: 'Autorité fédérale des marchés (AFM)',
    kycStrictness: 0.7, politicalStability: 95, capitalControls: false, bankingHub: 0.85, port: false, airportHub: 0.6,
    sanctionsRegime: 'west', reportingFee: 35,
    blurb: 'Capitale historique du négoce pétrolier et agricole. Banques de trade finance à deux pas.',
  },
  {
    id: 'london', name: 'Londres', country: 'Royaume-Uni', lat: 51.5074, lon: -0.1278,
    corporateTax: 0.25, taxNote: 'IS 25 %',
    officeRentMonthly: 62_000, staffCostIndex: 1.05, regulator: 'Financial Conduct Office (FCO)',
    kycStrictness: 0.8, politicalStability: 88, capitalControls: false, bankingHub: 1.0, port: false, airportHub: 1.0,
    sanctionsRegime: 'west', reportingFee: 45,
    blurb: 'Bourses des métaux et du pétrole, vivier de talents dérivés, régulation exigeante.',
  },
  {
    id: 'rotterdam', name: 'Rotterdam', country: 'Pays-Bas', lat: 51.9244, lon: 4.4777,
    corporateTax: 0.258, taxNote: 'IS 25,8 %',
    officeRentMonthly: 28_000, staffCostIndex: 0.85, regulator: 'Autorité néerlandaise des marchés (ANM)',
    kycStrictness: 0.7, politicalStability: 92, capitalControls: false, bankingHub: 0.6, port: true, airportHub: 0.5,
    sanctionsRegime: 'west', reportingFee: 40,
    blurb: 'Premier port d’Europe : brut, produits, charbon ARA, métaux en entrepôt, grains.',
  },
  {
    id: 'singapore', name: 'Singapour', country: 'Singapour', lat: 1.3521, lon: 103.8198,
    corporateTax: 0.17, taxNote: 'IS 17 % (régimes incitatifs négociant possibles, phase 3)',
    officeRentMonthly: 50_000, staffCostIndex: 0.95, regulator: 'Autorité monétaire (AMS)',
    kycStrictness: 0.75, politicalStability: 96, capitalControls: false, bankingHub: 0.9, port: true, airportHub: 0.95,
    sanctionsRegime: 'un', reportingFee: 25, specialRegime: { label: 'Statut de négociant agréé', rate: 0.1, minPhysicalVolume: 500_000_000 },
    blurb: 'Hub asiatique du pétrole, du GNL et des métaux. Fiscalité attractive.',
  },
  {
    id: 'houston', name: 'Houston', country: 'États-Unis', lat: 29.7604, lon: -95.3698,
    corporateTax: 0.21, taxNote: 'IS fédéral 21 % (pas d’impôt d’État au Texas)',
    officeRentMonthly: 30_000, staffCostIndex: 1.0, regulator: 'Commodity Markets Commission (CMC)',
    kycStrictness: 0.75, politicalStability: 85, capitalControls: false, bankingHub: 0.7, port: true, airportHub: 0.8,
    sanctionsRegime: 'west', reportingFee: 50,
    blurb: 'Capitale de l’énergie américaine : brut du Golfe, raffineries, GNL. Saison des ouragans.',
  },
  {
    id: 'dubai', name: 'Dubaï', country: 'Émirats arabes unis', lat: 25.2048, lon: 55.2708,
    corporateTax: 0.09, taxNote: 'IS 9 % (zones franches possibles)',
    officeRentMonthly: 38_000, staffCostIndex: 0.9, regulator: 'Autorité des services financiers (ASF)',
    kycStrictness: 0.45, politicalStability: 82, capitalControls: false, bankingHub: 0.65, port: true, airportHub: 0.95,
    sanctionsRegime: 'none', reportingFee: 0, specialRegime: { label: 'Zone franche', rate: 0, annualFee: 250_000 },
    blurb: 'Carrefour Moyen-Orient – Asie – Afrique. KYC plus souple… et regard des régulateurs étrangers.',
  },
  {
    id: 'shanghai', name: 'Shanghai', country: 'Chine', lat: 31.2304, lon: 121.4737,
    corporateTax: 0.25, taxNote: 'IS 25 %',
    officeRentMonthly: 34_000, staffCostIndex: 0.75, regulator: 'Commission de régulation des marchés (CRM)',
    kycStrictness: 0.6, politicalStability: 78, capitalControls: true, bankingHub: 0.6, port: true, airportHub: 0.8,
    sanctionsRegime: 'east', reportingFee: 20,
    blurb: 'Premier consommateur mondial de métaux et de charbon. Contrôle des capitaux.',
  },
  {
    id: 'chicago', name: 'Chicago', country: 'États-Unis', lat: 41.8781, lon: -87.6298,
    corporateTax: 0.28, taxNote: 'IS fédéral 21 % + Illinois ≈ 9,5 %',
    officeRentMonthly: 33_000, staffCostIndex: 1.0, regulator: 'Commodity Markets Commission (CMC)',
    kycStrictness: 0.75, politicalStability: 85, capitalControls: false, bankingHub: 0.75, port: false, airportHub: 0.9,
    sanctionsRegime: 'west', reportingFee: 50,
    blurb: 'Le berceau des futures agricoles. Rapports de récolte mensuels très suivis.',
  },
  {
    id: 'santiago', name: 'Santiago', country: 'Chili', lat: -33.4489, lon: -70.6693,
    corporateTax: 0.27, taxNote: 'IS 27 %',
    officeRentMonthly: 16_000, staffCostIndex: 0.6, regulator: 'Commission des marchés financiers (CMF)',
    kycStrictness: 0.55, politicalStability: 72, capitalControls: false, bankingHub: 0.4, port: false, airportHub: 0.55,
    sanctionsRegime: 'un', reportingFee: 10,
    blurb: 'Premier producteur mondial de cuivre. Grèves minières et réformes des royalties.',
  },
  {
    id: 'johannesburg', name: 'Johannesburg', country: 'Afrique du Sud', lat: -26.2041, lon: 28.0473,
    corporateTax: 0.27, taxNote: 'IS 27 %',
    officeRentMonthly: 14_000, staffCostIndex: 0.55, regulator: 'Autorité de conduite financière (ACF)',
    kycStrictness: 0.55, politicalStability: 62, capitalControls: true, bankingHub: 0.45, port: false, airportHub: 0.6,
    sanctionsRegime: 'un', reportingFee: 10,
    blurb: 'Charbon de Richards Bay, platinoïdes. Délestages électriques et logistique ferroviaire fragile.',
  },
];


// ------------------------------------------------------------------ phase 8 : 51 villes supplémentaires
type R = City['sanctionsRegime'];
/** Constructeur compact : id, nom, pays, lat, lon, IS, loyer mensuel, coût du personnel, régulateur, KYC,
 * stabilité, contrôle des capitaux, hub bancaire, port, hub aérien, régime de sanctions, coût de reporting, présentation. */
function c(id: string, name: string, country: string, lat: number, lon: number, tax: number, rent: number, staff: number, regulator: string, kyc: number, stab: number, capCtl: boolean, bank: number, port: boolean, air: number, regime: R, fee: number, blurb: string, extra: Partial<City> = {}): City {
  return { id, name, country, lat, lon, corporateTax: tax, taxNote: `IS ≈ ${Math.round(tax * 100)} %`, officeRentMonthly: rent, staffCostIndex: staff, regulator, kycStrictness: kyc, politicalStability: stab, capitalControls: capCtl, bankingHub: bank, port, airportHub: air, sanctionsRegime: regime, reportingFee: fee, blurb, ...extra };
}

export const MORE_CITIES: City[] = [
  c('zug', 'Zoug', 'Suisse', 47.17, 8.52, 0.118, 32_000, 1.0, 'Autorité fédérale des marchés (AFM)', 0.65, 96, false, 0.6, false, 0.3, 'west', 35, 'La fiscalité la plus douce de Suisse : sièges de mineurs et de négociants de métaux.'),
  c('lugano', 'Lugano', 'Suisse', 46.0, 8.95, 0.15, 26_000, 0.95, 'Autorité fédérale des marchés (AFM)', 0.6, 95, false, 0.5, false, 0.3, 'west', 35, 'Négoce d’acier, de produits pétroliers et raffineries d’or du Tessin.'),
  c('paris', 'Paris', 'France', 48.86, 2.35, 0.25, 55_000, 1.0, 'Autorité des marchés financiers (AMF)', 0.75, 82, false, 0.85, false, 0.95, 'west', 40, 'Majors de l’énergie, électricité nucléaire, grands céréaliers.'),
  c('hamburg', 'Hambourg', 'Allemagne', 53.55, 9.99, 0.3, 36_000, 0.95, 'Autorité fédérale de surveillance financière (BaFS)', 0.75, 90, false, 0.6, true, 0.6, 'west', 40, 'Premier port allemand : café, métaux, armateurs.'),
  c('frankfurt', 'Francfort', 'Allemagne', 50.11, 8.68, 0.3, 48_000, 1.0, 'Autorité fédérale de surveillance financière (BaFS)', 0.8, 90, false, 0.95, false, 0.9, 'west', 40, 'Banques, bourse de l’électricité et du carbone européens.'),
  c('oslo', 'Oslo', 'Norvège', 59.91, 10.75, 0.22, 42_000, 1.1, 'Inspection financière (FTN)', 0.75, 95, false, 0.6, true, 0.6, 'west', 35, 'Pétrole et gaz de la mer du Nord, armateurs, hydroélectricité.'),
  c('moscow', 'Moscou', 'Fédération de Sarmatie', 55.76, 37.62, 0.2, 30_000, 0.6, 'Banque centrale sarmate', 0.35, 55, true, 0.6, false, 0.8, 'east', 10, 'Capitale d’un géant du pétrole, du gaz et des métaux. Sanctions et contrôle des capitaux.'),
  c('istanbul', 'Istanbul', 'Turquie', 41.01, 28.98, 0.25, 18_000, 0.5, 'Conseil des marchés de capitaux (CMC-T)', 0.45, 65, false, 0.6, true, 0.9, 'un', 15, 'Carrefour entre l’Europe et l’Asie : Bosphore, acier, céréales, pétrole sanctionné.'),
  c('athens', 'Athènes', 'Grèce', 37.98, 23.73, 0.22, 16_000, 0.6, 'Commission des marchés helléniques', 0.6, 78, false, 0.4, true, 0.6, 'west', 30, 'Le Pirée : première flotte marchande du monde, armateurs discrets.'),
  c('madrid', 'Madrid', 'Espagne', 40.42, -3.7, 0.25, 30_000, 0.75, 'Commission nationale des marchés (CNMV)', 0.7, 85, false, 0.7, false, 0.8, 'west', 35, 'Énergéticiens, solaire, lien avec l’Amérique latine.'),
  c('milan', 'Milan', 'Italie', 45.46, 9.19, 0.24, 34_000, 0.8, 'Commission nationale des sociétés (CONSOB)', 0.7, 78, false, 0.75, false, 0.75, 'west', 35, 'Énergie, gaz méditerranéen, industrie lourde.'),
  c('vienna', 'Vienne', 'Autriche', 48.21, 16.37, 0.23, 30_000, 0.9, 'Autorité des marchés financiers (FMA)', 0.7, 92, false, 0.6, false, 0.6, 'west', 35, 'Hub gazier de Baumgarten, porte de l’Europe centrale.'),
  c('warsaw', 'Varsovie', 'Pologne', 52.23, 21.01, 0.19, 20_000, 0.55, 'Commission de surveillance financière (KNF)', 0.65, 84, false, 0.5, false, 0.6, 'west', 30, 'Charbon, électricité, agriculture : la transition énergétique la plus difficile d’Europe.'),
  c('riyadh', 'Riyad', 'Royaumes du Golfe', 24.71, 46.68, 0.2, 28_000, 0.85, 'Autorité du marché des capitaux du Golfe', 0.5, 70, false, 0.5, false, 0.7, 'none', 10, 'La capitale du premier exportateur de brut. Le cartel s’y réunit.'),
  c('doha', 'Doha', 'Royaumes du Golfe', 25.29, 51.53, 0.1, 30_000, 0.9, 'Autorité des marchés de Doha', 0.5, 75, false, 0.55, true, 0.85, 'none', 10, 'Le géant du GNL : Ras Laffan, à une heure de route.', { specialRegime: { label: 'Centre financier', rate: 0.1 } }),
  c('muscat', 'Mascate', 'Oman', 23.59, 58.41, 0.15, 16_000, 0.7, 'Autorité des marchés financiers d’Oman', 0.5, 80, false, 0.35, true, 0.5, 'none', 10, 'Brut d’Oman, référence du Golfe pour l’Asie, à l’entrée d’Ormuz.'),
  c('baku', 'Bakou', 'Azerbaïdjan', 40.41, 49.87, 0.2, 14_000, 0.5, 'Banque centrale d’Azerbaïdjan', 0.35, 62, true, 0.3, true, 0.5, 'none', 10, 'Pétrole de la Caspienne et oléoduc vers la Méditerranée.'),
  c('cairo', 'Le Caire', 'Égypte', 30.04, 31.24, 0.225, 9_000, 0.35, 'Autorité de régulation financière (ARF)', 0.4, 58, true, 0.4, false, 0.7, 'un', 10, 'Le canal de Suez, premier importateur de blé du monde.'),
  c('lagos', 'Lagos', 'Nigeria', 6.52, 3.38, 0.3, 14_000, 0.4, 'Commission des valeurs mobilières (SEC-N)', 0.3, 45, true, 0.4, true, 0.6, 'un', 10, 'Brut léger d’Afrique de l’Ouest, raffinage déficitaire, devises rares.'),
  c('abidjan', 'Abidjan', 'Côte d’Ivoire', 5.36, -4.0, 0.25, 10_000, 0.4, 'Conseil régional de l’épargne publique', 0.35, 60, false, 0.35, true, 0.5, 'un', 10, 'Le premier producteur de cacao du monde. Le Conseil fixe le prix bord-champ.'),
  c('accra', 'Accra', 'Ghana', 5.6, -0.19, 0.25, 9_000, 0.4, 'Commission des valeurs du Ghana', 0.35, 66, true, 0.3, true, 0.5, 'un', 10, 'Cacao, or et pétrole offshore.'),
  c('nairobi', 'Nairobi', 'Kenya', -1.29, 36.82, 0.3, 9_000, 0.4, 'Autorité des marchés de capitaux (CMA-K)', 0.4, 62, false, 0.45, false, 0.7, 'un', 10, 'Thé et café d’Afrique de l’Est, port de Mombasa.'),
  c('lubumbashi', 'Lubumbashi', 'République du Kassaï', -11.66, 27.48, 0.3, 8_000, 0.4, 'Autorité de régulation des mines du Kassaï', 0.2, 35, true, 0.1, false, 0.3, 'none', 0, 'La ceinture du cuivre et du cobalt. Fortunes rapides, risques extrêmes.'),
  c('luanda', 'Luanda', 'Angola', -8.84, 13.23, 0.25, 22_000, 0.6, 'Commission des marchés de capitaux d’Angola', 0.3, 50, true, 0.25, true, 0.5, 'un', 10, 'Brut offshore vendu à l’Asie, prêts adossés au pétrole.'),
  c('mumbai', 'Mumbai', 'Inde', 19.08, 72.88, 0.25, 22_000, 0.4, 'Bureau des valeurs mobilières (SEBI-like)', 0.55, 72, true, 0.7, true, 0.85, 'un', 15, 'Raffinage géant, importations de charbon, d’huiles et d’or.'),
  c('karachi', 'Karachi', 'Pakistan', 24.86, 67.0, 0.29, 7_000, 0.3, 'Commission des valeurs du Pakistan', 0.35, 45, true, 0.35, true, 0.5, 'un', 10, 'Coton, riz, importations de GNL et de carburants.'),
  c('hongkong', 'Hong Kong', 'Chine (RAS)', 22.32, 114.17, 0.165, 70_000, 1.0, 'Commission des valeurs de Hong Kong', 0.65, 75, false, 0.95, true, 0.95, 'un', 25, 'Bourse des métaux rachetée par le continent, or physique, finance offshore.'),
  c('tokyo', 'Tokyo', 'Japon', 35.68, 139.69, 0.3, 58_000, 1.0, 'Agence des services financiers (ASF)', 0.8, 92, false, 0.9, true, 0.95, 'west', 40, 'Premier acheteur de GNL au monde, sogo shosha, électricité chère.'),
  c('seoul', 'Séoul', 'Corée du Sud', 37.57, 126.98, 0.24, 40_000, 0.85, 'Commission des services financiers (FSC)', 0.75, 82, false, 0.75, true, 0.85, 'west', 30, 'Raffinage, chantiers navals, GNL et charbon importés.'),
  c('beijing', 'Pékin', 'Chine', 39.9, 116.4, 0.25, 30_000, 0.7, 'Commission de régulation des valeurs (CRV)', 0.6, 78, true, 0.75, false, 0.9, 'east', 15, 'Les décisions qui font les prix des métaux et du charbon.'),
  c('dalian', 'Dalian', 'Chine', 38.91, 121.6, 0.25, 15_000, 0.55, 'Commission de régulation des valeurs (CRV)', 0.6, 78, true, 0.4, true, 0.5, 'east', 15, 'Bourse des matières premières de Dalian : soja, maïs, minerai de fer.'),
  c('jakarta', 'Jakarta', 'Archipel d’Insulinde', -6.21, 106.85, 0.22, 14_000, 0.4, 'Autorité des services financiers d’Insulinde', 0.4, 58, false, 0.45, true, 0.7, 'none', 10, 'Charbon, nickel, huile de palme. Interdictions d’export imprévisibles.'),
  c('kualalumpur', 'Kuala Lumpur', 'Malaisie', 3.14, 101.69, 0.24, 16_000, 0.5, 'Commission des valeurs de Malaisie', 0.55, 75, false, 0.6, false, 0.7, 'un', 15, 'Bourse de l’huile de palme, étain, GNL.'),
  c('bangkok', 'Bangkok', 'Thaïlande', 13.76, 100.5, 0.2, 14_000, 0.45, 'Commission des valeurs de Thaïlande', 0.5, 62, false, 0.5, true, 0.85, 'un', 15, 'Premier exportateur de riz et de sucre d’Asie, caoutchouc.'),
  c('hochiminh', 'Hô Chi Minh-Ville', 'Viêt Nam', 10.82, 106.63, 0.2, 10_000, 0.35, 'Commission des valeurs du Viêt Nam', 0.45, 72, true, 0.35, true, 0.6, 'un', 10, 'Robusta, riz, poivre : le delta du Mékong.'),
  c('manila', 'Manille', 'Philippines', 14.6, 120.98, 0.25, 11_000, 0.35, 'Commission des valeurs des Philippines', 0.45, 60, false, 0.4, true, 0.6, 'un', 10, 'Nickel latéritique, importations de riz et de charbon.'),
  c('almaty', 'Almaty', 'Kazakhstan', 43.24, 76.89, 0.2, 12_000, 0.45, 'Agence de régulation des marchés (ARM-K)', 0.35, 60, true, 0.35, false, 0.5, 'none', 10, 'Uranium, pétrole de la Caspienne, blé des steppes, métaux.'),
  c('sydney', 'Sydney', 'Australie', -33.87, 151.21, 0.3, 45_000, 1.0, 'Commission australienne des valeurs (CAV)', 0.8, 92, false, 0.8, true, 0.9, 'west', 35, 'Charbon de Newcastle, GNL, blé : l’Australie nourrit l’Asie.'),
  c('perth', 'Perth', 'Australie', -31.95, 115.86, 0.3, 30_000, 1.05, 'Commission australienne des valeurs (CAV)', 0.8, 93, false, 0.45, true, 0.6, 'west', 35, 'Minerai de fer du Pilbara, lithium, or et GNL offshore.'),
  c('auckland', 'Auckland', 'Nouvelle-Zélande', -36.85, 174.76, 0.28, 24_000, 0.85, 'Autorité des marchés financiers (FMA-NZ)', 0.8, 95, false, 0.45, true, 0.6, 'west', 30, 'Produits laitiers et viande : un marché à part, loin de tout.'),
  c('newyork', 'New York', 'États-Unis', 40.71, -74.01, 0.27, 85_000, 1.25, 'Commission des marchés à terme (CMT)', 0.85, 85, false, 1.0, true, 1.0, 'west', 50, 'Bourse des softs, de l’or et du pétrole : la finance des matières premières.'),
  c('calgary', 'Calgary', 'Canada', 51.05, -114.07, 0.23, 26_000, 0.95, 'Commission des valeurs de l’Alberta', 0.75, 90, false, 0.55, false, 0.6, 'west', 35, 'Sables bitumineux et gaz de l’Ouest canadien, oléoducs saturés.'),
  c('toronto', 'Toronto', 'Canada', 43.65, -79.38, 0.265, 40_000, 1.0, 'Commission des valeurs de l’Ontario', 0.8, 90, false, 0.85, false, 0.85, 'west', 35, 'La bourse des mineurs : or, cuivre, nickel du monde entier.'),
  c('vancouver', 'Vancouver', 'Canada', 49.28, -123.12, 0.27, 34_000, 1.0, 'Commission des valeurs de Colombie-Britannique', 0.75, 92, false, 0.55, true, 0.75, 'west', 35, 'Port du Pacifique : charbon métallurgique, potasse, céréales vers l’Asie.'),
  c('mexicocity', 'Mexico', 'Mexique', 19.43, -99.13, 0.3, 18_000, 0.45, 'Commission bancaire et des valeurs (CNBV)', 0.5, 62, false, 0.55, false, 0.8, 'un', 15, 'Pétrole d’État, argent, maïs importé des États-Unis.'),
  c('saopaulo', 'São Paulo', 'Brésil', -23.55, -46.63, 0.34, 22_000, 0.55, 'Commission des valeurs mobilières (CVM)', 0.55, 64, false, 0.7, false, 0.8, 'un', 15, 'Soja, sucre, café, minerai de fer : la ferme et la mine du monde.'),
  c('buenosaires', 'Buenos Aires', 'Argentine', -34.6, -58.38, 0.35, 12_000, 0.45, 'Commission nationale des valeurs (CNV)', 0.45, 52, true, 0.5, true, 0.7, 'un', 10, 'Soja et farine de soja par le Paraná. Contrôle des changes et taxes à l’export.'),
  c('lima', 'Lima', 'Pérou', -12.05, -77.04, 0.295, 14_000, 0.45, 'Surintendance des marchés de valeurs (SMV)', 0.45, 55, false, 0.4, true, 0.6, 'un', 10, 'Cuivre, zinc, or : blocages miniers fréquents.'),
  c('bogota', 'Bogota', 'Colombie', 4.71, -74.07, 0.35, 12_000, 0.45, 'Surintendance financière de Colombie', 0.45, 58, false, 0.45, false, 0.6, 'un', 10, 'Café lavé, charbon, pétrole lourd.'),
  c('caracas', 'Caracas', 'Venezuela', 10.48, -66.9, 0.34, 6_000, 0.25, 'Surintendance nationale des valeurs', 0.15, 25, true, 0.1, true, 0.4, 'none', 0, 'Les plus grandes réserves de brut du monde, sous sanctions et en ruine.'),
  c('panama', 'Panama', 'Panama', 8.98, -79.52, 0.25, 15_000, 0.5, 'Surintendance du marché des valeurs', 0.35, 72, false, 0.55, true, 0.6, 'none', 5, 'Le canal, les pavillons de complaisance, les sociétés écrans.'),
];

CITIES.push(...MORE_CITIES);

export const CITY_BY_ID: Record<string, City> = Object.fromEntries(CITIES.map((c) => [c.id, c]));
