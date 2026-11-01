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
  lastBusinessDayOfMonth,
  lastWeekdayOfMonth,
  monthIndexOf,
  nthWeekdayOfMonth,
  prevBusinessDay,
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
