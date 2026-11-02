/**
 * Phase 7 — Conformité, sanctions, abus de marché, corruption, enquêtes.
 *
 * Aucune morale imposée : des raccourcis rapportent (cargaisons sous sanctions bradées, commissions d'intermédiaire,
 * positions dominantes à l'échéance), et créent des DOSSIERS latents. Chaque mois, l'autorité compétente peut les
 * découvrir ; une enquête suit alors des étapes (enquête → poursuites → jugement → appel), avec des frais d'avocats,
 * une stratégie de défense, une transaction possible et des conséquences : amende (confiscation du gain × 2
 * + forfait par gravité), lignes bancaires coupées, licence suspendue, et pour un dirigeant en mode carrière,
 * interdiction d'exercer ou prison.
 *
 * Le programme de conformité (minimal / standard / renforcé) coûte des salaires et des postes, mais :
 *  - contrôle avant opération : alerte (standard) ou blocage (renforcé) ;
 *  - détecte en interne les dossiers, ce qui ouvre l'auto-déclaration (amende divisée par deux, sans autre suite) ;
 *  - réduit l'amende (crédit accordé aux programmes de conformité effectifs : ×1,3 / ×1 / ×0,6).
 *
 * Sanctions secondaires : un siège hors du régime occidental peut acheter des barils sous sanctions occidentales,
 * mais l'autorité américaine poursuit quiconque utilise le dollar : le risque existe partout.
 *
 * Les tirages utilisent `hashUniform` (graine, jour, dossier) : la séquence aléatoire du marché reste inchangée.
 */
import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { COUNTERPARTIES, COUNTERPARTY_BY_ID } from '../data/counterparties';
import { addBusinessDays, formatDay, ymd, type Day } from './calendar';
import { lastTradingDay, listedMonths, lotQty, physicalDeliveryDay } from './contracts';
import { cpRating } from './credit';
import { addCash, log, newId } from './ledger';
import { forwardAt } from './market';
import { addNews } from './news';
import { hashUniform } from './rng';
import type { ActionResult, CaseFile, CaseKind, ComplianceLevel, ComplianceState, DefenseStrategy, GameState, Investigation, Offer } from './types';
import { exposures, nav } from './valuation';

export const LEVELS: Record<ComplianceLevel, { monthly: number; seats: number; fineMult: number; detect: number; label: string }> = {
  minimal: { monthly: 0, seats: 0, fineMult: 1.3, detect: 0.15, label: 'Minimal (le juriste à temps partiel)' },
  standard: { monthly: 60_000, seats: 1, fineMult: 1, detect: 0.6, label: 'Standard (un responsable conformité)' },
  renforcé: { monthly: 180_000, seats: 3, fineMult: 0.6, detect: 0.95, label: 'Renforcé (équipe, filtrage automatique)' },
};

/** Limites de position « mois spot » des bourses (lots), applicables dans les 15 derniers jours de cotation. */
export const SPOT_MONTH_LIMIT: Record<string, number> = { BRENT: 1000, TTF: 600, CU: 400, WHEAT: 600, API2: 300 };
const SPOT_WINDOW = 15;
const STATUTE_DAYS = 5 * 365;

export function defaultCompliance(): ComplianceState {
  return { level: 'minimal', cases: [], investigations: [], suspendedUntil: -1, banksCutUntil: -1, fines: 0, bribeOffers: [] };
}

const comp = (s: GameState) => (s.compliance ??= defaultCompliance());

export function complianceSeats(state: GameState): number {
  return LEVELS[comp(state).level].seats;
}

export function suspended(state: GameState): boolean {
  return comp(state).suspendedUntil >= state.day;
}

const AUTHORITY: Record<CaseKind, (s: GameState) => string> = {
  sanctions: () => 'Bureau américain de contrôle des avoirs étrangers (BCAE)',
  kyc: (s) => CITY_BY_ID[s.company.hqCity]!.regulator,
  manipulation: () => 'Commission des marchés à terme et la bourse',
  corruption: (s) => `Parquet financier (${CITY_BY_ID[s.company.hqCity]!.country})`,
  initié: (s) => CITY_BY_ID[s.company.hqCity]!.regulator,
};

