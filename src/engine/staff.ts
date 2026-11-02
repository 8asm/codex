/**
 * Phase 8 — Recrutement, équipes et bureaux dans d'autres villes.
 *
 * Chaque collaborateur a un métier, une compétence, une ambition, une loyauté, un salaire et (pour les traders)
 * un réseau de clients. Les effets sont ciblés et plafonnés :
 *  - trader (par famille) : flux d'offres +12 % et conditions meilleures (jusqu'à 0,25 % de mieux) ;
 *  - analyste : note de recherche mensuelle sur la tendance de fond d'un marché (la dérive « réelle » du modèle) ;
 *  - opérations : risque qualité réduit (−15 % chacun) ;
 *  - risque : marge de la RCF réduite (−0,1 % chacun) ;
 *  - juriste : détection interne +15 %, amendes −10 % chacun ;
 *  - affréteur : coût d'affrètement −4 % chacun.
 * La loyauté dépend du salaire (par rapport au marché) et des résultats ; les concurrents débauchent les ambitieux mal
 * payés, avec leurs clients. Les bureaux à l'étranger donnent une présence permanente dans la ville (conditions locales
 * des offres, pas de pénalité à distance) et des postes, contre un loyer et un agencement.
 * Tirages hachés (graine, jour, motif) : la séquence aléatoire du marché reste inchangée.
 */
import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { COMPANIES } from '../data/companies';
import { CITY_ZONE } from '../data/world';
import { addBusinessDays } from './calendar';
import { addCash, log, newId } from './ledger';
import { addNews } from './news';
import { npcsOf, remember } from './npcs';
import { hashUniform } from './rng';
import type { ActionResult, CommoditySpec, Employee, GameState, StaffRole, StaffState } from './types';
import { nav } from './valuation';
import { closeDesk } from './desks';

export const ROLE_LABEL: Record<StaffRole, string> = {
  trader: 'Trader', analyst: 'Analyste', operations: 'Opérateur logistique', risk: 'Risk manager', legal: 'Juriste conformité', chartering: 'Affréteur',
};
export const ROLE_EFFECT: Record<StaffRole, string> = {
  trader: 'Plus d’offres et de meilleures conditions sur sa famille de marchés',
  analyst: 'Note de recherche mensuelle sur la tendance de fond d’un marché',
  operations: 'Risque qualité −15 %',
  risk: 'Marge de la RCF −0,10 %',
  legal: 'Détection interne +15 %, amendes −10 %',
  chartering: 'Affrètement −4 %',
};
const BASE_SALARY: Record<StaffRole, number> = { trader: 22_000, analyst: 13_000, operations: 11_000, risk: 15_000, legal: 16_000, chartering: 12_000 };
const FIRST = ['Léa', 'Omar', 'Hana', 'Jonas', 'Priya', 'Mateo', 'Aiko', 'Kofi', 'Elif', 'Sven', 'Chloé', 'Ravi', 'Ines', 'Dmitri', 'Zanele', 'Luca', 'Mei', 'Tomás', 'Amina', 'Erik', 'Noor', 'Felipe', 'Yuki', 'Ada'];
const LAST = ['Moreau', 'Haddad', 'Kim', 'Berg', 'Raman', 'Silva', 'Sato', 'Mensah', 'Yılmaz', 'Lindqvist', 'Dubois', 'Iyer', 'Costa', 'Orlov', 'Ndlovu', 'Ferri', 'Chen', 'Ruiz', 'Diallo', 'Holm', 'Saleh', 'Pereira', 'Tanaka', 'Okafor'];
const FAMILIES: CommoditySpec['family'][] = ['energy', 'metals', 'agri'];
export const FAMILY_LABEL: Record<CommoditySpec['family'], string> = { energy: 'énergie', metals: 'métaux', agri: 'agricoles' };

export const BRANCH = {
  bureau: { seats: 6, rentMult: 0.6, fitOut: 400_000, label: 'Bureau de représentation' },
  grand: { seats: 20, rentMult: 2, fitOut: 1_500_000, label: 'Bureau régional' },
} as const;

