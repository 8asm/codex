/**
 * Équilibrage (phase 7) : stratégies-robots jouées sur plusieurs graines, statistiques de fin.
 *   npx vite-node scripts/balance.ts [années] [graines] [robot]
 * Sert à vérifier qu'aucune stratégie triviale ne gagne à coup sûr, que l'inaction coûte (frais fixes),
 * que la discipline (sélection nette, sourcing, financement des stocks) paie, et que les raccourcis de
 * conformité ont une espérance défavorable.
 */
import { advanceDay, createGame, dispatch } from '../src/engine/game';
import { offerEdge, offerNetEdge } from '../src/engine/physical';
import { listedMonths, lotQty } from '../src/engine/contracts';
import { COMMODITIES } from '../src/data/commodities';
import { sanctionedOrigin } from '../src/engine/compliance';
import { nav } from '../src/engine/valuation';
import type { GameState } from '../src/engine/types';

type Bot = (s: GameState) => void;

const hedge = (s: GameState, c: keyof typeof COMMODITIES, qty: number) => {
  const spec = COMMODITIES[c];
  const mi = listedMonths(spec, s.day)[1]!;
  const lots = Math.round(qty / lotQty(spec, mi));
  if (lots) dispatch(s, { type: 'TRADE_FUTURE', commodity: c, month: mi, lots });
};

const autos = (s: GameState, threshold = 0.15) => {
  if (!s.automation.autoRoll) dispatch(s, { type: 'SET_AUTOMATION', patch: { autoRoll: true, autoHedge: { on: true, ratio: 1, threshold }, autoLogistics: true } });
};

/** Sourcing des ventes (achat au comptant sur place avant la livraison) et revente du stock non affecté. */
const sourcing = (s: GameState) => {
  for (const d of s.forwards.filter((x) => x.side < 0 && x.deliveryDay - s.day <= 4)) {
    const have = s.inventory.filter((l) => l.commodity === d.commodity && l.locationId === d.locationId).reduce((a, l) => a + l.qty, 0);
    const need = d.qty * (1 + (d.tolerance ?? 0)) - have;
    if (need > 0) dispatch(s, { type: 'SPOT_BUY', commodity: d.commodity, locationId: d.locationId, qty: Math.ceil(need) });
  }
  for (const l of [...s.inventory]) {
    const committed = s.forwards.some((d) => d.side < 0 && d.commodity === l.commodity && d.locationId === l.locationId);
    if (!committed && s.day - l.sinceDay > 2) dispatch(s, { type: 'SPOT_SELL', lotId: l.id });
  }
};

const BOTS: Record<string, Bot> = {
  inactif: () => {},
  // accepte toute offre à valeur brute positive ; roll, couverture et logistique automatiques
  negociant: (s) => {
    autos(s);
    for (const o of [...s.offers]) {
      if (o.bribe || sanctionedOrigin(s, o)) continue;
      if (offerEdge(s, o) > 20_000) dispatch(s, { type: 'ACCEPT_OFFER', offerId: o.id, inspect: true });
    }
  },
  // discipliné : valeur nette d'une sortie isolée > 30 k$, encours limité, sourcing, stocks financés
  discipline: (s) => {
    autos(s, 0.1);
    for (const o of [...s.offers]) {
      if (o.bribe || sanctionedOrigin(s, o) || s.forwards.length >= 8) continue;
      if (offerNetEdge(s, o) > 30_000) dispatch(s, { type: 'ACCEPT_OFFER', offerId: o.id, inspect: true });
    }
    sourcing(s);
    for (const l of s.inventory) if (!s.financing.loans.some((x) => x.lotId === l.id)) dispatch(s, { type: 'FINANCE_LOT', lotId: l.id });
  },
  // couverture manuelle sans débouclage après livraison : les couvertures orphelines deviennent spéculatives
  negociant_m: (s) => {
    if (!s.automation.autoRoll) dispatch(s, { type: 'SET_AUTOMATION', patch: { autoRoll: true, autoLogistics: true } });
    for (const o of [...s.offers]) {
      if (o.bribe || sanctionedOrigin(s, o)) continue;
      if (offerEdge(s, o) > 20_000) {
        const r = dispatch(s, { type: 'ACCEPT_OFFER', offerId: o.id, inspect: true });
        if (r.ok) hedge(s, o.commodity, -o.side * o.qty);
      }
    }
  },
  // raccourcis : barils sanctionnés et commissions acceptés, conformité minimale
  raccourcis: (s) => {
    autos(s);
    for (const o of [...s.offers]) {
      if (offerEdge(s, o) > 20_000 || o.bribe || sanctionedOrigin(s, o)) dispatch(s, { type: 'ACCEPT_OFFER', offerId: o.id });
    }
    sourcing(s);
  },
  // spéculateur : long Brent et cuivre (1,5× les fonds propres chacun), sans couverture
  speculateur: (s) => {
    if (s.futures.length) return;
    dispatch(s, { type: 'SET_AUTOMATION', patch: { autoRoll: true } });
    for (const c of ['BRENT', 'CU'] as const) {
      const spec = COMMODITIES[c];
      const mi = listedMonths(spec, s.day)[1]!;
      const notionalPerLot = lotQty(spec, mi) * 80 * (c === 'CU' ? 110 : 1);
      dispatch(s, { type: 'TRADE_FUTURE', commodity: c, month: mi, lots: Math.max(1, Math.round((1.5 * nav(s)) / notionalPerLot)) });
    }
  },
};

const years = Number(process.argv[2] ?? 1);
const seeds = Number(process.argv[3] ?? 6);
const only = process.argv[4];
for (const [name, bot] of Object.entries(BOTS).filter(([n]) => !only || n === only)) {
  const rets: number[] = [];
  let bankrupt = 0, fines = 0, inv = 0;
  for (let k = 0; k < seeds; k++) {
    const s = createGame({ seed: `bal-${k}`, years });
    while (s.status === 'running') {
      bot(s);
      advanceDay(s);
    }
    if (s.status === 'bankrupt' || s.status === 'banned') bankrupt++;
    fines += s.compliance.fines;
    inv += s.compliance.investigations.length;
    rets.push(nav(s) / s.company.initialCapital - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length);
  const sorted = [...rets].sort((a, b) => a - b);
  console.log(`${name.padEnd(12)} rendement moyen ${(mean * 100).toFixed(1).padStart(6)} %  écart-type ${(sd * 100).toFixed(1).padStart(5)} %  min ${(sorted[0]! * 100).toFixed(1)} %  max ${(sorted.at(-1)! * 100).toFixed(1)} %  faillites ${bankrupt}/${seeds}  enquêtes ${inv}  amendes ${(fines / 1e6).toFixed(1)} M$`);
}
