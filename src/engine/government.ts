/**
 * Phase 11 — Interactions avec les gouvernements.
 *
 *  - Appels d'offres publics : chaque mois, des agences d'État (céréales, réserves stratégiques, compagnies
 *    nationales) achètent ou vendent une cargaison à livrer dans 2 à 3 mois. Le joueur soumet un différentiel au
 *    benchmark (enchère scellée). Les concurrents soumettent autour du différentiel de marché, avec un bruit ; le
 *    meilleur prix l'emporte, la relation avec l'État départageant à quelques points de base près. Gagner crée un
 *    vrai contrat physique à terme, valorisé et couvert comme les autres.
 *  - Licences d'import-export : un droit annuel par pays ; nécessaires pour soumissionner, elles améliorent un peu
 *    les conditions des contreparties du pays (moins de frictions administratives).
 *  - Relations : un dossier technique (propre, peu cher, effet modeste) ou un dîner avec le ministre (cher, effet
 *    fort… et, dans un pays opaque, un dossier de conformité « corruption » latent).
 *  - Rescrit fiscal : avec une bonne relation au gouvernement du siège, une baisse négociée du taux d'impôt
 *    (3 points pendant 3 ans), contre un engagement de volume physique.
 * Les relations s'érodent de 3 % par mois.
 */
import { COMMODITIES } from '../data/commodities';
import { COMPANIES, COMPANY_BY_ID } from '../data/companies';
import { CITY_ZONE, ZONE_BY_ID } from '../data/world';
import { addBusinessDays, monthIndexOf } from './calendar';
import { recordCase } from './compliance';
import { physicalDeliveryDay } from './contracts';
import { addCash, log, newId } from './ledger';
import { basisAt, forwardAt } from './market';
import { addNews } from './news';
import { activeCommodities } from './physical';
import { hashUniform } from './rng';
import type { ActionResult, CommodityId, ForwardDeal, GameState, GovState, Tender } from './types';
import { nav } from './valuation';

export const AGENCIES = COMPANIES.filter((c) => c.id.startsWith('gov_'));
const TENDER_DAYS = 8;

export function govState(s: GameState): GovState {
  return (s.gov ??= { relations: {}, licences: [], tenders: [], bids: [], results: [] });
}

const zoneOfAgency = (id: string) => COMPANY_BY_ID[id]!.zone ?? CITY_ZONE[COMPANY_BY_ID[id]!.cityId]!;
export const relation = (s: GameState, zone: string) => govState(s).relations[zone] ?? 0;
export const hasLicence = (s: GameState, zone: string) => govState(s).licences.some((l) => l.zone === zone && l.untilDay >= s.day);

/** Droit de licence annuel : plus cher dans les pays exigeants (KYC) ou instables (intermédiaires, garanties). */
export function licenceFee(zone: string): number {
  const z = ZONE_BY_ID[zone];
  const stab = z?.baseStability ?? 70;
  return Math.round((60_000 + (100 - stab) * 3_000) / 10_000) * 10_000;
}

function gauss(...k: (string | number)[]) {
  const u1 = Math.max(1e-9, hashUniform(...k, 'a'));
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * hashUniform(...k, 'b'));
}

/** Lieu de livraison d'un appel d'offres : un lieu de la commodité dans le pays de l'agence, sinon le premier. */
function tenderLocation(c: CommodityId, zone: string) {
  const locs = COMMODITIES[c].physical.locations;
  return locs.find((l) => CITY_ZONE[l.cityId] === zone) ?? locs[0]!;
}

/** Nouveaux appels d'offres du mois (1 à 2), sur les marchés suivis par la partie. */
export function generateTenders(s: GameState) {
  const g = govState(s);
  const active = activeCommodities(s);
  const mi = monthIndexOf(s.day);
  const n = 1 + (hashUniform(s.config.seed, 'tenders', mi) < 0.5 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const pool = AGENCIES.flatMap((a) => (Object.keys(a.desks) as CommodityId[]).filter((c) => active.includes(c) && COMMODITIES[c].physical.storable !== false).map((c) => ({ a, c })));
    if (!pool.length) return;
    const pick = pool[Math.floor(hashUniform(s.config.seed, 'tender', mi, k) * pool.length)]!;
    const spec = COMMODITIES[pick.c];
    const zone = zoneOfAgency(pick.a.id);
    // producteurs d'État : ils vendent (le joueur achète) ; agences d'achat : elles achètent (le joueur vend)
    const govSells = pick.a.kind === 'producer' || pick.a.kind === 'miner' || (pick.a.kind === 'agri' && hashUniform(s.config.seed, 'side', mi, k) < 0.7);
    const loc = tenderLocation(pick.c, zone);
    const month = mi + 2 + (hashUniform(s.config.seed, 'm', mi, k) < 0.5 ? 1 : 0);
    const sizes = spec.physical.cargoSizes;
    const qty = sizes[Math.floor(hashUniform(s.config.seed, 'q', mi, k) * sizes.length)]!;
    g.tenders.push({
      id: newId(s, 'tn'), agencyId: pick.a.id, zone, commodity: pick.c, locationId: loc.id, playerSide: govSells ? 1 : -1, qty, month,
      openDay: s.day, closeDay: addBusinessDays(s.day, TENDER_DAYS), bidders: 3 + Math.floor(hashUniform(s.config.seed, 'b', mi, k) * 4),
    });
    addNews(s, { headline: `Appel d’offres : ${pick.a.name} ${govSells ? 'vend' : 'achète'} ${qty.toLocaleString('fr-FR')} ${spec.qtyUnit} de ${spec.short}`, body: `Livraison ${loc.label}. Clôture des offres sous ${TENDER_DAYS} jours ouvrés.`, tone: 'neutral', major: false, category: 'réglementation', commodity: pick.c, cityId: pick.a.cityId });
  }
}

