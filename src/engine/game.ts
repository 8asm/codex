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
import { customizeOffice } from './offices';
import { buyLicence, govMonth, lobby, requestTaxRuling, resolveTenders, submitBid, taxRulingCut } from './government';
import { factors } from './difficulty';
import { offerBlock } from './physical';
import { loreDay } from './lore';
import { CITIES, CITY_BY_ID } from '../data/cities';
import { ZONES } from '../data/world';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { adjustFollowing, dayFromYMD, monthIndexOf, monthLabel, nextBusinessDay, weekday, ymd, addBusinessDays, formatDay } from './calendar';
import { addCash, log } from './ledger';
import { baseVolMult, createMarket, DEFAULT_CURVE, exchangeImRate, stepMarket } from './market';
import { recomputeIm } from './margin';
import { addNews, dailyNews } from './news';
import { acceptOffer, chargeStorage, generateOffers, processDeliveries, spotBuy, spotSell } from './physical';
import { hashUniform, seedRng } from './rng';
import { exerciseOption, expireContracts, expireOptions, liquidateAllFutures, settleVariationMargin, tradeFuture, tradeOption, tradeSpread } from './trading';
import { recordFixings, settleOtc, tradeOtc } from './derivatives';
import { computeExplain, snapshotForExplain } from './explain';
import { computeVar } from './risk';
import { DEFAULT_LIMITS, evaluateLimits, guarded } from './limits';
import { morningAdvice } from './advisors';
import { listedMonths, lotQty } from './contracts';
import { futuresPrice, fx } from './market';
import { exposures } from './valuation';
import type { AdvisorId, CareerTrack, RiskState } from './types';
import { createWorld, stepWorld } from './world';
import { dailyEvents } from './events';
import { createCompanies, resetCompanyYear, stepCompanies } from './companies';
import { stepCredit } from './credit';
import { recordFreightFixings, settleFfa, tradeFfa } from './freight';
import { shipCargo, stepVoyages } from './logistics';
import { buyOpportunity, createManagerPool, fireManager, generateOpportunities, hedgeProduction, hireManager, sellAsset, startMaintenance, stepAssets } from './assets';
import { DEFAULT_AUTOMATION, rehedgeAfterDeliveries, runAutomation } from './automation';
import { lessonTick, quitLesson, skipLessonStep, startLesson } from './lessons';
import { stepProgression, unlockAll } from './progression';
import { deskMonth, deskTrading, liquidateDesks, setMandate, settleDesks } from './desks';
import { FREIGHT_IDS } from '../data/freight';
import { acceptJob, careerClose, careerLog, careerOpen, deskFor, evaluate, fire, flattenBook, foundCompany, initCareer, interviewChance, isEmployee, leave, makeOffer, permissionError, salaryFor, setAllocation, title } from './career';
import { checkTips, dailySituations, maybeTip, pushSituation, resolveSituation, stepCompromises } from './situations';
import { negotiate, startNegotiation } from './negotiation';
import { contactAt, decayRelations, findRole, npc, remember, seedNpcs } from './npcs';
import { isPresent, offerDeliveryDay } from './physical';
import { forwardAt } from './market';
import { COMPANY_BY_ID } from '../data/companies';
import { TRACK_SKILL } from '../data/career';
import type { NegotiationMove } from './types';
import { flightInfo } from './travel';
import { accrueInterest, drawRcf, repayRcf, settleTreasury } from './treasury';
import type { Action, ActionResult, CashCategory, CommodityId, GameConfig, GameState } from './types';
import { nav, valueByCommodity } from './valuation';
import { COMMODITIES as SPECS } from '../data/commodities';
import { SCENARIO_BY_ID } from '../data/scenarios';
import { applyScenario } from './scenarios';
import { closeExotic, stepExotics, tradeExotic } from './exotics';
import { acceptPrepay, financeLot, repayLoan, stepFinancing } from './financing';
import { appeal, checkFuture, complianceMonth, defaultCompliance, exchangeSurveillance, LEVELS, selfReport, setDefense, settleCase, stepInvestigations, suspended } from './compliance';
import { defaultStats, stepProgress } from './progress';
import { taxSplit, closeBranch, counterOffer, defaultStaff, fireEmployee, hire, openBranch, raise, refreshCandidates, staffMonth } from './staff';
import { defaultOffice, fitOutCost, inviteToHq, managesOffice, moveOffice, negotiationEdge, officeEffects, officeItem, officeMonth, officeProperty, relocateOffice, setStyle } from './offices';

