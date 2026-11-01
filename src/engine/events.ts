/**
 * Moteur d'événements : procédural + remakes d'événements réels (noms et détails modifiés).
 *
 * Mécaniques :
 *  - RUMEUR : le marché intègre immédiatement une fraction de l'impact ; quelques jours plus tard,
 *    confirmation (le reste de l'impact) ou démenti (l'impact intégré est annulé).
 *  - IMPACT DIFFÉRÉ : prévision puis frappe (ouragans), annonce puis effet (sanctions, réunions).
 *  - EFFETS EN COURS : canal bloqué, grève, ouragan… visibles sur le globe, avec décalages de différentiels
 *    retirés à la fin de l'événement.
 *  - CALENDRIER : réunions du cartel, des banques centrales, élections.
 */
import { CITIES, CITY_BY_ID } from '../data/cities';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { COMPANY_BY_ID } from '../data/companies';
import { CITY_ZONE, ZONE_BY_ID } from '../data/world';
import { addBusinessDays, ymd } from './calendar';
import { listedMonths } from './contracts';
import { futuresPrice, spotPrice } from './market';
import { SHOCKS } from './news';
import { chance, normal, pick, randInt, uniform } from './rng';
import type { CommodityId, GameState, Impact, NewsItem } from './types';
import { applyImpact, pushNews, schedule, sanctionFor } from './world';

type NewsSpec = Omit<NewsItem, 'id' | 'day'>;

interface Fired {
  news: NewsSpec;
  impacts: Impact[];
  rumor?: { pReal: number; frac: number; resolveIn: number; confirm: NewsSpec; deny: NewsSpec };
  followUps?: { inDays: number; impacts: Impact[]; news?: NewsSpec }[];
}

interface Template {
  key: string;
  weight: number;
  cooldown: number;
  months?: number[];
  geo?: boolean; // probabilité modulée par la tension entre blocs
  when?: (s: GameState) => boolean;
  build: (s: GameState) => Fired | null;
}

const NUMERIC = new Set(['chi', 'xi', 'iv', 'basis', 'enso', 'stability', 'tension', 'freight']);

function scale(imps: Impact[], f: number): Impact[] {
  return imps.filter((i) => NUMERIC.has(i.k)).map((i) => ({ ...(i as Impact & { v: number }), v: (i as { v: number }).v * f }) as Impact);
}

function dirOf(imps: Impact[]): { c: CommodityId; dir: 1 | -1 }[] {
  const out = new Map<CommodityId, number>();
  for (const i of imps) if ((i.k === 'chi' || i.k === 'xi') && Math.abs(i.v) > 1e-6) out.set(i.c, (out.get(i.c) ?? 0) + i.v);
  return [...out.entries()].map(([c, v]) => ({ c, dir: v > 0 ? 1 : -1 }));
}

export function fire(state: GameState, f: Fired) {
  if (f.rumor) {
    const r = f.rumor;
    const real = uniform(state.rng) < r.pReal;
    for (const im of scale(f.impacts, r.frac)) applyImpact(state, im);
    pushNews(state, { ...f.news, stage: 'rumor', impacts: dirOf(f.impacts), headline: `Rumeur : ${f.news.headline}`, major: false });
    if (real) {
      const rest = [...scale(f.impacts, 1 - r.frac), ...f.impacts.filter((i) => !NUMERIC.has(i.k))];
      schedule(state, r.resolveIn, rest, { ...r.confirm, stage: 'confirmed', impacts: dirOf(f.impacts) });
      for (const fu of f.followUps ?? []) schedule(state, r.resolveIn + fu.inDays, fu.impacts, fu.news);
    } else {
      schedule(state, r.resolveIn, scale(f.impacts, -r.frac), { ...r.deny, stage: 'denied', major: false });
    }
    return;
  }
  for (const im of f.impacts) applyImpact(state, im);
  pushNews(state, { ...f.news, impacts: f.news.impacts ?? dirOf(f.impacts) });
  for (const fu of f.followUps ?? []) schedule(state, fu.inDays, fu.impacts, fu.news);
}

const aliveAi = (s: GameState, pred: (id: string) => boolean = () => true) => s.companies.filter((c) => c.alive && pred(c.id));
const HURRICANES = ['Adèle', 'Bastien', 'Célia', 'Dorian', 'Elsa', 'Fabio', 'Gaëlle', 'Hector', 'Iris', 'Joaquim', 'Kenza', 'Léo', 'Maëva'];

