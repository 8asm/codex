/**
 * Actifs industriels : achat, construction, exploitation, risques, délégation, cession.
 *
 * Comptabilité : les actifs sont inscrits au bilan à leur coût, amortis linéairement sur leur durée de vie et
 * dépréciés si leur valeur actualisée (DCF) tombe sous 75 % de la valeur comptable (test de dépréciation).
 * La NAV n'est donc pas « marquée au marché » sur les actifs, comme dans les vrais comptes.
 *
 * DCF : flux mensuels sur la durée de vie restante (max. 30 ans) valorisés sur la COURBE FORWARD
 * (production × (forward + basis − coût variable) − coûts fixes), actualisés au taux sans risque + prime
 * de risque pays (4,5 % + jusqu'à 10 % selon l'instabilité).
 */
import { officeEffects } from './offices';
import { ASSET_DEF_BY_ID, ASSET_DEFS, MANAGER_NAMES, type AssetDef } from '../data/assets';
import { COMMODITIES } from '../data/commodities';
import { COMPANIES, COMPANY_BY_ID } from '../data/companies';
import { FREIGHT } from '../data/freight';
import { addBusinessDays, monthIndexOf, ymd, type Day } from './calendar';
import { listedMonths, physicalDeliveryDay } from './contracts';
import { otcMonths, tradeOtc } from './derivatives';
import { freightForward, freightRate } from './freight';
import { addCash, log, newId } from './ledger';
import { basisAt, forwardAt, futuresPrice, fx, isHalted, rate, spotPrice } from './market';
import { addNews } from './news';
import { chance, normal, pick, randInt, uniform } from './rng';
import type { ActionResult, AssetOpportunity, AssetPolicy, AssetState, CommodityId, GameState, StreamPosition } from './types';
import { normCdf } from './math';
import { localSpot, nav } from './valuation';

export const POLICY: Record<AssetPolicy, { util: number; maintainBelow: number; hedge: number; label: string }> = {
  prudent: { util: 0.75, maintainBelow: 70, hedge: 0.8, label: 'Prudente : utilisation 75 %, maintenance tôt, 80 % de la production couverte' },
  équilibré: { util: 0.88, maintainBelow: 55, hedge: 0.5, label: 'Équilibrée : utilisation 88 %, maintenance normale, 50 % couverte' },
  agressif: { util: 0.98, maintainBelow: 35, hedge: 0, label: 'Agressive : pleine capacité, maintenance tardive, aucune couverture' },
};
const AVAIL = 0.95;
const OCCUPANCY = 0.85;

export const isProducer = (d: AssetDef) => d.type === 'oilfield' || d.type === 'mine_cu' || d.type === 'mine_coal' || d.type === 'mine' || d.type === 'plantation';
/** Usines de transformation : vivent d'une marge entre produits et intrants (phase 8). */
export const isConverter = (d: AssetDef) => d.type === 'refinery' || d.type === 'crush' || d.type === 'powerplant' || d.type === 'smelter';

/** Rendements de la raffinerie (fraction du brut, en masse) et barils par tonne de chaque produit. */
export const REFINERY_YIELD = { GASOIL: [0.4, 7.45], GASOLINE: [0.3, 8.45], JET: [0.1, 7.88], FUELOIL: [0.15, 6.35] } as const;
/** Centrale : rendement électrique et intensité carbone (t CO₂ par MWh). Fonderie : MWh et alumine par tonne. */
export const CCGT = { efficiency: 0.55, co2: 0.37 };
export const SMELTER = { mwhPerT: 14, aluminaT: 1.93, aluminaPrice: 380 };

/**
 * Marge brute (USD par unité de capacité, avant coûts variables) d'une usine de transformation, aux prix forward
 * d'une date (`day`) ou spot :
 *  - raffinerie (par baril de brut) : Σ rendement × produit ($/t) / (bbl/t) − Brent (5 % autoconsommé/pertes) ;
 *  - trituration (par boisseau de soja) : 0,022 st de farine + 11 lb d'huile − soja ;
 *  - centrale (par MWh) : électricité − gaz / rendement − carbone × intensité ;
 *  - fonderie (par tonne d'aluminium) : aluminium − 14 MWh d'électricité − alumine.
 */
export function conversionMargin(state: GameState, d: AssetDef, day?: Day): number {
  const m = state.market;
  const px = (c: CommodityId) => {
    const s = COMMODITIES[c];
    return (day === undefined ? spotPrice(m, c) : forwardAt(m, c, day)) * s.valuePerUnit * fx(m, s.currency);
  };
  switch (d.type) {
    case 'refinery':
      return (Object.entries(REFINERY_YIELD) as [CommodityId, readonly [number, number]][]).reduce((s, [c, [y, bbl]]) => s + (y * px(c)) / bbl, 0) - px('BRENT');
    case 'crush':
      return 0.022 * px('SOYMEAL') + 11 * px('SOYOIL') - px('SOY');
    case 'powerplant':
      return px('POWER') - px('TTF') / CCGT.efficiency - CCGT.co2 * px('EUA');
    case 'smelter':
      return px('AL') - SMELTER.mwhPerT * px('POWER') - SMELTER.aluminaT * SMELTER.aluminaPrice;
    default:
      return 0;
  }
}

