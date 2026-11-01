/**
 * Calendrier du jeu. Un `Day` est un nombre entier de jours depuis le 1970-01-01 (UTC).
 * Un `MonthIndex` vaut année*12 + mois (0 = janvier) : c'est l'identifiant d'une échéance mensuelle.
 *
 * Jours ouvrés : lundi-vendredi hors 1er janvier et 25 décembre (calendrier unique simplifié,
 * cf. DESIGN_NOTES.md — les vraies bourses ont chacune leur calendrier).
 */
export type Day = number;
export type MonthIndex = number;

const MS_DAY = 86_400_000;

export function dayFromYMD(y: number, m: number, d: number): Day {
  return Math.floor(Date.UTC(y, m - 1, d) / MS_DAY);
}

export function ymd(day: Day): { y: number; m: number; d: number } {
  const dt = new Date(day * MS_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}

/** 0 = dimanche … 6 = samedi. Le 1970-01-01 était un jeudi. */
export function weekday(day: Day): number {
  return (((day + 4) % 7) + 7) % 7;
}

export function isHoliday(day: Day): boolean {
  const { m, d } = ymd(day);
  return (m === 1 && d === 1) || (m === 12 && d === 25);
}

export function isBusinessDay(day: Day): boolean {
  const w = weekday(day);
  return w !== 0 && w !== 6 && !isHoliday(day);
}

export function nextBusinessDay(day: Day): Day {
  let d = day + 1;
  while (!isBusinessDay(d)) d++;
  return d;
}

export function prevBusinessDay(day: Day): Day {
  let d = day - 1;
  while (!isBusinessDay(d)) d--;
  return d;
}

/** Ajuste au jour ouvré suivant si `day` n'est pas ouvré (convention « following »). */
export function adjustFollowing(day: Day): Day {
  return isBusinessDay(day) ? day : nextBusinessDay(day);
}

export function adjustPreceding(day: Day): Day {
  return isBusinessDay(day) ? day : prevBusinessDay(day);
}

export function addBusinessDays(day: Day, n: number): Day {
  let d = day;
  if (n >= 0) for (let i = 0; i < n; i++) d = nextBusinessDay(d);
  else for (let i = 0; i < -n; i++) d = prevBusinessDay(d);
  return d;
}

export function businessDaysBetween(from: Day, to: Day): number {
  let n = 0;
  for (let d = from + 1; d <= to; d++) if (isBusinessDay(d)) n++;
  return n;
}

export function monthIndexOf(day: Day): MonthIndex {
  const { y, m } = ymd(day);
  return y * 12 + (m - 1);
}

export function firstDayOfMonth(mi: MonthIndex): Day {
  return dayFromYMD(Math.floor(mi / 12), (mi % 12) + 1, 1);
}

export function lastDayOfMonth(mi: MonthIndex): Day {
  return firstDayOfMonth(mi + 1) - 1;
}

export function daysInMonth(mi: MonthIndex): number {
  return lastDayOfMonth(mi) - firstDayOfMonth(mi) + 1;
}

export function lastBusinessDayOfMonth(mi: MonthIndex): Day {
  return adjustPreceding(lastDayOfMonth(mi));
}

/** n-ième jour de semaine `wd` du mois (n commence à 1). */
export function nthWeekdayOfMonth(mi: MonthIndex, wd: number, n: number): Day {
  const first = firstDayOfMonth(mi);
  const offset = (wd - weekday(first) + 7) % 7;
  return first + offset + 7 * (n - 1);
}

export function lastWeekdayOfMonth(mi: MonthIndex, wd: number): Day {
  const last = lastDayOfMonth(mi);
  const offset = (weekday(last) - wd + 7) % 7;
  return last - offset;
}

/** Fraction d'année ACT/365 (utilisée pour le modèle de prix et l'actualisation). */
export function yearFrac(from: Day, to: Day): number {
  return (to - from) / 365;
}

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Codes mois des futures (F G H J K M N Q U V X Z). */
export const MONTH_CODES = ['F', 'G', 'H', 'J', 'K', 'M', 'N', 'Q', 'U', 'V', 'X', 'Z'];

/** Libellé de marché, ex. « Mar-27 ». */
export function monthLabel(mi: MonthIndex): string {
  const y = Math.floor(mi / 12) % 100;
  return `${MONTHS_EN[mi % 12]}-${String(y).padStart(2, '0')}`;
}

export function monthCode(mi: MonthIndex): string {
  return `${MONTH_CODES[mi % 12]}${Math.floor(mi / 12) % 100}`;
}

const fmtLong = new Intl.DateTimeFormat('fr-FR', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});
const fmtShort = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'short', timeZone: 'UTC' });

export function formatDay(day: Day): string {
  return fmtLong.format(new Date(day * MS_DAY));
}
export function formatDayShort(day: Day): string {
  return fmtShort.format(new Date(day * MS_DAY));
}
