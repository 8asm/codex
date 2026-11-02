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
import { otcDeltaUnits } from './valuation';

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
        // la couverture automatique roulée reste la sienne sur la nouvelle échéance
        const h = au.hedged;
        if (h?.[`${p.commodity}:${p.month}`]) {
          h[`${p.commodity}:${next}`] = (h[`${p.commodity}:${next}`] ?? 0) + h[`${p.commodity}:${p.month}`]! * (lotQty(spec, next) / lotQty(spec, p.month));
          delete h[`${p.commodity}:${p.month}`];
        }
        msgs.push(`Roll automatique : ${lots} lots ${spec.short} ${monthLabel(p.month)} → ${monthLabel(next)}.`);
      }
    }
  }
  if (au.autoHedge.on) msgs.push(...stripHedge(state));
  if (au.autoLogistics) msgs.push(...autoShip(state));
  for (const m of msgs) log(state, m);
  return msgs;
}

/**
 * Couverture recalée après les livraisons et arrivées du soir : sans cela, la couverture d'une vente livrée resterait
 * ouverte toute la nuit sans physique en face (exposition orpheline d'un jour à chaque livraison).
 */
export function rehedgeAfterDeliveries(state: GameState) {
  if (!state.automation.autoHedge.on) return;
  for (const m of stripHedge(state)) log(state, m);
}

/** Échéances de couverture possibles : celles qui ne cotent pas leurs cinq derniers jours ouvrés. */
function hedgeMonths(state: GameState, c: CommodityId): MonthIndex[] {
  const spec = COMMODITIES[c];
  const months = listedMonths(spec, state.day);
  const ok = months.filter((mi) => businessDaysBetween(state.day, lastTradingDay(spec, mi)) > 5);
  return ok.length ? ok : months;
}

/** Échéance dont la date de prix est la plus proche d'une date d'exposition. */
function bucketOf(spec: (typeof COMMODITIES)[CommodityId], pool: MonthIndex[], day: number): MonthIndex {
  return pool.reduce((best, mi) => (Math.abs(pricingDay(spec, mi) - day) < Math.abs(pricingDay(spec, best) - day) ? mi : best), pool[0]!);
}

/** Exposition physique (unités, signée) répartie par échéance de couverture. */
export function physicalByMonth(state: GameState, c: CommodityId): Map<MonthIndex, number> {
  const spec = COMMODITIES[c];
  const pool = hedgeMonths(state, c);
  const out = new Map<MonthIndex, number>();
  const add = (day: number, q: number) => {
    if (!q) return;
    const mi = bucketOf(spec, pool, day);
    out.set(mi, (out.get(mi) ?? 0) + q);
  };
  for (const f of state.forwards.filter((x) => x.commodity === c)) add(f.deliveryDay, f.side * f.qty);
  for (const v of state.voyages.filter((x) => x.commodity === c)) add(v.arriveDay, v.qty);
  for (const l of state.inventory.filter((x) => x.commodity === c)) add(state.day, l.qty);
  for (const p of (state.financing?.prepays ?? []).filter((x) => x.commodity === c)) for (const d of p.schedule) add(d.day, d.qty);
  return out;
}

/**
 * Couverture en « strip » : chaque exposition physique (forward, cargaison, stock, préfinancement) est rattachée à
 * l'échéance dont la date de prix est la plus proche de sa date, et couverte sur cette échéance au ratio cible.
 * Le risque de calendrier ne subsiste qu'à l'intérieur d'un mois (et dans la base locale). L'automate mémorise ce
 * qu'il a ouvert par échéance (`hedged["BRENT:612"]`) : quand le physique d'une échéance disparaît, il déboucle sa
 * propre couverture et ne touche jamais aux positions manuelles.
 */
function stripHedge(state: GameState): string[] {
  const msgs: string[] = [];
  const au = state.automation;
  const hedged = (au.hedged ??= {});
  const ratio = au.autoHedge.ratio;
  for (const c of activeOrHeld(state)) {
    const spec = COMMODITIES[c];
    const phys = physicalByMonth(state, c);
    const months = new Set<MonthIndex>(phys.keys());
    for (const k of Object.keys(hedged)) if (k.startsWith(`${c}:`) && hedged[k]) months.add(Number(k.slice(c.length + 1)));
    for (const mi of months) {
      const key = `${c}:${mi}`;
      const pos = state.futures.find((p) => p.commodity === c && p.month === mi);
      const futQ = (pos?.lots ?? 0) * lotQty(spec, mi);
      // la part automatique ne peut excéder la position réellement ouverte dans le même sens (débouclage manuel, roll)
      let own = hedged[key] ?? 0;
      if (own * futQ <= 0) own = 0;
      else if (Math.abs(own) > Math.abs(futQ)) own = futQ;
      hedged[key] = own;
      if (isHalted(state.market, c)) continue;
      const p = phys.get(mi) ?? 0;
      const otcQ = state.otc.filter((x) => x.commodity === c && x.month === mi).reduce((a, x) => a + otcDeltaUnits(state, x), 0);
      let diff: number;
      if (Math.abs(p) < 1e-6) {
        if (Math.abs(own) < 1e-6) { delete hedged[key]; continue; }
        diff = -own; // plus de physique sur cette échéance : on rend la couverture de l'automate, et elle seule
      } else {
        diff = -ratio * p - futQ - otcQ;
        if (Math.abs(diff) <= au.autoHedge.threshold * Math.abs(p)) continue;
      }
      const lots = Math.round(diff / lotQty(spec, mi));
      if (lots === 0) continue;
      const r = tradeFuture(state, c, mi, lots);
      if (!r.ok) {
        // une couverture impossible ne doit jamais passer inaperçue : le physique reste exposé
        const warnKey = `hedgefail:${c}`;
        if ((state.adviceCooldown[warnKey] ?? -1) < state.day) {
          state.adviceCooldown[warnKey] = state.day + 5;
          state.pendingAlerts.push({ kind: 'limit', text: `Couverture automatique ${spec.short} ${monthLabel(mi)} impossible (${lots > 0 ? '+' : ''}${lots} lots) : ${r.message} Votre physique reste exposé.` });
        }
      }
      if (r.ok) {
        hedged[key] = own + lots * lotQty(spec, mi);
        state.company.tradesThisMonth++;
        msgs.push(`Couverture automatique ${spec.short} ${monthLabel(mi)} : ${lots > 0 ? '+' : ''}${lots} lots (${Math.abs(p) < 1e-6 ? 'débouclage' : `cible ${Math.round(ratio * 100)} %`}).`);
      }
    }
  }
  return msgs;
}

/** Commodités à examiner : celles qui ont du physique ou une couverture automatique ouverte. */
function activeOrHeld(state: GameState): CommodityId[] {
  const set = new Set<CommodityId>();
  for (const f of state.forwards) set.add(f.commodity);
  for (const v of state.voyages) set.add(v.commodity);
  for (const l of state.inventory) set.add(l.commodity);
  for (const p of state.financing?.prepays ?? []) set.add(p.commodity);
  for (const k of Object.keys(state.automation.hedged ?? {})) set.add(k.split(':')[0] as CommodityId);
  return [...set];
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

