/**
 * PNJ : générés de façon procédurale par la graine. Chacun a un rôle, un employeur, une confiance envers le
 * joueur (−100..100), un caractère (honnêteté, ambition), un intérêt propre et une MÉMOIRE des interactions.
 * La confiance ouvre des portes (deals, entretiens, informations) ; la défiance les ferme ou se retourne
 * contre le joueur (fuites, mauvaises références, dénonciations).
 */
import { CITIES } from '../data/cities';
import { FIRST_NAMES, LAST_NAMES } from '../data/career';
import { COMPANIES, COMPANY_BY_ID } from '../data/companies';
import { newId } from './ledger';
import { pick, uniform } from './rng';
import type { GameState, Npc, NpcRole } from './types';

const INTERESTS: Record<NpcRole, string[]> = {
  manager: ['des résultats réguliers sans mauvaise surprise', 'briller auprès de la direction', 'protéger son équipe'],
  collègue: ['une promotion avant vous', 'un coup de main sur ses dossiers', 'la reconnaissance de son travail'],
  risk: ['des limites respectées', 'zéro incident'],
  conformité: ['aucun dossier pénal', 'des contreparties propres'],
  client: ['des prix serrés et une livraison fiable', 'de la flexibilité sur les volumes', 'un partenaire de long terme'],
  banquier: ['des emprunteurs solvables', 'des commissions de trade finance'],
  chasseur: ['placer des talents', 'une commission sur votre prochain salaire'],
  journaliste: ['un scoop', 'des sources fiables'],
  officiel: ['des investissements dans son pays', 'un « geste » personnel'],
  investisseur: ['un rendement de 15 % par an', 'une gouvernance rassurante'],
  mentor: ['transmettre son savoir', 'voir réussir ses protégés'],
};

function makeName(state: GameState): string {
  const used = new Set(state.npcs.map((n) => n.name));
  for (let i = 0; i < 50; i++) {
    const n = `${pick(state.rng, FIRST_NAMES)} ${pick(state.rng, LAST_NAMES)}`;
    if (!used.has(n)) return n;
  }
  return `${pick(state.rng, FIRST_NAMES)} ${pick(state.rng, LAST_NAMES)} ${state.nextId}`;
}

export function createNpc(state: GameState, role: NpcRole, companyId: string | null, cityId: string, trust = 0): Npc {
  const npc: Npc = {
    id: newId(state, 'p'), name: makeName(state), role, companyId, cityId, trust,
    honesty: Math.round(uniform(state.rng) * 100) / 100, ambition: Math.round(uniform(state.rng) * 100) / 100,
    interest: pick(state.rng, INTERESTS[role]), memory: [], knows: [],
  };
  state.npcs.push(npc);
  return npc;
}

/** Monde relationnel de départ : contacts chez chaque contrepartie, banquiers, chasseurs, presse, officiels, investisseurs. */
export function seedNpcs(state: GameState) {
  for (const c of COMPANIES) {
    if (c.kind === 'bank') createNpc(state, 'banquier', c.id, c.cityId, 0);
    else createNpc(state, 'client', c.id, c.cityId, Math.round((uniform(state.rng) - 0.5) * 20));
  }
  for (let i = 0; i < 2; i++) createNpc(state, 'chasseur', null, pick(state.rng, ['london', 'geneva', 'singapore']), 0);
  for (let i = 0; i < 2; i++) createNpc(state, 'journaliste', null, pick(state.rng, ['london', 'geneva', 'singapore']), 0);
  for (const city of ['dubai', 'johannesburg', 'santiago', 'shanghai']) createNpc(state, 'officiel', null, city, 0);
  for (let i = 0; i < 3; i++) createNpc(state, 'investisseur', null, pick(state.rng, CITIES).id, 0);
}

/** Équipe interne autour du joueur chez son employeur : manager, collègues, risk manager, conformité, mentor. */
export function seedColleagues(state: GameState, companyId: string) {
  const city = COMPANY_BY_ID[companyId]!.cityId;
  state.npcs = state.npcs.filter((n) => !['manager', 'collègue', 'risk', 'conformité', 'mentor'].includes(n.role) || n.companyId !== companyId);
  createNpc(state, 'manager', companyId, city, 10);
  createNpc(state, 'collègue', companyId, city, 5);
  createNpc(state, 'collègue', companyId, city, 0);
  createNpc(state, 'risk', companyId, city, 0);
  createNpc(state, 'conformité', companyId, city, 0);
  createNpc(state, 'mentor', companyId, city, 15);
}

export function npc(state: GameState, id: string | undefined): Npc | undefined {
  return id ? state.npcs.find((n) => n.id === id) : undefined;
}

/** Fait évoluer la confiance d'un PNJ et l'inscrit dans sa mémoire. */
export function remember(state: GameState, id: string | undefined, delta: number, text: string) {
  const n = npc(state, id);
  if (!n) return;
  n.trust = Math.max(-100, Math.min(100, n.trust + delta));
  n.memory.unshift({ day: state.day, delta, text });
  if (n.memory.length > 12) n.memory.length = 12;
}

export function findRole(state: GameState, role: NpcRole, companyId?: string | null): Npc | undefined {
  return state.npcs.find((n) => n.role === role && (companyId === undefined || n.companyId === companyId));
}

export function npcsOf(state: GameState, role: NpcRole): Npc[] {
  return state.npcs.filter((n) => n.role === role);
}

/** Contact du joueur chez une société (client, banquier). */
export function contactAt(state: GameState, companyId: string): Npc | undefined {
  return state.npcs.find((n) => n.companyId === companyId && (n.role === 'client' || n.role === 'banquier'));
}

/** Les relations s'érodent lentement vers la neutralité (on oublie… un peu). */
export function decayRelations(state: GameState) {
  for (const n of state.npcs) n.trust *= 0.999;
}

export function relationLabel(trust: number): string {
  if (trust >= 60) return 'allié';
  if (trust >= 25) return 'confiance';
  if (trust > -25) return 'neutre';
  if (trust > -60) return 'méfiant';
  return 'hostile';
}
