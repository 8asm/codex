/**
 * Automatisation des fonctions répétitives (le joueur garde la main sur ce qui l'amuse) :
 *  - roll automatique des futures 2 jours ouvrés avant leur dernier jour de cotation ;
 *  - couverture de base : maintenir la couverture du physique (stocks, cargaisons, forwards) à un ratio cible
 *    avec des futures, dès que l'écart dépasse un seuil ;
 *  - logistique : affréter automatiquement les navires pour honorer les ventes livrables à destination ;
 *  - vente automatique de la production des actifs ; assurance marine des cargaisons.
 * Les règles sont simples et volontairement imparfaites (couverture sur le front : risque de base et de calendrier).
 */
import { COMMODITIES } from '../data/commodities';
import { addBusinessDays, businessDaysBetween, monthLabel } from './calendar';
import { lastTradingDay, listedMonths, lotQty } from './contracts';
import { log } from './ledger';
import { shipCargo, shipQuote } from './logistics';
import { isHalted } from './market';
import { tradeFuture } from './trading';
import type { Automation, GameState } from './types';
import { exposures } from './valuation';

export const DEFAULT_AUTOMATION: Automation = {
  autoRoll: false,
  autoHedge: { on: false, ratio: 1, threshold: 0.15 },
  autoSellProduction: true,
  autoLogistics: false,
  marineInsurance: true,
};

export function runAutomation(state: GameState): string[] {
  const msgs: string[] = [];
  const au = state.automation;
  if (au.autoRoll) {
    for (const p of [...state.futures]) {
      const spec = COMMODITIES[p.commodity];
      const ltd = lastTradingDay(spec, p.month);
      if (businessDaysBetween(state.day, ltd) > 2 || isHalted(state.market, p.commodity)) continue;
      const months = listedMonths(spec, state.day);
      const next = months[months.indexOf(p.month) + 1];
      if (next === undefined) continue;
      const lots = p.lots;
      if (tradeFuture(state, p.commodity, p.month, -lots).ok && tradeFuture(state, p.commodity, next, lots).ok) {
        state.company.tradesThisMonth += 2;
        msgs.push(`Roll automatique : ${lots} lots ${spec.short} ${monthLabel(p.month)} → ${monthLabel(next)}.`);
      }
    }
  }
  if (au.autoHedge.on) {
    for (const e of exposures(state)) {
      const physical = e.forwardQty + e.inventoryQty + e.transitQty;
      if (Math.abs(physical) < 1e-6 || isHalted(state.market, e.commodity)) continue;
      const spec = COMMODITIES[e.commodity];
      const target = -au.autoHedge.ratio * physical;
      const current = e.futuresQty + e.otcQty;
      const diff = target - current;
      if (Math.abs(diff) <= au.autoHedge.threshold * Math.abs(physical)) continue;
      const mi = listedMonths(spec, state.day)[1] ?? listedMonths(spec, state.day)[0]!;
      const lots = Math.round(diff / lotQty(spec, mi));
      if (lots !== 0 && tradeFuture(state, e.commodity, mi, lots).ok) {
        state.company.tradesThisMonth++;
        msgs.push(`Couverture automatique ${spec.short} : ${lots > 0 ? '+' : ''}${lots} lots ${monthLabel(mi)} (cible ${Math.round(au.autoHedge.ratio * 100)} %).`);
      }
    }
  }
  if (au.autoLogistics) msgs.push(...autoShip(state));
  for (const m of msgs) log(state, m);
  return msgs;
}

/** Pour chaque vente livrable à destination, achemine à temps le stock disponible ailleurs (au moindre coût). */
function autoShip(state: GameState): string[] {
  const msgs: string[] = [];
  for (const d of state.forwards.filter((x) => x.side < 0)) {
    const here = state.inventory.filter((l) => l.commodity === d.commodity && l.locationId === d.locationId).reduce((s, l) => s + l.qty, 0);
    const coming = state.voyages.filter((v) => v.commodity === d.commodity && v.to === d.locationId && v.arriveDay <= d.deliveryDay).reduce((s, v) => s + v.qty, 0);
    let missing = d.qty - here - coming;
    if (missing <= 0) continue;
    const candidates = state.inventory
      .filter((l) => l.commodity === d.commodity && l.locationId !== d.locationId)
      .map((l) => ({ l, q: shipQuote(state, l.commodity, l.locationId, d.locationId, Math.min(l.qty, missing)) }))
      .filter((x) => x.q.ok && x.q.arriveDay <= d.deliveryDay && addBusinessDays(state.day, 25) >= d.deliveryDay - x.q.days)
      .sort((a, b) => a.q.perUnit - b.q.perUnit);
    for (const { l, q } of candidates) {
      if (missing <= 0) break;
      const qty = Math.min(l.qty, missing);
      // on n'expédie qu'au dernier moment raisonnable (pour ne pas immobiliser le stock trop tôt)
      if (d.deliveryDay - (state.day + q.days) > 5) continue;
      const r = shipCargo(state, l.id, d.locationId, qty);
      if (r.ok) {
        missing -= qty;
        msgs.push(`Logistique automatique : ${COMMODITIES[d.commodity].short} expédié pour honorer la vente du ${d.deliveryDay}.`);
      }
    }
  }
  return msgs;
}

