/**
 * Situations du mode Histoire : demandes de seniors, erreurs à rattraper, appels clients, dilemmes éthiques,
 * débauchages, entretiens, presse, conflits, missions propres à chaque filière… Chaque choix modifie les
 * compétences, la réputation, les relations (mémoire des PNJ), le mérite ou le livre, et peut laisser une
 * COMPROMISSION qui ressurgira peut-être des années plus tard sous forme d'enquête.
 *
 * Aussi : les tuyaux des relations (informations en avance, parfois privilégiées : délit d'initié s'il est
 * exploité) et les enquêtes.
 */
import { loreAside } from './lore';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { COMPANY_BY_ID } from '../data/companies';
import { TRACK_TITLES } from '../data/career';
import { addBusinessDays } from './calendar';
import { listedMonths } from './contracts';
import { addCash, newId } from './ledger';
import { futuresPrice } from './market';
import { addNews } from './news';
import { findRole, npc, npcsOf, remember } from './npcs';
import { chance, pick, randInt, uniform } from './rng';
import type { ActionResult, Compromise, GameState, Situation } from './types';
import { exposures } from './valuation';
import { schedule } from './world';
import { careerLog, fire, gainSkill, interviewChance, isEmployee, promote, salaryFor, title } from './career';
import { startNegotiation } from './negotiation';

type Built = Omit<Situation, 'id' | 'day' | 'template' | 'expiresDay'> & { defaultChoice: number; ttl?: number };

interface Template {
  weight: number;
  cooldown: number;
  eligible: (s: GameState) => boolean;
  build: (s: GameState, data?: Record<string, number | string>) => Built | null;
  resolve: (s: GameState, sit: Situation, choice: number) => string;
}

const C = (s: GameState) => s.career!;
const employed = (s: GameState) => isEmployee(s) && !!s.career?.narrative;
const hasBook = (s: GameState) => (s.career?.allocation ?? 0) > 0;
/** Montant « significatif » à l'échelle du poste. */
const scale = (s: GameState) => Math.max(40_000, (s.career?.allocation ?? 0) * 0.004 + (s.career?.level ?? 0) * 25_000);

function bookPnl(s: GameState, amount: number) {
  if (hasBook(s)) addCash(s, amount, 'physical');
  else C(s).merit += Math.sign(amount);
}

export function compromise(s: GameState, kind: Compromise['kind'], severity: number, label: string, witnesses: string[]) {
  s.compromises.push({ id: newId(s, 'cp'), day: s.day, kind, severity, label, witnesses, resolved: false });
  for (const w of witnesses) npc(s, w)?.knows.push(label);
}

const k = (x: number) => `${Math.round(x / 1000).toLocaleString('fr-FR')} k$`;