/**
 * Valeur de la flexibilité de dispatch d'une centrale : elle ne produit qu'aux heures où la marge est positive.
 * Approximation : marge horaire ~ N(μ, σ²) avec σ = 35 % du prix de l'électricité ⇒ E[max(X, 0)] = μΦ(μ/σ) + σφ(μ/σ).
 */
export function dispatchValue(state: GameState, mu: number, day?: Day): number {
  const s = COMMODITIES.POWER;
  const p = (day === undefined ? spotPrice(state.market, 'POWER') : forwardAt(state.market, 'POWER', day)) * s.valuePerUnit * fx(state.market, s.currency);
  const sig = Math.max(1e-6, 0.35 * Math.abs(p));
  const z = mu / sig;
  return mu * normCdf(z) + sig * Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);
}
export const isStorage = (d: AssetDef) => d.type === 'tank' || d.type === 'warehouse' || d.type === 'silo' || d.type === 'gas_storage';

/** Tarif du stockage tiers (unité de cotation / unité / mois) : renchérit quand la courbe est en contango. */
export function storageRate(state: GameState, c: keyof typeof COMMODITIES): number {
  const spec = COMMODITIES[c];
  const months = listedMonths(spec, state.day);
  const f0 = futuresPrice(state.market, c, months[0]!);
  const f6 = futuresPrice(state.market, c, months[Math.min(6, months.length - 1)]!);
  const contango = Math.max(0, f6 / f0 - 1);
  return spec.physical.storagePerUnitMonth * (1 + 3 * contango);
}

/** Capacité de stockage détenue par le joueur dans un lieu. */
export function ownedCapacity(state: GameState, locationId: string): number {
  return state.assets.filter((a) => a.status !== 'building' && ASSET_DEF_BY_ID[a.defId]!.locationId === locationId && isStorage(ASSET_DEF_BY_ID[a.defId]!)).reduce((s, a) => s + ASSET_DEF_BY_ID[a.defId]!.capacity * a.share, 0);
}

function riskRate(state: GameState, d: AssetDef) {
  const st = state.world.zones[d.zone]?.stability ?? 80;
  return rate(state.market, 'USD') + 0.045 + ((100 - st) / 100) * 0.1;
}

/** Flux de trésorerie mensuel (USD, à 100 %) d'un actif au mois de date `day`, utilisation `util`, déclin `years`. */
function monthlyCash(state: GameState, d: AssetDef, day: Day, util: number, years: number): number {
  const spec = COMMODITIES[d.commodity];
  const k = spec.valuePerUnit * fx(state.market, spec.currency);
  const days = 30.4;
  switch (d.type) {
    case 'oilfield':
    case 'mine_cu':
    case 'mine_coal':
    case 'mine':
    case 'plantation': {
      const q = d.capacity * days * util * AVAIL * Math.exp(-d.decline * years);
      const px = forwardAt(state.market, d.commodity, day) + basisAt(state.market, d.commodity, d.locationId, day);
      return q * (px - d.opexPerUnit) * k - d.fixedMonthly;
    }
    case 'refinery':
    case 'crush':
    case 'smelter': {
      const q = d.capacity * days * util * AVAIL;
      return q * (conversionMargin(state, d, day) - d.opexPerUnit * k) - d.fixedMonthly;
    }
    case 'powerplant': {
      const q = d.capacity * days * AVAIL;
      return q * dispatchValue(state, conversionMargin(state, d, day) - d.opexPerUnit * k, day) - d.fixedMonthly;
    }
    case 'tank':
    case 'warehouse':
    case 'silo':
      return d.capacity * (storageRate(state, d.commodity) * OCCUPANCY - d.opexPerUnit) * k - d.fixedMonthly;
    case 'gas_storage': {
      // valeur intrinsèque : remplir en été, vider en hiver (écart saisonnier de la courbe), étalée sur 12 mois
      const y = ymd(day).y;
      const summer = forwardAt(state.market, 'TTF', physicalDeliveryDay(y * 12 + 6));
      const winter = forwardAt(state.market, 'TTF', physicalDeliveryDay(y * 12 + 12));
      return (d.capacity * (Math.max(0, winter - summer - 0.5) / 12 - d.opexPerUnit) * k) - d.fixedMonthly;
    }
    case 'terminal':
      return d.capacity * days * util * (d.feePerT ?? 2) - d.fixedMonthly;
    case 'vessel': {
      const f = FREIGHT[d.freightIndex!];
      return (freightForward(state.market, d.freightIndex!, day) - f.opexPerDay) * days * AVAIL;
    }
  }
}

