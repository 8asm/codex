import type { Day, MonthIndex } from './calendar';
import type { RngState } from './rng';

export type CommodityId = 'BRENT' | 'TTF' | 'CU' | 'WHEAT' | 'API2';
export type Currency = 'USD' | 'EUR';
export type Incoterm = 'FOB' | 'CFR' | 'CIF' | 'DAP' | 'DES' | 'FCA' | 'HUB';

/** Règle de dernier jour de cotation (Last Trading Day) calquée sur les vraies bourses. */
export type LtdRule = 'BRENT' | 'TTF' | 'LME' | 'CBOT' | 'LAST_FRIDAY';
export type OptType = 'C' | 'P';
export type OptStyle = 'A' | 'E';
/** Règle d'expiration des options sur futures. */
export type OptionExpiryRule = 'BRENT' | 'TTF' | 'LME' | 'CBOT' | 'WITH_FUTURE';
export type AdvisorId = 'risk' | 'trader' | 'legal' | 'ops' | 'analyst';
export type FreightIndex = 'CAPE' | 'PMX' | 'SMX' | 'AFRA';
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
}

export interface InventoryLot {
  id: string;
  commodity: CommodityId;
  locationId: string;
  qty: number;
  cost: number; // prix unitaire de revient
  sinceDay: Day;
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
  | { kind: 'panel'; panel: 'treasury' | 'risk' | 'book' | 'market' | 'options' | 'physical' | 'news' | 'world' | 'rivals' | 'logistics' | 'assets' | 'automation' | 'career' }
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
  | 'dividends';

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
  pendingAlerts: { kind: 'margin_call' | 'liquidation' | 'bankrupt' | 'major_news' | 'delivery' | 'ended' | 'limit' | 'limit_ok' | 'advice' | 'situation' | 'career'; text: string }[];
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

export type AssetType = 'oilfield' | 'mine_cu' | 'mine_coal' | 'refinery' | 'tank' | 'warehouse' | 'silo' | 'gas_storage' | 'terminal' | 'vessel';
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
  autoSellProduction: boolean;
  autoLogistics: boolean;
  marineInsurance: boolean;
}

export type Action =
  | { type: 'TRADE_FUTURE'; commodity: CommodityId; month: MonthIndex; lots: number }
  | { type: 'ACCEPT_OFFER'; offerId: string }
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
  | { type: 'RETIRE' };

export type NegotiationMove = 'ancrer' | 'concéder' | 'bluffer' | 'argumenter' | 'accepter' | 'rompre';

export interface ActionResult {
  ok: boolean;
  message: string;
}
