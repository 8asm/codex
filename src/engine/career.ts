/**
 * Carrière (mode Histoire, et poste salarié du mode Sandbox « rejoindre une société »).
 *
 * Le joueur salarié gère un LIVRE alloué par son employeur (le compte `state.company` devient ce livre) :
 * capital alloué selon le niveau, financement des marges par la trésorerie de l'employeur, pas de frais
 * généraux ni d'impôt à sa charge. Le P&L du livre revient à l'employeur ; le joueur touche un salaire et un
 * bonus (part du P&L positif, modulée par la confiance de son manager). Son patrimoine personnel est distinct.
 *
 * Droits selon le niveau : stagiaire et analyste ne tradent pas ; trader junior : futures de son desk ;
 * trader : + options et physique ; senior : + OTC, fret, logistique ; head of desk : toutes les commodités ;
 * direction : actifs et trésorerie. CEO ou fondateur : tout.
 */
import { ALLOCATION, BASE_SALARY, BONUS_RATE, COST_OF_LIVING, MIN_MONTHS, PNL_TARGET, TRACK_SKILL, TRACK_TITLES, WITHHOLDING } from '../data/career';
import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { COMPANY_BY_ID } from '../data/companies';
import { addBusinessDays, monthIndexOf, ymd } from './calendar';
import { addCash, log, newId } from './ledger';
import { addNews } from './news';
import { contactAt, createNpc, findRole, npcsOf, remember, seedColleagues } from './npcs';
import { chance, normal, pick, uniform } from './rng';
import { nav } from './valuation';
import type { Action, CareerState, CareerTrack, CommodityId, GameState, Skill } from './types';
import { recomputeIm } from './margin';
import { pushSituation } from './situations';
import { defaultOffice, officeEffects, tierForNav } from './offices';

export const SKILLS: Skill[] = ['marché', 'risque', 'négociation', 'opérations', 'finance', 'relationnel'];

export const isEmployee = (s: GameState) => s.career?.status === 'employed';
export const isUnemployed = (s: GameState) => s.career?.status === 'unemployed';

export function title(c: CareerState): string {
  if (c.status === 'founder') return 'Fondateur & CEO';
  if (c.status === 'unemployed') return 'Sans emploi';
  return TRACK_TITLES[c.track][c.level]!;
}

export function employerSize(id: string | null): number {
  const d = id ? COMPANY_BY_ID[id] : undefined;
  return Math.max(0.6, Math.min(1.8, (d?.capital ?? 2e9) / 2.5e9 + 0.4));
}

export function salaryFor(level: number, employerId: string | null): number {
  return Math.round(BASE_SALARY[level]! * employerSize(employerId) / 100) * 100;
}

/** Desk attribué : commodités fortes de l'employeur (une seule en junior, toutes au-delà de senior). */
export function deskFor(employerId: string, level: number): CommodityId[] {
  const d = COMPANY_BY_ID[employerId]!;
  const desks = (Object.entries(d.desks) as [CommodityId, number][]).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  if (!desks.length) return ['BRENT'];
  if (level >= 5) return [...COMMODITY_IDS];
  if (level >= 4) return desks;
  if (level >= 3) return desks.slice(0, 2);
  return desks.slice(0, 1);
}

export function gainSkill(state: GameState, skill: Skill, n: number) {
  const c = state.career;
  if (!c) return;
  c.skills[skill] = Math.max(0, Math.min(100, c.skills[skill] + n * officeEffects(state).skillMult * (1 - c.skills[skill] / 130)));
}

export function careerLog(state: GameState, text: string) {
  state.career?.log.unshift({ day: state.day, text });
  if (state.career && state.career.log.length > 120) state.career.log.length = 120;
}

