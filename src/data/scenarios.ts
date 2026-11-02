/**
 * Phase 7 — Scénarios historiques remaniés (noms et détails modifiés).
 * Chaque scénario fixe la configuration, une position de départ éventuelle, une chronologie d'événements
 * (décalages en jours ouvrés, impacts du moteur d'événements) et un objectif.
 */
import type { CommodityId, GameConfig, Impact, NewsItem } from '../engine/types';

export interface ScenarioEvent {
  inDays: number;
  impacts: Impact[];
  news?: Omit<NewsItem, 'id' | 'day'>;
}

export interface ScenarioStart {
  inventory?: { commodity: CommodityId; locationId: string; qty: number }[];
  /** futures : lots signés sur la 2ᵉ échéance cotée */
  futures?: { commodity: CommodityId; lots: number }[];
  market?: { chi?: Partial<Record<CommodityId, number>>; iv?: Partial<Record<CommodityId, number>>; stressed?: boolean };
}

export interface ScenarioDef {
  id: string;
  name: string;
  era: string;
  icon: string;
  intro: string;
  lesson: string;
  config: Partial<GameConfig>;
  start: ScenarioStart;
  events: ScenarioEvent[];
  objective: { desc: string; navMultiple: number; requireCarry?: boolean };
}

export const SCENARIOS: ScenarioDef[] = [
  {
    id: 'detroit',
    name: 'La crise du détroit',
    era: 'inspiré de 1990',
    icon: '⛽',
    intro: 'Rotterdam, été. Vous détenez 400 000 barils en cuve, couverts par des ventes de futures : un portage tranquille. Au Golfe, un émirat masse ses troupes à la frontière de son voisin…',
    lesson: 'Une couverture parfaite peut vous tuer par le cash : le stock gagne en valeur, mais les futures vendus appellent de la marge tous les soirs.',
    config: { startYear: 2027, years: 1, capital: 30e6, hqCity: 'geneva', companyName: 'Détroit Négoce SA', crisisFrequency: 0.3 },
    start: { inventory: [{ commodity: 'BRENT', locationId: 'BRENT_RTM', qty: 400_000 }], futures: [{ commodity: 'BRENT', lots: -400 }] },
    events: [
      { inDays: 12, impacts: [{ k: 'chi', c: 'BRENT', v: 0.12 }, { k: 'iv', c: 'BRENT', v: 0.3 }, { k: 'tension', v: 15 }], news: { headline: 'Troupes massées à la frontière d’un émirat du Golfe', body: 'Les chancelleries s’alarment ; les assureurs relèvent les primes de guerre.', commodity: 'BRENT', tone: 'up', major: true, category: 'géopolitique', zone: 'GULF' } },
      { inDays: 18, impacts: [{ k: 'chi', c: 'BRENT', v: 0.35 }, { k: 'iv', c: 'BRENT', v: 0.7 }, { k: 'regime' }, { k: 'stability', zone: 'GULF', v: -40 }, { k: 'sanction', zone: 'GULF', by: 'west', kind: 'full', c: 'BRENT' }], news: { headline: 'Invasion : l’émirat voisin occupé, embargo occidental sur son pétrole', body: 'Des millions de barils par jour disparaissent du marché. Le Brent s’envole.', commodity: 'BRENT', tone: 'up', major: true, category: 'géopolitique', zone: 'GULF' } },
      { inDays: 60, impacts: [{ k: 'chi', c: 'BRENT', v: 0.15 }], news: { headline: 'Ultimatum de la coalition : le pétrole touche un sommet', commodity: 'BRENT', tone: 'up', major: false, category: 'géopolitique' } },
      { inDays: 110, impacts: [{ k: 'chi', c: 'BRENT', v: -0.55 }, { k: 'iv', c: 'BRENT', v: 0.2 }, { k: 'stability', zone: 'GULF', v: 25 }], news: { headline: 'L’offensive de la coalition réussit en quelques jours : le Brent s’effondre', body: 'Les stocks stratégiques sont débloqués, la prime de risque disparaît en une séance.', commodity: 'BRENT', tone: 'down', major: true, category: 'géopolitique' } },
      { inDays: 140, impacts: [{ k: 'liftSanction', zone: 'GULF' }, { k: 'iv', c: 'BRENT', v: -0.6 }], news: { headline: 'Levée de l’embargo : le pétrole du Golfe revient sur le marché', commodity: 'BRENT', tone: 'down', major: false, category: 'géopolitique' } },
    ],
    objective: { desc: 'Finir l’année avec au moins 1,4× le capital de départ.', navMultiple: 1.4 },
  },
  {
    id: 'supercycle',
    name: 'Le super-cycle',
    era: 'inspiré de 2003-2008',
    icon: '📈',
    intro: 'Un géant asiatique s’industrialise à une vitesse jamais vue : cuivre, charbon, pétrole, tout manque. Les prix vont tripler… puis une crise financière balaiera tout.',
    lesson: 'Suivre la tendance enrichit, mais la sortie compte autant que l’entrée : contango, backwardation et effondrement final.',
    config: { startYear: 2027, years: 4, capital: 20e6, hqCity: 'london', companyName: 'Cycle Commodities Ltd', crisisFrequency: 0.6 },
    start: {},
    events: [
      { inDays: 5, impacts: [{ k: 'narrative', id: 'supercycle', name: 'Super-cycle asiatique', drift: { CU: 0.28, API2: 0.22, BRENT: 0.2, WHEAT: 0.08 }, days: 780 }, { k: 'chi', c: 'CU', v: 0.08 }], news: { headline: 'Croissance à deux chiffres en Asie : les métaux s’arrachent', body: 'Les analystes parlent d’un « super-cycle » des matières premières.', tone: 'up', major: true, category: 'macro' } },
      { inDays: 400, impacts: [{ k: 'chi', c: 'BRENT', v: 0.2 }, { k: 'chi', c: 'CU', v: 0.12 }], news: { headline: 'Pénurie : le pétrole et le cuivre battent leurs records', tone: 'up', major: true, category: 'marché' } },
      { inDays: 790, impacts: [{ k: 'chi', c: 'BRENT', v: -0.6 }, { k: 'chi', c: 'CU', v: -0.5 }, { k: 'chi', c: 'API2', v: -0.45 }, { k: 'xi', c: 'CU', v: -0.2 }, { k: 'xi', c: 'BRENT', v: -0.2 }, { k: 'regime' }, { k: 'narrative', id: 'recession', name: 'Crise financière mondiale', drift: { CU: -0.2, BRENT: -0.2, API2: -0.15 }, days: 160 }], news: { headline: 'Faillite d’une grande banque d’affaires : panique sur tous les marchés', body: 'Le crédit se tarit, la demande s’effondre, les matières premières chutent de moitié.', tone: 'down', major: true, category: 'macro' } },
    ],
    objective: { desc: 'Tripler les fonds propres d’ici la fin.', navMultiple: 3 },
  },
  {
    id: 'pandemie',
    name: 'La grande pause',
    era: 'inspiré de 2020',
    icon: '😷',
    intro: 'Une épidémie arrête l’économie mondiale. Plus d’avions, plus de voitures : le pétrole n’a plus d’acheteurs et les cuves se remplissent.',
    lesson: 'En contango extrême, celui qui a du stockage et du financement achète au comptant, vend à terme, et encaisse le portage.',
    config: { startYear: 2027, years: 1, capital: 25e6, hqCity: 'geneva', companyName: 'Pause Trading SA', crisisFrequency: 0.3 },
    start: {},
    events: [
      { inDays: 10, impacts: [{ k: 'chi', c: 'BRENT', v: -0.35 }, { k: 'chi', c: 'TTF', v: -0.3 }, { k: 'chi', c: 'CU', v: -0.15 }, { k: 'iv', c: 'BRENT', v: 0.6 }, { k: 'regime' }], news: { headline: 'Confinements généralisés : la demande de pétrole s’effondre', tone: 'down', major: true, category: 'macro' } },
      { inDays: 35, impacts: [{ k: 'chi', c: 'BRENT', v: -0.4 }, { k: 'iv', c: 'BRENT', v: 0.6 }], news: { headline: 'Plus de place pour stocker : contango record sur le Brent', body: 'Le front s’effondre sous les échéances lointaines : acheter, stocker, vendre à terme rapporte comme jamais.', commodity: 'BRENT', tone: 'down', major: true, category: 'marché' } },
      { inDays: 120, impacts: [{ k: 'chi', c: 'BRENT', v: 0.35 }, { k: 'chi', c: 'CU', v: 0.2 }, { k: 'iv', c: 'BRENT', v: -0.5 }], news: { headline: 'Réouverture : la demande repart plus vite que prévu', tone: 'up', major: true, category: 'macro' } },
      { inDays: 200, impacts: [{ k: 'chi', c: 'BRENT', v: 0.3 }, { k: 'chi', c: 'TTF', v: 0.4 }, { k: 'chi', c: 'CU', v: 0.15 }], news: { headline: 'Reprise mondiale : les stocks se vident à grande vitesse', tone: 'up', major: false, category: 'marché' } },
    ],
    objective: { desc: 'Gagner au moins 30 % ET réussir un portage (vendre avec profit un stock détenu plus de 60 jours).', navMultiple: 1.3, requireCarry: true },
  },
  {
    id: 'hiver',
    name: 'L’hiver sans gaz',
    era: 'inspiré de 2022',
    icon: '🥶',
    intro: 'Vous avez rempli des stockages de gaz pour l’hiver, couverts par des ventes de futures TTF. Le grand fournisseur de l’Est menace de fermer les gazoducs.',
    lesson: 'Les bourses relèvent les marges quand la volatilité explose : il faut de la trésorerie, pas seulement de bonnes positions.',
    config: { startYear: 2027, years: 1, capital: 40e6, hqCity: 'london', companyName: 'Northern Gas Trading Ltd', crisisFrequency: 0.3 },
    start: { inventory: [{ commodity: 'TTF', locationId: 'TTF_HUB', qty: 450_000 }], futures: [{ commodity: 'TTF', lots: -620 }] },
    events: [
      { inDays: 8, impacts: [{ k: 'chi', c: 'TTF', v: 0.25 }, { k: 'iv', c: 'TTF', v: 0.4 }, { k: 'tension', v: 20 }], news: { headline: 'La Sarmatie réduit ses livraisons de gaz de 40 %', commodity: 'TTF', tone: 'up', major: true, category: 'géopolitique', zone: 'SARM' } },
      { inDays: 30, impacts: [{ k: 'chi', c: 'TTF', v: 0.55 }, { k: 'iv', c: 'TTF', v: 0.9 }, { k: 'regime' }, { k: 'sanction', zone: 'SARM', by: 'west', kind: 'full', c: 'TTF' }], news: { headline: 'Gazoducs fermés : le TTF multiplié par trois en un mois', body: 'Les bourses relèvent leurs dépôts de garantie ; plusieurs énergéticiens appellent leurs États à l’aide.', commodity: 'TTF', tone: 'up', major: true, category: 'géopolitique' } },
      { inDays: 75, impacts: [{ k: 'chi', c: 'TTF', v: 0.25 }], news: { headline: 'Panique : records absolus sur le gaz européen', commodity: 'TTF', tone: 'up', major: false, category: 'marché' } },
      { inDays: 130, impacts: [{ k: 'chi', c: 'TTF', v: -0.7 }, { k: 'iv', c: 'TTF', v: -0.5 }], news: { headline: 'Hiver doux et terminaux GNL pleins : le gaz s’effondre', commodity: 'TTF', tone: 'down', major: true, category: 'météo' } },
    ],
    objective: { desc: 'Traverser l’hiver et finir avec au moins le capital de départ.', navMultiple: 1 },
  },
  {
    id: 'squeeze',
    name: 'Le squeeze du métal',
    era: 'inspiré de 2022',
    icon: '🔩',
    intro: 'Votre stock de cuivre à Shanghai est couvert par des ventes au LMM. Un grand industriel a vendu bien plus de cuivre qu’il n’en possède… et le marché le sait.',
    lesson: 'Une suspension de cotation vous empêche de couvrir : la liquidité peut disparaître du jour au lendemain.',
    config: { startYear: 2027, years: 1, capital: 30e6, hqCity: 'singapore', companyName: 'Strait Metals Pte', crisisFrequency: 0.3 },
    start: { inventory: [{ commodity: 'CU', locationId: 'CU_SHA', qty: 2500 }], futures: [{ commodity: 'CU', lots: -100 }] },
    events: [
      { inDays: 20, impacts: [{ k: 'chi', c: 'CU', v: 0.1 }, { k: 'iv', c: 'CU', v: 0.3 }], news: { headline: 'Rumeurs : un industriel serait massivement vendeur de cuivre', commodity: 'CU', tone: 'up', major: false, category: 'marché' } },
      { inDays: 25, impacts: [{ k: 'chi', c: 'CU', v: 0.38 }, { k: 'iv', c: 'CU', v: 0.8 }, { k: 'halt', c: 'CU', days: 4 }, { k: 'regime' }], news: { headline: 'Squeeze historique : le cuivre +40 % en deux séances, la bourse suspend la cotation', body: 'Impossible de couvrir ou de déboucler pendant plusieurs jours.', commodity: 'CU', tone: 'up', major: true, category: 'marché' } },
      { inDays: 34, impacts: [{ k: 'chi', c: 'CU', v: -0.3 }, { k: 'iv', c: 'CU', v: -0.4 }], news: { headline: 'Réouverture : la bourse annule une partie des transactions, le cuivre retombe', commodity: 'CU', tone: 'down', major: true, category: 'marché' } },
    ],
    objective: { desc: 'Survivre au squeeze et finir avec 1,1× le capital de départ.', navMultiple: 1.1 },
  },
];

export const SCENARIO_BY_ID = Object.fromEntries(SCENARIOS.map((s) => [s.id, s])) as Record<string, ScenarioDef>;