const TEMPLATES: Record<string, Template> = {
  senior_request: {
    weight: 3, cooldown: 12, eligible: (s) => employed(s) && C(s).level <= 4,
    build: (s) => {
      const who = chance(s.rng, 0.6) ? findRole(s, 'manager', C(s).employerId) : findRole(s, 'collègue', C(s).employerId);
      const c = pick(s.rng, C(s).desk.length ? C(s).desk : COMMODITY_IDS);
      return { title: 'Demande pressante', text: `${who?.name} vous demande une analyse complète de la courbe ${COMMODITIES[c].short} pour demain 7 h.`, npcId: who?.id, urgent: false, defaultChoice: 1, choices: [{ label: 'Rester tard et faire un travail soigné', hint: 'compétence, confiance' }, { label: 'Livrer un travail rapide', hint: 'risque de décevoir' }, { label: 'Négocier un délai', hint: 'neutre' }] };
    },
    resolve: (s, sit, ch) => {
      if (ch === 0) { gainSkill(s, 'marché', 2); remember(s, sit.npcId, 7, 'Analyse soignée livrée à temps'); C(s).merit += 1; return 'Travail apprécié. Vous progressez.'; }
      if (ch === 1) { remember(s, sit.npcId, -5, 'Analyse bâclée'); return 'L’analyse comportait des erreurs. On l’a remarqué.'; }
      remember(s, sit.npcId, -1, 'A demandé un délai'); return 'Délai accordé, sans enthousiasme.';
    },
  },
  error: {
    weight: 2, cooldown: 25, eligible: (s) => employed(s) && C(s).level >= 1,
    build: (s) => {
      const col = findRole(s, 'collègue', C(s).employerId);
      const loss = Math.round(scale(s) * (0.5 + uniform(s.rng)));
      return { title: 'Erreur de saisie', text: `${col?.name} a saisi un ordre à l’envers. La perte atteint ${k(loss)}. Personne d’autre ne l’a encore vu.`, npcId: col?.id, urgent: true, defaultChoice: 0, data: { loss }, choices: [{ label: 'Signaler immédiatement', hint: 'transparence' }, { label: 'Corriger discrètement et couvrir le collègue', hint: 'il vous devra une fière chandelle…' }, { label: 'Le dénoncer au manager', hint: 'carriériste' }] };
    },
    resolve: (s, sit, ch) => {
      const mgr = findRole(s, 'manager', C(s).employerId);
      if (ch === 0) { remember(s, sit.npcId, -10, 'Erreur signalée'); remember(s, mgr?.id, 5, 'Transparence sur une erreur'); C(s).merit += 1; return 'Erreur corrigée, perte limitée. Le manager apprécie votre transparence.'; }
      if (ch === 1) { remember(s, sit.npcId, 18, 'Vous l’avez couvert'); bookPnl(s, -Number(sit.data!.loss) * 0.5); compromise(s, 'dissimulation', 2, 'Dissimulation d’une erreur de saisie', [sit.npcId!]); return 'Personne ne saura… tant que votre collègue reste votre ami.'; }
      remember(s, sit.npcId, -28, 'Vous l’avez dénoncé'); remember(s, mgr?.id, 3, 'A signalé l’erreur d’un collègue'); C(s).merit += 1; return 'Le manager prend note. Votre collègue, aussi.';
    },
  },
  client_call: {
    weight: 3, cooldown: 10, eligible: (s) => employed(s) && ((C(s).track === 'trading' && C(s).level >= 2) || C(s).track === 'structured'),
    build: (s) => {
      const cands = npcsOf(s, 'client').filter((n) => n.companyId !== C(s).employerId);
      const cl = pick(s.rng, cands);
      const c = pick(s.rng, C(s).desk.length ? C(s).desk : COMMODITY_IDS);
      return { title: 'Appel client', text: `${cl.name} (${COMPANY_BY_ID[cl.companyId!]?.name}) a besoin d’une cargaison de ${COMMODITIES[c].short} en urgence. Il est pressé, et il le sait.`, npcId: cl.id, urgent: false, defaultChoice: 2, data: { gain: Math.round(scale(s) * 1.5) }, choices: [{ label: 'Profiter de l’urgence : prix fort', hint: 'gain immédiat, relation abîmée' }, { label: 'Prix juste', hint: 'relation de long terme' }, { label: 'Décliner', hint: '' }] };
    },
    resolve: (s, sit, ch) => {
      const g = Number(sit.data!.gain);
      if (ch === 0) { bookPnl(s, g); remember(s, sit.npcId, -12, 'Vous avez profité de son urgence'); gainSkill(s, 'négociation', 1); return `Marge confortable (+${k(g)}). Le client s’en souviendra.`; }
      if (ch === 1) { bookPnl(s, g * 0.35); remember(s, sit.npcId, 10, 'Prix juste dans l’urgence'); gainSkill(s, 'relationnel', 1); return 'Deal conclu ; le client vous fera de nouveau appel.'; }
      remember(s, sit.npcId, -3, 'Demande déclinée'); return 'Le client trouvera ailleurs.';
    },
  },
  bribe: {
    weight: 1.5, cooldown: 60, eligible: (s) => (employed(s) && C(s).level >= 2) || C(s).status === 'founder' || C(s).status === 'ceo',
    build: (s) => {
      const off = pick(s.rng, npcsOf(s, 'officiel'));
      const gain = Math.round(scale(s) * 6);
      return { title: 'Une « facilitation »', text: `Un intermédiaire proche de ${off.name}, fonctionnaire influent, propose de débloquer un contrat d’enlèvement très rentable contre une commission de 2 % versée sur un compte à l’étranger.`, npcId: off.id, urgent: true, defaultChoice: 1, data: { gain }, choices: [{ label: 'Accepter discrètement', hint: `+${k(gain)}… et un risque pénal durable` }, { label: 'Refuser poliment', hint: '' }, { label: 'Refuser et alerter la conformité', hint: 'réputation' }] };
    },
    resolve: (s, sit, ch) => {
      if (ch === 0) { bookPnl(s, Number(sit.data!.gain)); remember(s, sit.npcId, 20, 'A accepté sa commission'); compromise(s, 'corruption', 4, `Commission versée à l’entourage de ${npc(s, sit.npcId)?.name}`, [sit.npcId!]); return 'Le contrat est signé. Les fonds ont transité par trois juridictions.'; }
      if (ch === 1) { remember(s, sit.npcId, -10, 'A refusé une commission'); return 'L’intermédiaire n’insiste pas. Pour l’instant.'; }
      remember(s, sit.npcId, -30, 'L’a signalé à la conformité'); remember(s, findRole(s, 'conformité', C(s).employerId)?.id, 15, 'Signalement d’une tentative de corruption'); C(s).reputation += 2; return 'La conformité ouvre un dossier. Votre intégrité est remarquée.';
    },
  },
  journalist: {
    weight: 1.2, cooldown: 40, eligible: (s) => !!s.career?.narrative && C(s).status !== 'unemployed',
    build: (s) => {
      const j = pick(s.rng, npcsOf(s, 'journaliste'));
      return { title: 'Un journaliste appelle', text: `${j.name} prépare un article sur les pratiques du secteur et aimerait votre éclairage « off the record ».`, npcId: j.id, urgent: false, defaultChoice: 1, choices: [{ label: 'Parler en off', hint: 'relation presse… risque de fuite' }, { label: 'Pas de commentaire', hint: '' }, { label: 'Proposer un entretien officiel sur le marché', hint: 'réputation' }] };
    },
    resolve: (s, sit, ch) => {
      if (ch === 0) { remember(s, sit.npcId, 15, 'Source précieuse'); if (chance(s.rng, 0.3) && isEmployee(s)) { remember(s, findRole(s, 'manager', C(s).employerId)?.id, -18, 'A parlé à la presse'); return 'L’article cite « une source interne » : votre manager fait le rapprochement.'; } return 'Le journaliste vous doit un service.'; }
      if (ch === 1) { remember(s, sit.npcId, -4, 'Pas de commentaire'); return 'Rien à signaler.'; }
      C(s).reputation += 1; remember(s, sit.npcId, 5, 'Interview officielle'); gainSkill(s, 'relationnel', 1); return 'Votre analyse est publiée sous votre nom.';
    },
  },
  networking: {
    weight: 2, cooldown: 20, eligible: (s) => !!s.career?.narrative,
    build: () => ({ title: 'Conférence du secteur', text: 'La grande conférence annuelle du négoce a lieu cette semaine : dîners, cocktails, et beaucoup de cartes de visite.', urgent: false, defaultChoice: 1, choices: [{ label: 'Y aller (3 000 $)', hint: 'réseau' }, { label: 'Rester travailler', hint: '' }] }),
    resolve: (s, _sit, ch) => {
      if (ch === 1) { C(s).merit += 0.5; return 'Vous avancez sur vos dossiers.'; }
      C(s).wealth -= 3000;
      const met = [pick(s.rng, s.npcs.filter((n) => n.role === 'client')), pick(s.rng, s.npcs.filter((n) => n.role === 'banquier' || n.role === 'chasseur'))];
      for (const n of met) remember(s, n.id, 7, 'Rencontré à la conférence');
      gainSkill(s, 'relationnel', 2);
      return `Vous avez sympathisé avec ${met.map((n) => n.name).join(' et ')}.`;
    },
  },
  credit_steal: {
    weight: 1.5, cooldown: 40, eligible: (s) => employed(s) && C(s).level <= 4,
    build: (s) => {
      const col = findRole(s, 'collègue', C(s).employerId);
      return { title: 'Votre idée, son succès', text: `${col?.name} vient de présenter votre analyse en réunion… comme la sienne. Le manager a adoré.`, npcId: col?.id, urgent: false, defaultChoice: 2, choices: [{ label: 'Le confronter en tête-à-tête', hint: '' }, { label: 'Rétablir la vérité devant le manager', hint: 'mérite, conflit' }, { label: 'Laisser passer', hint: '' }] };
    },
    resolve: (s, sit, ch) => {
      const mgr = findRole(s, 'manager', C(s).employerId);
      if (ch === 0) { remember(s, sit.npcId, -8, 'Confrontation'); return 'Il s’excuse du bout des lèvres.'; }
      if (ch === 1) { remember(s, sit.npcId, -25, 'L’a démasqué devant le manager'); remember(s, mgr?.id, (mgr?.trust ?? 0) > 0 ? 6 : -3, 'Conflit dans l’équipe'); C(s).merit += 1; return 'Le manager rétablit les faits. L’ambiance est glaciale.'; }
      remember(s, sit.npcId, 5, 'Vous avez laissé passer'); C(s).merit -= 0.5; return 'Vous gardez la paix… et perdez un peu de visibilité.';
    },
  },
  rogue: {
    weight: 1, cooldown: 80, eligible: (s) => employed(s) && (C(s).track === 'risk' || C(s).level >= 5),
    build: (s) => {
      const col = findRole(s, 'collègue', C(s).employerId);
      return { title: 'Positions cachées', text: `En contrôlant les livres, vous découvrez que ${col?.name} dépasse largement ses limites et masque ses pertes dans des positions fictives. Il vous supplie de lui laisser une semaine pour se refaire.`, npcId: col?.id, urgent: true, defaultChoice: 0, data: { loss: Math.round(scale(s) * 10) }, choices: [{ label: 'Escalader immédiatement', hint: 'devoir' }, { label: 'Lui laisser une semaine', hint: 'risque énorme' }, { label: 'Fermer les yeux', hint: 'complicité' }] };
    },
    resolve: (s, sit, ch) => {
      const loss = Number(sit.data!.loss);
      if (ch === 0) { remember(s, sit.npcId, -40, 'L’a dénoncé'); remember(s, findRole(s, 'manager', C(s).employerId)?.id, 10, 'A détecté un trader voyou'); C(s).merit += 3; gainSkill(s, 'risque', 3); return 'Les positions sont débouclées à temps. Vous avez évité une catastrophe.'; }
      if (ch === 1) { if (chance(s.rng, 0.5)) { remember(s, sit.npcId, 20, 'Lui a laissé sa chance'); return 'Il s’est refait. Vous avez eu de la chance.'; } C(s).merit -= 3; const e = s.companies.find((x) => x.id === C(s).employerId); if (e) e.nav -= loss; compromise(s, 'complicité', 2, 'Silence sur un trader voyou', [sit.npcId!]); return `Les pertes ont doublé (${k(loss)}). Votre silence est connu de lui.`; }
      compromise(s, 'complicité', 3, 'Complicité de dissimulation de pertes', [sit.npcId!]); remember(s, sit.npcId, 25, 'A fermé les yeux'); return 'Vous n’avez rien vu. Officiellement.';
    },
  },
  ops_demurrage: {
    weight: 2.5, cooldown: 15, eligible: (s) => employed(s) && C(s).track === 'operations',
    build: (s) => {
      const amt = Math.round(scale(s) * 1.2);
      return { title: 'Réclamation de surestaries', text: `Un armateur réclame ${k(amt)} de surestaries pour un navire resté six jours au port. Les relevés de temps sont discutables.`, urgent: false, defaultChoice: 1, data: { amt }, choices: [{ label: 'Contester pièce par pièce', hint: 'compétence opérations' }, { label: 'Payer pour préserver la relation', hint: '' }, { label: 'Menacer de ne plus affréter ses navires', hint: '' }] };
    },
    resolve: (s, _sit, ch) => {
      const ok = uniform(s.rng) < 0.3 + C(s).skills.opérations / 150;
      if (ch === 0) { gainSkill(s, 'opérations', 2); if (ok) { C(s).merit += 2; return 'Réclamation réduite de moitié grâce à votre dossier.'; } C(s).merit -= 0.5; return 'L’arbitrage donne raison à l’armateur.'; }
      if (ch === 1) { C(s).merit -= 0.5; return 'Réglé. L’armateur vous réserve ses meilleurs navires.'; }
      gainSkill(s, 'négociation', 1); C(s).merit += ok ? 1 : -1; return ok ? 'L’armateur cède.' : 'L’armateur durcit le ton ; la relation se tend.';
    },
  },
  sf_prepay: {
    weight: 2.5, cooldown: 25, eligible: (s) => employed(s) && C(s).track === 'structured',
    build: (s) => {
      const cl = pick(s.rng, npcsOf(s, 'client'));
      return { title: 'Structurer un prépaiement', text: `${cl.name} (${COMPANY_BY_ID[cl.companyId!]?.name}) demande un prépaiement de 50 M$ contre ses livraisons futures. Il refuse de nantir ses stocks.`, npcId: cl.id, urgent: false, defaultChoice: 0, choices: [{ label: 'Exiger nantissement et assurance-crédit', hint: 'solide, client mécontent' }, { label: 'Accepter sans garantie pour gagner le deal', hint: 'risque de défaut' }, { label: 'Proposer un montant réduit', hint: '' }] };
    },
    resolve: (s, sit, ch) => {
      if (ch === 0) { remember(s, sit.npcId, -6, 'Conditions exigeantes'); gainSkill(s, 'finance', 2); C(s).merit += 1.5; return 'Deal sécurisé. La direction apprécie la rigueur.'; }
      if (ch === 1) {
        remember(s, sit.npcId, 12, 'Prépaiement sans garantie');
        C(s).merit += 2;
        if (chance(s.rng, 0.35)) s.situations.push({ id: newId(s, 'si'), day: addBusinessDays(s.day, randInt(s.rng, 60, 160)), template: 'info', title: 'Le prépaiement tourne mal', text: `${npc(s, sit.npcId)?.name} ne livre plus. Les 50 M$ sans garantie sont en danger : votre jugement est remis en cause.`, choices: [{ label: 'Assumer' }], urgent: false, expiresDay: addBusinessDays(s.day, 200), data: { merit: -5 } });
        return 'Le client est ravi. Espérons qu’il livre.';
      }
      gainSkill(s, 'finance', 1); C(s).merit += 1; return 'Compromis accepté.';
    },
  },
  research_call: {
    weight: 2.5, cooldown: 25, eligible: (s) => employed(s) && C(s).track === 'research',
    build: (s) => {
      const c = pick(s.rng, COMMODITY_IDS);
      return { title: 'Note de recherche', text: `La direction veut votre avis sur le ${COMMODITIES[c].short} à trois mois. Votre note sera diffusée aux clients.`, urgent: false, defaultChoice: 2, data: { c }, choices: [{ label: 'Haussier', hint: '' }, { label: 'Baissier', hint: '' }, { label: 'Neutre et prudent', hint: 'sans risque, sans éclat' }] };
    },
    resolve: (s, sit, ch) => {
      const c = sit.data!.c as keyof typeof COMMODITIES;
      gainSkill(s, 'marché', 1);
      if (ch === 2) return 'Note publiée. Personne ne la lira vraiment.';
      const mi = listedMonths(COMMODITIES[c], s.day)[1]!;
      s.situations.push({ id: newId(s, 'si'), day: addBusinessDays(s.day, 63), template: 'research_outcome', title: 'Bilan de votre note', text: '', choices: [{ label: 'Voir' }], urgent: false, expiresDay: addBusinessDays(s.day, 80), data: { c, mi, ref: futuresPrice(s.market, c, mi), dir: ch === 0 ? 1 : -1 } });
      return 'Note publiée ; on jugera dans trois mois.';
    },
  },
  research_outcome: {
    weight: 0, cooldown: 0, eligible: () => false, build: () => null,
    resolve: (s, sit) => {
      const c = sit.data!.c as keyof typeof COMMODITIES;
      const months = listedMonths(COMMODITIES[c], s.day);
      const mi = months.includes(Number(sit.data!.mi)) ? Number(sit.data!.mi) : months[0]!;
      const right = Math.sign(futuresPrice(s.market, c, mi) - Number(sit.data!.ref)) === Number(sit.data!.dir);
      C(s).merit += right ? 3 : -2;
      C(s).reputation += right ? 2 : -1;
      return right ? 'Votre prévision s’est réalisée : les clients en redemandent.' : 'Le marché vous a donné tort.';
    },
  },
  mentor: {
    weight: 1.5, cooldown: 60, eligible: (s) => employed(s) && C(s).level <= 3,
    build: (s) => {
      const m = findRole(s, 'mentor', C(s).employerId);
      return { title: 'Proposition de mentorat', text: `${m?.name}, figure respectée de la maison, propose de vous prendre sous son aile : un déjeuner par semaine, et des dossiers difficiles.`, npcId: m?.id, urgent: false, defaultChoice: 1, choices: [{ label: 'Accepter', hint: 'compétences' }, { label: 'Décliner poliment', hint: '' }] };
    },
    resolve: (s, sit, ch) => {
      if (ch === 1) { remember(s, sit.npcId, -3, 'Mentorat décliné'); return 'Une autre fois peut-être.'; }
      const c = C(s);
      gainSkill(s, c.track === 'trading' ? 'marché' : c.track === 'risk' ? 'risque' : c.track === 'operations' ? 'opérations' : 'finance', 4);
      gainSkill(s, 'relationnel', 1);
      remember(s, sit.npcId, 12, 'Accepté comme mentoré');
      return 'Vous apprenez énormément.';
    },
  },
  banker_lunch: {
    weight: 1.2, cooldown: 45, eligible: (s) => !!s.career?.narrative && C(s).level >= 3,
    build: (s) => {
      const b = pick(s.rng, npcsOf(s, 'banquier'));
      return { title: 'Déjeuner avec un banquier', text: `${b.name} (${COMPANY_BY_ID[b.companyId!]?.name}) vous invite à déjeuner. Il « aime connaître les talents avant qu’ils ne deviennent clients ».`, npcId: b.id, urgent: false, defaultChoice: 1, choices: [{ label: 'Accepter', hint: 'relation bancaire' }, { label: 'Décliner', hint: '' }] };
    },
    resolve: (s, sit, ch) => {
      if (ch === 1) return 'Une autre fois.';
      remember(s, sit.npcId, 10, 'Déjeuner cordial'); gainSkill(s, 'finance', 1); return 'Excellent contact : il vous suivra si vous créez un jour votre société.';
    },
  },
  sanctions_evasion: {
    weight: 1.5, cooldown: 60, eligible: (s) => s.world.sanctions.length > 0 && ((employed(s) && C(s).level >= 3) || C(s).status === 'founder' || C(s).status === 'ceo'),
    build: (s) => {
      const cl = pick(s.rng, npcsOf(s, 'client'));
      const gain = Math.round(scale(s) * 8);
      return { title: 'Des barils sans origine', text: `${cl.name} propose des cargaisons « d’origine mixte » via des sociétés écrans, 20 % sous le marché. Tout le monde sait d’où elles viennent.`, npcId: cl.id, urgent: true, defaultChoice: 1, data: { gain }, choices: [{ label: 'Accepter', hint: `+${k(gain)}, violation de sanctions` }, { label: 'Refuser', hint: '' }] };
    },
    resolve: (s, sit, ch) => {
      if (ch === 1) { remember(s, sit.npcId, -6, 'A refusé les barils douteux'); return 'Vous déclinez.'; }
      bookPnl(s, Number(sit.data!.gain)); remember(s, sit.npcId, 15, 'Partenaire peu regardant'); compromise(s, 'sanctions', 5, 'Contournement de sanctions via sociétés écrans', [sit.npcId!]); return 'Les cargaisons changent trois fois de nom en mer. La marge est superbe.';
    },
  },
  manipulation: {
    weight: 1, cooldown: 80, eligible: (s) => (employed(s) && C(s).track === 'trading' && C(s).level >= 4) || C(s).status === 'founder' || C(s).status === 'ceo',
    build: (s) => {
      const gain = Math.round(scale(s) * 5);
      return { title: 'Fixer le prix de clôture', text: 'Un collègue suggère de concentrer de gros ordres dans la dernière minute de cotation pour influencer le prix de référence de vos contrats physiques indexés.', urgent: false, defaultChoice: 1, data: { gain }, choices: [{ label: 'Le faire', hint: `+${k(gain)}, abus de marché` }, { label: 'Refuser', hint: '' }] };
    },
    resolve: (s, sit, ch) => {
      if (ch === 1) return 'Vous refusez. C’est de l’abus de marché.';
      bookPnl(s, Number(sit.data!.gain)); compromise(s, 'manipulation', 4, 'Manipulation d’un prix de clôture', [findRole(s, 'collègue', C(s).employerId)?.id ?? '']); return 'Le prix de règlement a bougé dans votre sens.';
    },
  },
  quality_claim: {
    weight: 1.5, cooldown: 30, eligible: (s) => employed(s) && (C(s).track === 'operations' || (C(s).track === 'trading' && C(s).level >= 3)),
    build: (s) => {
      const cl = pick(s.rng, npcsOf(s, 'client'));
      const amt = Math.round(scale(s));
      return { title: 'Réclamation qualité', text: `${cl.name} affirme que la dernière cargaison était hors spécifications et réclame ${k(amt)}.`, npcId: cl.id, urgent: false, defaultChoice: 0, data: { amt }, choices: [{ label: 'Faire analyser par un laboratoire indépendant', hint: 'opérations' }, { label: 'Indemniser', hint: 'relation' }, { label: 'Rejeter la réclamation', hint: '' }] };
    },
    resolve: (s, sit, ch) => {
      const amt = Number(sit.data!.amt);
      if (ch === 0) { gainSkill(s, 'opérations', 2); if (chance(s.rng, 0.55)) { remember(s, sit.npcId, -3, 'Expertise défavorable'); return 'Le laboratoire confirme la conformité : réclamation rejetée.'; } bookPnl(s, -amt); remember(s, sit.npcId, 4, 'Expertise honnête'); return 'Le laboratoire donne raison au client.'; }
      if (ch === 1) { bookPnl(s, -amt * 0.6); remember(s, sit.npcId, 10, 'Indemnisation rapide'); return 'Client satisfait.'; }
      remember(s, sit.npcId, -15, 'Réclamation rejetée'); return 'Le client menace de ne plus travailler avec vous.';
    },
  },
  regulator: {
    weight: 0.8, cooldown: 120, eligible: (s) => !!s.career?.narrative && C(s).level >= 4 && C(s).status !== 'unemployed',
    build: () => ({ title: 'Visite du régulateur', text: 'Le régulateur mène une inspection de routine et vous interroge sur les procédures du desk.', urgent: true, defaultChoice: 0, choices: [{ label: 'Répondre avec transparence', hint: 'vos éventuels écarts pourraient remonter' }, { label: 'Rester évasif', hint: 'mensonge' }] }),
    resolve: (s, _sit, ch) => {
      const open = s.compromises.filter((x) => !x.resolved);
      if (ch === 0) { if (open.length && chance(s.rng, 0.5)) { const c = pick(s.rng, open); c.witnesses.push('régulateur'); return `L’inspecteur relève une anomalie liée à : « ${c.label} ». Une enquête pourrait suivre.`; } C(s).reputation += 1; return 'Inspection sans suite.'; }
      compromise(s, 'mensonge', 2, 'Déclarations évasives au régulateur', []); return 'L’inspecteur repart, sceptique.';
    },
  },
  team_conflict: {
    weight: 1.5, cooldown: 40, eligible: (s) => employed(s) && C(s).team.length >= 2,
    build: (s) => {
      const [a, b] = C(s).team;
      return { title: 'Conflit dans l’équipe', text: `${a!.name} et ${b!.name} se disputent la même enveloppe de risque et ne se parlent plus.`, urgent: false, defaultChoice: 2, choices: [{ label: `Donner raison à ${a!.name}`, hint: '' }, { label: `Donner raison à ${b!.name}`, hint: '' }, { label: 'Partager équitablement et recadrer', hint: 'management' }] };
    },
    resolve: (s, _sit, ch) => {
      const t = C(s).team;
      if (ch === 2) { gainSkill(s, 'relationnel', 2); return 'L’équipe se calme.'; }
      t[ch]!.skill += 3; t[1 - ch]!.skill -= 5; return 'Décision prise ; l’un est galvanisé, l’autre démotivé.';
    },
  },
  // -------------------------------------------------- générées par d'autres mécaniques
  headhunter: {
    weight: 0, cooldown: 0, eligible: () => false,
    build: (s, d) => {
      const o = C(s).offers.find((x) => x.id === d!.offerId);
      if (!o) return null;
      const h = npc(s, String(d!.npcId));
      return { title: 'Un chasseur de têtes appelle', text: `${h?.name} : « ${COMPANY_BY_ID[o.companyId]?.name} cherche un ${TRACK_TITLES[o.track][o.level]!.toLowerCase()}. Package autour de ${k(o.salary * 12)} par an. Ça vous intéresse ? »`, npcId: h?.id, urgent: false, defaultChoice: 1, data: d, ttl: 12, choices: [{ label: 'Passer l’entretien', hint: '' }, { label: 'Décliner', hint: '' }, ...(isEmployee(s) ? [{ label: 'S’en servir pour négocier une augmentation', hint: 'levier réel' }] : [])] };
    },
    resolve: (s, sit, ch) => {
      const o = C(s).offers.find((x) => x.id === sit.data!.offerId);
      if (!o) return 'L’offre a expiré.';
      if (ch === 0) { pushSituation(s, 'interview', { offerId: o.id }); return 'Entretien programmé.'; }
      if (ch === 1) { remember(s, sit.npcId, -2, 'Offre déclinée'); C(s).offers = C(s).offers.filter((x) => x !== o); return 'Vous déclinez.'; }
      const mgr = findRole(s, 'manager', C(s).employerId);
      const cur = C(s).salary;
      startNegotiation(s, { kind: 'salaire', npcId: mgr?.id ?? '', title: 'Renégocier votre salaire', unit: '$ / mois', opening: cur * 1.03, reservation: Math.max(cur * 1.05, o.salary * (0.9 + (mgr?.trust ?? 0) / 500)), leverage: true, higherIsBetter: true, context: {} });
      return 'Vous demandez un rendez-vous à votre manager.';
    },
  },
  interview: {
    weight: 0, cooldown: 0, eligible: () => false,
    build: (s, d) => {
      const o = C(s).offers.find((x) => x.id === d!.offerId);
      if (!o) return null;
      return { title: `Entretien chez ${COMPANY_BY_ID[o.companyId]?.name}`, text: `Trois tours d’entretien pour un poste de ${TRACK_TITLES[o.track][o.level]!.toLowerCase()}. Vos références seront appelées.`, urgent: false, defaultChoice: 1, data: d, ttl: 8, choices: [{ label: 'Préparer sérieusement (2 soirées)', hint: '+ chances' }, { label: 'Y aller au culot', hint: '' }] };
    },
    resolve: (s, sit, ch) => {
      const o = C(s).offers.find((x) => x.id === sit.data!.offerId);
      if (!o) return 'L’offre a expiré.';
      const p = interviewChance(s, o.companyId, o.track, o.level, ch === 0);
      if (uniform(s.rng) < p) {
        o.interviewed = true;
        o.expiresDay = addBusinessDays(s.day, 10);
        gainSkill(s, 'négociation', 1);
        return `Offre ferme : ${k(o.salary)} par mois. Acceptez-la ou négociez-la dans le panneau Carrière.`;
      }
      C(s).offers = C(s).offers.filter((x) => x !== o);
      return 'Ils ont choisi un autre candidat.';
    },
  },
  promotion: {
    weight: 0, cooldown: 0, eligible: () => false,
    build: (s, d) => {
      const lvl = Number(d!.level);
      const t = TRACK_TITLES[C(s).track][lvl]!;
      return { title: 'Promotion !', text: lvl === 7 ? `Le conseil d’administration vous propose de devenir CEO de ${COMPANY_BY_ID[C(s).employerId!]?.name}.` : `Votre manager vous propose de devenir ${t}.`, npcId: findRole(s, 'manager', C(s).employerId)?.id, urgent: true, defaultChoice: 0, data: d, ttl: 10, choices: [{ label: 'Accepter', hint: '' }, ...(lvl < 7 ? [{ label: 'Accepter et négocier le salaire', hint: 'mini-jeu' }] : [])] };
    },
    resolve: (s, sit, ch) => {
      const lvl = Number(sit.data!.level);
      if (ch === 1) {
        const mgr = npc(s, sit.npcId);
        const base = Math.max(C(s).salary * 1.15, salaryFor(lvl, C(s).employerId));
        promote(s, lvl, base);
        startNegotiation(s, { kind: 'salaire', npcId: mgr?.id ?? '', title: `Salaire de ${title(C(s))}`, unit: '$ / mois', opening: base, reservation: base * (1.12 + (mgr?.trust ?? 0) / 400 + C(s).skills.négociation / 600), leverage: C(s).offers.some((o) => o.interviewed), higherIsBetter: true, context: {} });
        return 'Promotion acceptée ; place à la négociation.';
      }
      promote(s, lvl);
      return `Félicitations, ${title(C(s))} !`;
    },
  },
  bonus: {
    weight: 0, cooldown: 0, eligible: () => false,
    build: (s, d) => ({ title: 'Entretien de bonus', text: `Votre manager vous annonce un bonus de ${k(Number(d!.amount))}.`, npcId: findRole(s, 'manager', C(s).employerId)?.id, urgent: true, defaultChoice: 0, data: d, ttl: 8, choices: [{ label: 'Remercier et accepter', hint: '' }, { label: 'Négocier', hint: 'mini-jeu' }] }),
    resolve: (s, sit, ch) => {
      const amt = Number(sit.data!.amount);
      if (ch === 0) { C(s).wealth += amt; remember(s, sit.npcId, 2, 'Bonus accepté'); careerLog(s, `Bonus : ${k(amt)}.`); return `Bonus versé : ${k(amt)}.`; }
      startNegotiation(s, { kind: 'bonus', npcId: sit.npcId ?? '', title: 'Négociation du bonus', unit: '$', opening: amt, reservation: Number(sit.data!.reservation), leverage: C(s).offers.some((o) => o.interviewed), higherIsBetter: true, context: {} });
      return 'La négociation commence.';
    },
  },
  risk_breach: {
    weight: 0, cooldown: 0, eligible: () => false,
    build: (_s, d) => ({ title: 'Le risk management vous convoque', text: `Vos limites sont dépassées (${d!.strikes} incident${Number(d!.strikes) > 1 ? 's' : ''}). Au troisième, votre livre sera gelé ; au cinquième, c’est la porte.`, npcId: String(d!.npcId) || undefined, urgent: true, defaultChoice: 0, data: d, ttl: 3, choices: [{ label: 'Reconnaître et réduire', hint: 'confiance du risk manager' }, { label: 'Défendre votre position', hint: 'si votre P&L le justifie…' }] }),
    resolve: (s, sit, ch) => {
      if (ch === 0) { remember(s, sit.npcId, 6, 'A reconnu le dépassement'); gainSkill(s, 'risque', 1); return 'Réduisez vos positions (bouton « Neutraliser Δ » dans le panneau Risque).'; }
      const good = s.history.at(-1)?.pnl ?? 0;
      remember(s, sit.npcId, -10, 'A contesté les limites');
      remember(s, findRole(s, 'manager', C(s).employerId)?.id, good > 0 ? 2 : -6, 'Conflit avec le risk management');
      return 'Le risk manager note votre attitude.';
    },
  },
  warning: {
    weight: 0, cooldown: 0, eligible: () => false,
    build: (s, d) => ({ title: 'Avertissement', text: `Votre évaluation (${d!.score}/100) est insuffisante. Une seconde évaluation de ce niveau entraînera votre départ.`, npcId: findRole(s, 'manager', C(s).employerId)?.id, urgent: true, defaultChoice: 0, data: d, ttl: 5, choices: [{ label: 'Compris', hint: '' }] }),
    resolve: () => 'Il faut redresser la barre.',
  },
  info: {
    weight: 0, cooldown: 0, eligible: () => false, build: () => null,
    resolve: (s, sit) => { if (sit.data?.merit) C(s).merit += Number(sit.data.merit); return 'Noté.'; },
  },
  tip: {
    weight: 0, cooldown: 0, eligible: () => false,
    build: (s, d) => {
      const t = s.tips.find((x) => x.id === d!.tipId);
      if (!t) return null;
      return { title: t.insider ? 'Information sensible' : 'Un tuyau', text: t.text, npcId: t.npcId, urgent: false, defaultChoice: 1, data: d, ttl: 3, choices: [{ label: 'Merci, je note', hint: t.insider ? 'l’exploiter serait un délit d’initié' : '' }, { label: 'Ignorer', hint: '' }, ...(t.insider ? [{ label: 'Signaler à la conformité', hint: 'la source vous en voudra' }] : [])] };
    },
    resolve: (s, sit, ch) => {
      const t = s.tips.find((x) => x.id === sit.data!.tipId);
      if (ch === 2 && t) { remember(s, t.npcId, -30, 'L’a signalé'); remember(s, findRole(s, 'conformité', C(s).employerId)?.id, 10, 'Signalement d’information privilégiée'); C(s).reputation += 1; t.insider = false; return 'La conformité vous remercie. La source, beaucoup moins.'; }
      return ch === 0 ? 'Vous gardez l’information pour vous.' : 'Vous passez à autre chose.';
    },
  },
  investigation: {
    weight: 0, cooldown: 0, eligible: () => false,
    build: (s, d) => {
      const cp = s.compromises.find((x) => x.id === d!.cpId);
      if (!cp) return null;
      const ago = Math.round((s.day - cp.day) / 365 * 10) / 10;
      return { title: 'Enquête ouverte', text: `Les enquêteurs s’intéressent à une affaire d’il y a ${ago} an(s) : « ${cp.label} ». Vous êtes convoqué.`, urgent: true, defaultChoice: 0, data: d, ttl: 5, choices: [{ label: 'Coopérer', hint: 'sanctions réduites, réputation entamée' }, { label: 'Nier en bloc', hint: 'pari risqué' }, { label: 'Engager un ténor du barreau', hint: `${k(300_000 * cp.severity)}` }] };
    },
    resolve: (s, sit, ch) => resolveInvestigation(s, String(sit.data!.cpId), ch),
  },
};