export function initCareer(state: GameState) {
  const cfg = state.config;
  const story = cfg.mode === 'story';
  const employerId = cfg.employerId ?? 'glenmoor';
  const track: CareerTrack = story ? cfg.track ?? 'trading' : 'trading';
  const skills = Object.fromEntries(SKILLS.map((s) => [s, 12 + Math.round(uniform(state.rng) * 8)])) as Record<Skill, number>;
  skills[TRACK_SKILL[track]] += 12;
  state.career = {
    narrative: story, status: 'unemployed', employerId: null, track, level: 0, desk: [], sinceDay: state.day, hiredDay: state.day,
    salary: 0, wealth: story ? 15_000 : 2_000_000, skills, reputation: story ? 8 : 40, allocation: 0, merit: 0, warnings: 0, strikes: 0,
    frozenUntil: -1, lastReview: state.day, unemployedSince: null, offers: [], team: [], equity: 0, investors: [], payout: 0.3, log: [],
  };
  hire(state, employerId, track, story ? 0 : 3, undefined, story ? 0 : cfg.capital);
  careerLog(state, story ? `Premier jour comme ${title(state.career)} chez ${COMPANY_BY_ID[employerId]!.name}.` : `Vous rejoignez ${COMPANY_BY_ID[employerId]!.name} comme trader.`);
}

/** Solde le livre du joueur : toutes les positions sont reprises au prix de marché par l'employeur. */
export function flattenBook(state: GameState) {
  const value = nav(state) - (state.company.cash - state.company.rcfDrawn);
  state.futures = [];
  if (state.desks) state.desks.positions = [];
  state.forwards = [];
  state.inventory = [];
  state.options = [];
  state.otc = [];
  state.voyages = [];
  state.ffa = [];
  state.offers = [];
  state.credit.collateral = {};
  state.company.cash += value;
  state.company.marginCall = null;
  recomputeIm(state);
}

/** Ajuste le capital alloué au livre (sans créer de P&L). */
export function setAllocation(state: GameState, alloc: number) {
  const c = state.career!;
  const d = alloc - c.allocation;
  state.company.cash += d;
  state.company.initialCapital = Math.max(1, alloc);
  state.company.yearStartNav += d;
  state.lastNav += d;
  state.risk.monthStartNav += d;
  if (state.explainBase) state.explainBase = null;
  c.allocation = alloc;
  // limites de l'employeur : VaR 3 %, stop-loss mensuel 8 %, delta 4 % du capital alloué
  state.risk.limits = { varPctNav: 0.03, stopLossPctNav: 0.08, deltaPctNav: 0.04, strict: false };
}

export function hire(state: GameState, companyId: string, track: CareerTrack, level: number, salary?: number, allocOverride?: number) {
  const c = state.career!;
  const d = COMPANY_BY_ID[companyId]!;
  if (c.status === 'employed') leave(state, 'transfert');
  c.status = 'employed';
  c.employerId = companyId;
  c.track = track;
  c.level = level;
  c.sinceDay = state.day;
  c.hiredDay = state.day;
  c.lastReview = state.day;
  c.salary = salary ?? salaryFor(level, companyId);
  c.desk = deskFor(companyId, level);
  c.unemployedSince = null;
  c.warnings = 0;
  c.strikes = 0;
  c.merit = 0;
  state.company.name = `${d.name}${track === 'trading' && level >= 2 ? ` — desk ${c.desk.map((x) => COMMODITIES[x].short).join('/')}` : ''}`;
  state.company.hqCity = d.cityId;
  state.player.cityId ??= d.cityId;
  state.company.autoTreasury = true;
  state.company.rcfDrawn = 0;
  state.company.cash = 0;
  c.allocation = 0;
  state.company.yearStartNav = 0;
  state.lastNav = nav(state);
  state.risk.monthStartNav = state.lastNav;
  state.explainBase = null;
  setAllocation(state, track === 'trading' ? allocOverride ?? ALLOCATION[level]! : 0);
  seedColleagues(state, companyId);
  if (level >= 5 && track === 'trading') seedTeam(state);
  else c.team = [];
}

function seedTeam(state: GameState) {
  const c = state.career!;
  c.team = [0, 1, 2].map(() => ({ id: newId(state, 'tm'), name: createNpc(state, 'collègue', c.employerId, state.company.hqCity, 10).name, skill: Math.round(30 + 50 * uniform(state.rng)), pnlYtd: 0 }));
}

