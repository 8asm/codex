/**
 * Concurrents simulés : chaque société a des fonds propres, des expositions par commodité (notionnel signé)
 * choisies selon ses desks, son appétit et un signal (tendance + conviction propre), une marge commerciale,
 * une réputation et une notation. Elles gagnent, perdent, sont débauchées, rachetées, font faillite.
 *
 * Effets sur le joueur : contreparties de ses deals (risque de défaut), concurrence sur les bonnes offres
 * physiques, chocs de marché quand une grosse maison liquide, classement et rivalités nominatives.
 */
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { COMPANIES, COMPANY_BY_ID } from '../data/companies';
import { RATINGS } from '../data/world';
import { addBusinessDays } from './calendar';
import { handleDefault } from './credit';
import { forwardAt } from './market';
import { addNews } from './news';
import { chance, normal, pick, randInt } from './rng';
import type { AICompanyState, CommodityId, GameState, Impact } from './types';
import { nav } from './valuation';
import { companyHooks } from './world';

const LEVERAGE: Record<string, number> = { trader: 2.5, fund: 3, major: 1, agri: 1.5, miner: 0.6, bank: 0.5, producer: 0.8, utility: 0.5 };
const MARGIN: Record<string, number> = { trader: 0.07, fund: 0.02, major: 0.04, agri: 0.05, miner: 0.08, bank: 0.05, producer: 0.06, utility: 0.03 };

export function createCompanies(): AICompanyState[] {
  return COMPANIES.filter((c) => c.ai).map((c) => ({
    id: c.id, nav: c.capital, initialNav: c.capital, peakNav: c.capital, yearStartNav: c.capital, exposure: {},
    reputation: c.reputation, rating: c.rating, alive: true, scandals: 0, nextRebalance: 0, history: [c.capital],
  }));
}

function ratingFor(c: AICompanyState): string {
  const def = COMPANY_BY_ID[c.id]!;
  const base = RATINGS.indexOf(def.rating);
  const health = c.nav / c.initialNav;
  let idx = base + (health < 0.4 ? 3 : health < 0.65 ? 2 : health < 0.85 ? 1 : health > 1.5 ? -1 : 0) + (c.reputation < 35 ? 1 : 0);
  idx = Math.max(0, Math.min(6, idx));
  return RATINGS[idx]!;
}

/** Rendement log du jour par commodité (maturité constante 2 mois), depuis l'instantané d'avant-hier soir. */
function dailyReturns(state: GameState): Record<CommodityId, number> {
  const h = state.market.history;
  const prev = h[h.length - 2];
  const out = {} as Record<CommodityId, number>;
  for (const c of COMMODITY_IDS) {
    if (!prev) { out[c] = 0; continue; }
    const p0 = forwardAt(state.market, c, prev.day + 60, prev.day, prev.f[c][0], prev.f[c][1], prev.volMult);
    const p1 = forwardAt(state.market, c, state.day + 60);
    out[c] = Math.log(p1 / p0);
  }
  return out;
}

function momentum(state: GameState, c: CommodityId): number {
  const h = state.market.history;
  if (h.length < 22) return 0;
  const a = h[h.length - 21]!, b = h[h.length - 1]!;
  const p0 = forwardAt(state.market, c, a.day + 60, a.day, a.f[c][0], a.f[c][1], a.volMult);
  const p1 = forwardAt(state.market, c, b.day + 60, b.day, b.f[c][0], b.f[c][1], b.volMult);
  return Math.max(-1, Math.min(1, Math.log(p1 / p0) / 0.08));
}

