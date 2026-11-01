/**
 * État géopolitique et réglementaire du monde, et application des impacts d'événements.
 *
 * - Zones (pays réels des villes + zones fictives) avec une stabilité qui dérive et réagit aux événements.
 * - Tension entre blocs (Occident / Orient) : elle module la probabilité des sanctions, embargos et chocs.
 * - Sanctions (totales ou plafond de prix), interdictions d'export, embargos : ils filtrent les contreparties
 *   et déplacent les différentiels physiques.
 * - Réglementation par ville (impôt, KYC, reporting, contrôle des capitaux) : évolue avec les élections et les réformes.
 * - Indice El Niño (ENSO) : saisonnalité stochastique du blé, du charbon et du gaz.
 */
import { CITIES, CITY_BY_ID } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { COUNTERPARTY_BY_ID } from '../data/counterparties';
import { CITY_ZONE, ZONE_BY_ID, ZONES } from '../data/world';
import { addBusinessDays, type Day } from './calendar';
import { log, newId } from './ledger';
import { exchangeImRate } from './market';
import { addNews } from './news';
import { normal, randInt } from './rng';
import type { ActiveEffect, CommodityId, GameState, Impact, NewsItem, WorldState } from './types';

export function createWorld(state: Pick<GameState, 'rng' | 'day'>): WorldState {
  const cityRegs: WorldState['cityRegs'] = {};
  for (const c of CITIES) cityRegs[c.id] = { taxRate: c.corporateTax, kyc: c.kycStrictness, capitalControls: c.capitalControls, reportingFee: c.reportingFee };
  const elections: Record<string, Day> = {};
  for (const z of ZONES.filter((x) => !x.fictional)) elections[z.id] = state.day + randInt(state.rng, 60, 900);
  return {
    zones: Object.fromEntries(ZONES.map((z) => [z.id, { stability: z.baseStability }])),
    blocTension: 45,
    sanctions: [],
    restrictions: [],
    effects: [],
    pending: [],
    narratives: [],
    enso: 0,
    cityRegs,
    calendar: {
      opec: addBusinessDays(state.day, randInt(state.rng, 15, 40)),
      fomc: addBusinessDays(state.day, randInt(state.rng, 10, 30)),
      ecb: addBusinessDays(state.day, randInt(state.rng, 12, 32)),
      elections,
    },
    eventCooldown: {},
  };
}

/** Zone d'origine d'une contrepartie. */
export function zoneOf(cpId: string): string {
  return COUNTERPARTY_BY_ID[cpId]?.zone ?? 'CH';
}

/** Régime de sanctions applicable au joueur (selon la ville de son siège). */
export function playerRegime(state: GameState) {
  return CITY_BY_ID[state.company.hqCity]!.sanctionsRegime;
}

/**
 * Une contrepartie est-elle sous sanctions applicables au joueur ?
 * - régime « west » : sanctions occidentales ; « east » : sanctions orientales ; « un » : seulement les
 *   sanctions totales (sanctions multilatérales) ; « none » : aucune.
 */
export function sanctionFor(state: GameState, cpId: string, c?: CommodityId) {
  const zone = zoneOf(cpId);
  const regime = playerRegime(state);
  return state.world.sanctions.find((s) => {
    if (s.zone !== zone) return false;
    if (s.c && c && s.c !== c) return false;
    if (regime === 'none') return false;
    if (regime === 'un') return s.kind === 'full' && state.world.blocTension > 70;
    return s.by === regime;
  });
}

export function isRestricted(state: GameState, cpId: string, c: CommodityId, deliveryCityId: string) {
  const zone = zoneOf(cpId);
  const destZone = CITY_ZONE[deliveryCityId];
  return state.world.restrictions.find((r) => r.c === c && r.zone === zone && (r.kind === 'exportBan' || r.importer === destZone));
}

export function pushNews(state: GameState, n: Omit<NewsItem, 'id' | 'day'>) {
  const item = addNews(state, n);
  if (n.major) state.pendingAlerts.push({ kind: 'major_news', text: n.headline });
  return item;
}

export function schedule(state: GameState, inDays: number, impacts: Impact[], news?: Omit<NewsItem, 'id' | 'day'>) {
  state.world.pending.push({ id: newId(state, 'st'), day: addBusinessDays(state.day, Math.max(1, inDays)), impacts, news });
}

