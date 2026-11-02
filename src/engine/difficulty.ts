/**
 * Niveaux de difficulté. Ils ne touchent JAMAIS au pricing (modèle, options, marges, VaR restent exacts) :
 * seulement aux frictions commerciales et aux frais fixes, c'est-à-dire au monde dans lequel le joueur opère.
 *  - débutant : les contreparties proposent en moyenne un diff favorable (+0,25 % au lieu de −0,15 %),
 *    la fourchette au comptant et le stockage réduits de moitié, les frais fixes de 70 %, les cargaisons limitées à la moitié
 *    des fonds propres ; marché plus calme ;
 *  - normal : le jeu calibré ;
 *  - expert : contreparties plus dures, frais plus lourds.
 */
import type { GameState } from './types';

export type Difficulty = 'debutant' | 'normal' | 'expert';

export const DIFFICULTY_LABEL: Record<Difficulty, string> = { debutant: 'Débutant', normal: 'Normal', expert: 'Expert' };

export const DIFFICULTY_BLURB: Record<Difficulty, string> = {
  debutant: 'Cinq marchés, cargaisons à votre taille, contreparties conciliantes, frais réduits, marché calme et visite guidée.',
  normal: 'Le jeu calibré : les contreparties défendent leurs intérêts, chaque friction compte.',
  expert: 'Contreparties coriaces, frais plus lourds, marché plus nerveux.',
};

interface Factors {
  /** biais moyen du diff proposé, en fraction du prix (positif = à l'avantage de la contrepartie) */
  offerSkew: number;
  spotSpreadMult: number;
  overheadMult: number;
  /** au moins une offre d'achat et une de vente toujours disponibles */
  guaranteedOffers: boolean;
  /** taille maximale d'une cargaison proposée, en multiple des fonds propres */
  cargoCapNav: number;
  /** multiplicateur des frais de stockage tiers */
  storageMult: number;
}

const F: Record<Difficulty, Factors> = {
  debutant: { offerSkew: -0.0025, spotSpreadMult: 0.5, overheadMult: 0.3, guaranteedOffers: true, cargoCapNav: 0.5, storageMult: 0.5 },
  normal: { offerSkew: 0.0015, spotSpreadMult: 1, overheadMult: 1, guaranteedOffers: false, cargoCapNav: 1.2, storageMult: 1 },
  expert: { offerSkew: 0.0025, spotSpreadMult: 1.2, overheadMult: 1.25, guaranteedOffers: false, cargoCapNav: 1.2, storageMult: 1.1 },
};

export function difficulty(s: Pick<GameState, 'config'>): Difficulty {
  return s.config.difficulty ?? 'normal';
}
export function factors(s: Pick<GameState, 'config'>): Factors {
  return F[difficulty(s)];
}

/** Réglages de départ conseillés par niveau (proposés à l'accueil, modifiables). */
export const DIFFICULTY_PRESET: Record<Difficulty, { volatility: number; crisisFrequency: number; markets: string }> = {
  debutant: { volatility: 0.7, crisisFrequency: 0.3, markets: 'core' },
  normal: { volatility: 1, crisisFrequency: 1, markets: 'extended' },
  expert: { volatility: 1.4, crisisFrequency: 2, markets: 'all' },
};
