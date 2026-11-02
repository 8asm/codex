/**
 * Automatisation des fonctions répétitives (le joueur garde la main sur ce qui l'amuse) :
 *  - roll automatique des futures 2 jours ouvrés avant leur dernier jour de cotation ;
 *  - couverture de base : maintenir la couverture du physique (stocks, cargaisons, forwards) à un ratio cible
 *    avec des futures, dès que l'écart dépasse un seuil ;
 *  - logistique : affréter automatiquement les navires pour honorer les ventes livrables à destination ;
 *  - vente automatique de la production des actifs ; assurance marine des cargaisons.
 * Les règles sont simples et volontairement imparfaites (une seule échéance par matière : risque de base et de calendrier résiduel).
 */
import { COMMODITIES } from '../data/commodities';
import { addBusinessDays, businessDaysBetween, monthLabel } from './calendar';
import { lastTradingDay, listedMonths, lotQty, pricingDay } from './contracts';
import { log } from './ledger';
import { shipCargo, shipQuote } from './logistics';
import { isHalted } from './market';
import { tradeFuture } from './trading';
import type { Automation, CommodityId, GameState } from './types';
import type { MonthIndex } from './calendar';
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
    const hedged = (au.hedged ??= {});
    for (const e of exposures(state)) {
      const physical = e.forwardQty + e.inventoryQty + e.transitQty;
      // la part « automatique » ne peut excéder la position futures réellement ouverte (expiration, débouclage manuel)
      let own = hedged[e.commodity] ?? 0;
      const spec0 = COMMODITIES[e.commodity];
      const sameSide = state.futures.filter((p) => p.commodity === e.commodity && p.lots * own > 0).reduce((a, p) => a + p.lots * lotQty(spec0, p.month), 0);
      if (Math.abs(own) > Math.abs(sameSide)) own = sameSide;
      hedged[e.commodity] = own;
      if (isHalted(state.market, e.commodity)) continue;
      const spec = COMMODITIES[e.commodity];
      let diff: number;
      if (Math.abs(physical) < 1e-6) {
        // plus de physique : la couverture n'a plus d'objet, on déboucle ce que l'automate a ouvert (pas plus).
        // Sans cela elle resterait ouverte et deviendrait une position spéculative orpheline.
        if (Math.abs(own) < 1e-6) continue;
        diff = -own;
      } else {
        const target = -au.autoHedge.ratio * physical;
        diff = target - (e.futuresQty + e.otcQty);
        if (Math.abs(diff) <= au.autoHedge.threshold * Math.abs(physical)) continue;
      }
      // un débouclage se fait sur les échéances détenues (la plus grosse d'abord) ; une couverture, sur la 2ᵉ échéance cotée
      const months = listedMonths(spec, state.day);
      const unwinding = Math.abs(physical) < 1e-6;
      const held = unwinding ? state.futures.filter((p) => p.commodity === e.commodity && Math.sign(p.lots) === -Math.sign(diff) && months.includes(p.month)).sort((a, b) => Math.abs(b.lots) - Math.abs(a.lots)) : [];
      const mi = held[0]?.month ?? hedgeMonth(state, e.commodity, months);
      let lots = Math.round(diff / lotQty(spec, mi));
      if (held[0]) lots = Math.sign(lots) * Math.min(Math.abs(lots), Math.abs(held[0].lots));
      if (lots !== 0 && tradeFuture(state, e.commodity, mi, lots).ok) {
        hedged[e.commodity] = own + lots * lotQty(spec, mi);
        state.company.tradesThisMonth++;
        msgs.push(`Couverture automatique ${spec.short} : ${lots > 0 ? '+' : ''}${lots} lots ${monthLabel(mi)} (cible ${unwinding ? 'débouclage' : `${Math.round(au.autoHedge.ratio * 100)} %`}).`);
      }
    }
  }
  if (au.autoLogistics) msgs.push(...autoShip(state));
  for (const m of msgs) log(state, m);
  return msgs;
}

/**
 * Échéance de couverture : celle dont la date de prix est la plus proche de la date moyenne d'exposition du physique
 * (pondérée par les quantités ; un stock compte pour aujourd'hui), parmi les échéances qui ne cotent pas leurs
 * derniers jours. Couvrir un forward de janvier sur l'échéance d'octobre laisserait tout le risque de calendrier
 * (et, pour le gaz, la saisonnalité) dans la couverture.
 */
function hedgeMonth(state: GameState, c: CommodityId, months: MonthIndex[]): MonthIndex {
  const spec = COMMODITIES[c];
  let w = 0, t = 0;
  for (const f of state.forwards.filter((x) => x.commodity === c)) { w += f.qty; t += f.qty * f.deliveryDay; }
  for (const v of state.voyages.filter((x) => x.commodity === c)) { w += v.qty; t += v.qty * v.arriveDay; }
  for (const l of state.inventory.filter((x) => x.commodity === c)) { w += l.qty; t += l.qty * state.day; }
  const target = w > 0 ? t / w : state.day;
  const ok = months.filter((mi) => businessDaysBetween(state.day, lastTradingDay(spec, mi)) > 5);
  const pool = ok.length ? ok : months;
  return pool.reduce((best, mi) => (Math.abs(pricingDay(spec, mi) - target) < Math.abs(pricingDay(spec, best) - target) ? mi : best), pool[0]!);
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

