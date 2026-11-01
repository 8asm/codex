import { describe, expect, it } from 'vitest';
import { COMMODITIES } from '../../data/commodities';
import { addBusinessDays, dayFromYMD, isBusinessDay, monthIndexOf, nthWeekdayOfMonth, weekday, ymd } from '../calendar';
import { lastTradingDay, listedMonths, lotQty } from '../contracts';

const mi = (y: number, m: number) => y * 12 + (m - 1);

describe('calendrier', () => {
  it('jours de semaine et jours ouvrés', () => {
    expect(weekday(dayFromYMD(2027, 1, 4))).toBe(1); // lundi
    expect(isBusinessDay(dayFromYMD(2027, 1, 2))).toBe(false); // samedi
    expect(isBusinessDay(dayFromYMD(2027, 12, 25))).toBe(false);
    expect(ymd(addBusinessDays(dayFromYMD(2027, 1, 8), 1))).toEqual({ y: 2027, m: 1, d: 11 });
  });
  it('troisième mercredi', () => {
    expect(ymd(nthWeekdayOfMonth(mi(2027, 3), 3, 3))).toEqual({ y: 2027, m: 3, d: 17 });
  });
});

describe('dernier jour de cotation', () => {
  it('Brent : dernier jour ouvré du M-2', () => {
    // Mar-27 expire fin janvier 2027 (29 janvier, un vendredi)
    expect(ymd(lastTradingDay(COMMODITIES.BRENT, mi(2027, 3)))).toEqual({ y: 2027, m: 1, d: 29 });
  });
  it('TTF : 2 jours ouvrés avant le 1er du mois', () => {
    // 1er mars 2027 = lundi -> jeudi 25 février
    expect(ymd(lastTradingDay(COMMODITIES.TTF, mi(2027, 3)))).toEqual({ y: 2027, m: 2, d: 25 });
  });
  it('Cuivre : 2 jours ouvrés avant le 3e mercredi', () => {
    expect(ymd(lastTradingDay(COMMODITIES.CU, mi(2027, 3)))).toEqual({ y: 2027, m: 3, d: 15 });
  });
  it('Blé : jour ouvré avant le 15', () => {
    // 15 mars 2027 = lundi -> vendredi 12
    expect(ymd(lastTradingDay(COMMODITIES.WHEAT, mi(2027, 3)))).toEqual({ y: 2027, m: 3, d: 12 });
  });
  it('API2 : dernier vendredi', () => {
    expect(ymd(lastTradingDay(COMMODITIES.API2, mi(2027, 4)))).toEqual({ y: 2027, m: 4, d: 30 });
  });
  it('échéances cotées', () => {
    const today = dayFromYMD(2027, 1, 4);
    const brent = listedMonths(COMMODITIES.BRENT, today);
    expect(brent[0]).toBe(mi(2027, 3)); // le Feb-27 a expiré fin décembre
    expect(brent).toHaveLength(24);
    const wheat = listedMonths(COMMODITIES.WHEAT, today);
    expect(wheat.slice(0, 3).map((m) => m % 12)).toEqual([2, 4, 6]);
    expect(monthIndexOf(today)).toBe(mi(2027, 1));
  });
  it('lot TTF = 1 MW × heures du mois', () => {
    expect(lotQty(COMMODITIES.TTF, mi(2027, 2))).toBe(672);
    expect(lotQty(COMMODITIES.TTF, mi(2027, 1))).toBe(744);
  });
});
