import type { Day, MonthIndex } from './calendar';
import type { RngState } from './rng';

export type CommodityId = 'BRENT' | 'TTF' | 'CU' | 'WHEAT' | 'API2';
export type Currency = 'USD' | 'EUR';
export type Incoterm = 'FOB' | 'CFR' | 'CIF' | 'DAP' | 'DES' | 'FCA' | 'HUB';

/** Règle de dernier jour de cotation (Last Trading Day) calquée sur les vraies bourses. */
export type LtdRule = 'BRENT' | 'TTF' | 'LME' | 'CBOT' | 'LAST_FRIDAY';

/** Paramètres du modèle de Schwartz-Smith (2000) à deux facteurs, sous mesure risque-neutre. */
export interface ModelParams {
  s0: number; // prix spot initial (unité de cotation)
  chi0: number; // écart court terme initial (log) : >0 => marché tendu, backwardation
  kappa: number; // vitesse de retour à la moyenne du facteur court (1/an)
  sigmaChi: number; // vol annuelle du facteur court
  sigmaXi: number; // vol annuelle du facteur long
  rho: number; // corrélation entre facteurs
  longDrift: number; // pente annuelle de l'extrémité longue de la courbe (portage de long terme)
  seasonalAmp: number; // amplitude saisonnière (log)
  seasonalPeak: number; // mois (0..12, fractionnaire) du pic saisonnier
}

export interface PhysicalLocation {
  id: string;
  cityId: string;
  label: string; // ex. « CIF Rotterdam »
  incoterm: Incoterm;
  basisMean: number; // différentiel moyen vs benchmark (unité de cotation)
  basisVol: number; // vol annuelle du différentiel (unité de cotation)
}

export interface CommoditySpec {
  id: CommodityId;
  name: string;
  short: string;
  family: 'energy' | 'metals' | 'agri';
  exchange: string;
  currency: Currency;
  priceUnit: string;
  qtyUnit: string;
  /** Taille de lot : fixe, ou 1 MW sur toutes les heures du mois (gaz/électricité). */
  lot: { kind: 'fixed'; qty: number } | { kind: 'mwMonth'; mw: number };
  tick: number;
  /** Valeur (devise) d'une unité de prix × une unité de quantité. Ex. blé en c/bu : 0,01. */
  valuePerUnit: number;
  decimals: number;
  listing: { kind: 'monthly'; count: number } | { kind: 'months'; months: number[]; count: number };
  ltdRule: LtdRule;
  model: ModelParams;
  liquidity: { halfSpreadTicks: number; depthLots: number; commission: number };
  physical: {
    cargoSizes: number[];
    storagePerUnitMonth: number;
    spotSpreadPct: number;
    locations: PhysicalLocation[];
  };
  /** Conversion d'affichage optionnelle (ex. bu -> t). */
  display?: { unit: string; factor: number };
  color: string;
  icon: string;
  blurb: string;
}

export interface City {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  corporateTax: number;
  taxNote: string;
  officeRentMonthly: number; // USD
  staffCostIndex: number; // 1 = Genève
  regulator: string;
  kycStrictness: number; // 0..1
  politicalStability: number; // 0..100
  capitalControls: boolean;
  bankingHub: number; // 0..1
  port: boolean;
  airportHub: number; // 0..1
  blurb: string;
}

export interface Counterparty {
  id: string;
  name: string;
  cityId: string;
  kind: 'trader' | 'major' | 'producer' | 'utility' | 'bank' | 'agri' | 'miner';
}

// ---------------------------------------------------------------- état de marché
export interface CommodityMarket {
  chi: number;
  xi: number;
  basisDev: Record<string, number>;
  /** Taux de marge initiale exigé par la bourse (fraction du notionnel), révisé périodiquement. */
  imRate: number;
}

export interface FactorSnapshot {
  day: Day;
  f: Record<CommodityId, [number, number]>; // [chi, xi]
  fxLog: number;
  volMult: number;
}

export interface MarketState {
  day: Day;
  volRegime: 'calm' | 'stressed';
  volMult: number;
  fxLog: number; // ln(EURUSD)
  commodities: Record<CommodityId, CommodityMarket>;
  history: FactorSnapshot[];
}

// ---------------------------------------------------------------- portefeuille
export interface FuturesPosition {
  commodity: CommodityId;
  month: MonthIndex;
  lots: number; // >0 long, <0 short
  /** Dernier prix de marquage (règlement de la veille ou prix d'exécution) : base de la marge de variation. */
  mark: number;
  avgPrice: number; // prix moyen d'entrée, pour affichage
}