export const SAVE_VERSION = 9;
/** Déménagement du siège : coût fixe + taxe de sortie, une fois par an au plus. */
export const RELOCATION_FIXED = 1_500_000;
export const RELOCATION_EXIT_TAX = 0.01;
export const RELOCATION_COOLDOWN = 250;
const STAFF_MONTHLY = 90_000; // 3 personnes, base Genève
/** Opérations interdites pendant une suspension de licence. */
const SUSPENDED_ACTIONS = new Set(['TRADE_FUTURE', 'TRADE_SPREAD', 'TRADE_OPTION', 'TRADE_OTC', 'TRADE_EXOTIC', 'ACCEPT_OFFER', 'ACCEPT_BRIBE_OFFER', 'SPOT_BUY', 'TRADE_FFA', 'SHIP_CARGO', 'ACCEPT_PREPAY', 'HEDGE_DELTA']);
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
  const sc = partial.scenario ? SCENARIO_BY_ID[partial.scenario] : undefined;
  const config: GameConfig = sc
    ? { ...DEFAULT_CONFIG, ...partial, ...sc.config, mode: 'sandbox', start: 'found', scenario: sc.id, goal: 'scenario' }
    : { ...DEFAULT_CONFIG, ...partial };
  const startDay = adjustFollowing(dayFromYMD(config.startYear, 1, 4));
  const endDay = dayFromYMD(config.startYear + config.years, 1, 1) - 1;
  const cats: CashCategory[] = ['vm', 'commission', 'physical', 'storage', 'interest', 'overhead', 'tax', 'travel', 'liquidation', 'premium', 'otc', 'compliance', 'credit', 'freight', 'assets', 'dividends', 'office', 'financing'];
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
    voyages: [],
    ffa: [],
    freightFixings: Object.fromEntries(FREIGHT_IDS.map((i) => [i, []])) as unknown as GameState['freightFixings'],
    assets: [],
    managers: [],
    opportunities: [],
    streams: [],
    automation: { ...DEFAULT_AUTOMATION, autoHedge: { ...DEFAULT_AUTOMATION.autoHedge } },
    office: defaultOffice(startDay),
    exotics: [],
    financing: { lcs: [], loans: [], prepays: [], offers: [] },
    compliance: defaultCompliance(),
    stats: defaultStats(config.capital),
    achievements: [],
    staff: defaultStaff(),
    career: null,
    npcs: [],
    situations: [],
    negotiation: null,
    compromises: [],
    tips: [],
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
  createManagerPool(state, 6);
  generateOpportunities(state, 4);
  seedNpcs(state);
  if (config.mode === 'story' || config.start === 'join') initCareer(state);
  applyScenario(state);
  refreshCandidates(state);
  // mode débutant : roll et logistique automatiques, visite guidée lancée d'office (la couverture reste à apprendre)
  if (config.difficulty === 'debutant' && !state.career && !config.scenario) {
    state.automation.autoRoll = true;
    state.automation.autoLogistics = true;
    state.lessons = { active: 'first', step: 0, done: [] };
  }
  const city = CITY_BY_ID[state.company.hqCity]!;
  if (!state.career) {
    addNews(state, {
      headline: `${config.companyName} ouvre ses bureaux à ${city.name}`,
      body: `Capital : ${(config.capital / 1e6).toFixed(0)} M$. Ligne de crédit bancaire disponible. Bonne chance.`,
      tone: 'neutral',
      major: false,
    });
  } else {
    addNews(state, { headline: `${config.playerName} rejoint ${COMPANY_BY_ID[state.career.employerId!]!.name} à ${city.name}`, body: `Poste : ${title(state.career)}.`, tone: 'neutral', major: false, category: 'entreprises' });
  }
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
  const cut = taxRulingCut(state); // rescrit fiscal négocié avec le gouvernement du siège
  if (sp && sp.rate < base && state.company.physVolumeYtd >= (sp.minPhysicalVolume ?? 0)) return { rate: Math.max(0, sp.rate - cut), regime: sp };
  return { rate: Math.max(0, base - cut), regime: null };
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
  for (const c of state.mp?.follower ? [] : COMMODITY_IDS) {
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
  // partie à plusieurs : seul le maître fait vivre le monde partagé (géopolitique, nouvelles de marché, événements,
  // sociétés IA) ; les sociétés suiveuses le reçoivent par référence
  if (!state.mp?.follower) {
    stepWorld(state);
    for (const n of dailyNews(state)) if (n.major) state.pendingAlerts.push({ kind: 'major_news', text: n.headline });
    dailyEvents(state);
    if (state.day !== state.startDay) stepCompanies(state);
  }
  recomputeIm(state);
  generateOffers(state);
  // débutant : il y a toujours au moins une cargaison à acheter et une à vendre sur la table (offres hors KYC)
  if (factors(state).guaranteedOffers && !state.career) {
    if (!state.offers.some((o) => o.side > 0 && !offerBlock(state, o))) generateOffers(state, { count: 1, side: 1 });
    if (!state.offers.some((o) => o.side < 0 && !offerBlock(state, o))) generateOffers(state, { count: 1, side: -1 });
    // visite guidée, étape « trouver un acheteur » : un acheteur au même lieu, livré après l'achat, est sur la table
    if (state.lessons?.active === 'first' && state.lessons.step === 2) {
      const buy = state.forwards.find((d) => d.side > 0 && !state.forwards.some((x) => x.side < 0 && x.commodity === d.commodity && x.locationId === d.locationId));
      if (buy && !state.offers.some((o) => o.side < 0 && o.commodity === buy.commodity && o.locationId === buy.locationId && o.month >= buy.month && !offerBlock(state, o))) {
        generateOffers(state, { count: 1, side: -1, commodity: buy.commodity, locationId: buy.locationId, month: buy.month + 1, qty: buy.qty });
      }
    }
  }
  if (state.career) {
    careerOpen(state);
    maybeTip(state);
    dailySituations(state);
    stepCompromises(state);
    decayRelations(state);
  }
  loreDay(state);
  morningAdvice(state);
}

/** La société du joueur paie-t-elle ses frais et ses impôts ? (pas un salarié qui gère un livre alloué) */
function paysCompanyCosts(state: GameState) {
  return !state.career || state.career.status === 'founder' || state.career.status === 'ceo';
}

