/**
 * Phase 7 — Succès et objectifs de victoire.
 * Chaque succès est un prédicat sur l'état, évalué à la clôture. Les identifiants sont stables (sauvegardes,
 * collection persistante entre les parties côté interface).
 */
import { COMPANY_BY_ID } from './companies';
import { leaderboard, rivalOf } from '../engine/companies';
import { prestige } from '../engine/offices';
import { scenarioOutcome } from '../engine/scenarios';
import type { GameState, GoalId } from '../engine/types';
import { exposures, nav } from '../engine/valuation';
import { continentsCovered } from '../engine/staff';
import { listedFront } from '../engine/market';

export interface AchievementDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  check: (s: GameState) => boolean;
}

const profit = (s: GameState) => nav(s) - s.company.initialCapital;
const managing = (s: GameState) => !s.career || s.career.status === 'founder' || s.career.status === 'ceo';
const runningDays = (s: GameState) => s.history.length;

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_cargo', name: 'Première cargaison', icon: '🚢', desc: 'Conclure un premier deal physique.', check: (s) => s.forwards.length > 0 || s.inventory.length > 0 || s.stats.deals.length > 0 },
  { id: 'million', name: 'Le premier million', icon: '💵', desc: 'Gagner 1 M$ de fonds propres.', check: (s) => managing(s) && profit(s) >= 1e6 },
  { id: 'ten_million', name: 'Dix millions', icon: '💰', desc: 'Gagner 10 M$ de fonds propres.', check: (s) => managing(s) && profit(s) >= 10e6 },
  { id: 'hundred', name: 'Maison centenaire', icon: '🏦', desc: 'Atteindre 100 M$ de fonds propres.', check: (s) => managing(s) && nav(s) >= 100e6 },
  { id: 'margin_met', name: 'Sang-froid', icon: '🧊', desc: 'Couvrir un appel de marge sans être liquidé.', check: (s) => s.stats.marginCallsMet > 0 },
  { id: 'squeeze', name: 'Survivre à un squeeze', icon: '🌋', desc: 'Traverser une suspension de cotation avec une position ouverte.', check: (s) => s.stats.squeezesSurvived > 0 },
  { id: 'perfect_hedge', name: 'Un hedge parfait', icon: '⚖️', desc: 'Garder un physique couvert à ±10 % pendant 250 jours de bourse d’affilée.', check: (s) => s.stats.bestHedgedStreak >= 250 },
  { id: 'carry', name: 'Le portage paie', icon: '🛢️', desc: 'Vendre avec profit un stock détenu plus de 60 jours.', check: (s) => s.stats.carryWins > 0 },
  { id: 'exotic', name: 'Structuré gagnant', icon: '🧪', desc: 'Une option exotique arrivée à échéance avec un gain.', check: (s) => s.stats.exoticPnl.some((x) => x > 0) },
  { id: 'lc', name: 'Papiers en règle', icon: '📜', desc: 'Faire émettre une lettre de crédit.', check: (s) => s.stats.lcsIssued > 0 },
  { id: 'borrowing_base', name: 'Banquier du stock', icon: '🏧', desc: 'Financer un stock auprès d’une banque.', check: (s) => s.stats.lotsFinanced > 0 },
  { id: 'prepay', name: 'Préfinanceur', icon: '🤝', desc: 'Mener un préfinancement jusqu’à la dernière livraison.', check: (s) => s.stats.prepaysDone > 0 },
  { id: 'negotiator', name: 'Négociateur', icon: '🗣️', desc: 'Remporter 5 négociations.', check: (s) => s.stats.negotiationsWon >= 5 },
  { id: 'shipowner', name: 'Armateur', icon: '⚓', desc: 'Mener 10 voyages à destination.', check: (s) => s.stats.voyagesDone >= 10 },
  { id: 'industrial', name: 'Industriel', icon: '🏭', desc: 'Posséder 3 actifs industriels.', check: (s) => s.assets.length >= 3 },
  { id: 'tower', name: 'Une tour à son nom', icon: '🏙️', desc: 'Emménager dans une tour.', check: (s) => managing(s) && s.office.tier >= 2 },
  { id: 'campus', name: 'Campus', icon: '🌳', desc: 'Emménager dans un campus.', check: (s) => managing(s) && s.office.tier >= 3 },
  { id: 'prestige', name: 'Adresse prestigieuse', icon: '✨', desc: 'Atteindre 70 de prestige.', check: (s) => managing(s) && prestige(s) >= 70 },
  { id: 'clean', name: 'Irréprochable', icon: '🕊️', desc: 'Deux ans de partie sans aucun dossier de conformité.', check: (s) => runningDays(s) >= 500 && (s.compliance?.cases.length ?? 0) === 0 },
  { id: 'acquitted', name: 'Relaxé', icon: '⚖️', desc: 'Sortir blanchi d’une enquête.', check: (s) => s.stats.investigationsWon > 0 },
  { id: 'storm', name: 'Dans la tempête', icon: '⛈️', desc: '60 jours de marché en crise sans faire faillite.', check: (s) => s.stats.stressedDays >= 60 },
  { id: 'no_call', name: 'Trésorier modèle', icon: '🗓️', desc: 'Un an de futures ouverts sans un seul appel de marge.', check: (s) => runningDays(s) >= 250 && s.stats.marginCalls === 0 && s.futures.length > 0 },
  { id: 'rival', name: 'Rival dépassé', icon: '🥇', desc: 'Dépasser votre rival nominatif en fonds propres.', check: (s) => {
    const r = rivalOf(s);
    if (!r || !managing(s)) return false;
    const ai = s.companies.find((c) => c.id === r);
    return !!ai && nav(s) > ai.nav && s.history.length > 20;
  } },
  { id: 'ceo', name: 'De stagiaire à CEO', icon: '👑', desc: 'Prendre la direction de votre employeur.', check: (s) => s.career?.status === 'ceo' },
  { id: 'founder', name: 'Entrepreneur', icon: '🚀', desc: 'Fonder votre propre maison.', check: (s) => s.career?.status === 'founder' },
  { id: 'continents', name: 'Bureaux sur cinq continents', icon: '🌐', desc: 'Siège et bureaux répartis sur cinq continents.', check: (s) => managing(s) && continentsCovered(s) >= 5 },
  { id: 'team', name: 'Une vraie maison', icon: '👥', desc: 'Employer dix collaborateurs.', check: (s) => (s.staff?.employees.length ?? 0) >= 10 },
  { id: 'negative', name: 'Sous zéro', icon: '🕳️', desc: 'Traverser un prix négatif du WTI avec une position ouverte et gagner de l’argent ce jour-là.', check: (s) => {
    const h = s.history.at(-1);
    return !!h && h.pnl > 0 && listedFront(s.market, 'WTI') < 0 && exposures(s).some((e) => e.commodity === 'WTI' && Math.abs(e.netQty) > 0);
  } },
  { id: 'scenario', name: 'Histoire réécrite', icon: '📖', desc: 'Réussir un scénario historique.', check: (s) => !!s.config.scenario && scenarioOutcome(s).won },
];

