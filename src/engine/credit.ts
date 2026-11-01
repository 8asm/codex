/**
 * Risque de contrepartie.
 *
 *  - Notations : dynamiques pour les sociétés simulées (fonds propres, appétit, réputation), fixes pour les
 *    autres, dégradées par l'instabilité de leur pays. Probabilités de défaut annuelles type agences.
 *  - Défaut : tous les contrats avec la contrepartie sont résiliés et COMPENSÉS (close-out netting, comme sous
 *    un accord-cadre ISDA / GTMA) : un seul montant net par contrepartie. S'il nous est dû, on récupère ~35 %
 *    (créance chirographaire) ; si on le doit, on le paie intégralement.
 *  - CSA (Credit Support Annex) par banque : échange quotidien de collatéral sur le MTM net des OTC. Il supprime
 *    presque le risque de défaut… mais consomme du cash quand le MTM est contre nous. Sans CSA, la banque facture
 *    une CVA (fourchette ×1,3).
 *  - Assurance-crédit : prime annuelle sur l'encours physique, couvre 90 % des pertes de défaut sur le physique.
 */
import { COMPANY_BY_ID } from '../data/companies';
import { COUNTERPARTY_BY_ID } from '../data/counterparties';
import { RATING_PD, RATINGS, type Rating } from '../data/world';
import { addBusinessDays } from './calendar';
import { otcValueUsd } from './derivatives';
import { addCash, log } from './ledger';
import { addNews } from './news';
import { notionalUsd } from './physical';
import { chance } from './rng';
import type { GameState } from './types';
import { forwardMtm } from './valuation';

export const RECOVERY = 0.35;
export const INSURANCE_COVER = 0.9;
export const INSURANCE_PREMIUM = 0.004; // par an, sur le notionnel physique ouvert
export const CVA_MULT = 1.3;

export function cpRating(state: GameState, id: string): Rating {
  const ai = state.companies.find((c) => c.id === id);
  if (ai) return (ai.alive ? ai.rating : 'D') as Rating;
  if ((state.credit.defaulted?.[id] ?? -1) >= state.day) return 'D';
  const def = COMPANY_BY_ID[id];
  let idx = RATINGS.indexOf(def?.rating ?? 'BBB');
  const zone = COUNTERPARTY_BY_ID[id]?.zone;
  const st = zone ? state.world.zones[zone]?.stability ?? 80 : 80;
  if (st < 30) idx += 2;
  else if (st < 50) idx += 1;
  return RATINGS[Math.min(RATINGS.length - 2, idx)]!;
}

export function cpPD(state: GameState, id: string): number {
  return RATING_PD[cpRating(state, id)];
}

/** Exposition (MTM positif net) envers une contrepartie, physique + OTC − collatéral reçu. */
export function exposureTo(state: GameState, id: string): { physical: number; otc: number; collateral: number; net: number } {
  const physical = state.forwards.filter((d) => d.counterpartyId === id).reduce((s, d) => s + forwardMtm(state, d), 0);
  const otc = state.otc.filter((x) => x.bankId === id).reduce((s, x) => s + otcValueUsd(state, x), 0);
  const collateral = state.credit.collateral[id] ?? 0;
  return { physical, otc, collateral, net: physical + otc + collateral };
}

/**
 * Défaut d'une contrepartie : close-out netting par contrepartie.
 * Physique et OTC sont deux ensembles de compensation distincts (accords-cadres différents) ; le collatéral
 * posté auprès d'une banque défaillante devient lui aussi une créance.
 */
