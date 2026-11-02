/**
 * Phase 7 — Financement du négoce.
 *
 *  - Crédit documentaire (lettre de crédit, LC) : certains vendeurs exigent qu'une banque garantisse le paiement.
 *    La banque du joueur émet la LC contre une commission (0,15 % à l'émission + 0,08 %/mois jusqu'à la
 *    livraison) et consomme sa ligne de financement du commerce. À la vente, un acheteur qui fournit une LC
 *    confirmée nous protège de son défaut : sa banque paie à sa place.
 *  - Financement de stock (borrowing base, économiquement un repo de matières premières) : la banque prête
 *    (1 − décote) × valeur du lot, au taux USD + 1,75 % (moins cher que la RCF à +2,5 %, et hors RCF). Si la
 *    valeur du lot baisse au point que le prêt dépasse (1 − décote/2) × valeur, appel de marge : on rembourse
 *    l'excédent, sinon la banque vend le lot. Toute sortie de stock rembourse le prêt au prorata.
 *  - Préfinancement : on paie aujourd'hui un producteur qui livre ensuite chaque mois une quantité fixe.
 *    C'est un achat à terme payé d'avance : exposition au prix (à couvrir) ET exposition de crédit au producteur.
 *    Valorisation : livraisons restantes au forward local, actualisées au taux sans risque + spread de crédit.
 *    Le spread est calibré à l'origine pour que valeur = prix payé (pas de gain du premier jour), puis suit les
 *    changements de notation du producteur (spread ≈ PD × (1 − récupération)).
 */
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { COUNTERPARTIES, COUNTERPARTY_BY_ID } from '../data/counterparties';
import { COMPANY_BY_ID } from '../data/companies';
import { RATING_PD, type Rating } from '../data/world';
import { addBusinessDays, monthIndexOf, yearFrac, ymd, type Day } from './calendar';
import { cpRating, RECOVERY } from './credit';
import { addCash, log, newId } from './ledger';
import { discount, fx, rate } from './market';
import { hashUniform } from './rng';
import type { ActionResult, ForwardDeal, GameState, MarketState, Offer, Prepayment } from './types';
import { localForwardIn, localSpot } from './valuation';

export const LC_ISSUE_FEE = 0.0015;
export const LC_MONTHLY_FEE = 0.0008;
export const LOAN_SPREAD = 0.0175;
export const HAIRCUT: Record<string, number> = { energy: 0.12, metals: 0.1, agri: 0.15 };
const DAYS_PER_MONTH = 365.25 / 12;

const fin = (state: GameState) => (state.financing ??= { lcs: [], loans: [], prepays: [], offers: [] });

/** Les banques ont-elles coupé les lignes (condamnation pour sanctions, par exemple) ? */
export function banksCut(state: GameState): boolean {
  return (state.compliance?.banksCutUntil ?? -1) >= state.day;
}

// ------------------------------------------------------------------ crédit documentaire

/** Ligne de financement du commerce : 3× les fonds propres, plafonnée à 6× le capital initial. */
export function lcLine(state: GameState, navValue: number): number {
  if (banksCut(state)) return 0;
  return Math.max(0, Math.min(3 * navValue, 6 * state.company.initialCapital) * (state.company.creditMult ?? 1));
}

export function lcUsed(state: GameState): number {
  return fin(state).lcs.reduce((s, l) => s + l.amount, 0);
}

/** Le vendeur exige-t-il une LC ? (tirage haché sur l'offre : ne consomme pas l'aléa principal) */
export function offerNeedsLc(state: GameState, o: Offer): boolean {
  if (o.side < 0) return false;
  const kind = COUNTERPARTY_BY_ID[o.counterpartyId]?.kind;
  const p = 0.2 + (kind === 'producer' || kind === 'miner' ? 0.35 : 0) + (state.company.initialCapital < 50e6 ? 0.1 : 0);
  return hashUniform(state.config.seed, o.id, 'lc') < p;
}

/** L'acheteur fournit-il une LC confirmée ? (plus fréquent pour les acheteurs moins bien notés) */
export function offerHasBuyerLc(state: GameState, o: Offer): boolean {
  if (o.side > 0) return false;
  const weak = ['BB', 'B', 'CCC'].includes(cpRating(state, o.counterpartyId));
  return hashUniform(state.config.seed, o.id, 'lcb') < 0.25 + (weak ? 0.35 : 0);
}

