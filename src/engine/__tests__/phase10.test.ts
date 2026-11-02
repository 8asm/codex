import { describe, expect, it } from 'vitest';
import { CITY_BY_ID } from '../../data/cities';
import { CITY_ZONE } from '../../data/world';
import { COMMODITIES } from '../../data/commodities';
import { LESSON_BY_ID } from '../../data/lessons';
import { physicalDeliveryDay } from '../contracts';
import { monthIndexOf } from '../calendar';
import { factors } from '../difficulty';
import { frSigma, freightForward } from '../freight';
import { FREIGHT } from '../../data/freight';
import { pushNews } from '../world';
import { advanceDay, createGame, dispatch } from '../game';
import { loreAside, loreDay } from '../lore';
import { offerBlock, processDeliveries } from '../physical';
import { rehedgeAfterDeliveries } from '../automation';
import { spotMonthLimit } from '../compliance';
import type { ForwardDeal } from '../types';

const quiet = { crisisFrequency: 0 };

describe('mode débutant', () => {
  it('frictions adoucies, pricing intact ; offres d’achat et de vente garanties ; visite guidée lancée', () => {
    const b = createGame({ seed: 'deb', ...quiet, difficulty: 'debutant', commodities: ['BRENT', 'TTF', 'CU', 'WHEAT', 'API2'] });
    const n = createGame({ seed: 'deb', ...quiet });
    expect(factors(b).offerSkew).toBeLessThan(0);
    expect(factors(n).offerSkew).toBeGreaterThan(0);
    expect(factors(b).cargoCapNav).toBeLessThan(factors(n).cargoCapNav);
    // le modèle de prix est le même : même graine, mêmes paramètres de marché
    expect(b.market.commodities.BRENT.xi).toBe(n.market.commodities.BRENT.xi);
    for (let i = 0; i < 15; i++) {
      expect(b.offers.some((o) => o.side > 0 && !offerBlock(b, o))).toBe(true);
      expect(b.offers.some((o) => o.side < 0 && !offerBlock(b, o))).toBe(true);
      advanceDay(b);
    }
    expect(b.lessons?.active).toBe('first');
    expect(b.automation.autoRoll).toBe(true);
    expect(b.automation.autoHedge.on).toBe(false); // la couverture s'apprend
  });

  it('une nouvelle sur un marché non suivi n’interrompt pas le joueur', () => {
    const s = createGame({ seed: 'deb2', ...quiet, commodities: ['BRENT', 'TTF', 'CU', 'WHEAT', 'API2'] });
    s.pendingAlerts = [];
    dispatch(s, { type: 'SET_AUTOMATION', patch: {} });
    const before = s.pendingAlerts.length;
    pushNews(s, { headline: 'Ruée sur les soutes', commodity: 'FUELOIL', tone: 'up', major: true });
    expect(s.pendingAlerts.length).toBe(before);
    expect(s.news[0]!.major).toBe(false);
    pushNews(s, { headline: 'Le Brent flambe', commodity: 'BRENT', tone: 'up', major: true });
    expect(s.pendingAlerts.length).toBe(before + 1);
  });
});

describe('visite guidée « Premiers pas »', () => {
  it('acheter, couvrir, vendre, livrer, déboucler : les étapes suivent l’état', () => {
    const s = createGame({ seed: 'tuto', ...quiet, difficulty: 'debutant', commodities: ['BRENT', 'TTF', 'CU', 'WHEAT', 'API2'] });
    const L = LESSON_BY_ID.first!;
    expect(s.lessons!.step).toBe(0);
    const mi = monthIndexOf(s.day) + 1;
    const day = physicalDeliveryDay(mi);
    const buy: ForwardDeal = { id: 'b', commodity: 'BRENT', locationId: 'BRENT_RTM', side: 1, qty: 100_000, price: 80, month: mi, deliveryDay: day, counterpartyId: 'x', tradeDay: s.day };
    s.forwards.push(buy);
    dispatch(s, { type: 'SET_AUTOMATION', patch: {} });
    expect(s.lessons!.step).toBe(1);
    dispatch(s, { type: 'HEDGE_DELTA', commodity: 'BRENT' });
    expect(s.lessons!.step).toBe(2);
    s.forwards.push({ ...buy, id: 's', side: -1, price: 81, deliveryDay: day + 3 });
    dispatch(s, { type: 'SET_AUTOMATION', patch: {} });
    expect(s.lessons!.step).toBe(3);
    // livraisons (achat puis vente)
    for (const d of s.forwards) d.deliveryDay = s.day;
    processDeliveries(s);
    dispatch(s, { type: 'SET_AUTOMATION', patch: {} });
    expect(s.lessons!.step).toBe(4);
    // déboucler la couverture orpheline
    for (const p of [...s.futures]) dispatch(s, { type: 'TRADE_FUTURE', commodity: p.commodity, month: p.month, lots: -p.lots });
    expect(s.lessons!.active).toBeNull();
    expect(s.lessons!.done).toContain('first');
    expect(L.steps.length).toBe(5);
  });
});

