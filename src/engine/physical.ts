/**
 * Négoce physique : offres de cargaisons à prix fixe (forwards physiques), achats/ventes spot,
 * livraisons, stockage.
 *
 * Prix d'un deal = courbe benchmark au mois de livraison + différentiel (« diff »).
 * La valeur juste du diff est le différentiel de marché du lieu (basis, publié par les agences de prix).
 * Les contreparties proposent en moyenne un diff légèrement à leur avantage ; être SUR PLACE permet
 * de le renégocier (≈ 0,4 % du prix) : c'est l'intérêt de voyager.
 */
import { COMMODITIES, COMMODITY_IDS, findLocation } from '../data/commodities';
import { COUNTERPARTIES, COUNTERPARTY_BY_ID } from '../data/counterparties';
import { addBusinessDays, monthIndexOf, monthLabel, type Day } from './calendar';
import { physicalDeliveryDay } from './contracts';
import { addCash, log, newId } from './ledger';
import { basis, discount, forwardAt, fx } from './market';
import { roundTo } from './math';
import { normal, pick, poisson, randInt, uniform } from './rng';
import { drawRcf, rcfHeadroom } from './treasury';
import type { ActionResult, CommodityId, ForwardDeal, GameState, Offer } from './types';
import { localSpot, nav } from './valuation';

export const LOCAL_EDGE_PCT = 0.004;
export const REMOTE_SPOT_PENALTY = 0.004;
export const SHORT_COVER_PREMIUM = 0.015;
export const MAX_OFFERS = 8;
/** Plafond d'encours physique (notionnel) : 6× les fonds propres (lignes fournisseurs / trade finance). */
export const PHYSICAL_LEVERAGE = 6;

export function isPresent(state: GameState, cityId: string): boolean {
  return state.player.travel === null && state.player.cityId === cityId;
}

export function offerDeliveryDay(o: Offer): Day {
  return physicalDeliveryDay(o.month);
}

/** Diff effectif pour le joueur (amélioré s'il est sur place). */
export function effectiveDiff(state: GameState, o: Offer): number {
  const spec = COMMODITIES[o.commodity];
  const f = forwardAt(state.market, o.commodity, offerDeliveryDay(o));
  const improve = isPresent(state, o.cityId) ? LOCAL_EDGE_PCT * f : 0;
  return roundTo(o.diff - o.side * improve, spec.tick);
}

export function offerPrice(state: GameState, o: Offer): number {
  const spec = COMMODITIES[o.commodity];
  return roundTo(forwardAt(state.market, o.commodity, offerDeliveryDay(o)) + effectiveDiff(state, o), spec.tick);
}

/** Valeur actuelle du deal pour le joueur s'il l'accepte (USD, actualisée). Positif = bonne affaire. */
export function offerEdge(state: GameState, o: Offer): number {
  const spec = COMMODITIES[o.commodity];
  const fair = basis(state.market, o.commodity, o.locationId);
  const perUnit = o.side * (fair - effectiveDiff(state, o));
  return perUnit * o.qty * spec.valuePerUnit * fx(state.market, spec.currency) * discount(spec.currency, state.day, offerDeliveryDay(o));
}

export function notionalUsd(state: GameState, c: CommodityId, qty: number, price: number) {
  const spec = COMMODITIES[c];
  return Math.abs(qty * price * spec.valuePerUnit * fx(state.market, spec.currency));
}

export function physicalExposureUsd(state: GameState): number {
  return state.forwards.reduce((s, d) => s + notionalUsd(state, d.commodity, d.qty, d.price), 0);
}

