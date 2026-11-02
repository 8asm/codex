/**
 * Phase 9 — Desks délégués : un trader recruté reçoit un mandat (limite de VaR) et prend seul des positions
 * futures sur les marchés de sa famille.
 *
 * D'où vient son avantage ? Uniquement de l'information : les prix futures sont des espérances risque-neutres
 * (martingales), sauf quand un narratif macro ajoute une dérive « réelle » au niveau d'équilibre ξ
 * (`market.drift`, inconnue du joueur). Le trader estime cette dérive avec un bruit qui dépend de sa compétence :
 *     vue = dérive réelle + σ_bruit · Z,   σ_bruit = 2 % + 20 % × (1 − compétence)
 * Son espérance de gain par an est donc Σ notionnel × dérive réelle, moins les coûts (fourchette, impact,
 * commissions, rolls). Un trader médiocre trade surtout son bruit : il perd ces coûts en moyenne.
 *
 * Décision : test à 2σ du bruit puis estimation rétrécie vers zéro (voir `traderSignal`).
 * Taille : pour chaque marché retenu, l'exposition visée consomme budget/√n de VaR (99 %, 1 jour, normale :
 * 2,33 σ_jour × notionnel) × min(1, dérive estimée / 12 %) ; puis le livre du desk est revalorisé avec le modèle de VaR
 * de la maison (corrélations comprises) et réduit s'il dépasse le mandat.
 *
 * Contrôles :
 *  - stop-loss mensuel à 4 × le budget de VaR : le desk est coupé jusqu'au mois suivant ;
 *  - trader « voyou » (Leeson, Kerviel) : un trader ambitieux, mal payé et en perte peut dépasser son mandat en
 *    dissimulant sa VaR (positions ×3, VaR déclarée ÷3, stop ignoré). Chaque risk manager et chaque juriste
 *    réduit la probabilité et accélère la détection ;
 *  - bonus annuel de 15 % du P&L positif de l'année, versé en janvier.
 * Les positions des desks sont de vraies positions de la maison : marge initiale, VM, VaR, valeur nette.
 */
import { COMMODITIES } from '../data/commodities';
import { businessDaysBetween, monthIndexOf, ymd } from './calendar';
import { lastTradingDay, listedMonths, lotQty } from './contracts';
import { addCash, log } from './ledger';
import { execPrice } from './liquidity';
import { contractVol, futuresPrice, fx, isHalted } from './market';
import { addNews } from './news';
import { activeCommodities } from './physical';
import { hashUniform } from './rng';
import { computeVar } from './risk';
import { addImpact, commissionUsd } from './trading';
import type { ActionResult, Book, CommodityId, DeskPosition, DeskRecord, DeskState, Employee, GameState } from './types';
import { recomputeIm } from './margin';

export const DESK_BUDGETS = [0, 100_000, 250_000, 500_000, 1_000_000];
export const STOP_MULT = 4;
export const BONUS_RATE = 0.15;
const Z99 = 2.326;
const MAX_MARKETS = 3;
const CONVICTION = 0.04; // dérive annuelle estimée (a posteriori) minimale pour prendre position
const PRIOR_SD = 0.1; // dispersion a priori des dérives de fond

export function deskState(s: GameState): DeskState {
  return (s.desks ??= { positions: [], records: {} });
}
export function deskRecord(s: GameState, id: string): DeskRecord {
  const d = deskState(s);
  return (d.records[id] ??= { pnlMonth: 0, pnlYear: 0, pnlTotal: 0, trades: 0 });
}
export function deskPositions(s: GameState, id?: string): DeskPosition[] {
  const p = s.desks?.positions ?? [];
  return id ? p.filter((x) => x.deskId === id) : p;
}
/** Toutes les positions futures de la maison (joueur + desks) : base de la marge initiale. */
export function allFutures(s: GameState) {
  const d = s.desks?.positions;
  return d && d.length ? [...s.futures, ...d] : s.futures;
}