/** Émet la LC d'un achat ; renvoie un message d'erreur si la ligne est insuffisante. */
export function issueLc(state: GameState, deal: ForwardDeal, notional: number, navValue: number): string | null {
  const head = lcLine(state, navValue) - lcUsed(state);
  if (banksCut(state)) return 'Les banques ont coupé vos lignes : impossible d’émettre une lettre de crédit.';
  if (notional > head) return `Ligne de crédit documentaire insuffisante (disponible ${(Math.max(0, head) / 1e6).toFixed(1)} M$).`;
  fin(state).lcs.push({ id: newId(state, 'lc'), dealId: deal.id, amount: notional, issued: state.day, expiry: deal.deliveryDay });
  const fee = notional * LC_ISSUE_FEE;
  addCash(state, -fee, 'financing', deal.commodity);
  deal.lc = 'issued';
  state.stats.lcsIssued++;
  log(state, `Lettre de crédit émise (${(notional / 1e6).toFixed(2)} M$)`, -fee);
  return null;
}

// ------------------------------------------------------------------ financement de stock

export function haircutFor(c: keyof typeof COMMODITIES): number {
  return HAIRCUT[COMMODITIES[c].family] ?? 0.15;
}

function lotValueUsd(state: GameState, lotId: string): number {
  const lot = state.inventory.find((l) => l.id === lotId);
  if (!lot) return 0;
  const spec = COMMODITIES[lot.commodity];
  return lot.qty * localSpot(state, lot.commodity, lot.locationId, lot.grade) * (lot.quality ?? 1) * spec.valuePerUnit * fx(state.market, spec.currency);
}

export function financeLot(state: GameState, lotId: string): ActionResult {
  const lot = state.inventory.find((l) => l.id === lotId);
  if (!lot) return { ok: false, message: 'Stock introuvable.' };
  if (banksCut(state)) return { ok: false, message: 'Les banques ont coupé vos lignes.' };
  if (fin(state).loans.some((x) => x.lotId === lotId)) return { ok: false, message: 'Ce lot est déjà nanti.' };
  const h = haircutFor(lot.commodity);
  const principal = (1 - h) * lotValueUsd(state, lotId);
  if (principal < 50_000) return { ok: false, message: 'Lot trop petit pour être financé.' };
  fin(state).loans.push({ id: newId(state, 'ln'), lotId, principal, haircut: h, rate: LOAN_SPREAD, since: state.day, qty: lot.qty });
  addCash(state, principal, 'financing');
  state.stats.lotsFinanced++;
  log(state, `Financement de stock ${COMMODITIES[lot.commodity].short} : ${(principal / 1e6).toFixed(2)} M$ (décote ${Math.round(h * 100)} %)`, principal);
  return { ok: true, message: `Stock nanti : ${(principal / 1e6).toFixed(2)} M$ reçus, au taux USD + ${(LOAN_SPREAD * 100).toFixed(2)} %.` };
}

export function repayLoan(state: GameState, id: string): ActionResult {
  const f = fin(state);
  const l = f.loans.find((x) => x.id === id);
  if (!l) return { ok: false, message: 'Prêt introuvable.' };
  addCash(state, -l.principal, 'financing');
  f.loans = f.loans.filter((x) => x !== l);
  return { ok: true, message: `Prêt remboursé (${(l.principal / 1e6).toFixed(2)} M$), stock libéré.` };
}

export function loansOutstanding(state: GameState): number {
  return (state.financing?.loans ?? []).reduce((s, l) => s + l.principal, 0);
}

// ------------------------------------------------------------------ préfinancement

export function creditSpread(r: string): number {
  return (RATING_PD[r as Rating] ?? 0.01) * (1 - RECOVERY);
}

/** Valeur (USD) des livraisons restantes d'un préfinancement. */
export function prepayValueIn(m: MarketState, day: Day, p: Prepayment, ratingNow: string): number {
  const spec = COMMODITIES[p.commodity];
  const k = spec.valuePerUnit * fx(m, spec.currency);
  const s = p.spread0 + creditSpread(ratingNow) - creditSpread(p.rating0);
  return p.schedule.reduce((acc, x) => {
    const t = Math.max(0, yearFrac(day, x.day));
    return acc + x.qty * localForwardIn(m, p.commodity, p.locationId, x.day) * discount(m, spec.currency, day, x.day) * Math.exp(-s * t) * k;
  }, 0);
}

export function prepayValue(state: GameState, p: Prepayment): number {
  return prepayValueIn(state.market, state.day, p, cpRating(state, p.counterpartyId));
}