/** Différentiel de marché de l'appel d'offres (référence pour l'enchère). */
export function tenderFairDiff(s: GameState, t: Tender): number {
  return basisAt(s.market, t.commodity, t.locationId, physicalDeliveryDay(t.month));
}

export function tenderBlock(s: GameState, t: Tender): string | null {
  if (t.closeDay < s.day) return 'Appel d’offres clos.';
  if (!hasLicence(s, t.zone)) return `Licence d’import-export requise pour ${ZONE_BY_ID[t.zone]?.name ?? t.zone}.`;
  if ((s.compliance?.suspendedUntil ?? -1) >= s.day) return 'Licence de négoce suspendue.';
  return null;
}

export function submitBid(s: GameState, tenderId: string, diff: number): ActionResult {
  const g = govState(s);
  const t = g.tenders.find((x) => x.id === tenderId);
  if (!t) return { ok: false, message: 'Appel d’offres introuvable.' };
  const block = tenderBlock(s, t);
  if (block) return { ok: false, message: block };
  g.bids = g.bids.filter((b) => b.tenderId !== tenderId);
  g.bids.push({ tenderId, diff, day: s.day });
  return { ok: true, message: `Offre déposée : différentiel ${diff >= 0 ? '+' : ''}${diff.toFixed(COMMODITIES[t.commodity].decimals)}.` };
}

/** Clôture des appels d'offres échus : attribution au meilleur prix, contrat physique pour le joueur s'il gagne. */
export function resolveTenders(s: GameState) {
  const g = govState(s);
  for (const t of g.tenders.filter((x) => x.closeDay <= s.day)) {
    const bid = g.bids.find((b) => b.tenderId === t.id);
    const spec = COMMODITIES[t.commodity];
    const fair = tenderFairDiff(s, t);
    const F = forwardAt(s.market, t.commodity, physicalDeliveryDay(t.month));
    // meilleure offre concurrente : le plus agressif de N concurrents, chacun autour du différentiel de marché
    let best = Infinity;
    for (let k = 0; k < t.bidders; k++) {
      const z = gauss(s.config.seed, t.id, k);
      // côté de l'agence : un vendeur d'État reçoit des offres d'achat (on maximise le diff payé) ;
      // un acheteur d'État reçoit des offres de vente (on minimise le diff demandé). On exprime tout en « coût pour l'État ».
      const competitor = t.playerSide > 0 ? -(fair - F * (0.003 + 0.0015 * z)) : fair + F * (0.003 + 0.0015 * z);
      best = Math.min(best, competitor);
    }
    let won = false;
    if (bid) {
      const rel = relation(s, t.zone);
      const playerCost = (t.playerSide > 0 ? -bid.diff : bid.diff) - F * 0.002 * (rel / 100); // la relation vaut jusqu'à 0,2 %
      won = playerCost < best;
      if (won) {
        const deal: ForwardDeal = {
          id: newId(s, 'f'), commodity: t.commodity, locationId: t.locationId, side: t.playerSide, qty: t.qty,
          price: Math.round((F + bid.diff) / spec.tick) * spec.tick, month: t.month, deliveryDay: physicalDeliveryDay(t.month),
          counterpartyId: t.agencyId, tradeDay: s.day,
        };
        s.forwards.push(deal);
        s.company.physVolumeYtd += Math.abs(deal.qty * deal.price * spec.valuePerUnit);
        g.relations[t.zone] = Math.min(100, rel + 6);
        s.pendingAlerts.push({ kind: 'delivery', text: `🏛️ Appel d’offres remporté : ${COMPANY_BY_ID[t.agencyId]!.name}, ${t.qty.toLocaleString('fr-FR')} ${spec.qtyUnit} de ${spec.short} à ${deal.price.toFixed(spec.decimals)}. Pensez à couvrir.` });
        log(s, `Appel d’offres remporté (${COMPANY_BY_ID[t.agencyId]!.name})`);
      } else {
        g.relations[t.zone] = Math.min(100, rel + 1); // participer entretient la relation
        s.pendingAlerts.push({ kind: 'delivery', text: `Appel d’offres perdu (${COMPANY_BY_ID[t.agencyId]!.name}) : un concurrent a fait mieux.` });
      }
    }
    g.results.unshift({ tenderId: t.id, agencyId: t.agencyId, commodity: t.commodity, won, day: s.day, bid: bid?.diff, fair });
    if (g.results.length > 30) g.results.length = 30;
  }
  g.tenders = g.tenders.filter((x) => x.closeDay > s.day);
  g.bids = g.bids.filter((b) => g.tenders.some((t) => t.id === b.tenderId));
}

