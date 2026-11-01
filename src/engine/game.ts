/**
 * Boucle de jeu. Le moteur MUTE l'état passé (plus simple et rapide) ; l'UI se charge de notifier.
 * Aucune dépendance au DOM : tout est testable et déterministe pour une seed donnée.
 *
 * Journée :
 *   ouverture  -> arrivée des voyages, révision des marges bourse, news (chocs), offres physiques
 *   session    -> actions du joueur (aux prix du jour)
 *   clôture    -> VM, échéances, livraisons, stockage, intérêts, frais, impôts, trésorerie/appels de marge
 *   nuit       -> le marché évolue jusqu'au jour ouvré suivant
 */
import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { adjustFollowing, dayFromYMD, monthIndexOf, nextBusinessDay, weekday, ymd, addBusinessDays, formatDay } from './calendar';
import { addCash, log } from './ledger';
import { baseVolMult, createMarket, exchangeImRate, stepMarket } from './market';
import { recomputeIm } from './margin';
import { addNews, dailyNews } from './news';
import { acceptOffer, chargeStorage, generateOffers, processDeliveries, spotBuy, spotSell } from './physical';
import { seedRng } from './rng';
import { exerciseOption, expireContracts, expireOptions, liquidateAllFutures, settleVariationMargin, tradeFuture, tradeOption, tradeSpread } from './trading';
import { recordFixings, settleOtc, tradeOtc } from './derivatives';
import { computeExplain, snapshotForExplain } from './explain';
import { computeVar } from './risk';
import { DEFAULT_LIMITS, evaluateLimits, guarded } from './limits';
import { morningAdvice } from './advisors';
import { listedMonths, lotQty } from './contracts';
import { futuresPrice, fx } from './market';
import { exposures } from './valuation';
import type { AdvisorId, RiskState } from './types';
import { createWorld, stepWorld } from './world';
import { dailyEvents } from './events';
import { createCompanies, resetCompanyYear, stepCompanies } from './companies';
import { stepCredit } from './credit';
import { flightInfo } from './travel';
import { accrueInterest, drawRcf, repayRcf, settleTreasury } from './treasury';
import type { Action, ActionResult, CashCategory, CommodityId, GameConfig, GameState } from './types';
import { nav, valueByCommodity } from './valuation';
import { COMMODITIES as SPECS } from '../data/commodities';

export const SAVE_VERSION = 3;
/** Déménagement du siège : coût fixe + taxe de sortie, une fois par an au plus. */
export const RELOCATION_FIXED = 1_500_000;
export const RELOCATION_EXIT_TAX = 0.01;
export const RELOCATION_COOLDOWN = 250;
const STAFF_MONTHLY = 90_000; // 3 personnes, base Genève
/** Le marché est simulé ~3 mois avant le jour 1 : historique de prix et courbe « il y a 30 jours » dès le départ. */
const WARMUP_DAYS = 91;

function warmUpMarket(state: GameState) {
  const m = state.market;
  let d = m.day;
  while (true) {
    const next = nextBusinessDay(d);
    if (next > state.startDay) break;
    stepMarket(m, state.rng, next, state.config.volatility, state.config.crisisFrequency);
    d = next;
    state.day = d;
    if (d < state.startDay) recordFixings(state);
  }
  m.day = state.startDay;
  // On démarre toujours en régime calme : la première crise doit se mériter.
  m.volRegime = 'calm';
  m.volMult = baseVolMult(m, state.config.volatility);
  for (const c of COMMODITY_IDS) m.commodities[c].imRate = exchangeImRate(m, c);
}

export const DEFAULT_CONFIG: GameConfig = {
  mode: 'sandbox',
  seed: 'tradewinds',
  companyName: 'Alizé Trading SA',
  playerName: 'Vous',
  hqCity: 'geneva',
  capital: 25_000_000,
  startYear: 2027,
  years: 3,
  volatility: 1,
  crisisFrequency: 1,
};