/** Valeur actualisée (USD) d'une part `share` d'un actif. `delayDays` : mise en service différée (construction). */
export function assetNpv(state: GameState, defId: string, share = 1, opts: { delayDays?: number; ageDays?: number; util?: number } = {}): number {
  const d = ASSET_DEF_BY_ID[defId]!;
  const r = riskRate(state, d);
  const life = Math.max(0, d.lifeYears * 365 - (opts.ageDays ?? 0));
  const horizon = Math.min(life, 30 * 365);
  let v = 0;
  for (let t = 15; t < horizon; t += 30.4) {
    const day = Math.round(state.day + (opts.delayDays ?? 0) + t);
    const years = ((opts.ageDays ?? 0) + t) / 365;
    v += monthlyCash(state, d, day, opts.util ?? 0.88, years) * Math.exp(-r * ((opts.delayDays ?? 0) + t) / 365);
  }
  return v * share;
}

export function heldAssetNpv(state: GameState, a: AssetState): number {
  if (a.tcEndDay) return 0;
  return assetNpv(state, a.defId, a.share, { ageDays: state.day - a.purchaseDay, delayDays: a.status === 'building' ? Math.max(0, a.statusUntil - state.day) : 0, util: a.utilization });
}

// ------------------------------------------------------------------ opportunités

function streamValue(state: GameState, o: Pick<AssetOpportunity, 'defId' | 'kind' | 'pct' | 'pricePct' | 'months' | 'qtyPerMonth' | 'discount' | 'price'>): number {
  const d = ASSET_DEF_BY_ID[o.defId]!;
  const spec = COMMODITIES[d.commodity];
  const k = spec.valuePerUnit * fx(state.market, spec.currency);
  const r = riskRate(state, d);
  let v = 0;
  const months = o.months ?? 120;
  for (let m = 1; m <= months; m++) {
    const day = state.day + Math.round(m * 30.4);
    const px = forwardAt(state.market, d.commodity, day) + basisAt(state.market, d.commodity, d.locationId, day);
    const prod = d.capacity * 30.4 * 0.85 * AVAIL * Math.exp((-d.decline * m) / 12);
    let cf = 0;
    if (o.kind === 'stream') cf = (o.pct ?? 0) * prod * px * (1 - (o.pricePct ?? 0.2)) * k;
    else if (o.kind === 'royalty') cf = (o.pct ?? 0) * prod * px * k;
    else if (o.kind === 'offtake') cf = (o.qtyPerMonth ?? 0) * (o.discount ?? 0) * k + o.price / months;
    v += cf * Math.exp(-r * (m / 12));
  }
  return v;
}

/** Valeur actualisée d'une opportunité pour le joueur (avant prix payé). */
export function opportunityValue(state: GameState, o: AssetOpportunity): number {
  const d = ASSET_DEF_BY_ID[o.defId]!;
  switch (o.kind) {
    case 'acquisition':
      return assetNpv(state, o.defId, o.share);
    case 'greenfield':
      return assetNpv(state, o.defId, o.share, { delayDays: d.buildDays * 1.4 });
    case 'stream':
    case 'royalty':
    case 'offtake':
      return streamValue(state, o);
    case 'tcin': {
      let v = 0;
      for (let m = 0; m < (o.months ?? 6); m++) v += (freightForward(state.market, d.freightIndex!, state.day + 15 + m * 30.4) - (o.hire ?? 0)) * 30.4;
      return v;
    }
  }
}

function owned(state: GameState, defId: string) {
  return state.assets.some((a) => a.defId === defId) || state.opportunities.some((o) => o.defId === defId);
}

