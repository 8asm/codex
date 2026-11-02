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
import { COMPANY_BY_ID } from '../data/companies';
import { CITY_BY_ID } from '../data/cities';
import { cpRating } from './credit';
import { sanctionedDiscount } from './events';
import { checkOffer, recordCase, suspended } from './compliance';
import { recordDeal } from './progress';
import { issueLc, offerHasBuyerLc, offerNeedsLc } from './financing';
import { addNews } from './news';
import { contactAt, remember } from './npcs';
import { isRestricted, sanctionFor, zoneOf } from './world';
import { addBusinessDays, monthIndexOf, monthLabel, type Day } from './calendar';
import { physicalDeliveryDay } from './contracts';
import { addCash, log, newId } from './ledger';
import { basisAt, discount, forwardAt, fx } from './market';
import { roundTo } from './math';
import { chance, hashUniform, normal, pick, poisson, randInt, uniform } from './rng';
import { drawRcf, rcfHeadroom } from './treasury';
import type { ActionResult, CommodityId, ForwardDeal, GameState, InventoryLot, Offer } from './types';
import { localSpot, nav, toleranceValueIn } from './valuation';
import { ownedCapacity, storageRate } from './assets';

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
  const fair = basisAt(state.market, o.commodity, o.locationId, offerDeliveryDay(o));
  const perUnit = o.side * (fair - effectiveDiff(state, o));
  const linear = perUnit * o.qty * spec.valuePerUnit * fx(state.market, spec.currency) * discount(state.market, spec.currency, state.day, offerDeliveryDay(o));
  return linear + offerToleranceValue(state, o);
}

/**
 * Valeur nette d'une sortie au comptant (phase 7, équilibrage) : un achat isolé se revend au spot (fourchette
 * spot) ; une vente isolée se source au spot, ou en rachat d'urgence si rien n'est prévu. La valeur « brute »
 * d'une offre ne se réalise pleinement qu'adossée à l'opération inverse (achat et vente appariés).
 */
export function offerNetEdge(state: GameState, o: Offer): number {
  const spec = COMMODITIES[o.commodity];
  const exit = (spec.physical.spotSpreadPct + (isPresent(state, o.cityId) ? 0 : REMOTE_SPOT_PENALTY)) * notionalUsd(state, o.commodity, o.qty, offerPrice(state, o));
  return offerEdge(state, o) - exit;
}

/** Valeur de la clause de tolérance pour le joueur (négative s'il achète : l'option appartient au vendeur). */
export function offerToleranceValue(state: GameState, o: Offer): number {
  if (!o.tolerance) return 0;
  return toleranceValueIn(state.market, state.day, o.commodity, o.locationId, offerDeliveryDay(o), offerPrice(state, o), o.qty, o.tolerance, o.side < 0);
}

export function notionalUsd(state: GameState, c: CommodityId, qty: number, price: number) {
  const spec = COMMODITIES[c];
  return Math.abs(qty * price * spec.valuePerUnit * fx(state.market, spec.currency));
}

export function physicalExposureUsd(state: GameState): number {
  return state.forwards.reduce((s, d) => s + notionalUsd(state, d.commodity, d.qty, d.price), 0);
}

/** Contrepartie « à risque » au sens KYC : notation spéculative ou pays instable. */
export function kycRisky(state: GameState, cpId: string): boolean {
  const r = cpRating(state, cpId);
  const st = state.world.zones[zoneOf(cpId)]?.stability ?? 80;
  return ['BB', 'B', 'CCC'].includes(r) || st < 50;
}