/** Départ de l'employeur : le livre est soldé, le capital retourne à l'employeur. */
export function leave(state: GameState, reason: string) {
  const c = state.career!;
  if (c.status !== 'employed') return;
  flattenBook(state);
  const pnl = state.company.cash - c.allocation; // déjà reversé à l'employeur au fil de l'eau
  state.company.cash = 0;
  state.company.initialCapital = 1;
  state.company.yearStartNav = 0;
  state.lastNav = nav(state);
  c.allocation = 0;
  c.status = 'unemployed';
  c.unemployedSince = state.day;
  careerLog(state, `Départ de ${COMPANY_BY_ID[c.employerId!]!.name} (${reason}). Livre soldé (${(pnl / 1e6).toFixed(2)} M$ de P&L latent repris).`);
  c.team = [];
}

export function fire(state: GameState, reason: string) {
  const c = state.career!;
  const emp = c.employerId;
  leave(state, `licenciement : ${reason}`);
  c.reputation = Math.max(0, c.reputation - 8);
  remember(state, findRole(state, 'manager', emp)?.id, -20, 'Vous a licencié');
  state.pendingAlerts.push({ kind: 'career', text: `Vous êtes licencié de ${COMPANY_BY_ID[emp!]!.name} : ${reason}` });
  addNews(state, { headline: `${COMPANY_BY_ID[emp!]!.name} se sépare d’un ${TRACK_TITLES[c.track][c.level]!.toLowerCase()}`, tone: 'neutral', major: false, category: 'entreprises', companyId: emp! });
}

// ------------------------------------------------------------------ droits

const TRADING_ACTIONS = new Set(['TRADE_FUTURE', 'TRADE_SPREAD', 'HEDGE_DELTA', 'TRADE_OPTION', 'EXERCISE_OPTION', 'ACCEPT_OFFER', 'ACCEPT_BRIBE_OFFER', 'SPOT_BUY', 'SPOT_SELL', 'TRADE_OTC', 'SHIP_CARGO', 'TRADE_FFA', 'TRADE_EXOTIC', 'CLOSE_EXOTIC']);
const LEVEL_NEEDED: Record<string, number> = {
  TRADE_FUTURE: 2, TRADE_SPREAD: 2, HEDGE_DELTA: 2, TRADE_OPTION: 3, EXERCISE_OPTION: 3, ACCEPT_OFFER: 3, SPOT_BUY: 3, SPOT_SELL: 3,
  TRADE_OTC: 4, SHIP_CARGO: 4, TRADE_FFA: 4,
  BUY_OPPORTUNITY: 6, SELL_ASSET: 6, SET_ASSET: 6, MAINTAIN_ASSET: 6, HIRE_MANAGER: 6, FIRE_MANAGER: 6, HEDGE_PRODUCTION: 6,
  RCF_DRAW: 6, RCF_REPAY: 6, SET_AUTO_TREASURY: 6, SET_CSA: 6, SET_CREDIT_INSURANCE: 6, SET_LIMITS: 99, RELOCATE_HQ: 99,
  TRADE_EXOTIC: 4, CLOSE_EXOTIC: 4, FINANCE_LOT: 6, REPAY_LOAN: 6, ACCEPT_PREPAY: 6, ACCEPT_BRIBE_OFFER: 3,
  HIRE: 99, FIRE_EMPLOYEE: 99, RAISE: 99, COUNTER_OFFER: 99, OPEN_BRANCH: 99, CLOSE_BRANCH: 99, SET_MANDATE: 99, GOV_BID: 99, GOV_LICENCE: 99, GOV_LOBBY: 99, GOV_TAX_RULING: 99, CUSTOMIZE_OFFICE: 99,
  SET_COMPLIANCE: 99, SELF_REPORT: 99, SET_DEFENSE: 99, SETTLE_CASE: 99, APPEAL: 99,
  OFFICE_MOVE: 99, OFFICE_STYLE: 99, OFFICE_ITEM: 99, OFFICE_PROPERTY: 99, INVITE_HQ: 99,
};

