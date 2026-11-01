/**
 * Réseau maritime : ports et points de passage réels (détroits, canaux, caps). Les trajets sont les plus courts
 * chemins dans ce graphe (Dijkstra) ; un canal fermé force le détour (Suez → cap de Bonne-Espérance).
 */
export interface SeaNode {
  id: string;
  name: string;
  lat: number;
  lon: number;
  port?: boolean;
  /** passage stratégique (détroit / canal) */
  chokepoint?: string;
}

export const SEA_NODES: SeaNode[] = [
  { id: 'RTM', name: 'Rotterdam', lat: 52.0, lon: 3.9, port: true },
  { id: 'USGC', name: 'Golfe du Mexique (Houston)', lat: 29.2, lon: -94.6, port: true },
  { id: 'FUJ', name: 'Fujairah', lat: 25.1, lon: 56.5, port: true },
  { id: 'SIN', name: 'Singapour', lat: 1.2, lon: 103.9, port: true },
  { id: 'SHA', name: 'Shanghai (Yangshan)', lat: 30.6, lon: 122.4, port: true },
  { id: 'RB', name: 'Richards Bay', lat: -28.9, lon: 32.2, port: true },
  { id: 'DUR', name: 'Durban', lat: -29.9, lon: 31.1, port: true },
  { id: 'SAI', name: 'San Antonio (Chili)', lat: -33.6, lon: -71.8, port: true },
  { id: 'CHAN', name: 'Manche', lat: 50.0, lon: -2.5 },
  { id: 'FIN', name: 'Cap Finisterre', lat: 43.5, lon: -10.5 },
  { id: 'GIB', name: 'Détroit de Gibraltar', lat: 35.95, lon: -5.7, chokepoint: 'gibraltar' },
  { id: 'MED', name: 'Méditerranée centrale', lat: 35.5, lon: 16 },
  { id: 'SUEZN', name: 'Port-Saïd', lat: 31.4, lon: 32.4, chokepoint: 'suez' },
  { id: 'SUEZS', name: 'Suez', lat: 29.8, lon: 32.6, chokepoint: 'suez' },
  { id: 'REDS', name: 'Mer Rouge', lat: 20, lon: 38.5 },
  { id: 'BAB', name: 'Bab-el-Mandeb', lat: 12.6, lon: 43.4, chokepoint: 'bab' },
  { id: 'ARAB', name: 'Mer d’Arabie', lat: 14, lon: 58 },
  { id: 'HORM', name: 'Détroit d’Ormuz', lat: 26.3, lon: 56.6, chokepoint: 'hormuz' },
  { id: 'LKA', name: 'Sud du Sri Lanka', lat: 5.5, lon: 80.5 },
  { id: 'MALW', name: 'Entrée de Malacca', lat: 5.8, lon: 95.5 },
  { id: 'MALA', name: 'Détroit de Malacca', lat: 2.6, lon: 101.3, chokepoint: 'malacca' },
  { id: 'SCS', name: 'Mer de Chine méridionale', lat: 12, lon: 113 },
  { id: 'TWN', name: 'Détroit de Taïwan', lat: 24, lon: 119.5 },
  { id: 'CVE', name: 'Large du Cap-Vert', lat: 14, lon: -21 },
  { id: 'GUI', name: 'Golfe de Guinée', lat: -2, lon: 3 },
  { id: 'CAPE', name: 'Cap de Bonne-Espérance', lat: -35.5, lon: 19 },
  { id: 'SIO', name: 'Océan Indien sud', lat: -15, lon: 70 },
  { id: 'NATL', name: 'Atlantique Nord', lat: 38, lon: -45 },
  { id: 'FLA', name: 'Détroit de Floride', lat: 24.3, lon: -81.5 },
  { id: 'YUC', name: 'Canal du Yucatán', lat: 21.8, lon: -86 },
  { id: 'CARIB', name: 'Mer des Caraïbes', lat: 15, lon: -76 },
  { id: 'PANA', name: 'Colón', lat: 9.5, lon: -79.9, chokepoint: 'panama' },
  { id: 'PANP', name: 'Balboa', lat: 8.8, lon: -79.5, chokepoint: 'panama' },
  { id: 'PERU', name: 'Large du Pérou', lat: -12, lon: -80 },
  { id: 'SATL', name: 'Atlantique Sud', lat: -25, lon: -25 },
  { id: 'HORN', name: 'Cap Horn', lat: -56.5, lon: -67 },
  { id: 'PACE', name: 'Pacifique Est', lat: -20, lon: -120 },
  { id: 'PACW', name: 'Pacifique Ouest', lat: 15, lon: 160 },
];