describe('couverture recalée après les livraisons du soir', () => {
  it('une vente livrée ne laisse pas sa couverture ouverte pendant la nuit', () => {
    const s = createGame({ seed: 'rehedge', ...quiet });
    s.automation.autoHedge = { on: true, ratio: 1, threshold: 0.05 };
    const mi = monthIndexOf(s.day) + 2;
    const day = physicalDeliveryDay(mi);
    s.inventory.push({ id: 'L', commodity: 'BRENT', locationId: 'BRENT_RTM', qty: 300_000, cost: 80, sinceDay: s.day });
    s.forwards.push({ id: 'v', commodity: 'BRENT', locationId: 'BRENT_RTM', side: -1, qty: 300_000, price: 82, month: mi, deliveryDay: day, counterpartyId: 'x', tradeDay: s.day });
    // stock et vente se compensent : pas de couverture ; on force une couverture résiduelle pour le test
    s.forwards[0]!.qty = 600_000;
    rehedgeAfterDeliveries(s);
    expect(s.futures.reduce((a, p) => a + p.lots, 0)).toBe(300);
    s.forwards[0]!.deliveryDay = s.day;
    s.inventory[0]!.qty = 600_000;
    processDeliveries(s);
    rehedgeAfterDeliveries(s);
    expect(s.forwards.length).toBe(0);
    expect(s.futures.reduce((a, p) => a + p.lots, 0)).toBe(0);
  });
});

describe('fret et monde calme', () => {
  it('la volatilité du fret suit le multiplicateur du monde, et le forward reste cohérent (moyenne stationnaire)', () => {
    const calm = createGame({ seed: 'fr', ...quiet, volatility: 0.7 });
    const norm = createGame({ seed: 'fr', ...quiet, volatility: 1 });
    expect(frSigma('AFRA', calm.market)).toBeCloseTo(0.7 * frSigma('AFRA', norm.market), 10);
    // horizon infini : le forward tend vers la moyenne de l'indice, quelle que soit la volatilité
    for (const g of [calm, norm]) expect(freightForward(g.market, 'AFRA', g.day + 365 * 40) / FREIGHT.AFRA.mean).toBeCloseTo(1, 6);
  });
});

describe('limites mois spot', () => {
  it('chaque commodité a une limite finie (plus de NaN sur les 33 marchés de la phase 8)', () => {
    for (const c of Object.keys(COMMODITIES) as (keyof typeof COMMODITIES)[]) expect(Number.isFinite(spotMonthLimit(c))).toBe(true);
  });
});

describe('bruits de couloir', () => {
  it('Lyon existe ; les rumeurs arrivent rarement, dans l’ordre, et ne touchent pas au marché', () => {
    expect(CITY_BY_ID.lyon?.name).toBe('Lyon');
    expect(CITY_ZONE.lyon).toBe('FR');
    const s = createGame({ seed: 'lore', ...quiet, years: 4 });
    const ref = createGame({ seed: 'lore', ...quiet, years: 4 });
    const days = 1000;
    for (let i = 0; i < days; i++) {
      s.day += 1;
      loreDay(s);
    }
    const seen = s.lore!.seen;
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.length).toBeLessThanOrEqual(7);
    expect(seen).toEqual([...seen].sort());
    // aucun effet sur le marché ni la trésorerie
    expect(s.market.commodities.BRENT.xi).toBe(ref.market.commodities.BRENT.xi);
    expect(s.company.cash).toBe(ref.company.cash);
    // au tout début de partie, silence complet
    const t = createGame({ seed: 'lore2', ...quiet });
    for (let i = 0; i < 100; i++) expect(loreAside(t, `k${i}`)).toBe('');
  });
});

describe('limites de bourse et couverture de bonne foi', () => {
  it('une couverture de physique peut dépasser la limite mois spot, une spéculation non', async () => {
    const { positionLimitCheck } = await import('../trading');
    const { listedMonths } = await import('../contracts');
    const s = createGame({ seed: 'bf', ...quiet });
    const mi = listedMonths(COMMODITIES.JKM, s.day)[0]!;
    const lim = COMMODITIES.JKM.positionLimits.spotMonth;
    expect(positionLimitCheck(s, 'JKM', mi, lim + 100)).not.toBeNull();
    // vente physique de 10 M MMBtu (1 000 lots) : la couverture acheteuse est exemptée
    s.forwards.push({ id: 'j', commodity: 'JKM', locationId: COMMODITIES.JKM.physical.locations[0]!.id, side: -1, qty: 10_000_000, price: 11, month: mi, deliveryDay: s.day + 40, counterpartyId: 'x', tradeDay: s.day });
    expect(positionLimitCheck(s, 'JKM', mi, lim + 100)).toBeNull();
    // mais pas dans le sens qui aggrave l'exposition
    expect(positionLimitCheck(s, 'JKM', mi, -(lim + 100))).not.toBeNull();
  });
});
