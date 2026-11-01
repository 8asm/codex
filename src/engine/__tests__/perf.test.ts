import { it, expect } from 'vitest';
import { COMMODITIES } from '../../data/commodities';
import { listedMonths, optionMonths } from '../contracts';
import { advanceDay, createGame, dispatch } from '../game';
import { futuresPrice } from '../market';
import { computeVar } from '../risk';

it('performance : une journée avec un livre chargé reste rapide', () => {
  const s = createGame({ seed: 'perf', capital: 200_000_000 });
  for (const c of ['BRENT', 'TTF', 'CU', 'WHEAT', 'API2'] as const) {
    const ms = listedMonths(COMMODITIES[c], s.day);
    dispatch(s, { type: 'TRADE_FUTURE', commodity: c, month: ms[1]!, lots: 20 });
    const om = optionMonths(COMMODITIES[c], s.day);
    for (const k of [0.9, 1, 1.1]) {
      const step = COMMODITIES[c].options.strikeStep;
      const K = Math.round((futuresPrice(s.market, c, om[1]!) * k) / step) * step;
      dispatch(s, { type: 'TRADE_OPTION', commodity: c, month: om[1]!, optType: k < 1 ? 'P' : 'C', strike: K, lots: -5 });
    }
    dispatch(s, { type: 'TRADE_OTC', kind: 'apo', commodity: c, month: Math.floor(s.day / 30), qty: 1000, strike: 1, optType: 'C' });
  }
  const t0 = performance.now();
  computeVar(s);
  const tVar = performance.now() - t0;
  const t1 = performance.now();
  for (let i = 0; i < 20; i++) advanceDay(s);
  const tDay = (performance.now() - t1) / 20;
  console.log(`VaR: ${tVar.toFixed(1)} ms, jour: ${tDay.toFixed(1)} ms, options: ${s.options.length}`);
  expect(tDay).toBeLessThan(400);
});