export function generateOffers(state: GameState) {
  state.offers = state.offers.filter((o) => o.expiresDay >= state.day);
  // Les concurrents raflent les bonnes affaires : une offre avantageuse a 25 % de chances par jour de partir.
  for (const o of [...state.offers]) {
    if (offerEdge(state, o) > 0 && chance(state.rng, 0.25)) {
      const rivals = state.companies.filter((c) => c.alive && COMPANY_BY_ID[c.id]!.desks[o.commodity] !== undefined && c.id !== o.counterpartyId);
      state.offers = state.offers.filter((x) => x !== o);
      if (rivals.length && offerEdge(state, o) > 40_000) {
        const r = pick(state.rng, rivals);
        addNews(state, { headline: `${COMPANY_BY_ID[r.id]!.name} rafle une cargaison de ${COMMODITIES[o.commodity].short} à ${CITY_BY_ID[o.cityId]!.name}`, body: 'Les bonnes affaires ne restent pas longtemps sur la table.', tone: 'neutral', major: false, category: 'entreprises', companyId: r.id, commodity: o.commodity });
      }
    }
  }
  const kyc = state.world.cityRegs[state.company.hqCity]!.kyc;
  const n = Math.min(MAX_OFFERS - state.offers.length, poisson(state.rng, 1.9));
  for (let i = 0; i < n; i++) {
    const c = pick(state.rng, COMMODITY_IDS);
    const spec = COMMODITIES[c];
    const loc = pick(state.rng, spec.physical.locations);
    // Contreparties pertinentes : celles qui ont un desk sur cette commodité, vivantes, non frappées d'interdiction.
    const pool = COUNTERPARTIES.filter((cp) => {
      if (cp.kind === 'bank' || cp.kind === 'fund') return false;
      if (COMPANY_BY_ID[cp.id]?.desks[c] === undefined) return false;
      if (cpRating(state, cp.id) === 'D') return false;
      if (isRestricted(state, cp.id, c, loc.cityId)) return false;
      const sa = sanctionFor(state, cp.id, c);
      if (sa?.kind === 'full') return false;
      if (kyc > 0.9 && ['B', 'CCC'].includes(cpRating(state, cp.id))) return false;
      return true;
    });
    if (!pool.length) continue;
    const local = pool.filter((cp) => cp.cityId === loc.cityId);
    const cp = local.length && uniform(state.rng) < 0.6 ? pick(state.rng, local) : pick(state.rng, pool);
    const sanctioned = state.world.sanctions.some((x) => x.zone === cp.zone);
    // Barils sous sanctions ou plafond : ils ne se vendent qu'avec une forte décote, et seulement à l'achat.
    const side: 1 | -1 = sanctioned ? 1 : uniform(state.rng) < 0.5 ? 1 : -1;
    const month = monthIndexOf(state.day) + randInt(state.rng, 1, 4);
    const f = forwardAt(state.market, c, physicalDeliveryDay(month));
    // Le diff proposé avantage la contrepartie de 0,15 % en moyenne (écart-type 0,45 %) ; un contact qui
    // vous fait confiance propose de meilleures conditions (jusqu'à 0,3 % de mieux à confiance maximale).
    const trust = contactAt(state, cp.id)?.trust ?? 0;
    const skew = f * (0.0015 - (trust / 100) * 0.003 + 0.0045 * normal(state.rng));
    let diff = basisAt(state.market, c, loc.id, physicalDeliveryDay(month)) + side * skew;
    if (sanctioned) diff -= Math.max(sanctionedDiscount(state, cp.id, c), f * (0.15 + 0.1 * uniform(state.rng)));
    diff = roundTo(diff, spec.tick);
    const id = newId(state, 'o');
    state.offers.push({
      id,
      cityId: loc.cityId,
      commodity: c,
      locationId: loc.id,
      side,
      qty: pick(state.rng, spec.physical.cargoSizes),
      month,
      diff,
      counterpartyId: cp.id,
      createdDay: state.day,
      expiresDay: addBusinessDays(state.day, randInt(state.rng, 1, 3) + (trust > 40 ? 2 : 0)),
      kycReadyDay: kycRisky(state, cp.id) && kyc > 0.6 ? addBusinessDays(state.day, Math.ceil((kyc - 0.5) * 6)) : undefined,
      tolerance: pick(state.rng, [0, 0, 0.05, 0.1]),
    });
  }
}

/** Raison pour laquelle le joueur ne peut pas accepter l'offre (sanctions, plafond, KYC, embargo), ou null. */
export function offerBlock(state: GameState, o: Offer): string | null {
  const sa = sanctionFor(state, o.counterpartyId, o.commodity);
  if (sa?.kind === 'full') return 'Contrepartie sous sanctions applicables à votre siège.';
  if (sa?.kind === 'pricecap') {
    const cap = forwardAt(state.market, o.commodity, offerDeliveryDay(o)) * (1 - (sa.capPct ?? 0.25));
    if (offerPrice(state, o) > cap) return `Prix au-dessus du plafond imposé (${cap.toFixed(2)}).`;
  }
  if (isRestricted(state, o.counterpartyId, o.commodity, o.cityId)) return 'Interdiction d’export ou embargo en vigueur.';
  if (o.kycReadyDay !== undefined && state.day < o.kycReadyDay) return 'Vérifications KYC en cours sur cette contrepartie.';
  if (cpRating(state, o.counterpartyId) === 'D') return 'Contrepartie en défaut.';
  return null;
}