export function defaultStaff(): StaffState {
  return { employees: [], candidates: [], branches: [], poach: [] };
}

const st = (s: GameState) => (s.staff ??= defaultStaff());

/** Salaire de marché pour un métier et une compétence, ajusté du coût du personnel de la ville. */
export function marketSalary(role: StaffRole, skill: number, cityId: string): number {
  return Math.round((BASE_SALARY[role] * (0.6 + skill / 100) * (CITY_BY_ID[cityId]?.staffCostIndex ?? 1)) / 100) * 100;
}

const count = (s: GameState, role: StaffRole, family?: CommoditySpec['family']) => st(s).employees.filter((e) => e.role === role && (!family || e.family === family)).length;
const skillSum = (s: GameState, role: StaffRole, family?: CommoditySpec['family']) => st(s).employees.filter((e) => e.role === role && (!family || e.family === family)).reduce((a, e) => a + e.skill / 100, 0);

// ------------------------------------------------------------------ effets

/** Multiplicateur du flux d'offres d'une famille (+12 % par trader, plafonné à +60 %). */
export function traderFlow(s: GameState, family: CommoditySpec['family']): number {
  return 1 + Math.min(0.6, 0.12 * count(s, 'trader', family));
}
/** Amélioration des conditions des offres (fraction du prix), selon la compétence des traders de la famille. */
export function traderEdge(s: GameState, family: CommoditySpec['family']): number {
  return Math.min(0.0025, 0.0012 * skillSum(s, 'trader', family));
}
export function qualityRiskMult(s: GameState): number {
  return Math.max(0.4, 1 - 0.15 * count(s, 'operations'));
}
export function rcfSpreadCut(s: GameState): number {
  return Math.min(0.005, 0.001 * count(s, 'risk'));
}
export function legalDetectBonus(s: GameState): number {
  return Math.min(0.3, 0.15 * count(s, 'legal'));
}
export function legalFineMult(s: GameState): number {
  return Math.max(0.7, 1 - 0.1 * count(s, 'legal'));
}
export function charterMult(s: GameState): number {
  return Math.max(0.8, 1 - 0.04 * count(s, 'chartering'));
}

/** Présence permanente dans une ville (siège ou bureau). */
export function hasBranch(s: GameState, cityId: string): boolean {
  return (s.staff?.branches ?? []).some((b) => b.cityId === cityId);
}

/** Postes occupés au siège par l'équipe recrutée (les rattachés à un bureau occupent les postes du bureau). */
export function hqStaffSeats(s: GameState): number {
  return (s.staff?.employees ?? []).filter((e) => e.cityId === s.company.hqCity).length;
}

export function branchSeatsFree(s: GameState, cityId: string): number {
  const b = st(s).branches.find((x) => x.cityId === cityId);
  if (!b) return 0;
  return BRANCH[b.size].seats - st(s).employees.filter((e) => e.cityId === cityId).length;
}

// ------------------------------------------------------------------ continents (succès « cinq continents »)
const CONTINENT: Record<string, string> = {
  CH: 'Europe', UK: 'Europe', NL: 'Europe', FR: 'Europe', DE: 'Europe', NO: 'Europe', TR: 'Europe', GR: 'Europe', ES: 'Europe', IT: 'Europe', AT: 'Europe', PL: 'Europe', SARM: 'Europe', TAUR: 'Europe',
  US: 'Amérique du Nord', CA: 'Amérique du Nord', MX: 'Amérique du Nord', PA: 'Amérique du Nord',
  CL: 'Amérique du Sud', BR: 'Amérique du Sud', AR: 'Amérique du Sud', PE: 'Amérique du Sud', CO: 'Amérique du Sud', VE: 'Amérique du Sud',
  ZA: 'Afrique', EG: 'Afrique', NG: 'Afrique', CI: 'Afrique', GH: 'Afrique', KE: 'Afrique', AO: 'Afrique', KASS: 'Afrique',
  AE: 'Asie', CN: 'Asie', SG: 'Asie', GULF: 'Asie', OM: 'Asie', AZ: 'Asie', IN: 'Asie', PK: 'Asie', JP: 'Asie', KR: 'Asie', MY: 'Asie', TH: 'Asie', VN: 'Asie', PH: 'Asie', KZ: 'Asie', INSU: 'Asie',
  AU: 'Océanie', NZ: 'Océanie',
};
export function continentOf(cityId: string): string {
  return CONTINENT[CITY_ZONE[cityId] ?? ''] ?? 'Europe';
}
export function continentsCovered(s: GameState): number {
  return new Set([s.company.hqCity, ...(s.staff?.branches ?? []).map((b) => b.cityId)].map(continentOf)).size;
}