export function generateOpportunities(state: GameState, n: number) {
  state.opportunities = state.opportunities.filter((o) => o.expiresDay >= state.day);
  for (let i = 0; i < n; i++) {
    const r = uniform(state.rng);
    const free = ASSET_DEFS.filter((d) => !owned(state, d.id));
    if (r < 0.18) {
      // affrètement à temps (time charter in)
      const d = pick(state.rng, ASSET_DEFS.filter((x) => x.type === 'vessel'));
      const months = pick(state.rng, [6, 12]);
      let fair = 0;
      for (let m = 0; m < months; m++) fair += freightForward(state.market, d.freightIndex!, state.day + 15 + m * 30.4) / months;
      state.opportunities.push({ id: newId(state, 'ao'), defId: d.id, kind: 'tcin', share: 1, price: 0, months, hire: Math.round(fair * (1 + 0.06 * normal(state.rng))), expiresDay: addBusinessDays(state.day, randInt(state.rng, 8, 20)) });
      continue;
    }
    if (r < 0.33) {
      const mines = ASSET_DEFS.filter((d) => isProducer(d));
      const d = pick(state.rng, mines);
      const producers = COMPANIES.filter((c) => !c.ai && (c.zone ?? '') === d.zone || c.id === 'andescu' && d.zone === 'CL' || c.id === 'rbcoal' && d.zone === 'ZA' || c.id === 'kassmine' && d.zone === 'KASS' || c.id === 'insucoal' && d.zone === 'INSU');
      const cp = producers.length ? pick(state.rng, producers).id : 'andescu';
      const kind = pick(state.rng, ['stream', 'royalty', 'offtake'] as const);
      const base: AssetOpportunity = { id: newId(state, 'ao'), defId: d.id, kind, share: 0, price: 0, counterpartyId: cp, expiresDay: addBusinessDays(state.day, randInt(state.rng, 10, 25)) };
      if (kind === 'stream') Object.assign(base, { pct: 0.1, pricePct: 0.2, months: 120 });
      if (kind === 'royalty') Object.assign(base, { pct: 0.02, months: 120 });
      if (kind === 'offtake') {
        const q = Math.round(d.capacity * 30.4 * 0.25);
        const spot = spotPrice(state.market, d.commodity);
        Object.assign(base, { months: 12, qtyPerMonth: q, discount: Number((spot * 0.03).toFixed(2)) });
        base.price = q * 12 * spot * COMMODITIES[d.commodity].valuePerUnit * fx(state.market, COMMODITIES[d.commodity].currency) * 0.25;
      }
      if (kind !== 'offtake') base.price = streamValue(state, base) * (1 + 0.05 + 0.12 * normal(state.rng));
      state.opportunities.push(base);
      continue;
    }
    if (!free.length) continue;
    const d = pick(state.rng, free);
    const green = r > 0.82 && d.type !== 'refinery';
    const share = d.capex > 1e9 ? pick(state.rng, [0.2, 0.3]) : d.capex > 400e6 ? pick(state.rng, [0.5, 1]) : 1;
    const o: AssetOpportunity = { id: newId(state, 'ao'), defId: d.id, kind: green ? 'greenfield' : 'acquisition', share, price: 0, expiresDay: addBusinessDays(state.day, randInt(state.rng, 15, 30)) };
    o.price = green ? d.capex * share : Math.max(d.capex * 0.2 * share, opportunityValue(state, o) * (1 + 0.05 + 0.12 * normal(state.rng)));
    state.opportunities.push(o);
  }
}

export function buyOpportunity(state: GameState, id: string): ActionResult {
  const o = state.opportunities.find((x) => x.id === id);
  if (!o) return { ok: false, message: 'Opportunité expirée.' };
  const d = ASSET_DEF_BY_ID[o.defId]!;
  if (o.price > state.company.cash - state.company.im) return { ok: false, message: 'Trésorerie insuffisante (tirez sur la RCF ou vendez des actifs).' };
  if (o.price > 0.9 * Math.max(0, nav(state)) + 1) return { ok: false, message: 'Les banques refusent : investissement supérieur à 90 % des fonds propres.' };
  state.opportunities = state.opportunities.filter((x) => x !== o);
  if (o.price > 0) addCash(state, -o.price, 'assets', d.commodity);
  if (o.kind === 'stream' || o.kind === 'royalty' || o.kind === 'offtake') {
    const sp: StreamPosition = {
      id: newId(state, 'sp'), kind: o.kind, defId: o.defId, counterpartyId: o.counterpartyId!, commodity: d.commodity, locationId: d.locationId,
      pct: o.pct ?? 0, pricePct: o.pricePct ?? 0, qtyPerMonth: o.qtyPerMonth ?? 0, discount: o.discount ?? 0,
      prepayLeft: o.kind === 'offtake' ? o.price : 0, monthsLeft: o.months ?? 120, monthsTotal: o.months ?? 120, upfront: o.price, received: 0,
    };
    state.streams.push(sp);
    log(state, `${o.kind === 'stream' ? 'Stream' : o.kind === 'royalty' ? 'Royalty' : 'Offtake prépayé'} sur ${d.name} avec ${COMPANY_BY_ID[sp.counterpartyId]?.name}`, -o.price);
    return { ok: true, message: `Contrat signé avec ${COMPANY_BY_ID[sp.counterpartyId]?.name}.` };
  }
  const a: AssetState = {
    id: newId(state, 'as'), defId: d.id, share: o.share, status: o.kind === 'greenfield' ? 'building' : 'operating',
    statusUntil: o.kind === 'greenfield' ? addBusinessDays(state.day, Math.round(d.buildDays * (0.9 + 0.5 * uniform(state.rng)))) : state.day,
    condition: o.kind === 'greenfield' ? 100 : 55 + 35 * uniform(state.rng), utilization: 0.88, managerId: null, policy: 'équilibré',
    cost: o.price, bookValue: o.price, purchaseDay: state.day, lifeDays: d.lifeYears * 365, produced: 0, cumCash: -o.price,
    crack: d.crackMean, vesselMode: d.type === 'vessel' ? 'charter' : undefined,
  };
  if (o.kind === 'tcin') {
    Object.assign(a, { cost: 0, bookValue: 0, tcEndDay: state.day + Math.round((o.months ?? 6) * 30.4), hire: o.hire, condition: 85, lifeDays: Math.round((o.months ?? 6) * 30.4) });
  }
  state.assets.push(a);
  log(state, `${o.kind === 'greenfield' ? 'Lancement de la construction' : o.kind === 'tcin' ? 'Affrètement à temps' : 'Acquisition'} : ${d.name}${o.share < 1 ? ` (${Math.round(o.share * 100)} %)` : ''}`, -o.price);
  addNews(state, { headline: `${state.company.name} ${o.kind === 'greenfield' ? 'lance la construction de' : o.kind === 'tcin' ? 'affrète à temps' : 'acquiert'} ${d.name}${o.share < 1 ? ` (${Math.round(o.share * 100)} %)` : ''}`, tone: 'neutral', major: false, category: 'entreprises', cityId: d.cityId });
  return { ok: true, message: o.kind === 'greenfield' ? 'Construction lancée.' : 'Actif acquis.' };
}

