/**
 * Phase 6 — Bureaux, salle de marché et objets de prestige.
 * Les montants sont en USD ; les coûts « par mois » sont prélevés avec les frais généraux.
 */
import type { FloorStyle, OfficeTier, PrestigeItemId } from '../engine/types';

export interface TierDef {
  tier: OfficeTier;
  name: string;
  short: string;
  /** Multiplicateur du loyer de base de la ville (le loyer de base = un étage loué). */
  rentMult: number;
  /** Postes de travail disponibles (traders, opérations, gérants d'actifs, automates). */
  seats: number;
  /** Agencements à l'installation (capitalisés puis amortis). Ajusté du coût local. */
  fitOut: number;
  /** Valeur liquidative minimale pour qu'un bailleur accepte de signer (solvabilité du preneur). */
  minNav: number;
  prestige: number;
  blurb: string;
}

export const TIERS: TierDef[] = [
  { tier: 0, name: 'Étage loué', short: 'Étage', rentMult: 1, seats: 8, fitOut: 250_000, minNav: 0, prestige: 5, blurb: 'Un plateau dans un immeuble de bureaux, une plaque discrète dans le hall.' },
  { tier: 1, name: 'Plusieurs étages', short: 'Étages', rentMult: 3, seats: 20, fitOut: 1_500_000, minNav: 40e6, prestige: 15, blurb: 'Trois étages, votre logo au sommet de l’immeuble, un vrai hall d’accueil.' },
  { tier: 2, name: 'Tour', short: 'Tour', rentMult: 8, seats: 60, fitOut: 6_000_000, minNav: 120e6, prestige: 32, blurb: 'Une tour de verre à votre nom, visible depuis le port.' },
  { tier: 3, name: 'Campus', short: 'Campus', rentMult: 16, seats: 150, fitOut: 18_000_000, minNav: 400e6, prestige: 50, blurb: 'Une tour, des pavillons, des jardins : le quartier général d’une maison mondiale.' },
];

export interface StyleDef {
  id: FloorStyle;
  name: string;
  /** Coût de réaménagement au palier « étage » ; multiplié par l'échelle du palier. */
  cost: number;
  prestige: number;
  effect: string;
  blurb: string;
}

export const STYLES: StyleDef[] = [
  { id: 'classique', name: 'Classique', cost: 400_000, prestige: 6, effect: 'Relations +15 % (rendez-vous, invitations)', blurb: 'Boiseries, lampes de banquier, tableau des cours. Les vieux clients s’y sentent chez eux.' },
  { id: 'openspace', name: 'Open space', cost: 250_000, prestige: 2, effect: 'Progression des compétences +25 %', blurb: 'Bureaux blancs, plantes, tout le monde s’entend : on apprend vite.' },
  { id: 'bunker', name: 'Salle blindée', cost: 600_000, prestige: 0, effect: 'Erreurs des gérants d’actifs −35 %', blurb: 'Lumière tamisée, murs d’écrans, procédures strictes. Rien ne passe entre les mailles.' },
  { id: 'verriere', name: 'Verrière', cost: 900_000, prestige: 10, effect: 'Prestige maximal, clients impressionnés', blurb: 'Atrium de verre, marbre, vue panoramique. On y signe les grands contrats.' },
];

/** Échelle du coût de réaménagement selon la taille des locaux. */
export const STYLE_SCALE: Record<OfficeTier, number> = { 0: 1, 1: 2.5, 2: 6, 3: 14 };

export interface ItemDef {
  id: PrestigeItemId;
  name: string;
  icon: string;
  minTier: OfficeTier;
  cost: number;
  monthly: number;
  prestige: number;
  /** Part du prix récupérable à la revente (œuvre d'art) ; 0 pour un aménagement. */
  resale: number;
  effect: string;
}

export const ITEMS: ItemDef[] = [
  { id: 'trophees', name: 'Maquettes de navires et trophées', icon: '🚢', minTier: 0, cost: 120_000, monthly: 0, prestige: 3, resale: 0, effect: 'Prestige +3' },
  { id: 'mur', name: 'Mur d’écrans de marché', icon: '📺', minTier: 0, cost: 450_000, monthly: 0, prestige: 3, resale: 0, effect: 'Prestige +3, erreurs des gérants −10 %' },
  { id: 'reception', name: 'Salon de réception', icon: '🥂', minTier: 0, cost: 600_000, monthly: 0, prestige: 4, resale: 0, effect: 'Invitations au siège ×1,5' },
  { id: 'bienetre', name: 'Cantine et salle de sport', icon: '🏋️', minTier: 1, cost: 900_000, monthly: 18_000, prestige: 3, resale: 0, effect: 'Candidats −10 % de salaire, plus de candidatures' },
  { id: 'academie', name: 'Académie interne', icon: '🎓', minTier: 1, cost: 1_200_000, monthly: 25_000, prestige: 4, resale: 0, effect: 'Compétences +20 %, gérants +0,4 pt/mois' },
  { id: 'art', name: 'Œuvre d’art majeure', icon: '🖼️', minTier: 1, cost: 2_500_000, monthly: 0, prestige: 10, resale: 0.75, effect: 'Prestige +10, revendable (75 % après frais d’enchères)' },
  { id: 'heliport', name: 'Héliport', icon: '🚁', minTier: 2, cost: 3_500_000, monthly: 0, prestige: 6, resale: 0, effect: 'Vols au départ du siège : 1 h de moins, arrivée parfois un jour plus tôt' },
  { id: 'auditorium', name: 'Auditorium et conférence annuelle', icon: '🎤', minTier: 3, cost: 8_000_000, monthly: 0, prestige: 10, resale: 0, effect: 'Conférence en janvier : confiance +4 avec tous les contacts' },
];

export const ITEM_BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i])) as Record<PrestigeItemId, ItemDef>;
export const STYLE_BY_ID = Object.fromEntries(STYLES.map((s) => [s.id, s])) as Record<FloorStyle, StyleDef>;

/** Taux de capitalisation (loyer annuel / valeur) des bureaux de premier ordre, retenu pour le prix d'achat. */
export const OFFICE_CAP_RATE = 0.06;
/** Charges du propriétaire (entretien, taxe foncière, assurance), en % de la valeur par an. */
export const OWNER_COSTS_PA = 0.012;
/** Amortissement de l'immeuble : 60 % de la valeur (le bâti) sur 40 ans ; le terrain ne s'amortit pas. */
export const BUILDING_DEPRECIATION_PA = 0.6 / 40;
/** Frais de transaction immobilière à la revente. */
export const PROPERTY_SALE_COST = 0.03;
/** Durée d'amortissement des agencements (mois), alignée sur un bail commercial type. */
export const FIT_OUT_MONTHS = 60;
/** Postes occupés en permanence par l'équipe de trading de base. */
export const BASE_SEATS = 3;
/** Postes en débordement : espace de coworking loué au mois, par poste. */
export const OVERFLOW_SEAT_MONTHLY = 6_000;
/** Accueil d'un contact au siège (repas, transport du visiteur). */
export const INVITE_COST = 4_000;
/** Coût de la conférence annuelle (auditorium). */
export const CONFERENCE_COST = 600_000;