const KIND_LABEL: Record<CaseKind, string> = { sanctions: 'violation de sanctions', kyc: 'manquements KYC / blanchiment', manipulation: 'manipulation de marché', corruption: 'corruption d’agent public', initié: 'délit d’initié' };

export function caseKindLabel(k: CaseKind) {
  return KIND_LABEL[k];
}

/** Enregistre un fait répréhensible ; la conformité le repère avec une probabilité dépendant de son niveau. */
export function recordCase(state: GameState, kind: CaseKind, severity: number, gain: number, label: string): CaseFile {
  const c = comp(state);
  const id = newId(state, 'cf');
  const flagged = hashUniform(state.config.seed, id, 'flag') < LEVELS[c.level].detect;
  const f: CaseFile = { id, day: state.day, kind, severity: Math.max(1, Math.min(5, severity)), gain: Math.max(0, gain), label, flagged, status: 'latent' };
  c.cases.push(f);
  if (flagged && c.level !== 'minimal') state.pendingAlerts.push({ kind: 'advice', text: `Conformité : ${label}. Ce dossier pourrait intéresser ${AUTHORITY[kind](state)}.` });
  return f;
}

// ------------------------------------------------------------------ contrôles avant opération

export interface PreTrade {
  block?: string;
  warn?: string;
  /** dossiers à ouvrir si l'opération est exécutée */
  cases: { kind: CaseKind; severity: number; gain: number; label: string }[];
}

/** Une offre physique vient-elle d'une zone sous sanctions (de qui que ce soit) ? */
export function sanctionedOrigin(state: GameState, o: Pick<Offer, 'counterpartyId'>): boolean {
  const zone = COUNTERPARTY_BY_ID[o.counterpartyId]?.zone;
  return !!zone && state.world.sanctions.some((s) => s.zone === zone);
}

/** Contrôle d'une offre physique avant acceptation (edge : valeur de l'affaire pour le joueur, USD). */
export function checkOffer(state: GameState, o: Offer, notional: number, edge: number, kycRiskyCp: boolean): PreTrade {
  const c = comp(state);
  const out: PreTrade = { cases: [] };
  const name = COUNTERPARTY_BY_ID[o.counterpartyId]?.name ?? o.counterpartyId;
  if (sanctionedOrigin(state, o)) {
    out.cases.push({ kind: 'sanctions', severity: 2 + notional / 15e6, gain: Math.max(0, edge), label: `Achat de ${COMMODITIES[o.commodity].short} d’origine sanctionnée auprès de ${name}` });
  }
  if (o.bribe) out.cases.push({ kind: 'corruption', severity: 3 + (o.bribe > 400_000 ? 1 : 0), gain: Math.max(0, edge), label: `Commission de ${(o.bribe / 1e3).toFixed(0)} k$ versée à un intermédiaire pour un contrat de ${name}` });
  // KYC : seule une contrepartie réellement opaque (notation spéculative et zone instable) crée un risque de blanchiment
  const st = state.world.zones[COUNTERPARTY_BY_ID[o.counterpartyId]?.zone ?? '']?.stability ?? 80;
  if (kycRiskyCp && c.level === 'minimal' && st < 45 && ['B', 'CCC'].includes(cpRating(state, o.counterpartyId))) out.cases.push({ kind: 'kyc', severity: 1, gain: 0, label: `Diligences KYC sommaires sur ${name}` });
  if (out.cases.length) {
    const what = out.cases.map((x) => KIND_LABEL[x.kind]).join(', ');
    if (c.level === 'renforcé' && out.cases.some((x) => x.kind !== 'kyc')) out.block = `La conformité bloque l’opération (${what}).`;
    else if (c.level === 'standard' && out.cases.some((x) => x.kind !== 'kyc')) out.warn = `Avertissement de la conformité : risque de ${what}.`;
  }
  return out;
}