function actionCommodity(state: GameState, a: Action): CommodityId | undefined {
  if ('commodity' in a && typeof a.commodity === 'string') return a.commodity as CommodityId;
  if (a.type === 'ACCEPT_OFFER' || a.type === 'ACCEPT_BRIBE_OFFER') return state.offers.find((o) => o.id === a.offerId)?.commodity;
  if (a.type === 'TRADE_EXOTIC') return a.spec.commodity;
  if (a.type === 'SPOT_SELL' || a.type === 'SHIP_CARGO') return state.inventory.find((l) => l.id === a.lotId)?.commodity;
  return undefined;
}

/** null si autorisé, sinon la raison du refus (salarié). */
export function permissionError(state: GameState, a: Action): string | null {
  const c = state.career;
  if (!c || c.status === 'founder' || c.status === 'ceo') return null;
  const need = LEVEL_NEEDED[a.type];
  if (need === undefined) return null;
  if (c.status !== 'employed') return 'Vous n’avez pas de poste : pas de livre à gérer.';
  if (need >= 99) return 'Réservé à la direction générale de la société.';
  if (TRADING_ACTIONS.has(a.type) && c.track !== 'trading') return `En ${TRACK_TITLES[c.track][c.level]!.toLowerCase()}, vous ne tradez pas : demandez un transfert vers le trading.`;
  if (c.level < need) return `Votre poste (${title(c)}) ne permet pas encore cette opération (niveau « ${TRACK_TITLES.trading[need]} » requis).`;
  if (TRADING_ACTIONS.has(a.type) && state.day <= c.frozenUntil) return 'Votre livre est gelé par le risk management : seules les réductions de risque sont autorisées via « Neutraliser Δ ».';
  const com = actionCommodity(state, a);
  if (com && !c.desk.includes(com)) return `Hors de votre desk (${c.desk.map((x) => COMMODITIES[x].short).join(', ')}).`;
  return null;
}

export interface Rights {
  trade: boolean;
  options: boolean;
  physical: boolean;
  otc: boolean;
  assets: boolean;
  treasury: boolean;
}

export function rights(state: GameState): Rights {
  const c = state.career;
  if (!c || c.status === 'founder' || c.status === 'ceo') return { trade: true, options: true, physical: true, otc: true, assets: true, treasury: true };
  const t = c.status === 'employed' && c.track === 'trading';
  return { trade: t && c.level >= 2, options: t && c.level >= 3, physical: t && c.level >= 3, otc: t && c.level >= 4, assets: c.status === 'employed' && c.level >= 6, treasury: c.status === 'employed' && c.level >= 6 };
}

// ------------------------------------------------------------------ évaluations

export function deskPnlPeriod(state: GameState): number {
  return nav(state) - state.company.yearStartNav;
}

/** Note d'évaluation 0..100 : performance, compétence de filière, confiance du manager, discipline. */
export function evaluate(state: GameState): { score: number; perf: number; skill: number; trust: number } {
  const c = state.career!;
  let perf: number;
  if (c.track === 'trading' && c.allocation > 0) {
    const years = Math.max(0.25, (state.day - Math.max(c.lastReview, c.sinceDay)) / 365);
    const ret = deskPnlPeriod(state) / c.allocation / years + c.team.reduce((s, t) => s + t.pnlYtd, 0) / Math.max(1, c.allocation) / years;
    perf = Math.max(0, Math.min(100, 50 + (ret / PNL_TARGET) * 25));
  } else perf = Math.max(0, Math.min(100, 50 + c.merit * 5));
  const skill = c.skills[TRACK_SKILL[c.track]];
  const trust = 50 + (findRole(state, 'manager', c.employerId)?.trust ?? 0) / 2;
  const score = Math.max(0, Math.min(100, 0.45 * perf + 0.25 * skill + 0.3 * trust - c.strikes * 8));
  return { score, perf, skill, trust };
}