const unitValue = (s: GameState, c: CommodityId) => COMMODITIES[c].valuePerUnit * fx(s.market, COMMODITIES[c].currency);
const mandated = (s: GameState) => (s.staff?.employees ?? []).filter((e) => e.role === 'trader' && e.mandate?.on && e.mandate.budget > 0);

function gauss(...keys: (string | number)[]): number {
  const u1 = Math.max(1e-12, hashUniform(...keys, 'a'));
  const u2 = hashUniform(...keys, 'b');
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Vue du trader sur la dérive annuelle d'un marché : réelle + bruit (tenu un mois). */
export function traderView(s: GameState, e: Employee, c: CommodityId): number {
  return (s.market.drift[c] ?? 0) + noiseSd(e) * gauss(s.config.seed, 'desk', e.id, c, monthIndexOf(s.day));
}

/** Écart-type du bruit de lecture d'un trader (dérive annuelle). */
export function noiseSd(e: Employee): number {
  return 0.02 + 0.2 * (1 - e.skill / 100);
}

/**
 * Décision d'un trader discipliné face à sa vue bruitée v = μ + σ·Z :
 *  - test : il ne trade que si |v| > 2σ (sinon la vue n'est pas distinguable de son propre bruit). Scanner une
 *    douzaine de marchés et garder les « meilleures » vues sans ce test, c'est trader le bruit (biais de sélection) ;
 *  - estimation : espérance a posteriori de μ avec un a priori N(0, τ²), τ = 10 % : v·τ²/(τ² + σ²) (rétrécissement).
 */
export function traderSignal(s: GameState, e: Employee, c: CommodityId): number {
  const v = traderView(s, e, c);
  const sd = noiseSd(e);
  if (Math.abs(v) <= 2 * sd) return 0;
  return (v * PRIOR_SD ** 2) / (PRIOR_SD ** 2 + sd * sd);
}

/** Échéance traitée par un desk : la première qui ne cote pas ses cinq derniers jours ouvrés. */
function deskMaturity(s: GameState, c: CommodityId): number {
  const spec = COMMODITIES[c];
  const months = listedMonths(spec, s.day);
  return months.find((mi) => businessDaysBetween(s.day, lastTradingDay(spec, mi)) > 5) ?? months[months.length - 1]!;
}

function record(s: GameState, e: Employee, amount: number) {
  const r = deskRecord(s, e.id);
  r.pnlMonth += amount;
  r.pnlYear += amount;
  r.pnlTotal += amount;
}

/** Remplissage d'un ordre du desk au prix exécutable (fourchette + taille), commission et impact compris. */
function fill(s: GameState, e: Employee, c: CommodityId, mi: number, lots: number) {
  if (lots === 0) return;
  const spec = COMMODITIES[c];
  const px = execPrice(s.market, c, mi, lots);
  const k = lotQty(spec, mi) * unitValue(s, c);
  const d = deskState(s);
  // coût de transaction (fourchette + taille) par rapport au mid, suivi pour l'affichage et l'analyse
  const rec = deskRecord(s, e.id);
  rec.costs = (rec.costs ?? 0) + (px - futuresPrice(s.market, c, mi)) * lots * k;
  const pos = d.positions.find((p) => p.deskId === e.id && p.commodity === c && p.month === mi);
  if (!pos) d.positions.push({ deskId: e.id, commodity: c, month: mi, lots, mark: px, avgPrice: px });
  else {
    // même astuce que le livre du joueur : on règle tout de suite (mark − prix) sur les nouveaux lots
    const vm = (pos.mark - px) * lots * k;
    addCash(s, vm, 'vm', c);
    record(s, e, vm);
    const after = pos.lots + lots;
    if (Math.sign(pos.lots) === Math.sign(lots)) pos.avgPrice = (pos.avgPrice * pos.lots + px * lots) / after;
    else if (after !== 0 && Math.sign(after) !== Math.sign(pos.lots)) pos.avgPrice = px;
    pos.lots = after;
    if (after === 0) d.positions = d.positions.filter((p) => p !== pos);
  }
  const comm = commissionUsd(s, c, lots);
  addCash(s, -comm, 'commission', c);
  record(s, e, -comm);
  rec.costs! += comm;
  addImpact(s, c, mi, lots);
  deskRecord(s, e.id).trades++;
  deskRecord(s, e.id).tradesMonth = (deskRecord(s, e.id).tradesMonth ?? 0) + 1;
  s.company.tradesThisMonth++;
}

/** Ferme toutes les positions d'un desk au marché. */
export function closeDesk(s: GameState, id: string) {
  const e = s.staff?.employees.find((x) => x.id === id);
  for (const p of deskPositions(s, id)) {
    if (e && !isHalted(s.market, p.commodity)) fill(s, e, p.commodity, p.month, -p.lots);
  }
  // un marché suspendu ou un trader parti : sortie au dernier prix de marquage (VM déjà réglée)
  deskState(s).positions = deskState(s).positions.filter((p) => p.deskId !== id || (e && isHalted(s.market, p.commodity)));
  recomputeIm(s);
}

/** Positions cibles (en lots) d'un desk, avant contrôle de VaR. */
function targets(s: GameState, e: Employee, mult: number): { c: CommodityId; mi: number; lots: number }[] {
  const fam = e.family;
  const pool = activeCommodities(s)
    .filter((c) => COMMODITIES[c].family === fam && !isHalted(s.market, c) && COMMODITIES[c].physical.storable !== false)
    .map((c) => ({ c, v: traderSignal(s, e, c) }))
    .filter((x) => Math.abs(x.v) > CONVICTION)
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, MAX_MARKETS);
  const budget = e.mandate!.budget * mult;
  const each = budget / Math.sqrt(Math.max(1, pool.length));
  return pool.map(({ c, v }) => {
    const spec = COMMODITIES[c];
    const mi = deskMaturity(s, c);
    // vol journalière en USD par unité (log-normale décalée : la vol porte sur F + décalage)
    const F = futuresPrice(s.market, c, mi) + (spec.model.shift ?? 0);
    const sdDay = (contractVol(s.market, c, mi) * F * unitValue(s, c)) / Math.sqrt(252);
    // taille proportionnelle à la dérive estimée (logique de Kelly), plafonnée au budget
    const conviction = Math.min(1, Math.abs(v) / 0.12);
    const units = (conviction * each) / (Z99 * sdDay);
    return { c, mi, lots: Math.sign(v) * Math.floor(units / lotQty(spec, mi)) };
  });
}