const TEMPLATES: Template[] = [
  // ------------------------------------------------ chocs de fondamentaux (procéduraux)
  {
    key: 'shock', weight: 0.03, cooldown: 2,
    build: (s) => {
      const t = pick(s.rng, SHOCKS);
      const size = t.dir * t.size * (0.6 + 0.8 * uniform(s.rng));
      const imps: Impact[] = [{ k: t.factor, c: t.c, v: size }, { k: 'iv', c: t.c, v: Math.abs(size) * 1.6 }];
      const news: NewsSpec = { headline: t.headline, body: t.body, commodity: t.c, tone: t.dir > 0 ? 'up' : 'down', major: Math.abs(size) > 0.07, category: 'marché' };
      if (chance(s.rng, 0.3)) {
        return { news, impacts: imps, rumor: { pReal: 0.6, frac: 0.4, resolveIn: randInt(s.rng, 1, 3), confirm: { ...news, headline: `Confirmé : ${t.headline}` }, deny: { ...news, headline: `Démenti : ${t.headline.toLowerCase()} — fausse alerte`, tone: t.dir > 0 ? 'down' : 'up' } } };
      }
      return { news, impacts: imps };
    },
  },
  {
    key: 'fake', weight: 0.004, cooldown: 15,
    build: (s) => {
      const c = pick(s.rng, COMMODITY_IDS);
      const dir: 1 | -1 = chance(s.rng, 0.5) ? 1 : -1;
      const h = dir > 0 ? `explosion sur une installation majeure du ${COMMODITIES[c].short}` : `un grand consommateur annulerait ses achats de ${COMMODITIES[c].short}`;
      const news: NewsSpec = { headline: h, body: 'Source unique sur les réseaux sociaux, reprise par quelques terminaux.', commodity: c, tone: dir > 0 ? 'up' : 'down', major: false, category: 'marché' };
      return { news, impacts: [{ k: 'chi', c, v: dir * 0.05 }], rumor: { pReal: 0, frac: 0.6, resolveIn: randInt(s.rng, 1, 2), confirm: news, deny: { ...news, headline: `Démenti : aucune ${dir > 0 ? 'explosion' : 'annulation'}, le marché efface son mouvement`, tone: dir > 0 ? 'down' : 'up' } } };
    },
  },
  // ------------------------------------------------ remakes historiques
  {
    key: 'glut', weight: 0.0006, cooldown: 400,
    when: (s) => s.market.commodities.BRENT.chi < 0,
    build: () => ({
      news: { headline: 'Plus de place pour stocker : le front du Brent s’effondre', body: 'Cuves pleines à terre et en mer, demande à l’arrêt : les détenteurs du contrat proche paient pour s’en débarrasser. Le contango explose.', commodity: 'BRENT', tone: 'down', major: true, category: 'marché' },
      impacts: [{ k: 'chi', c: 'BRENT', v: -0.55 }, { k: 'iv', c: 'BRENT', v: 0.7 }, { k: 'regime' }],
    }),
  },
  {
    key: 'squeeze', weight: 0.0007, cooldown: 400,
    build: (s) => {
      const shorts = aliveAi(s).filter((c) => (c.exposure.CU ?? 0) < 0).sort((a, b) => (a.exposure.CU ?? 0) - (b.exposure.CU ?? 0));
      const victim = shorts[0] ?? aliveAi(s, (id) => id === 'yangtze')[0];
      if (!victim) return null;
      const name = COMPANY_BY_ID[victim.id]!.name;
      return {
        news: { headline: `Squeeze historique sur le cuivre : ${name} piégé, la bourse suspend la cotation`, body: `Une position vendeuse géante de ${name} déclenche une envolée verticale. Le LMM suspend le marché plusieurs jours : impossible de couvrir ou de déboucler.`, commodity: 'CU', tone: 'up', major: true, category: 'marché', companyId: victim.id },
        impacts: [{ k: 'chi', c: 'CU', v: 0.32 }, { k: 'iv', c: 'CU', v: 0.7 }, { k: 'halt', c: 'CU', days: randInt(s.rng, 3, 5) }, { k: 'companyHit', id: victim.id, navPct: -0.45, rep: -20 }, { k: 'regime' }],
        followUps: [{ inDays: 6, impacts: [], news: { headline: 'Le LMM rouvre le cuivre après la suspension', body: 'Les ordres accumulés se déversent : écarts violents à l’ouverture.', commodity: 'CU', tone: 'neutral', major: false, category: 'marché' } }],
      };
    },
  },
  {
    key: 'warehouse', weight: 0.0006, cooldown: 500,
    build: (s) => {
      const t = aliveAi(s, (id) => COMPANY_BY_ID[id]!.desks.CU !== undefined);
      const hit = t.length ? pick(s.rng, t) : null;
      return {
        news: { headline: 'Fraude au double nantissement dans les entrepôts de métaux de Shanghai', body: 'Les mêmes lots de cuivre ont servi de garantie à plusieurs banques. Des stocks entiers n’existent pas. Les banques coupent le financement sur métaux en Chine.', commodity: 'CU', tone: 'alert', major: true, category: 'entreprises', cityId: 'shanghai' },
        impacts: [{ k: 'warehouseFraud', loc: 'CU_SHA', lossPct: 0.3 }, { k: 'basis', loc: 'CU_SHA', v: -35 }, { k: 'kyc', city: 'shanghai', v: 0.1 }, ...(hit ? [{ k: 'companyHit' as const, id: hit.id, navPct: -0.12, rep: -12 }] : [])],
        followUps: [{ inDays: 60, impacts: [{ k: 'basis', loc: 'CU_SHA', v: 35 }] }],
      };
    },
  },
  {
    key: 'collapse', weight: 0.0005, cooldown: 300,
    build: (s) => {
      const cands = aliveAi(s, (id) => ['trader', 'fund'].includes(COMPANY_BY_ID[id]!.kind)).sort((a, b) => a.nav / a.initialNav - b.nav / b.initialNav);
      const opaque = cands.filter((c) => COMPANY_BY_ID[c.id]!.temperament === 'opaque');
      const v = opaque[0] ?? cands[0];
      if (!v) return null;
      const n = COMPANY_BY_ID[v.id]!.name;
      return {
        news: { headline: `${n} cachait des pertes colossales : faillite`, body: `Le fondateur reconnaît avoir dissimulé des années de pertes sur dérivés. Les banques découvrent que les stocks gagés étaient vendus deux fois. Tous ses contrats sont résiliés.`, tone: 'alert', major: true, category: 'entreprises', companyId: v.id },
        impacts: [{ k: 'companyDefault', id: v.id }],
      };
    },
  },
  {
    key: 'probe', weight: 0.0015, cooldown: 60,
    build: (s) => {
      const c = aliveAi(s, (id) => ['opaque', 'agressif'].includes(COMPANY_BY_ID[id]!.temperament));
      if (!c.length) return null;
      const v = pick(s.rng, c);
      const d = COMPANY_BY_ID[v.id]!;
      return {
        news: { headline: `Enquête pour corruption visant ${d.name}`, body: `Des paiements à des intermédiaires dans des pays producteurs sont examinés par le parquet. ${d.star ? `${d.star} serait entendu.` : ''} Les régulateurs promettent de durcir les contrôles.`, tone: 'alert', major: false, category: 'entreprises', companyId: v.id, cityId: d.cityId },
        impacts: [{ k: 'companyHit', id: v.id, navPct: -0.04, rep: -15 }, { k: 'kyc', city: d.cityId, v: 0.05 }],
      };
    },
  },
  {
    key: 'canal', weight: 0.0009, cooldown: 250,
    build: (s) => {
      const days = randInt(s.rng, 6, 10);
      return {
        news: { headline: 'Un porte-conteneurs géant bloque le canal entre la Méditerranée et la mer Rouge', body: 'Des centaines de navires attendent. Les cargaisons vers l’Europe et l’Asie sont retardées ; les primes physiques s’envolent.', tone: 'up', major: true, category: 'logistique' },
        impacts: [
          { k: 'effect', effect: { label: 'Canal bloqué', icon: '🚢', lat: 30.5, lon: 32.35, untilDay: addBusinessDays(s.day, days), layer: 'logistique', closes: ['suez'], basisShift: { BRENT_RTM: 0.8, BRENT_SIN: 0.5, CU_RTM: 45, WHT_DXB: 18, COAL_ARA: 2.5 } } },
          { k: 'chi', c: 'BRENT', v: 0.015 }, { k: 'freight', idx: 'AFRA', v: 0.25 }, { k: 'freight', idx: 'CAPE', v: 0.15 },
        ],
        followUps: [{ inDays: days + 1, impacts: [], news: { headline: 'Le canal est rouvert à la navigation', body: 'Le porte-conteneurs a été déséchoué ; les files d’attente se résorbent.', tone: 'down', major: false, category: 'logistique' } }],
      };
    },
  },
  {
    key: 'sanctions', weight: 0.0008, cooldown: 300, geo: true,
    when: (s) => !s.world.sanctions.some((x) => x.zone === 'SARM'),
    build: () => ({
      news: { headline: 'Sanctions massives de l’Occident contre la Sarmatie', body: 'Gel des avoirs, interdiction d’acheter son pétrole, son gaz et son charbon pour les sociétés occidentales. Les contrats en cours avec des entités sarmates deviennent inexécutables.', tone: 'up', major: true, category: 'géopolitique', zone: 'SARM' },
      impacts: [
        { k: 'tension', v: 18 }, { k: 'stability', zone: 'SARM', v: -10 },
        { k: 'sanction', zone: 'SARM', by: 'west', kind: 'full' },
        { k: 'xi', c: 'BRENT', v: 0.05 }, { k: 'chi', c: 'TTF', v: 0.3 }, { k: 'xi', c: 'TTF', v: 0.08 }, { k: 'chi', c: 'API2', v: 0.1 }, { k: 'chi', c: 'WHEAT', v: 0.06 },
        { k: 'iv', c: 'TTF', v: 0.5 }, { k: 'iv', c: 'BRENT', v: 0.2 }, { k: 'regime' },
      ],
    }),
  },
  {
    key: 'pricecap', weight: 0.004, cooldown: 400,
    when: (s) => s.world.sanctions.some((x) => x.zone === 'SARM' && x.kind === 'full') && !s.world.sanctions.some((x) => x.kind === 'pricecap'),
    build: () => ({
      news: { headline: 'Plafond de prix sur le brut sarmate', body: 'Les sociétés occidentales peuvent à nouveau transporter et acheter du brut sarmate… à condition de le payer au moins 25 % sous le Brent. Les barils sarmates se négocient avec une décote massive.', commodity: 'BRENT', tone: 'down', major: false, category: 'géopolitique', zone: 'SARM' },
      impacts: [{ k: 'sanction', zone: 'SARM', by: 'west', kind: 'pricecap', c: 'BRENT', capPct: 0.25 }, { k: 'xi', c: 'BRENT', v: -0.02 }],
    }),
  },
  {
    key: 'lift', weight: 0.0005, cooldown: 300,
    when: (s) => s.world.sanctions.length > 0 && s.world.blocTension < 40,
    build: () => ({
      news: { headline: 'Accord de détente : les sanctions contre la Sarmatie sont levées', body: 'Le pétrole et le gaz sarmates reviennent sur le marché.', tone: 'down', major: true, category: 'géopolitique', zone: 'SARM' },
      impacts: [{ k: 'liftSanction', zone: 'SARM' }, { k: 'tension', v: -15 }, { k: 'xi', c: 'BRENT', v: -0.04 }, { k: 'xi', c: 'TTF', v: -0.08 }],
    }),
  },
  {
    key: 'exportban', weight: 0.0006, cooldown: 400,
    when: (s) => !s.world.restrictions.some((r) => r.zone === 'INSU' && r.c === 'CU'),
    build: (s) => ({
      news: { headline: 'L’Archipel d’Insulinde interdit l’export de minerai brut', body: 'Le gouvernement veut forcer la transformation sur place. Les fonderies chinoises cherchent d’autres sources de concentrés.', commodity: 'CU', tone: 'up', major: false, category: 'géopolitique', zone: 'INSU' },
      impacts: [{ k: 'restriction', kind: 'exportBan', zone: 'INSU', c: 'CU', days: randInt(s.rng, 120, 250) }, { k: 'xi', c: 'CU', v: 0.03 }, { k: 'basis', loc: 'CU_SHA', v: 30 }],
      followUps: [{ inDays: 180, impacts: [{ k: 'basis', loc: 'CU_SHA', v: -30 }] }],
    }),
  },
  {
    key: 'embargo', weight: 0.0006, cooldown: 500, geo: true,
    build: (s) => {
      const days = randInt(s.rng, 60, 150);
      return {
        news: { headline: 'La Chine suspend ses importations de charbon de l’Archipel d’Insulinde', body: 'Différend diplomatique : les cargaisons insulindiennes doivent trouver d’autres acheteurs, les prix rendus en Chine grimpent.', commodity: 'API2', tone: 'up', major: false, category: 'géopolitique', zone: 'INSU' },
        impacts: [
          { k: 'restriction', kind: 'embargo', zone: 'INSU', importer: 'CN', c: 'API2', days },
          { k: 'effect', effect: { label: 'Embargo charbon', icon: '⛔', lat: 10, lon: 112, untilDay: addBusinessDays(s.day, days), layer: 'géopolitique', basisShift: { COAL_CN: 9, COAL_RB: 2 } } },
          { k: 'tension', v: 5 },
        ],
      };
    },
  },
  {
    key: 'coup', weight: 0.001, cooldown: 300,
    when: (s) => s.world.zones.KASS!.stability < 45,
    build: (s) => ({
      news: { headline: 'Coup d’État dans la République du Kassaï', body: 'La junte suspend les exportations de cuivre et menace de renationaliser les mines. Les contreparties kassaïennes deviennent imprévisibles.', commodity: 'CU', tone: 'up', major: true, category: 'géopolitique', zone: 'KASS' },
      impacts: [{ k: 'stability', zone: 'KASS', v: -30 }, { k: 'xi', c: 'CU', v: 0.04 }, { k: 'chi', c: 'CU', v: 0.05 }, { k: 'iv', c: 'CU', v: 0.35 }, { k: 'restriction', kind: 'exportBan', zone: 'KASS', c: 'CU', days: randInt(s.rng, 40, 90) }, { k: 'effect', effect: { label: 'Coup d’État', icon: '🪖', lat: -7, lon: 25, untilDay: addBusinessDays(s.day, 60), layer: 'géopolitique' } }],
    }),
  },
  {
    key: 'incident', weight: 0.004, cooldown: 20, geo: true,
    build: (s) => {
      const up = chance(s.rng, 0.6);
      return up
        ? { news: { headline: 'Incident naval entre l’Occident et la Sarmatie', body: 'Les chancelleries haussent le ton ; les options énergétiques se renchérissent.', tone: 'alert', major: false, category: 'géopolitique', zone: 'SARM' }, impacts: [{ k: 'tension', v: randInt(s.rng, 7, 14) }, { k: 'iv', c: 'TTF', v: 0.08 }, { k: 'iv', c: 'BRENT', v: 0.05 }, { k: 'chi', c: 'TTF', v: 0.04 }] }
        : { news: { headline: 'Sommet diplomatique : signes de détente entre les blocs', body: 'Les marchés respirent.', tone: 'down', major: false, category: 'géopolitique' }, impacts: [{ k: 'tension', v: -randInt(s.rng, 6, 12) }, { k: 'iv', c: 'TTF', v: -0.05 }] };
    },
  },
  // ------------------------------------------------ fret et routes maritimes
  {
    key: 'redsea', weight: 0.0007, cooldown: 300, geo: true,
    build: (s) => {
      const days = randInt(s.rng, 20, 45);
      return {
        news: { headline: 'Attaques de navires en mer Rouge : les armateurs évitent Bab-el-Mandeb', body: 'Les navires contournent l’Afrique par le cap de Bonne-Espérance : deux semaines de plus, assurances « risque de guerre » en flèche.', tone: 'up', major: true, category: 'logistique' },
        impacts: [
          { k: 'effect', effect: { label: 'Mer Rouge fermée', icon: '⚠️', lat: 13.5, lon: 42.5, untilDay: addBusinessDays(s.day, days), layer: 'logistique', closes: ['bab'], basisShift: { BRENT_RTM: 0.6, WHT_DXB: 10, CU_RTM: 25 } } },
          { k: 'freight', idx: 'AFRA', v: 0.3 }, { k: 'freight', idx: 'CAPE', v: 0.2 }, { k: 'freight', idx: 'PMX', v: 0.15 }, { k: 'tension', v: 6 },
        ],
      };
    },
  },
  {
    key: 'panama', weight: 0.0008, cooldown: 300,
    build: (s) => ({
      news: { headline: 'Sécheresse au canal de Panama : passages limités', body: 'Le niveau des lacs ne permet plus le passage des navires chargés : détour par le cap Horn.', tone: 'up', major: false, category: 'logistique' },
      impacts: [{ k: 'effect', effect: { label: 'Panama restreint', icon: '🏜️', lat: 9.1, lon: -79.7, untilDay: addBusinessDays(s.day, randInt(s.rng, 15, 35)), layer: 'logistique', closes: ['panama'] } }, { k: 'freight', idx: 'PMX', v: 0.12 }],
    }),
  },
  {
    key: 'chinaboom', weight: 0.002, cooldown: 60,
    build: (s) => {
      const up = chance(s.rng, 0.55);
      return up
        ? { news: { headline: 'Importations chinoises de minerai et de charbon au plus haut : les vraquiers s’arrachent', body: 'Le taux d’affrètement des Capesize bondit.', tone: 'up', major: false, category: 'logistique' }, impacts: [{ k: 'freight', idx: 'CAPE', v: 0.35 }, { k: 'freight', idx: 'PMX', v: 0.15 }] }
        : { news: { headline: 'Flotte de vraquiers en surcapacité : les taux s’effondrent', body: 'Livraisons record de navires neufs, demande atone.', tone: 'down', major: false, category: 'logistique' }, impacts: [{ k: 'freight', idx: 'CAPE', v: -0.3 }, { k: 'freight', idx: 'PMX', v: -0.2 }, { k: 'freight', idx: 'SMX', v: -0.15 }] };
    },
  },
  {
    key: 'tankers', weight: 0.0015, cooldown: 60,
    when: (s) => s.world.sanctions.length > 0 || s.world.blocTension > 55,
    build: () => ({ news: { headline: 'Flotte « fantôme » et sanctions : les pétroliers conformes se raréfient', body: 'Les routes s’allongent, les taux des Aframax s’envolent.', tone: 'up', major: false, category: 'logistique' }, impacts: [{ k: 'freight', idx: 'AFRA', v: 0.35 }] }),
  },
  // ------------------------------------------------ météo
  {
    key: 'enso', weight: 0.0015, cooldown: 250,
    when: (s) => Math.abs(s.world.enso) < 1,
    build: (s) => {
      const nino = chance(s.rng, 0.55);
      return {
        news: { headline: nino ? 'Les météorologues déclarent un épisode El Niño' : 'Retour de La Niña dans le Pacifique', body: nino ? 'Sécheresse attendue en Océanie et en Asie du Sud, hiver doux en Amérique du Nord. Récoltes de blé et demande de charbon sous surveillance.' : 'Pluies abondantes en Asie, sécheresse en Amérique du Sud.', tone: nino ? 'up' : 'neutral', major: false, category: 'météo' },
        impacts: [{ k: 'enso', v: nino ? 1.6 : -1.5 }, { k: 'effect', effect: { label: nino ? 'El Niño' : 'La Niña', icon: nino ? '🔥' : '💧', lat: -5, lon: -120, untilDay: addBusinessDays(s.day, 180), layer: 'météo' } }],
      };
    },
  },
  {
    key: 'hurricane', weight: 0.012, cooldown: 25, months: [6, 7, 8, 9, 10, 11],
    build: (s) => {
      const name = pick(s.rng, HURRICANES);
      const m = ymd(s.day).m;
      const strength = m >= 8 && m <= 10 ? 1.3 : 0.8;
      const days = randInt(s.rng, 5, 10);
      const impacts: Impact[] = [
        { k: 'chi', c: 'BRENT', v: 0.025 * strength }, { k: 'chi', c: 'TTF', v: 0.08 * strength }, { k: 'iv', c: 'BRENT', v: 0.1 },
        { k: 'effect', effect: { label: `Ouragan ${name}`, icon: '🌀', lat: 27.5, lon: -91, untilDay: addBusinessDays(s.day, days + 3), layer: 'météo', basisShift: { BRENT_USGC: -1.2 * strength, WHT_GULF: 18 * strength } } },
      ];
      const news: NewsSpec = { headline: `L’ouragan ${name} touche les côtes du Golfe du Mexique`, body: 'Plateformes évacuées, raffineries et terminaux d’export à l’arrêt. Le brut s’accumule localement, les exportations de GNL et de grains sont suspendues.', tone: 'up', major: strength > 1, category: 'météo', cityId: 'houston' };
      return {
        news: { ...news, headline: `la tempête ${name} se renforce et menace le Golfe du Mexique` },
        impacts,
        rumor: { pReal: 0.55, frac: 0.3, resolveIn: randInt(s.rng, 2, 3), confirm: news, deny: { headline: `La tempête ${name} dévie vers le large`, body: 'Les installations du Golfe sont épargnées.', tone: 'down', major: false, category: 'météo' } },
      };
    },
  },
  {
    key: 'monsoon', weight: 0.006, cooldown: 120, months: [6, 7, 8],
    build: (s) => {
      const weak = chance(s.rng, 0.5);
      return { news: { headline: weak ? 'Mousson défaillante en Asie du Sud' : 'Mousson abondante en Asie du Sud', body: weak ? 'Barrages vides : les centrales au charbon tournent à plein, la demande d’importation explose.' : 'Hydroélectricité abondante : moins de charbon importé.', commodity: 'API2', tone: weak ? 'up' : 'down', major: false, category: 'météo' }, impacts: [{ k: 'chi', c: 'API2', v: weak ? 0.06 : -0.04 }, { k: 'chi', c: 'WHEAT', v: weak ? 0.02 : -0.01 }] };
    },
  },
  {
    key: 'heat', weight: 0.006, cooldown: 30, months: [6, 7, 8],
    build: () => ({ news: { headline: 'Canicule sur l’Europe', body: 'Climatisation à plein régime, rivières trop chaudes pour refroidir les centrales : gaz et charbon sollicités.', commodity: 'TTF', tone: 'up', major: false, category: 'météo' }, impacts: [{ k: 'chi', c: 'TTF', v: 0.08 }, { k: 'chi', c: 'API2', v: 0.04 }] }),
  },
  {
    key: 'refinery', weight: 0.0015, cooldown: 120,
    build: (s) => ({
      news: { headline: 'Explosion dans une grande raffinerie de Houston', body: 'L’unité de distillation est détruite : moins de brut traité localement, le différentiel du Golfe s’effondre.', commodity: 'BRENT', tone: 'alert', major: false, category: 'marché', cityId: 'houston' },
      impacts: [{ k: 'effect', effect: { label: 'Raffinerie en feu', icon: '💥', lat: 29.7, lon: -95.0, untilDay: addBusinessDays(s.day, 15), layer: 'marché', basisShift: { BRENT_USGC: -1.5 } } }, { k: 'chi', c: 'BRENT', v: 0.008 }],
    }),
  },
  // ------------------------------------------------ régulation, politique intérieure
  {
    key: 'regulation', weight: 0.002, cooldown: 40,
    build: (s) => {
      const city = pick(s.rng, CITIES);
      const r = uniform(s.rng);
      if (r < 0.45) return { news: { headline: `Le régulateur de ${city.name} durcit les contrôles KYC/AML des négociants`, body: 'Vérification renforcée des contreparties à risque : les délais d’onboarding s’allongent.', tone: 'neutral', major: false, category: 'réglementation', cityId: city.id }, impacts: [{ k: 'kyc', city: city.id, v: 0.1 }] };
      if (r < 0.8) return { news: { headline: `${city.name} étend la déclaration obligatoire des dérivés`, body: 'Chaque transaction devra être déclarée à un référentiel central : coût de conformité en hausse.', tone: 'neutral', major: false, category: 'réglementation', cityId: city.id }, impacts: [{ k: 'reporting', city: city.id, v: 15 }] };
      return { news: { headline: `${city.name} assouplit les règles d’entrée en relation`, body: 'Moins de paperasse, plus de risque de contrepartie.', tone: 'neutral', major: false, category: 'réglementation', cityId: city.id }, impacts: [{ k: 'kyc', city: city.id, v: -0.08 }] };
    },
  },
  {
    key: 'capfreeze', weight: 0.004, cooldown: 120,
    when: (s) => s.world.cityRegs[s.company.hqCity]!.capitalControls,
    build: (s) => ({
      news: { headline: `Contrôle des capitaux renforcé à ${CITY_BY_ID[s.company.hqCity]!.name} : rapatriements bloqués`, body: 'Une partie de votre trésorerie est immobilisée pendant deux semaines.', tone: 'alert', major: true, category: 'réglementation', cityId: s.company.hqCity },
      impacts: [{ k: 'freezeCash', pct: 0.2, days: 10 }],
    }),
  },
  {
    key: 'capctl', weight: 0.0008, cooldown: 400,
    build: (s) => {
      const city = pick(s.rng, CITIES.filter((c) => (s.world.zones[CITY_ZONE[c.id]!]?.stability ?? 100) < 70));
      if (!city) return null;
      const on = !s.world.cityRegs[city.id]!.capitalControls;
      return { news: { headline: on ? `${city.name} instaure un contrôle des capitaux` : `${city.name} lève son contrôle des capitaux`, body: on ? 'Les sorties de devises sont plafonnées pour défendre la monnaie.' : 'Retour à la libre circulation des capitaux.', tone: on ? 'alert' : 'neutral', major: false, category: 'réglementation', cityId: city.id }, impacts: [{ k: 'capctl', city: city.id, on }] };
    },
  },
  // ------------------------------------------------ narratifs macro (primes de risque)
  {
    key: 'narrative', weight: 0.0018, cooldown: 120,
    when: (s) => s.world.narratives.length < 2,
    build: (s) => {
      const opts = [
        { id: 'supercycle', name: 'Super-cycle des matières premières', drift: { BRENT: 0.12, CU: 0.18, API2: 0.1, WHEAT: 0.06 }, h: 'Le FMI relève fortement ses prévisions de croissance : les économistes parlent de super-cycle', b: 'Investissement massif dans les infrastructures émergentes.' },
        { id: 'recession', name: 'Récession mondiale', drift: { BRENT: -0.15, CU: -0.2, API2: -0.12, TTF: -0.08 }, h: 'Les indicateurs avancés plongent : le spectre d’une récession mondiale', b: 'Commandes industrielles en chute, crédit plus rare.' },
        { id: 'transition', name: 'Accélération de la transition énergétique', drift: { CU: 0.15, API2: -0.18, TTF: 0.04 }, h: 'Plans massifs pour l’électrification : le cuivre roi, le charbon condamné', b: 'Les grandes économies avancent leurs objectifs climatiques.' },
        { id: 'oilglut', name: 'Surabondance pétrolière', drift: { BRENT: -0.2 }, h: 'Production record hors cartel : l’offre de pétrole déborde', b: 'Les nouveaux champs offshore arrivent tous en même temps.' },
      ].filter((o) => !s.world.narratives.some((n) => n.id === o.id));
      if (!opts.length) return null;
      const o = pick(s.rng, opts);
      return { news: { headline: o.h, body: o.b, tone: 'neutral', major: false, category: 'macro' }, impacts: [{ k: 'narrative', id: o.id, name: o.name, drift: o.drift as Partial<Record<CommodityId, number>>, days: randInt(s.rng, 120, 260) }] };
    },
  },
];