function review(state: GameState) {
  const c = state.career!;
  const ev = evaluate(state);
  const months = (state.day - c.sinceDay) / 30.4;
  const mgr = findRole(state, 'manager', c.employerId);
  careerLog(state, `Évaluation semestrielle : ${Math.round(ev.score)}/100 (performance ${Math.round(ev.perf)}, compétence ${Math.round(ev.skill)}, manager ${Math.round(ev.trust)}).`);
  c.lastReview = state.day;
  if (c.level === 0 && months >= MIN_MONTHS[0]!) {
    if (ev.score >= 45) pushSituation(state, 'promotion', { level: 1 });
    else {
      careerLog(state, 'Fin de stage sans proposition d’embauche.');
      fire(state, 'stage non transformé');
    }
    c.merit = 0;
    return;
  }
  if (ev.score >= 65 && months >= MIN_MONTHS[c.level]! && c.level < 6) {
    pushSituation(state, 'promotion', { level: c.level + 1 });
    c.warnings = 0;
  } else if (c.level === 6 && ev.score >= 80 && c.reputation >= 60 && months >= MIN_MONTHS[6]! && c.employerId) {
    pushSituation(state, 'promotion', { level: 7 });
  } else if (ev.score < 40) {
    c.warnings++;
    remember(state, mgr?.id, -5, 'Évaluation décevante');
    if (c.warnings >= 2) {
      fire(state, 'deux évaluations insuffisantes de suite');
      return;
    }
    pushSituation(state, 'warning', { score: Math.round(ev.score) });
  } else if (ev.score >= 50) c.warnings = 0;
  c.merit = 0;
}

export function promote(state: GameState, level: number, salary?: number) {
  const c = state.career!;
  if (level === 7) return becomeCeo(state);
  const before = title(c);
  c.level = level;
  c.sinceDay = state.day;
  c.salary = salary ?? Math.max(c.salary * 1.15, salaryFor(level, c.employerId));
  c.desk = deskFor(c.employerId!, level);
  c.reputation = Math.min(100, c.reputation + 4);
  if (c.track === 'trading') {
    if (level >= 2) state.company.name = `${COMPANY_BY_ID[c.employerId!]!.name} — desk ${c.desk.length > 3 ? 'toutes commodités' : c.desk.map((x) => COMMODITIES[x].short).join('/')}`;
    setAllocation(state, ALLOCATION[level]!);
    if (level === 5) seedTeam(state);
  }
  careerLog(state, `Promotion : ${before} → ${title(c)}.`);
  state.pendingAlerts.push({ kind: 'career', text: `Promotion ! Vous devenez ${title(c)}.` });
}

/** Le joueur prend la tête de son employeur : la société simulée devient la sienne (mode société complet). */
export function becomeCeo(state: GameState) {
  const c = state.career!;
  const emp = state.companies.find((x) => x.id === c.employerId)!;
  const d = COMPANY_BY_ID[emp.id]!;
  flattenBook(state);
  const capital = Math.max(5e7, emp.nav);
  emp.alive = false;
  emp.mergedInto = 'player';
  state.company.name = d.name;
  state.company.cash = capital;
  state.company.initialCapital = capital;
  state.company.yearStartNav = capital;
  state.company.rcfDrawn = 0;
  state.lastNav = nav(state);
  state.risk.monthStartNav = state.lastNav;
  state.risk.limits = { varPctNav: 0.05, stopLossPctNav: 0.1, deltaPctNav: 0.02, strict: false };
  state.office = defaultOffice(state.day, tierForNav(capital));
  c.status = 'ceo';
  c.level = 7;
  c.allocation = capital;
  c.salary = salaryFor(7, emp.id);
  c.desk = [...COMMODITY_IDS];
  c.reputation = Math.min(100, c.reputation + 10);
  careerLog(state, `Le conseil vous nomme CEO de ${d.name}.`);
  addNews(state, { headline: `${state.player.name} nommé CEO de ${d.name}`, tone: 'neutral', major: true, category: 'entreprises' });
  state.pendingAlerts.push({ kind: 'career', text: `Vous êtes CEO de ${d.name} : toute la société est entre vos mains.` });
}

