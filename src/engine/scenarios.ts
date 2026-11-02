/**
 * Phase 7 — Mise en place des scénarios et évaluation de leur objectif.
 * Les positions de départ sont ouvertes aux prix du jour (comme si le joueur les avait traitées la veille).
 */
import { SCENARIO_BY_ID } from '../data/scenarios';
import { COMMODITIES } from '../data/commodities';
import { listedMonths } from './contracts';
import { addCash, log, newId } from './ledger';
import { futuresPrice, fx } from './market';
import { applyFuturesFill } from './trading';
import type { GameState } from './types';
import { localSpot, nav } from './valuation';
import { schedule, applyImpact } from './world';
import { recomputeIm } from './margin';

export function applyScenario(state: GameState) {
  const sc = state.config.scenario ? SCENARIO_BY_ID[state.config.scenario] : undefined;
  if (!sc) return;
  const st = sc.start;
  for (const [c, v] of Object.entries(st.market?.chi ?? {})) state.market.commodities[c as keyof typeof COMMODITIES].chi += v ?? 0;
  for (const [c, v] of Object.entries(st.market?.iv ?? {})) state.market.ivLevel[c as keyof typeof COMMODITIES] += v ?? 0;
  if (st.market?.stressed) applyImpact(state, { k: 'regime' });
  for (const l of st.inventory ?? []) {
    // stock acquis avant le début : apporté au bilan à sa valeur de marché (le capital inclut sa contrepartie en cash)
    const px = localSpot(state, l.commodity, l.locationId);
    const spec = COMMODITIES[l.commodity];
    addCash(state, -l.qty * px * spec.valuePerUnit * fx(state.market, spec.currency), 'physical', l.commodity);
    state.inventory.push({ id: newId(state, 'i'), commodity: l.commodity, locationId: l.locationId, qty: l.qty, cost: px, sinceDay: state.day });
  }
  for (const f of st.futures ?? []) {
    const spec = COMMODITIES[f.commodity];
    const mi = listedMonths(spec, state.day)[1]!;
    applyFuturesFill(state, f.commodity, mi, f.lots, futuresPrice(state.market, f.commodity, mi));
  }
  // capital : l'apport en stock est financé par la RCF au-delà du cash disponible
  if (state.company.cash < 0) {
    state.company.rcfDrawn += -state.company.cash;
    state.company.cash = 0;
  }
  recomputeIm(state);
  for (const e of sc.events) schedule(state, e.inDays, e.impacts, e.news);
  state.lastNav = nav(state);
  state.company.initialCapital = state.lastNav;
  state.company.yearStartNav = state.lastNav;
  state.risk.monthStartNav = state.lastNav;
  state.stats.peakNav = state.lastNav;
  state.pendingAlerts.push({ kind: 'scenario', text: `${sc.icon} ${sc.name} (${sc.era}) — ${sc.intro}\n\nObjectif : ${sc.objective.desc}` });
  log(state, `Scénario : ${sc.name}`);
}

export interface ScenarioOutcome {
  won: boolean;
  progress: number;
  detail: string;
}

/** Objectif évalué à la fin de la partie (sans faillite) ; progression affichée en cours de route. */
export function scenarioOutcome(state: GameState): ScenarioOutcome {
  const sc = state.config.scenario ? SCENARIO_BY_ID[state.config.scenario] : undefined;
  if (!sc) return { won: false, progress: 0, detail: 'Pas de scénario.' };
  const mult = nav(state) / Math.max(1, state.company.initialCapital);
  const carryOk = !sc.objective.requireCarry || (state.stats?.carryWins ?? 0) > 0;
  const alive = state.status === 'running' || state.status === 'ended';
  const won = alive && state.status === 'ended' && mult >= sc.objective.navMultiple && carryOk;
  const p = alive ? Math.min(0.99, mult / sc.objective.navMultiple) : 0;
  return { won, progress: won ? 1 : p, detail: `${mult.toFixed(2)}× le capital (objectif ${sc.objective.navMultiple}×)${sc.objective.requireCarry ? `, portage ${carryOk ? 'réussi' : 'à réussir'}` : ''}` };
}