const deskBook = (positions: DeskPosition[]): Book => ({ futures: positions, forwards: [], inventory: [], options: [], otc: [], voyages: [], ffa: [], exotics: [], prepays: [] });

function rebalance(s: GameState, e: Employee) {
  const r = deskRecord(s, e.id);
  const mult = r.rogue ? 3 : 1;
  let tg = targets(s, e, mult);
  // contrôle avec le modèle de VaR de la maison (corrélations, vol de chaque échéance)
  if (tg.length) {
    const hypo = tg.map((t) => ({ deskId: e.id, commodity: t.c, month: t.mi, lots: t.lots, mark: futuresPrice(s.market, t.c, t.mi), avgPrice: 0 }));
    const v = computeVar(s, deskBook(hypo)).var99;
    const cap = e.mandate!.budget * mult;
    if (v > cap) tg = tg.map((t) => ({ ...t, lots: Math.trunc((t.lots * cap) / v) }));
  }
  const mine = deskPositions(s, e.id);
  // tout ce qui n'est pas dans la cible (autre marché ou ancienne échéance : roll) est fermé
  for (const p of mine) {
    const t = tg.find((x) => x.c === p.commodity && x.mi === p.month);
    if (!t && !isHalted(s.market, p.commodity)) fill(s, e, p.commodity, p.month, -p.lots);
  }
  for (const t of tg) {
    const cur = deskPositions(s, e.id).find((p) => p.commodity === t.c && p.month === t.mi)?.lots ?? 0;
    const diff = t.lots - cur;
    // pas de micro-ajustements : on ne bouge que si l'écart dépasse un quart de la cible
    if (diff !== 0 && Math.abs(diff) >= Math.max(1, 0.25 * Math.abs(t.lots))) fill(s, e, t.c, t.mi, diff);
  }
  const vTrue = deskPositions(s, e.id).length ? computeVar(s, deskBook(deskPositions(s, e.id))).var99 : 0;
  r.varTrue = vTrue;
  r.varReported = r.rogue ? vTrue / 3 : vTrue;
}