export function pushSituation(state: GameState, template: string, data?: Record<string, number | string>) {
  const t = TEMPLATES[template];
  if (!t || !state.career) return;
  const b = t.build(state, data);
  if (!b) return;
  const { defaultChoice, ttl, ...rest } = b;
  // conversations détendues : parfois, un mot en passant
  if (b.npcId && !b.urgent) { const a = loreAside(state, `sit:${template}`); if (a) rest.text = `${rest.text} Au passage : « ${a} »`; }
  state.situations.push({ ...rest, id: newId(state, 'si'), day: state.day, template, expiresDay: addBusinessDays(state.day, ttl ?? (b.urgent ? 4 : 8)), data: { ...(rest.data ?? {}), defaultChoice } });
  if (b.urgent) state.pendingAlerts.push({ kind: 'situation', text: b.title });
}

/** Situations visibles aujourd'hui (les situations différées attendent leur jour). */
export function activeSituations(state: GameState) {
  return state.situations.filter((x) => x.day <= state.day);
}

export function resolveSituation(state: GameState, id: string, choice: number): ActionResult {
  const sit = state.situations.find((x) => x.id === id && x.day <= state.day);
  if (!sit) return { ok: false, message: 'Situation introuvable.' };
  const t = TEMPLATES[sit.template];
  state.situations = state.situations.filter((x) => x !== sit);
  if (!t) return { ok: false, message: 'Situation inconnue.' };
  const msg = t.resolve(state, sit, Math.max(0, Math.min(sit.choices.length - 1, choice)));
  careerLog(state, `${sit.title} — ${sit.choices[choice]?.label ?? ''} : ${msg}`);
  return { ok: true, message: msg };
}

