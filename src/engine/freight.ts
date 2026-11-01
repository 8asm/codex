/**
 * Fret : dynamique des taux d'affrètement et FFA.
 *
 * Chaque indice suit un modèle de Schwartz à un facteur sur le log du TCE (retour à la moyenne rapide,
 * vol élevée), simulé sous la mesure de pricing :
 *   d ln S = κ (μ − ln S) dt + σ dW
 *   F(t,T) = exp( e^{−κτ} ln S + (1 − e^{−κτ}) μ + σ²/(4κ) (1 − e^{−2κτ}) )
 * avec μ = ln(moyenne) − σ²/(4κ), pour que l'espérance stationnaire du taux vaille la moyenne de l'indice.
 * Les FFA sont des swaps compensés sur la moyenne mensuelle de l'indice quotidien, avec marge de variation.
 */
import { FREIGHT, FREIGHT_IDS } from '../data/freight';
import { firstDayOfMonth, isBusinessDay, lastDayOfMonth, monthIndexOf, monthLabel, yearFrac, type Day, type MonthIndex } from './calendar';
import { addCash, log, newId } from './ledger';
import { normal, type RngState } from './rng';
import type { ActionResult, FfaPosition, FreightIndex, GameState, MarketState } from './types';

export const FFA_IM_RATE = 0.25;
export const FFA_COMMISSION = 0.0025;

export const frMu = (i: FreightIndex) => Math.log(FREIGHT[i].mean) - FREIGHT[i].sigma ** 2 / (4 * FREIGHT[i].kappa);

export function initFreight(): Record<FreightIndex, number> {
  return Object.fromEntries(FREIGHT_IDS.map((i) => [i, Math.log(FREIGHT[i].mean)])) as Record<FreightIndex, number>;
}

export function stepFreight(m: MarketState, rng: RngState, dt: number) {
  for (const i of FREIGHT_IDS) {
    const f = FREIGHT[i];
    const e = Math.exp(-f.kappa * dt);
    const sd = f.sigma * Math.sqrt((1 - Math.exp(-2 * f.kappa * dt)) / (2 * f.kappa));
    m.freight[i] = m.freight[i] * e + frMu(i) * (1 - e) + sd * normal(rng);
  }
}

/** TCE spot ($/jour). */
export function freightRate(m: MarketState, i: FreightIndex): number {
  return Math.exp(m.freight[i]);
}

/** TCE forward à la date `day`. */
export function freightForward(m: MarketState, i: FreightIndex, day: Day, asOf = m.day, x = m.freight[i]): number {
  const f = FREIGHT[i];
  const tau = Math.max(0, yearFrac(asOf, day));
  const e = Math.exp(-f.kappa * tau);
  return Math.exp(e * x + (1 - e) * frMu(i) + (f.sigma ** 2 / (4 * f.kappa)) * (1 - e * e));
}

export function fixingDaysOf(mi: MonthIndex): Day[] {
  const out: Day[] = [];
  for (let d = firstDayOfMonth(mi); d <= lastDayOfMonth(mi); d++) if (isBusinessDay(d)) out.push(d);
  return out;
}

/** Valeur équitable d'un FFA mensuel : moyenne des fixings connus et des forwards des jours restants. */
export function ffaFair(state: Pick<GameState, 'market' | 'day' | 'freightFixings'>, i: FreightIndex, mi: MonthIndex): number {
  const days = fixingDaysOf(mi);
  const known = new Map((state.freightFixings?.[i] ?? []).map((f) => [f.day, f.px]));
  let sum = 0;
  for (const d of days) sum += d <= state.day && known.has(d) ? known.get(d)! : d < state.day ? freightRate(state.market, i) : freightForward(state.market, i, d);
  return sum / days.length;
}

export function ffaMonths(state: Pick<GameState, 'day'>): MonthIndex[] {
  const cur = monthIndexOf(state.day);
  const out: MonthIndex[] = [];
  for (let mi = cur; mi < cur + 12; mi++) if (fixingDaysOf(mi).some((d) => d >= state.day)) out.push(mi);
  return out;
}

export function ffaValue(state: Pick<GameState, 'market' | 'day' | 'freightFixings'>, p: FfaPosition): number {
  return p.days * (ffaFair(state, p.index, p.month) - p.price);
}

export function ffaHalfSpread(state: Pick<GameState, 'market' | 'day'>, i: FreightIndex, mi: MonthIndex): number {
  const ahead = Math.max(0, mi - monthIndexOf(state.day));
  return freightRate(state.market, i) * 0.012 * (1 + 0.12 * ahead) * (state.market.volRegime === 'stressed' ? 2 : 1);
}

export function ffaIm(state: GameState): number {
  return (state.ffa ?? []).reduce((s, p) => s + Math.abs(p.days) * ffaFair(state, p.index, p.month) * FFA_IM_RATE, 0);
}

export function tradeFfa(state: GameState, i: FreightIndex, mi: MonthIndex, days: number): ActionResult {
  if (!Number.isInteger(days) || days === 0) return { ok: false, message: 'Nombre de jours invalide.' };
  if (!ffaMonths(state).includes(mi)) return { ok: false, message: 'Mois non coté.' };
  const fair = ffaFair(state, i, mi);
  const px = Math.round(fair + Math.sign(days) * ffaHalfSpread(state, i, mi));
  const notional = Math.abs(days) * fair;
  const imAdd = notional * FFA_IM_RATE;
  if (imAdd > state.company.cash - state.company.im) return { ok: false, message: 'Marge initiale non couverte.' };
  addCash(state, -notional * FFA_COMMISSION, 'commission');
  const p: FfaPosition = { id: newId(state, 'ffa'), index: i, month: mi, days, price: px, mark: 0 };
  p.mark = ffaValue(state, p);
  addCash(state, p.mark, 'freight'); // marge trade-date : comme pour les futures, on règle l'écart au mid
  state.ffa.push(p);
  state.company.im += imAdd;
  log(state, `FFA ${FREIGHT[i].name} ${monthLabel(mi)} : ${days > 0 ? 'achat' : 'vente'} de ${Math.abs(days)} jours à ${px} $/j`);
  return { ok: true, message: `FFA ${FREIGHT[i].name} ${monthLabel(mi)} exécuté à ${px.toLocaleString('fr-FR')} $/jour.` };
}

/** Marge de variation des FFA et règlement des mois échus (à la clôture, après le fixing du jour). */
export function settleFfa(state: GameState) {
  for (const p of state.ffa) {
    const v = ffaValue(state, p);
    addCash(state, v - p.mark, 'freight');
    p.mark = v;
  }
  const done = state.ffa.filter((p) => fixingDaysOf(p.month).at(-1)! <= state.day);
  for (const p of done) log(state, `FFA ${FREIGHT[p.index].name} ${monthLabel(p.month)} réglé.`);
  state.ffa = state.ffa.filter((p) => !done.includes(p));
}

export function recordFreightFixings(state: GameState) {
  for (const i of FREIGHT_IDS) {
    const arr = (state.freightFixings[i] ??= []);
    if (arr[arr.length - 1]?.day !== state.day) arr.push({ day: state.day, px: freightRate(state.market, i) });
    if (arr.length > 90) arr.shift();
  }
}

