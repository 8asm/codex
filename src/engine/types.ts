import type { Day, MonthIndex } from './calendar';
import type { RngState } from './rng';

export type CommodityId =
  | 'BRENT' | 'TTF' | 'CU' | 'WHEAT' | 'API2'
  // phase 8 : énergie
  | 'WTI' | 'DUBAI' | 'GASOIL' | 'GASOLINE' | 'JET' | 'FUELOIL' | 'HH' | 'JKM' | 'POWER' | 'NEWC' | 'METCOAL' | 'EUA'
  // métaux
  | 'AL' | 'ZN' | 'NI' | 'PB' | 'SN' | 'CO' | 'LI' | 'AU' | 'AG' | 'FE'
  // agricoles et softs
  | 'CORN' | 'SOY' | 'SOYMEAL' | 'SOYOIL' | 'SUGAR' | 'COFFEE' | 'COCOA' | 'COTTON' | 'PALM' | 'RICE' | 'OJ';
export type Currency = 'USD' | 'EUR';
export type Incoterm = 'FOB' | 'CFR' | 'CIF' | 'DAP' | 'DES' | 'FCA' | 'HUB';

/** Règle de dernier jour de cotation (Last Trading Day) calquée sur les vraies bourses. */
export type LtdRule = 'BRENT' | 'TTF' | 'LME' | 'CBOT' | 'LAST_FRIDAY' | 'WTI' | 'GASOIL' | 'ICE_SOFTS';
export type OptType = 'C' | 'P';
export type OptStyle = 'A' | 'E';
/** Règle d'expiration des options sur futures. */
export type OptionExpiryRule = 'BRENT' | 'TTF' | 'LME' | 'CBOT' | 'WITH_FUTURE';
export type AdvisorId = 'risk' | 'trader' | 'legal' | 'ops' | 'analyst';
export type FreightIndex = 'CAPE' | 'PMX' | 'SMX' | 'AFRA' | 'LNGC';
export type CareerTrack = 'trading' | 'risk' | 'operations' | 'structured' | 'research';
export type Skill = 'marché' | 'risque' | 'négociation' | 'opérations' | 'finance' | 'relationnel';
export type NpcRole = 'manager' | 'collègue' | 'risk' | 'conformité' | 'client' | 'banquier' | 'chasseur' | 'journaliste' | 'officiel' | 'investisseur' | 'mentor';

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
  /**
   * Phase 8 : décalage du modèle log-normal (log-normale décalée). Le prix vaut exp(·) − shift et peut donc
   * devenir négatif jusqu'à −shift (brut enclavé type WTI quand les cuves sont pleines).
   */
  shift?: number;
}

export interface PhysicalLocation {
  id: string;
  cityId: string;
  label: string; // ex. « CIF Rotterdam »
  incoterm: Incoterm;
  basisMean: number; // différentiel moyen vs benchmark (unité de cotation)
  basisVol: number; // vol annuelle du différentiel (unité de cotation)
  /** Lien au fret : le différentiel bouge avec le taux d'affrètement (+ destination rendue, − origine FOB). */
  freightLink?: { index: FreightIndex; perUnit: number };
}

export interface CommoditySpec {
  id: CommodityId;
  name: string;
  short: string;
  family: 'energy' | 'metals' | 'agri';
  /** Phase 8 : sous-secteur (affichage, corrélations) : brut, produits, gaz, électricité, charbon, carbone, base, précieux… */
  group: string;
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
  options: {
    style: OptStyle;
    expiryRule: OptionExpiryRule;
    strikeStep: number;
    months: number;
    /** Paramètres de smile : σ(K) = σ_ATM (1 + skew·x + curvature·x²), x = ln(K/F)/(σ_ATM √T). */
    skew: number;
    curvature: number;
    /** Demi-fourchette de base en points de vol. */
    volHalfSpread: number;
  };
  /** Limites de position de la bourse (lots) : mois spot et toutes échéances. */
  positionLimits: { spotMonth: number; allMonths: number };
  physical: {
    cargoSizes: number[];
    storagePerUnitMonth: number;
    spotSpreadPct: number;
    locations: PhysicalLocation[];
    /** Phase 8 : false pour l'électricité (aucun stockage : livrée et consommée en temps réel). */
    storable?: boolean;
  };
  /** Logistique : tonnes par unité, manutention portuaire ($/t), pertes en transit, navire selon la taille. */
  logistics: { tonnesPerUnit: number; handlingPerT: number; transitLoss: number; vessel: (qty: number) => FreightIndex };
  /** Règlement des futures à l'échéance : en cash, ou livraison physique dans un lieu (LME, TTF, CBOT). */
  settlement: { kind: 'cash' } | { kind: 'physical'; locationId: string };
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
  /** Sanctions applicables aux sociétés domiciliées ici. */
  sanctionsRegime: 'west' | 'un' | 'east' | 'none';
  /** Coût de déclaration des dérivés par transaction (type EMIR / Dodd-Frank), USD. */
  reportingFee: number;
  /** Régime fiscal spécial éventuel. */
  specialRegime?: { label: string; rate: number; minPhysicalVolume?: number; annualFee?: number };
  blurb: string;
}