/** Marge réalisée sur une sortie de stock (récapitulatif) ; un stock gardé 60 jours et vendu avec profit est un portage réussi. */
function noteSale(state: GameState, lot: InventoryLot, q: number, price: number, label: string) {
  const spec = COMMODITIES[lot.commodity];
  const pnl = q * (price - lot.cost) * spec.valuePerUnit * fx(state.market, spec.currency);
  recordDeal(state, label, pnl);
  if (pnl > 0 && state.day - lot.sinceDay >= 60 && state.stats) state.stats.carryWins++;
}

/** Coût d'une inspection indépendante au chargement (fraction du notionnel). */
export const INSPECTION_COST = 0.0003;

/**
 * Probabilité qu'une cargaison achetée soit hors spécification : 4 % de base, plus pour un vendeur mal noté ou
 * une zone instable. Un cas sur cinq est une contamination grave.
 */
export function offSpecProbability(state: GameState, cpId: string): number {
  const r = cpRating(state, cpId);
  const st = state.world.zones[zoneOf(cpId)]?.stability ?? 80;
  return 0.04 + (['B', 'CCC'].includes(r) ? 0.06 : r === 'BB' ? 0.03 : 0) + (st < 50 ? 0.04 : 0);
}

export function acceptOffer(state: GameState, offerId: string, inspect = false): ActionResult {
  const o = state.offers.find((x) => x.id === offerId);
  if (!o) return { ok: false, message: 'Offre expirée.' };
  const block = offerBlock(state, o);
  if (block) return { ok: false, message: block };
  const price = offerPrice(state, o);
  const notional = notionalUsd(state, o.commodity, o.qty, price);
  const cap = PHYSICAL_LEVERAGE * Math.max(0, nav(state));
  if (physicalExposureUsd(state) + notional > cap) {
    return { ok: false, message: `Les banques refusent : encours physique plafonné à ${PHYSICAL_LEVERAGE}× vos fonds propres.` };
  }
  if (suspended(state)) return { ok: false, message: 'Licence de négoce suspendue : aucune nouvelle opération.' };
  const pre = checkOffer(state, o, notional, offerEdge(state, o), kycRisky(state, o.counterpartyId));
  if (pre.block) return { ok: false, message: pre.block };
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
    tolerance: o.tolerance,
  };
  if (offerNeedsLc(state, o)) {
    const err = issueLc(state, deal, notional, nav(state));
    if (err) return { ok: false, message: err };
  } else if (offerHasBuyerLc(state, o)) deal.lc = 'received';
  if (inspect && o.side > 0) {
    const cost = notional * INSPECTION_COST;
    addCash(state, -cost, 'physical', o.commodity);
    deal.inspected = true;
  }
  if (o.bribe) {
    addCash(state, -o.bribe, 'overhead');
    log(state, 'Honoraires de « conseil » versés à un intermédiaire', -o.bribe);
  }
  for (const c of pre.cases) recordCase(state, c.kind, c.severity, c.gain, c.label);
  state.forwards.push(deal);
  state.company.physVolumeYtd += notional;
  remember(state, contactAt(state, o.counterpartyId)?.id, 3, 'Affaire conclue ensemble');
  state.offers = state.offers.filter((x) => x.id !== offerId);
  const loc = findLocation(o.commodity, o.locationId);
  const cp = COUNTERPARTY_BY_ID[o.counterpartyId]!;
  log(state, `${o.side > 0 ? 'Achat' : 'Vente'} physique ${COMMODITIES[o.commodity].short} ${loc.label} ${monthLabel(o.month)} à ${price.toFixed(COMMODITIES[o.commodity].decimals)} (${cp.name})`);
  return { ok: true, message: `Deal conclu avec ${cp.name}.${deal.lc === 'issued' ? ' Lettre de crédit émise.' : deal.lc === 'received' ? ' Paiement garanti par LC.' : ''}${pre.warn ? ` ${pre.warn}` : ''}` };
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
  const price = roundTo(localSpot(state, lot.commodity, lot.locationId) * (lot.quality ?? 1) * (1 - spec.physical.spotSpreadPct - pen), spec.tick);
  const proceeds = q * price * spec.valuePerUnit * fx(state.market, spec.currency);
  addCash(state, proceeds, 'physical', lot.commodity);
  noteSale(state, lot, q, price, `Vente spot ${spec.short} ${loc.label}`);
  lot.qty -= q;
  if (lot.qty <= 1e-9) state.inventory = state.inventory.filter((l) => l.id !== lotId);
  log(state, `Vente spot ${spec.short} ${loc.label} à ${price.toFixed(spec.decimals)}`, proceeds);
  return { ok: true, message: `Vendu ${q.toLocaleString('fr-FR')} ${spec.qtyUnit}.` };
}