export function sellAsset(state: GameState, id: string): ActionResult {
  const a = state.assets.find((x) => x.id === id);
  if (!a) return { ok: false, message: 'Actif introuvable.' };
  const d = ASSET_DEF_BY_ID[a.defId]!;
  if (a.tcEndDay) return { ok: false, message: 'Un navire affrété à temps ne se vend pas (il se rend à l’échéance).' };
  const price = Math.max(0, heldAssetNpv(state, a) * (0.92 + 0.05 * normal(state.rng)));
  addCash(state, price, 'assets', d.commodity);
  if (a.managerId) state.managers.find((m) => m.id === a.managerId)!.assetId = null;
  state.assets = state.assets.filter((x) => x !== a);
  const buyer = pick(state.rng, state.companies.filter((c) => c.alive && COMPANY_BY_ID[c.id]!.kind !== 'bank'));
  log(state, `Cession de ${d.name} à ${buyer ? COMPANY_BY_ID[buyer.id]!.name : 'un fonds'} (plus-value ${((price - a.bookValue) / 1e6).toFixed(1)} M$)`, price);
  return { ok: true, message: `${d.name} vendu ${(price / 1e6).toFixed(1)} M$ (valeur comptable ${(a.bookValue / 1e6).toFixed(1)} M$).` };
}

// ------------------------------------------------------------------ managers

export function createManagerPool(state: GameState, n: number) {
  for (let i = 0; i < n; i++) {
    const used = new Set(state.managers.map((m) => m.name));
    const names = MANAGER_NAMES.filter((x) => !used.has(x));
    if (!names.length) return;
    const skill = Math.round(Math.max(10, Math.min(98, 55 + 22 * normal(state.rng))));
    state.managers.push({ id: newId(state, 'mg'), name: pick(state.rng, names), skill, salary: Math.round(12_000 + skill * 450 + 4000 * uniform(state.rng)), specialty: pick(state.rng, ['production', 'stockage', 'logistique'] as const), assetId: null, mistakes: 0 });
  }
}

export function hireManager(state: GameState, id: string, assetId: string): ActionResult {
  const m = state.managers.find((x) => x.id === id);
  const a = state.assets.find((x) => x.id === assetId);
  if (!m || !a) return { ok: false, message: 'Introuvable.' };
  if (a.managerId) state.managers.find((x) => x.id === a.managerId)!.assetId = null;
  if (m.assetId) state.assets.find((x) => x.id === m.assetId)!.managerId = null;
  m.assetId = assetId;
  a.managerId = id;
  return { ok: true, message: `${m.name} gère désormais ${ASSET_DEF_BY_ID[a.defId]!.name} (politique ${a.policy}).` };
}

export function fireManager(state: GameState, id: string): ActionResult {
  const m = state.managers.find((x) => x.id === id);
  if (!m) return { ok: false, message: 'Introuvable.' };
  if (m.assetId) {
    const a = state.assets.find((x) => x.id === m.assetId);
    if (a) a.managerId = null;
  }
  addCash(state, -m.salary * 3, 'overhead');
  state.managers = state.managers.filter((x) => x !== m);
  return { ok: true, message: `${m.name} quitte la société (indemnité de 3 mois).` };
}

/** Couverture de la production attendue des prochains mois par des swaps mensuels vendeurs. */
export function hedgeProduction(state: GameState, id: string, months: number, ratio: number): ActionResult {
  const a = state.assets.find((x) => x.id === id);
  if (!a) return { ok: false, message: 'Actif introuvable.' };
  const d = ASSET_DEF_BY_ID[a.defId]!;
  if (!isProducer(d)) return { ok: false, message: 'Seule une production se couvre ainsi.' };
  const avail = otcMonths(state).filter((mi) => mi > monthIndexOf(state.day)).slice(0, months);
  let n = 0;
  for (const mi of avail) {
    const q = Math.round(d.capacity * 30.4 * a.utilization * AVAIL * a.share * ratio);
    if (q <= 0) continue;
    const r = tradeOtc(state, 'swap', d.commodity, mi, -q, nav(state));
    if (r.ok) n++;
  }
  return n ? { ok: true, message: `Production couverte sur ${n} mois (${Math.round(ratio * 100)} %) par des swaps vendeurs.` } : { ok: false, message: 'Couverture refusée (plafond OTC ?).' };
}