// ------------------------------------------------------------------ actions

function managing(s: GameState) {
  return !s.career || s.career.status === 'founder' || s.career.status === 'ceo';
}

function prestigeOf(s: GameState): number {
  // évite une dépendance circulaire avec offices.ts : prestige du palier approché par le palier lui-même
  return [5, 15, 32, 50][s.office?.tier ?? 0]!;
}

/** Candidats du mois : la qualité dépend du prestige du siège et du vivier de talents de la ville. */
export function refreshCandidates(s: GameState) {
  const t = st(s);
  t.candidates = t.candidates.filter((c) => c.expiresDay >= s.day);
  const roles: StaffRole[] = ['trader', 'trader', 'analyst', 'operations', 'risk', 'legal', 'chartering'];
  const city = s.company.hqCity;
  const talent = (CITY_BY_ID[city]?.bankingHub ?? 0.5) * 10 + prestigeOf(s) / 5;
  for (let i = 0; t.candidates.length < 5 && i < 6; i++) {
    const u = (k: string) => hashUniform(s.config.seed, s.day, 'cand', i, k);
    const role = roles[Math.floor(u('r') * roles.length)]!;
    const skill = Math.round(Math.min(95, 30 + 45 * u('s') + talent));
    const name = `${FIRST[Math.floor(u('f') * FIRST.length)]} ${LAST[Math.floor(u('l') * LAST.length)]}`;
    if (t.employees.some((e) => e.name === name) || t.candidates.some((e) => e.name === name)) continue;
    t.candidates.push({
      id: newId(s, 'cd'), name, role, family: role === 'trader' || role === 'analyst' ? FAMILIES[Math.floor(u('fam') * 3)] : undefined,
      skill, ambition: Math.round(u('a') * 100) / 100, loyalty: 60, salary: Math.round(marketSalary(role, skill, city) * (0.95 + 0.25 * u('p')) / 100) * 100,
      network: role === 'trader' ? Math.round(2 + 6 * u('n')) : 0, hiredDay: s.day, cityId: city, expiresDay: addBusinessDays(s.day, 25),
    });
  }
}

export function hire(s: GameState, candidateId: string, cityId?: string): ActionResult {
  if (!managing(s)) return { ok: false, message: 'Seule la direction recrute.' };
  const t = st(s);
  const c = t.candidates.find((x) => x.id === candidateId);
  if (!c) return { ok: false, message: 'Candidat introuvable.' };
  const target = cityId ?? s.company.hqCity;
  if (target !== s.company.hqCity && !hasBranch(s, target)) return { ok: false, message: 'Pas de bureau dans cette ville.' };
  if (target !== s.company.hqCity && branchSeatsFree(s, target) <= 0) return { ok: false, message: 'Le bureau est plein.' };
  const signOn = c.salary * 2; // prime d'arrivée (rachat de bonus différé)
  addCash(s, -signOn, 'overhead');
  const { expiresDay: _e, ...emp } = c;
  void _e;
  const e: Employee = { ...emp, cityId: target, hiredDay: s.day, salary: Math.round(c.salary * (CITY_BY_ID[target]!.staffCostIndex / Math.max(0.3, CITY_BY_ID[s.company.hqCity]!.staffCostIndex)) / 100) * 100 };
  t.employees.push(e);
  t.candidates = t.candidates.filter((x) => x !== c);
  // un trader arrive avec son carnet d'adresses
  if (e.role === 'trader' && e.network) {
    const clients = npcsOf(s, 'client').slice(0, 40);
    for (let k = 0; k < Math.min(e.network, clients.length); k++) remember(s, clients[Math.floor(hashUniform(s.config.seed, e.id, k) * clients.length)]!.id, 4, `Suit ${e.name} chez nous`);
  }
  log(s, `Recrutement : ${e.name} (${ROLE_LABEL[e.role]}), prime d’arrivée`, -signOn);
  return { ok: true, message: `${e.name} rejoint l’équipe (${ROLE_LABEL[e.role].toLowerCase()}${e.family ? ` ${FAMILY_LABEL[e.family]}` : ''}) à ${CITY_BY_ID[target]!.name}.` };
}