export interface Counterparty {
  id: string;
  name: string;
  cityId: string;
  kind: 'trader' | 'major' | 'producer' | 'utility' | 'bank' | 'agri' | 'miner' | 'fund';
  zone: string;
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
  fr?: Record<FreightIndex, number>;
}

export interface MarketState {
  day: Day;
  volRegime: 'calm' | 'stressed';
  volMult: number;
  fxLog: number; // ln(EURUSD)
  commodities: Record<CommodityId, CommodityMarket>;
  history: FactorSnapshot[];
  /** Impact de marché permanent par échéance (décalage log du prix), qui s'estompe chaque nuit. */
  impact: Record<string, number>;
  /** Niveau de vol implicite relatif à la vol du modèle (prime de variance, peur), par commodité. */
  ivLevel: Record<CommodityId, number>;
  /** Log des taux d'affrètement (TCE $/jour) par indice de fret. */
  freight: Record<FreightIndex, number>;
  /** Taux directeurs (continus) : bougent avec les banques centrales. */
  rates: Record<Currency, number>;
  /** Décalages persistants de différentiels (canal bloqué, embargo…), retirés à la fin de l'événement. */
  basisShift: Record<string, number>;
  /** Cotation suspendue jusqu'à ce jour (inclus) ; les chocs s'accumulent et tombent à la réouverture. */
  halted: Partial<Record<CommodityId, number>>;
  haltPending: Partial<Record<CommodityId, [number, number]>>;
  /** Dérive du facteur long sous la probabilité réelle (« narratif » de marché = prime de risque), par an. */
  drift: Partial<Record<CommodityId, number>>;
  /** Phase 7 : forme de la courbe zéro-coupon (Nelson-Siegel) : pente long − court et bosse, par devise. */
  curve?: Record<Currency, { slope: number; hump: number }>;
  /** Chocs transitoires utilisés pour les greeks / stress (jamais persistés en partie). */
  rateShift?: number;
  volShift?: number;
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
  /** Tolérance de quantité (±) au choix du vendeur. */
  tolerance?: number;
  /** Phase 7 : crédit documentaire (émis par notre banque à l'achat, reçu de l'acheteur à la vente). */
  lc?: 'issued' | 'received';
  /** Phase 7 : inspection indépendante commandée au chargement. */
  inspected?: boolean;
}

export interface InventoryLot {
  id: string;
  commodity: CommodityId;
  locationId: string;
  qty: number;
  cost: number; // prix unitaire de revient
  sinceDay: Day;
  /** Phase 7 : facteur de valeur lié à la qualité (1 = conforme ; < 1 hors spécification). */
  quality?: number;
}

export interface OptionPosition {
  id: string;
  commodity: CommodityId;
  month: MonthIndex; // future sous-jacent
  type: OptType;
  strike: number;
  expiry: Day;
  style: OptStyle;
  lots: number; // signé
  avgPremium: number; // prime moyenne par unité (devise de cotation)
}

/** Dérivés de gré à gré avec une banque : swap sur moyenne mensuelle ou option asiatique (APO). */
export interface OtcPosition {
  id: string;
  kind: 'swap' | 'apo';
  commodity: CommodityId;
  month: MonthIndex; // mois de moyenne
  qty: number; // signé, unités physiques (+ = long le flottant / acheteur de l'option)
  strike: number; // prix fixe du swap ou strike de l'APO
  type?: OptType;
  bankId: string;
  tradeDay: Day;
  avgPremium: number; // par unité (APO), 0 pour un swap
}

export interface Fixing {
  day: Day;
  px: number;
}

export interface InternalLimits {
  varPctNav: number; // limite de VaR interne en % des fonds propres
  stopLossPctNav: number; // perte mensuelle maximale en % des fonds propres de début de mois
  deltaPctNav: number; // |delta pour +1 %| maximum par commodité, en % des fonds propres
  strict: boolean; // discipline stricte : bloque les ordres qui augmentent le risque hors limite
}

export interface RiskState {
  var99: number;
  es99: number;
  varBy: Record<CommodityId, number>;
  covenantBreachDays: number;
  rcfFrozen: boolean;
  rcfPenalty: number; // marge supplémentaire sur la RCF (fraction)
  monthStartNav: number;
  limits: InternalLimits;
  breaches: string[];
}

export interface PnlExplain {
  day: Day;
  price: number;
  basis: number;
  fx: number;
  vol: number;
  time: number;
  other: number; // nouveaux deals, coûts, intérêts, frais
  total: number;
}

export interface Advice {
  id: string;
  day: Day;
  advisor: AdvisorId;
  mood: 'neutral' | 'happy' | 'worried' | 'angry' | 'smug';
  text: string;
  rule: string;
  action?: AdviceAction;
  /** Prédiction directionnelle évaluée plus tard (track record). */
  prediction?: { commodity: CommodityId; dir: 1 | -1; ref: number; month: MonthIndex; evalDay: Day; outcome?: 'right' | 'wrong' };
  seen?: boolean;
}