function closeDay(state: GameState) {
  const co = state.company;
  const days = state.day - state.lastCloseDay;
  const mcBefore = !!co.marginCall;
  const newMonth = monthIndexOf(state.day) !== monthIndexOf(state.lastCloseDay);
  // Automatisation (roll, couverture, logistique) aux prix du jour, avant les règlements du soir.
  runAutomation(state);
  if (paysCompanyCosts(state)) deskTrading(state);
  // L'exercice des options précède la VM : les futures reçus au strike sont réglés dès ce soir.
  for (const msg of expireOptions(state)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  settleVariationMargin(state);
  settleDesks(state);
  expireContracts(state);
  for (const msg of processDeliveries(state)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  recordFixings(state);
  for (const msg of settleOtc(state)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  for (const msg of stepExotics(state)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  recordFreightFixings(state);
  settleFfa(state);
  const voyagesBefore = state.voyages.length;
  for (const msg of stepVoyages(state)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  state.stats.voyagesDone += Math.max(0, voyagesBefore - state.voyages.length);
  for (const msg of stepAssets(state, days)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  for (const msg of stepFinancing(state, days, newMonth)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  if (paysCompanyCosts(state)) resolveTenders(state);
  rehedgeAfterDeliveries(state);
  chargeStorage(state, days);
  accrueInterest(state, days);
  stepCredit(state, days);

  const prev = ymd(state.lastCloseDay);
  const cur = ymd(state.day);
  if (monthIndexOf(state.day) !== monthIndexOf(state.lastCloseDay) && paysCompanyCosts(state)) {
    const city = CITY_BY_ID[co.hqCity]!;
    const cost = STAFF_MONTHLY * city.staffCostIndex * factors(state).overheadMult;
    addCash(state, -cost, 'overhead');
    log(state, `Frais généraux du mois (salaires de l’équipe)`, -cost);
    officeMonth(state);
    complianceMonth(state);
    staffMonth(state);
    deskMonth(state);
    govMonth(state);
    // Déclaration réglementaire des dérivés (type EMIR / Dodd-Frank) : coût par transaction du mois écoulé.
    const fee = state.world.cityRegs[co.hqCity]!.reportingFee * co.tradesThisMonth;
    if (fee > 0) {
      addCash(state, -fee, 'compliance');
      log(state, `Reporting réglementaire : ${co.tradesThisMonth} transactions déclarées`, -fee);
    }
    co.tradesThisMonth = 0;
  }
  if (cur.y !== prev.y && state.lastCloseDay >= state.startDay && paysCompanyCosts(state)) {
    // Impôt sur le résultat de l'exercice écoulé (comptabilité en juste valeur), avec report de pertes.
    const profit = state.lastNav - co.yearStartNav;
    const taxable = profit - co.lossCarry;
    const { rate, regime } = effectiveTaxRate(state);
    const fee = regime?.annualFee ?? 0;
    if (fee > 0) addCash(state, -fee, 'tax');
    let tax = 0;
    // répartition entre le siège et les bureaux à l'étranger (établissements stables)
    const split = taxSplit(state, taxable, rate, STAFF_MONTHLY * CITY_BY_ID[co.hqCity]!.staffCostIndex);
    if (taxable > 0) {
      tax = split.reduce((a, p) => a + p.tax + p.withholding, 0);
      co.lossCarry = 0;
      for (const p of split.filter((x) => x.cityId !== co.hqCity && x.base > 0)) {
        log(state, `Impôt local ${CITY_BY_ID[p.cityId]!.name} : base ${(p.base / 1e6).toFixed(2)} M$ (dont desks ${(p.direct / 1e6).toFixed(2)} M$) à ${(p.rate * 100).toFixed(1)} %${p.withholding > 0 ? `, retenue au rapatriement ${(p.withholding / 1e6).toFixed(2)} M$` : ''}`, -(p.tax + p.withholding));
      }
    } else {
      co.lossCarry = -taxable;
    }
    if (tax > 0) addCash(state, -tax, 'tax');
    addNews(state, {
      headline: `Clôture de l’exercice ${prev.y} : résultat ${(profit / 1e6).toFixed(2)} M$, impôt ${(tax / 1e6).toFixed(2)} M$ (taux ${(taxable > 0 ? (tax / taxable) * 100 : rate * 100).toFixed(1)} %${regime ? ` — ${regime.label}` : ''}${split.length > 1 ? `, ${split.length - 1} bureau(x)` : ''})`,
      tone: 'neutral',
      major: false,
    });
    co.yearStartNav = state.lastNav - tax - fee;
    co.physVolumeYtd = 0;
    resetCompanyYear(state);
  }
  state.offers = state.offers.filter((o) => o.expiresDay > state.day);
  if (paysCompanyCosts(state)) stepInvestigations(state, days);
  exchangeSurveillance(state);

  recomputeIm(state);
  let deficit = settleTreasury(state);
  if (deficit > 0) {
    if (co.marginCall && co.marginCall.sinceDay < state.day) {
      liquidateAllFutures(state);
      liquidateDesks(state);
      state.pendingAlerts.push({ kind: 'liquidation', text: 'Appel de marge non couvert : le courtier a liquidé toutes vos positions futures.' });
      addNews(state, { headline: `${co.name} : positions liquidées par son courtier`, tone: 'alert', major: true });
      deficit = settleTreasury(state);
      if (isEmployee(state)) {
        co.marginCall = null;
        fire(state, 'votre livre a été liquidé après un appel de marge non couvert');
      } else if (deficit > 0 || co.cash < 0) {
        bankrupt(state, 'Impossible de couvrir les appels de marge et la dette exigible.');
      } else co.marginCall = null;
    } else {
      const fresh = !co.marginCall;
      co.marginCall = { sinceDay: co.marginCall?.sinceDay ?? state.day, amount: deficit };
      if (fresh) state.pendingAlerts.push({ kind: 'margin_call', text: `Appel de marge de ${(deficit / 1e6).toFixed(2)} M$ à couvrir avant la clôture de demain.` });
    }
  } else co.marginCall = null;

  let navNow = nav(state);
  if (state.status === 'running' && navNow < 0) {
    if (isEmployee(state)) {
      fire(state, 'votre livre a perdu plus que le capital alloué');
      navNow = nav(state);
    } else if (paysCompanyCosts(state)) bankrupt(state, 'Fonds propres négatifs : les banques coupent les lignes.');
  }

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
  if (state.career && state.status === 'running') {
    checkTips(state);
    careerClose(state, state.lastNav, navNow);
    navNow = nav(state);
  }

  state.lastValueBy = vb;
  state.lastNav = navNow;
  state.lastCloseDay = state.day;
  stepProgress(state, mcBefore);
  stepProgression(state);
  lessonTick(state);
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

/**
 * Journée commune d'une partie à plusieurs : chaque société clôture au prix du jour, puis le maître fait avancer le
 * marché et le monde ; les suiveuses ouvrent la journée sur ce monde partagé et reçoivent ses nouvelles.
 */
export function advanceDayMulti(states: GameState[]): void {
  const master = states[0]!;
  if (master.status !== 'running' && states.every((s) => s.status !== 'running')) return;
  const newsBefore = new Set(master.news.map((n) => n.id));
  for (const s of states) if (s.status === 'running') closeDay(s);
  const next = nextBusinessDay(master.day);
  if (next > master.endDay) {
    for (const s of states) if (s.status === 'running') {
      s.status = 'ended';
      s.statusReason = `Fin de partie le ${formatDay(s.day)}.`;
      s.pendingAlerts.push({ kind: 'ended', text: s.statusReason });
    }
    return;
  }
  stepMarket(master.market, master.rng, next, master.config.volatility, master.config.crisisFrequency);
  for (const s of states) {
    s.day = next;
    if (s === master || s.status === 'running') openDay(s);
  }
  // les nouvelles du monde partagé (pas les annonces propres à la société maître) sont diffusées aux suiveuses
  const fresh = master.news.filter((n) => !newsBefore.has(n.id) && n.cityId !== master.company.hqCity);
  for (const s of states.slice(1)) {
    for (const n of [...fresh].reverse()) {
      s.news.unshift({ ...n });
      if (n.major) s.pendingAlerts.push({ kind: 'major_news', text: n.headline });
    }
    if (s.news.length > 120) s.news.length = 120;
  }
}

export function dispatch(state: GameState, action: Action): ActionResult {
  const r = dispatchAction(state, action);
  if (r.ok) { stepProgression(state); lessonTick(state); }
  return r;
}

function dispatchAction(state: GameState, action: Action): ActionResult {
  if (state.status !== 'running') return { ok: false, message: 'La partie est terminée.' };
  const denied = permissionError(state, action);
  if (denied) return { ok: false, message: denied };
  if (suspended(state) && SUSPENDED_ACTIONS.has(action.type)) return { ok: false, message: `Licence de négoce suspendue jusqu’au ${formatDay(state.compliance.suspendedUntil)}.` };
  switch (action.type) {
    case 'RESOLVE_SITUATION':
      return resolveSituation(state, action.id, action.choice);
    case 'START_NEGOTIATION':
      return beginNegotiation(state, action.kind, action.target);
    case 'NEGOTIATE': {
      if (!state.negotiation) return { ok: false, message: 'Pas de négociation en cours.' };
      const msg = negotiate(state, action.move as NegotiationMove, state.career?.skills.négociation ?? 30);
      if (state.negotiation.done) applyNegotiation(state);
      return { ok: true, message: msg };
    }
    case 'ACCEPT_JOB':
      return acceptJob(state, action.offerId);
    case 'APPLY_JOB':
      return applyJob(state, action.companyId, action.track);
    case 'RESIGN': {
      if (!isEmployee(state)) return { ok: false, message: 'Vous n’avez pas de poste.' };
      remember(state, findRole(state, 'manager', state.career!.employerId)?.id, -5, 'Démission');
      leave(state, 'démission');
      return { ok: true, message: 'Vous avez démissionné.' };
    }
    case 'REQUEST_TRANSFER':
      return transfer(state, action.track);
    case 'FOUND_COMPANY':
      return foundCompany(state, action.name, action.city);
    case 'SET_PAYOUT':
      if (state.career) state.career.payout = Math.max(0, Math.min(0.8, action.payout));
      return { ok: true, message: 'Politique de dividendes mise à jour.' };
    case 'MEET_NPC':
      return meet(state, action.npcId);
    case 'OFFICE_MOVE':
      return moveOffice(state, action.tier, action.buy);
    case 'OFFICE_STYLE':
      return setStyle(state, action.style);
    case 'OFFICE_ITEM':
      return officeItem(state, action.item, action.sell);
    case 'OFFICE_PROPERTY':
      return officeProperty(state, action.buy);
    case 'INVITE_HQ':
      return inviteToHq(state, action.npcId);
    case 'RETIRE': {
      if (!state.career) return { ok: false, message: 'Mode carrière uniquement.' };
      state.status = 'ended';
      state.career.ended = 'retraite';
      state.statusReason = `Retraite : patrimoine de ${(state.career.wealth / 1e6).toFixed(2)} M$, réputation ${Math.round(state.career.reputation)}/100.`;
      state.pendingAlerts.push({ kind: 'ended', text: state.statusReason });
      return { ok: true, message: state.statusReason };
    }
    case 'TRADE_FUTURE': {
      const chk = checkFuture(state, action.commodity, action.month, action.lots);
      if (chk.block) return { ok: false, message: chk.block };
      const r = counted(state, guarded(state, () => tradeFuture(state, action.commodity, action.month, action.lots)));
      return r.ok && chk.warn ? { ...r, message: `${r.message} ${chk.warn}` } : r;
    }
    case 'TRADE_SPREAD':
      return counted(state, guarded(state, () => tradeSpread(state, action.commodity, action.near, action.far, action.lots)), 2);
    case 'TRADE_OPTION':
      return counted(state, guarded(state, () => tradeOption(state, action.commodity, action.month, action.optType, action.strike, action.lots)));
    case 'RELOCATE_HQ':
      return relocate(state, action.city);
    case 'SHIP_CARGO':
      return shipCargo(state, action.lotId, action.to, action.qty, action.vesselAssetId);
    case 'TRADE_FFA':
      return counted(state, tradeFfa(state, action.index, action.month, action.days));
    case 'BUY_OPPORTUNITY':
      return buyOpportunity(state, action.id);
    case 'SELL_ASSET':
      return sellAsset(state, action.id);
    case 'SET_ASSET': {
      const a = state.assets.find((x) => x.id === action.id);
      if (!a) return { ok: false, message: 'Actif introuvable.' };
      if (action.utilization !== undefined) a.utilization = Math.max(0.3, Math.min(1, action.utilization));
      if (action.policy) a.policy = action.policy;
      if (action.vesselMode) a.vesselMode = action.vesselMode;
      return { ok: true, message: 'Paramètres de l’actif mis à jour.' };
    }
    case 'MAINTAIN_ASSET': {
      const a = state.assets.find((x) => x.id === action.id);
      if (!a || a.status !== 'operating') return { ok: false, message: 'Maintenance impossible maintenant.' };
      startMaintenance(state, a);
      return { ok: true, message: 'Arrêt de maintenance programmé (5 à 9 jours).' };
    }
    case 'HIRE_MANAGER':
      return hireManager(state, action.id, action.assetId);
    case 'FIRE_MANAGER':
      return fireManager(state, action.id);
    case 'HEDGE_PRODUCTION':
      return hedgeProduction(state, action.id, action.months, action.ratio);
    case 'SET_AUTOMATION':
      state.automation = { ...state.automation, ...action.patch, autoHedge: { ...state.automation.autoHedge, ...(action.patch.autoHedge ?? {}) } };
      return { ok: true, message: 'Automatisation mise à jour.' };
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
    case 'ACCEPT_OFFER': {
      const offer = state.offers.find((o) => o.id === action.offerId);
      const r = guarded(state, () => acceptOffer(state, action.offerId, action.inspect));
      if (r.ok && action.hedge && offer && action.hedge.lots !== 0) {
        const h = tradeFuture(state, offer.commodity, action.hedge.month, action.hedge.lots);
        return { ok: true, message: `${r.message} ${h.ok ? `Couvert : ${action.hedge.lots < 0 ? 'vente' : 'achat'} de ${Math.abs(action.hedge.lots)} lots ${monthLabel(action.hedge.month)}.` : `Couverture refusée : ${h.message}`}` };
      }
      return r;
    }
    case 'ACCEPT_BRIBE_OFFER':
      return guarded(state, () => acceptOffer(state, action.offerId, false));
    case 'TRADE_EXOTIC':
      return guarded(state, () => tradeExotic(state, action.spec, action.qty));
    case 'CLOSE_EXOTIC':
      return guarded(state, () => closeExotic(state, action.id));
    case 'FINANCE_LOT':
      return financeLot(state, action.lotId);
    case 'REPAY_LOAN':
      return repayLoan(state, action.id);
    case 'ACCEPT_PREPAY':
      return guarded(state, () => acceptPrepay(state, action.offerId));
    case 'SET_COMPLIANCE':
      state.compliance.level = action.level;
      return { ok: true, message: `Programme de conformité : ${LEVELS[action.level].label}.` };
    case 'SELF_REPORT':
      return selfReport(state, action.caseId);
    case 'SET_DEFENSE':
      return setDefense(state, action.id, action.strategy);
    case 'SETTLE_CASE':
      return settleCase(state, action.id);
    case 'APPEAL':
      return appeal(state, action.id);
    case 'HIRE':
      return hire(state, action.candidateId, action.cityId);
    case 'FIRE_EMPLOYEE':
      return fireEmployee(state, action.id);
    case 'RAISE':
      return raise(state, action.id, action.pct);
    case 'COUNTER_OFFER':
      return counterOffer(state, action.id);
    case 'OPEN_BRANCH':
      return openBranch(state, action.cityId, action.size);
    case 'CLOSE_BRANCH':
      return closeBranch(state, action.cityId);
    case 'START_LESSON':
      return startLesson(state, action.id);
    case 'QUIT_LESSON':
      return quitLesson(state);
    case 'SKIP_LESSON_STEP':
      return skipLessonStep(state);
    case 'GOV_BID':
      return submitBid(state, action.tenderId, action.diff);
    case 'GOV_LICENCE':
      return buyLicence(state, action.zone);
    case 'GOV_LOBBY':
      return lobby(state, action.zone, action.kind);
    case 'GOV_TAX_RULING':
      return requestTaxRuling(state);
    case 'CUSTOMIZE_OFFICE':
      return customizeOffice(state, action.patch);
    case 'UNLOCK_ALL':
      unlockAll(state);
      return { ok: true, message: 'Tous les panneaux sont affichés.' };
    case 'SET_MANDATE':
      return setMandate(state, action.id, action.budget);
    case 'SPOT_BUY':
      return guarded(state, () => spotBuy(state, action.commodity, action.locationId, action.qty));
    case 'SPOT_SELL':
      return spotSell(state, action.lotId, action.qty);
    case 'TRAVEL': {
      const p = state.player;
      if (p.travel) return { ok: false, message: 'Vous êtes déjà en vol.' };
      if (!p.cityId || p.cityId === action.to) return { ok: false, message: 'Vous êtes déjà sur place.' };
      const fi = flightInfo(p.cityId, action.to);
      // Héliport au siège : on évite le trajet jusqu'à l'aéroport (≈ 1 h gagnée).
      if (p.cityId === state.company.hqCity && managesOffice(state) && state.office?.items.some((i) => i.id === 'heliport')) {
        fi.hours = Math.max(1, fi.hours - 1);
        fi.days = fi.hours <= 9 ? 1 : 2;
      }
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

function beginNegotiation(state: GameState, kind: string, target: string): ActionResult {
  const c = state.career;
  if (state.negotiation && !state.negotiation.done) return { ok: false, message: 'Une négociation est déjà en cours.' };
  const skillN = c?.skills.négociation ?? 30;
  if (kind === 'deal') {
    const o = state.offers.find((x) => x.id === target);
    if (!o) return { ok: false, message: 'Offre expirée.' };
    const denied = permissionError(state, { type: 'ACCEPT_OFFER', offerId: o.id });
    if (denied) return { ok: false, message: denied };
    if (o.negotiated) return { ok: false, message: 'Vous avez déjà négocié cette offre.' };
    const contact = contactAt(state, o.counterpartyId);
    const F = forwardAt(state.market, o.commodity, offerDeliveryDay(o));
    const give = F * (0.0015 + Math.max(0, contact?.trust ?? 0) / 100 * 0.004 + (isPresent(state, o.cityId) ? 0.002 : 0) + skillN / 100 * 0.002 + negotiationEdge(state));
    o.negotiated = true;
    startNegotiation(state, { kind: 'deal', npcId: contact?.id ?? '', title: `Différentiel ${COMMODITIES[o.commodity].short} avec ${COMPANY_BY_ID[o.counterpartyId]?.name ?? ''}`, unit: COMMODITIES[o.commodity].priceUnit, opening: o.diff, reservation: o.diff - o.side * give, leverage: false, higherIsBetter: o.side < 0, context: { offerId: o.id } });
    return { ok: true, message: 'Négociation ouverte.' };
  }
  if (!c) return { ok: false, message: 'Mode carrière uniquement.' };
  if (kind === 'investisseur') {
    const inv = npc(state, target);
    if (!inv || inv.role !== 'investisseur') return { ok: false, message: 'Investisseur introuvable.' };
    if (c.investors.some((i) => i.npcId === target)) return { ok: false, message: 'Déjà engagé.' };
    if (c.reputation < 20) return { ok: false, message: 'Aucun investisseur ne vous recevra avec cette réputation.' };
    const capital = Math.round((3e6 + c.reputation * 0.4e6 + Math.max(0, inv.trust) * 0.1e6) / 1e5) * 1e5;
    const founder = Math.max(1, c.wealth * 0.8);
    const fair = (capital / (capital + founder)) * 100;
    startNegotiation(state, { kind: 'investisseur', npcId: inv.id, title: `Levée de fonds : ${(capital / 1e6).toFixed(1)} M$ de ${inv.name}`, unit: '% du capital', opening: Math.min(90, fair * 1.6), reservation: Math.max(1, fair * (1.15 - inv.trust / 300 - c.reputation / 500 - officeEffects(state).prestige / 600)), leverage: c.investors.length > 0, higherIsBetter: false, context: { capital } });
    return { ok: true, message: 'Rendez-vous avec l’investisseur.' };
  }
  if (kind === 'offre') {
    const o = c.offers.find((x) => x.id === target && x.interviewed);
    if (!o) return { ok: false, message: 'Offre introuvable (entretien requis).' };
    const contact = contactAt(state, o.companyId);
    startNegotiation(state, { kind: 'offre', npcId: contact?.id ?? '', title: `Salaire chez ${COMPANY_BY_ID[o.companyId]?.name}`, unit: '$ / mois', opening: o.salary, reservation: o.salary * (1.1 + (contact?.trust ?? 0) / 500 + skillN / 500), leverage: isEmployee(state) || c.offers.filter((x) => x.interviewed).length > 1, higherIsBetter: true, context: { offerId: o.id } });
    return { ok: true, message: 'Négociation ouverte.' };
  }
  if (kind === 'salaire') {
    if (!isEmployee(state)) return { ok: false, message: 'Vous n’avez pas d’employeur.' };
    if ((state.world.eventCooldown['career.raise'] ?? -1) > state.day) return { ok: false, message: 'Trop tôt pour redemander une augmentation.' };
    state.world.eventCooldown['career.raise'] = addBusinessDays(state.day, 120);
    const mgr = findRole(state, 'manager', c.employerId);
    const sc = evaluate(state).score;
    startNegotiation(state, { kind: 'salaire', npcId: mgr?.id ?? '', title: 'Demande d’augmentation', unit: '$ / mois', opening: c.salary, reservation: c.salary * (1 + Math.max(0, (sc - 45) / 400) + Math.max(0, mgr?.trust ?? 0) / 400), leverage: c.offers.some((o) => o.interviewed), higherIsBetter: true, context: {} });
    return { ok: true, message: 'Rendez-vous avec votre manager.' };
  }
  return { ok: false, message: 'Négociation inconnue.' };
}

/** Applique le résultat d'une négociation terminée. */
function applyNegotiation(state: GameState) {
  const n = state.negotiation!;
  const c = state.career;
  const r = n.result;
  switch (n.kind) {
    case 'deal': {
      const o = state.offers.find((x) => x.id === n.context.offerId);
      if (o && r !== undefined) o.diff = Number(r.toFixed(4));
      if (r !== undefined && r !== n.opening) state.stats.negotiationsWon++;
      break;
    }
    case 'salaire':
      if (c && r !== undefined) {
        c.salary = Math.round(r / 100) * 100;
        careerLog(state, `Nouveau salaire : ${c.salary.toLocaleString('fr-FR')} $/mois.`);
      }
      break;
    case 'bonus':
      if (c) {
        const amt = r ?? Math.abs(n.opening) * 0.8;
        c.wealth += amt;
        careerLog(state, `Bonus : ${Math.round(amt / 1000)} k$${r === undefined ? ' (rupture : bonus réduit)' : ''}.`);
      }
      break;
    case 'offre': {
      const o = c?.offers.find((x) => x.id === n.context.offerId);
      if (o && r !== undefined) o.salary = Math.round(r / 100) * 100;
      if (o && r === undefined) c!.offers = c!.offers.filter((x) => x !== o);
      break;
    }
    case 'investisseur':
      if (c && r !== undefined) {
        c.investors.push({ npcId: n.npcId, share: Math.max(0.005, r / 100), capital: Number(n.context.capital) });
        careerLog(state, `${npc(state, n.npcId)?.name} investira ${(Number(n.context.capital) / 1e6).toFixed(1)} M$ pour ${r.toFixed(1)} % du capital.`);
      }
      break;
  }
}

function applyJob(state: GameState, companyId: string, track: CareerTrack): ActionResult {
  const c = state.career;
  if (!c || !COMPANY_BY_ID[companyId]) return { ok: false, message: 'Candidature impossible.' };
  if (c.status === 'founder' || c.status === 'ceo') return { ok: false, message: 'Vous dirigez une société.' };
  if (companyId === c.employerId) return { ok: false, message: 'C’est déjà votre employeur.' };
  if (!state.companies.find((x) => x.id === companyId)?.alive) return { ok: false, message: 'Cette société n’existe plus.' };
  if ((state.world.eventCooldown[`apply.${companyId}`] ?? -1) > state.day) return { ok: false, message: 'Vous avez déjà postulé récemment.' };
  state.world.eventCooldown[`apply.${companyId}`] = addBusinessDays(state.day, 40);
  const level = Math.max(1, Math.min(5, c.level - (track !== c.track ? 1 : 0)));
  makeOffer(state, companyId, track, level);
  const o = c.offers.at(-1)!;
  o.salary = Math.round(salaryFor(level, companyId) / 100) * 100;
  pushSituation(state, 'interview', { offerId: o.id });
  return { ok: true, message: `Candidature envoyée : chance estimée ${Math.round(interviewChance(state, companyId, track, level, true) * 100)} % avec préparation.` };
}

function transfer(state: GameState, track: CareerTrack): ActionResult {
  const c = state.career;
  if (!c || !isEmployee(state)) return { ok: false, message: 'Vous devez être salarié.' };
  if (track === c.track) return { ok: false, message: 'Vous êtes déjà dans cette filière.' };
  const mgr = findRole(state, 'manager', c.employerId);
  if ((mgr?.trust ?? 0) < 15) return { ok: false, message: 'Votre manager ne soutient pas votre demande (confiance insuffisante).' };
  if (c.skills[TRACK_SKILL[track]] < 25) return { ok: false, message: 'Compétences insuffisantes pour cette filière.' };
  leaveBookIfTrading(state);
  c.track = track;
  c.level = Math.max(1, Math.min(5, c.level - 1));
  c.sinceDay = state.day;
  c.desk = deskFor(c.employerId!, c.level);
  setAllocation(state, track === 'trading' ? [0, 0, 8e6, 25e6, 60e6, 150e6, 400e6][c.level]! : 0);
  careerLog(state, `Transfert : vous devenez ${title(c)}.`);
  return { ok: true, message: `Transfert accepté : ${title(c)}.` };
}

function leaveBookIfTrading(state: GameState) {
  // le livre est repris par le desk : positions soldées au marché, le capital retourne à l'employeur
  if (state.career!.allocation > 0) flattenBook(state);
}

function meet(state: GameState, id: string): ActionResult {
  const n = npc(state, id);
  const c = state.career;
  if (!n || !c) return { ok: false, message: 'Contact introuvable.' };
  if ((state.world.eventCooldown[`meet.${id}`] ?? -1) > state.day) return { ok: false, message: `Vous avez vu ${n.name} récemment.` };
  state.world.eventCooldown[`meet.${id}`] = addBusinessDays(state.day, 15);
  const here = state.player.cityId === n.cityId;
  c.wealth -= here ? 1500 : 300;
  const gain = (here ? 6 : 3) * (1 - Math.max(0, n.trust) / 120) * (1 + c.skills.relationnel / 200) * officeEffects(state).relationMult;
  remember(state, id, gain, here ? 'Déjeuner ensemble' : 'Appel vidéo');
  c.skills.relationnel = Math.min(100, c.skills.relationnel + 0.3);
  return { ok: true, message: here ? `Déjeuner avec ${n.name} : la relation se renforce.` : `Appel avec ${n.name} (en personne, l’effet serait double : voyagez à ${CITY_BY_ID[n.cityId]?.name}).` };
}

function counted(state: GameState, r: ActionResult, n = 1): ActionResult {
  if (r.ok) state.company.tradesThisMonth += n;
  return r;
}

export function relocationCost(state: GameState, toCity?: string): number {
  // + agencement des nouveaux locaux au même palier (les anciens sont perdus)
  return RELOCATION_FIXED + RELOCATION_EXIT_TAX * Math.max(0, nav(state)) + (toCity ? fitOutCost(state, state.office?.tier ?? 0, toCity) : 0);
}

/** Transfert du siège : nouvelle fiscalité, nouveau régulateur, nouveau régime de sanctions. */
function relocate(state: GameState, city: string): ActionResult {
  const co = state.company;
  if (!CITY_BY_ID[city] || city === co.hqCity) return { ok: false, message: 'Ville invalide.' };
  if (co.marginCall) return { ok: false, message: 'Impossible de déménager pendant un appel de marge.' };
  if (state.day - co.lastRelocationDay < RELOCATION_COOLDOWN * 1.4) return { ok: false, message: 'Un seul transfert de siège par an.' };
  const cost = relocationCost(state);
  if (cost + fitOutCost(state, state.office?.tier ?? 0, city) > co.cash - co.im) return { ok: false, message: 'Trésorerie insuffisante pour le transfert.' };
  addCash(state, -cost, 'overhead');
  relocateOffice(state, city);
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
  if (s.version === 3) {
    s.market.freight = Object.fromEntries(FREIGHT_IDS.map((i) => [i, Math.log({ CAPE: 22000, PMX: 14000, SMX: 13000, AFRA: 32000, LNGC: 80000 }[i])])) as GameState['market']['freight'];
    Object.assign(s, {
      voyages: [], ffa: [], assets: [], managers: [], opportunities: [], streams: [],
      freightFixings: Object.fromEntries(FREIGHT_IDS.map((i) => [i, []])),
      automation: { ...DEFAULT_AUTOMATION, autoHedge: { ...DEFAULT_AUTOMATION.autoHedge } },
    });
    s.company.cumCashByCategory.freight = 0;
    s.company.cumCashByCategory.assets = 0;
    createManagerPool(s, 6);
    generateOpportunities(s, 4);
    s.version = 4;
  }
  if (s.version === 4) {
    Object.assign(s, { career: null, npcs: [], situations: [], negotiation: null, compromises: [], tips: [] });
    s.company.cumCashByCategory.dividends = 0;
    seedNpcs(s);
    s.version = 5;
  }
  if (s.version === 5) {
    s.office = defaultOffice(s.day);
    s.company.cumCashByCategory.office = 0;
    s.version = 6;
  }
  if (s.version === 6) {
    Object.assign(s, { exotics: [], financing: { lcs: [], loans: [], prepays: [], offers: [] }, compliance: defaultCompliance(), stats: defaultStats(s.lastNav), achievements: [] });
    s.company.cumCashByCategory.financing = 0;
    s.market.curve = { USD: { ...DEFAULT_CURVE.USD }, EUR: { ...DEFAULT_CURVE.EUR } };
    s.version = 7;
  }
  if (s.version === 7) {
    // phase 8 : nouvelles commodités, villes, zones, sociétés, fret méthanier, équipes
    const fresh = createMarket(s.market.day, s.config.volatility);
    for (const c of COMMODITY_IDS) {
      if (!s.market.commodities[c]) {
        s.market.commodities[c] = fresh.commodities[c];
        s.market.ivLevel[c] = fresh.ivLevel[c];
      }
      s.fixings[c] ??= [];
      s.company.cumCashByCommodity[c] ??= 0;
      s.lastValueBy[c] ??= 0;
      s.risk.varBy[c] ??= 0;
    }
    for (const h of s.market.history) for (const c of COMMODITY_IDS) h.f[c] ??= [s.market.commodities[c].chi, s.market.commodities[c].xi];
    s.market.freight.LNGC ??= Math.log(80_000);
    s.freightFixings.LNGC ??= [];
    for (const c of CITIES) s.world.cityRegs[c.id] ??= { taxRate: c.corporateTax, kyc: c.kycStrictness, capitalControls: c.capitalControls, reportingFee: c.reportingFee };
    for (const z of ZONES) {
      s.world.zones[z.id] ??= { stability: z.baseStability };
      if (!z.fictional) s.world.calendar.elections[z.id] ??= s.day + 200 + Math.round(hashUniform(s.config.seed, z.id) * 700);
    }
    const known = new Set(s.companies.map((x) => x.id));
    for (const co of createCompanies()) if (!known.has(co.id)) s.companies.push(co);
    s.staff = defaultStaff();
    s.explainBase = null;
    s.version = 8;
  }
  if (s.version === 8) {
    // phase 9 : la couverture automatique mémorise ses positions par échéance (« BRENT:612 ») ; l'ancienne mémoire
    // par matière est reportée sur l'échéance détenue la plus grosse dans le même sens
    const old = (s.automation.hedged ?? {}) as Record<string, number>;
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(old)) {
      if (k.includes(':')) { next[k] = v; continue; }
      const p = s.futures.filter((x) => x.commodity === k && x.lots * v > 0).sort((a, b) => Math.abs(b.lots) - Math.abs(a.lots))[0];
      if (p) next[`${k}:${p.month}`] = v;
    }
    s.automation.hedged = next;
    s.desks = { positions: [], records: {} };
    s.version = 9;
  }
  return s;
}

export function consumeAlerts(state: GameState) {
  const a = state.pendingAlerts;
  state.pendingAlerts = [];
  return a;
}
