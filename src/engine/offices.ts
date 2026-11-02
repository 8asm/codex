/**
 * Phase 6 — Bureaux : taille du siège, style de la salle de marché, objets de prestige.
 *
 * Finance (exacte) :
 *  - Le loyer est une charge mensuelle (frais généraux). On ne retraite pas le bail en droit d'utilisation
 *    + dette locative (IFRS 16) : sans effet sur la trésorerie, et la valeur liquidative du jeu est une
 *    mesure économique, pas comptable (cf. DESIGN_NOTES).
 *  - Agencements et réaménagements : dépenses capitalisées puis amorties linéairement sur 60 mois.
 *    La valeur nette comptable entre dans la VL ; un déménagement la passe en perte (on ne remporte pas
 *    la moquette).
 *  - Achat de l'immeuble (tour, campus) : prix = loyer annuel / taux de capitalisation. Le bâti (60 %)
 *    s'amortit sur 40 ans, le terrain non ; charges de propriétaire 1,2 %/an ; revente avec 3 % de frais.
 *    Louer ou acheter revient à comparer le rendement locatif (6 %) au coût de l'argent + charges +
 *    usure : à taux de 4 % c'est presque neutre, le choix se joue sur le prestige et la trésorerie.
 *  - Œuvre d'art : valorisée à 75 % de son prix (juste valeur nette des frais d'enchères).
 *
 * Jeu : le prestige (0–100) agit sur les invitations au siège, les négociations de contrats physiques,
 * les levées de fonds, l'arrivée de candidats de talent ; le style et les objets donnent des bonus ciblés.
 */
import { CITY_BY_ID } from '../data/cities';
import {
  BASE_SEATS, BUILDING_DEPRECIATION_PA, CONFERENCE_COST, FIT_OUT_MONTHS, INVITE_COST, ITEM_BY_ID, OFFICE_CAP_RATE,
  OVERFLOW_SEAT_MONTHLY, OWNER_COSTS_PA, PROPERTY_SALE_COST, STYLE_BY_ID, STYLE_SCALE, TIERS,
} from '../data/offices';
import { MANAGER_NAMES } from '../data/assets';
import { addCash, log, newId } from './ledger';
import { addNews } from './news';
import { npc, remember } from './npcs';
import { hashUniform } from './rng';
import { ymd } from './calendar';
import type { Day } from './calendar';
import type { ActionResult, FloorStyle, GameState, OfficeState, OfficeTier, PrestigeItemId } from './types';
import { nav } from './valuation';
import { complianceSeats } from './compliance';
import { hqStaffSeats } from './staff';

const DAYS_PER_MONTH = 365.25 / 12;

export function defaultOffice(day: Day, tier: OfficeTier = 0): OfficeState {
  // Locaux livrés aménagés : l'aménagement initial est inclus dans le loyer (pas de capex de départ).
  return { tier, style: 'classique', owned: null, fitOuts: [], items: [], movedDay: day, lastConferenceYear: 0, applicants: 0 };
}

/** Le joueur dirige-t-il les bureaux ? (pas un salarié dans les locaux de son employeur) */
export function managesOffice(state: GameState): boolean {
  const c = state.career;
  return !c || c.status === 'founder' || c.status === 'ceo';
}

function office(state: GameState): OfficeState {
  return (state.office ??= defaultOffice(state.day));
}

/** Coûts locaux : la main-d'œuvre du second œuvre suit le coût du personnel de la ville. */
export function localCost(state: GameState, cityId = state.company.hqCity): number {
  return 0.6 + 0.4 * (CITY_BY_ID[cityId]?.staffCostIndex ?? 1);
}

export function fitOutCost(state: GameState, tier: OfficeTier, cityId = state.company.hqCity): number {
  return Math.round(TIERS[tier]!.fitOut * localCost(state, cityId));
}

export function styleCost(state: GameState, style: FloorStyle, tier = office(state).tier): number {
  return Math.round(STYLE_BY_ID[style].cost * STYLE_SCALE[tier] * localCost(state));
}

export function rentFor(state: GameState, tier: OfficeTier, cityId = state.company.hqCity): number {
  return CITY_BY_ID[cityId]!.officeRentMonthly * TIERS[tier]!.rentMult;
}

/** Prix d'achat de l'immeuble : capitalisation du loyer de marché. */
export function buildingPrice(state: GameState, tier: OfficeTier = office(state).tier): number {
  return Math.round((rentFor(state, tier) * 12) / OFFICE_CAP_RATE);
}