/** Réunions programmées : cartel des producteurs, banques centrales, élections. */
function calendarEvents(state: GameState) {
  const w = state.world;
  const cal = w.calendar;
  const rng = state.rng;
  const d = state.day;
  // Fuite 3 jours avant la réunion du cartel
  if (addBusinessDays(d, 3) === cal.opec) {
    const leakCut = chance(rng, 0.5);
    pushNews(state, { headline: `Rumeur : selon des délégués, le cartel envisagerait une ${leakCut ? 'baisse' : 'hausse'} de production`, body: 'Réunion dans trois jours. Les fuites sont fréquentes… et parfois trompeuses.', commodity: 'BRENT', tone: leakCut ? 'up' : 'down', major: false, category: 'macro', stage: 'rumor' });
    applyImpact(state, { k: 'xi', c: 'BRENT', v: leakCut ? 0.012 : -0.012 });
  }
  if (d >= cal.opec) {
    const brent = futuresPrice(state.market, 'BRENT', listedMonths(COMMODITIES.BRENT, d)[0]!);
    const low = brent < COMMODITIES.BRENT.model.s0 * 0.9;
    const r = uniform(rng);
    const decision = r < (low ? 0.55 : 0.25) ? 'cut' : r < 0.8 ? 'hold' : 'raise';
    const v = decision === 'cut' ? 0.05 + 0.03 * uniform(rng) : decision === 'raise' ? -(0.04 + 0.03 * uniform(rng)) : 0.01 * normal(rng);
    applyImpact(state, { k: 'xi', c: 'BRENT', v });
    applyImpact(state, { k: 'iv', c: 'BRENT', v: 0.05 });
    pushNews(state, { headline: decision === 'cut' ? 'Le cartel des producteurs annonce une baisse de production' : decision === 'raise' ? 'Surprise : le cartel augmente ses quotas' : 'Le cartel maintient ses quotas inchangés', body: 'Réunion ministérielle des pays producteurs.', commodity: 'BRENT', tone: v > 0.005 ? 'up' : v < -0.005 ? 'down' : 'neutral', major: Math.abs(v) > 0.05, category: 'macro', zone: 'GULF', impacts: Math.abs(v) > 0.005 ? [{ c: 'BRENT', dir: v > 0 ? 1 : -1 }] : [] });
    cal.opec = addBusinessDays(d, randInt(rng, 35, 45));
  }
  for (const [cb, ccy] of [['fomc', 'USD'], ['ecb', 'EUR']] as const) {
    if (d < cal[cb]) continue;
    const narr = new Set(w.narratives.map((n) => n.id));
    const pHike = narr.has('supercycle') ? 0.45 : narr.has('recession') ? 0.05 : 0.2;
    const pCut = narr.has('recession') ? 0.55 : narr.has('supercycle') ? 0.05 : 0.2;
    const r = uniform(rng);
    const dv = r < pHike ? 0.0025 : r < pHike + pCut && state.market.rates[ccy] > 0.003 ? -0.0025 : 0;
    applyImpact(state, { k: 'rate', ccy, v: dv });
    if (dv !== 0) {
      // Dollar plus fort quand la Fed monte (EURUSD ↓) ; euro plus fort quand la BCE monte.
      state.market.fxLog += (ccy === 'USD' ? -1 : 1) * Math.sign(dv) * 0.006;
      if (ccy === 'USD') for (const c of COMMODITY_IDS) applyImpact(state, { k: 'xi', c, v: -Math.sign(dv) * 0.008 });
    }
    const name = ccy === 'USD' ? 'La Réserve fédérale' : 'La Banque centrale européenne';
    pushNews(state, { headline: dv > 0 ? `${name} relève ses taux de 25 pb (${(state.market.rates[ccy] * 100).toFixed(2)} %)` : dv < 0 ? `${name} baisse ses taux de 25 pb (${(state.market.rates[ccy] * 100).toFixed(2)} %)` : `${name} laisse ses taux inchangés`, body: 'Le coût du portage, de la RCF et l’actualisation de toutes vos positions bougent avec les taux.', tone: 'neutral', major: false, category: 'macro' });
    cal[cb] = addBusinessDays(d, randInt(rng, 28, 36));
  }
  for (const [zone, day] of Object.entries(cal.elections)) {
    if (d < day) continue;
    const z = ZONE_BY_ID[zone]!;
    const cities = CITIES.filter((c) => CITY_ZONE[c.id] === zone);
    const right = chance(rng, 0.5);
    const dTax = (right ? -1 : 1) * (0.01 + 0.03 * uniform(rng));
    const imps: Impact[] = cities.flatMap((c) => [{ k: 'tax' as const, city: c.id, v: dTax }, { k: 'kyc' as const, city: c.id, v: right ? -0.05 : 0.05 }]);
    imps.push({ k: 'stability', zone, v: right ? -3 : 2 });
    for (const im of imps) applyImpact(state, im);
    const hq = cities.some((c) => c.id === state.company.hqCity);
    pushNews(state, { headline: `Élections en ${z.name} : le nouveau gouvernement ${dTax < 0 ? 'baisse' : 'relève'} l’impôt sur les sociétés de ${(Math.abs(dTax) * 100).toFixed(1)} pt`, body: right ? 'Programme pro-business : fiscalité allégée, contrôles assouplis.' : 'Programme de justice fiscale : impôt et conformité renforcés.', tone: 'neutral', major: hq, category: 'réglementation', zone });
    cal.elections[zone] = addBusinessDays(d, randInt(rng, 900, 1100));
  }
}