/**
 * Exemption de couverture de bonne foi (comme aux États-Unis) : la part de la position futures qui couvre une
 * exposition physique de sens opposé (stocks, forwards, cargaisons, préfinancements) ne compte pas dans la limite.
 */
export function bonaFideHedgeLots(state: GameState, c: (typeof COMMODITY_IDS)[number], month: number, lotsAfter: number): number {
  const e = exposures(state).find((x) => x.commodity === c);
  if (!e) return 0;
  const phys = e.forwardQty + e.inventoryQty + e.transitQty;
  if (Math.sign(phys) === Math.sign(lotsAfter) || phys === 0) return 0;
  return Math.abs(phys) / lotQty(COMMODITIES[c], month);
}

/** Dépassement de la limite mois spot après l'ordre (0 hors de la fenêtre des 15 derniers jours). */
export function spotMonthExcess(state: GameState, c: (typeof COMMODITY_IDS)[number], month: number, lotsAfter: number): number {
  const spec = COMMODITIES[c];
  const ltd = lastTradingDay(spec, month);
  if (ltd - state.day > SPOT_WINDOW) return 0;
  return Math.max(0, Math.round(Math.abs(lotsAfter) - SPOT_MONTH_LIMIT[c]! - bonaFideHedgeLots(state, c, month, lotsAfter)));
}

export function checkFuture(state: GameState, c: (typeof COMMODITY_IDS)[number], month: number, lots: number): PreTrade {
  const cur = state.futures.find((p) => p.commodity === c && p.month === month)?.lots ?? 0;
  const ex = spotMonthExcess(state, c, month, cur + lots);
  const out: PreTrade = { cases: [] };
  if (ex > 0 && Math.abs(cur + lots) > Math.abs(cur)) {
    const msg = `limite de position mois spot (${SPOT_MONTH_LIMIT[c]} lots) dépassée de ${ex} lots`;
    if (comp(state).level === 'renforcé') out.block = `La conformité bloque l’ordre : ${msg}.`;
    else if (comp(state).level === 'standard') out.warn = `Attention : ${msg}. La bourse va réagir.`;
  }
  return out;
}

// ------------------------------------------------------------------ commissions d'intermédiaires

/** Chaque mois, un « consultant » peut proposer un contrat très avantageux d'un producteur public… contre commission. */
function maybeBribeOffer(state: GameState) {
  const u = (k: string) => hashUniform(state.config.seed, state.day, 'bribe', k);
  if (u('go') > 0.3) return;
  const pool = COUNTERPARTIES.filter((cp) => cp.kind === 'producer' && cpRating(state, cp.id) !== 'D' && !state.world.sanctions.some((s) => s.zone === cp.zone));
  if (!pool.length) return;
  const cp = pool[Math.floor(u('cp') * pool.length)]!;
  const c = COMMODITY_IDS[Math.floor(u('c') * COMMODITY_IDS.length)]!;
  const spec = COMMODITIES[c];
  const loc = spec.physical.locations[Math.floor(u('loc') * spec.physical.locations.length)]!;
  const month = listedMonths(spec, state.day)[1] ?? listedMonths(spec, state.day)[0]!;
  const F = forwardAt(state.market, c, physicalDeliveryDay(month));
  const qty = spec.physical.cargoSizes[spec.physical.cargoSizes.length - 1]!;
  const diff = Math.round((-F * (0.025 + 0.02 * u('d'))) / spec.tick) * spec.tick; // décote de 2,5 à 4,5 % : très lucratif
  const notional = qty * F * spec.valuePerUnit;
  const id = newId(state, 'o');
  state.offers.push({ id, cityId: loc.cityId, commodity: c, locationId: loc.id, side: 1, qty, month, diff, counterpartyId: cp.id, createdDay: state.day, expiresDay: addBusinessDays(state.day, 5), bribe: Math.round((notional * 0.02) / 1000) * 1000 });
  comp(state).bribeOffers.push(id);
}

// ------------------------------------------------------------------ enquêtes