export function generateOffers(state: GameState) {
  state.offers = state.offers.filter((o) => o.expiresDay >= state.day);
  const n = Math.min(MAX_OFFERS - state.offers.length, poisson(state.rng, 1.8));
  for (let i = 0; i < n; i++) {
    const c = pick(state.rng, COMMODITY_IDS);
    const spec = COMMODITIES[c];
    const loc = pick(state.rng, spec.physical.locations);
    const side: 1 | -1 = uniform(state.rng) < 0.5 ? 1 : -1;
    const month = monthIndexOf(state.day) + randInt(state.rng, 1, 4);
    const f = forwardAt(state.market, c, physicalDeliveryDay(month));
    const local = COUNTERPARTIES.filter((cp) => cp.cityId === loc.cityId);
    const cp = local.length && uniform(state.rng) < 0.7 ? pick(state.rng, local) : pick(state.rng, COUNTERPARTIES);
    // Le diff proposé avantage la contrepartie de 0,15 % en moyenne (écart-type 0,45 %).
    const skew = f * (0.0015 + 0.0045 * normal(state.rng));
    const diff = roundTo(basis(state.market, c, loc.id) + side * skew, spec.tick);
    state.offers.push({
      id: newId(state, 'o'),
      cityId: loc.cityId,
      commodity: c,
      locationId: loc.id,
      side,
      qty: pick(state.rng, spec.physical.cargoSizes),
      month,
      diff,
      counterpartyId: cp.id,
      createdDay: state.day,
      expiresDay: addBusinessDays(state.day, randInt(state.rng, 1, 3)),
    });
  }
}

export function acceptOffer(state: GameState, offerId: string): ActionResult {
  const o = state.offers.find((x) => x.id === offerId);
  if (!o) return { ok: false, message: 'Offre expirée.' };
  const price = offerPrice(state, o);
  const notional = notionalUsd(state, o.commodity, o.qty, price);
  const cap = PHYSICAL_LEVERAGE * Math.max(0, nav(state));
  if (physicalExposureUsd(state) + notional > cap) {
    return { ok: false, message: `Les banques refusent : encours physique plafonné à ${PHYSICAL_LEVERAGE}× vos fonds propres.` };
  }
  const deal: ForwardDeal = {
    id: newId(state, 'f'),
    commodity: o.commodity,
    locationId: o.locationId,
    side: o.side,
    qty: o.qty,
    price,
    month: o.month,
    deliveryDay: offerDeliveryDay(o),
    counterpartyId: o.counterpartyId,
    tradeDay: state.day,
  };
  state.forwards.push(deal);
  state.offers = state.offers.filter((x) => x.id !== offerId);
  const loc = findLocation(o.commodity, o.locationId);
  const cp = COUNTERPARTY_BY_ID[o.counterpartyId]!;
  log(state, `${o.side > 0 ? 'Achat' : 'Vente'} physique ${COMMODITIES[o.commodity].short} ${loc.label} ${monthLabel(o.month)} à ${price.toFixed(COMMODITIES[o.commodity].decimals)} (${cp.name})`);
  return { ok: true, message: `Deal conclu avec ${cp.name}.` };
}

/** Achat spot d'une cargaison prompte, mise en stock immédiatement, payée comptant. */
export function spotBuy(state: GameState, c: CommodityId, locationId: string, qty: number): ActionResult {
  const spec = COMMODITIES[c];
  const loc = findLocation(c, locationId);
  const pen = isPresent(state, loc.cityId) ? 0 : REMOTE_SPOT_PENALTY;
  const price = roundTo(localSpot(state, c, locationId) * (1 + spec.physical.spotSpreadPct + pen), spec.tick);
  const cost = qty * price * spec.valuePerUnit * fx(state.market, spec.currency);
  const available = state.company.cash - state.company.im + rcfHeadroom(state);
  if (cost > available) return { ok: false, message: 'Liquidité insuffisante (cash + RCF disponible).' };
  if (cost > state.company.cash - state.company.im) {
    // tirage RCF implicite pour le financement du stock
    drawRcf(state, cost - Math.max(0, state.company.cash - state.company.im));
  }
  addCash(state, -cost, 'physical', c);
  state.inventory.push({ id: newId(state, 'i'), commodity: c, locationId, qty, cost: price, sinceDay: state.day });
  log(state, `Achat spot ${spec.short} ${loc.label} à ${price.toFixed(spec.decimals)}`, -cost);
  return { ok: true, message: `Cargaison achetée et stockée à ${loc.label}.` };
}