/** Applique un impact (fraction `frac` pour les impacts numériques ; −1 pour annuler un impact). */
export function applyImpact(state: GameState, im: Impact, frac = 1) {
  const m = state.market;
  const w = state.world;
  switch (im.k) {
    case 'chi':
    case 'xi':
      if ((m.halted[im.c] ?? -1) >= state.day) {
        // cotation suspendue : l'information s'accumule et tombera à la réouverture
        const p = m.haltPending[im.c] ?? [0, 0];
        p[im.k === 'chi' ? 0 : 1] += im.v * frac;
        m.haltPending[im.c] = p;
      } else m.commodities[im.c][im.k] += im.v * frac;
      break;
    case 'iv':
      m.ivLevel[im.c] = Math.min(2.4, Math.max(0.7, m.ivLevel[im.c] + im.v * frac));
      break;
    case 'basis':
      m.basisShift[im.loc] = (m.basisShift[im.loc] ?? 0) + im.v * frac;
      if (Math.abs(m.basisShift[im.loc]!) < 1e-9) delete m.basisShift[im.loc];
      break;
    case 'regime':
      if (frac > 0 && m.volRegime === 'calm') {
        m.volRegime = 'stressed';
        m.volMult = state.config.volatility * 1.8;
        for (const c of Object.keys(m.commodities) as CommodityId[]) m.commodities[c].imRate = Math.max(m.commodities[c].imRate, exchangeImRate(m, c));
      }
      break;
    case 'rate':
      m.rates[im.ccy] = Math.max(0, m.rates[im.ccy] + im.v * frac);
      break;
    case 'halt':
      m.halted[im.c] = addBusinessDays(state.day, im.days);
      break;
    case 'stability': {
      const z = w.zones[im.zone];
      if (z) z.stability = Math.max(5, Math.min(100, z.stability + im.v * frac));
      break;
    }
    case 'tension':
      w.blocTension = Math.max(0, Math.min(100, w.blocTension + im.v * frac));
      break;
    case 'tax':
      w.cityRegs[im.city]!.taxRate = Math.max(0, Math.min(0.45, w.cityRegs[im.city]!.taxRate + im.v));
      break;
    case 'kyc':
      w.cityRegs[im.city]!.kyc = Math.max(0.2, Math.min(1, w.cityRegs[im.city]!.kyc + im.v));
      break;
    case 'capctl':
      w.cityRegs[im.city]!.capitalControls = im.on;
      break;
    case 'reporting':
      w.cityRegs[im.city]!.reportingFee = Math.max(0, w.cityRegs[im.city]!.reportingFee + im.v);
      break;
    case 'sanction':
      if (!w.sanctions.some((s) => s.zone === im.zone && s.kind === im.kind && s.by === im.by && s.c === im.c)) {
        w.sanctions.push({ id: newId(state, 'sa'), zone: im.zone, by: im.by, kind: im.kind, c: im.c, capPct: im.capPct, sinceDay: state.day });
        frustrateContracts(state);
      }
      break;
    case 'liftSanction':
      w.sanctions = w.sanctions.filter((s) => s.zone !== im.zone);
      break;
    case 'restriction':
      w.restrictions.push({ id: newId(state, 're'), kind: im.kind, zone: im.zone, importer: im.importer, c: im.c, untilDay: addBusinessDays(state.day, im.days) });
      break;
    case 'narrative':
      w.narratives.push({ id: im.id, name: im.name, drift: im.drift, untilDay: addBusinessDays(state.day, im.days) });
      recomputeDrift(state);
      break;
    case 'enso':
      w.enso = Math.max(-2.5, Math.min(2.5, w.enso + im.v * frac));
      break;
    case 'effect': {
      const e: ActiveEffect = { ...im.effect, id: newId(state, 'ef') };
      w.effects.push(e);
      for (const [loc, v] of Object.entries(e.basisShift ?? {})) applyImpact(state, { k: 'basis', loc, v });
      break;
    }
    case 'freezeCash': {
      const amount = Math.max(0, state.company.cash * im.pct);
      state.company.frozenCash = { amount, untilDay: addBusinessDays(state.day, im.days) };
      log(state, `Contrôle des capitaux : ${(amount / 1e6).toFixed(1)} M$ de trésorerie gelés.`);
      break;
    }
    case 'warehouseFraud': {
      for (const lot of state.inventory.filter((l) => l.locationId === im.loc)) {
        const lost = lot.qty * im.lossPct;
        lot.qty -= lost;
        log(state, `Fraude en entrepôt : ${lost.toFixed(0)} ${COMMODITIES[lot.commodity].qtyUnit} de vos stocks n’existaient pas.`);
        state.pendingAlerts.push({ kind: 'delivery', text: `Fraude en entrepôt : une partie de votre stock (${Math.round(im.lossPct * 100)} %) à ${im.loc} n’existait pas.` });
      }
      state.inventory = state.inventory.filter((l) => l.qty > 1e-9);
      break;
    }
    case 'companyHit':
    case 'companyDefault':
      // traités par le module des sociétés (companies.ts), qui s'enregistre ici pour éviter une dépendance circulaire
      companyHooks.apply?.(state, im);
      break;
  }
}