export function estimateFine(state: GameState, inv: Pick<Investigation, 'caseIds' | 'strategy' | 'selfReported'>): number {
  const c = comp(state);
  const cases = c.cases.filter((x) => inv.caseIds.includes(x.id));
  const base = cases.reduce((s, x) => s + 2 * x.gain + x.severity * 500_000, 0);
  return base * LEVELS[c.level].fineMult * (inv.selfReported ? 0.5 : 1) * (inv.strategy === 'coopérer' ? 0.75 : 1);
}

function evidence(state: GameState, inv: Investigation): number {
  const cases = comp(state).cases.filter((x) => inv.caseIds.includes(x.id));
  const sev = Math.max(...cases.map((x) => x.severity), 1);
  const e = 0.3 + 0.1 * sev + 0.05 * (cases.length - 1) + (inv.strategy === 'coopérer' ? 0.1 : -0.1) + (comp(state).level === 'minimal' ? 0.05 : 0);
  return Math.max(0.05, Math.min(0.95, e));
}

function stageLength(state: GameState, inv: Investigation, a: number, b: number): Day {
  return addBusinessDays(state.day, Math.round(a + (b - a) * hashUniform(state.config.seed, inv.id, inv.stage, 'len')));
}

function openInvestigation(state: GameState, kind: CaseKind, caseIds: string[], selfReported: boolean): Investigation {
  const c = comp(state);
  for (const id of caseIds) {
    const f = c.cases.find((x) => x.id === id);
    if (f) f.status = 'investigated';
  }
  const inv: Investigation = { id: newId(state, 'inv'), caseIds, kind, authority: AUTHORITY[kind](state), opened: state.day, stage: 'enquête', stageEnds: state.day, strategy: 'coopérer', legalSpent: 0, fineEstimate: 0, selfReported, done: false };
  inv.stageEnds = selfReported ? addBusinessDays(state.day, 40) : stageLength(state, inv, 60, 120);
  inv.fineEstimate = estimateFine(state, inv);
  c.investigations.push(inv);
  const co = state.company.name.split(' — ')[0];
  addNews(state, { headline: selfReported ? `${co} se dénonce auprès de ${inv.authority} (${KIND_LABEL[kind]})` : `${inv.authority} ouvre une enquête visant ${co} pour ${KIND_LABEL[kind]}`, tone: 'alert', major: !selfReported, category: 'réglementation' });
  state.pendingAlerts.push({ kind: 'major_news', text: selfReported ? `Auto-déclaration déposée : amende réduite, pas de poursuites.` : `Enquête ouverte : ${KIND_LABEL[kind]}. Choisissez votre défense dans le panneau Conformité.` });
  state.stats.timeline.push({ day: state.day, text: `Enquête : ${KIND_LABEL[kind]} (${inv.authority})` });
  return inv;
}

export function selfReport(state: GameState, caseId: string): ActionResult {
  const f = comp(state).cases.find((x) => x.id === caseId);
  if (!f || f.status !== 'latent') return { ok: false, message: 'Dossier introuvable ou déjà traité.' };
  if (!f.flagged) return { ok: false, message: 'Ce dossier n’a pas été identifié par la conformité.' };
  openInvestigation(state, f.kind, [f.id], true);
  return { ok: true, message: 'Auto-déclaration déposée : coopération totale, amende réduite de moitié.' };
}

export function setDefense(state: GameState, id: string, strategy: DefenseStrategy): ActionResult {
  const inv = comp(state).investigations.find((x) => x.id === id && !x.done);
  if (!inv) return { ok: false, message: 'Enquête introuvable.' };
  if (inv.selfReported) return { ok: false, message: 'Vous vous êtes dénoncé : la coopération est acquise.' };
  inv.strategy = strategy;
  inv.fineEstimate = estimateFine(state, inv);
  return { ok: true, message: strategy === 'coopérer' ? 'Vous coopérez : frais réduits, amende allégée, mais les preuves s’accumulent.' : 'Vous contestez : avocats plus chers, meilleures chances d’acquittement, amende alourdie si condamnation.' };
}