export function stepCompanies(state: GameState) {
  const r = dailyReturns(state);
  for (const co of state.companies.filter((x) => x.alive)) {
    const def = COMPANY_BY_ID[co.id]!;
    let pnl = 0;
    for (const c of COMMODITY_IDS) pnl += (co.exposure[c] ?? 0) * (Math.exp(r[c]) - 1);
    const strength = Object.values(def.desks).reduce((a, b) => a + (b ?? 0), 0) / Math.max(1, Object.keys(def.desks).length);
    pnl += co.nav * ((MARGIN[def.kind]! * strength) / 252) * (1 + 0.8 * normal(state.rng)); // marge commerciale bruitée
    pnl -= co.nav * (0.025 / 252); // frais
    co.nav += pnl;
    co.peakNav = Math.max(co.peakNav, co.nav);
    co.history.push(co.nav);
    if (co.history.length > 260) co.history.shift();
    if (state.day >= co.nextRebalance) {
      for (const c of Object.keys(def.desks) as CommodityId[]) {
        const signal = Math.max(-1, Math.min(1, 0.5 * momentum(state, c) + 0.6 * normal(state.rng)));
        co.exposure[c] = signal * def.appetite * (def.desks[c] ?? 0) * LEVERAGE[def.kind]! * Math.max(0, co.nav);
      }
      co.nextRebalance = addBusinessDays(state.day, randInt(state.rng, 4, 8));
    }
    co.rating = ratingFor(co);
    const floor = def.kind === 'trader' || def.kind === 'fund' ? 0.2 : 0.1;
    if (co.nav < floor * co.initialNav) companyDefault(state, co.id, 'Pertes de trading et lignes bancaires coupées.');
  }
  corporateFlavor(state);
}

/** Faillite d'une société simulée : liquidation (choc de marché), contrats du joueur résiliés et compensés. */
export function companyDefault(state: GameState, id: string, reason: string) {
  const co = state.companies.find((c) => c.id === id);
  if (!co || !co.alive) return;
  co.alive = false;
  co.defaultDay = state.day;
  co.rating = 'D';
  const def = COMPANY_BY_ID[id]!;
  // Liquidation forcée de ses positions : elle pousse les prix contre ses expositions.
  for (const c of COMMODITY_IDS) {
    const e = co.exposure[c] ?? 0;
    if (!e) continue;
    const shock = -Math.sign(e) * Math.min(0.12, (Math.abs(e) / 2e9) * 0.05);
    state.market.commodities[c].chi += shock;
    state.market.ivLevel[c] = Math.min(2.4, state.market.ivLevel[c] + Math.abs(shock) * 3);
  }
  co.exposure = {};
  addNews(state, { headline: `Faillite de ${def.name}`, body: `${reason} Ses positions sont liquidées dans l’urgence ; ses contreparties découvrent leur exposition.`, tone: 'alert', major: true, category: 'entreprises', companyId: id, cityId: def.cityId });
  state.pendingAlerts.push({ kind: 'major_news', text: `Faillite de ${def.name}` });
  handleDefault(state, id);
}

function applyCompanyImpact(state: GameState, im: Impact) {
  if (im.k === 'companyHit') {
    const co = state.companies.find((c) => c.id === im.id && c.alive);
    if (!co) return;
    co.nav *= 1 + im.navPct;
    co.reputation = Math.max(0, Math.min(100, co.reputation + im.rep));
    if (im.rep < 0) co.scandals++;
    co.rating = ratingFor(co);
  } else if (im.k === 'companyDefault') {
    companyDefault(state, im.id, 'Pertes dissimulées révélées.');
  }
}
companyHooks.apply = applyCompanyImpact;

