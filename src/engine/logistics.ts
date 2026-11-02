/**
 * Logistique maritime : routes, devis de fret, voyages.
 *
 * Coût d'un voyage affrété au voyage (voyage charter) pour une cargaison :
 *   jours payés = jours en charge × (1 + 60 % de retour à vide) + 4 jours d'escale
 *   coût navire = TCE du jour × jours payés + soutes (conso × jours de mer × prix des soutes indexé Brent) + frais de port
 *   coût cargaison = coût navire × part de la cargaison (+15 % pour un lot partiel) + manutention + assurance
 * Avec un navire de notre flotte : pas de loyer (on renonce à le louer au marché : coût d'opportunité affiché),
 * seulement soutes, port et manutention.
 * Les incoterms déterminent qui organise et paie ce transport : le joueur qui achète FOB doit l'organiser
 * pour revendre ailleurs ; vendre CIF/CFR/DAP l'oblige à livrer à destination.
 */
import { charterMult } from './staff';
import { COMMODITIES, findLocation } from '../data/commodities';
import { BALLAST_FACTOR, BUNKER_PER_BRENT, FREIGHT, LAYTIME_DAYS, PORT_DAYS } from '../data/freight';
import { CHOKEPOINT_NAMES, INLAND_LEG, LOCATION_PORT, SEA_EDGES, SEA_NODES } from '../data/routes';
import { formatDayShort, type Day } from './calendar';
import { addCash, log, newId } from './ledger';
import { discount, fx, listedFront, rate } from './market';
import { freightRate } from './freight';
import { chance, poisson } from './rng';
import { greatCircleKm } from './travel';
import type { ActionResult, CommodityId, FreightIndex, GameState, Voyage } from './types';
import { localForward, localSpot } from './valuation';

export const MARINE_INSURANCE_RATE = 0.0012; // 0,12 % de la valeur assurée par voyage
export const ACCIDENT_PER_DAY = 0.00005;
export const DEMURRAGE_MULT = 1.1; // surestaries facturées ~TCE × 1,1 par jour

const NODE = Object.fromEntries(SEA_NODES.map((n) => [n.id, n]));
const KM_PER_NM = 1.852;

/** Passages fermés aujourd'hui par un événement (canal bloqué…). */
export function closedPassages(state: GameState): Set<string> {
  return new Set(state.world.effects.flatMap((e) => e.closes ?? []));
}

/** Plus court chemin maritime (milles nautiques) entre deux nœuds, en évitant les passages fermés. */
export function seaRoute(from: string, to: string, closed: Set<string> = new Set()): { path: string[]; nm: number } | null {
  const adj = new Map<string, { to: string; nm: number }[]>();
  for (const [a, b, gate] of SEA_EDGES) {
    if (gate && closed.has(gate)) continue;
    const nm = greatCircleKm(NODE[a]!.lat, NODE[a]!.lon, NODE[b]!.lat, NODE[b]!.lon) / KM_PER_NM;
    (adj.get(a) ?? adj.set(a, []).get(a)!).push({ to: b, nm });
    (adj.get(b) ?? adj.set(b, []).get(b)!).push({ to: a, nm });
  }
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const todo = new Set(SEA_NODES.map((n) => n.id));
  while (todo.size) {
    let u: string | null = null;
    for (const n of todo) if (dist.has(n) && (u === null || dist.get(n)! < dist.get(u)!)) u = n;
    if (u === null) break;
    todo.delete(u);
    if (u === to) break;
    for (const e of adj.get(u) ?? []) {
      const d = dist.get(u)! + e.nm;
      if (d < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, d);
        prev.set(e.to, u);
      }
    }
  }
  if (!dist.has(to)) return null;
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0]!)!);
  return { path, nm: dist.get(to)! };
}

export function chokepointsOf(path: string[]): string[] {
  return [...new Set(path.map((p) => NODE[p]!.chokepoint).filter((x): x is string => !!x))];
}