/** Transaction (accord avec l'autorité) avant le jugement : amende à 80 % de l'estimation, conséquences allégées. */
export function settleCase(state: GameState, id: string): ActionResult {
  const inv = comp(state).investigations.find((x) => x.id === id && !x.done);
  if (!inv) return { ok: false, message: 'Enquête introuvable.' };
  if (inv.stage === 'jugement' || inv.stage === 'appel') return { ok: false, message: 'Trop tard pour transiger : le tribunal est saisi.' };
  const fine = estimateFine(state, inv) * 0.8;
  conclude(state, inv, 'transaction', fine, 0.5);
  return { ok: true, message: `Transaction conclue : amende de ${(fine / 1e6).toFixed(2)} M$.` };
}

export function appeal(state: GameState, id: string): ActionResult {
  const inv = comp(state).investigations.find((x) => x.id === id && x.done && x.outcome === 'condamnation');
  if (!inv) return { ok: false, message: 'Aucune condamnation à contester.' };
  if (state.day - inv.stageEnds > 30) return { ok: false, message: 'Délai d’appel expiré.' };
  inv.done = false;
  inv.stage = 'appel';
  inv.stageEnds = stageLength(state, inv, 80, 140);
  inv.strategy = 'contester';
  return { ok: true, message: 'Appel interjeté. Décision dans quelques mois.' };
}

/** Applique l'issue : amende et conséquences (fraction `weight` des conséquences pour une transaction). */
function conclude(state: GameState, inv: Investigation, outcome: string, fine: number, weight: number) {
  const c = comp(state);
  inv.done = true;
  inv.outcome = outcome;
  inv.stageEnds = state.day;
  for (const id of inv.caseIds) {
    const f = c.cases.find((x) => x.id === id);
    if (f) f.status = 'closed';
  }
  const co = state.company.name.split(' — ')[0];
  if (fine > 0) {
    addCash(state, -fine, 'compliance');
    c.fines += fine;
    log(state, `Amende (${KIND_LABEL[inv.kind]})`, -fine);
  }
  const days = (n: number) => addBusinessDays(state.day, Math.round(n * weight));
  if (fine > 0 && !inv.selfReported) {
    if (inv.kind === 'sanctions') {
      c.banksCutUntil = Math.max(c.banksCutUntil, days(250));
      state.company.creditMult = Math.max(0.4, (state.company.creditMult ?? 1) * (1 - 0.2 * weight));
    }
    if (inv.kind === 'manipulation') c.suspendedUntil = Math.max(c.suspendedUntil, days(20));
    if (state.career) state.career.reputation = Math.max(0, state.career.reputation - 15 * weight);
  }
  const text = outcome === 'classée' ? `Enquête classée sans suite (${KIND_LABEL[inv.kind]})` : outcome === 'acquittement' ? `Relaxe : ${co} est blanchie (${KIND_LABEL[inv.kind]})` : `${co} ${outcome === 'transaction' ? 'transige' : 'condamnée'} : ${(fine / 1e6).toFixed(2)} M$ d’amende pour ${KIND_LABEL[inv.kind]}`;
  addNews(state, { headline: text, tone: fine > 0 ? 'alert' : 'neutral', major: fine > 0, category: 'réglementation' });
  state.stats.timeline.push({ day: state.day, text });
  if (fine === 0) state.stats.investigationsWon++;
  if (outcome === 'condamnation') {
    const consequences = [
      inv.kind === 'sanctions' ? 'les banques coupent vos lignes pour un an' : '',
      inv.kind === 'manipulation' ? 'licence de négoce suspendue un mois' : '',
    ].filter(Boolean).join(', ');
    state.pendingAlerts.push({ kind: 'major_news', text: `Condamnation : ${(fine / 1e6).toFixed(2)} M$${consequences ? ` ; ${consequences}` : ''}. Appel possible sous 30 jours.` });
    // dirigeant personnellement poursuivi (mode carrière) ; récidive en sandbox : retrait de licence
    const sev = Math.max(...c.cases.filter((x) => inv.caseIds.includes(x.id)).map((x) => x.severity));
    const convictions = c.investigations.filter((x) => x.outcome === 'condamnation').length;
    if (state.career && sev >= 4 && (inv.kind === 'corruption' || inv.kind === 'sanctions')) {
      const u = hashUniform(state.config.seed, inv.id, 'perso');
      if (u < 0.25) endGame(state, 'prison', `Condamné personnellement pour ${KIND_LABEL[inv.kind]} : prison ferme.`);
      else if (u < 0.6) endGame(state, 'banned', `Interdiction d’exercer dans le négoce pour ${KIND_LABEL[inv.kind]}.`);
    } else if (convictions >= 3) {
      endGame(state, 'banned', `Troisième condamnation : le régulateur retire la licence de ${co}.`);
    }
  }
}