/** Séance des desks, aux prix du jour (avant les règlements du soir). */
export function deskTrading(s: GameState) {
  const d = s.desks;
  const team = mandated(s);
  // desks sans mandat (mandat retiré, trader parti) : débouclage
  for (const id of new Set((d?.positions ?? []).map((p) => p.deskId))) {
    if (!team.some((e) => e.id === id)) closeDesk(s, id);
  }
  for (const e of team) {
    const r = deskRecord(s, e.id);
    if (r.stopped) continue;
    if (!r.rogue && r.pnlMonth < -STOP_MULT * e.mandate!.budget) {
      closeDesk(s, e.id);
      r.stopped = true;
      s.pendingAlerts.push({ kind: 'delivery', text: `Stop-loss : le desk de ${e.name} a perdu plus de ${STOP_MULT} fois sa limite de VaR ce mois-ci. Positions fermées jusqu’au mois prochain.` });
      continue;
    }
    // rééquilibrage hebdomadaire (jour décalé par trader), ou roll d'une échéance qui approche
    const weekly = Math.floor(hashUniform(e.id, 'jour') * 5) === s.day % 5;
    const roll = deskPositions(s, e.id).some((p) => businessDaysBetween(s.day, lastTradingDay(COMMODITIES[p.commodity], p.month)) <= 5);
    if (weekly || roll || r.lastDay === undefined) {
      rebalance(s, e);
      r.lastDay = s.day;
    }
  }
  recomputeIm(s);
}

/** Marge de variation du soir sur les positions des desks. */
export function settleDesks(s: GameState) {
  const d = s.desks;
  if (!d || !d.positions.length) return;
  const byId = new Map((s.staff?.employees ?? []).map((e) => [e.id, e]));
  for (const p of d.positions) {
    const spec = COMMODITIES[p.commodity];
    const settle = futuresPrice(s.market, p.commodity, p.month);
    const vm = (settle - p.mark) * p.lots * lotQty(spec, p.month) * unitValue(s, p.commodity);
    addCash(s, vm, 'vm', p.commodity);
    const e = byId.get(p.deskId);
    if (e) record(s, e, vm);
    else {
      const r = deskRecord(s, p.deskId);
      r.pnlMonth += vm; r.pnlYear += vm; r.pnlTotal += vm;
    }
    p.mark = settle;
  }
  // filet de sécurité : une échéance arrivée à son terme (marché suspendu) est réglée en cash au dernier prix
  d.positions = d.positions.filter((p) => lastTradingDay(COMMODITIES[p.commodity], p.month) > s.day);
}

/** Liquidation forcée (défaut de marge) : les desks sont fermés au marché comme le reste du livre. */
export function liquidateDesks(s: GameState) {
  const d = s.desks;
  if (!d) return;
  for (const p of d.positions) {
    const spec = COMMODITIES[p.commodity];
    const px = execPrice(s.market, p.commodity, p.month, -p.lots);
    addCash(s, (px - p.mark) * p.lots * lotQty(spec, p.month) * unitValue(s, p.commodity), 'liquidation', p.commodity);
    addCash(s, -commissionUsd(s, p.commodity, p.lots), 'liquidation', p.commodity);
  }
  d.positions = [];
}

