import type { City } from '../engine/types';

/** 10 villes de la phase 1. Les chiffres sont des ordres de grandeur réalistes, simplifiés. */
export const CITIES: City[] = [
  {
    id: 'geneva', name: 'Genève', country: 'Suisse', lat: 46.2044, lon: 6.1432,
    corporateTax: 0.14, taxNote: 'IS cantonal + fédéral ≈ 14 %',
    officeRentMonthly: 45_000, staffCostIndex: 1.0, regulator: 'Autorité fédérale des marchés (AFM)',
    kycStrictness: 0.7, politicalStability: 95, capitalControls: false, bankingHub: 0.85, port: false, airportHub: 0.6,
    blurb: 'Capitale historique du négoce pétrolier et agricole. Banques de trade finance à deux pas.',
  },
  {
    id: 'london', name: 'Londres', country: 'Royaume-Uni', lat: 51.5074, lon: -0.1278,
    corporateTax: 0.25, taxNote: 'IS 25 %',
    officeRentMonthly: 62_000, staffCostIndex: 1.05, regulator: 'Financial Conduct Office (FCO)',
    kycStrictness: 0.8, politicalStability: 88, capitalControls: false, bankingHub: 1.0, port: false, airportHub: 1.0,
    blurb: 'Bourses des métaux et du pétrole, vivier de talents dérivés, régulation exigeante.',
  },
  {
    id: 'rotterdam', name: 'Rotterdam', country: 'Pays-Bas', lat: 51.9244, lon: 4.4777,
    corporateTax: 0.258, taxNote: 'IS 25,8 %',
    officeRentMonthly: 28_000, staffCostIndex: 0.85, regulator: 'Autorité néerlandaise des marchés (ANM)',
    kycStrictness: 0.7, politicalStability: 92, capitalControls: false, bankingHub: 0.6, port: true, airportHub: 0.5,
    blurb: 'Premier port d’Europe : brut, produits, charbon ARA, métaux en entrepôt, grains.',
  },
  {
    id: 'singapore', name: 'Singapour', country: 'Singapour', lat: 1.3521, lon: 103.8198,
    corporateTax: 0.17, taxNote: 'IS 17 % (régimes incitatifs négociant possibles, phase 3)',
    officeRentMonthly: 50_000, staffCostIndex: 0.95, regulator: 'Autorité monétaire (AMS)',
    kycStrictness: 0.75, politicalStability: 96, capitalControls: false, bankingHub: 0.9, port: true, airportHub: 0.95,
    blurb: 'Hub asiatique du pétrole, du GNL et des métaux. Fiscalité attractive.',
  },
  {
    id: 'houston', name: 'Houston', country: 'États-Unis', lat: 29.7604, lon: -95.3698,
    corporateTax: 0.21, taxNote: 'IS fédéral 21 % (pas d’impôt d’État au Texas)',
    officeRentMonthly: 30_000, staffCostIndex: 1.0, regulator: 'Commodity Markets Commission (CMC)',
    kycStrictness: 0.75, politicalStability: 85, capitalControls: false, bankingHub: 0.7, port: true, airportHub: 0.8,
    blurb: 'Capitale de l’énergie américaine : brut du Golfe, raffineries, GNL. Saison des ouragans.',
  },
  {
    id: 'dubai', name: 'Dubaï', country: 'Émirats arabes unis', lat: 25.2048, lon: 55.2708,
    corporateTax: 0.09, taxNote: 'IS 9 % (zones franches possibles)',
    officeRentMonthly: 38_000, staffCostIndex: 0.9, regulator: 'Autorité des services financiers (ASF)',
    kycStrictness: 0.45, politicalStability: 82, capitalControls: false, bankingHub: 0.65, port: true, airportHub: 0.95,
    blurb: 'Carrefour Moyen-Orient – Asie – Afrique. KYC plus souple… et regard des régulateurs étrangers.',
  },
  {
    id: 'shanghai', name: 'Shanghai', country: 'Chine', lat: 31.2304, lon: 121.4737,
    corporateTax: 0.25, taxNote: 'IS 25 %',
    officeRentMonthly: 34_000, staffCostIndex: 0.75, regulator: 'Commission de régulation des marchés (CRM)',
    kycStrictness: 0.6, politicalStability: 78, capitalControls: true, bankingHub: 0.6, port: true, airportHub: 0.8,
    blurb: 'Premier consommateur mondial de métaux et de charbon. Contrôle des capitaux.',
  },
  {
    id: 'chicago', name: 'Chicago', country: 'États-Unis', lat: 41.8781, lon: -87.6298,
    corporateTax: 0.28, taxNote: 'IS fédéral 21 % + Illinois ≈ 9,5 %',
    officeRentMonthly: 33_000, staffCostIndex: 1.0, regulator: 'Commodity Markets Commission (CMC)',
    kycStrictness: 0.75, politicalStability: 85, capitalControls: false, bankingHub: 0.75, port: false, airportHub: 0.9,
    blurb: 'Le berceau des futures agricoles. Rapports de récolte mensuels très suivis.',
  },
  {
    id: 'santiago', name: 'Santiago', country: 'Chili', lat: -33.4489, lon: -70.6693,
    corporateTax: 0.27, taxNote: 'IS 27 %',
    officeRentMonthly: 16_000, staffCostIndex: 0.6, regulator: 'Commission des marchés financiers (CMF)',
    kycStrictness: 0.55, politicalStability: 72, capitalControls: false, bankingHub: 0.4, port: false, airportHub: 0.55,
    blurb: 'Premier producteur mondial de cuivre. Grèves minières et réformes des royalties.',
  },
  {
    id: 'johannesburg', name: 'Johannesburg', country: 'Afrique du Sud', lat: -26.2041, lon: 28.0473,
    corporateTax: 0.27, taxNote: 'IS 27 %',
    officeRentMonthly: 14_000, staffCostIndex: 0.55, regulator: 'Autorité de conduite financière (ACF)',
    kycStrictness: 0.55, politicalStability: 62, capitalControls: true, bankingHub: 0.45, port: false, airportHub: 0.6,
    blurb: 'Charbon de Richards Bay, platinoïdes. Délestages électriques et logistique ferroviaire fragile.',
  },
];

export const CITY_BY_ID: Record<string, City> = Object.fromEntries(CITIES.map((c) => [c.id, c]));