// ------------------------------------------------------------------ exploitation quotidienne

function zoneStab(state: GameState, d: AssetDef) {
  return state.world.zones[d.zone]?.stability ?? 80;
}

export function stepAssets(state: GameState, days: number): string[] {
  const msgs: string[] = [];
  const firstOfMonth = monthIndexOf(state.day) !== monthIndexOf(state.lastCloseDay);
  for (const a of [...state.assets]) {
    const d = ASSET_DEF_BY_ID[a.defId]!;
    const spec = COMMODITIES[d.commodity];
    const k = spec.valuePerUnit * fx(state.market, spec.currency);
    const mgr = a.managerId ? state.managers.find((m) => m.id === a.managerId) : undefined;
    const mf = mgr ? 1.5 - mgr.skill / 100 : 1.15;
    // amortissement linéaire
    if (a.cost > 0) a.bookValue = Math.max(0, a.bookValue - (a.cost / a.lifeDays) * days);
    // fin de construction / de maintenance / de grève / de réparation
    if (a.status !== 'operating' && state.day >= a.statusUntil) {
      if (a.status === 'building') {
        const overrun = chance(state.rng, 0.3) ? d.capex * a.share * (0.1 + 0.3 * uniform(state.rng)) : 0;
        if (overrun) {
          addCash(state, -overrun, 'assets', d.commodity);
          a.cost += overrun;
          a.bookValue += overrun;
        }
        msgs.push(`${d.name} entre en service${overrun ? ` (dépassement de budget : ${(overrun / 1e6).toFixed(0)} M$)` : ''}.`);
      }
      if (a.status === 'maintenance') a.condition = 100;
      a.status = 'operating';
    }
    // affrètement à temps échu : on rend le navire
    if (a.tcEndDay && state.day >= a.tcEndDay) {
      state.assets = state.assets.filter((x) => x !== a);
      if (mgr) mgr.assetId = null;
      msgs.push(`Fin de l’affrètement à temps : ${d.name} est rendu à son armateur.`);
      continue;
    }
    if (a.status === 'building') continue;
    // politique du manager
    if (mgr) {
      a.utilization = POLICY[a.policy].util;
      if (a.status === 'operating' && a.condition < POLICY[a.policy].maintainBelow) startMaintenance(state, a);
      if (chance(state.rng, (1 - mgr.skill / 100) * 0.004 * days * officeEffects(state).mistakeMult)) {
        mgr.mistakes++;
        const kind = uniform(state.rng);
        if (kind < 0.5) {
          a.condition = Math.max(0, a.condition - 20);
          msgs.push(`${mgr.name} a reporté une maintenance sur ${d.name} : l’état de l’actif se dégrade.`);
        } else {
          a.utilization = 1;
          a.condition = Math.max(0, a.condition - 10);
          msgs.push(`${mgr.name} pousse ${d.name} en sur-régime pour tenir les objectifs.`);
        }
      }
    }
    // coûts fixes (au prorata des jours) et usure
    const fixed = d.type === 'vessel' ? FREIGHT[d.freightIndex!].opexPerDay * days : (d.fixedMonthly * a.share * days) / 30.4;
    if (!a.tcEndDay) addCash(state, -fixed, 'assets', d.commodity);
    a.cumCash -= fixed;
    if (a.status === 'operating') a.condition = Math.max(0, a.condition - (0.03 + 0.04 * a.utilization) * days);
    // risques
    const condF = 1 + Math.max(0, 50 - a.condition) / 25;
    if (a.status === 'operating' && chance(state.rng, (d.accidentPA / 365) * days * condF * mf)) {
      const repair = d.capex * a.share * (0.02 + 0.04 * uniform(state.rng)) * (a.tcEndDay ? 0 : 1);
      a.status = 'damaged';
      a.statusUntil = addBusinessDays(state.day, randInt(state.rng, 15, 50));
      addCash(state, -repair, 'assets', d.commodity);
      const env = isProducer(d) || d.type === 'refinery' ? chance(state.rng, 0.3) : false;
      if (env) addCash(state, -d.capex * a.share * 0.02, 'assets', d.commodity);
      addNews(state, { headline: `Accident sur ${d.name}${env ? ' : pollution, amende environnementale' : ''}`, body: `Production arrêtée plusieurs semaines. Réparations : ${(repair / 1e6).toFixed(1)} M$.`, tone: 'alert', major: false, category: 'entreprises', cityId: d.cityId });
    }
    if (a.status === 'operating' && d.strikePA > 0 && chance(state.rng, (d.strikePA / 365) * days * (zoneStab(state, d) < 60 ? 1.5 : 1))) {
      a.status = 'strike';
      a.statusUntil = addBusinessDays(state.day, randInt(state.rng, 5, 25));
      msgs.push(`Grève sur ${d.name} : production à l’arrêt.`);
    }
    const st = zoneStab(state, d);
    if (st < 45 && !a.tcEndDay && d.type !== 'vessel' && chance(state.rng, nationalisationPA(st) * (days / 365))) {
      const comp = heldAssetNpv(state, a) * 0.35 * uniform(state.rng);
      addCash(state, comp, 'assets', d.commodity);
      state.assets = state.assets.filter((x) => x !== a);
      if (mgr) mgr.assetId = null;
      addNews(state, { headline: `${d.name} nationalisé par le gouvernement`, body: `Indemnisation dérisoire : ${(comp / 1e6).toFixed(0)} M$.`, tone: 'alert', major: true, category: 'géopolitique', zone: d.zone });
      state.pendingAlerts.push({ kind: 'major_news', text: `${d.name} nationalisé` });
      continue;
    }
    if (a.status !== 'operating') continue;
    // production et revenus
    const years = (state.day - a.purchaseDay) / 365;
    if (isProducer(d)) {
      // interdiction d'export dans le pays de la mine : la production ne peut plus sortir
      if (state.world.restrictions.some((r) => r.zone === d.zone && r.c === d.commodity && r.kind === 'exportBan')) continue;
      const q = d.capacity * a.utilization * a.share * Math.exp(-d.decline * years) * days;
      addCash(state, -q * d.opexPerUnit * k, 'assets', d.commodity);
      a.cumCash -= q * d.opexPerUnit * k;
      a.produced += q;
      if (state.automation.autoSellProduction) {
        const px = localSpot(state, d.commodity, d.locationId) * (1 - spec.physical.spotSpreadPct);
        addCash(state, q * px * k, 'physical', d.commodity);
        a.cumCash += q * px * k;
      } else {
        const lot = state.inventory.find((l) => l.locationId === d.locationId && l.commodity === d.commodity && l.cost === d.opexPerUnit);
        if (lot) lot.qty += q;
        else state.inventory.push({ id: newId(state, 'i'), commodity: d.commodity, locationId: d.locationId, qty: q, cost: d.opexPerUnit, sinceDay: state.day });
      }
    } else if (isConverter(d)) {
      // phase 8 : marge de transformation aux prix spot des vrais marchés (produits raffinés, soja, électricité…)
      const unit = conversionMargin(state, d) - d.opexPerUnit * k;
      a.crack = unit;
      const q = d.capacity * a.share * days * (d.type === 'powerplant' ? 1 : a.utilization);
      const margin = d.type === 'powerplant' ? q * dispatchValue(state, unit) : q * unit;
      addCash(state, margin, 'assets', d.commodity);
      a.cumCash += margin;
      a.produced += q;
    } else if (isStorage(d)) {
      // capacité inutilisée par le joueur : louée à des tiers au tarif du marché
      const used = state.inventory.filter((l) => l.locationId === d.locationId).reduce((s, l) => s + l.qty, 0);
      const free = Math.max(0, d.capacity * a.share - used);
      const income = free * storageRate(state, d.commodity) * OCCUPANCY * (days / 30.4) * k - d.capacity * a.share * d.opexPerUnit * (days / 30.4) * k;
      addCash(state, income, 'assets', d.commodity);
      a.cumCash += income;
      if (d.type === 'gas_storage' && mgr) gasCycle(state, a, d, days);
    } else if (d.type === 'terminal') {
      const income = d.capacity * a.utilization * a.share * (d.feePerT ?? 2) * days * (0.75 + 0.25 * uniform(state.rng));
      addCash(state, income, 'assets', d.commodity);
      a.cumCash += income;
    } else if (d.type === 'vessel') {
      const hire = a.hire ?? 0;
      if (a.tcEndDay) addCash(state, -hire * days, 'freight');
      if (a.vesselMode === 'charter') {
        const inc = freightRate(state.market, d.freightIndex!) * days * AVAIL;
        addCash(state, inc, 'freight');
        a.cumCash += inc - hire * days;
      } else a.cumCash -= hire * days;
    }
    // couverture mensuelle de la production par le manager
    if (mgr && firstOfMonth && isProducer(d) && POLICY[a.policy].hedge > 0 && !isHalted(state.market, d.commodity)) {
      hedgeProduction(state, a.id, 3, POLICY[a.policy].hedge / 3);
    }
  }
  if (firstOfMonth) {
    for (const m of state.managers.filter((x) => x.assetId)) addCash(state, -m.salary, 'overhead');
    // test de dépréciation
    for (const a of state.assets) {
      if (a.cost <= 0 || a.status === 'building') continue;
      const v = heldAssetNpv(state, a);
      if (v < 0.75 * a.bookValue) {
        msgs.push(`Dépréciation de ${ASSET_DEF_BY_ID[a.defId]!.name} : valeur comptable ramenée de ${(a.bookValue / 1e6).toFixed(0)} à ${(Math.max(0, v) / 1e6).toFixed(0)} M$.`);
        a.bookValue = Math.max(0, v);
      }
    }
    stepStreams(state, msgs);
    generateOpportunities(state, randInt(state.rng, 1, 2));
    if (state.managers.filter((m) => !m.assetId).length < 4) createManagerPool(state, 2);
  }
  for (const m of msgs) log(state, m);
  return msgs;
}