export function defaultRisk(capital: number): RiskState {
  return {
    var99: 0, es99: 0, varBy: zeroBy(), covenantBreachDays: 0, rcfFrozen: false, rcfPenalty: 0,
    monthStartNav: capital, limits: { ...DEFAULT_LIMITS }, breaches: [],
  };
}

const zeroTrack = (): Record<AdvisorId, { right: number; wrong: number }> => ({
  risk: { right: 0, wrong: 0 }, trader: { right: 0, wrong: 0 }, legal: { right: 0, wrong: 0 }, ops: { right: 0, wrong: 0 }, analyst: { right: 0, wrong: 0 },
});

const zeroBy = () => Object.fromEntries(COMMODITY_IDS.map((c) => [c, 0])) as Record<CommodityId, number>;

export function createGame(partial: Partial<GameConfig> = {}): GameState {
  const config: GameConfig = { ...DEFAULT_CONFIG, ...partial };
  const startDay = adjustFollowing(dayFromYMD(config.startYear, 1, 4));
  const endDay = dayFromYMD(config.startYear + config.years, 1, 1) - 1;
  const cats: CashCategory[] = ['vm', 'commission', 'physical', 'storage', 'interest', 'overhead', 'tax', 'travel', 'liquidation', 'premium', 'otc', 'compliance', 'credit'];
  const state: GameState = {
    version: SAVE_VERSION,
    config,
    rng: seedRng(config.seed),
    day: startDay,
    startDay,
    endDay,
    market: createMarket(startDay - WARMUP_DAYS, config.volatility),
    company: {
      name: config.companyName,
      hqCity: config.hqCity,
      initialCapital: config.capital,
      cash: config.capital,
      rcfDrawn: 0,
      autoTreasury: true,
      im: 0,
      marginCall: null,
      yearStartNav: config.capital,
      lossCarry: 0,
      cumCashByCommodity: zeroBy(),
      cumCashByCategory: Object.fromEntries(cats.map((c) => [c, 0])) as Record<CashCategory, number>,
      frozenCash: null,
      tradesThisMonth: 0,
      physVolumeYtd: 0,
      lastRelocationDay: -1e9,
    },
    player: { name: config.playerName, cityId: config.hqCity, travel: null },
    futures: [],
    forwards: [],
    inventory: [],
    options: [],
    otc: [],
    fixings: Object.fromEntries(COMMODITY_IDS.map((c) => [c, []])) as unknown as GameState['fixings'],
    risk: defaultRisk(config.capital),
    explain: [],
    explainBase: null,
    advice: [],
    adviceCooldown: {},
    track: zeroTrack(),
    world: null as unknown as GameState['world'],
    companies: createCompanies(),
    credit: { insurance: false, csa: {}, collateral: {}, losses: [], defaulted: {} },
    offers: [],
    news: [],
    history: [],
    log: [],
    nextId: 1,
    status: 'running',
    lastValueBy: zeroBy(),
    lastNav: config.capital,
    lastCloseDay: startDay - 1,
    pendingAlerts: [],
  };
  warmUpMarket(state);
  state.day = startDay;
  state.world = createWorld(state);
  const city = CITY_BY_ID[config.hqCity]!;
  addNews(state, {
    headline: `${config.companyName} ouvre ses bureaux à ${city.name}`,
    body: `Capital : ${(config.capital / 1e6).toFixed(0)} M$. Ligne de crédit bancaire disponible. Bonne chance.`,
    tone: 'neutral',
    major: false,
  });
  openDay(state);
  return state;
}

/**
 * Taux d'impôt effectif du siège : taux de la ville (qui évolue avec élections et réformes), ou régime spécial
 * s'il est plus favorable et ses conditions remplies (volume physique annuel, redevance de zone franche).
 */
export function effectiveTaxRate(state: GameState): { rate: number; regime: null | NonNullable<(typeof CITY_BY_ID)[string]['specialRegime']> } {
  const city = CITY_BY_ID[state.company.hqCity]!;
  const base = state.world.cityRegs[city.id]!.taxRate;
  const sp = city.specialRegime;
  if (sp && sp.rate < base && state.company.physVolumeYtd >= (sp.minPhysicalVolume ?? 0)) return { rate: sp.rate, regime: sp };
  return { rate: base, regime: null };
}