/** Échéancier : une livraison au milieu de chacun des mois suivants. */
function scheduleFor(state: GameState, months: number, qty: number): { day: Day; qty: number }[] {
  const out = [];
  const mi = monthIndexOf(state.day);
  for (let i = 1; i <= months; i++) {
    const m = mi + i;
    const y = Math.floor(m / 12), mo = (m % 12) + 1;
    const d = Math.round(Date.UTC(y, mo - 1, 15) / 86_400_000);
    out.push({ day: addBusinessDays(d - 1, 1), qty });
  }
  return out;
}

/** Prix à payer et spread implicite. */
export function prepayTerms(state: GameState, o: { commodity: Prepayment['commodity']; locationId: string; months: number; qtyPerMonth: number; discount: number }) {
  const spec = COMMODITIES[o.commodity];
  const sched = scheduleFor(state, o.months, o.qtyPerMonth);
  const k = spec.valuePerUnit * fx(state.market, spec.currency);
  const legs = sched.map((x) => ({ t: yearFrac(state.day, x.day), pv: x.qty * localForwardIn(state.market, o.commodity, o.locationId, x.day) * discount(state.market, spec.currency, state.day, x.day) * k }));
  const pv = legs.reduce((s, l) => s + l.pv, 0);
  const paid = pv * (1 - o.discount);
  // spread s tel que Σ pv·e^{−s t} = prix payé (bissection : la valeur décroît avec s)
  let lo = 0, hi = 2;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    const v = legs.reduce((s, l) => s + l.pv * Math.exp(-mid * l.t), 0);
    if (v > paid) lo = mid;
    else hi = mid;
  }
  return { sched, paid, spread: (lo + hi) / 2, pv };
}

export function acceptPrepay(state: GameState, offerId: string): ActionResult {
  const f = fin(state);
  const o = f.offers.find((x) => x.id === offerId);
  if (!o) return { ok: false, message: 'Offre expirée.' };
  if (cpRating(state, o.counterpartyId) === 'D') return { ok: false, message: 'Producteur en défaut.' };
  const t = prepayTerms(state, o);
  if (t.paid > state.company.cash - state.company.im) return { ok: false, message: `Trésorerie insuffisante : ${(t.paid / 1e6).toFixed(1)} M$ à verser.` };
  const spec = COMMODITIES[o.commodity];
  const Q = o.months * o.qtyPerMonth;
  addCash(state, -t.paid, 'physical', o.commodity);
  f.prepays.push({
    id: newId(state, 'pp'), counterpartyId: o.counterpartyId, commodity: o.commodity, locationId: o.locationId, schedule: t.sched,
    paid: t.paid, unitCost: t.paid / (Q * spec.valuePerUnit * fx(state.market, spec.currency)), spread0: t.spread, rating0: cpRating(state, o.counterpartyId), tradeDay: state.day,
  });
  f.offers = f.offers.filter((x) => x !== o);
  log(state, `Préfinancement ${COUNTERPARTY_BY_ID[o.counterpartyId]?.name} : ${(t.paid / 1e6).toFixed(2)} M$ contre ${Q.toLocaleString('fr-FR')} ${spec.qtyUnit} de ${spec.short}`, -t.paid);
  return { ok: true, message: `Préfinancement versé : ${(t.paid / 1e6).toFixed(2)} M$. Livraisons mensuelles à partir du mois prochain — pensez à couvrir le prix.` };
}

/** Nouvelles offres de préfinancement (au changement de mois), tirages hachés. */
function refreshPrepayOffers(state: GameState) {
  const f = fin(state);
  f.offers = f.offers.filter((o) => o.expiresDay >= state.day);
  const producers = COUNTERPARTIES.filter((c) => (c.kind === 'producer' || c.kind === 'miner') && cpRating(state, c.id) !== 'D');
  for (let i = 0; f.offers.length < 2 && i < 3; i++) {
    const u = (k: string) => hashUniform(state.config.seed, state.day, 'prepay', i, k);
    if (!producers.length || u('go') > 0.6) continue;
    const cp = producers[Math.floor(u('cp') * producers.length)]!;
    const desks = Object.keys(COMPANY_BY_ID[cp.id]?.desks ?? {}).filter((c) => (COMMODITY_IDS as string[]).includes(c));
    const c = (desks.length ? desks[Math.floor(u('c') * desks.length)] : COMMODITY_IDS[Math.floor(u('c') * COMMODITY_IDS.length)]) as Prepayment['commodity'];
    const spec = COMMODITIES[c];
    const loc = spec.physical.locations[Math.floor(u('loc') * spec.physical.locations.length)]!;
    const months = [6, 9, 12][Math.floor(u('m') * 3)]!;
    const qtyPerMonth = Math.round((spec.physical.cargoSizes[0]! * (0.3 + 0.4 * u('q'))) / 100) * 100;
    // décote : spread de crédit + coût de financement du négociant, sur la maturité moyenne
    const avgT = (months + 1) / 24;
    const disc = Math.min(0.25, (creditSpread(cpRating(state, cp.id)) + 0.03 + 0.02 * u('d')) * avgT);
    f.offers.push({ id: newId(state, 'po'), counterpartyId: cp.id, commodity: c, locationId: loc.id, months, qtyPerMonth, discount: disc, expiresDay: addBusinessDays(state.day, 10) });
  }
}