export type AdviceAction =
  | { kind: 'hedge'; commodity: CommodityId }
  | { kind: 'panel'; panel: 'treasury' | 'risk' | 'book' | 'market' | 'options' | 'physical' | 'news' | 'world' | 'rivals' | 'logistics' | 'assets' | 'automation' | 'career' | 'offices' | 'compliance' | 'finance' | 'exotics' }
  | { kind: 'trade'; action: Action; label: string };

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
  /** Tolérance de quantité (±) au choix du vendeur : une option embarquée. */
  tolerance?: number;
  /** Déjà négociée par le joueur (une seule tentative). */
  negotiated?: boolean;
  /** Contrôles KYC en cours jusqu'à ce jour (offre non acceptable avant). */
  kycReadyDay?: Day;
  /** Phase 7 : commission versée à un « consultant » pour obtenir le contrat (USD). */
  bribe?: number;
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
  | 'liquidation'
  | 'premium'
  | 'otc'
  | 'compliance'
  | 'credit'
  | 'freight'
  | 'assets'
  | 'dividends'
  | 'office'
  | 'financing';

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
  frozenCash: null | { amount: number; untilDay: Day };
  /** Multiplicateur de la ligne bancaire (confiance des banquiers du fondateur). */
  creditMult?: number;
  tradesThisMonth: number;
  physVolumeYtd: number;
  lastRelocationDay: Day;
}

export type NewsCategory = 'marché' | 'géopolitique' | 'météo' | 'entreprises' | 'réglementation' | 'macro' | 'logistique';

export interface NewsItem {
  id: string;
  day: Day;
  headline: string;
  body?: string;
  commodity?: CommodityId;
  tone: 'up' | 'down' | 'neutral' | 'alert';
  major: boolean;
  category?: NewsCategory;
  /** Rumeur (non confirmée), confirmée, démentie. */
  stage?: 'rumor' | 'confirmed' | 'denied';
  zone?: string;
  cityId?: string;
  companyId?: string;
  impacts?: { c: CommodityId; dir: 1 | -1 }[];
}

// ---------------------------------------------------------------- monde (phase 3)
export type Impact =
  | { k: 'chi' | 'xi' | 'iv'; c: CommodityId; v: number }
  | { k: 'basis'; loc: string; v: number }
  | { k: 'regime' }
  | { k: 'rate'; ccy: Currency; v: number }
  | { k: 'halt'; c: CommodityId; days: number }
  | { k: 'stability'; zone: string; v: number }
  | { k: 'tension'; v: number }
  | { k: 'tax'; city: string; v: number }
  | { k: 'kyc'; city: string; v: number }
  | { k: 'capctl'; city: string; on: boolean }
  | { k: 'reporting'; city: string; v: number }
  | { k: 'sanction'; zone: string; by: 'west' | 'east'; kind: 'full' | 'pricecap'; c?: CommodityId; capPct?: number }
  | { k: 'liftSanction'; zone: string }
  | { k: 'restriction'; kind: 'exportBan' | 'embargo'; zone: string; importer?: string; c: CommodityId; days: number }
  | { k: 'narrative'; id: string; name: string; drift: Partial<Record<CommodityId, number>>; days: number }
  | { k: 'enso'; v: number }
  | { k: 'effect'; effect: Omit<ActiveEffect, 'id'> }
  | { k: 'companyHit'; id: string; navPct: number; rep: number }
  | { k: 'companyDefault'; id: string }
  | { k: 'freezeCash'; pct: number; days: number }
  | { k: 'warehouseFraud'; loc: string; lossPct: number }
  | { k: 'freight'; idx: FreightIndex; v: number };

export interface ZoneState {
  stability: number;
}

export interface Sanction {
  id: string;
  zone: string;
  by: 'west' | 'east';
  kind: 'full' | 'pricecap';
  c?: CommodityId;
  capPct?: number; // plafond = prix benchmark × (1 − capPct)
  sinceDay: Day;
}

export interface TradeRestriction {
  id: string;
  kind: 'exportBan' | 'embargo';
  zone: string;
  importer?: string;
  c: CommodityId;
  untilDay: Day;
}

/** Effet en cours, visible sur le globe (ouragan, canal bloqué, grève…). */
export interface ActiveEffect {
  id: string;
  label: string;
  icon: string;
  lat: number;
  lon: number;
  untilDay: Day;
  layer: 'météo' | 'logistique' | 'géopolitique' | 'marché';
  basisShift?: Record<string, number>;
  /** Passages maritimes fermés pendant l'événement (ex. 'suez'). */
  closes?: string[];
}

/** Étape différée d'un événement : confirmation, démenti, impact retardé, fin d'événement. */
export interface PendingStage {
  id: string;
  day: Day;
  news?: Omit<NewsItem, 'id' | 'day'>;
  impacts: Impact[];
}

export interface Narrative {
  id: string;
  name: string;
  drift: Partial<Record<CommodityId, number>>;
  untilDay: Day;
}

export interface CityReg {
  taxRate: number;
  kyc: number;
  capitalControls: boolean;
  reportingFee: number;
}

export interface WorldState {
  zones: Record<string, ZoneState>;
  blocTension: number; // 0..100
  sanctions: Sanction[];
  restrictions: TradeRestriction[];
  effects: ActiveEffect[];
  pending: PendingStage[];
  narratives: Narrative[];
  enso: number; // indice El Niño (−2..+2)
  cityRegs: Record<string, CityReg>;
  calendar: { opec: Day; fomc: Day; ecb: Day; elections: Record<string, Day> };
  eventCooldown: Record<string, Day>;
}

