/**
 * Phase 11 — Complexité progressive (option de création de partie).
 * Les panneaux n'apparaissent qu'au moment où le joueur en a besoin : un déclencheur lié à son activité (première
 * position, premier stock, premier dossier de conformité…) ou, à défaut, l'ancienneté de la partie. Chaque
 * déblocage est annoncé avec une phrase d'explication et la leçon qui va avec. Le moteur, lui, ne change pas :
 * tout est simulé dès le premier jour, seule la présentation est progressive.
 */
import type { GameState } from './types';

export interface Unlock {
  panel: string;
  label: string;
  /** pourquoi maintenant, en une phrase */
  why: string;
  /** leçon conseillée à cet instant */
  lesson?: string;
  when: (s: GameState) => boolean;
}

const days = (s: GameState) => s.history.length;
const deals = (s: GameState) => s.stats?.deals.length ?? 0;

/** Panneaux visibles d'emblée. */
export const BASE_PANELS = ['market', 'physical', 'book', 'news', 'lessons', 'game', 'codex', 'career'];

export const UNLOCKS: Unlock[] = [
  { panel: 'travel', label: 'Voyages', why: 'Négocier sur place améliore les conditions d’environ 0,4 % : un voyage se rentabilise vite.', lesson: 'travel', when: (s) => deals(s) > 0 || s.forwards.length > 0 || days(s) > 15 },
  { panel: 'risk', label: 'Risque', why: 'Vous avez des positions : la VaR et les limites mesurent ce que vous pouvez perdre demain.', lesson: 'var', when: (s) => s.futures.length > 0 || s.forwards.length > 1 || days(s) > 40 },
  { panel: 'treasury', label: 'Trésorerie', why: 'Une cargaison se paie à la livraison et les futures appellent de la marge : surveillez votre cash.', lesson: 'margin', when: (s) => s.inventory.length > 0 || s.company.im > 0.2 * s.company.cash || days(s) > 30 },
  { panel: 'automation', label: 'Automatisation', why: 'Plusieurs contrats en cours : le roll, la couverture et la logistique peuvent tourner seuls.', lesson: 'strip', when: (s) => s.forwards.length >= 2 || days(s) > 50 },
  { panel: 'logistics', label: 'Fret', why: 'Votre stock et vos ventes ne sont pas au même endroit : il faut affréter un navire.', lesson: 'shipping', when: (s) => s.inventory.some((l) => s.forwards.some((d) => d.side < 0 && d.commodity === l.commodity && d.locationId !== l.locationId)) || s.voyages.length > 0 || days(s) > 70 },
  { panel: 'finance', label: 'Financement', why: 'Votre stock immobilise du cash : une banque peut le financer, et une lettre de crédit sécurise vos paiements.', lesson: 'financing', when: (s) => s.inventory.length > 0 && days(s) > 10 || days(s) > 80 },
  { panel: 'options', label: 'Options', why: 'Les options assurent un prix plancher ou plafond sans renoncer à la hausse.', lesson: 'options', when: (s) => deals(s) >= 3 || days(s) > 60 },
  { panel: 'world', label: 'Monde', why: 'Sanctions, tensions et météo déplacent les prix : le monde mérite un œil.', lesson: 'geopolitics', when: (s) => s.world.sanctions.length > 0 || days(s) > 35 },
  { panel: 'rivals', label: 'Rivaux', why: 'Les autres maisons raflent les bonnes affaires : connaissez-les.', when: (s) => days(s) > 45 },
  { panel: 'government', label: 'Gouvernements', why: 'Licences, appels d’offres publics, régimes fiscaux : les États sont des partenaires… exigeants.', lesson: 'government', when: (s) => days(s) > 90 || s.company.physVolumeYtd > 100e6 },
  { panel: 'offices', label: 'Bureaux', why: 'Votre maison grandit : un siège plus prestigieux attire talents et clients.', lesson: 'office', when: (s) => s.lastNav > 1.08 * s.company.initialCapital || days(s) > 120 },
  { panel: 'staff', label: 'Équipes', why: 'Recruter des traders, des juristes, des affréteurs : déléguer pour grandir.', lesson: 'desk', when: (s) => s.lastNav > 1.12 * s.company.initialCapital || days(s) > 150 },
  { panel: 'assets', label: 'Actifs', why: 'Posséder des cuves, des navires ou une raffinerie change la nature de votre maison.', lesson: 'assets', when: (s) => s.lastNav > 1.2 * s.company.initialCapital || days(s) > 180 },
  { panel: 'compliance', label: 'Conformité', why: 'Un dossier de conformité est ouvert, ou le devient bientôt : KYC, sanctions, abus de marché.', lesson: 'compliance', when: (s) => (s.compliance?.cases.length ?? 0) > 0 || days(s) > 110 },
  { panel: 'exotics', label: 'Structurés', why: 'Barrières, spreads, asiatiques : des produits sur mesure pour vos clients.', lesson: 'exotics', when: (s) => s.options.length > 0 && days(s) > 90 || days(s) > 220 },
];

export function progressive(s: GameState): boolean {
  return !!s.config.progressive && !s.career;
}

export function isUnlocked(s: GameState, panel: string): boolean {
  if (!progressive(s)) return true;
  return BASE_PANELS.includes(panel) || (s.unlocked ?? []).includes(panel);
}

/** Évalue les déclencheurs (à chaque clôture) et annonce les nouveaux panneaux. */
export function stepProgression(s: GameState) {
  if (!progressive(s)) return;
  const u = (s.unlocked ??= []);
  for (const x of UNLOCKS) {
    if (u.includes(x.panel)) continue;
    let ok = false;
    try { ok = x.when(s); } catch { ok = false; }
    if (!ok) continue;
    u.push(x.panel);
    s.pendingAlerts.push({ kind: 'achievement', text: `🔓 Nouveau panneau : ${x.label}. ${x.why}${x.lesson ? ' Une leçon 🎓 vous guide.' : ''}` });
    s.stats?.timeline?.push({ day: s.day, text: `Panneau débloqué : ${x.label}` });
  }
}

/** Débloque tout (bouton « tout afficher » des paramètres de partie). */
export function unlockAll(s: GameState) {
  s.unlocked = UNLOCKS.map((x) => x.panel);
}