const monthsSince = (state: GameState, d: Day) => Math.max(0, (state.day - d) / DAYS_PER_MONTH);

export function fitOutBook(state: GameState, f: { cost: number; since: Day; months: number }): number {
  return f.cost * Math.max(0, 1 - monthsSince(state, f.since) / f.months);
}

export function buildingBook(state: GameState): number {
  const o = office(state).owned;
  if (!o) return 0;
  const years = monthsSince(state, o.since) / 12;
  return o.cost * Math.max(0.4, 1 - BUILDING_DEPRECIATION_PA * years);
}

/** Valeur des bureaux incluse dans la VL : agencements nets + immeuble net + œuvres d'art. */
export function officeBookValue(state: GameState): number {
  const o = state.office;
  if (!o) return 0;
  let v = buildingBook(state);
  for (const f of o.fitOuts) v += fitOutBook(state, f);
  for (const i of o.items) v += i.cost * ITEM_BY_ID[i.id].resale;
  return v;
}

const AUTOMATION_SEATS = (state: GameState) => {
  const a = state.automation;
  return a ? [a.autoRoll, a.autoHedge.on, a.autoSellProduction, a.autoLogistics].filter(Boolean).length : 0;
};

/** Postes occupés : équipe de base, gérants d'actifs en poste, un opérateur par automatisation. */
export function seatsUsed(state: GameState): number {
  return BASE_SEATS + state.managers.filter((m) => m.assetId).length + AUTOMATION_SEATS(state) + complianceSeats(state) + hqStaffSeats(state);
}

export function seatsFree(state: GameState): number {
  return TIERS[office(state).tier]!.seats - seatsUsed(state);
}

const has = (o: OfficeState, id: PrestigeItemId) => o.items.some((i) => i.id === id);

export function prestige(state: GameState): number {
  const o = office(state);
  let p = TIERS[o.tier]!.prestige + STYLE_BY_ID[o.style].prestige;
  for (const i of o.items) p += ITEM_BY_ID[i.id].prestige;
  if (o.owned) p += 5;
  p -= 4 * Math.max(0, -seatsFree(state));
  return Math.max(0, Math.min(100, p));
}

export interface OfficeEffects {
  prestige: number;
  /** multiplicateur des gains de confiance (rendez-vous, invitations) */
  relationMult: number;
  inviteMult: number;
  /** multiplicateur de progression des compétences du joueur */
  skillMult: number;
  /** multiplicateur de la probabilité d'erreur des gérants d'actifs */
  mistakeMult: number;
  /** probabilité mensuelle d'une candidature spontanée de talent */
  talentRate: number;
  salaryMult: number;
}

const NEUTRAL: OfficeEffects = { prestige: 0, relationMult: 1, inviteMult: 1, skillMult: 1, mistakeMult: 1, talentRate: 0, salaryMult: 1 };

export function officeEffects(state: GameState): OfficeEffects {
  if (!state.office || !managesOffice(state)) return NEUTRAL;
  const o = state.office;
  const P = prestige(state);
  return {
    prestige: P,
    relationMult: o.style === 'classique' ? 1.15 : 1,
    inviteMult: has(o, 'reception') ? 1.5 : 1,
    skillMult: (o.style === 'openspace' ? 1.25 : 1) * (has(o, 'academie') ? 1.2 : 1),
    mistakeMult: (o.style === 'bunker' ? 0.65 : 1) * (has(o, 'mur') ? 0.9 : 1),
    talentRate: Math.min(0.7, P / 120 + (has(o, 'bienetre') ? 0.15 : 0)),
    salaryMult: has(o, 'bienetre') ? 0.9 : 1,
  };
}

/** Coûts mensuels des locaux. */
export function officeMonthly(state: GameState): { rent: number; upkeep: number; overflow: number } {
  const o = office(state);
  const rent = o.owned ? 0 : rentFor(state, o.tier);
  let upkeep = o.owned ? (o.owned.cost * OWNER_COSTS_PA) / 12 : 0;
  for (const i of o.items) upkeep += ITEM_BY_ID[i.id].monthly;
  const over = Math.max(0, -seatsFree(state));
  const overflow = over * OVERFLOW_SEAT_MONTHLY * (CITY_BY_ID[state.company.hqCity]?.staffCostIndex ?? 1);
  return { rent, upkeep, overflow };
}

function freeCash(state: GameState) {
  return state.company.cash - state.company.im;
}