// ------------------------------------------------------------------ marché de l'emploi

export function makeOffer(state: GameState, companyId: string, track: CareerTrack, level: number, via?: string) {
  const c = state.career!;
  c.offers.push({ id: newId(state, 'jo'), companyId, track, level, salary: Math.round(salaryFor(level, companyId) * (1.1 + 0.25 * uniform(state.rng)) / 100) * 100, expiresDay: addBusinessDays(state.day, 15), via, interviewed: false });
}

/** Chance de réussir un entretien : compétences, réputation, références (ancien manager), préparation. */
export function interviewChance(state: GameState, companyId: string, track: CareerTrack, level: number, prepared: boolean): number {
  const c = state.career!;
  const skill = c.skills[TRACK_SKILL[track]];
  const refTrust = state.npcs.filter((n) => n.role === 'manager').reduce((m, n) => Math.max(m, n.trust), -50);
  const contact = contactAt(state, companyId)?.trust ?? 0;
  return Math.max(0.05, Math.min(0.95, 0.15 + skill / 200 + c.reputation / 250 + refTrust / 300 + contact / 400 + (prepared ? 0.15 : 0) - level * 0.05 + (c.track === track ? 0.05 : -0.1)));
}

export function acceptJob(state: GameState, offerId: string) {
  const c = state.career!;
  const o = c.offers.find((x) => x.id === offerId);
  if (!o) return { ok: false, message: 'Offre expirée.' };
  if (!o.interviewed) return { ok: false, message: 'Passez d’abord l’entretien.' };
  const from = c.employerId;
  if (c.status === 'employed') remember(state, findRole(state, 'manager', from)?.id, -10, 'Vous êtes parti à la concurrence');
  hire(state, o.companyId, o.track, o.level, o.salary);
  c.offers = c.offers.filter((x) => x !== o);
  if (o.via) remember(state, o.via, 15, 'Placement réussi');
  careerLog(state, `Nouveau poste : ${title(c)} chez ${COMPANY_BY_ID[o.companyId]!.name}.`);
  return { ok: true, message: `Bienvenue chez ${COMPANY_BY_ID[o.companyId]!.name} : vous êtes ${title(c)}.` };
}

// ------------------------------------------------------------------ fondateur

export const FOUND_MIN_WEALTH = 500_000;
export const FOUND_MIN_REPUTATION = 30;

export function foundingCheck(state: GameState): string | null {
  const c = state.career;
  if (!c) return 'Mode réservé à la carrière.';
  if (c.status === 'founder' || c.status === 'ceo') return 'Vous dirigez déjà une société.';
  if (c.wealth < FOUND_MIN_WEALTH) return `Apport personnel insuffisant (${(FOUND_MIN_WEALTH / 1e3).toFixed(0)} k$ minimum).`;
  if (c.reputation < FOUND_MIN_REPUTATION) return `Réputation insuffisante (${FOUND_MIN_REPUTATION} minimum) : banques et investisseurs ne suivent pas.`;
  return null;
}