/** Probabilité annuelle de nationalisation selon la stabilité du pays (~2 %/an à 35, ~60 %/an à 5). */
export function nationalisationPA(stability: number): number {
  return stability >= 45 ? 0 : ((45 - stability) / 45) ** 2 * 0.75;
}

export function startMaintenance(state: GameState, a: AssetState) {
  const d = ASSET_DEF_BY_ID[a.defId]!;
  a.status = 'maintenance';
  a.statusUntil = addBusinessDays(state.day, randInt(state.rng, 5, 9));
  const cost = (d.type === 'vessel' ? d.capex * 0.004 : d.capex * 0.004) * a.share;
  addCash(state, -cost, 'assets', d.commodity);
  a.cumCash -= cost;
}

/** Stockage de gaz géré : injection d'avril à septembre, soutirage de novembre à mars, au spot. */
function gasCycle(state: GameState, a: AssetState, d: AssetDef, days: number) {
  const m = ymd(state.day).m;
  const spec = COMMODITIES.TTF;
  const k = fx(state.market, 'EUR');
  const cap = d.capacity * a.share;
  const stock = state.inventory.filter((l) => l.locationId === d.locationId && l.commodity === 'TTF').reduce((s, l) => s + l.qty, 0);
  const sp = localSpot(state, 'TTF', d.locationId);
  if (m >= 4 && m <= 9 && stock < cap) {
    const q = Math.min(cap - stock, (cap / 130) * days);
    addCash(state, -q * sp * (1 + spec.physical.spotSpreadPct) * k, 'physical', 'TTF');
    state.inventory.push({ id: newId(state, 'i'), commodity: 'TTF', locationId: d.locationId, qty: q, cost: sp, sinceDay: state.day });
  } else if ((m >= 11 || m <= 3) && stock > 0) {
    let q = Math.min(stock, (cap / 110) * days);
    addCash(state, q * sp * (1 - spec.physical.spotSpreadPct) * k, 'physical', 'TTF');
    for (const l of state.inventory.filter((x) => x.locationId === d.locationId && x.commodity === 'TTF')) {
      const t = Math.min(l.qty, q);
      l.qty -= t;
      q -= t;
    }
    state.inventory = state.inventory.filter((l) => l.qty > 1e-9);
  }
}

