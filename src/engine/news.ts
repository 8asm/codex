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

/**
 * Phase 8 : chocs des nouveaux marchés (un haussier, un baissier par commodité, temporaires sur χ),
 * et un choc structurel (ξ) pour les marchés pilotés par la politique ou la technologie.
 */
const MORE: [CommodityId, number, string, string, number, string, string][] = [
  ['WTI', 0.06, 'Cushing se vide : les cuves au plus bas depuis des années', 'Le front du WTI se tend.', 0.06, 'Production record dans le Permien', 'Le WTI décroche face au Brent.'],
  ['DUBAI', 0.05, 'Le cartel réduit ses livraisons de brut soufré vers l’Asie', 'Les raffineurs asiatiques se disputent les cargaisons.', 0.05, 'Afflux de brut soufré sanctionné vers l’Asie', 'Le Dubaï se détend.'],
  ['GASOIL', 0.07, 'Grèves dans les raffineries européennes', 'Les stocks de diesel fondent à Amsterdam-Rotterdam-Anvers.', 0.06, 'Arrivées massives de diesel d’Asie et du Golfe', 'Le crack gazole s’effondre.'],
  ['GASOLINE', 0.07, 'Panne d’une grande unité de craquage aux États-Unis', 'Les exportations d’essence européenne vers New York bondissent.', 0.06, 'Demande d’essence décevante en début d’été', 'Le crack essence recule.'],
  ['JET', 0.07, 'Trafic aérien record pour les vacances', 'Les aéroports manquent de kérosène.', 0.07, 'Compagnies aériennes en crise : vols annulés', 'Le kérosène décroche.'],
  ['FUELOIL', 0.06, 'Ruée sur les soutes après de nouvelles normes maritimes', 'Le fioul lourd se tend.', 0.06, 'Les centrales du Golfe brûlent moins de fioul', 'Le fond du baril s’alourdit.'],
  ['HH', 0.15, 'Vague de froid polaire sur les États-Unis', 'Puits gelés au Texas, soutirages records.', 0.12, 'Stocks de gaz américains au plus haut', 'Le Henry Hub s’effondre.'],
  ['JKM', 0.12, 'Panne d’une usine de liquéfaction australienne', 'Moins de GNL pour l’Asie pendant des semaines.', 0.1, 'Méthaniers en attente au large de la Chine', 'Le GNL asiatique se détend.'],
  ['POWER', 0.2, 'Plusieurs réacteurs nucléaires à l’arrêt pour corrosion', 'L’Europe importe et brûle du gaz.', 0.18, 'Records de production éolienne et solaire', 'Prix négatifs à certaines heures, le base décroche.'],
  ['EUA', 0.1, 'Fuite d’un projet de durcissement des quotas', 'Les industriels se couvrent.', 0.1, 'Récession industrielle : moins d’émissions', 'Le carbone recule.'],
  ['NEWC', 0.08, 'Inondations sur les mines du Queensland', 'Les exportations australiennes de charbon chutent.', 0.06, 'La Chine relance sa production domestique de charbon', 'Moins d’importations.'],
  ['METCOAL', 0.1, 'Cyclone sur les ports charbonniers australiens', 'Les aciéristes manquent de coke.', 0.08, 'Hauts-fourneaux chinois au ralenti', 'Le charbon à coke recule.'],
  ['AL', 0.05, 'Une province chinoise rationne l’électricité des fonderies', 'L’aluminium se tend.', 0.04, 'Redémarrage de fonderies en Insulinde', 'Plus de métal sur le marché.'],
  ['ZN', 0.06, 'Fermeture d’une grande mine de zinc au Pérou', 'Concentrés rares, fonderies au ralenti.', 0.05, 'Stocks du LMM en forte hausse', 'Le zinc décroche.'],
  ['NI', 0.08, 'Glissement de terrain sur une mine de nickel', 'Le marché, petit, s’emballe.', 0.08, 'Nouvelles fonderies de nickel en Insulinde', 'L’offre déborde.'],
  ['PB', 0.05, 'Fermeture d’une fonderie de plomb européenne', 'Le plomb raffiné se tend.', 0.04, 'Le recyclage des batteries bat son record', 'Le plomb recule.'],
  ['SN', 0.1, 'Interdiction d’exporter l’étain en Insulinde', 'Le cours bondit.', 0.08, 'La demande électronique ralentit', 'L’étain décroche.'],
  ['CO', 0.12, 'Le Kassaï suspend les exportations de cobalt', 'Les fabricants de batteries paniquent.', 0.12, 'Les batteries sans cobalt gagnent du terrain', 'Le cobalt s’effondre.'],
  ['LI', 0.12, 'Ruptures d’approvisionnement en lithium chez les fabricants de batteries', 'Les acheteurs se battent pour les cargaisons.', 0.12, 'Stocks de lithium invendus en Chine', 'Le lithium chute.'],
  ['AU', 0.025, 'Les banques centrales achètent de l’or à un rythme record', 'L’or progresse.', 0.025, 'Hausse surprise des taux réels', 'L’or recule.'],
  ['AG', 0.05, 'Demande solaire record pour l’argent', 'L’argent bondit.', 0.05, 'Liquidation des fonds sur les métaux précieux', 'L’argent décroche.'],
  ['FE', 0.08, 'Cyclone sur le Pilbara : ports fermés', 'Moins de minerai pour la Chine.', 0.08, 'Stocks de minerai records dans les ports chinois', 'Le fer recule.'],
  ['CORN', 0.06, 'Sécheresse sur la Corn Belt en pleine floraison', 'Les rendements de maïs chutent.', 0.05, 'Récolte record de maïs au Brésil', 'Le maïs décroche.'],
  ['SOY', 0.05, 'La Chine accélère ses achats de soja américain', 'Les ventes à l’export explosent.', 0.05, 'Récolte géante de soja en Amérique du Sud', 'Le soja recule.'],
  ['SOYMEAL', 0.06, 'Grève des triturateurs argentins', 'La farine de soja se tend.', 0.05, 'Épidémie de peste porcine en Asie', 'Moins de demande pour l’alimentation animale.'],
  ['SOYOIL', 0.06, 'Hausse des obligations de biodiesel aux États-Unis', 'L’huile de soja grimpe.', 0.05, 'Le prix du gazole baisse, le biodiesel aussi', 'L’huile recule.'],
  ['SUGAR', 0.07, 'Le Brésil oriente sa canne vers l’éthanol', 'Moins de sucre exporté.', 0.07, 'Mousson généreuse en Inde : récolte record de sucre', 'Le sucre recule.'],
  ['COFFEE', 0.07, 'Sécheresse dans les zones caféières du Viêt Nam', 'Le robusta manque, l’arabica suit.', 0.06, 'Floraison exceptionnelle au Brésil', 'Le café décroche.'],
  ['COCOA', 0.08, 'Pluies insuffisantes sur la ceinture cacaoyère', 'La campagne intermédiaire s’annonce maigre.', 0.07, 'Arrivées de fèves meilleures que prévu à San Pedro', 'Le cacao recule.'],
  ['COTTON', 0.05, 'Sécheresse au Texas : les surfaces abandonnées s’envolent', 'Le coton grimpe.', 0.05, 'Commandes textiles en berne', 'Le coton recule.'],
  ['PALM', 0.06, 'Pénurie de main-d’œuvre dans les plantations de palme', 'La production baisse.', 0.06, 'Stocks d’huile de palme au plus haut en Malaisie', 'La palme recule.'],
  ['RICE', 0.05, 'Inondations dans le delta du Mékong', 'Le riz se tend.', 0.04, 'Récolte record en Thaïlande', 'Le riz recule.'],
  ['OJ', 0.08, 'Maladie des agrumes : la récolte brésilienne au plus bas', 'Le jus d’orange s’envole.', 0.07, 'La consommation de jus d’orange poursuit sa chute', 'Le jus recule.'],
];
for (const [c, up, h1, b1, dn, h2, b2] of MORE) {
  SHOCKS.push({ c, dir: 1, factor: 'chi', size: up, headline: h1, body: b1 });
  SHOCKS.push({ c, dir: -1, factor: 'chi', size: dn, headline: h2, body: b2 });
}

function push(state: GameState, item: Omit<NewsItem, 'id' | 'day'>): NewsItem {
  const n: NewsItem = { id: newId(state, 'n'), day: state.day, ...item };
  // une nouvelle sur un marché que la partie ne suit pas reste dans le fil, sans interrompre le joueur
  const list = state.config.commodities;
  if (n.major && n.commodity && list?.length && !list.includes(n.commodity)) n.major = false;
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