export function fireEmployee(s: GameState, id: string): ActionResult {
  const t = st(s);
  const e = t.employees.find((x) => x.id === id);
  if (!e) return { ok: false, message: 'Introuvable.' };
  closeDesk(s, e.id);
  addCash(s, -e.salary * 3, 'overhead');
  t.employees = t.employees.filter((x) => x !== e);
  t.poach = t.poach.filter((p) => p.employeeId !== id);
  return { ok: true, message: `${e.name} quitte la société (indemnité de 3 mois).` };
}

export function raise(s: GameState, id: string, pct: number): ActionResult {
  const e = st(s).employees.find((x) => x.id === id);
  if (!e) return { ok: false, message: 'Introuvable.' };
  e.salary = Math.round((e.salary * (1 + pct)) / 100) * 100;
  e.loyalty = Math.min(100, e.loyalty + pct * 120);
  return { ok: true, message: `${e.name} : salaire porté à ${e.salary.toLocaleString('fr-FR')} $/mois.` };
}

/** Contre-offre à une tentative de débauchage : aligner le salaire proposé. */
export function counterOffer(s: GameState, id: string): ActionResult {
  const t = st(s);
  const p = t.poach.find((x) => x.employeeId === id);
  const e = t.employees.find((x) => x.id === id);
  if (!p || !e) return { ok: false, message: 'Aucune offre concurrente en cours.' };
  e.salary = p.salary;
  e.loyalty = Math.min(100, e.loyalty + 25);
  t.poach = t.poach.filter((x) => x !== p);
  return { ok: true, message: `${e.name} reste : salaire aligné à ${p.salary.toLocaleString('fr-FR')} $/mois.` };
}

export function openBranch(s: GameState, cityId: string, size: 'bureau' | 'grand'): ActionResult {
  if (!managing(s)) return { ok: false, message: 'Seule la direction ouvre des bureaux.' };
  const city = CITY_BY_ID[cityId];
  if (!city || cityId === s.company.hqCity) return { ok: false, message: 'Ville invalide.' };
  if (hasBranch(s, cityId)) return { ok: false, message: 'Un bureau existe déjà.' };
  const minNav = size === 'grand' ? 60e6 : 15e6;
  if (nav(s) < minNav) return { ok: false, message: `Il faut ${(minNav / 1e6).toFixed(0)} M$ de fonds propres pour ouvrir ce bureau.` };
  const fit = Math.round(BRANCH[size].fitOut * (0.6 + 0.4 * city.staffCostIndex));
  const licence = 50_000 + city.kycStrictness * 150_000;
  if (fit + licence > s.company.cash - s.company.im) return { ok: false, message: 'Trésorerie insuffisante.' };
  addCash(s, -(fit + licence), 'office');
  st(s).branches.push({ cityId, size, openedDay: s.day, fitOut: fit });
  addNews(s, { headline: `${s.company.name} ouvre un ${BRANCH[size].label.toLowerCase()} à ${city.name}`, tone: 'up', major: false, category: 'entreprises', cityId });
  log(s, `Ouverture d’un bureau à ${city.name} (agencement et licence)`, -(fit + licence));
  return { ok: true, message: `${BRANCH[size].label} ouvert à ${city.name} : présence permanente sur place, ${BRANCH[size].seats} postes.` };
}