/** Arêtes du graphe ; `closable` = identifiant du passage qui peut être fermé par un événement. */
export const SEA_EDGES: [string, string, string?][] = [
  ['RTM', 'CHAN'], ['CHAN', 'FIN'], ['FIN', 'GIB', 'gibraltar'], ['GIB', 'MED'], ['MED', 'SUEZN'],
  ['SUEZN', 'SUEZS', 'suez'], ['SUEZS', 'REDS'], ['REDS', 'BAB', 'bab'], ['BAB', 'ARAB', 'bab'], ['ARAB', 'HORM', 'hormuz'], ['HORM', 'FUJ', 'hormuz'], ['ARAB', 'FUJ'],
  ['ARAB', 'LKA'], ['LKA', 'MALW'], ['MALW', 'MALA', 'malacca'], ['MALA', 'SIN', 'malacca'], ['SIN', 'SCS'], ['SCS', 'TWN'], ['TWN', 'SHA'],
  ['FIN', 'CVE'], ['CVE', 'GUI'], ['GUI', 'CAPE'], ['CVE', 'SATL'], ['SATL', 'CAPE'], ['CAPE', 'DUR'], ['DUR', 'RB'], ['RB', 'SIO'], ['SIO', 'LKA'], ['SIO', 'MALW'], ['SIO', 'ARAB'],
  ['CHAN', 'NATL'], ['NATL', 'FLA'], ['FLA', 'USGC'], ['NATL', 'CVE'], ['USGC', 'YUC'], ['YUC', 'CARIB'], ['CARIB', 'PANA'], ['PANA', 'PANP', 'panama'], ['PANP', 'PERU'], ['PERU', 'SAI'],
  ['CARIB', 'SATL'], ['SATL', 'HORN'], ['HORN', 'SAI'], ['SAI', 'PACE'], ['PACE', 'PACW'], ['PACW', 'SHA'], ['PANP', 'PACE'],
];

export const CHOKEPOINT_NAMES: Record<string, string> = {
  suez: 'canal de Suez', panama: 'canal de Panama', bab: 'détroit de Bab-el-Mandeb', hormuz: 'détroit d’Ormuz', malacca: 'détroit de Malacca', gibraltar: 'détroit de Gibraltar',
};

/** Port maritime de chaque lieu physique (null = non expédiable par mer, ex. gaz de réseau). */
export const LOCATION_PORT: Record<string, string | null> = {
  BRENT_RTM: 'RTM', BRENT_USGC: 'USGC', BRENT_FUJ: 'FUJ', BRENT_SIN: 'SIN',
  TTF_HUB: null, TTF_NBP: null, TTF_CH: null,
  CU_RTM: 'RTM', CU_SHA: 'SHA', CU_SIN: 'SIN', CU_SCL: 'SAI', CU_DUR: 'DUR',
  WHT_GULF: 'USGC', WHT_CHI: 'USGC', WHT_RTM: 'RTM', WHT_DXB: 'FUJ',
  COAL_ARA: 'RTM', COAL_RB: 'RB', COAL_CN: 'SHA',
};

/** Pré-acheminement terrestre vers le port (rail, barge, camion) : jours et coût par tonne. */
export const INLAND_LEG: Record<string, { mode: 'rail' | 'barge' | 'camion'; days: number; costPerT: number; path: [number, number][] }> = {
  WHT_CHI: { mode: 'barge', days: 12, costPerT: 18, path: [[41.88, -87.63], [38.6, -90.2], [35.1, -90.1], [32.3, -91.0], [29.95, -90.07], [29.2, -94.6]] },
};

/** Liaisons terrestres et pipelines décoratifs (globe), avec mode d'animation. */
export const LAND_LINKS: { id: string; kind: 'rail' | 'pipeline' | 'barge'; label: string; path: [number, number][]; zone?: string }[] = [
  { id: 'rail-rb', kind: 'rail', label: 'Ligne charbonnière vers Richards Bay', path: [[-26.2, 28.05], [-26.9, 29.6], [-27.8, 31.0], [-28.8, 32.05]] },
  { id: 'rail-cl', kind: 'rail', label: 'Rail du cuivre vers San Antonio', path: [[-33.45, -70.67], [-33.55, -71.2], [-33.6, -71.6]] },
  { id: 'barge-ms', kind: 'barge', label: 'Barges du Mississippi', path: INLAND_LEG.WHT_CHI!.path },
  { id: 'pipe-sarm', kind: 'pipeline', label: 'Gazoduc sarmate vers l’Europe', path: [[60, 75], [58, 55], [55, 38], [53.5, 25], [53, 14], [52.3, 7]], zone: 'SARM' },
  { id: 'pipe-gulf', kind: 'pipeline', label: 'Oléoduc du Golfe vers Fujairah', path: [[24, 46], [24.2, 50], [24.0, 54.3], [25.1, 56.3]] },
  { id: 'pipe-nbp', kind: 'pipeline', label: 'Interconnecteur gazier Royaume-Uni – Pays-Bas', path: [[52.9, 1.4], [52.7, 3.0], [52.4, 4.5]] },
];

/** Grandes routes commerciales pour le trafic décoratif. */
export const TRADE_LANES: [string, string][] = [
  ['FUJ', 'SIN'], ['FUJ', 'SHA'], ['FUJ', 'RTM'], ['USGC', 'RTM'], ['RB', 'SHA'], ['RB', 'RTM'], ['SAI', 'SHA'], ['SIN', 'SHA'], ['USGC', 'SIN'], ['RTM', 'SIN'], ['DUR', 'SIN'], ['USGC', 'FUJ'],
];