/** Situation aléatoire du jour, puis expiration (résolue par défaut) des situations ignorées. */
export function dailySituations(state: GameState) {
  const c = state.career;
  if (!c?.narrative) return;
  for (const sit of state.situations.filter((x) => x.expiresDay < state.day)) {
    const def = Number(sit.data?.defaultChoice ?? sit.choices.length - 1);
    resolveSituation(state, sit.id, def);
    if (sit.npcId && sit.template !== 'tip') remember(state, sit.npcId, -2, 'Sollicitation restée sans réponse');
  }
  // situations différées arrivées à échéance : on les présente
  for (const sit of state.situations.filter((x) => x.day === state.day && (x.template === 'research_outcome' || x.template === 'info'))) {
    if (sit.template === 'research_outcome') sit.text = 'Trois mois ont passé : le marché a tranché sur votre note de recherche.';
    state.pendingAlerts.push({ kind: 'situation', text: sit.title });
  }
  if (activeSituations(state).length >= 3 || !chance(state.rng, 0.3)) return;
  const pool = Object.entries(TEMPLATES).filter(([key, t]) => t.weight > 0 && t.eligible(state) && (state.world.eventCooldown[`sit.${key}`] ?? -1) < state.day);
  const total = pool.reduce((s2, [, t]) => s2 + t.weight, 0);
  if (!total) return;
  let r = uniform(state.rng) * total;
  for (const [key, t] of pool) {
    r -= t.weight;
    if (r > 0) continue;
    state.world.eventCooldown[`sit.${key}`] = addBusinessDays(state.day, t.cooldown);
    pushSituation(state, key);
    break;
  }
}