/** Création de sa société : apport personnel (80 % du patrimoine) + investisseurs engagés ; ligne bancaire selon les banquiers. */
export function foundCompany(state: GameState, name: string, city: string) {
  const err = foundingCheck(state);
  if (err) return { ok: false, message: err };
  if (!CITY_BY_ID[city]) return { ok: false, message: 'Ville invalide.' };
  const c = state.career!;
  if (c.status === 'employed') leave(state, 'création de sa propre société');
  const personal = c.wealth * 0.8;
  const raised = c.investors.reduce((s, i) => s + i.capital, 0);
  const capital = personal + raised;
  c.wealth -= personal;
  c.equity = Math.max(0.05, 1 - c.investors.reduce((s, i) => s + i.share, 0));
  const bankers = npcsOf(state, 'banquier');
  const avgTrust = bankers.reduce((s, b) => s + b.trust, 0) / Math.max(1, bankers.length);
  state.company.creditMult = Math.max(0.4, Math.min(1.6, 0.7 + avgTrust / 100 + c.reputation / 200));
  state.company.name = name || 'Ma société';
  state.company.hqCity = city;
  state.company.cash = capital;
  state.company.initialCapital = capital;
  state.company.yearStartNav = capital;
  state.company.lossCarry = 0;
  state.office = defaultOffice(state.day);
  state.company.lossCarry = 0;
  state.lastNav = nav(state);
  state.risk.monthStartNav = state.lastNav;
  state.risk.limits = { varPctNav: 0.05, stopLossPctNav: 0.1, deltaPctNav: 0.02, strict: false };
  c.status = 'founder';
  c.employerId = null;
  c.allocation = capital;
  c.desk = [...COMMODITY_IDS];
  c.salary = 0;
  careerLog(state, `Création de ${state.company.name} à ${CITY_BY_ID[city]!.name} : ${(capital / 1e6).toFixed(1)} M$ de capital, ${Math.round(c.equity * 100)} % pour vous.`);
  addNews(state, { headline: `${state.player.name} lance sa maison de négoce, ${state.company.name}`, body: `Capital : ${(capital / 1e6).toFixed(1)} M$.`, tone: 'neutral', major: true, category: 'entreprises', cityId: city });
  return { ok: true, message: `${state.company.name} est née !` };
}

// ------------------------------------------------------------------ boucle quotidienne

/** Ouverture : offres des chasseurs de têtes, équipe, expiration des offres. */
export function careerOpen(state: GameState) {
  const c = state.career;
  if (!c) return;
  c.offers = c.offers.filter((o) => o.expiresDay >= state.day);
  if (!c.narrative) return;
  const firstOfMonth = monthIndexOf(state.day) !== monthIndexOf(state.lastCloseDay);
  if (firstOfMonth && (c.status === 'employed' || c.status === 'unemployed')) {
    for (const h of npcsOf(state, 'chasseur')) {
      const p = 0.08 + h.trust / 400 + c.reputation / 300 + (c.status === 'unemployed' ? 0.1 : 0);
      if (!chance(state.rng, p)) continue;
      const cands = state.companies.filter((x) => x.alive && x.id !== c.employerId);
      if (!cands.length) continue;
      const comp = pick(state.rng, cands);
      const level = Math.max(1, Math.min(6, c.level + (c.reputation > 50 && chance(state.rng, 0.4) ? 1 : 0)));
      makeOffer(state, comp.id, c.track, level, h.id);
      pushSituation(state, 'headhunter', { offerId: c.offers.at(-1)!.id, npcId: h.id });
    }
  }
  // équipe d'un head of desk
  for (const t of c.team) t.pnlYtd += c.allocation * 0.1 * ((t.skill - 50) / 50 * 0.0004 + 0.006 * normal(state.rng));
}