export function handleDefault(state: GameState, id: string) {
  const name = COUNTERPARTY_BY_ID[id]?.name ?? id;
  const phys = state.forwards.filter((d) => d.counterpartyId === id);
  const otc = state.otc.filter((x) => x.bankId === id);
  const physMtm = phys.reduce((s, d) => s + forwardMtm(state, d), 0);
  const otcMtm = otc.reduce((s, x) => s + otcValueUsd(state, x), 0);
  const coll = state.credit.collateral[id] ?? 0;
  let loss = 0, recovered = 0, insured = 0;
  const settle = (amount: number, insurable: boolean) => {
    if (amount > 0) {
      const rec = amount * RECOVERY;
      const lost = amount - rec;
      const ins = insurable && state.credit.insurance ? lost * INSURANCE_COVER : 0;
      addCash(state, rec + ins, 'credit');
      loss += lost - ins;
      recovered += rec;
      insured += ins;
    } else if (amount < 0) {
      addCash(state, amount, 'credit'); // on paie ce qu'on doit à la masse
    }
  };
  if (phys.length) settle(physMtm, true);
  if (otc.length || coll) {
    // Collatéral posté (coll > 0) : il s'ajoute à notre créance. Reçu (coll < 0) : on le conserve en compensation.
    settle(otcMtm + coll, false);
    delete state.credit.collateral[id];
  }
  state.forwards = state.forwards.filter((d) => d.counterpartyId !== id);
  state.otc = state.otc.filter((x) => x.bankId !== id);
  state.offers = state.offers.filter((o) => o.counterpartyId !== id);
  if (phys.length || otc.length || coll) {
    state.credit.losses.push({ day: state.day, cp: id, loss, recovered, insured });
    const msg = `Défaut de ${name} : ${phys.length + otc.length} contrat(s) résilié(s) et compensé(s). Perte nette ${(loss / 1e6).toFixed(2)} M$${insured > 0 ? ` (assurance-crédit : ${(insured / 1e6).toFixed(2)} M$ remboursés)` : ''}.`;
    log(state, msg, -loss);
    state.pendingAlerts.push({ kind: 'delivery', text: msg });
  }
}

/**
 * Fin de journée : collatéral CSA, prime d'assurance-crédit, défauts des contreparties non simulées.
 * Le collatéral déplace du cash sans changer la NAV (il reste un actif ou un passif).
 */
export function stepCredit(state: GameState, days: number) {
  const cr = state.credit;
  const banks = new Set([...state.otc.map((x) => x.bankId), ...Object.keys(cr.collateral)]);
  for (const b of banks) {
    if (!cr.csa[b]) continue;
    const net = state.otc.filter((x) => x.bankId === b).reduce((s, x) => s + otcValueUsd(state, x), 0);
    const target = -net; // on poste quand notre MTM est négatif, on reçoit quand il est positif
    const move = target - (cr.collateral[b] ?? 0);
    if (Math.abs(move) > 1) {
      state.company.cash -= move;
      cr.collateral[b] = target;
    }
  }
  for (const b of Object.keys(cr.collateral)) {
    if (!cr.csa[b] || !state.otc.some((x) => x.bankId === b)) {
      state.company.cash += cr.collateral[b]!; // restitution
      delete cr.collateral[b];
    }
  }
  if (cr.insurance && days > 0) {
    const notional = state.forwards.reduce((s, d) => s + notionalUsd(state, d.commodity, d.qty, d.price), 0);
    if (notional > 0) addCash(state, -notional * INSURANCE_PREMIUM * (days / 365), 'credit');
  }
  // Défauts des contreparties à notation fixe (producteurs, utilities)
  const stress = state.market.volRegime === 'stressed' ? 2 : 1;
  const ids = new Set(state.forwards.map((d) => d.counterpartyId));
  for (const id of ids) {
    if (state.companies.some((c) => c.id === id)) continue;
    const pd = cpPD(state, id);
    if (chance(state.rng, (pd * stress * days) / 365)) {
      cr.defaulted[id] = addBusinessDays(state.day, 250);
      addNews(state, { headline: `${COUNTERPARTY_BY_ID[id]?.name ?? id} se déclare en cessation de paiements`, body: 'Ses contrats sont résiliés ; les créanciers récupéreront une fraction de leurs créances.', tone: 'alert', major: true, category: 'entreprises', companyId: id });
      handleDefault(state, id);
    }
  }
}

export function insuranceCostAnnual(state: GameState) {
  return state.forwards.reduce((s, d) => s + notionalUsd(state, d.commodity, d.qty, d.price), 0) * INSURANCE_PREMIUM;
}