function endGame(state: GameState, status: 'prison' | 'banned', reason: string) {
  state.status = status;
  state.statusReason = reason;
  state.pendingAlerts.push({ kind: 'ended', text: reason });
  if (state.career) state.career.ended = status === 'prison' ? 'prison' : 'interdiction';
}

/** Clôture quotidienne : frais d'avocats, étapes des procédures. */
export function stepInvestigations(state: GameState, days: number) {
  const c = comp(state);
  for (const inv of c.investigations.filter((x) => !x.done)) {
    // frais d'avocats proportionnels à la gravité du dossier, doublés quand on conteste
    const sev = Math.max(1, ...c.cases.filter((x) => inv.caseIds.includes(x.id)).map((x) => x.severity));
    const monthly = (20_000 + 15_000 * sev) * (inv.selfReported ? 0.5 : inv.strategy === 'contester' ? 2.2 : 1);
    const cost = (monthly * days) / 30.4;
    addCash(state, -cost, 'compliance');
    inv.legalSpent += cost;
    if (state.day < inv.stageEnds) continue;
    const u = hashUniform(state.config.seed, inv.id, inv.stage, 'issue');
    const e = evidence(state, inv);
    if (inv.selfReported) {
      conclude(state, inv, 'transaction', estimateFine(state, inv), 0);
      continue;
    }
    if (inv.stage === 'enquête') {
      if (u > e) conclude(state, inv, 'classée', 0, 0);
      else {
        inv.stage = 'poursuites';
        inv.stageEnds = stageLength(state, inv, 40, 90);
        addNews(state, { headline: `${inv.authority} engage des poursuites contre ${state.company.name.split(' — ')[0]}`, tone: 'alert', major: false, category: 'réglementation' });
      }
    } else if (inv.stage === 'poursuites') {
      inv.stage = 'jugement';
      inv.stageEnds = stageLength(state, inv, 60, 140);
    } else if (inv.stage === 'jugement') {
      if (u > e) conclude(state, inv, 'acquittement', 0, 0);
      else conclude(state, inv, 'condamnation', estimateFine(state, inv) * (inv.strategy === 'contester' ? 1.3 : 1), 1);
    } else if (inv.stage === 'appel') {
      const prior = estimateFine(state, inv) * 1.3;
      if (u < 0.1) {
        addCash(state, prior, 'compliance');
        c.fines -= prior;
        conclude(state, inv, 'acquittement', 0, 0);
        c.suspendedUntil = Math.min(c.suspendedUntil, state.day);
        c.banksCutUntil = Math.min(c.banksCutUntil, state.day);
      } else if (u < 0.45) {
        addCash(state, prior / 2, 'compliance');
        c.fines -= prior / 2;
        inv.done = true;
        inv.outcome = 'peine réduite en appel';
        addNews(state, { headline: `Appel : l’amende de ${state.company.name.split(' — ')[0]} est réduite de moitié`, tone: 'neutral', major: false, category: 'réglementation' });
      } else {
        inv.done = true;
        inv.outcome = 'condamnation confirmée';
        addNews(state, { headline: `Appel rejeté : la condamnation de ${state.company.name.split(' — ')[0]} est confirmée`, tone: 'alert', major: false, category: 'réglementation' });
      }
    }
  }
}