export interface AICompanyState {
  id: string;
  nav: number;
  initialNav: number;
  peakNav: number;
  yearStartNav: number;
  exposure: Partial<Record<CommodityId, number>>; // notionnel signé (USD)
  reputation: number;
  rating: string;
  alive: boolean;
  mergedInto?: string;
  defaultDay?: Day;
  scandals: number;
  nextRebalance: Day;
  history: number[];
}

export interface CreditState {
  insurance: boolean;
  csa: Record<string, boolean>;
  collateral: Record<string, number>; // collatéral posté (+) ou reçu (−) par banque
  losses: { day: Day; cp: string; loss: number; recovered: number; insured: number }[];
  /** Contreparties non simulées en défaut (jusqu'à ce jour : restructuration). */
  defaulted: Record<string, Day>;
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
  mode: 'sandbox' | 'story';
  /** Sandbox : créer sa société, ou rejoindre une société existante comme trader. */
  start?: 'found' | 'join';
  /** Histoire / rejoindre : société d'entrée et filière. */
  employerId?: string;
  track?: CareerTrack;
  seed: string;
  companyName: string;
  playerName: string;
  hqCity: string;
  capital: number;
  startYear: number;
  years: number;
  volatility: number; // multiplicateur global (0.6..1.6)
  crisisFrequency: number; // multiplicateur des chocs (0..2)
  /** Phase 7 : scénario historique (identifiant), objectif de victoire choisi. */
  scenario?: string;
  goal?: GoalId;
  /** Phase 8 : commodités autorisées dans la partie (offres, panneaux). Absent = toutes. */
  commodities?: CommodityId[];
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
  options: OptionPosition[];
  otc: OtcPosition[];
  fixings: Record<CommodityId, Fixing[]>;
  risk: RiskState;
  explain: PnlExplain[];
  /** Instantané de fin de journée servant de base au P&L expliqué du lendemain. */
  explainBase: null | { market: MarketState; book: Book; day: Day };
  world: WorldState;
  career: CareerState | null;
  npcs: Npc[];
  situations: Situation[];
  negotiation: Negotiation | null;
  compromises: Compromise[];
  tips: Tip[];
  voyages: Voyage[];
  ffa: FfaPosition[];
  freightFixings: Record<FreightIndex, Fixing[]>;
  assets: AssetState[];
  managers: Manager[];
  opportunities: AssetOpportunity[];
  streams: StreamPosition[];
  automation: Automation;
  office: OfficeState;
  exotics: ExoticPosition[];
  financing: FinancingState;
  compliance: ComplianceState;
  stats: GameStats;
  achievements: Achievement[];
  staff: StaffState;
  companies: AICompanyState[];
  credit: CreditState;
  advice: Advice[];
  adviceCooldown: Record<string, Day>;
  track: Record<AdvisorId, { right: number; wrong: number }>;
  offers: Offer[];
  news: NewsItem[];
  history: DailyRecord[];
  log: LogEntry[];
  nextId: number;
  status: 'running' | 'bankrupt' | 'ended' | 'prison' | 'banned';
  statusReason?: string;
  /** Valeur économique par commodité à la dernière clôture (pour P&L par commodité). */
  lastValueBy: Record<CommodityId, number>;
  lastNav: number;
  lastCloseDay: Day;
  /** Événements de la dernière clôture, consommés par l'UI (pause auto, sons…). */
  pendingAlerts: { kind: 'margin_call' | 'liquidation' | 'bankrupt' | 'major_news' | 'delivery' | 'ended' | 'limit' | 'limit_ok' | 'advice' | 'situation' | 'career' | 'achievement' | 'scenario'; text: string }[];
}

// ---------------------------------------------------------------- phase 5 : mode Histoire
export interface Npc {
  id: string;
  name: string;
  role: NpcRole;
  companyId: string | null; // employeur du PNJ (null : indépendant, administration, média)
  cityId: string;
  trust: number; // −100..100
  honesty: number; // 0..1
  ambition: number; // 0..1
  interest: string; // ce que veut ce PNJ
  memory: { day: Day; delta: number; text: string }[];
  /** Spécifique : journaliste/officiel/collègue qui connaît une compromission du joueur. */
  knows: string[];
}

export interface Compromise {
  id: string;
  day: Day;
  kind: 'corruption' | 'initié' | 'dissimulation' | 'sanctions' | 'manipulation' | 'complicité' | 'mensonge';
  severity: number; // 1..5
  label: string;
  witnesses: string[]; // PNJ au courant
  resolved: boolean;
}

export interface Tip {
  id: string;
  day: Day;
  npcId: string;
  commodity: CommodityId;
  dir: 1 | -1;
  insider: boolean; // information privilégiée non publique
  revealDay: Day;
  real: boolean;
  /** Position nette (unités) au moment du tuyau, pour détecter un usage. */
  netAtTip: number;
  text: string;
}

export interface SituationChoice {
  label: string;
  hint?: string;
}

