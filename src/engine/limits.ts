/**
 * Limites de risque et leurs conséquences.
 *
 *  - Covenant bancaire : VaR 99 % 1 jour ≤ 8 % des fonds propres. Dépassement : avertissement (J1),
 *    gel de la RCF et marge +1 % (J3), ligne divisée par deux (J7). Tout revient à la normale quand la VaR repasse sous la limite.
 *  - Limites internes fixées par le joueur (VaR, stop-loss mensuel, delta par commodité). En « discipline stricte »,
 *    tout ordre qui augmente un risque déjà hors limite est refusé (et annulé).
 *  - Limites de position des bourses : voir trading.ts.
 */
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { addNews } from './news';
import { computeVar } from './risk';
import type { ActionResult, CommodityId, GameState, InternalLimits } from './types';
import { exposures, nav } from './valuation';

export const COVENANT_VAR_PCT = 0.08;
export const DEFAULT_LIMITS: InternalLimits = { varPctNav: 0.05, stopLossPctNav: 0.1, deltaPctNav: 0.02, strict: false };

/** Évaluation de fin de journée (après calcul de la VaR). */
export function evaluateLimits(state: GameState, navValue: number) {
  const r = state.risk;
  const lim = r.limits;
  const breaches: string[] = [];
  const covenant = COVENANT_VAR_PCT * Math.max(0, navValue);
  if (r.var99 > covenant && navValue > 0) {
    r.covenantBreachDays++;
    if (r.covenantBreachDays === 1) {
      state.pendingAlerts.push({ kind: 'limit', text: `Covenant bancaire dépassé : VaR ${(r.var99 / 1e6).toFixed(2)} M$ > ${(covenant / 1e6).toFixed(2)} M$ (8 % des fonds propres). La banque vous surveille.` });
    } else if (r.covenantBreachDays === 3) {
      r.rcfFrozen = true;
      r.rcfPenalty = 0.01;
      state.pendingAlerts.push({ kind: 'limit', text: 'Covenant toujours violé : la banque GÈLE votre ligne de crédit et relève sa marge de 1 %.' });
      addNews(state, { headline: `${state.company.name} : sa banque gèle sa ligne de crédit`, tone: 'alert', major: false });
    } else if (r.covenantBreachDays === 7) {
      state.pendingAlerts.push({ kind: 'limit', text: 'Une semaine de violation : la banque divise votre ligne de crédit par deux.' });
    }
    breaches.push('covenant');
  } else if (r.covenantBreachDays > 0) {
    r.covenantBreachDays = 0;
    r.rcfFrozen = false;
    r.rcfPenalty = 0;
    state.pendingAlerts.push({ kind: 'limit_ok', text: 'VaR revenue sous le covenant : la banque rétablit votre ligne.' });
  }
  if (r.var99 > lim.varPctNav * navValue) breaches.push('var');
  if (navValue - r.monthStartNav < -lim.stopLossPctNav * r.monthStartNav) breaches.push('stoploss');
  for (const e of exposures(state)) if (Math.abs(e.delta1pct) > lim.deltaPctNav * navValue) breaches.push(`delta:${e.commodity}`);
  r.breaches = breaches;
}

function snapshot(state: GameState) {
  return JSON.stringify({
    futures: state.futures, options: state.options, otc: state.otc, forwards: state.forwards, inventory: state.inventory,
    offers: state.offers, company: state.company, impact: state.market.impact, nextId: state.nextId, logLen: state.log.length,
  });
}

function restore(state: GameState, snap: string) {
  const s = JSON.parse(snap);
  state.futures = s.futures; state.options = s.options; state.otc = s.otc; state.forwards = s.forwards;
  state.inventory = s.inventory; state.offers = s.offers; state.company = s.company; state.market.impact = s.impact;
  state.nextId = s.nextId; state.log.length = s.logLen;
}

function deltaBy(state: GameState): Record<CommodityId, number> {
  return Object.fromEntries(exposures(state).map((e) => [e.commodity, e.delta1pct])) as Record<CommodityId, number>;
}

/**
 * Exécute une action qui prend du risque sous contrôle des limites internes en discipline stricte :
 * si, après l'ordre, une limite est dépassée ET le risque a augmenté, l'ordre est annulé.
 */
export function guarded(state: GameState, run: () => ActionResult): ActionResult {
  const lim = state.risk.limits;
  if (!lim.strict) return run();
  const navV = nav(state);
  const var0 = computeVar(state).var99;
  const d0 = deltaBy(state);
  const snap = snapshot(state);
  const res = run();
  if (!res.ok) return res;
  const var1 = computeVar(state).var99;
  const d1 = deltaBy(state);
  let why: string | null = null;
  if (state.risk.breaches.includes('stoploss') && var1 > var0 + 1) why = 'stop-loss mensuel atteint : seules les réductions de risque sont autorisées';
  else if (var1 > lim.varPctNav * navV && var1 > var0 + 1) why = `VaR ${(var1 / 1e6).toFixed(2)} M$ au-delà de la limite interne (${(lim.varPctNav * 100).toFixed(1)} % des fonds propres)`;
  else {
    for (const c of COMMODITY_IDS) {
      if (Math.abs(d1[c]) > lim.deltaPctNav * navV && Math.abs(d1[c]) > Math.abs(d0[c]) + 1) {
        why = `delta ${COMMODITIES[c].short} au-delà de la limite (${(lim.deltaPctNav * 100).toFixed(1)} % des fonds propres pour 1 %)`;
        break;
      }
    }
  }
  if (why) {
    restore(state, snap);
    return { ok: false, message: `Discipline stricte : ordre refusé — ${why}.` };
  }
  return res;
}