function openDay(state: GameState) {
  const t = state.player.travel;
  if (t && state.day >= t.arriveDay) {
    state.player.cityId = t.to;
    state.player.travel = null;
    log(state, `Arrivée à ${CITY_BY_ID[t.to]!.name}.`);
  }
  // Les bourses révisent leurs marges chaque lundi, ou en urgence quand la volatilité explose.
  const m = state.market;
  for (const c of COMMODITY_IDS) {
    const target = exchangeImRate(m, c);
    const cur = m.commodities[c].imRate;
    if (weekday(state.day) === 1 || target > cur * 1.25) {
      if (Math.abs(target - cur) / Math.max(cur, 1e-9) > 0.05 && state.day !== state.startDay) {
        addNews(state, {
          headline: `${COMMODITIES[c].exchange} ${target > cur ? 'relève' : 'abaisse'} les marges sur le ${COMMODITIES[c].short} (${(cur * 100).toFixed(1)} % → ${(target * 100).toFixed(1)} %)`,
          commodity: c,
          tone: target > cur ? 'alert' : 'neutral',
          major: target > cur * 1.25,
        });
      }
      m.commodities[c].imRate = target;
    }
  }
  stepWorld(state);
  for (const n of dailyNews(state)) if (n.major) state.pendingAlerts.push({ kind: 'major_news', text: n.headline });
  dailyEvents(state);
  if (state.day !== state.startDay) stepCompanies(state);
  recomputeIm(state);
  generateOffers(state);
  morningAdvice(state);
}