/** Vie des sociétés : rachats (novation des contrats), débauchages, gros deals. */
function corporateFlavor(state: GameState) {
  const alive = state.companies.filter((c) => c.alive);
  const rng = state.rng;
  // Rachat d'une société affaiblie par une plus solide du même métier.
  if (chance(rng, 0.004)) {
    const weak = alive.filter((c) => c.nav < 0.55 * c.initialNav && COMPANY_BY_ID[c.id]!.kind !== 'bank');
    if (weak.length) {
      const target = pick(rng, weak);
      const kind = COMPANY_BY_ID[target.id]!.kind;
      const buyers = alive.filter((c) => c.id !== target.id && c.nav > 2 * target.nav && (COMPANY_BY_ID[c.id]!.kind === kind || COMPANY_BY_ID[c.id]!.kind === 'major'));
      if (buyers.length) {
        const buyer = pick(rng, buyers);
        target.alive = false;
        target.mergedInto = buyer.id;
        buyer.nav += target.nav * 0.9;
        buyer.initialNav += target.initialNav * 0.5;
        for (const [c, e] of Object.entries(target.exposure)) buyer.exposure[c as CommodityId] = (buyer.exposure[c as CommodityId] ?? 0) + (e ?? 0);
        // Novation : les contrats du joueur avec la cible passent chez l'acheteur.
        for (const d of state.forwards) if (d.counterpartyId === target.id) d.counterpartyId = buyer.id;
        for (const x of state.otc) if (x.bankId === target.id) x.bankId = buyer.id;
        state.offers = state.offers.filter((o) => o.counterpartyId !== target.id);
        addNews(state, { headline: `${COMPANY_BY_ID[buyer.id]!.name} rachète ${COMPANY_BY_ID[target.id]!.name}`, body: 'Les contrats en cours sont transférés à l’acquéreur (novation).', tone: 'neutral', major: false, category: 'entreprises', companyId: buyer.id });
      }
    }
  }
  if (chance(rng, 0.006) && alive.length > 2) {
    const a = pick(rng, alive), b = pick(rng, alive.filter((x) => x.id !== a.id));
    const da = COMPANY_BY_ID[a.id]!, db = COMPANY_BY_ID[b.id]!;
    const desk = pick(rng, Object.keys(db.desks) as CommodityId[]);
    a.reputation = Math.min(100, a.reputation + 2);
    b.nav *= 0.99;
    addNews(state, { headline: `${da.name} débauche l’équipe ${COMMODITIES[desk].short} de ${db.name}`, body: `${db.star ? `Le départ de proches de ${db.star} ` : 'Le départ '}fragilise le desk ; les clients suivront-ils ?`, tone: 'neutral', major: false, category: 'entreprises', companyId: a.id });
  }
  if (chance(rng, 0.008)) {
    const a = pick(rng, alive.filter((c) => ['trader', 'major', 'agri'].includes(COMPANY_BY_ID[c.id]!.kind)));
    if (a) {
      const d = COMPANY_BY_ID[a.id]!;
      const desk = pick(rng, Object.keys(d.desks) as CommodityId[]);
      const deals = [
        `${d.name} signe un prépaiement géant avec un producteur de ${COMMODITIES[desk].short}`,
        `${d.name} prend une participation dans un terminal de ${COMMODITIES[desk].short}`,
        `${d.name} décroche un contrat d’enlèvement de long terme sur le ${COMMODITIES[desk].short}`,
      ];
      addNews(state, { headline: pick(rng, deals), body: 'Les concurrents verrouillent l’offre physique : les bonnes cargaisons se raréfient.', tone: 'neutral', major: false, category: 'entreprises', companyId: a.id, commodity: desk });
    }
  }
}

export interface Ranked {
  id: string; // 'player' pour le joueur
  name: string;
  nav: number;
  ytd: number;
  rating: string;
  cityId: string;
  kind: string;
}

/** Classement des maisons (hors banques), joueur compris. */
export function leaderboard(state: GameState): Ranked[] {
  const out: Ranked[] = state.companies
    .filter((c) => c.alive && COMPANY_BY_ID[c.id]!.kind !== 'bank')
    .map((c) => ({ id: c.id, name: COMPANY_BY_ID[c.id]!.name, nav: c.nav, ytd: c.nav / c.yearStartNav - 1, rating: c.rating, cityId: COMPANY_BY_ID[c.id]!.cityId, kind: COMPANY_BY_ID[c.id]!.kind }));
  const n = nav(state);
  out.push({ id: 'player', name: state.company.name, nav: n, ytd: n / state.company.yearStartNav - 1, rating: '—', cityId: state.company.hqCity, kind: 'trader' });
  return out.sort((a, b) => b.nav - a.nav);
}

/** Rival nominatif : la maison de la même ville au profil le plus proche, sinon la plus proche au classement. */
export function rivalOf(state: GameState): string | null {
  const board = leaderboard(state);
  const i = board.findIndex((r) => r.id === 'player');
  const sameCity = board.filter((r) => r.id !== 'player' && r.cityId === state.company.hqCity && ['trader', 'fund'].includes(r.kind));
  if (sameCity.length) return sameCity.sort((a, b) => Math.abs(a.nav - board[i]!.nav) - Math.abs(b.nav - board[i]!.nav))[0]!.id;
  return board[i - 1]?.id ?? board[i + 1]?.id ?? null;
}

export function resetCompanyYear(state: GameState) {
  for (const c of state.companies) if (c.alive) c.yearStartNav = c.nav;
}
