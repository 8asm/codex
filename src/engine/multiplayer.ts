/**
 * Phase 11 — Multijoueur (jusqu'à 4 joueurs), moteur pur, sans réseau.
 *
 * Modèle « lockstep déterministe » : chaque navigateur simule exactement la même partie à partir de la même
 * configuration ; l'hôte fixe l'ordre des événements (trames numérotées : une action d'un joueur, ou « jour
 * suivant »), que tous appliquent dans le même ordre. Les messages restent minuscules et aucun serveur de jeu
 * n'est nécessaire : l'hôte est l'un des joueurs.
 *
 * Plusieurs sociétés humaines partagent un seul monde : le marché, la géopolitique et les sociétés IA sont ceux de
 * la société n° 0 (« maître »), partagés par référence ; chaque société garde ses livres, ses offres, son équipe.
 * Plusieurs joueurs peuvent diriger la même société (coopération), avec un rôle : PDG (tout) ou trader (marchés).
 * Les impacts de marché des uns se voient chez les autres : c'est le même carnet.
 */
import { advanceDayMulti, createGame, dispatch } from './game';
import { generateOffers } from './physical';
import { recomputeIm } from './margin';
import type { Action, ActionResult, GameConfig, GameState } from './types';
import { nav } from './valuation';


export type MpRole = 'ceo' | 'trader';

export interface MpCompanySetup {
  name: string;
  hqCity: string;
  capital: number;
}

export interface MpSetup {
  config: Partial<GameConfig>;
  companies: MpCompanySetup[];
}

export interface MpPlayer {
  id: string;
  name: string;
  company: number;
  role: MpRole;
  color: string;
}

export type Frame =
  | { seq: number; kind: 'action'; player: string; company: number; action: Action }
  | { seq: number; kind: 'tick' };

/** Actions qu'un trader (rôle non dirigeant) peut passer dans une société partagée. */
const TRADER_ACTIONS = new Set([
  'TRADE_FUTURE', 'TRADE_SPREAD', 'TRADE_OPTION', 'EXERCISE_OPTION', 'TRADE_OTC', 'TRADE_EXOTIC', 'CLOSE_EXOTIC', 'HEDGE_DELTA',
  'ACCEPT_OFFER', 'SPOT_BUY', 'SPOT_SELL', 'SHIP_CARGO', 'TRADE_FFA', 'START_NEGOTIATION', 'NEGOTIATE', 'TRAVEL', 'START_LESSON', 'QUIT_LESSON', 'SKIP_LESSON_STEP',
]);

export function roleAllows(role: MpRole, action: Action): boolean {
  return role === 'ceo' || TRADER_ACTIONS.has(action.type);
}

/** Crée les sociétés d'une partie à plusieurs, dans un monde commun. */
export function createMultiGame(setup: MpSetup): GameState[] {
  const states = setup.companies.map((c, k) =>
    createGame({ ...setup.config, mode: 'sandbox', start: 'found', companyName: c.name, hqCity: c.hqCity, capital: c.capital, seed: k === 0 ? setup.config.seed : `${setup.config.seed}#${k}` }),
  );
  const master = states[0]!;
  for (const [k, s] of states.entries()) {
    s.mp = { slot: k, follower: k > 0, companies: setup.companies.map((c) => c.name) };
    if (k === 0) continue;
    linkFollower(master, s);
    // les offres du premier jour sont recalculées sur le marché commun
    s.offers = [];
    generateOffers(s);
    recomputeIm(s);
  }
  refreshRivals(states);
  return states;
}

/** Les sociétés suiveuses partagent le monde de la société maître (par référence). */
function linkFollower(master: GameState, s: GameState) {
  s.market = master.market;
  s.world = master.world;
  s.companies = master.companies;
  s.day = master.day;
}

/** Classement commun : chaque société voit les autres maisons humaines. */
export function refreshRivals(states: GameState[]) {
  const list = states.map((s, k) => ({ slot: k, name: s.company.name, nav: nav(s), cityId: s.company.hqCity, status: s.status }));
  for (const s of states) if (s.mp) s.mp.rivals = list.filter((r) => r.slot !== s.mp!.slot);
}

/** Journée commune : clôture de chaque société au prix du jour, puis le maître fait avancer le monde. */
export function advanceAll(states: GameState[]) {
  advanceDayMulti(states);
  refreshRivals(states);
}

/** Applique une trame (dans l'ordre fixé par l'hôte). Renvoie le résultat de l'action, le cas échéant. */
export function applyFrame(states: GameState[], f: Frame, roles?: Record<string, MpRole>): ActionResult | null {
  if (f.kind === 'tick') {
    advanceAll(states);
    return null;
  }
  const s = states[f.company];
  if (!s) return { ok: false, message: 'Société inconnue.' };
  const role = roles?.[f.player] ?? 'ceo';
  if (!roleAllows(role, f.action)) return { ok: false, message: 'Votre rôle de trader ne permet pas cette décision : demandez au PDG.' };
  const r = dispatch(s, f.action);
  refreshRivals(states);
  return r;
}

/** Empreinte de l'état (détection d'une désynchronisation entre navigateurs). */
export function checksum(states: GameState[]): string {
  let h = 0;
  const mix = (x: number) => { h = (Math.imul(h ^ Math.round(x * 100), 2654435761) >>> 0); };
  for (const s of states) {
    mix(s.day);
    mix(nav(s));
    mix(s.company.cash);
    mix(s.futures.length + s.forwards.length * 7 + s.inventory.length * 13);
  }
  const m = states[0]!.market;
  mix(m.commodities.BRENT.chi * 1e6);
  mix(m.commodities.CU.xi * 1e6);
  return h.toString(36);
}

/** Instantané sérialisable (rejoindre en cours de partie, resynchronisation). */
export function snapshot(states: GameState[]): string {
  const [master, ...rest] = states;
  const followers = rest.map((s) => ({ ...s, market: undefined, world: undefined, companies: undefined }));
  return JSON.stringify({ master, followers });
}

export function restore(json: string): GameState[] {
  const { master, followers } = JSON.parse(json) as { master: GameState; followers: GameState[] };
  const out = [master];
  for (const f of followers) {
    linkFollower(master, f);
    out.push(f);
  }
  return out;
}
