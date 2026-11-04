/**
 * Préférences du joueur (navigateur) : taille de l'interface, mode simplifié, langue.
 * Elles ne touchent pas à la partie : seulement à la présentation. Stockage protégé (navigation privée, etc.).
 */
import { create } from 'zustand';

export type Lang = 'fr' | 'en';
export type UiScale = 'auto' | 0.8 | 0.9 | 1 | 1.1 | 1.25;

export interface Settings {
  uiScale: UiScale;
  /** mode simplifié : moins de chiffres et d'alertes, les détails restent accessibles au survol ou au clic */
  simplified: boolean;
  lang: Lang;
}

const KEY = 'tradewinds.settings';
const DEFAULTS: Settings = { uiScale: 'auto', simplified: false, lang: (typeof navigator !== 'undefined' && !navigator.language?.startsWith('fr') ? 'en' : 'fr') };

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

interface SettingsStore extends Settings {
  set: (p: Partial<Settings>) => void;
  open: boolean;
  setOpen: (o: boolean) => void;
}

export const useSettings = create<SettingsStore>((set, get) => ({
  ...load(),
  open: false,
  setOpen: (open) => set({ open }),
  set: (p) => {
    set(p);
    const { uiScale, simplified, lang } = get();
    try { localStorage.setItem(KEY, JSON.stringify({ uiScale, simplified, lang })); } catch { /* stockage indisponible */ }
  },
}));

/**
 * Facteur d'échelle effectif : en automatique, l'interface est conçue pour 1440 × 880 et se réduit sur un écran plus
 * petit (sans descendre sous 0,62), pour que dock, bandeau et panneaux ne se chevauchent pas.
 */
export function effectiveScale(s: UiScale, w = window.innerWidth, h = window.innerHeight): number {
  const auto = Math.max(0.62, Math.min(1, w / 1440, h / 880));
  return s === 'auto' ? auto : Math.min(s, Math.max(0.62, Math.min(w / 1100, h / 680)) * s);
}