export function closeBranch(s: GameState, cityId: string): ActionResult {
  const t = st(s);
  if (!hasBranch(s, cityId)) return { ok: false, message: 'Aucun bureau ici.' };
  for (const e of t.employees.filter((x) => x.cityId === cityId)) e.cityId = s.company.hqCity; // rapatriés au siège
  t.branches = t.branches.filter((b) => b.cityId !== cityId);
  return { ok: true, message: `Bureau de ${CITY_BY_ID[cityId]!.name} fermé, l’équipe rapatriée au siège.` };
}

/** Coût mensuel des équipes et des bureaux. */
export function staffMonthlyCost(s: GameState): { salaries: number; rent: number } {
  const t = st(s);
  const salaries = t.employees.reduce((a, e) => a + e.salary, 0);
  const rent = t.branches.reduce((a, b) => a + CITY_BY_ID[b.cityId]!.officeRentMonthly * BRANCH[b.size].rentMult, 0);
  return { salaries, rent };
}

/** Au changement de mois : salaires, loyers, loyauté, débauchages, candidats, notes de recherche. */
export function staffMonth(s: GameState) {
  if (!managing(s)) return;
  const t = st(s);
  const { salaries, rent } = staffMonthlyCost(s);
  if (salaries + rent > 0) {
    addCash(s, -(salaries + rent), 'overhead');
    log(s, `Équipes (${t.employees.length}) et bureaux (${t.branches.length})`, -(salaries + rent));
  }
  const ytd = nav(s) / Math.max(1, s.company.yearStartNav) - 1;
  // offres concurrentes non contrées : départ, avec une partie des clients
  for (const p of t.poach.filter((x) => x.expiresDay < s.day)) {
    const e = t.employees.find((x) => x.id === p.employeeId);
    if (!e) continue;
    closeDesk(s, e.id);
    t.employees = t.employees.filter((x) => x !== e);
    const co = COMPANIES.find((c) => c.id === p.companyId);
    if (e.role === 'trader') for (const n of npcsOf(s, 'client').slice(0, e.network)) remember(s, n.id, -3, `${e.name} est parti chez ${co?.name}`);
    addNews(s, { headline: `${co?.name ?? 'Un concurrent'} débauche ${e.name}, ${ROLE_LABEL[e.role].toLowerCase()} de ${s.company.name}`, tone: 'neutral', major: false, category: 'entreprises', companyId: p.companyId });
    s.pendingAlerts.push({ kind: 'delivery', text: `${e.name} a rejoint ${co?.name} avec une partie de ses clients.` });
  }
  t.poach = t.poach.filter((x) => x.expiresDay >= s.day);
  for (const e of t.employees) {
    const mkt = marketSalary(e.role, e.skill, e.cityId);
    e.loyalty = Math.max(0, Math.min(100, e.loyalty + (e.salary >= mkt ? 2 : -4) + (ytd < -0.05 ? -3 : ytd > 0.1 ? 1 : 0)));
    e.skill = Math.min(95, e.skill + 0.3);
    // débauchage : les ambitieux mal payés et peu loyaux
    const p = Math.max(0, (60 - e.loyalty) / 200) * (0.5 + e.ambition);
    if (!t.poach.some((x) => x.employeeId === e.id) && hashUniform(s.config.seed, s.day, e.id, 'poach') < p) {
      const rivals = COMPANIES.filter((c) => c.ai && c.kind !== 'bank');
      const co = rivals[Math.floor(hashUniform(s.config.seed, s.day, e.id, 'co') * rivals.length)]!;
      const salary = Math.round((Math.max(e.salary, mkt) * 1.25) / 100) * 100;
      t.poach.push({ employeeId: e.id, companyId: co.id, salary, expiresDay: addBusinessDays(s.day, 8) });
      s.pendingAlerts.push({ kind: 'advice', text: `${co.name} propose ${salary.toLocaleString('fr-FR')} $/mois à ${e.name}. Contre-offre possible pendant 8 jours (panneau Équipes).` });
    }
  }
  // notes de recherche : un analyste révèle la tendance de fond (dérive réelle) d'un marché de sa famille
  for (const a of t.employees.filter((e) => e.role === 'analyst')) {
    const pool = Object.entries(s.market.drift).filter(([, v]) => Math.abs(v ?? 0) > 0.03);
    if (!pool.length || hashUniform(s.config.seed, s.day, a.id, 'note') > a.skill / 120) continue;
    const [c, v] = pool[Math.floor(hashUniform(s.config.seed, s.day, a.id, 'nc') * pool.length)]!;
    addNews(s, { headline: `Note de ${a.name} : tendance de fond ${v! > 0 ? 'haussière' : 'baissière'} sur ${COMMODITIES[c as keyof typeof COMMODITIES]?.short ?? c}`, body: `Notre recherche estime la dérive structurelle à ${((v ?? 0) * 100).toFixed(0)} % par an (hors aléas). Information interne.`, tone: v! > 0 ? 'up' : 'down', major: false, category: 'marché' });
  }
  refreshCandidates(s);
}

