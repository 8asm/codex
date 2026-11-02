/**
 * Phase 9 — Leçons guidées sur les nouveaux marchés et les nouveaux métiers.
 * Chaque leçon expose un concept (le « pourquoi » financier), puis des étapes vérifiées automatiquement sur l'état
 * de la partie (prédicats purs). Le bouton d'une étape ouvre le panneau où agir.
 */
import type { CommodityId, GameState } from '../engine/types';

export interface LessonStep {
  text: string;
  /** panneau à ouvrir (identifiant de l'interface) */
  panel?: string;
  check: (s: GameState) => boolean;
}

export interface Lesson {
  id: string;
  title: string;
  icon: string;
  /** le concept, en deux ou trois phrases */
  concept: string;
  /** marchés à suivre pour pouvoir faire la leçon */
  requires?: CommodityId[];
  /** réservée à qui dirige la maison (recrutement, bureaux) */
  managing?: boolean;
  steps: LessonStep[];
  outro: string;
}

const fut = (s: GameState, c: CommodityId, sign: 1 | -1) => s.futures.some((p) => p.commodity === c && Math.sign(p.lots) === sign);
const opt = (s: GameState, c: CommodityId, f: (o: GameState['options'][number]) => boolean) => s.options.some((o) => o.commodity === c && f(o));

