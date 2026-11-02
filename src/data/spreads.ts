/**
 * Phase 8 — Spreads entre commodités (marges de transformation et arbitrages), base des options sur spread
 * et du suivi de marché. Payoff : a1·F1 − a2·F2 − K, dans la devise commune (pas de spread entre devises).
 */
import type { CommodityId } from '../engine/types';

export interface SpreadDef {
  id: string;
  label: string;
  c1: CommodityId;
  c2: CommodityId;
  a1: number;
  a2: number;
  unit: string;
  term: string; // entrée du codex
  blurb: string;
}

export const SPREADS: SpreadDef[] = [
  { id: 'crack_go', label: 'Crack gazole', c1: 'GASOIL', c2: 'BRENT', a1: 1 / 7.45, a2: 1, unit: '$/bbl', term: 'crack', blurb: 'Marge du raffineur sur le diesel : gazole ($/t, 7,45 bbl/t) moins Brent.' },
  { id: 'crack_gl', label: 'Crack essence', c1: 'GASOLINE', c2: 'BRENT', a1: 1 / 8.45, a2: 1, unit: '$/bbl', term: 'crack', blurb: 'Essence Eurobob (8,45 bbl/t) moins Brent : très saisonnier.' },
  { id: 'crack_jet', label: 'Crack kérosène', c1: 'JET', c2: 'BRENT', a1: 1 / 7.88, a2: 1, unit: '$/bbl', term: 'crack', blurb: 'Kérosène (7,88 bbl/t) moins Brent.' },
  { id: 'crack_fo', label: 'Crack fioul lourd', c1: 'FUELOIL', c2: 'BRENT', a1: 1 / 6.35, a2: 1, unit: '$/bbl', term: 'crack', blurb: 'Fioul 3,5 % (6,35 bbl/t) moins Brent : souvent négatif.' },
  { id: 'wti_brent', label: 'WTI − Brent', c1: 'WTI', c2: 'BRENT', a1: 1, a2: 1, unit: '$/bbl', term: 'arbitrage', blurb: 'Arbitrage transatlantique : coût d’export du brut américain.' },
  { id: 'brent_dubai', label: 'Brent − Dubaï', c1: 'BRENT', c2: 'DUBAI', a1: 1, a2: 1, unit: '$/bbl', term: 'quality', blurb: 'Prime du brut léger et peu soufré sur le brut moyen soufré.' },
  { id: 'spark_de', label: 'Spark spread (Allemagne)', c1: 'POWER', c2: 'TTF', a1: 1, a2: 2, unit: '€/MWh', term: 'spark', blurb: 'Marge d’une centrale à gaz de 50 % de rendement : électricité − 2 × gaz (hors carbone).' },
  { id: 'jkm_hh', label: 'Arbitrage GNL (JKM − Henry Hub)', c1: 'JKM', c2: 'HH', a1: 1, a2: 1.15, unit: '$/MMBtu', term: 'arbitrage', blurb: 'GNL livré en Asie moins le gaz américain majoré de 15 % (contrats de liquéfaction).' },
  { id: 'wheat_corn', label: 'Blé − maïs', c1: 'WHEAT', c2: 'CORN', a1: 1, a2: 1, unit: 'c/bu', term: 'arbitrage', blurb: 'Substitution en alimentation animale : quand l’écart est trop large, le blé remplace le maïs.' },
];

export const SPREAD_BY_ID = Object.fromEntries(SPREADS.map((s) => [s.id, s])) as Record<string, SpreadDef>;