export function bunkerPrice(state: GameState): number {
  return listedFront(state.market, 'BRENT') * BUNKER_PER_BRENT;
}

export interface ShipQuote {
  ok: boolean;
  reason?: string;
  index: FreightIndex;
  path: string[];
  nm: number;
  seaDays: number;
  days: number; // durée totale porte-à-porte (jours calendaires)
  arriveDay: Day;
  hireUsd: number;
  bunkerUsd: number;
  portUsd: number;
  handlingUsd: number;
  inlandUsd: number;
  insuranceUsd: number;
  financingUsd: number;
  totalUsd: number;
  perUnit: number; // en unité de cotation
  share: number; // part du navire utilisée
  opportunityUsd: number; // navire de flotte : loyer de marché auquel on renonce
  chokepoints: string[];
  arbPerUnit: number; // valeur à destination − valeur à l'origine − coûts (unité de cotation)
  arbUsd: number;
}

/**
 * Devis d'expédition d'une cargaison d'un lieu physique à un autre.
 * `vesselAssetId` : navire de notre flotte (pas de loyer, mais il est immobilisé pour l'aller-retour).
 */
export function shipQuote(state: GameState, c: CommodityId, fromLoc: string, toLoc: string, qty: number, vesselAssetId?: string): ShipQuote {
  const spec = COMMODITIES[c];
  const lg = spec.logistics;
  const index = lg.vessel(qty);
  const fr = FREIGHT[index];
  const empty: ShipQuote = { ok: false, index, path: [], nm: 0, seaDays: 0, days: 0, arriveDay: state.day, hireUsd: 0, bunkerUsd: 0, portUsd: 0, handlingUsd: 0, inlandUsd: 0, insuranceUsd: 0, financingUsd: 0, totalUsd: 0, perUnit: 0, share: 0, opportunityUsd: 0, chokepoints: [], arbPerUnit: 0, arbUsd: 0 };
  const pa = LOCATION_PORT[fromLoc], pb = LOCATION_PORT[toLoc];
  if (!pa || !pb || lg.tonnesPerUnit <= 0) return { ...empty, reason: 'Marchandise non expédiable par mer depuis/vers ce lieu (gaz de réseau).' };
  if (fromLoc === toLoc) return { ...empty, reason: 'Même lieu.' };
  const route = pa === pb ? { path: [pa], nm: 0 } : seaRoute(pa, pb, closedPassages(state));
  if (!route) return { ...empty, reason: 'Aucune route maritime ouverte.' };
  const tonnes = qty * lg.tonnesPerUnit;
  const share = Math.min(1, tonnes / fr.capacityT);
  const partial = tonnes < fr.capacityT * 0.85 ? 1.15 : 1;
  const seaDays = route.nm / (fr.speed * 24);
  const inland = [INLAND_LEG[fromLoc], INLAND_LEG[toLoc]].filter(Boolean);
  const inlandDays = inland.reduce((s, x) => s + x!.days, 0);
  const paidDays = seaDays * (1 + BALLAST_FACTOR) + PORT_DAYS;
  const tce = freightRate(state.market, index);
  const fleet = vesselAssetId ? state.assets.find((a) => a.id === vesselAssetId) : undefined;
  const hireUsd = fleet ? 0 : tce * paidDays * share * partial * charterMult(state);
  const opportunityUsd = fleet ? tce * paidDays : 0;
  const bunkerUsd = fr.consumption * seaDays * (1 + BALLAST_FACTOR) * bunkerPrice(state) * (fleet ? 1 : share * partial);
  const portUsd = (pa === pb ? 0 : 2 * fr.portCost) * (fleet ? 1 : share * partial);
  const handlingUsd = tonnes * lg.handlingPerT;
  const inlandUsd = inland.reduce((s, x) => s + x!.costPerT * tonnes, 0);
  const k = spec.valuePerUnit * fx(state.market, spec.currency);
  const days = Math.ceil(seaDays + PORT_DAYS + inlandDays);
  const arriveDay = state.day + days;
  const valueUsd = qty * localSpot(state, c, fromLoc) * k;
  const insuranceUsd = state.automation?.marineInsurance ? valueUsd * MARINE_INSURANCE_RATE : 0;
  // Coût de portage de la marchandise pendant le transport (financement au taux de la RCF)
  const financingUsd = valueUsd * (rate(state.market, 'USD') + 0.025) * (days / 360);
  const totalUsd = hireUsd + bunkerUsd + portUsd + handlingUsd + inlandUsd + insuranceUsd + financingUsd;
  const perUnit = totalUsd / qty / k;
  const destValue = localForward(state, c, toLoc, arriveDay) * (1 - lg.transitLoss) * discount(state.market, spec.currency, state.day, arriveDay);
  const arbPerUnit = destValue - localSpot(state, c, fromLoc) - perUnit;
  return {
    ok: true, index, path: route.path, nm: route.nm, seaDays, days, arriveDay, hireUsd, bunkerUsd, portUsd, handlingUsd, inlandUsd, insuranceUsd, financingUsd,
    totalUsd, perUnit, share, opportunityUsd, chokepoints: chokepointsOf(route.path), arbPerUnit, arbUsd: arbPerUnit * qty * k,
  };
}

