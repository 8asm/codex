/**
 * Marchés du fret : quatre indices de taux d'affrètement à temps (time-charter equivalent, $/jour),
 * calqués sur les indices réels (Capesize 5TC, Panamax, Supramax, Aframax), et caractéristiques des navires.
 */
import type { FreightIndex } from '../engine/types';
export type { FreightIndex };

export interface FreightSpec {
  id: FreightIndex;
  name: string;
  vessel: string;
  mean: number; // TCE moyen de long terme ($/jour)
  kappa: number; // retour à la moyenne (1/an)
  sigma: number; // vol annuelle (le fret est très volatil)
  capacityT: number; // capacité de cargaison (tonnes)
  speed: number; // nœuds en charge
  consumption: number; // t de soute par jour en mer
  portCost: number; // frais portuaires par escale ($)
  opexPerDay: number; // coût d'exploitation d'un navire possédé ($/jour)
  newbuild: number; // prix d'un navire neuf (USD)
  color: string;
}

export const FREIGHT: Record<FreightIndex, FreightSpec> = {
  CAPE: { id: 'CAPE', name: 'Capesize', vessel: 'vraquier Capesize', mean: 22_000, kappa: 2.5, sigma: 0.75, capacityT: 170_000, speed: 12.5, consumption: 38, portCost: 180_000, opexPerDay: 7_500, newbuild: 62e6, color: '#a3a3a3' },
  PMX: { id: 'PMX', name: 'Panamax', vessel: 'vraquier Panamax', mean: 14_000, kappa: 2.5, sigma: 0.6, capacityT: 75_000, speed: 13, consumption: 30, portCost: 120_000, opexPerDay: 6_200, newbuild: 34e6, color: '#78716c' },
  SMX: { id: 'SMX', name: 'Supramax', vessel: 'vraquier Supramax', mean: 13_000, kappa: 2.5, sigma: 0.55, capacityT: 58_000, speed: 13, consumption: 26, portCost: 100_000, opexPerDay: 5_800, newbuild: 30e6, color: '#57534e' },
  LNGC: { id: 'LNGC', name: 'Méthanier', vessel: 'méthanier 174 000 m³', mean: 80_000, kappa: 2, sigma: 0.9, capacityT: 75_000, speed: 18, consumption: 110, portCost: 220_000, opexPerDay: 16_000, newbuild: 230e6, color: '#0ea5e9' },
  AFRA: { id: 'AFRA', name: 'Aframax', vessel: 'pétrolier Aframax', mean: 32_000, kappa: 2, sigma: 0.65, capacityT: 82_000, speed: 13.5, consumption: 40, portCost: 150_000, opexPerDay: 9_000, newbuild: 64e6, color: '#b91c1c' },
};

export const FREIGHT_IDS: FreightIndex[] = ['CAPE', 'PMX', 'SMX', 'AFRA', 'LNGC'];

/** Prix des soutes (fioul marin) en $/t, indexé sur le Brent ($/bbl). */
export const BUNKER_PER_BRENT = 7.4;
/** Jours d'escale (chargement + déchargement) inclus dans un voyage, et temps de planche autorisé avant surestaries. */
export const PORT_DAYS = 4;
export const LAYTIME_DAYS = 2;
/** Le navire doit revenir (ou repositionner) à vide : on paie ~60 % du trajet en plus. */
export const BALLAST_FACTOR = 0.6;