function spend(state: GameState, amount: number, text: string) {
  addCash(state, -amount, 'office');
  log(state, text, -amount);
}

/** Cède l'immeuble détenu (cession-bail implicite : on reste locataire). */
function sellBuilding(state: GameState): number {
  const o = office(state);
  if (!o.owned) return 0;
  const proceeds = buildingBook(state) * (1 - PROPERTY_SALE_COST);
  addCash(state, proceeds, 'office');
  log(state, 'Cession de l’immeuble du siège', proceeds);
  o.owned = null;
  return proceeds;
}

/** Retire les objets incompatibles avec un palier ; l'art est revendu, le reste est perdu. */
function dropItems(state: GameState, keep: (id: PrestigeItemId) => boolean) {
  const o = office(state);
  for (const i of [...o.items]) {
    if (keep(i.id)) continue;
    const def = ITEM_BY_ID[i.id];
    if (def.resale > 0) {
      addCash(state, i.cost * def.resale, 'office');
      log(state, `Vente : ${def.name}`, i.cost * def.resale);
    }
    o.items = o.items.filter((x) => x !== i);
  }
}

export function moveOffice(state: GameState, tier: OfficeTier, buy = false): ActionResult {
  if (!managesOffice(state)) return { ok: false, message: 'Les bureaux appartiennent à votre employeur.' };
  const o = office(state);
  const def = TIERS[tier];
  if (!def) return { ok: false, message: 'Palier inconnu.' };
  if (tier === o.tier) return { ok: false, message: 'Vous occupez déjà ces locaux.' };
  if (state.day - o.movedDay < 60) return { ok: false, message: 'Vous venez d’emménager : attendez deux mois avant un nouveau déménagement.' };
  const v = nav(state);
  if (tier > o.tier && v < def.minNav) return { ok: false, message: `Aucun bailleur ne signera : valeur liquidative de ${(def.minNav / 1e6).toFixed(0)} M$ requise.` };
  if (buy && tier < 2) return { ok: false, message: 'Seules une tour ou un campus peuvent être achetés.' };
  const proceeds = o.owned ? buildingBook(state) * (1 - PROPERTY_SALE_COST) : 0;
  const fit = fitOutCost(state, tier);
  const price = buy ? buildingPrice(state, tier) : 0;
  if (fit + price > freeCash(state) + proceeds) return { ok: false, message: `Trésorerie insuffisante : ${((fit + price) / 1e6).toFixed(1)} M$ nécessaires.` };
  sellBuilding(state);
  const lost = o.fitOuts.reduce((s, f) => s + fitOutBook(state, f), 0);
  o.fitOuts = [];
  if (lost > 0) log(state, `Agencements abandonnés (valeur nette ${(lost / 1e6).toFixed(2)} M$ passée en perte)`);
  dropItems(state, (id) => ITEM_BY_ID[id].minTier <= tier);
  const up = tier > o.tier;
  o.tier = tier;
  o.movedDay = state.day;
  spend(state, fit, `Agencement : ${def.name}`);
  o.fitOuts.push({ label: `Agencement ${def.short.toLowerCase()}`, cost: fit, since: state.day, months: FIT_OUT_MONTHS });
  if (buy) {
    spend(state, price, `Achat de l’immeuble : ${def.name}`);
    o.owned = { cost: price, since: state.day };
  }
  addNews(state, {
    headline: up ? `${state.company.name} s’agrandit : ${def.name.toLowerCase()} à ${CITY_BY_ID[state.company.hqCity]!.name}` : `${state.company.name} réduit la voilure et quitte ses grands bureaux`,
    tone: up ? 'up' : 'neutral', major: false, category: 'entreprises', cityId: state.company.hqCity,
  });
  return { ok: true, message: `${def.name} : emménagement terminé (${(fit / 1e6).toFixed(2)} M$ d’agencements${buy ? `, immeuble acheté ${(price / 1e6).toFixed(1)} M$` : ''}).` };
}