export const LESSONS: Lesson[] = [
  {
    id: 'crack', title: 'La marge du raffineur : le crack spread', icon: '🏭', requires: ['BRENT', 'GASOIL'],
    concept: 'Un raffineur achète du brut et vend des produits. Sa marge, le « crack spread », est l’écart entre les deux : gazole ($/t ÷ 7,45 bbl/t) moins Brent ($/bbl). Acheter le brut et vendre le gazole à terme fige cette marge, quel que soit le niveau du pétrole.',
    steps: [
      { text: 'Achetez des futures Brent (le brut que la raffinerie consommera).', panel: 'market', check: (s) => fut(s, 'BRENT', 1) },
      { text: 'Vendez des futures gasoil sur une échéance proche : environ 1 lot de 100 t pour 745 barils de Brent.', panel: 'market', check: (s) => fut(s, 'GASOIL', -1) },
      { text: 'Ouvrez le panneau Risque : le delta pétrole se compense en grande partie, il reste le risque de crack.', panel: 'risk', check: (s) => fut(s, 'BRENT', 1) && fut(s, 'GASOIL', -1) },
    ],
    outro: 'Vous portez une marge de raffinage, pas un pari sur le pétrole. Les Structurés proposent aussi des options sur ce spread (formule de Kirk).',
  },
  {
    id: 'negative', title: 'WTI : quand le prix passe sous zéro', icon: '🕳️', requires: ['WTI'],
    concept: 'Le WTI se livre à Cushing, un hub enclavé. Quand les cuves débordent, le détenteur d’un contrat qui expire paie pour qu’on le débarrasse du pétrole : le prix devient négatif. Un modèle log-normal classique ne peut pas produire cela. Le jeu utilise une log-normale décalée (prix + 20 $ log-normal), et Black s’applique à (F + 20, K + 20).',
    steps: [
      { text: 'Regardez la courbe WTI dans Marchés : le prix plancher théorique est −20 $.', panel: 'market', check: (s) => s.futures.some((p) => p.commodity === 'WTI') || s.options.some((o) => o.commodity === 'WTI') },
      { text: 'Achetez un put WTI de strike bas (≤ 40 $) : une assurance contre le débordement des cuves.', panel: 'options', check: (s) => opt(s, 'WTI', (o) => o.type === 'P' && o.lots > 0 && o.strike <= 40) },
    ],
    outro: 'Même un put de strike 0 a une valeur dans ce modèle, ce qui est impossible en log-normal pur. C’est la leçon d’avril 2020.',
  },
  {
    id: 'power', title: 'L’électricité ne se stocke pas', icon: '⚡', requires: ['POWER'],
    concept: 'Pas de stock, donc pas de portage : le prix spot de l’électricité est fixé heure par heure par la dernière centrale appelée, et la courbe à terme ne suit pas la relation de stockage. Une livraison physique se règle contre le spot du moment.',
    steps: [
      { text: 'Prenez une position sur l’électricité allemande en base (futures ou offre physique).', panel: 'market', check: (s) => s.futures.some((p) => p.commodity === 'POWER') || s.forwards.some((d) => d.commodity === 'POWER') },
      { text: 'Pour une centrale à gaz, la marge (« spark spread ») = électricité − 2 MWh de gaz − 0,37 t de CO2 par MWh. Vendez de l’électricité et achetez du gaz TTF pour la figer.', panel: 'market', check: (s) => (fut(s, 'POWER', -1) || s.forwards.some((d) => d.commodity === 'POWER' && d.side < 0)) && fut(s, 'TTF', 1) },
    ],
    outro: 'Une centrale est une option : elle ne produit que si le spark spread est positif. Sa valeur de dispatch est E[max(spark, 0)], supérieure à la marge moyenne.',
  },
  {
    id: 'lng', title: 'GNL : l’arbitrage Asie-Europe', icon: '🧊', requires: ['JKM', 'TTF'],
    concept: 'Une cargaison de GNL américaine peut aller en Europe (TTF) ou en Asie (JKM). Elle part là où l’écart de prix paie le fret méthanier plus long. Le spread JKM − TTF est donc borné par le coût du transport.',
    steps: [
      { text: 'Achetez des futures JKM (l’Asie paie la cargaison).', panel: 'market', check: (s) => fut(s, 'JKM', 1) },
      { text: 'Vendez des futures TTF en face : vous êtes long le spread Asie-Europe.', panel: 'market', check: (s) => fut(s, 'JKM', 1) && fut(s, 'TTF', -1) },
    ],
    outro: 'Attention aux unités : JKM en $/MMBtu, TTF en €/MWh (1 MWh = 3,412 MMBtu), avec un risque de change EUR/USD.',
  },
  {
    id: 'grades', title: 'Qualités de brut : la valeur d’usage', icon: '🛢️', requires: ['BRENT', 'FUELOIL'],
    concept: 'Un brut lourd et soufré (Maya, Arab Heavy) rend beaucoup de fioul et peu d’essence. Son prix au benchmark suit la valeur de ce qu’on en tire : quand le fioul s’effondre, sa décote se creuse. Couvrir une telle cargaison en Brent seul laisse ce risque de qualité.',
    steps: [
      { text: 'Achetez une cargaison de brut d’une qualité nommée (étiquette 🛢️ dans les offres physiques).', panel: 'physical', check: (s) => s.forwards.some((d) => !!d.grade && d.side > 0) || s.inventory.some((l) => !!l.grade) },
      { text: 'Le Risque affiche votre exposition au fioul portée par la qualité. Vendez des futures fioul pour la couvrir.', panel: 'risk', check: (s) => (s.forwards.some((d) => !!d.grade) || s.inventory.some((l) => !!l.grade)) && fut(s, 'FUELOIL', -1) },
    ],
    outro: 'Vous couvrez le niveau du pétrole (Brent) et le différentiel de qualité (produits) : c’est ainsi que travaillent les desks de brut.',
  },
  {
    id: 'strip', title: 'Couvrir en strip', icon: '🧵',
    concept: 'Couvrir un achat de janvier avec l’échéance d’octobre laisse tout le risque de calendrier : les deux échéances ne bougent pas ensemble, surtout pour le gaz, très saisonnier. Une couverture en strip met chaque exposition sur son échéance.',
    steps: [
      { text: 'Activez la couverture automatique (panneau Automatisation).', panel: 'automation', check: (s) => s.automation.autoHedge.on },
      { text: 'Détenez du physique sur au moins deux mois de livraison différents (offres physiques).', panel: 'physical', check: (s) => new Set(s.forwards.map((d) => `${d.commodity}:${d.month}`)).size >= 2 },
      { text: 'Constatez dans le Livre que l’automate couvre chaque mois sur sa propre échéance.', panel: 'book', check: (s) => Object.values(s.automation.hedged ?? {}).filter((v) => v !== 0).length >= 2 },
    ],
    outro: 'L’automate mémorise ce qu’il a ouvert, échéance par échéance : à la livraison, il ne déboucle que sa couverture, jamais vos positions.',
  },
  {
    id: 'desk', title: 'Déléguer un desk', icon: '📈', managing: true,
    concept: 'Un trader sous mandat prend seul des positions dans une limite de VaR. Son avantage vient de sa lecture des tendances de fond, avec un bruit qui dépend de sa compétence. Un trader médiocre trade surtout ce bruit : il paie la fourchette et perd en moyenne. Ses positions sont les vôtres : marge, VaR, faillite.',
    steps: [
      { text: 'Recrutez un trader (panneau Équipes).', panel: 'staff', check: (s) => s.staff?.employees.some((e) => e.role === 'trader') ?? false },
      { text: 'Donnez-lui un mandat : une limite de VaR.', panel: 'staff', check: (s) => s.staff?.employees.some((e) => e.role === 'trader' && e.mandate?.on) ?? false },
      { text: 'Attendez son premier rééquilibrage : ses positions apparaissent dans le panneau Équipes.', panel: 'staff', check: (s) => (s.desks?.positions.length ?? 0) > 0 },
    ],
    outro: 'Surveillez la VaR déclarée et le P&L : un trader ambitieux, mal payé et en perte peut dissimuler un dépassement. Les risk managers aident à le découvrir.',
  },
  {
    id: 'branch', title: 'Un bureau à l’étranger', icon: '🌐', managing: true,
    concept: 'Un bureau donne une présence permanente : conditions locales sur les offres, sans voyager. Il crée aussi un établissement stable : le bénéfice de ses desks y est imposé au taux local, et les transactions y sont déclarées au régulateur local.',
    steps: [
      { text: 'Ouvrez un bureau de représentation (fonds propres ≥ 15 M$).', panel: 'staff', check: (s) => (s.staff?.branches.length ?? 0) > 0 },
      { text: 'Rattachez un collaborateur à ce bureau lors d’un recrutement.', panel: 'staff', check: (s) => (s.staff?.employees ?? []).some((e) => e.cityId !== s.company.hqCity) },
    ],
    outro: 'Comparez les taux d’impôt et les contrôles des capitaux avant de choisir : rapatrier un bénéfice de certaines places coûte une retenue.',
  },
];

export const LESSON_BY_ID: Record<string, Lesson> = Object.fromEntries(LESSONS.map((l) => [l.id, l]));