export function buyLicence(s: GameState, zone: string): ActionResult {
  if (!ZONE_BY_ID[zone]) return { ok: false, message: 'Pays inconnu.' };
  if (hasLicence(s, zone)) return { ok: false, message: 'Licence déjà en cours de validité.' };
  const fee = licenceFee(zone);
  if (nav(s) < fee * 5) return { ok: false, message: 'Fonds propres insuffisants pour ce dossier.' };
  addCash(s, -fee, 'compliance');
  const g = govState(s);
  g.licences = g.licences.filter((l) => l.zone !== zone);
  g.licences.push({ zone, untilDay: s.day + 365 });
  g.relations[zone] = Math.min(100, relation(s, zone) + 3);
  log(s, `Licence d’import-export : ${ZONE_BY_ID[zone]!.name}`, -fee);
  return { ok: true, message: `Licence obtenue pour ${ZONE_BY_ID[zone]!.name} (un an).` };
}

export const LOBBY = {
  dossier: { cost: 40_000, gain: 4, label: 'Dossier technique' },
  diner: { cost: 250_000, gain: 15, label: 'Dîner avec le ministre' },
} as const;

export function lobby(s: GameState, zone: string, kind: keyof typeof LOBBY): ActionResult {
  const z = ZONE_BY_ID[zone];
  if (!z) return { ok: false, message: 'Pays inconnu.' };
  const l = LOBBY[kind];
  addCash(s, -l.cost, 'compliance');
  const g = govState(s);
  g.relations[zone] = Math.min(100, relation(s, zone) + l.gain);
  // dans un pays opaque, l'« hospitalité » envers un ministre ressemble vite à de la corruption
  if (kind === 'diner' && z.baseStability < 65) recordCase(s, 'corruption', 1 + (65 - z.baseStability) / 20, l.cost, `Hospitalité offerte à un ministre (${z.name})`);
  return { ok: true, message: `${l.label} : relation avec ${z.name} ${Math.round(relation(s, zone))}/100.` };
}

/** Rescrit fiscal avec le gouvernement du siège : −3 points d'impôt pendant 3 ans. */
export function requestTaxRuling(s: GameState): ActionResult {
  const zone = CITY_ZONE[s.company.hqCity]!;
  const g = govState(s);
  if (g.taxRuling && g.taxRuling.untilDay > s.day) return { ok: false, message: 'Un rescrit est déjà en vigueur.' };
  if (relation(s, zone) < 40) return { ok: false, message: `Relation insuffisante avec ${ZONE_BY_ID[zone]?.name ?? zone} (40 requis).` };
  if (s.company.physVolumeYtd < 50e6) return { ok: false, message: 'Le gouvernement attend un engagement de volume : 50 M$ de physique dans l’année.' };
  const fee = 150_000;
  addCash(s, -fee, 'tax');
  g.taxRuling = { cut: 0.03, untilDay: s.day + 3 * 365 };
  g.relations[zone] = relation(s, zone) - 10;
  return { ok: true, message: 'Rescrit fiscal obtenu : −3 points d’impôt pendant trois ans.' };
}

export function taxRulingCut(s: GameState): number {
  const r = s.gov?.taxRuling;
  return r && r.untilDay > s.day ? r.cut : 0;
}

/** Amélioration des offres d'un pays où l'on détient une licence (fraction du prix). */
export function licenceEdge(s: GameState, zone: string): number {
  return hasLicence(s, zone) ? 0.0005 : 0;
}

/** Au changement de mois : appels d'offres, érosion des relations, rappel d'expiration des licences. */
export function govMonth(s: GameState) {
  const g = govState(s);
  for (const z of Object.keys(g.relations)) g.relations[z] = g.relations[z]! * 0.97;
  for (const l of g.licences.filter((x) => x.untilDay >= s.day && x.untilDay < s.day + 31)) s.pendingAlerts.push({ kind: 'delivery', text: `Votre licence pour ${ZONE_BY_ID[l.zone]?.name ?? l.zone} expire dans le mois.` });
  generateTenders(s);
}