export interface Situation {
  id: string;
  day: Day;
  template: string;
  title: string;
  text: string;
  npcId?: string;
  choices: SituationChoice[];
  urgent: boolean;
  expiresDay: Day;
  data?: Record<string, number | string>;
}

export interface JobOffer {
  id: string;
  companyId: string;
  track: CareerTrack;
  level: number;
  salary: number;
  expiresDay: Day;
  via?: string; // PNJ chasseur de têtes
  interviewed: boolean;
}

export interface Negotiation {
  id: string;
  kind: 'salaire' | 'bonus' | 'offre' | 'investisseur' | 'deal';
  npcId: string;
  title: string;
  unit: string; // ex. « $ / mois », « % »
  opening: number; // première proposition de la contrepartie
  reservation: number; // limite cachée de la contrepartie
  offer: number; // proposition courante de la contrepartie
  ask: number; // demande courante du joueur
  round: number;
  maxRounds: number;
  patience: number; // 0..100
  leverage: boolean; // alternative réelle (autre offre, information)
  higherIsBetter: boolean;
  log: string[];
  done: boolean;
  result?: number; // valeur conclue (null si rupture)
  context: Record<string, string | number>;
}

export interface CareerState {
  narrative: boolean; // mode Histoire (situations, progression) ou simple poste (sandbox « rejoindre »)
  status: 'employed' | 'unemployed' | 'founder' | 'ceo';
  employerId: string | null;
  track: CareerTrack;
  level: number;
  desk: CommodityId[];
  sinceDay: Day;
  hiredDay: Day;
  salary: number;
  wealth: number;
  skills: Record<Skill, number>;
  reputation: number;
  allocation: number;
  merit: number; // points de mérite de la période (situations, missions)
  warnings: number;
  strikes: number; // dépassements de limites sanctionnés
  frozenUntil: Day;
  lastReview: Day;
  unemployedSince: Day | null;
  offers: JobOffer[];
  team: { id: string; name: string; skill: number; pnlYtd: number }[];
  equity: number; // part du joueur dans sa société (fondateur)
  investors: { npcId: string; share: number; capital: number }[];
  payout: number; // taux de distribution des dividendes (fondateur)
  log: { day: Day; text: string }[];
  ended?: 'prison' | 'interdiction' | 'retraite';
}

export interface Book {
  futures: FuturesPosition[];
  forwards: ForwardDeal[];
  inventory: InventoryLot[];
  options: OptionPosition[];
  otc: OtcPosition[];
  voyages: Voyage[];
  ffa: FfaPosition[];
  exotics?: ExoticPosition[];
  prepays?: Prepayment[];
}

// ---------------------------------------------------------------- phase 4 : logistique, actifs, automatisation
export interface Voyage {
  id: string;
  commodity: CommodityId;
  qty: number;
  cost: number; // coût unitaire de la marchandise (prix de revient)
  from: string; // lieu physique d'origine
  to: string; // lieu physique de destination
  vessel: { kind: 'spot'; index: FreightIndex } | { kind: 'fleet'; assetId: string };
  departDay: Day;
  arriveDay: Day;
  path: string[]; // nœuds maritimes
  nm: number;
  freightUsd: number;
  insured: boolean;
  delayDays: number;
  viaCanals: string[];
}

/** Forward freight agreement compensé : swap sur la moyenne mensuelle d'un indice de fret ($/jour). */
export interface FfaPosition {
  id: string;
  index: FreightIndex;
  month: MonthIndex;
  days: number; // signé : + acheteur de fret
  price: number; // $/jour
  mark: number; // MTM (USD) à la dernière marge de variation
}

export type AssetType = 'oilfield' | 'mine_cu' | 'mine_coal' | 'refinery' | 'tank' | 'warehouse' | 'silo' | 'gas_storage' | 'terminal' | 'vessel'
  // phase 8
  | 'mine' | 'plantation' | 'crush' | 'powerplant' | 'smelter';
export type AssetPolicy = 'prudent' | 'équilibré' | 'agressif';

export interface AssetState {
  id: string;
  defId: string;
  share: number; // part détenue (coentreprise)
  status: 'building' | 'operating' | 'maintenance' | 'strike' | 'damaged';
  statusUntil: Day;
  condition: number; // 0..100
  utilization: number; // 0..1
  managerId: string | null;
  policy: AssetPolicy;
  cost: number; // coût d'acquisition (pour l'amortissement)
  bookValue: number; // valeur comptable (coût − amortissements − dépréciations)
  purchaseDay: Day;
  lifeDays: number;
  produced: number;
  cumCash: number;
  crack?: number; // marge de raffinage courante (raffineries)
  vesselMode?: 'charter' | 'own'; // navire : affrété à d'autres au taux du marché, ou réservé à nos voyages
  tcEndDay?: Day; // navire pris en affrètement à temps (pas possédé)
  hire?: number; // loyer journalier d'un affrètement à temps
  busyUntil?: Day; // navire occupé par un de nos voyages
}

export interface Manager {
  id: string;
  name: string;
  skill: number; // 0..100
  salary: number; // mensuel
  specialty: 'production' | 'stockage' | 'logistique';
  assetId: string | null;
  mistakes: number;
}

