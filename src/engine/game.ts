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
import { expireContracts, liquidateAllFutures, settleVariationMargin, tradeFuture } from './trading';
import { flightInfo } from './travel';
import { accrueInterest, drawRcf, repayRcf, settleTreasury } from './treasury';
import type { Action, ActionResult, CashCategory, CommodityId, GameConfig, GameState } from './types';
import { nav, valueByCommodity } from './valuation';

export const SAVE_VERSION = 1;
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

const zeroBy = () => Object.fromEntries(COMMODITY_IDS.map((c) => [c, 0])) as Record<CommodityId, number>;

export function createGame(partial: Partial<GameConfig> = {}): GameState {
  const config: GameConfig = { ...DEFAULT_CONFIG, ...partial };
  const startDay = adjustFollowing(dayFromYMD(config.startYear, 1, 4));
  const endDay = dayFromYMD(config.startYear + config.years, 1, 1) - 1;
  const cats: CashCategory[] = ['vm', 'commission', 'physical', 'storage', 'interest', 'overhead', 'tax', 'travel', 'liquidation'];
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
    },
    player: { name: config.playerName, cityId: config.hqCity, travel: null },
    futures: [],
    forwards: [],
    inventory: [],
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
  recomputeIm(state);
  for (const n of dailyNews(state)) if (n.major) state.pendingAlerts.push({ kind: 'major_news', text: n.headline });
  generateOffers(state);
}

function closeDay(state: GameState) {
  const co = state.company;
  const days = state.day - state.lastCloseDay;
  settleVariationMargin(state);
  expireContracts(state);
  for (const msg of processDeliveries(state)) state.pendingAlerts.push({ kind: 'delivery', text: msg });
  chargeStorage(state, days);
  accrueInterest(state, days);

  const prev = ymd(state.lastCloseDay);
  const cur = ymd(state.day);
  if (monthIndexOf(state.day) !== monthIndexOf(state.lastCloseDay)) {
    const city = CITY_BY_ID[co.hqCity]!;
    const cost = city.officeRentMonthly + STAFF_MONTHLY * city.staffCostIndex;
    addCash(state, -cost, 'overhead');
    log(state, `Frais généraux du mois (loyer, salaires)`, -cost);
  }
  if (cur.y !== prev.y && state.lastCloseDay >= state.startDay) {
    // Impôt sur le résultat de l'exercice écoulé (comptabilité en juste valeur), avec report de pertes.
    const profit = state.lastNav - co.yearStartNav;
    const taxable = profit - co.lossCarry;
    const rate = CITY_BY_ID[co.hqCity]!.corporateTax;
    let tax = 0;
    if (taxable > 0) {
      tax = taxable * rate;
      co.lossCarry = 0;
    } else {
      co.lossCarry = -taxable;
    }
    if (tax > 0) addCash(state, -tax, 'tax');
    addNews(state, {
      headline: `Clôture de l’exercice ${prev.y} : résultat ${(profit / 1e6).toFixed(2)} M$, impôt ${(tax / 1e6).toFixed(2)} M$`,
      tone: 'neutral',
      major: false,
    });
    co.yearStartNav = state.lastNav - tax;
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
      return tradeFuture(state, action.commodity, action.month, action.lots);
    case 'ACCEPT_OFFER':
      return acceptOffer(state, action.offerId);
    case 'SPOT_BUY':
      return spotBuy(state, action.commodity, action.locationId, action.qty);
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

export function consumeAlerts(state: GameState) {
  const a = state.pendingAlerts;
  state.pendingAlerts = [];
  return a;
}