export function spotSell(state: GameState, lotId: string, qty?: number): ActionResult {
  const lot = state.inventory.find((l) => l.id === lotId);
  if (!lot) return { ok: false, message: 'Stock introuvable.' };
  const spec = COMMODITIES[lot.commodity];
  const loc = findLocation(lot.commodity, lot.locationId);
  const q = Math.min(lot.qty, qty ?? lot.qty);
  const pen = isPresent(state, loc.cityId) ? 0 : REMOTE_SPOT_PENALTY;
  const price = roundTo(localSpot(state, lot.commodity, lot.locationId) * (1 - spec.physical.spotSpreadPct - pen), spec.tick);
  const proceeds = q * price * spec.valuePerUnit * fx(state.market, spec.currency);
  addCash(state, proceeds, 'physical', lot.commodity);
  lot.qty -= q;
  if (lot.qty <= 1e-9) state.inventory = state.inventory.filter((l) => l.id !== lotId);
  log(state, `Vente spot ${spec.short} ${loc.label} à ${price.toFixed(spec.decimals)}`, proceeds);
  return { ok: true, message: `Vendu ${q.toLocaleString('fr-FR')} ${spec.qtyUnit}.` };
}

/** Frais de stockage pour `days` jours calendaires. */
export function chargeStorage(state: GameState, days: number) {
  for (const lot of state.inventory) {
    const spec = COMMODITIES[lot.commodity];
    const cost = lot.qty * spec.physical.storagePerUnitMonth * (days / 30) * spec.valuePerUnit * fx(state.market, spec.currency);
    addCash(state, -cost, 'storage', lot.commodity);
  }
}

/**
 * Livraisons échues. Les achats entrent en stock (payés), puis les ventes sont servies depuis le stock
 * (même lieu en priorité ; sinon transfert au coût du différentiel moyen entre lieux, ≈ fret).
 * À défaut de stock, le joueur doit racheter en urgence au spot local + prime de 1,5 %.
 */
export function processDeliveries(state: GameState): string[] {
  const msgs: string[] = [];
  const due = state.forwards.filter((d) => d.deliveryDay <= state.day);
  if (!due.length) return msgs;
  state.forwards = state.forwards.filter((d) => d.deliveryDay > state.day);
  for (const d of due.filter((x) => x.side > 0)) {
    const spec = COMMODITIES[d.commodity];
    const pay = d.qty * d.price * spec.valuePerUnit * fx(state.market, spec.currency);
    addCash(state, -pay, 'physical', d.commodity);
    state.inventory.push({ id: newId(state, 'i'), commodity: d.commodity, locationId: d.locationId, qty: d.qty, cost: d.price, sinceDay: state.day });
    msgs.push(`Livraison reçue : ${spec.short} ${findLocation(d.commodity, d.locationId).label} (${d.qty.toLocaleString('fr-FR')} ${spec.qtyUnit}) mise en stock.`);
  }
  for (const d of due.filter((x) => x.side < 0)) {
    const spec = COMMODITIES[d.commodity];
    const k = spec.valuePerUnit * fx(state.market, spec.currency);
    const target = findLocation(d.commodity, d.locationId);
    let remaining = d.qty;
    const lots = state.inventory
      .filter((l) => l.commodity === d.commodity)
      .sort((a, b) => Number(b.locationId === d.locationId) - Number(a.locationId === d.locationId));
    for (const lot of lots) {
      if (remaining <= 0) break;
      const q = Math.min(lot.qty, remaining);
      const src = findLocation(d.commodity, lot.locationId);
      const transfer = lot.locationId === d.locationId ? 0 : Math.abs(target.basisMean - src.basisMean) + spec.tick * 10;
      if (transfer > 0) addCash(state, -q * transfer * k, 'physical', d.commodity);
      lot.qty -= q;
      remaining -= q;
    }
    state.inventory = state.inventory.filter((l) => l.qty > 1e-9);
    if (remaining > 0) {
      const px = localSpot(state, d.commodity, d.locationId) * (1 + SHORT_COVER_PREMIUM);
      addCash(state, -remaining * px * k, 'physical', d.commodity);
      msgs.push(`Rachat d'urgence de ${remaining.toLocaleString('fr-FR')} ${spec.qtyUnit} de ${spec.short} pour honorer une vente (prime ${(SHORT_COVER_PREMIUM * 100).toFixed(1)} %).`);
    }
    addCash(state, d.qty * d.price * k, 'physical', d.commodity);
    msgs.push(`Livraison effectuée : ${spec.short} ${target.label}, encaissé au prix contractuel.`);
  }
  for (const m of msgs) log(state, m);
  return msgs;
}