/** Navires de notre flotte disponibles pour un voyage. */
export function availableVessels(state: GameState, index: FreightIndex) {
  return state.assets.filter((a) => a.defId.startsWith('vessel') && a.status === 'operating' && (a.busyUntil ?? -1) < state.day && a.vesselMode === 'own' && vesselIndex(a.defId) === index);
}

export function vesselIndex(defId: string): FreightIndex {
  return defId.includes('afra') ? 'AFRA' : defId.includes('cape') ? 'CAPE' : defId.includes('smx') ? 'SMX' : 'PMX';
}

/** Lance une expédition : la marchandise quitte le stock, le fret est payé, le navire part. */
export function shipCargo(state: GameState, lotId: string, to: string, qty?: number, vesselAssetId?: string): ActionResult {
  const lot = state.inventory.find((l) => l.id === lotId);
  if (!lot) return { ok: false, message: 'Stock introuvable.' };
  const q = Math.min(lot.qty, qty ?? lot.qty);
  const quote = shipQuote(state, lot.commodity, lot.locationId, to, q, vesselAssetId);
  if (!quote.ok) return { ok: false, message: quote.reason ?? 'Expédition impossible.' };
  if (quote.totalUsd > state.company.cash - state.company.im) return { ok: false, message: 'Trésorerie insuffisante pour payer le fret.' };
  addCash(state, -(quote.totalUsd - quote.financingUsd), 'freight', lot.commodity);
  lot.qty -= q;
  state.inventory = state.inventory.filter((l) => l.qty > 1e-9);
  const v: Voyage = {
    id: newId(state, 'v'), commodity: lot.commodity, qty: q, cost: lot.cost, from: lot.locationId, to,
    vessel: vesselAssetId ? { kind: 'fleet', assetId: vesselAssetId } : { kind: 'spot', index: quote.index },
    departDay: state.day, arriveDay: quote.arriveDay, path: quote.path, nm: quote.nm, freightUsd: quote.totalUsd - quote.financingUsd,
    insured: !!state.automation?.marineInsurance, delayDays: 0, viaCanals: quote.chokepoints, quality: lot.quality, grade: lot.grade,
  };
  if (vesselAssetId) {
    const a = state.assets.find((x) => x.id === vesselAssetId);
    if (a) a.busyUntil = state.day + Math.ceil(quote.days * (1 + BALLAST_FACTOR));
  }
  state.voyages.push(v);
  const spec = COMMODITIES[lot.commodity];
  log(state, `Expédition ${spec.short} ${findLocation(lot.commodity, lot.locationId).label} → ${findLocation(lot.commodity, to).label}, arrivée prévue le ${formatDayShort(v.arriveDay)}`, -v.freightUsd);
  return { ok: true, message: `Navire parti : arrivée prévue le ${formatDayShort(v.arriveDay)} (${Math.round(quote.nm).toLocaleString('fr-FR')} milles${quote.chokepoints.length ? ` via ${quote.chokepoints.map((x) => CHOKEPOINT_NAMES[x]).join(', ')}` : ''}).` };
}

