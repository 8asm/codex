/**
 * Catalogue des chocs de fondamentaux (tirés par events.ts) et publications programmées
 * (stocks pétroliers du mercredi, rapport agricole mensuel, météo gaz en hiver).
 * Un choc sur χ est TEMPORAIRE (panne, météo : il se résorbe au rythme κ et déforme le front de courbe) ;
 * un choc sur ξ est STRUCTUREL (il déplace toute la courbe durablement).
 */
import { COMMODITIES } from '../data/commodities';
import { weekday, ymd } from './calendar';
import { newId } from './ledger';
import { normal } from './rng';
import type { CommodityId, GameState, NewsItem } from './types';

interface ShockTemplate {
  c: CommodityId;
  dir: 1 | -1;
  factor: 'chi' | 'xi';
  size: number; // amplitude typique (log)
  headline: string;
  body: string;
}

export const SHOCKS: ShockTemplate[] = [
  { c: 'BRENT', dir: 1, factor: 'chi', size: 0.06, headline: 'Panne majeure sur un oléoduc de mer du Nord', body: 'Plusieurs champs à l’arrêt : le Dated se tend, le front de courbe s’envole.' },
  { c: 'BRENT', dir: 1, factor: 'xi', size: 0.05, headline: 'Le cartel des producteurs prolonge ses coupes', body: 'Réduction d’offre durable : toute la courbe se réévalue.' },
  { c: 'BRENT', dir: -1, factor: 'xi', size: 0.06, headline: 'Surprise : hausse des quotas de production', body: 'Plus de barils sur le marché pour longtemps.' },
  { c: 'BRENT', dir: -1, factor: 'chi', size: 0.05, headline: 'Afflux de cargaisons invendues en Atlantique', body: 'Les bateaux attendent preneur : le spot se détend, contango à l’avant.' },
  { c: 'TTF', dir: 1, factor: 'chi', size: 0.14, headline: 'Arrêt imprévu d’une usine de liquéfaction en Norvège', body: 'Moins de gaz livré en Europe dans les prochaines semaines.' },
  { c: 'TTF', dir: 1, factor: 'chi', size: 0.12, headline: 'Vague de froid annoncée sur l’Europe du Nord', body: 'Les soutirages de stockage s’accélèrent.' },
  { c: 'TTF', dir: -1, factor: 'chi', size: 0.12, headline: 'Arrivées record de méthaniers en Europe', body: 'Les terminaux de regazéification tournent à plein.' },
  { c: 'TTF', dir: -1, factor: 'xi', size: 0.08, headline: 'Accord gazier de long terme signé avec un grand exportateur', body: 'Sécurité d’approvisionnement accrue pour plusieurs années.' },
  { c: 'CU', dir: 1, factor: 'chi', size: 0.05, headline: 'Grève dans une mine géante au Chili', body: 'Le syndicat bloque l’accès au site ; des cargaisons de cathodes sont retardées.' },
  { c: 'CU', dir: 1, factor: 'xi', size: 0.04, headline: 'Plan de relance massif dans les réseaux électriques asiatiques', body: 'La demande structurelle de cuivre est révisée en hausse.' },
  { c: 'CU', dir: -1, factor: 'xi', size: 0.045, headline: 'Indicateurs industriels chinois très décevants', body: 'Le marché redoute un ralentissement de la demande.' },
  { c: 'CU', dir: -1, factor: 'chi', size: 0.035, headline: 'Gonflement des stocks en entrepôts de la bourse', body: 'Le spread cash-3 mois glisse en contango.' },
  { c: 'WHEAT', dir: 1, factor: 'chi', size: 0.07, headline: 'Sécheresse sur la mer Noire', body: 'Les estimations de récolte sont coupées.' },
  { c: 'WHEAT', dir: 1, factor: 'xi', size: 0.05, headline: 'Un grand exportateur instaure des quotas d’exportation', body: 'Le commerce mondial de blé se réorganise.' },
  { c: 'WHEAT', dir: -1, factor: 'chi', size: 0.06, headline: 'Récolte record attendue dans les Plaines', body: 'Les silos se remplissent, la base faiblit.' },
  { c: 'API2', dir: 1, factor: 'chi', size: 0.09, headline: 'Inondations sur les mines australiennes', body: 'L’offre maritime de charbon se contracte : l’Atlantique suit.' },
  { c: 'API2', dir: 1, factor: 'chi', size: 0.08, headline: 'Panne de la ligne ferroviaire vers Richards Bay', body: 'Exportations sud-africaines perturbées pour plusieurs semaines.' },
  { c: 'API2', dir: -1, factor: 'xi', size: 0.07, headline: 'Accélération des fermetures de centrales à charbon en Europe', body: 'La demande de long terme recule.' },
];