/** Événements du jour (appelé à l'ouverture, après le mouvement de marché). */
export function dailyEvents(state: GameState) {
  stepCalendar(state);
  const m = ymd(state.day).m;
  const stress = state.market.volRegime === 'stressed' ? 1.5 : 1;
  const geo = (state.world.blocTension / 50) ** 2;
  let fired = 0;
  for (const t of TEMPLATES) {
    if (fired >= 2) break;
    if ((state.world.eventCooldown[t.key] ?? -1) > state.day) continue;
    if (t.months && !t.months.includes(m)) continue;
    if (t.when && !t.when(state)) continue;
    const p = t.weight * state.config.crisisFrequency * stress * (t.geo ? geo : 1);
    if (!chance(state.rng, p)) continue;
    const f = t.build(state);
    if (!f) continue;
    fire(state, f);
    state.world.eventCooldown[t.key] = addBusinessDays(state.day, t.cooldown);
    fired++;
  }
}

function stepCalendar(state: GameState) {
  calendarEvents(state);
}

export function sanctionedDiscount(state: GameState, cpId: string, c: CommodityId): number {
  const s = sanctionFor(state, cpId, c);
  if (s?.kind === 'pricecap') return (s.capPct ?? 0.25) * spotPrice(state.market, c) + COMMODITIES[c].tick * 10;
  return 0;
}

export const EVENT_KEYS = TEMPLATES.map((t) => t.key);
export function _templateForTests(key: string) {
  return TEMPLATES.find((t) => t.key === key)!;
}