/** Valeur d'une cargaison en mer : prix forward à destination à la date d'arrivée, pertes déduites. */
export function voyageValue(state: Pick<GameState, 'market' | 'day'>, v: Voyage): number {
  const spec = COMMODITIES[v.commodity];
  const s = state as GameState;
  return v.qty * (1 - spec.logistics.transitLoss) * localForward(s, v.commodity, v.to, Math.max(state.day, v.arriveDay), v.grade) * (v.quality ?? 1) * spec.valuePerUnit * fx(state.market, spec.currency) * discount(state.market, spec.currency, state.day, v.arriveDay);
}

/**
 * Journée de mer : canaux fermés sur la route (attente), accidents, arrivées avec congestion portuaire
 * (surestaries au-delà du temps de planche), pertes en transit.
 */
export function stepVoyages(state: GameState): string[] {
  const msgs: string[] = [];
  const closed = closedPassages(state);
  for (const v of [...state.voyages]) {
    const spec = COMMODITIES[v.commodity];
    // Passage fermé encore devant nous : le navire attend (ou contourne : ici il attend, le joueur est prévenu).
    const progress = (state.day - v.departDay) / Math.max(1, v.arriveDay - v.departDay);
    if (progress < 0.6 && v.viaCanals.some((c) => closed.has(c))) {
      v.arriveDay += 1;
      v.delayDays += 1;
    }
    if (chance(state.rng, ACCIDENT_PER_DAY)) {
      const value = voyageValue(state, v);
      state.voyages = state.voyages.filter((x) => x !== v);
      const paid = v.insured ? value * 0.99 : 0;
      if (paid) addCash(state, paid, 'freight', v.commodity);
      const m = `Accident en mer : la cargaison de ${spec.short} vers ${findLocation(v.commodity, v.to).label} est perdue. ${v.insured ? 'L’assurance marine rembourse la valeur (franchise 1 %).' : 'Pas d’assurance : perte totale.'}`;
      msgs.push(m);
      log(state, m, paid - value);
      continue;
    }
    if (state.day < v.arriveDay) continue;
    // Arrivée : congestion portuaire aléatoire ; au-delà du temps de planche, surestaries.
    const waiting = poisson(state.rng, state.market.volRegime === 'stressed' ? 2.5 : 1.2);
    const demDays = Math.max(0, waiting - LAYTIME_DAYS);
    if (demDays > 0 && v.vessel.kind === 'spot') {
      const dem = demDays * freightRate(state.market, v.vessel.index) * DEMURRAGE_MULT * Math.min(1, (v.qty * spec.logistics.tonnesPerUnit) / FREIGHT[v.vessel.index].capacityT);
      addCash(state, -dem, 'freight', v.commodity);
      msgs.push(`Surestaries : ${demDays} jour(s) d’attente au port, ${(dem / 1e3).toFixed(0)} k$ facturés à l’affréteur.`);
    }
    const qty = v.qty * (1 - spec.logistics.transitLoss);
    state.inventory.push({ id: newId(state, 'i'), commodity: v.commodity, locationId: v.to, qty, cost: v.cost, sinceDay: state.day, quality: v.quality, grade: v.grade });
    state.voyages = state.voyages.filter((x) => x !== v);
    msgs.push(`Cargaison de ${spec.short} arrivée à ${findLocation(v.commodity, v.to).label} (${Math.round(qty).toLocaleString('fr-FR')} ${spec.qtyUnit}, pertes en transit ${(spec.logistics.transitLoss * 100).toFixed(2)} %).`);
  }
  for (const m of msgs) log(state, m);
  return msgs;
}

export function portName(id: string) {
  return NODE[id]?.name ?? id;
}

export const SEA_NODE_BY_ID = NODE;