// ------------------------------------------------------------------ tuyaux et délit d'initié

/**
 * Un PNJ de confiance peut livrer une information en avance (impact réel programmé dans quelques jours,
 * ou fausse piste). Si elle est privilégiée et que le joueur l'exploite (son exposition bouge dans le sens du
 * tuyau avant la publication), une compromission « délit d'initié » est enregistrée.
 */
export function maybeTip(state: GameState) {
  const c = state.career;
  if (!c?.narrative || c.status === 'unemployed') return;
  const sources = state.npcs.filter((n) => n.trust >= 35 && ['client', 'collègue', 'officiel', 'journaliste', 'banquier'].includes(n.role));
  if (!sources.length || !chance(state.rng, 0.012 * Math.min(4, sources.length))) return;
  const src = pick(state.rng, sources);
  const com = pick(state.rng, c.desk.length ? c.desk : COMMODITY_IDS);
  const dir: 1 | -1 = chance(state.rng, 0.5) ? 1 : -1;
  const insider = ['client', 'collègue', 'officiel'].includes(src.role) && chance(state.rng, 0.7);
  const real = chance(state.rng, 0.4 + src.honesty * 0.5);
  const days = randInt(state.rng, 2, 4);
  const net = exposures(state).find((e) => e.commodity === com)?.netQty ?? 0;
  const text = insider
    ? `${src.name} vous glisse, à voix basse, qu’une annonce non publique va faire ${dir > 0 ? 'monter' : 'baisser'} le ${COMMODITIES[com].short} d’ici quelques jours.`
    : `${src.name} pense que le ${COMMODITIES[com].short} va ${dir > 0 ? 'monter' : 'baisser'} prochainement (rumeurs de marché).`;
  const tip = { id: newId(state, 'tp'), day: state.day, npcId: src.id, commodity: com, dir, insider, revealDay: addBusinessDays(state.day, days), real, netAtTip: net, text };
  state.tips.push(tip);
  if (real) schedule(state, days, [{ k: 'chi', c: com, v: dir * 0.06 }, { k: 'iv', c: com, v: 0.1 }], { headline: dir > 0 ? `Annonce surprise : l’offre de ${COMMODITIES[com].short} se resserre` : `Annonce surprise : afflux de ${COMMODITIES[com].short} sur le marché`, commodity: com, tone: dir > 0 ? 'up' : 'down', major: false, category: 'marché', impacts: [{ c: com, dir }] });
  pushSituation(state, 'tip', { tipId: tip.id });
}

