import type { AdvisorId } from '../engine/types';

/** Conseillers (personnages originaux). Chacun a un biais : ils se contredisent et peuvent se tromper. */
export interface AdvisorDef {
  id: AdvisorId;
  name: string;
  role: string;
  color: string;
  skin: string;
  hair: string;
  tagline: string;
  bias: string;
}

export const ADVISORS: AdvisorDef[] = [
  { id: 'risk', name: 'Margot Keller', role: 'Risk manager', color: '#60a5fa', skin: '#f1c7a5', hair: '#7c4a2d', tagline: 'Le cash d’abord, l’ego ensuite.', bias: 'Prudente jusqu’à l’excès : elle vous fera rater des opportunités, mais elle vous garde en vie.' },
  { id: 'trader', name: 'Dex Okafor', role: 'Trader senior', color: '#f87171', skin: '#8d5a3b', hair: '#1f1a17', tagline: 'Qui ne risque rien n’a rien.', bias: 'Agressif et sûr de lui. Ses paris directionnels ne valent pas mieux qu’un pile ou face : surveillez son palmarès.' },
  { id: 'analyst', name: 'Kenji Watanabe', role: 'Analyste', color: '#a78bfa', skin: '#f3d2b3', hair: '#111827', tagline: 'La courbe dit tout, il suffit de l’écouter.', bias: 'Geek des structures de courbe et de la vol. Ses analyses de portage sont solides, ses prévisions de prix inexistantes.' },
  { id: 'ops', name: 'Rosa Lindqvist', role: 'Opérations', color: '#34d399', skin: '#f6d5c3', hair: '#e8b04c', tagline: 'Un bateau ne attend pas.', bias: 'Pragmatique : livraisons, échéances, stockage. Rarement spectaculaire, jamais inutile.' },
  { id: 'legal', name: 'Anselme Brun', role: 'Juriste', color: '#fbbf24', skin: '#e9c09c', hair: '#9ca3af', tagline: 'Avez-vous lu l’article 22.3 ?', bias: 'Anxieux : il voit des risques juridiques partout. Il a souvent raison, mais pas toujours au bon moment.' },
];

export const ADVISOR_BY_ID: Record<AdvisorId, AdvisorDef> = Object.fromEntries(ADVISORS.map((a) => [a.id, a])) as Record<AdvisorId, AdvisorDef>;