/** Au changement de mois : coût du programme, découverte des dossiers, prescription, offres de commissions. */
export function complianceMonth(state: GameState) {
  const c = comp(state);
  const idx = CITY_BY_ID[state.company.hqCity]?.staffCostIndex ?? 1;
  const cost = LEVELS[c.level].monthly * idx;
  if (cost > 0) {
    addCash(state, -cost, 'compliance');
    log(state, `Programme de conformité (${c.level})`, -cost);
  }
  const strict = state.world.cityRegs[state.company.hqCity]?.kyc ?? 0.6;
  for (const f of c.cases.filter((x) => x.status === 'latent')) {
    if (state.day - f.day > STATUTE_DAYS) {
      f.status = 'closed';
      continue;
    }
    const auth = f.kind === 'sanctions' ? 1.2 : 0.5 + strict;
    const p = 1 - Math.exp(-f.severity * f.severity * 0.006 * auth * (f.flagged ? 1.2 : 1));
    if (f.status !== 'latent') continue;
    if (hashUniform(state.config.seed, state.day, f.id, 'detect') < p) {
      const same = c.cases.filter((x) => x.status === 'latent' && x.kind === f.kind).map((x) => x.id);
      // une enquête déjà ouverte sur le même thème absorbe les nouveaux faits (avant le jugement)
      const open = c.investigations.find((x) => !x.done && x.kind === f.kind && (x.stage === 'enquête' || x.stage === 'poursuites'));
      if (open) {
        for (const id of same) {
          const g = c.cases.find((x) => x.id === id)!;
          g.status = 'investigated';
          open.caseIds.push(id);
        }
        open.fineEstimate = estimateFine(state, open);
      } else openInvestigation(state, f.kind, same, false);
    }
  }
  c.bribeOffers = c.bribeOffers.filter((id) => state.offers.some((o) => o.id === id));
  maybeBribeOffer(state);
}

/** Contrôle des limites de position par la bourse, à la clôture. */
export function exchangeSurveillance(state: GameState) {
  for (const p of state.futures) {
    const ex = spotMonthExcess(state, p.commodity, p.month, p.lots);
    if (ex <= 0) continue;
    const key = `poslim.${p.commodity}.${p.month}`;
    if ((state.world.eventCooldown[key] ?? -1) >= state.day) continue;
    state.world.eventCooldown[key] = lastTradingDay(COMMODITIES[p.commodity], p.month);
    const spec = COMMODITIES[p.commodity];
    const share = ex / SPOT_MONTH_LIMIT[p.commodity]!;
    recordCase(state, 'manipulation', 2 + Math.min(3, share * 3), ex * lotQty(spec, p.month) * spotPriceProxy(state, p.commodity) * spec.valuePerUnit * 0.01, `Position de ${Math.abs(p.lots)} lots sur ${spec.short} à l’approche de l’échéance (limite ${SPOT_MONTH_LIMIT[p.commodity]})`);
    state.pendingAlerts.push({ kind: 'limit', text: `${spec.exchange} : votre position ${spec.short} dépasse la limite mois spot de ${ex} lots. Réduisez-la, la surveillance des marchés vous a repéré.` });
  }
}

function spotPriceProxy(state: GameState, c: (typeof COMMODITY_IDS)[number]): number {
  return forwardAt(state.market, c, state.day);
}

/** Dossiers actifs (pour l'interface). */
export function openCases(state: GameState): CaseFile[] {
  return comp(state).cases.filter((x) => x.status === 'latent');
}

export function complianceSummary(state: GameState) {
  const c = comp(state);
  return { level: c.level, latent: openCases(state).length, flagged: openCases(state).filter((x) => x.flagged).length, investigations: c.investigations.filter((x) => !x.done).length, fines: c.fines, banksCut: c.banksCutUntil >= state.day ? formatDay(c.banksCutUntil) : null, suspended: c.suspendedUntil >= state.day ? formatDay(c.suspendedUntil) : null, nav: nav(state), year: ymd(state.day).y };
}