export function checkTips(state: GameState) {
  for (const t of state.tips.filter((x) => x.revealDay === state.day)) {
    if (!t.insider || !t.real) continue;
    const spec = COMMODITIES[t.commodity];
    const net = exposures(state).find((e) => e.commodity === t.commodity)?.netQty ?? 0;
    const moved = (net - t.netAtTip) * t.dir;
    if (moved > spec.physical.cargoSizes[0]! * 0.25) {
      compromise(state, 'initié', 4, `Délit d’initié sur le ${spec.short} (tuyau de ${npc(state, t.npcId)?.name})`, [t.npcId]);
      careerLog(state, `Vous avez traité le ${spec.short} sur la foi d’une information privilégiée.`);
    }
  }
  state.tips = state.tips.filter((x) => state.day - x.day < 60);
}

// ------------------------------------------------------------------ enquêtes

/**
 * Chaque compromission non résolue peut déclencher une enquête, en moyenne des années plus tard :
 * probabilité quotidienne ∝ gravité², ×2 si un témoin est devenu hostile, ×1,5 si un journaliste ou le
 * régulateur est au courant. Pas d'enquête avant 4 mois.
 */
export function stepCompromises(state: GameState) {
  if (!state.career) return;
  for (const cp of state.compromises.filter((x) => !x.resolved)) {
    if (state.day - cp.day < 120 || state.situations.some((s) => s.template === 'investigation' && s.data?.cpId === cp.id)) continue;
    const hostile = cp.witnesses.some((w) => (npc(state, w)?.trust ?? 0) < -20);
    const press = cp.witnesses.includes('régulateur') || state.npcs.some((n) => n.role === 'journaliste' && n.knows.includes(cp.label));
    const p = cp.severity ** 2 * 0.00006 * (hostile ? 2 : 1) * (press ? 1.5 : 1);
    if (chance(state.rng, p)) {
      addNews(state, { headline: `Enquête ouverte sur des pratiques chez ${state.company.name.split(' — ')[0]}`, tone: 'alert', major: true, category: 'réglementation' });
      pushSituation(state, 'investigation', { cpId: cp.id });
    }
  }
}