export interface ForwardDeal {
  id: string;
  commodity: CommodityId;
  locationId: string;
  side: 1 | -1; // +1 : le joueur achète
  qty: number; // unité de quantité de la commodité
  price: number; // prix fixe convenu
  month: MonthIndex; // mois de livraison
  deliveryDay: Day;
  counterpartyId: string;
  tradeDay: Day;
}

export interface InventoryLot {
  id: string;
  commodity: CommodityId;
  locationId: string;
  qty: number;
  cost: number; // prix unitaire de revient
  sinceDay: Day;
}

export interface Offer {
  id: string;
  cityId: string;
  commodity: CommodityId;
  locationId: string;
  /** Côté du joueur s'il accepte : +1 il achète (la contrepartie vend). */
  side: 1 | -1;
  qty: number;
  month: MonthIndex;
  /** Différentiel affiché au téléphone vs la courbe benchmark au mois de livraison. */
  diff: number;
  counterpartyId: string;
  expiresDay: Day;
  createdDay: Day;
}

export interface Travel {
  from: string;
  to: string;
  departDay: Day;
  arriveDay: Day;
  hours: number;
}

export type CashCategory =
  | 'vm'
  | 'commission'
  | 'physical'
  | 'storage'
  | 'interest'
  | 'overhead'
  | 'tax'
  | 'travel'
  | 'liquidation';

export interface Company {
  name: string;
  hqCity: string;
  initialCapital: number;
  cash: number; // USD, inclut les dépôts de marge
  rcfDrawn: number;
  autoTreasury: boolean;
  im: number; // marge initiale exigée (USD)
  marginCall: null | { sinceDay: Day; amount: number };
  yearStartNav: number;
  lossCarry: number;
  /** Flux de trésorerie cumulés par commodité (pour l'attribution du P&L). */
  cumCashByCommodity: Record<CommodityId, number>;
  cumCashByCategory: Record<CashCategory, number>;
}

export interface NewsItem {
  id: string;
  day: Day;
  headline: string;
  body?: string;
  commodity?: CommodityId;
  tone: 'up' | 'down' | 'neutral' | 'alert';
  major: boolean;
}

export interface DailyRecord {
  day: Day;
  nav: number;
  pnl: number;
  cash: number;
  im: number;
  pnlBy: Record<CommodityId, number>;
}

export interface LogEntry {
  day: Day;
  text: string;
  amount?: number;
}

export interface GameConfig {
  mode: 'sandbox';
  seed: string;
  companyName: string;
  playerName: string;
  hqCity: string;
  capital: number;
  startYear: number;
  years: number;
  volatility: number; // multiplicateur global (0.6..1.6)
  crisisFrequency: number; // multiplicateur des chocs (0..2)
}

export interface GameState {
  version: number;
  config: GameConfig;
  rng: RngState;
  day: Day;
  startDay: Day;
  endDay: Day;
  market: MarketState;
  company: Company;
  player: { name: string; cityId: string | null; travel: Travel | null };
  futures: FuturesPosition[];
  forwards: ForwardDeal[];
  inventory: InventoryLot[];
  offers: Offer[];
  news: NewsItem[];
  history: DailyRecord[];
  log: LogEntry[];
  nextId: number;
  status: 'running' | 'bankrupt' | 'ended';
  statusReason?: string;
  /** Valeur économique par commodité à la dernière clôture (pour P&L par commodité). */
  lastValueBy: Record<CommodityId, number>;
  lastNav: number;
  lastCloseDay: Day;
  /** Événements de la dernière clôture, consommés par l'UI (pause auto, sons…). */
  pendingAlerts: { kind: 'margin_call' | 'liquidation' | 'bankrupt' | 'major_news' | 'delivery' | 'ended'; text: string }[];
}

export type Action =
  | { type: 'TRADE_FUTURE'; commodity: CommodityId; month: MonthIndex; lots: number }
  | { type: 'ACCEPT_OFFER'; offerId: string }
  | { type: 'SPOT_BUY'; commodity: CommodityId; locationId: string; qty: number }
  | { type: 'SPOT_SELL'; lotId: string; qty?: number }
  | { type: 'TRAVEL'; to: string }
  | { type: 'RCF_DRAW'; amount: number }
  | { type: 'RCF_REPAY'; amount: number }
  | { type: 'SET_AUTO_TREASURY'; on: boolean };

export interface ActionResult {
  ok: boolean;
  message: string;
}