export function setStyle(state: GameState, style: FloorStyle): ActionResult {
  if (!managesOffice(state)) return { ok: false, message: 'Les bureaux appartiennent à votre employeur.' };
  const o = office(state);
  if (!STYLE_BY_ID[style]) return { ok: false, message: 'Style inconnu.' };
  if (o.style === style) return { ok: false, message: 'C’est déjà le style de votre salle.' };
  const cost = styleCost(state, style);
  if (cost > freeCash(state)) return { ok: false, message: 'Trésorerie insuffisante.' };
  // l'ancien réaménagement de style est démonté (perte de sa valeur nette)
  o.fitOuts = o.fitOuts.filter((f) => !f.label.startsWith('Style'));
  spend(state, cost, `Réaménagement de la salle de marché : ${STYLE_BY_ID[style].name}`);
  o.fitOuts.push({ label: `Style ${STYLE_BY_ID[style].name}`, cost, since: state.day, months: FIT_OUT_MONTHS });
  o.style = style;
  return { ok: true, message: `Salle de marché réaménagée : ${STYLE_BY_ID[style].name}.` };
}

export function officeItem(state: GameState, id: PrestigeItemId, sell = false): ActionResult {
  if (!managesOffice(state)) return { ok: false, message: 'Les bureaux appartiennent à votre employeur.' };
  const o = office(state);
  const def = ITEM_BY_ID[id];
  if (!def) return { ok: false, message: 'Objet inconnu.' };
  if (sell) {
    const it = o.items.find((i) => i.id === id);
    if (!it) return { ok: false, message: 'Vous ne possédez pas cet objet.' };
    dropItems(state, (x) => x !== id);
    return { ok: true, message: def.resale > 0 ? `${def.name} vendu ${((it.cost * def.resale) / 1e6).toFixed(2)} M$.` : `${def.name} démonté.` };
  }
  if (has(o, id)) return { ok: false, message: 'Déjà installé.' };
  if (o.tier < def.minTier) return { ok: false, message: `Nécessite des locaux de type « ${TIERS[def.minTier]!.name} ».` };
  const cost = Math.round(def.resale > 0 ? def.cost : def.cost * localCost(state));
  if (cost > freeCash(state)) return { ok: false, message: 'Trésorerie insuffisante.' };
  spend(state, cost, `Prestige : ${def.name}`);
  o.items.push({ id, cost, since: state.day });
  return { ok: true, message: `${def.icon} ${def.name} installé. ${def.effect}.` };
}

export function officeProperty(state: GameState, buy: boolean): ActionResult {
  if (!managesOffice(state)) return { ok: false, message: 'Les bureaux appartiennent à votre employeur.' };
  const o = office(state);
  if (!buy) {
    if (!o.owned) return { ok: false, message: 'Vous êtes déjà locataire.' };
    const p = sellBuilding(state);
    return { ok: true, message: `Immeuble cédé ${(p / 1e6).toFixed(1)} M$ : vous redevenez locataire (cession-bail).` };
  }
  if (o.owned) return { ok: false, message: 'Vous êtes déjà propriétaire.' };
  if (o.tier < 2) return { ok: false, message: 'Seules une tour ou un campus peuvent être achetés.' };
  const price = buildingPrice(state);
  if (price > freeCash(state)) return { ok: false, message: `Trésorerie insuffisante : ${(price / 1e6).toFixed(1)} M$.` };
  spend(state, price, `Achat de l’immeuble du siège`);
  o.owned = { cost: price, since: state.day };
  return { ok: true, message: `Vous êtes propriétaire de votre siège (${(price / 1e6).toFixed(1)} M$). Plus de loyer, mais des charges et du capital immobilisé.` };
}

/** Recevoir un contact au siège : l'effet dépend du prestige des lieux. */
export function inviteToHq(state: GameState, id: string): ActionResult {
  if (!managesOffice(state)) return { ok: false, message: 'Vous ne pouvez pas recevoir dans les bureaux de votre employeur.' };
  const n = npc(state, id);
  if (!n) return { ok: false, message: 'Contact introuvable.' };
  if (state.player.cityId !== state.company.hqCity) return { ok: false, message: 'Vous devez être au siège pour recevoir.' };
  const key = `meet.${id}`;
  if ((state.world.eventCooldown[key] ?? -1) > state.day) return { ok: false, message: `Vous avez vu ${n.name} récemment.` };
  state.world.eventCooldown[key] = state.day + 21;
  const e = officeEffects(state);
  const cost = INVITE_COST * localCost(state);
  addCash(state, -cost, 'overhead');
  const gain = 5 * (0.6 + e.prestige / 60) * e.relationMult * e.inviteMult * (1 - Math.max(0, n.trust) / 120);
  const wow = e.prestige >= 40;
  remember(state, id, gain, wow ? 'Reçu au siège : très impressionné' : 'Reçu au siège');
  return { ok: true, message: `${n.name} est reçu${wow ? ' et repart impressionné' : ''} (confiance +${gain.toFixed(1)}).` };
}