// ------------------------------------------------------------------ fiscalité des bureaux

export interface TaxPart {
  cityId: string;
  /** bénéfice imposable imputé au site */
  base: number;
  rate: number;
  tax: number;
  /** retenue au rapatriement (pays à contrôle des capitaux) */
  withholding: number;
  /** dont imputation directe (P&L des desks du bureau) */
  direct: number;
}

/**
 * Répartition du bénéfice imposable entre le siège et les bureaux (établissements stables).
 *  1. Imputation directe : le P&L positif de l'exercice des desks rattachés à un bureau y est imposé
 *     (les « fonctions humaines significatives » qui portent le risque sont sur place, principe OCDE).
 *  2. Le reste est réparti au prorata de la masse salariale de chaque site (clé de répartition « payroll »),
 *     le siège comptant son équipe de base.
 * Chaque part est imposée au taux de sa ville (le siège garde son régime spécial éventuel). Dans un pays à
 * contrôle des capitaux, rapatrier le bénéfice net coûte en plus une retenue de 10 %.
 * Simplifications : report des pertes global, pas de prix de transfert sur les flux physiques.
 */
export function taxSplit(s: GameState, taxable: number, hqRate: number, hqBasePayroll: number): TaxPart[] {
  const hq = s.company.hqCity;
  const parts = new Map<string, TaxPart>();
  const part = (cityId: string) => {
    let p = parts.get(cityId);
    if (!p) {
      const rate = cityId === hq ? hqRate : s.world.cityRegs[cityId]?.taxRate ?? hqRate;
      p = { cityId, base: 0, rate, tax: 0, withholding: 0, direct: 0 };
      parts.set(cityId, p);
    }
    return p;
  };
  part(hq);
  if (taxable <= 0) return [...parts.values()];
  const t = st(s);
  const branchIds = new Set(t.branches.map((b) => b.cityId));
  // 1. imputation directe des desks des bureaux
  let directSum = 0;
  for (const e of t.employees.filter((x) => x.role === 'trader' && branchIds.has(x.cityId))) {
    const d = Math.max(0, s.desks?.records[e.id]?.pnlLastYear ?? 0);
    if (d > 0) { part(e.cityId).direct += d; directSum += d; }
  }
  const scale = directSum > taxable ? taxable / directSum : 1;
  for (const p of parts.values()) p.direct *= scale;
  const rest = taxable - Math.min(directSum, taxable);
  // 2. clé « masse salariale »
  const payroll = new Map<string, number>([[hq, hqBasePayroll]]);
  for (const e of t.employees) {
    const site = branchIds.has(e.cityId) ? e.cityId : hq;
    payroll.set(site, (payroll.get(site) ?? 0) + e.salary);
  }
  const total = [...payroll.values()].reduce((a, b) => a + b, 0);
  for (const [site, w] of payroll) part(site).base += (rest * w) / Math.max(1, total);
  for (const p of parts.values()) {
    p.base += p.direct;
    p.tax = p.base * p.rate;
    if (p.cityId !== hq && s.world.cityRegs[p.cityId]?.capitalControls) p.withholding = 0.1 * (p.base - p.tax);
  }
  return [...parts.values()];
}