function push(state: GameState, item: Omit<NewsItem, 'id' | 'day'>): NewsItem {
  const n: NewsItem = { id: newId(state, 'n'), day: state.day, ...item };
  state.news.unshift(n);
  if (state.news.length > 120) state.news.pop();
  return n;
}

export function addNews(state: GameState, item: Omit<NewsItem, 'id' | 'day'>) {
  return push(state, item);
}

/** Tire les chocs du jour et les publications programmées. Appelé à l'ouverture, après le mouvement de marché. */
export function dailyNews(state: GameState): NewsItem[] {
  const out: NewsItem[] = [];
  const m = state.market;
  // Les chocs aléatoires sont gérés par le moteur d'événements (events.ts) ; ici, les publications programmées.
  const wd = weekday(state.day);
  const { m: month, d } = ymd(state.day);
  // Mercredi : statistiques hebdomadaires des stocks pétroliers américains.
  if (wd === 3) {
    const z = normal(state.rng);
    m.commodities.BRENT.chi += -0.012 * z;
    const mb = (z * 3.5).toFixed(1);
    out.push(push(state, {
      headline: z > 0 ? `Stocks pétroliers US : hausse de ${mb} Mb` : `Stocks pétroliers US : tirage de ${(-z * 3.5).toFixed(1)} Mb`,
      body: 'Publication hebdomadaire du mercredi. Un tirage (baisse des stocks) soutient le front de courbe.',
      commodity: 'BRENT', tone: z > 0 ? 'down' : 'up', major: false,
    }));
  }
  // Rapport mensuel offre/demande agricole, autour du 10-12.
  if (d >= 10 && d <= 12 && !state.news.some((n) => n.commodity === 'WHEAT' && n.headline.startsWith('Rapport mensuel') && state.day - n.day < 10)) {
    const z = normal(state.rng);
    m.commodities.WHEAT.chi += 0.025 * z;
    out.push(push(state, {
      headline: `Rapport mensuel offre/demande : stocks de blé ${z > 0 ? 'révisés en baisse' : 'révisés en hausse'}`,
      body: 'Le rapport mensuel du ministère de l’agriculture américain fait bouger toute la filière.',
      commodity: 'WHEAT', tone: z > 0 ? 'up' : 'down', major: Math.abs(z) > 1.8,
    }));
  }
  // Lundi en hiver : prévisions météo à 15 jours pour le gaz.
  if (wd === 1 && (month >= 11 || month <= 3)) {
    const z = normal(state.rng);
    m.commodities.TTF.chi += 0.04 * z;
    out.push(push(state, {
      headline: z > 0 ? 'Météo : modèles plus froids que la normale' : 'Météo : douceur persistante sur l’Europe',
      body: 'Les prévisions à deux semaines pilotent la demande de chauffage.',
      commodity: 'TTF', tone: z > 0 ? 'up' : 'down', major: false,
    }));
  }
  return out;
}

export function commodityShort(c: CommodityId) {
  return COMMODITIES[c].short;
}
