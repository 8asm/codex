/**
 * Trésorerie : ligne de crédit renouvelable (RCF), intérêts, appels de marge, liquidation forcée.
 *
 * Point clé du métier : la marge de variation se paie en CASH chaque soir, alors que le gain
 * symétrique sur le physique couvert reste latent jusqu'à la livraison. Un hedge parfait peut donc
 * vider la trésorerie : c'est le risque de liquidité de financement.
 */
import { RATES } from '../data/commodities';
import { addCash, log } from './ledger';
import type { GameState } from './types';
import { nav } from './valuation';

export const RCF_SPREAD = 0.025;
export const CASH_HAIRCUT = 0.005;

/** Limite de RCF : 2,5× les fonds propres, plafonnée à 4× le capital initial (covenant bancaire). */
export function rcfLimit(state: GameState, navValue = nav(state)): number {
  // Covenant de VaR violé depuis 7 jours : la banque divise la ligne par deux.
  const cut = state.risk.covenantBreachDays >= 7 ? 0.5 : 1;
  return Math.max(0, Math.min(2.5 * Math.max(0, navValue), 4 * state.company.initialCapital) * cut);
}

/** Capacité de tirage. Nulle si la banque a gelé la ligne (covenant violé). */
export function rcfHeadroom(state: GameState, navValue?: number): number {
  if (state.risk.rcfFrozen) return 0;
  return Math.max(0, rcfLimit(state, navValue) - state.company.rcfDrawn);
}

export function freeCash(state: GameState): number {
  return state.company.cash - state.company.im;
}

/** Intérêts créditeurs/débiteurs, base ACT/360. */
export function accrueInterest(state: GameState, days: number) {
  const co = state.company;
  if (days <= 0) return;
  const r = RATES.USD;
  if (co.cash > 0) addCash(state, co.cash * (r - CASH_HAIRCUT) * (days / 360), 'interest');
  else addCash(state, co.cash * (r + RCF_SPREAD) * (days / 360), 'interest');
  if (co.rcfDrawn > 0) addCash(state, -co.rcfDrawn * (r + RCF_SPREAD + state.risk.rcfPenalty) * (days / 360), 'interest');
}

export function drawRcf(state: GameState, amount: number): number {
  const a = Math.max(0, Math.min(amount, rcfHeadroom(state)));
  state.company.rcfDrawn += a;
  state.company.cash += a;
  return a;
}

export function repayRcf(state: GameState, amount: number): number {
  const a = Math.max(0, Math.min(amount, state.company.rcfDrawn, Math.max(0, state.company.cash)));
  state.company.rcfDrawn -= a;
  state.company.cash -= a;
  return a;
}

/**
 * Gestion automatique de la trésorerie à la clôture (si activée) puis calcul du déficit.
 * Retourne le déficit de liquidité restant (0 si tout va bien).
 */
export function settleTreasury(state: GameState): number {
  const co = state.company;
  const navValue = nav(state);
  const limit = rcfLimit(state, navValue);
  if (co.autoTreasury) {
    const free = co.cash - co.im;
    const buffer = 0.05 * co.initialCapital;
    if (free < 0) {
      const d = drawRcf(state, -free);
      if (d > 0) log(state, `Tirage automatique sur la RCF pour couvrir les marges`, d);
    } else if (free > buffer && co.rcfDrawn > 0) {
      repayRcf(state, free - buffer);
    }
  }
  // Covenant : si la dette dépasse la nouvelle limite, l'excédent est exigible.
  let excessDebt = Math.max(0, co.rcfDrawn - limit);
  if (excessDebt > 0) {
    const pay = Math.min(excessDebt, Math.max(0, co.cash - co.im));
    if (pay > 0) {
      repayRcf(state, pay);
      excessDebt -= pay;
    }
  }
  return Math.max(0, co.im - co.cash) + excessDebt;
}