/**
 * Frais de stockage pour `days` jours calendaires : la part du stock couverte par nos propres capacités
 * (cuves, entrepôts, silos détenus) ne paie que leurs coûts d'exploitation (déjà imputés à l'actif) ;
 * le reste paie le stockage tiers, plus cher quand la courbe est en contango (le stockage devient rare).
 */
export function chargeStorage(state: GameState, days: number) {
  const byLoc = new Map<string, typeof state.inventory>();
  for (const l of state.inventory) (byLoc.get(l.locationId) ?? byLoc.set(l.locationId, []).get(l.locationId)!).push(l);
  for (const [loc, lots] of byLoc) {
    const c = lots[0]!.commodity;
    const spec = COMMODITIES[c];
    const total = lots.reduce((s2, l) => s2 + l.qty, 0);
    const billed = Math.max(0, total - ownedCapacity(state, loc));
    const cost = billed * storageRate(state, c) * (days / 30) * spec.valuePerUnit * fx(state.market, spec.currency);
    if (cost > 0) addCash(state, -cost, 'storage', c);
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
  // Tolérance : le vendeur choisit la quantité dans ±tol (plus si le prix convenu dépasse le marché).
  for (const d of due) {
    if (!d.tolerance) continue;
    const S = localSpot(state, d.commodity, d.locationId);
    d.qty = d.qty * (d.price > S ? 1 + d.tolerance : 1 - d.tolerance);
  }
  for (const d of due.filter((x) => x.side > 0)) {
    const spec = COMMODITIES[d.commodity];
    // Qualité (phase 7) : tirage haché sur le contrat (n'affecte pas l'aléa du marché).
    const u = hashUniform(state.config.seed, d.id, 'quality');
    const p = offSpecProbability(state, d.counterpartyId);
    const severe = u < p / 5;
    const offSpec = u < p;
    const disc = offSpec ? (severe ? 0.15 + 0.15 * hashUniform(state.config.seed, d.id, 'q2') : 0.03 + 0.06 * hashUniform(state.config.seed, d.id, 'q2')) : 0;
    if (offSpec && d.inspected && severe) {
      // contamination détectée par l'inspecteur au chargement : cargaison refusée, rien à payer
      msgs.push(`Inspection : cargaison de ${spec.short} contaminée, refusée au chargement. Contrat annulé sans paiement.`);
      continue;
    }
    // hors spécification détecté par l'inspection : réfaction de prix négociée (le vendeur supporte la décote)
    const price = offSpec && d.inspected ? d.price * (1 - disc) : d.price;
    const pay = d.qty * price * spec.valuePerUnit * fx(state.market, spec.currency);
    addCash(state, -pay, 'physical', d.commodity);
    state.inventory.push({ id: newId(state, 'i'), commodity: d.commodity, locationId: d.locationId, qty: d.qty, cost: price, sinceDay: state.day, quality: offSpec ? 1 - disc : undefined });
    if (offSpec && d.inspected) msgs.push(`Inspection : ${spec.short} hors spécification, réfaction de ${(disc * 100).toFixed(1)} % obtenue du vendeur.`);
    else if (offSpec) msgs.push(`${severe ? 'Contamination' : 'Qualité hors spécification'} découverte sur votre ${spec.short} à réception : la cargaison vaut ${(disc * 100).toFixed(1)} % de moins. Sans inspection, aucun recours.`);
    else msgs.push(`Livraison reçue : ${spec.short} ${findLocation(d.commodity, d.locationId).label} (${d.qty.toLocaleString('fr-FR')} ${spec.qtyUnit}) mise en stock.`);
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
      // marchandise hors spécification livrée : l'acheteur obtient une réfaction
      if ((lot.quality ?? 1) < 1) addCash(state, -q * d.price * (1 - lot.quality!) * k, 'physical', d.commodity);
      noteSale(state, lot, q, d.price, `Livraison ${spec.short} ${target.label} (vente à ${COUNTERPARTY_BY_ID[d.counterpartyId]?.name ?? '?'})`);
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