export const companyHooks: { apply?: (state: GameState, im: Impact) => void } = {};

export function recomputeDrift(state: GameState) {
  const d: Partial<Record<CommodityId, number>> = {};
  for (const n of state.world.narratives) for (const [c, v] of Object.entries(n.drift)) d[c as CommodityId] = (d[c as CommodityId] ?? 0) + (v ?? 0);
  state.market.drift = d;
}

/**
 * Sanctions nouvelles : les contrats physiques avec une contrepartie désormais sanctionnée deviennent
 * inexécutables (contrat « frustré » / force majeure) : ils sont annulés sans indemnité. Le MTM latent
 * (positif ou négatif) disparaît.
 */
export function frustrateContracts(state: GameState) {
  const hit = state.forwards.filter((d) => sanctionFor(state, d.counterpartyId, d.commodity)?.kind === 'full');
  if (!hit.length) return;
  state.forwards = state.forwards.filter((d) => !hit.includes(d));
  for (const d of hit) log(state, `Contrat ${COMMODITIES[d.commodity].short} avec ${COUNTERPARTY_BY_ID[d.counterpartyId]?.name} annulé : sanctions (force majeure).`);
  state.pendingAlerts.push({ kind: 'delivery', text: `${hit.length} contrat(s) physique(s) annulé(s) pour cause de sanctions : force majeure, sans indemnité.` });
  state.offers = state.offers.filter((o) => !sanctionFor(state, o.counterpartyId, o.commodity));
}

/** Évolution quotidienne : stabilité, tension, ENSO, fin des effets et restrictions, étapes différées. */
export function stepWorld(state: GameState) {
  const w = state.world;
  const rng = state.rng;
  for (const z of ZONES) {
    const zs = w.zones[z.id]!;
    zs.stability += 0.02 * (z.baseStability - zs.stability) + 0.6 * normal(rng);
    zs.stability = Math.max(5, Math.min(100, zs.stability));
  }
  w.blocTension = Math.max(0, Math.min(100, w.blocTension + 0.01 * (45 - w.blocTension) + 0.8 * normal(rng)));
  w.enso = Math.max(-2.5, Math.min(2.5, w.enso * 0.997 + 0.04 * normal(rng)));
  // El Niño : chaleur et sécheresse en Asie-Océanie (blé ↑, charbon ↑ pour la climatisation) ; La Niña : l'inverse, plus doux.
  const e = w.enso;
  if (Math.abs(e) > 0.5) {
    state.market.commodities.WHEAT.chi += 0.0008 * (e - Math.sign(e) * 0.5);
    state.market.commodities.API2.chi += 0.0005 * (e - Math.sign(e) * 0.5);
  }
  // Fin des effets temporaires
  const ended = w.effects.filter((x) => x.untilDay < state.day);
  for (const x of ended) for (const [loc, v] of Object.entries(x.basisShift ?? {})) applyImpact(state, { k: 'basis', loc, v: -v });
  w.effects = w.effects.filter((x) => x.untilDay >= state.day);
  w.restrictions = w.restrictions.filter((r) => r.untilDay >= state.day);
  const n0 = w.narratives.length;
  w.narratives = w.narratives.filter((n) => n.untilDay >= state.day);
  if (w.narratives.length !== n0) recomputeDrift(state);
  // Étapes différées (confirmations, démentis, impacts retardés)
  const due = w.pending.filter((p) => p.day <= state.day);
  w.pending = w.pending.filter((p) => p.day > state.day);
  for (const p of due) {
    for (const im of p.impacts) applyImpact(state, im);
    if (p.news) pushNews(state, p.news);
  }
}

export function zoneName(id: string) {
  return ZONE_BY_ID[id]?.name ?? id;
}