function resolveInvestigation(state: GameState, cpId: string, ch: number): string {
  const cp = state.compromises.find((x) => x.id === cpId);
  const c = state.career!;
  if (!cp) return 'Classé sans suite.';
  cp.resolved = true;
  let mult = 1;
  if (ch === 2) { c.wealth -= 300_000 * cp.severity; mult = 0.6; }
  if (ch === 1) {
    const protect = cp.witnesses.reduce((s, w) => s + (npc(state, w)?.trust ?? 0), 0) / 400;
    if (uniform(state.rng) < 0.55 - 0.08 * cp.severity + protect) return 'Faute de preuves, l’enquête est classée. Vous l’avez échappé belle.';
    mult = 1.5;
  }
  const fine = Math.round((cp.severity * 0.08 * Math.max(0, c.wealth) + 50_000 * cp.severity) * mult);
  c.wealth -= fine;
  c.reputation = Math.max(0, c.reputation - cp.severity * 4 * mult);
  if (isEmployee(state) && cp.severity * mult >= 3) fire(state, `mis en cause dans une enquête (${cp.label})`);
  if (cp.severity >= 5 && mult >= 1.5 && chance(state.rng, 0.5)) {
    state.status = 'prison';
    state.statusReason = `Condamné à de la prison ferme : ${cp.label}.`;
    c.ended = 'prison';
    state.pendingAlerts.push({ kind: 'bankrupt', text: state.statusReason });
    return state.statusReason;
  }
  if (cp.severity >= 4 && mult >= 1 && chance(state.rng, cp.severity >= 5 ? 0.5 : 0.2)) {
    state.status = 'banned';
    state.statusReason = `Interdiction d’exercer dans le négoce : ${cp.label}.`;
    c.ended = 'interdiction';
    state.pendingAlerts.push({ kind: 'bankrupt', text: state.statusReason });
    return state.statusReason;
  }
  return `Amende de ${k(fine)} et réputation entachée.`;
}