export interface AssetOpportunity {
  id: string;
  defId: string;
  kind: 'acquisition' | 'greenfield' | 'stream' | 'royalty' | 'offtake' | 'tcin';
  share: number;
  price: number;
  expiresDay: Day;
  counterpartyId?: string;
  months?: number;
  pct?: number; // part de production (stream) ou de revenu (royalty)
  pricePct?: number; // stream : prix payé en % du spot à la livraison
  qtyPerMonth?: number; // offtake
  discount?: number; // offtake : décote vs spot (unité de cotation)
  hire?: number; // affrètement à temps : $/jour
}

export interface StreamPosition {
  id: string;
  kind: 'stream' | 'royalty' | 'offtake';
  defId?: string;
  counterpartyId: string;
  commodity: CommodityId;
  locationId: string;
  pct: number;
  pricePct: number;
  qtyPerMonth: number;
  discount: number;
  prepayLeft: number; // offtake : prépaiement restant à rembourser par les livraisons
  monthsLeft: number;
  monthsTotal: number;
  upfront: number;
  received: number;
}

export interface Automation {
  autoRoll: boolean;
  autoHedge: { on: boolean; ratio: number; threshold: number };
  /** Quantité (en unités) de futures ouverte par la couverture automatique elle-même, par matière : permet de
   *  déboucler ses propres couvertures quand le physique disparaît, sans toucher aux positions du joueur. */
  hedged?: Partial<Record<CommodityId, number>>;
  autoSellProduction: boolean;
  autoLogistics: boolean;
  marineInsurance: boolean;
}

export type Action =
  | { type: 'TRADE_FUTURE'; commodity: CommodityId; month: MonthIndex; lots: number }
  | { type: 'ACCEPT_OFFER'; offerId: string; inspect?: boolean }
  | { type: 'SPOT_BUY'; commodity: CommodityId; locationId: string; qty: number }
  | { type: 'SPOT_SELL'; lotId: string; qty?: number }
  | { type: 'TRAVEL'; to: string }
  | { type: 'RCF_DRAW'; amount: number }
  | { type: 'RCF_REPAY'; amount: number }
  | { type: 'SET_AUTO_TREASURY'; on: boolean }
  | { type: 'TRADE_SPREAD'; commodity: CommodityId; near: MonthIndex; far: MonthIndex; lots: number }
  | { type: 'TRADE_OPTION'; commodity: CommodityId; month: MonthIndex; optType: OptType; strike: number; lots: number }
  | { type: 'EXERCISE_OPTION'; id: string }
  | { type: 'TRADE_OTC'; kind: 'swap' | 'apo'; commodity: CommodityId; month: MonthIndex; qty: number; strike?: number; optType?: OptType }
  | { type: 'HEDGE_DELTA'; commodity: CommodityId; month?: MonthIndex }
  | { type: 'SET_LIMITS'; limits: Partial<InternalLimits> }
  | { type: 'DISMISS_ADVICE'; id: string }
  | { type: 'RELOCATE_HQ'; city: string }
  | { type: 'SET_CREDIT_INSURANCE'; on: boolean }
  | { type: 'SET_CSA'; bankId: string; on: boolean }
  | { type: 'SHIP_CARGO'; lotId: string; to: string; qty?: number; vesselAssetId?: string }
  | { type: 'TRADE_FFA'; index: FreightIndex; month: MonthIndex; days: number }
  | { type: 'BUY_OPPORTUNITY'; id: string }
  | { type: 'SELL_ASSET'; id: string }
  | { type: 'SET_ASSET'; id: string; utilization?: number; policy?: AssetPolicy; vesselMode?: 'charter' | 'own' }
  | { type: 'MAINTAIN_ASSET'; id: string }
  | { type: 'HIRE_MANAGER'; id: string; assetId: string }
  | { type: 'FIRE_MANAGER'; id: string }
  | { type: 'HEDGE_PRODUCTION'; id: string; months: number; ratio: number }
  | { type: 'SET_AUTOMATION'; patch: Partial<Automation> }
  | { type: 'RESOLVE_SITUATION'; id: string; choice: number }
  | { type: 'NEGOTIATE'; move: NegotiationMove }
  | { type: 'START_NEGOTIATION'; kind: Negotiation['kind']; target: string }
  | { type: 'ACCEPT_JOB'; offerId: string }
  | { type: 'APPLY_JOB'; companyId: string; track: CareerTrack }
  | { type: 'RESIGN' }
  | { type: 'REQUEST_TRANSFER'; track: CareerTrack }
  | { type: 'FOUND_COMPANY'; name: string; city: string }
  | { type: 'SET_PAYOUT'; payout: number }
  | { type: 'MEET_NPC'; npcId: string }
  | { type: 'OFFICE_MOVE'; tier: OfficeTier; buy?: boolean }
  | { type: 'OFFICE_STYLE'; style: FloorStyle }
  | { type: 'OFFICE_ITEM'; item: PrestigeItemId; sell?: boolean }
  | { type: 'OFFICE_PROPERTY'; buy: boolean }
  | { type: 'INVITE_HQ'; npcId: string }
  | { type: 'TRADE_EXOTIC'; spec: ExoticSpec; qty: number }
  | { type: 'CLOSE_EXOTIC'; id: string }
  | { type: 'FINANCE_LOT'; lotId: string }
  | { type: 'REPAY_LOAN'; id: string }
  | { type: 'ACCEPT_PREPAY'; offerId: string }
  | { type: 'SET_COMPLIANCE'; level: ComplianceLevel }
  | { type: 'SELF_REPORT'; caseId: string }
  | { type: 'SET_DEFENSE'; id: string; strategy: DefenseStrategy }
  | { type: 'SETTLE_CASE'; id: string }
  | { type: 'APPEAL'; id: string }
  | { type: 'ACCEPT_BRIBE_OFFER'; offerId: string }
  | { type: 'HIRE'; candidateId: string; cityId?: string }
  | { type: 'FIRE_EMPLOYEE'; id: string }
  | { type: 'RAISE'; id: string; pct: number }
  | { type: 'COUNTER_OFFER'; id: string }
  | { type: 'OPEN_BRANCH'; cityId: string; size: 'bureau' | 'grand' }
  | { type: 'CLOSE_BRANCH'; cityId: string }
  | { type: 'RETIRE' };

