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
  /** ce qui empêche de réaliser l'étape maintenant, et comment débloquer (null si rien ne bloque) */
  blocker?: (s: GameState) => string | null;
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

/** Exposition physique (stocks, forwards, cargaisons) d'une commodité, en unités. */
const phys = (s: GameState, c: CommodityId) =>
  s.forwards.filter((d) => d.commodity === c).reduce((a, d) => a + d.side * d.qty, 0) +
  s.inventory.filter((l) => l.commodity === c).reduce((a, l) => a + l.qty, 0) +
  s.voyages.filter((v) => v.commodity === c).reduce((a, v) => a + v.qty, 0);
const futQty = (s: GameState, c: CommodityId) => s.futures.filter((p) => p.commodity === c).reduce((a, p) => a + p.lots, 0);
const sold = (s: GameState) => (s.stats?.deals.length ?? 0) > 0;

export const LESSONS: Lesson[] = [
  {
    id: 'first', title: 'Premiers pas : acheter, couvrir, revendre', icon: '🧭', managing: true,
    concept: 'Le métier de négociant tient en une phrase : acheter une cargaison à un endroit et à un moment, la revendre ailleurs ou plus tard, et ne pas parier sur le prix entre les deux. La marge vient de l’écart de prix entre les lieux et les dates (le « différentiel »), pas de la direction du marché. Dix minutes pour faire le tour.',
    steps: [
      { text: 'Achetez une cargaison : panneau Physique, une offre qui « vend ». Le bouton « Acheter + couvrir » achète la cargaison et vend aussitôt les futures qui la protègent. Préférez une offre dont la valeur estimée est en vert.', panel: 'physical', check: (s) => s.forwards.length > 0 || s.inventory.length > 0 || sold(s), blocker: (s) => (s.offers.some((o) => o.side > 0) ? null : 'Aucune cargaison à vendre sur la table aujourd’hui : avancez d’un jour (touche N), de nouvelles offres arrivent chaque jour.') },
      { text: 'Couvrez le prix, si ce n’est pas déjà fait : dans le Livre, « Neutraliser Δ » sur la ligne de la commodité. Vous vendez des futures : si le prix baisse avant la revente, leur gain compense la perte sur la cargaison.', panel: 'book', check: (s) => sold(s) || s.automation.autoHedge.on || s.forwards.some((d) => d.side > 0 && futQty(s, d.commodity) < 0) || s.inventory.some((l) => futQty(s, l.commodity) < 0) },
      { text: 'Trouvez un acheteur : une offre qui « cherche à acheter » la même commodité, au même lieu, livrée après votre achat. Elle porte le badge « ✓ adosse votre achat ». Bouton « Vendre + couvrir » : il rachète la couverture devenue inutile. S’il n’y en a pas, avancez d’un jour (N) : de nouvelles offres arrivent chaque jour.', panel: 'physical', check: (s) => sold(s) || s.forwards.some((d) => d.side < 0), blocker: (s) => (s.offers.some((o) => o.side < 0) ? null : 'Pas d’acheteur aujourd’hui : avancez d’un jour (touche N). Vous pouvez aussi revendre votre stock au comptant à la livraison.') },
      { text: 'Lancez le temps (Espace, ou les flèches en haut). Votre achat est livré en stock, puis votre vente est servie depuis ce stock. Vous pouvez aussi revendre le stock au comptant depuis le Livre.', panel: 'book', check: sold, blocker: (s) => { const next = [...s.forwards].sort((a, b) => a.deliveryDay - b.deliveryDay)[0]; return next ? `Rien à faire qu’attendre : prochaine livraison dans ${Math.max(0, Math.round(next.deliveryDay - s.day))} jours.` : s.inventory.length ? 'Votre stock est arrivé : revendez-le au comptant depuis le Livre (« Vendre spot »).' : null; } },
      { text: 'La vente est faite : s’il vous reste des futures sans physique en face, ils n’ont plus d’objet. Dans Marchés, choisissez la commodité et cliquez « Clôturer », pour ne pas garder un pari ouvert.', panel: 'market', check: (s) => sold(s) && s.futures.every((p) => Math.abs(phys(s, p.commodity)) > 0) },
    ],
    outro: 'Votre résultat se lit dans le Livre (P&L par commodité) et la Trésorerie (cash par catégorie). Pour la suite : activez la couverture automatique (panneau Automatisation, touche U), voyagez pour négocier sur place, et explorez les autres leçons.',
  },
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

  // ---------------------------------------------------------------- leçons facultatives (dans n'importe quel ordre)
  {
    id: 'travel', title: 'Voyager pour négocier', icon: '✈️',
    concept: 'Au téléphone, la contrepartie garde l’avantage. Sur place, vous renégociez le différentiel (environ 0,4 % du prix) et vous sortez de votre stock au comptant sans pénalité. Un voyage coûte du temps et des frais : choisissez la ville où se concentrent les offres.',
    steps: [
      { text: 'Ouvrez Voyages et partez pour une ville où vous avez des offres.', panel: 'travel', check: (s) => !!s.player.travel || s.player.cityId !== s.company.hqCity },
      { text: 'Une fois sur place, négociez une offre (bouton « Négocier ») : une seule tentative par offre.', panel: 'physical', check: (s) => (s.stats?.negotiationsWon ?? 0) > 0 || s.offers.some((o) => o.negotiated), blocker: (s) => (s.player.travel ? 'Vous êtes en route : avancez le temps jusqu’à l’arrivée.' : null) },
    ],
    outro: 'Le badge « 🤝 sur place » signale les offres que vous pouvez renégocier.',
  },
  {
    id: 'var', title: 'Lire sa VaR', icon: '🛡️',
    concept: 'La VaR 99 % à un jour est la perte que vous ne devriez dépasser qu’un jour sur cent. Le jeu la calcule par revalorisation complète de votre livre sur des scénarios corrélés. Une position couverte a une VaR faible ; une position nue, une VaR proportionnelle à sa taille et à sa volatilité.',
    steps: [
      { text: 'Prenez une position futures (Marchés).', panel: 'market', check: (s) => s.futures.length > 0 },
      { text: 'Ouvrez Risque : votre VaR apparaît, avec sa ventilation par commodité.', panel: 'risk', check: (s) => s.risk.var99 > 0, blocker: () => 'La VaR se recalcule à la clôture : avancez d’un jour (N).' },
      { text: 'Réduisez-la : couvrez ou fermez la position, et constatez la baisse le lendemain.', panel: 'book', check: (s) => s.futures.length === 0 || s.risk.var99 < 0.01 * s.lastNav },
    ],
    outro: 'Les banques surveillent votre VaR : au-delà de 8 % des fonds propres, le covenant de la ligne de crédit est dépassé.',
  },
  {
    id: 'margin', title: 'Marge, appels et trésorerie', icon: '🏦',
    concept: 'Chaque soir, la bourse règle la variation de valeur de vos futures en cash (marge de variation) et bloque un dépôt (marge initiale). Une couverture gagnante sur le papier peut vider votre trésorerie : c’est la cargaison qui gagne, mais plus tard. La ligne de crédit (RCF) sert de tampon.',
    steps: [
      { text: 'Ouvrez une position futures : la marge initiale est bloquée sur votre cash.', panel: 'market', check: (s) => s.company.im > 0 },
      { text: 'Ouvrez la Trésorerie et tirez sur la ligne de crédit pour constituer un tampon.', panel: 'treasury', check: (s) => s.company.rcfDrawn > 0 },
    ],
    outro: 'Un appel de marge non couvert entraîne la liquidation de vos futures par le courtier, au pire moment.',
  },
  {
    id: 'shipping', title: 'Affréter un navire', icon: '🚢',
    concept: 'Une cargaison achetée FOB doit être transportée jusqu’à l’acheteur. Le fret se paie au taux du jour (indices Capesize, Panamax, Aframax, méthaniers), les canaux peuvent fermer et les ports se congestionnent. L’écart de prix entre deux lieux paie, en moyenne, le fret : l’arbitrage géographique est un métier.',
    steps: [
      { text: 'Ayez un stock quelque part (une livraison reçue ou un achat au comptant).', panel: 'physical', check: (s) => s.inventory.length > 0 || s.voyages.length > 0 },
      { text: 'Dans Fret, expédiez-le vers un autre lieu (voyez le coût et la durée avant de valider).', panel: 'logistics', check: (s) => s.voyages.length > 0 || (s.stats?.voyagesDone ?? 0) > 0 },
      { text: 'Laissez filer le temps jusqu’à l’arrivée : la cargaison rejoint le stock du port de destination.', panel: 'book', check: (s) => (s.stats?.voyagesDone ?? 0) > 0, blocker: (s) => (s.voyages[0] ? `Arrivée prévue dans ${Math.max(0, Math.round(s.voyages[0].arriveDay - s.day))} jours.` : null) },
    ],
    outro: 'Les FFA (contrats à terme sur le fret) couvrent le coût d’un affrètement futur.',
  },
  {
    id: 'financing', title: 'Financer un stock', icon: '🏧',
    concept: 'Un stock immobilise du cash. Une banque prête contre ce stock (borrowing base) une fraction de sa valeur ; vous payez des intérêts, et elle peut exiger un complément si le prix baisse. La lettre de crédit, elle, garantit au vendeur qu’il sera payé.',
    steps: [
      { text: 'Ayez un stock.', panel: 'physical', check: (s) => s.inventory.length > 0 },
      { text: 'Dans Financement, faites financer ce stock par une banque.', panel: 'finance', check: (s) => s.financing.loans.length > 0 || (s.stats?.lotsFinanced ?? 0) > 0 },
    ],
    outro: 'Le financement libère du cash pour la marge de vos couvertures : c’est le cœur de la trésorerie d’un négociant.',
  },
  {
    id: 'options', title: 'Un plancher avec une option', icon: '🎯',
    concept: 'Un put vous garantit un prix de vente minimal contre une prime. Vendre un call en face finance la prime en renonçant à la hausse au-delà de son strike : c’est un tunnel (« collar »). Les prix suivent Black-76 avec un sourire de volatilité.',
    steps: [
      { text: 'Achetez un put (Options).', panel: 'options', check: (s) => s.options.some((o) => o.type === 'P' && o.lots > 0) },
      { text: 'Vendez un call de strike plus élevé sur la même commodité : votre tunnel est en place.', panel: 'options', check: (s) => s.options.some((p) => p.type === 'P' && p.lots > 0 && s.options.some((c) => c.type === 'C' && c.lots < 0 && c.commodity === p.commodity)) },
    ],
    outro: 'Le delta de vos options apparaît dans le Livre : il compte dans votre couverture.',
  },
  {
    id: 'calendar', title: 'Le spread calendaire', icon: '📅',
    concept: 'Acheter une échéance et vendre une autre, c’est parier sur la forme de la courbe et non sur son niveau. En contango, le spread paie le stockage ; en backwardation, le marché manque de marchandise tout de suite.',
    steps: [
      { text: 'Dans Marchés, choisissez « Spread calendaire » et passez un spread.', panel: 'market', check: (s) => s.futures.some((a) => s.futures.some((b) => b.commodity === a.commodity && b.month !== a.month && Math.sign(b.lots) !== Math.sign(a.lots))) },
    ],
    outro: 'La marge initiale d’un spread est bien plus faible que celle d’une position sèche : les deux jambes se compensent.',
  },
  {
    id: 'carry', title: 'Le portage (cash and carry)', icon: '🛢️',
    concept: 'Quand le prix à terme dépasse le prix comptant de plus que le stockage et le financement, on achète au comptant, on vend à terme, et on stocke : le gain est fixé dès le départ. Le conseiller analyste signale ces fenêtres.',
    steps: [
      { text: 'Achetez une cargaison au comptant (Physique, onglet Marché spot).', panel: 'physical', check: (s) => s.inventory.length > 0 },
      { text: 'Vendez des futures d’une échéance lointaine pour fixer le prix de revente.', panel: 'market', check: (s) => s.inventory.some((l) => s.futures.some((p) => p.commodity === l.commodity && p.lots < 0)) },
      { text: 'Revendez le stock plus tard avec profit (plus de 60 jours de portage).', panel: 'book', check: (s) => (s.stats?.carryWins ?? 0) > 0, blocker: () => 'Patience : un portage se dénoue en plusieurs mois.' },
    ],
    outro: 'Le portage est la manière la plus sûre de gagner de l’argent dans le négoce, quand la courbe le permet.',
  },
  {
    id: 'ffa', title: 'Couvrir le fret', icon: '⚓',
    concept: 'Un FFA est un contrat à terme sur un indice de fret ($/jour). L’affréteur qui craint une hausse du fret en achète ; l’armateur, en vend. Le règlement se fait sur la moyenne mensuelle de l’indice.',
    steps: [
      { text: 'Dans Fret, achetez un FFA sur l’indice de votre prochain navire.', panel: 'logistics', check: (s) => (s.ffa?.length ?? 0) > 0 },
    ],
    outro: 'Votre exposition au fret se lit désormais comme une exposition de prix.',
  },
  {
    id: 'otc', title: 'Swap et option asiatique', icon: '🔁',
    concept: 'Un swap mensuel fixe le prix moyen d’un mois de livraisons : c’est l’outil des industriels qui achètent tous les jours. Une option asiatique (APO) protège ce prix moyen, moins cher qu’une option ordinaire car la moyenne est moins volatile.',
    steps: [
      { text: 'Dans Options, onglet OTC, traitez un swap mensuel.', panel: 'options', check: (s) => s.otc.some((x) => x.kind === 'swap') },
      { text: 'Puis une option asiatique (APO).', panel: 'options', check: (s) => s.otc.some((x) => x.kind === 'apo') },
    ],
    outro: 'Les swaps se règlent chaque jour de fixing, contre la moyenne des cotations du mois.',
  },
  {
    id: 'compliance', title: 'Conformité et inspection', icon: '⚖️', managing: true,
    concept: 'KYC, sanctions, abus de marché : les raccourcis rapportent vite et coûtent cher plus tard, en amendes, en suspension de licence ou en lignes bancaires coupées. Un inspecteur indépendant au chargement protège contre la marchandise hors spécification.',
    steps: [
      { text: 'Dans Conformité, relevez le niveau de conformité au-dessus de « minimal ».', panel: 'compliance', check: (s) => s.compliance.level !== 'minimal' },
      { text: 'Achetez une cargaison avec inspection (case « inspection » sur l’offre).', panel: 'physical', check: (s) => s.forwards.some((d) => d.inspected) },
    ],
    outro: 'Plus de conformité, c’est moins de dossiers… et quelques affaires refusées.',
  },
  {
    id: 'office', title: 'Un siège à votre image', icon: '🏛️', managing: true,
    concept: 'Votre siège dit qui vous êtes : il attire des candidats, rassure les contreparties et vous ouvre les grands clients. Il coûte un loyer, ou un achat si vous devenez propriétaire.',
    steps: [
      { text: 'Dans Bureaux, personnalisez votre siège (style, couleur, aménagement) ou déménagez.', panel: 'offices', check: (s) => s.office.items.length > 0 || s.office.tier > 0 || !!s.office.custom },
    ],
    outro: 'Plongez dans votre ville (touche H) pour voir le résultat, et zoomez sur le siège pour entrer.',
  },
  {
    id: 'assets', title: 'Votre premier actif', icon: '🏭', managing: true,
    concept: 'Une cuve, un silo, un navire ou une raffinerie : un actif produit une marge régulière (stockage, fret, transformation) mais immobilise du capital et a ses propres risques (pannes, grèves, nationalisation).',
    steps: [
      { text: 'Dans Actifs, achetez ou construisez un actif.', panel: 'assets', check: (s) => s.assets.length > 0 },
    ],
    outro: 'Un stockage détenu ne paie plus que ses coûts d’exploitation : le portage devient plus rentable.',
  },
  {
    id: 'exotics', title: 'Un produit structuré', icon: '🧪',
    concept: 'Barrières, options sur spread, lookbacks : des produits sur mesure, évalués en formule fermée et vérifiables par Monte Carlo. Leur risque se gère comme celui d’une option, avec des grecques qui peuvent changer brutalement près d’une barrière.',
    steps: [
      { text: 'Dans Structurés, traitez un produit (barrière, spread…).', panel: 'exotics', check: (s) => (s.exotics?.length ?? 0) > 0 },
    ],
    outro: 'Le bouton Monte Carlo compare le prix fermé à une simulation : un bon réflexe de structureur.',
  },
  {
    id: 'government', title: 'Traiter avec un État', icon: '🏛️', managing: true,
    concept: 'Les gouvernements attribuent des licences d’import-export, lancent des appels d’offres (stocks stratégiques, céréales, carburants), négocient des régimes fiscaux et peuvent nationaliser ou sanctionner. La relation se construit : réputation, conformité, présence locale.',
    steps: [
      { text: 'Ouvrez Gouvernements et répondez à un appel d’offres public, ou demandez une licence.', panel: 'government', check: (s) => (s.gov?.bids.length ?? 0) > 0 || (s.gov?.licences.length ?? 0) > 0 },
    ],
    outro: 'Un État payeur est solide… jusqu’au jour où il ne l’est plus : surveillez la notation du pays.',
  },
];

export const LESSON_BY_ID: Record<string, Lesson> = Object.fromEntries(LESSONS.map((l) => [l.id, l]));