/** Bonus de négociation (fraction du prix) : un client reçu dans de beaux bureaux concède davantage. */
export function negotiationEdge(state: GameState): number {
  const e = officeEffects(state);
  const atHq = state.player.cityId === state.company.hqCity;
  return (e.prestige / 100) * 0.0015 * (atHq ? 1 : 0.5) * (state.office?.style === 'verriere' ? 1.3 : 1);
}

/** Frais mensuels + vie des bureaux (candidats, académie, conférence). Appelé au changement de mois. */
export function officeMonth(state: GameState): number {
  if (!managesOffice(state)) return 0;
  const o = office(state);
  const { rent, upkeep, overflow } = officeMonthly(state);
  const e = officeEffects(state);
  // Candidature spontanée : un gérant de talent attiré par la réputation des lieux.
  if (hashUniform(state.config.seed, state.day, 'talent') < e.talentRate) {
    const free = state.managers.filter((m) => !m.assetId).length;
    const used = new Set(state.managers.map((m) => m.name));
    const names = MANAGER_NAMES.filter((x) => !used.has(x));
    if (free < 10 && names.length) {
      const u = hashUniform(state.config.seed, state.day, 'talent.skill');
      const skill = Math.round(Math.min(98, 50 + 30 * u + e.prestige / 5 + (has(o, 'academie') ? 5 : 0)));
      const name = names[Math.floor(hashUniform(state.config.seed, state.day, 'talent.name') * names.length)]!;
      const specialty = (['production', 'stockage', 'logistique'] as const)[Math.floor(u * 3)]!;
      state.managers.push({ id: newId(state, 'mg'), name, skill, salary: Math.round((12_000 + skill * 450) * e.salaryMult), specialty, assetId: null, mistakes: 0 });
      o.applicants++;
      addNews(state, { headline: `Candidature spontanée : ${name} (${specialty}, compétence ${skill}) veut rejoindre ${state.company.name}`, tone: 'neutral', major: false, category: 'entreprises' });
    }
  }
  if (has(o, 'academie')) for (const m of state.managers) if (m.assetId) m.skill = Math.min(95, m.skill + 0.4);
  // Conférence annuelle en janvier.
  const { y, m } = ymd(state.day);
  let conf = 0;
  if (has(o, 'auditorium') && m === 1 && o.lastConferenceYear !== y) {
    o.lastConferenceYear = y;
    conf = CONFERENCE_COST * localCost(state);
    for (const n of state.npcs) remember(state, n.id, 4, `Invité à la conférence ${y} de ${state.company.name}`);
    if (state.career) state.career.reputation = Math.min(100, state.career.reputation + 3);
    addNews(state, { headline: `Conférence annuelle de ${state.company.name} : tout le négoce est venu`, tone: 'up', major: false, category: 'entreprises', cityId: state.company.hqCity });
  }
  const total = rent + upkeep + overflow + conf;
  addCash(state, -total, 'overhead');
  log(state, `Bureaux : loyer ${Math.round(rent / 1000)} k$, charges ${Math.round(upkeep / 1000)} k$${overflow ? `, coworking de débordement ${Math.round(overflow / 1000)} k$` : ''}${conf ? `, conférence ${Math.round(conf / 1000)} k$` : ''}`, -total);
  return total;
}

/** Transfert du siège dans une autre ville : agencements perdus, immeuble vendu, art déménagé. */
export function relocateOffice(state: GameState, toCity: string) {
  const o = office(state);
  sellBuilding(state);
  o.fitOuts = [];
  dropItems(state, (id) => ITEM_BY_ID[id].resale > 0);
  const fit = fitOutCost(state, o.tier, toCity);
  spend(state, fit, `Agencement des nouveaux bureaux (${TIERS[o.tier]!.name})`);
  o.fitOuts.push({ label: `Agencement ${TIERS[o.tier]!.short.toLowerCase()}`, cost: fit, since: state.day, months: FIT_OUT_MONTHS });
  o.movedDay = state.day;
}

/** Palier « apparent » d'une société simulée (vue ville des concurrents ou de l'employeur). */
export function tierForNav(v: number): OfficeTier {
  if (v >= 2e9) return 3;
  if (v >= TIERS[2]!.minNav) return 2;
  if (v >= TIERS[1]!.minNav) return 1;
  return 0;
}