export type NegotiationMove = 'ancrer' | 'concéder' | 'bluffer' | 'argumenter' | 'accepter' | 'rompre';

export interface ActionResult {
  ok: boolean;
  message: string;
}

// ---------------------------------------------------------------- phase 6 : bureaux
/** 0 étage loué, 1 plusieurs étages, 2 tour, 3 campus. */
export type OfficeTier = 0 | 1 | 2 | 3;
export type FloorStyle = 'classique' | 'openspace' | 'bunker' | 'verriere';
export type PrestigeItemId = 'trophees' | 'mur' | 'reception' | 'bienetre' | 'academie' | 'art' | 'heliport' | 'auditorium';

/** Dépense capitalisée amortie linéairement (agencements, réaménagements). */
export interface FitOut {
  label: string;
  cost: number;
  since: Day;
  months: number;
}

export interface OfficeState {
  tier: OfficeTier;
  style: FloorStyle;
  /** Immeuble détenu en propre (tour ou campus) plutôt que loué. */
  owned: null | { cost: number; since: Day };
  fitOuts: FitOut[];
  items: { id: PrestigeItemId; cost: number; since: Day }[];
  movedDay: Day;
  lastConferenceYear: number;
  /** Candidatures spontanées reçues (statistique affichée). */
  applicants: number;
}

// ---------------------------------------------------------------- phase 7 : exotiques
export type ExoticKind = 'barrier' | 'digital' | 'lookback' | 'spread' | 'compound' | 'quanto' | 'cliquet';
export type BarrierType = 'up-out' | 'down-out' | 'up-in' | 'down-in';

/** Caractéristiques d'une option exotique de gré à gré sur un future. */
export interface ExoticSpec {
  kind: ExoticKind;
  commodity: CommodityId;
  month: MonthIndex;
  type: OptType;
  /** Strike (barrière, digitale, spread : strike du spread, composée : strike du call sous-jacent, quanto). */
  strike: number;
  /** Échéance de l'exotique (composée : échéance de l'option composée). */
  expiry: Day;
  barrier?: number;
  barrierType?: BarrierType;
  /** Digitale : montant versé par unité si l'option finit dans la monnaie (devise de cotation). */
  payout?: number;
  /** Spread calendaire : second mois (payoff sur F(month) − F(month2)). */
  month2?: MonthIndex;
  /** Phase 8 : spread entre commodités (identifiant de `data/spreads.ts`) ; `month2` est alors l'échéance de la 2ᵉ jambe. */
  spreadId?: string;
  /** Composée : prime à payer à l'échéance pour obtenir le call sous-jacent, et échéance de celui-ci. */
  strike2?: number;
  expiry2?: Day;
  /** Quanto : taux de conversion fixé (devise de paiement par unité de devise de cotation). */
  quantoFx?: number;
  /** Cliquet : nombre de périodes (dates de constatation équiréparties). */
  resets?: number;
}

export interface ExoticPosition extends ExoticSpec {
  id: string;
  /** Quantité physique signée (+ acheteur de l'option). */
  qty: number;
  /** Prime unitaire payée/encaissée (devise de règlement : devise de cotation, ou de paiement pour un quanto). */
  premium: number;
  bankId: string;
  tradeDay: Day;
  /** Barrière franchie (surveillance aux clôtures quotidiennes). */
  hit?: boolean;
  /** Lookback : extrême observé (minimum pour un call, maximum pour un put). */
  extreme?: number;
  /** Cliquet : dates de constatation et prix constatés (refs[0] = prix initial). */
  resetDays?: Day[];
  refs?: number[];
}

// ---------------------------------------------------------------- phase 7 : financement
/** Lettre de crédit documentaire émise par la banque du joueur au profit d'un vendeur. */
export interface LetterOfCredit {
  id: string;
  dealId: string;
  amount: number; // USD
  issued: Day;
  expiry: Day;
}

