/**
 * Phase 7 — Progression : statistiques de partie, succès, objectifs de victoire, récapitulatif de fin.
 * Tout est dérivé de l'état (aucun effet sur la simulation financière).
 */
import { ACHIEVEMENTS, GOALS } from '../data/achievements';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { formatDay, type Day } from './calendar';
import { leaderboard } from './companies';
import type { CommodityId, GameState, GameStats, GoalId } from './types';
import { exposures, nav, valueByCommodity } from './valuation';
import { fx, spotPrice } from './market';

export function defaultStats(nav0: number): GameStats {
  return {
    exoticPnl: [], marginCalls: 0, marginCallsMet: 0, lastMarginCallDay: -1e9, carryWins: 0, negotiationsWon: 0, voyagesDone: 0,
    lcsIssued: 0, lotsFinanced: 0, prepaysDone: 0, investigationsWon: 0, hedgedStreak: 0, bestHedgedStreak: 0, stressedDays: 0,
    haltWatch: null, squeezesSurvived: 0, peakNav: nav0, maxDrawdown: 0, timeline: [], deals: [],
  };
}

/** Enregistre une opération dénouée (récapitulatif). */
export function recordDeal(state: GameState, label: string, pnl: number) {
  const s = state.stats;
  if (!s) return;
  s.deals.push({ day: state.day, label, pnl });
  if (s.deals.length > 400) {
    // on garde les extrêmes : ils font le récapitulatif
    s.deals.sort((a, b) => b.pnl - a.pnl);
    s.deals = [...s.deals.slice(0, 150), ...s.deals.slice(-150)];
  }
}

/**
 * Mise à jour quotidienne (après la clôture) : couverture, crises, suspensions de cotation survécues,
 * drawdown, appels de marge. Puis vérification des succès et de l'objectif.
 */
export function stepProgress(state: GameState, marginCallBefore: boolean) {
  const s = state.stats;
  const v = nav(state);
  s.peakNav = Math.max(s.peakNav, v);
  if (s.peakNav > 0) s.maxDrawdown = Math.max(s.maxDrawdown, 1 - v / s.peakNav);
  // appels de marge : nouveau / couvert
  const mc = !!state.company.marginCall;
  if (mc && !marginCallBefore) {
    s.marginCalls++;
    s.lastMarginCallDay = state.day;
  }
  if (!mc && marginCallBefore && state.status === 'running') s.marginCallsMet++;
  // couverture : du physique (stock, forwards, transit) et un delta net ≤ 10 % du brut physique
  const ex = exposures(state);
  let phys = 0, net = 0, hasPhys = false;
  for (const e of ex) {
    const spec = COMMODITIES[e.commodity];
    const pq = e.forwardQty + e.inventoryQty + e.transitQty;
    if (Math.abs(pq) < 1e-9) continue;
    hasPhys = true;
    phys += Math.abs(pq) * spotPrice(state.market, e.commodity) * spec.valuePerUnit * fx(state.market, spec.currency) * 0.01;
    net += Math.abs(e.delta1pct);
  }
  if (hasPhys && phys > 0 && net <= 0.1 * phys) {
    s.hedgedStreak++;
    s.bestHedgedStreak = Math.max(s.bestHedgedStreak, s.hedgedStreak);
  } else if (hasPhys) s.hedgedStreak = 0;
  if (state.market.volRegime === 'stressed') s.stressedDays++;
  // squeeze / suspension de cotation traversée avec une position ouverte
  for (const c of COMMODITY_IDS) {
    const halted = (state.market.halted[c] ?? -1) >= state.day;
    if (halted && !s.haltWatch) {
      const e = ex.find((x) => x.commodity === c)!;
      if (Math.abs(e.netQty) > 0 || state.futures.some((p) => p.commodity === c)) s.haltWatch = { c, until: (state.market.halted[c] ?? state.day) + 14 };
    }
  }
  if (s.haltWatch && state.day >= s.haltWatch.until) {
    if (state.status === 'running') {
      s.squeezesSurvived++;
      s.timeline.push({ day: state.day, text: `Suspension de cotation du ${COMMODITIES[s.haltWatch.c].short} traversée sans sombrer` });
    }
    s.haltWatch = null;
  }
  checkAchievements(state);
  checkGoal(state);
}

export function hasAchievement(state: GameState, id: string) {
  return (state.achievements ?? []).some((a) => a.id === id);
}

export function checkAchievements(state: GameState) {
  if (state.stats?.cheats?.length) return; // partie avec codes de triche : pas de succès
  for (const a of ACHIEVEMENTS) {
    if (hasAchievement(state, a.id)) continue;
    let ok = false;
    try {
      ok = a.check(state);
    } catch {
      ok = false;
    }
    if (ok) {
      state.achievements.push({ id: a.id, day: state.day });
      state.pendingAlerts.push({ kind: 'achievement', text: `${a.icon} Succès débloqué : ${a.name}` });
      state.stats.timeline.push({ day: state.day, text: `Succès : ${a.name}` });
    }
  }
}

// ------------------------------------------------------------------ objectifs de victoire

export interface GoalProgress {
  id: GoalId;
  label: string;
  desc: string;
  progress: number; // 0..1
  done: boolean;
  detail: string;
}