/** Clôture : salaire, coût de la vie, P&L reversé à l'employeur, discipline des limites, évaluations, bonus, dividendes. */
export function careerClose(state: GameState, navBefore: number, navNow: number) {
  const c = state.career;
  if (!c) return;
  const firstOfMonth = monthIndexOf(state.day) !== monthIndexOf(state.lastCloseDay);
  const newYear = ymd(state.day).y !== ymd(state.lastCloseDay).y;
  const city = c.status === 'employed' && c.employerId ? COMPANY_BY_ID[c.employerId]!.cityId : state.company.hqCity;
  if (firstOfMonth) {
    c.wealth += c.salary - (COST_OF_LIVING[city] ?? 4000);
    c.wealth *= 1 + 0.03 / 12; // épargne placée
    // les dépassements anciens s'oublient : un « strike » effacé chaque trimestre sans incident
    if (ymd(state.day).m % 3 === 1 && (state.world.eventCooldown['career.breach'] ?? -1) < state.day - 60) c.strikes = Math.max(0, c.strikes - 1);
  }
  if (c.status === 'employed') {
    const emp = state.companies.find((x) => x.id === c.employerId);
    if (emp) emp.nav += navNow - navBefore;
    // discipline des limites (salarié qui trade)
    if (c.track === 'trading' && c.allocation > 0 && state.risk.breaches.some((b) => b === 'var' || b === 'stoploss' || b.startsWith('delta'))) {
      if ((state.world.eventCooldown['career.breach'] ?? -1) < state.day) {
        c.strikes++;
        state.world.eventCooldown['career.breach'] = addBusinessDays(state.day, 3);
        const rm = findRole(state, 'risk', c.employerId);
        remember(state, rm?.id, -6, 'Dépassement de limites');
        if (state.risk.breaches.includes('stoploss') || c.strikes >= 3) {
          c.frozenUntil = addBusinessDays(state.day, 10);
          careerLog(state, 'Livre gelé 10 jours par le risk management.');
        }
        if (c.strikes >= 5) return fire(state, 'dépassements de limites répétés');
        pushSituation(state, 'risk_breach', { npcId: rm?.id ?? '', strikes: c.strikes });
      }
    }
    if (navNow < -0.2 * c.allocation && c.allocation > 0) return fire(state, 'pertes catastrophiques sur votre livre');
    // évaluations semestrielles (janvier et juillet) et bonus annuel
    const m = ymd(state.day).m;
    if (firstOfMonth && (m === 1 || m === 7) && c.narrative && state.day - c.lastReview > 90) {
      if (m === 1 && c.level >= 1) offerBonus(state);
      review(state);
    }
    if (newYear) {
      state.company.yearStartNav = navNow;
      for (const t of c.team) t.pnlYtd = 0;
    }
  }
  if (c.status === 'founder' && newYear) payDividends(state);
  if (c.status === 'ceo' && newYear) {
    const growth = navNow / Math.max(1, state.company.yearStartNav) - 1;
    if (growth < -0.25) {
      careerLog(state, 'Le conseil d’administration vous démet de vos fonctions de CEO.');
      state.pendingAlerts.push({ kind: 'career', text: 'Le conseil d’administration vous démet de vos fonctions de CEO.' });
      c.status = 'unemployed';
      c.unemployedSince = state.day;
      c.reputation = Math.max(0, c.reputation - 15);
    } else c.wealth += Math.max(0, navNow - state.company.yearStartNav) * 0.01;
  }
}

function offerBonus(state: GameState) {
  const c = state.career!;
  const trust = findRole(state, 'manager', c.employerId)?.trust ?? 0;
  let pool: number;
  if (c.track === 'trading' && c.allocation > 0) pool = Math.max(0, deskPnlPeriod(state) + c.team.reduce((s, t) => s + t.pnlYtd, 0)) * BONUS_RATE[c.level]! * (0.6 + trust / 125);
  else pool = c.salary * 12 * (evaluate(state).score / 100) * 0.3;
  pool = Math.round(pool / 1000) * 1000;
  if (pool <= 0) {
    careerLog(state, 'Pas de bonus cette année.');
    return;
  }
  pushSituation(state, 'bonus', { amount: pool, reservation: Math.round(pool * (1.15 + trust / 300)) });
}

/** Dividendes annuels du fondateur : retenue à la source selon la ville du siège. */
function payDividends(state: GameState) {
  const c = state.career!;
  const profit = state.lastNav - (state.company.yearStartNav ?? 0);
  if (profit <= 0) {
    for (const i of c.investors) remember(state, i.npcId, -6, 'Pas de dividende cette année');
    return;
  }
  const total = profit * c.payout;
  const wht = WITHHOLDING[state.company.hqCity] ?? 0;
  addCash(state, -total, 'dividends');
  c.wealth += total * c.equity * (1 - wht);
  for (const i of c.investors) remember(state, i.npcId, c.payout >= 0.2 ? 6 : -4, `Dividende ${(c.payout * 100).toFixed(0)} %`);
  careerLog(state, `Dividendes : ${(total / 1e6).toFixed(2)} M$ distribués, dont ${(total * c.equity * (1 - wht) / 1e6).toFixed(2)} M$ pour vous après retenue à la source de ${(wht * 100).toFixed(0)} %.`);
  log(state, 'Dividendes versés', -total);
}