/** Financement de stock (emprunt garanti par un lot : « borrowing base » / repo de matières premières). */
export interface InventoryLoan {
  id: string;
  lotId: string;
  principal: number; // USD
  haircut: number; // décote initiale
  rate: number; // spread au-dessus du taux USD
  since: Day;
  /** quantité nantie à l'origine (le prêt est remboursé au prorata des sorties de stock) */
  qty: number;
}

/** Préfinancement d'un producteur, remboursé en nature (livraisons mensuelles). */
export interface Prepayment {
  id: string;
  counterpartyId: string;
  commodity: CommodityId;
  locationId: string;
  /** dates et quantités de livraison restantes */
  schedule: { day: Day; qty: number }[];
  paid: number; // USD versés
  /** prix de revient unitaire des lots livrés (devise de cotation) */
  unitCost: number;
  /** spread de crédit implicite figé à l'origine (calibré pour que valeur = prix payé) */
  spread0: number;
  rating0: string;
  tradeDay: Day;
}

export interface PrepayOffer {
  id: string;
  counterpartyId: string;
  commodity: CommodityId;
  locationId: string;
  months: number;
  qtyPerMonth: number;
  discount: number; // décote vs la courbe forward actualisée
  expiresDay: Day;
}

export interface FinancingState {
  lcs: LetterOfCredit[];
  loans: InventoryLoan[];
  prepays: Prepayment[];
  offers: PrepayOffer[];
}

// ---------------------------------------------------------------- phase 7 : conformité
export type ComplianceLevel = 'minimal' | 'standard' | 'renforcé';
export type CaseKind = 'sanctions' | 'kyc' | 'manipulation' | 'corruption' | 'initié';

/** Fait potentiellement répréhensible, inconnu des autorités tant qu'il n'est pas découvert. */
export interface CaseFile {
  id: string;
  day: Day;
  kind: CaseKind;
  severity: number; // 1..5
  gain: number; // profit tiré (USD), base de la confiscation
  label: string;
  /** détecté par la conformité interne (auto-déclaration possible) */
  flagged: boolean;
  status: 'latent' | 'investigated' | 'closed';
}

export type InvestigationStage = 'enquête' | 'poursuites' | 'jugement' | 'appel';
export type DefenseStrategy = 'coopérer' | 'contester';

export interface Investigation {
  id: string;
  caseIds: string[];
  kind: CaseKind;
  authority: string;
  opened: Day;
  stage: InvestigationStage;
  stageEnds: Day;
  strategy: DefenseStrategy;
  legalSpent: number;
  fineEstimate: number;
  selfReported: boolean;
  outcome?: string;
  done: boolean;
}

export interface ComplianceState {
  level: ComplianceLevel;
  cases: CaseFile[];
  investigations: Investigation[];
  /** licence de négoce suspendue : aucune nouvelle opération */
  suspendedUntil: Day;
  /** banques occidentales qui coupent leurs lignes (RCF, crédits documentaires) */
  banksCutUntil: Day;
  fines: number;
  /** offres « avec commission » proposées par des intermédiaires */
  bribeOffers: string[];
}

// ---------------------------------------------------------------- phase 7 : scénarios, succès, objectifs
export type GoalId = 'taille' | 'rendement' | 'fortune' | 'reputation' | 'domination' | 'survie' | 'scenario';

export interface GameStats {
  exoticPnl: number[];
  marginCalls: number;
  marginCallsMet: number;
  lastMarginCallDay: Day;
  carryWins: number;
  negotiationsWon: number;
  voyagesDone: number;
  lcsIssued: number;
  lotsFinanced: number;
  prepaysDone: number;
  investigationsWon: number;
  /** jours ouvrés consécutifs avec du physique couvert à ±10 % */
  hedgedStreak: number;
  bestHedgedStreak: number;
  stressedDays: number;
  haltWatch: null | { c: CommodityId; until: Day };
  squeezesSurvived: number;
  peakNav: number;
  maxDrawdown: number;
  /** grands moments de la partie (récapitulatif) */
  timeline: { day: Day; text: string }[];
  /** P&L réalisé par opération dénouée (récapitulatif : meilleurs et pires deals) */
  deals: { day: Day; label: string; pnl: number }[];
}

export interface Achievement {
  id: string;
  day: Day;
}

// ---------------------------------------------------------------- phase 8 : équipes et bureaux
export type StaffRole = 'trader' | 'analyst' | 'operations' | 'risk' | 'legal' | 'chartering';

export interface Employee {
  id: string;
  name: string;
  role: StaffRole;
  /** famille couverte (traders, analystes) */
  family?: CommoditySpec['family'];
  skill: number; // 0..100
  ambition: number; // 0..1
  loyalty: number; // 0..100
  salary: number; // mensuel (USD)
  /** contacts clients apportés (traders) */
  network: number;
  hiredDay: Day;
  /** ville de rattachement (siège ou bureau) */
  cityId: string;
}

export interface Candidate extends Employee {
  expiresDay: Day;
}

export interface Branch {
  cityId: string;
  size: 'bureau' | 'grand';
  openedDay: Day;
  fitOut: number;
}

export interface PoachOffer {
  employeeId: string;
  companyId: string;
  salary: number;
  expiresDay: Day;
}

export interface StaffState {
  employees: Employee[];
  candidates: Candidate[];
  branches: Branch[];
  poach: PoachOffer[];
}