// ------------------------------------------------------------------ clôture quotidienne

/** Commissions, intérêts, appels de marge des prêts, livraisons des préfinancements, offres. */
export function stepFinancing(state: GameState, days: number, newMonth: boolean): string[] {
  const msgs: string[] = [];
  const f = fin(state);
  // LC : commission courue ; la LC s'éteint quand l'achat est livré ou résilié
  const live = new Set(state.forwards.map((d) => d.id));
  const lcFee = f.lcs.reduce((s, l) => s + l.amount, 0) * LC_MONTHLY_FEE * (days / DAYS_PER_MONTH);
  if (lcFee > 0) addCash(state, -lcFee, 'financing');
  f.lcs = f.lcs.filter((l) => live.has(l.dealId));
  // Prêts sur stock : remboursement au prorata des sorties, intérêts, contrôle de la décote
  const r = rate(state.market, 'USD');
  for (const l of [...f.loans]) {
    const lot = state.inventory.find((x) => x.id === l.lotId);
    const q = lot?.qty ?? 0;
    if (q < l.qty - 1e-9) {
      const rep = l.principal * (1 - q / l.qty);
      addCash(state, -rep, 'financing');
      l.principal -= rep;
      l.qty = q;
    }
    if (!lot || l.principal < 1) {
      f.loans = f.loans.filter((x) => x !== l);
      continue;
    }
    addCash(state, -l.principal * (r + l.rate) * (days / 360), 'financing');
    const value = lotValueUsd(state, l.lotId);
    if (l.principal > (1 - l.haircut / 2) * value) {
      const need = l.principal - (1 - l.haircut) * value;
      if (state.company.cash - state.company.im >= need) {
        addCash(state, -need, 'financing');
        l.principal -= need;
        msgs.push(`Appel de marge sur stock nanti (${COMMODITIES[lot.commodity].short}) : ${(need / 1e3).toFixed(0)} k$ remboursés pour rétablir la décote.`);
      } else {
        // la banque réalise son gage : vente du lot au spot, remboursement intégral
        const spec = COMMODITIES[lot.commodity];
        const proceeds = value * (1 - spec.physical.spotSpreadPct);
        addCash(state, proceeds - l.principal, 'physical', lot.commodity);
        state.inventory = state.inventory.filter((x) => x !== lot);
        f.loans = f.loans.filter((x) => x !== l);
        msgs.push(`La banque a vendu votre stock nanti de ${spec.short} faute de couverture de l’appel de marge.`);
      }
    }
  }
  // Préfinancements : livraisons du jour
  for (const p of [...f.prepays]) {
    const due = p.schedule.filter((x) => x.day <= state.day);
    if (!due.length) continue;
    const spec = COMMODITIES[p.commodity];
    const qty = due.reduce((s, x) => s + x.qty, 0);
    state.inventory.push({ id: newId(state, 'i'), commodity: p.commodity, locationId: p.locationId, qty, cost: p.unitCost, sinceDay: state.day });
    p.schedule = p.schedule.filter((x) => x.day > state.day);
    msgs.push(`Préfinancement : ${qty.toLocaleString('fr-FR')} ${spec.qtyUnit} de ${spec.short} livrés par ${COUNTERPARTY_BY_ID[p.counterpartyId]?.name}.`);
    if (!p.schedule.length) {
      f.prepays = f.prepays.filter((x) => x !== p);
      state.stats.prepaysDone++;
    }
  }
  if (newMonth) refreshPrepayOffers(state);
  return msgs;
}

/** Libellé lisible d'une date (utile à l'UI). */
export function monthName(day: Day): string {
  const { m, y } = ymd(day);
  return `${['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'][m - 1]} ${y}`;
}
