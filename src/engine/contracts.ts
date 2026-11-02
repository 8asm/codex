/**
 * Spécifications d'échéances : dernier jour de cotation (LTD), date de prix, taille de lot.
 * Règles calquées sur les contrats réels :
 *  - Brent ICE : dernier jour ouvré du 2ᵉ mois précédant le mois de livraison.
 *  - TTF ICE Endex : deux jours ouvrés avant le premier jour calendaire du mois de livraison.
 *  - Cuivre LME : prompt mensuel le 3ᵉ mercredi ; cotation jusqu'à 2 jours ouvrés avant.
 *  - Blé CBOT : jour ouvré précédant le 15 du mois de contrat.
 *  - Charbon API2 Rotterdam : dernier vendredi du mois de livraison.
 */
import {
  addBusinessDays,
  adjustFollowing,
  adjustPreceding,
  dayFromYMD,
  daysInMonth,
  firstDayOfMonth,
  isBusinessDay,
  lastBusinessDayOfMonth,
  lastDayOfMonth,
  lastWeekdayOfMonth,
  monthIndexOf,
  nthWeekdayOfMonth,
  prevBusinessDay,
  weekday,
  type Day,
  type MonthIndex,
} from './calendar';
import type { CommoditySpec } from './types';

export function lastTradingDay(spec: CommoditySpec, mi: MonthIndex): Day {
  switch (spec.ltdRule) {
    case 'BRENT':
      return lastBusinessDayOfMonth(mi - 2);
    case 'TTF':
      return addBusinessDays(firstDayOfMonth(mi), -2);
    case 'LME':
      return addBusinessDays(nthWeekdayOfMonth(mi, 3, 3), -2);
    case 'CBOT':
      return prevBusinessDay(dayFromYMD(Math.floor(mi / 12), (mi % 12) + 1, 15));
    case 'LAST_FRIDAY':
      return adjustPreceding(lastWeekdayOfMonth(mi, 5));
    case 'WTI': {
      // NYMEX : 3 jours ouvrés avant le 25 du mois précédant la livraison (le jour ouvré précédent si le 25 est chômé)
      const prev = mi - 1;
      let d = dayFromYMD(Math.floor(prev / 12), (prev % 12) + 1, 25);
      if (!isBusinessDay(d)) d = prevBusinessDay(d);
      return addBusinessDays(d, -3);
    }
    case 'GASOIL':
      // ICE Gasoil : 2 jours ouvrés avant le 14 du mois de livraison
      return addBusinessDays(dayFromYMD(Math.floor(mi / 12), (mi % 12) + 1, 14), -2);
    case 'ICE_SOFTS':
      // softs ICE US : dernier jour ouvré du mois précédant le mois de livraison
      return lastBusinessDayOfMonth(mi - 1);
  }
}

/** Date « T » utilisée pour pricer l'échéance sur la courbe (milieu de livraison ou prompt LME). */
export function pricingDay(spec: CommoditySpec, mi: MonthIndex): Day {
  if (spec.ltdRule === 'LME') return nthWeekdayOfMonth(mi, 3, 3);
  return firstDayOfMonth(mi) + 14;
}

/** Date de livraison physique (15 du mois, jour ouvré suivant). */
export function physicalDeliveryDay(mi: MonthIndex): Day {
  return adjustFollowing(firstDayOfMonth(mi) + 14);
}

export function lotQty(spec: CommoditySpec, mi: MonthIndex): number {
  if (spec.lot.kind === 'fixed') return spec.lot.qty;
  // 1 MW livré en continu sur toutes les heures du mois (changements d'heure ignorés).
  return spec.lot.mw * 24 * daysInMonth(mi);
}

/** Échéances cotées à la date `today` (celles dont le LTD n'est pas passé). */
export function listedMonths(spec: CommoditySpec, today: Day): MonthIndex[] {
  const out: MonthIndex[] = [];
  let mi = monthIndexOf(today) - 2;
  const allowed = spec.listing.kind === 'months' ? spec.listing.months : null;
  while (out.length < spec.listing.count && mi < monthIndexOf(today) + 240) {
    if ((!allowed || allowed.includes(mi % 12)) && lastTradingDay(spec, mi) >= today) out.push(mi);
    mi++;
  }
  return out;
}

export const contractKey = (commodity: string, mi: MonthIndex) => `${commodity}:${mi}`;

/**
 * Expiration des options sur futures (calquée sur les contrats réels) :
 *  - Brent ICE : 3 jours ouvrés avant le dernier jour de cotation du future ;
 *  - TTF ICE Endex : 5 jours calendaires avant le premier jour du mois de livraison (jour ouvré précédent) ;
 *  - LME : premier mercredi du mois du prompt ;
 *  - CBOT : dernier vendredi précédant d'au moins 2 jours ouvrés le dernier jour ouvré du mois précédant le contrat ;
 *  - API2 : avec le future.
 */
export function optionExpiry(spec: CommoditySpec, mi: MonthIndex): Day {
  switch (spec.options.expiryRule) {
    case 'BRENT':
      return addBusinessDays(lastTradingDay(spec, mi), -3);
    case 'TTF':
      return adjustPreceding(firstDayOfMonth(mi) - 5);
    case 'LME':
      return adjustPreceding(nthWeekdayOfMonth(mi, 3, 1));
    case 'CBOT': {
      let d = addBusinessDays(lastBusinessDayOfMonth(mi - 1), -2);
      while (weekday(d) !== 5) d--;
      return adjustPreceding(d);
    }
    case 'WITH_FUTURE':
      return lastTradingDay(spec, mi);
  }
}

/** Échéances sur lesquelles des options sont cotées. */
export function optionMonths(spec: CommoditySpec, today: Day): MonthIndex[] {
  return listedMonths(spec, today)
    .filter((mi) => optionExpiry(spec, mi) >= today)
    .slice(0, spec.options.months);
}

/** Grille de strikes centrée sur la monnaie. */
export function strikeGrid(spec: CommoditySpec, F: number, n = 7): number[] {
  const step = spec.options.strikeStep * Math.max(1, Math.round(F / spec.options.strikeStep / 40));
  const atm = Math.round(F / step) * step;
  const out: number[] = [];
  for (let i = -n; i <= n; i++) if (atm + i * step > 0) out.push(Number((atm + i * step).toFixed(6)));
  return out;
}

/** Jours de fixing d'un swap / d'une APO mensuelle : tous les jours ouvrés du mois. */
export function fixingDays(mi: MonthIndex): Day[] {
  const out: Day[] = [];
  for (let d = firstDayOfMonth(mi); d <= lastDayOfMonth(mi); d++) if (isBusinessDay(d)) out.push(d);
  return out;
}
