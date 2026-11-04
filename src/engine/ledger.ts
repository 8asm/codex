import type { CashCategory, CommodityId, GameState } from './types';

/** Toute variation de trésorerie passe par ici, pour l'attribution du P&L. */
export function addCash(state: GameState, amountUsd: number, category: CashCategory, commodity?: CommodityId) {
  const co = state.company;
  co.cash += amountUsd;
  co.cumCashByCategory[category] = (co.cumCashByCategory[category] ?? 0) + amountUsd;
  if (commodity) co.cumCashByCommodity[commodity] += amountUsd;
}

export function newId(state: GameState, prefix: string): string {
  return `${prefix}${state.nextId++}`;
}

export function log(state: GameState, text: string, amount?: number) {
  state.log.push({ day: state.day, text, amount });
  if (state.log.length > 400) state.log.shift();
}