export const ACHIEVEMENT_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

export interface GoalDef {
  id: GoalId;
  label: string;
  desc: string;
  progress: (s: GameState) => { p: number; detail: string };
}

const M = (x: number) => `${(x / 1e6).toFixed(1)} M$`;

export const GOALS: GoalDef[] = [
  { id: 'taille', label: 'Une grande maison', desc: 'Atteindre 250 M$ de fonds propres.', progress: (s) => managing(s) ? { p: nav(s) / 250e6, detail: `${M(nav(s))} / 250 M$` } : { p: 0, detail: 'Dirigez une société pour viser cet objectif.' } },
  { id: 'rendement', label: 'Rendement d’élite', desc: '25 % de rendement annualisé, sur au moins un an.', progress: (s) => {
    const years = (s.day - s.startDay) / 365.25;
    const ret = nav(s) / s.company.initialCapital;
    const ann = years > 0 && ret > 0 ? Math.pow(ret, 1 / Math.max(years, 0.25)) - 1 : -1;
    return { p: years < 1 ? Math.min(0.99, (ann / 0.25) * years) : ann / 0.25, detail: `${(ann * 100).toFixed(1)} % par an sur ${years.toFixed(1)} an(s)` };
  } },
  { id: 'fortune', label: 'Fortune personnelle', desc: '50 M$ de patrimoine personnel (salaire, bonus, parts de votre société).', progress: (s) => {
    const c = s.career;
    const w = c ? c.wealth + (c.status === 'founder' || c.status === 'ceo' ? (c.equity ?? 0) * Math.max(0, nav(s)) : 0) : nav(s) - s.company.initialCapital;
    return { p: w / 50e6, detail: `${M(w)} / 50 M$` };
  } },
  { id: 'reputation', label: 'Réputation', desc: 'Une réputation de 90 (carrière) ou un siège au prestige de 80 sans condamnation (société).', progress: (s) => {
    if (s.career && s.career.status !== 'founder' && s.career.status !== 'ceo') return { p: s.career.reputation / 90, detail: `${Math.round(s.career.reputation)} / 90` };
    const conv = (s.compliance?.investigations ?? []).filter((x) => x.outcome === 'condamnation').length;
    const v = prestige(s) - 20 * conv;
    return { p: v / 80, detail: `prestige ${Math.round(prestige(s))}${conv ? `, ${conv} condamnation(s)` : ''} / 80` };
  } },
  { id: 'domination', label: 'Parmi les grands', desc: 'Entrer dans le top 15 mondial des maisons de négoce.', progress: (s) => {
    const b = leaderboard(s).filter((r) => r.id === 'player' || COMPANY_BY_ID[r.id]?.kind !== 'bank');
    const i = b.findIndex((r) => r.id === 'player');
    if (i < 0) return { p: 0, detail: 'Dirigez une société pour viser cet objectif.' };
    const target = b[Math.min(14, b.length - 1)]!;
    return { p: i < 15 ? 1 : nav(s) / Math.max(1, target.nav), detail: `rang ${i + 1} (15ᵉ : ${M(target.nav)})` };
  } },
  { id: 'survie', label: 'Survivre', desc: 'Terminer la partie sans faillite ni condamnation.', progress: (s) => {
    const conv = (s.compliance?.investigations ?? []).some((x) => x.outcome === 'condamnation');
    const t = (s.day - s.startDay) / Math.max(1, s.endDay - s.startDay);
    const alive = s.status === 'running' || s.status === 'ended';
    return { p: !alive || conv ? 0 : s.status === 'ended' ? 1 : Math.min(0.99, t), detail: conv ? 'condamnation : objectif manqué' : `${Math.round(t * 100)} % de la partie` };
  } },
  { id: 'scenario', label: 'Objectif du scénario', desc: 'Réussir l’objectif propre au scénario.', progress: (s) => {
    const o = scenarioOutcome(s);
    return { p: o.won ? 1 : o.progress, detail: o.detail };
  } },
];