/** Flux mensuels des streams, royalties et offtakes. */
function stepStreams(state: GameState, msgs: string[]) {
  for (const s of [...state.streams]) {
    const d = ASSET_DEF_BY_ID[s.defId!]!;
    const spec = COMMODITIES[s.commodity];
    const k = spec.valuePerUnit * fx(state.market, spec.currency);
    const px = localSpot(state, s.commodity, s.locationId);
    const prod = d.capacity * 30.4 * 0.85 * AVAIL;
    if (s.kind === 'stream') {
      const q = prod * s.pct;
      addCash(state, -q * px * s.pricePct * k, 'physical', s.commodity);
      state.inventory.push({ id: newId(state, 'i'), commodity: s.commodity, locationId: s.locationId, qty: q, cost: px * s.pricePct, sinceDay: state.day });
      s.received += q;
    } else if (s.kind === 'royalty') {
      const cash = prod * s.pct * px * k;
      addCash(state, cash, 'assets', s.commodity);
      s.received += cash;
    } else {
      const repay = s.upfront / s.monthsTotal;
      addCash(state, -(s.qtyPerMonth * (px - s.discount) * k - repay), 'physical', s.commodity);
      state.inventory.push({ id: newId(state, 'i'), commodity: s.commodity, locationId: s.locationId, qty: s.qtyPerMonth, cost: px - s.discount, sinceDay: state.day });
      s.prepayLeft = Math.max(0, s.prepayLeft - repay);
      s.received += s.qtyPerMonth;
    }
    s.monthsLeft--;
    if (s.monthsLeft <= 0) {
      state.streams = state.streams.filter((x) => x !== s);
      msgs.push(`Fin du contrat ${s.kind} sur ${d.name}.`);
    }
  }
}

/** Valeur au bilan d'un stream / royalty (amorti) ou d'un offtake (créance de prépaiement). */
export function streamBook(s: StreamPosition): number {
  return s.kind === 'offtake' ? s.prepayLeft : (s.upfront * s.monthsLeft) / s.monthsTotal;
}