/** Au changement de mois : stop levé, dépassements dissimulés (apparition, détection), bonus annuel. */
export function deskMonth(s: GameState) {
  const team = mandated(s);
  const nRisk = (s.staff?.employees ?? []).filter((e) => e.role === 'risk').length;
  const nLegal = (s.staff?.employees ?? []).filter((e) => e.role === 'legal').length;
  // déclaration réglementaire : les transactions d'un trader rattaché à un bureau sont déclarées dans la
  // juridiction de ce bureau (et retirées du décompte du siège)
  for (const e of (s.staff?.employees ?? []).filter((x) => x.role === 'trader' && x.cityId !== s.company.hqCity)) {
    const r = s.desks?.records[e.id];
    const n = r?.tradesMonth ?? 0;
    if (!r || !n) continue;
    const fee = (s.world.cityRegs[e.cityId]?.reportingFee ?? 0) * n;
    if (fee > 0) {
      addCash(s, -fee, 'compliance');
      log(s, `Reporting réglementaire local (${e.name}) : ${n} transactions`, -fee);
    }
    s.company.tradesThisMonth = Math.max(0, s.company.tradesThisMonth - n);
  }
  for (const r of Object.values(s.desks?.records ?? {})) r.tradesMonth = 0;
  for (const e of team) {
    const r = deskRecord(s, e.id);
    const u = hashUniform(s.config.seed, 'rogue', e.id, s.day);
    if (!r.rogue) {
      const p = 0.04 * e.ambition * (1 - e.loyalty / 100) * (r.pnlMonth < 0 ? 3 : 1) * Math.max(0.25, 1 - 0.25 * nRisk);
      if (u < p) r.rogue = true;
    } else {
      const detect = Math.min(0.9, 0.2 + 0.2 * nRisk + 0.1 * nLegal + ((r.varTrue ?? 0) > 2 * e.mandate!.budget ? 0.15 : 0));
      if (u < detect) {
        r.rogue = false;
        closeDesk(s, e.id);
        e.mandate = { on: false, budget: e.mandate!.budget };
        e.loyalty = 0;
        s.stats.roguesCaught = (s.stats.roguesCaught ?? 0) + 1;
        const msg = `Le contrôle des risques découvre que ${e.name} dépassait son mandat en dissimulant sa VaR (P&L de l’année : ${(r.pnlYear / 1e6).toFixed(2)} M$). Positions fermées, mandat retiré.`;
        s.pendingAlerts.push({ kind: 'delivery', text: msg });
        log(s, msg);
        addNews(s, { headline: `Dépassement de mandat chez ${s.company.name} : un trader dissimulait ses positions`, tone: 'alert', major: false, category: 'entreprises' });
      }
    }
    r.pnlMonth = 0;
    if (r.stopped) r.lastDay = undefined; // reprise dès la levée du stop
    r.stopped = false;
  }
  // bonus de janvier sur l'année écoulée (tous les desks, y compris les mandats retirés)
  if (ymd(s.day).m === 1) {
    for (const e of (s.staff?.employees ?? []).filter((x) => x.role === 'trader')) {
      const r = s.desks?.records[e.id];
      if (!r) continue;
      const bonus = BONUS_RATE * Math.max(0, r.pnlYear);
      if (bonus > 0) {
        addCash(s, -bonus, 'overhead');
        log(s, `Bonus de ${e.name} (${Math.round(BONUS_RATE * 100)} % du P&L du desk)`, -bonus);
        e.loyalty = Math.min(100, e.loyalty + 15);
      } else if (r.pnlYear < 0) e.loyalty = Math.max(0, e.loyalty - 5);
      r.pnlLastYear = r.pnlYear;
      r.pnlYear = 0;
    }
  }
}

export function setMandate(s: GameState, id: string, budget: number): ActionResult {
  const e = s.staff?.employees.find((x) => x.id === id);
  if (!e || e.role !== 'trader') return { ok: false, message: 'Seuls les traders reçoivent un mandat.' };
  if (!DESK_BUDGETS.includes(budget)) return { ok: false, message: 'Limite de VaR invalide.' };
  e.mandate = { on: budget > 0, budget };
  if (budget === 0) closeDesk(s, id);
  return { ok: true, message: budget > 0 ? `${e.name} trade désormais seul, dans une limite de VaR de ${(budget / 1e3).toFixed(0)} k$.` : `Mandat de ${e.name} retiré : positions fermées.` };
}