function closeDay(state: GameState) {
  const co = state.company;
  const days = state.day - state.lastCloseDay;
  // L'exercice des options précède la VM : les futures reçus au strike sont réglés dès ce soir.
  for (const msg of expireOptions(state)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  settleVariationMargin(state);
  expireContracts(state);
  for (const msg of processDeliveries(state)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  recordFixings(state);
  for (const msg of settleOtc(state)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  chargeStorage(state, days);
  accrueInterest(state, days);
  stepCredit(state, days);

  const prev = ymd(state.lastCloseDay);
  const cur = ymd(state.day);
  if (monthIndexOf(state.day) !== monthIndexOf(state.lastCloseDay)) {
    const city = CITY_BY_ID[co.hqCity]!;
    const cost = city.officeRentMonthly + STAFF_MONTHLY * city.staffCostIndex;
    addCash(state, -cost, 'overhead');
    log(state, `Frais généraux du mois (loyer, salaires)`, -cost);
    // Déclaration réglementaire des dérivés (type EMIR / Dodd-Frank) : coût par transaction du mois écoulé.
    const fee = state.world.cityRegs[co.hqCity]!.reportingFee * co.tradesThisMonth;
    if (fee > 0) {
      addCash(state, -fee, 'compliance');
      log(state, `Reporting réglementaire : ${co.tradesThisMonth} transactions déclarées`, -fee);
    }
    co.tradesThisMonth = 0;
  }
  if (cur.y !== prev.y && state.lastCloseDay >= state.startDay) {
    // Impôt sur le résultat de l'exercice écoulé (comptabilité en juste valeur), avec report de pertes.
    const profit = state.lastNav - co.yearStartNav;
    const taxable = profit - co.lossCarry;
    const { rate, regime } = effectiveTaxRate(state);
    const fee = regime?.annualFee ?? 0;
    if (fee > 0) addCash(state, -fee, 'tax');
    let tax = 0;
    if (taxable > 0) {
      tax = taxable * rate;
      co.lossCarry = 0;
    } else {
      co.lossCarry = -taxable;
    }
    if (tax > 0) addCash(state, -tax, 'tax');
    addNews(state, {
      headline: `Clôture de l’exercice ${prev.y} : résultat ${(profit / 1e6).toFixed(2)} M$, impôt ${(tax / 1e6).toFixed(2)} M$ (taux ${(rate * 100).toFixed(1)} %${regime ? ` — ${regime.label}` : ''})`,
      tone: 'neutral',
      major: false,
    });
    co.yearStartNav = state.lastNav - tax - fee;
    co.physVolumeYtd = 0;
    resetCompanyYear(state);
  }
  state.offers = state.offers.filter((o) => o.expiresDay > state.day);

  recomputeIm(state);
  let deficit = settleTreasury(state);
  if (deficit > 0) {
    if (co.marginCall && co.marginCall.sinceDay < state.day) {
      liquidateAllFutures(state);
      state.pendingAlerts.push({ kind: 'liquidation', text: 'Appel de marge non couvert : le courtier a liquidé toutes vos positions futures.' });
      addNews(state, { headline: `${co.name} : positions liquidées par son courtier`, tone: 'alert', major: true });
      deficit = settleTreasury(state);
      if (deficit > 0 || co.cash < 0) {
        bankrupt(state, 'Impossible de couvrir les appels de marge et la dette exigible.');
      } else co.marginCall = null;
    } else {
      const fresh = !co.marginCall;
      co.marginCall = { sinceDay: co.marginCall?.sinceDay ?? state.day, amount: deficit };
      if (fresh) state.pendingAlerts.push({ kind: 'margin_call', text: `Appel de marge de ${(deficit / 1e6).toFixed(2)} M$ à couvrir avant la clôture de demain.` });
    }
  } else co.marginCall = null;

  const navNow = nav(state);
  if (state.status === 'running' && navNow < 0) bankrupt(state, 'Fonds propres négatifs : les banques coupent les lignes.');

  const vb = valueByCommodity(state);
  const pnlBy = {} as Record<CommodityId, number>;
  for (const c of COMMODITY_IDS) pnlBy[c] = vb[c] - state.lastValueBy[c];
  state.history.push({ day: state.day, nav: navNow, pnl: navNow - state.lastNav, cash: co.cash, im: co.im, pnlBy });
  if (state.history.length > 1500) state.history.shift();

  const ex = computeExplain(state, navNow - state.lastNav);
  if (ex) {
    state.explain.push(ex);
    if (state.explain.length > 260) state.explain.shift();
  }
  snapshotForExplain(state);

  if (monthIndexOf(state.day) !== monthIndexOf(state.lastCloseDay)) state.risk.monthStartNav = state.lastNav;
  const v = computeVar(state);
  state.risk.var99 = v.var99;
  state.risk.es99 = v.es99;
  state.risk.varBy = v.varBy;
  if (state.status === 'running') evaluateLimits(state, navNow);

  state.lastValueBy = vb;
  state.lastNav = navNow;
  state.lastCloseDay = state.day;
}

function bankrupt(state: GameState, reason: string) {
  state.status = 'bankrupt';
  state.statusReason = reason;
  state.pendingAlerts.push({ kind: 'bankrupt', text: reason });
  addNews(state, { headline: `Faillite de ${state.company.name}`, body: reason, tone: 'alert', major: true });
}

/** Clôture le jour courant, fait passer la nuit, ouvre le jour ouvré suivant. */
export function advanceDay(state: GameState): void {
  if (state.status !== 'running') return;
  closeDay(state);
  if (state.status !== 'running') return;
  const next = nextBusinessDay(state.day);
  if (next > state.endDay) {
    state.status = 'ended';
    state.statusReason = `Fin de partie le ${formatDay(state.day)}.`;
    state.pendingAlerts.push({ kind: 'ended', text: state.statusReason });
    return;
  }
  stepMarket(state.market, state.rng, next, state.config.volatility, state.config.crisisFrequency);
  state.day = next;
  openDay(state);
}

export function dispatch(state: GameState, action: Action): ActionResult {
  if (state.status !== 'running') return { ok: false, message: 'La partie est terminée.' };
  switch (action.type) {
    case 'TRADE_FUTURE':
      return counted(state, guarded(state, () => tradeFuture(state, action.commodity, action.month, action.lots)));
    case 'TRADE_SPREAD':
      return counted(state, guarded(state, () => tradeSpread(state, action.commodity, action.near, action.far, action.lots)), 2);
    case 'TRADE_OPTION':
      return counted(state, guarded(state, () => tradeOption(state, action.commodity, action.month, action.optType, action.strike, action.lots)));
    case 'RELOCATE_HQ':
      return relocate(state, action.city);
    case 'SET_CREDIT_INSURANCE':
      state.credit.insurance = action.on;
      return { ok: true, message: action.on ? 'Assurance-crédit souscrite sur le physique.' : 'Assurance-crédit résiliée.' };
    case 'SET_CSA':
      state.credit.csa[action.bankId] = action.on;
      return { ok: true, message: action.on ? 'CSA signé : collatéral échangé chaque soir, fourchettes réduites.' : 'CSA résilié : le collatéral sera restitué ce soir.' };
    case 'EXERCISE_OPTION':
      return exerciseOption(state, action.id);
    case 'TRADE_OTC':
      return counted(state, guarded(state, () => tradeOtc(state, action.kind, action.commodity, action.month, action.qty, nav(state), action.strike, action.optType)));
    case 'HEDGE_DELTA':
      return hedgeDelta(state, action.commodity, action.month);
    case 'SET_LIMITS':
      state.risk.limits = { ...state.risk.limits, ...action.limits };
      return { ok: true, message: 'Limites internes mises à jour.' };
    case 'DISMISS_ADVICE': {
      const a = state.advice.find((x) => x.id === action.id);
      if (a) a.seen = true;
      return { ok: true, message: '' };
    }
    case 'ACCEPT_OFFER':
      return guarded(state, () => acceptOffer(state, action.offerId));
    case 'SPOT_BUY':
      return guarded(state, () => spotBuy(state, action.commodity, action.locationId, action.qty));
    case 'SPOT_SELL':
      return spotSell(state, action.lotId, action.qty);
    case 'TRAVEL': {
      const p = state.player;
      if (p.travel) return { ok: false, message: 'Vous êtes déjà en vol.' };
      if (!p.cityId || p.cityId === action.to) return { ok: false, message: 'Vous êtes déjà sur place.' };
      const fi = flightInfo(p.cityId, action.to);
      addCash(state, -fi.cost, 'travel');
      p.travel = { from: p.cityId, to: action.to, departDay: state.day, arriveDay: addBusinessDays(state.day, fi.days), hours: fi.hours };
      p.cityId = null;
      log(state, `Départ pour ${CITY_BY_ID[action.to]!.name} (${fi.hours.toFixed(1)} h de vol)`, -fi.cost);
      return { ok: true, message: `En route pour ${CITY_BY_ID[action.to]!.name}.` };
    }
    case 'RCF_DRAW': {
      const a = drawRcf(state, action.amount);
      return a > 0 ? { ok: true, message: `Tiré ${(a / 1e6).toFixed(2)} M$ sur la RCF.` } : { ok: false, message: 'Aucune capacité disponible sur la ligne.' };
    }
    case 'RCF_REPAY': {
      const a = repayRcf(state, action.amount);
      return a > 0 ? { ok: true, message: `Remboursé ${(a / 1e6).toFixed(2)} M$.` } : { ok: false, message: 'Rien à rembourser.' };
    }
    case 'SET_AUTO_TREASURY':
      state.company.autoTreasury = action.on;
      return { ok: true, message: action.on ? 'Trésorerie automatique activée.' : 'Trésorerie en manuel.' };
  }
}

/**
 * Neutralise le delta d'une commodité avec l'échéance choisie (front par défaut) :
 * lots = −delta(+1 %) / delta(+1 %) d'un lot. Couverture de premier ordre : le gamma, la base et le
 * calendrier restent (et c'est justement la leçon).
 */
export function hedgeDeltaLots(state: GameState, c: CommodityId, month?: number): { lots: number; month: number } {
  const spec = SPECS[c];
  const mi = month ?? listedMonths(spec, state.day)[0]!;
  const e = exposures(state).find((x) => x.commodity === c)!;
  const perLot = lotQty(spec, mi) * futuresPrice(state.market, c, mi) * spec.valuePerUnit * fx(state.market, spec.currency) * 0.01;
  return { lots: -Math.round(e.delta1pct / perLot), month: mi };
}

function hedgeDelta(state: GameState, c: CommodityId, month?: number): ActionResult {
  const { lots, month: mi } = hedgeDeltaLots(state, c, month);
  if (lots === 0) return { ok: false, message: 'Delta déjà neutre à un lot près.' };
  const r = tradeFuture(state, c, mi, lots);
  return r.ok ? { ok: true, message: `Couverture : ${lots > 0 ? 'achat' : 'vente'} de ${Math.abs(lots)} lots. ${r.message}` } : r;
}

function counted(state: GameState, r: ActionResult, n = 1): ActionResult {
  if (r.ok) state.company.tradesThisMonth += n;
  return r;
}

export function relocationCost(state: GameState): number {
  return RELOCATION_FIXED + RELOCATION_EXIT_TAX * Math.max(0, nav(state));
}

/** Transfert du siège : nouvelle fiscalité, nouveau régulateur, nouveau régime de sanctions. */
function relocate(state: GameState, city: string): ActionResult {
  const co = state.company;
  if (!CITY_BY_ID[city] || city === co.hqCity) return { ok: false, message: 'Ville invalide.' };
  if (co.marginCall) return { ok: false, message: 'Impossible de déménager pendant un appel de marge.' };
  if (state.day - co.lastRelocationDay < RELOCATION_COOLDOWN * 1.4) return { ok: false, message: 'Un seul transfert de siège par an.' };
  const cost = relocationCost(state);
  if (cost > co.cash - co.im) return { ok: false, message: 'Trésorerie insuffisante pour le transfert.' };
  addCash(state, -cost, 'overhead');
  const from = CITY_BY_ID[co.hqCity]!.name;
  co.hqCity = city;
  co.lastRelocationDay = state.day;
  addNews(state, { headline: `${co.name} transfère son siège de ${from} à ${CITY_BY_ID[city]!.name}`, body: 'Nouvelle fiscalité, nouveau régulateur, nouvelles sanctions applicables.', tone: 'neutral', major: false, category: 'réglementation', cityId: city });
  log(state, `Transfert du siège à ${CITY_BY_ID[city]!.name}`, -cost);
  return { ok: true, message: `Siège transféré à ${CITY_BY_ID[city]!.name} (coût ${(cost / 1e6).toFixed(2)} M$).` };
}

/** Migration des sauvegardes d'anciennes versions. */
export function migrateState(raw: GameState): GameState {
  const s = raw as GameState & { version: number };
  if (s.version === 1) {
    s.options = [];
    s.otc = [];
    s.fixings = Object.fromEntries(COMMODITY_IDS.map((c) => [c, []])) as unknown as GameState['fixings'];
    s.risk = defaultRisk(s.company.initialCapital);
    s.risk.monthStartNav = s.lastNav;
    s.explain = [];
    s.explainBase = null;
    s.advice = [];
    s.adviceCooldown = {};
    s.track = zeroTrack();
    s.market.impact = {};
    s.market.ivLevel = Object.fromEntries(COMMODITY_IDS.map((c) => [c, 1.08])) as Record<CommodityId, number>;
    s.company.cumCashByCategory.premium = 0;
    s.company.cumCashByCategory.otc = 0;
    s.version = 2;
  }
  if (s.version === 2) {
    const m = s.market;
    m.rates = { USD: 0.04, EUR: 0.0225 };
    m.basisShift = {};
    m.halted = {};
    m.haltPending = {};
    m.drift = {};
    s.world = createWorld(s);
    s.companies = createCompanies();
    s.credit = { insurance: false, csa: {}, collateral: {}, losses: [], defaulted: {} };
    Object.assign(s.company, { frozenCash: null, tradesThisMonth: 0, physVolumeYtd: 0, lastRelocationDay: -1e9 });
    s.company.cumCashByCategory.compliance = 0;
    s.company.cumCashByCategory.credit = 0;
    s.version = 3;
  }
  return s;
}

export function consumeAlerts(state: GameState) {
  const a = state.pendingAlerts;
  state.pendingAlerts = [];
  return a;
}