export function goalProgress(state: GameState, id: GoalId = state.config.goal ?? 'taille'): GoalProgress {
  const g = GOALS.find((x) => x.id === id) ?? GOALS[0]!;
  const r = g.progress(state);
  return { id: g.id, label: g.label, desc: g.desc, progress: Math.max(0, Math.min(1, r.p)), done: r.p >= 1, detail: r.detail };
}

function checkGoal(state: GameState) {
  if (!state.config.goal || hasAchievement(state, `goal.${state.config.goal}`)) return;
  const g = goalProgress(state);
  if (g.done && g.id !== 'survie' && g.id !== 'scenario') {
    state.achievements.push({ id: `goal.${g.id}`, day: state.day });
    state.pendingAlerts.push({ kind: 'achievement', text: `🏆 Victoire : ${g.label} ! Vous pouvez continuer la partie.` });
    state.stats.timeline.push({ day: state.day, text: `Objectif atteint : ${g.label}` });
  }
}

/** À la fin de partie : objectifs évalués à l'arrivée (survie, scénario). */
export function finalGoal(state: GameState): GoalProgress {
  return goalProgress(state);
}

// ------------------------------------------------------------------ récapitulatif

export interface Recap {
  title: string;
  verdict: string;
  startNav: number;
  endNav: number;
  ret: number;
  annualized: number;
  years: number;
  maxDrawdown: number;
  marginCalls: number;
  best: { day: Day; label: string; pnl: number }[];
  worst: { day: Day; label: string; pnl: number }[];
  bestDays: { day: string; pnl: number }[];
  worstDays: { day: string; pnl: number }[];
  byCommodity: { c: CommodityId; pnl: number }[];
  timeline: { day: string; text: string }[];
  achievements: number;
  fines: number;
  rank: number | null;
  skills: { name: string; value: number }[];
  riskErrors: string[];
  goal: GoalProgress;
}

export function buildRecap(state: GameState): Recap {
  const s = state.stats;
  const start = state.company.initialCapital;
  const end = nav(state);
  const years = Math.max(1 / 12, (state.day - state.startDay) / 365.25);
  const ret = start > 0 ? end / start - 1 : 0;
  const deals = [...s.deals].sort((a, b) => b.pnl - a.pnl);
  const days = [...state.history].sort((a, b) => b.pnl - a.pnl);
  const vb = valueByCommodity(state);
  const board = leaderboard(state);
  const rank = board.findIndex((r) => r.id === 'player');
  const riskErrors: string[] = [];
  if (s.marginCalls) riskErrors.push(`${s.marginCalls} appel(s) de marge, dont ${s.marginCallsMet} couvert(s)`);
  if (s.maxDrawdown > 0.25) riskErrors.push(`Perte maximale depuis un sommet de ${(s.maxDrawdown * 100).toFixed(0)} % : la taille des positions était excessive`);
  if (state.compliance?.fines) riskErrors.push(`${(state.compliance.fines / 1e6).toFixed(2)} M$ d’amendes`);
  const lossDeals = s.deals.filter((d) => d.pnl < 0).length;
  if (lossDeals > s.deals.length / 2 && s.deals.length > 6) riskErrors.push('Plus de la moitié des opérations dénouées perdantes');
  const status = state.status;
  const verdict =
    status === 'bankrupt' ? 'Faillite. Le marché ne pardonne pas le manque de liquidité.' :
    status === 'prison' ? 'La partie se termine derrière les barreaux.' :
    status === 'banned' ? 'Interdit d’exercer : les raccourcis ont fini par coûter tout.' :
    ret > 1 ? 'Une maison de négoce qui compte. Les concurrents vous connaissent.' :
    ret > 0.2 ? 'Une partie solide : rentable, et vivant.' :
    ret > 0 ? 'Rentable, de justesse. Le risque était-il rémunéré ?' : 'Le capital a fondu. Revoyez la couverture et la taille des positions.';
  return {
    title: state.company.name,
    verdict,
    startNav: start,
    endNav: end,
    ret,
    // pas d'annualisation sur moins d'un an (un mois chanceux ferait des milliers de %)
    annualized: years < 1 ? ret : Math.pow(Math.max(1e-9, 1 + ret), 1 / years) - 1,
    years,
    maxDrawdown: s.maxDrawdown,
    marginCalls: s.marginCalls,
    best: deals.filter((d) => d.pnl > 0).slice(0, 3),
    worst: deals.filter((d) => d.pnl < 0).slice(-3).reverse(),
    bestDays: days.slice(0, 3).filter((d) => d.pnl > 0).map((d) => ({ day: formatDay(d.day), pnl: d.pnl })),
    worstDays: days.slice(-3).reverse().filter((d) => d.pnl < 0).map((d) => ({ day: formatDay(d.day), pnl: d.pnl })),
    byCommodity: COMMODITY_IDS.map((c) => ({ c, pnl: vb[c] })).sort((a, b) => b.pnl - a.pnl),
    timeline: s.timeline.slice(-14).map((t) => ({ day: formatDay(t.day), text: t.text })),
    achievements: state.achievements.length,
    fines: state.compliance?.fines ?? 0,
    rank: rank >= 0 ? rank + 1 : null,
    skills: state.career ? Object.entries(state.career.skills).map(([name, value]) => ({ name, value: Math.round(value) })) : [],
    riskErrors,
    goal: goalProgress(state),
  };
}
