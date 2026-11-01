/**
 * Store UI (Zustand). L'état de jeu est un objet muté par le moteur ; `rev` est incrémenté après
 * chaque mutation pour re-rendre les composants.
 */
import { create } from 'zustand';
import { COMMODITIES } from '../data/commodities';
import { listedMonths } from '../engine/contracts';
import { advanceDay, consumeAlerts, createGame, dispatch } from '../engine/game';
import type { Action, ActionResult, CommodityId, GameConfig, GameState } from '../engine/types';
import { saveGame } from '../save/saveStore';
import { sfx } from './sound';

export type PanelId = 'market' | 'physical' | 'book' | 'treasury' | 'travel' | 'codex' | 'options' | 'risk';
export type Speed = 0 | 1 | 2 | 5;

export interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'info' | 'alert';
}

export interface Modal {
  kind: 'margin_call' | 'bankrupt' | 'ended' | 'major_news' | 'liquidation' | 'limit';
  text: string;
}

/** Horloge partagée hors React (lue par le globe à chaque frame). */
export const clock = { dayFrac: 0 };

export const DAY_SECONDS: Record<Exclude<Speed, 0>, number> = { 1: 3.2, 2: 1.6, 5: 0.6 };

interface UIState {
  game: GameState | null;
  rev: number;
  speed: Speed;
  panel: PanelId | null;
  commodity: CommodityId;
  month: number | null;
  selectedCity: string | null;
  toasts: Toast[];
  modal: Modal | null;
  codexSeen: string[];
  codexFocus: string | null;
  newGame: (cfg: Partial<GameConfig>) => void;
  loadState: (s: GameState) => void;
  quit: () => void;
  act: (a: Action, quiet?: boolean) => ActionResult;
  step: () => void;
  setSpeed: (s: Speed) => void;
  setPanel: (p: PanelId | null, force?: boolean) => void;
  selectCommodity: (c: CommodityId, month?: number | null) => void;
  selectCity: (id: string | null) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  closeModal: () => void;
  seeTerm: (id: string) => void;
  openCodex: (id: string) => void;
}

let toastId = 1;
const loadSeen = (): string[] => {
  try {
    return JSON.parse(localStorage.getItem('tw-codex') ?? '[]') as string[];
  } catch {
    return [];
  }
};

export const useStore = create<UIState>((set, get) => ({
  game: null,
  rev: 0,
  speed: 0,
  panel: 'market',
  commodity: 'BRENT',
  month: null,
  selectedCity: null,
  toasts: [],
  modal: null,
  codexSeen: loadSeen(),
  codexFocus: null,

  newGame: (cfg) => {
    const g = createGame(cfg);
    consumeAlerts(g);
    set({ game: g, rev: 0, speed: 0, panel: 'market', modal: null, month: listedMonths(COMMODITIES.BRENT, g.day)[0]!, commodity: 'BRENT', selectedCity: null });
  },
  loadState: (s) => set({ game: s, rev: get().rev + 1, speed: 0, modal: null, month: listedMonths(COMMODITIES[get().commodity], s.day)[0]! }),
  quit: () => set({ game: null, speed: 0, modal: null }),

  act: (a, quiet) => {
    const g = get().game;
    if (!g) return { ok: false, message: 'Pas de partie' };
    const r = dispatch(g, a);
    set({ rev: get().rev + 1 });
    if (!quiet) get().toast(r.message, r.ok ? 'good' : 'bad');
    if (r.ok) {
      if (a.type === 'TRADE_FUTURE') sfx.trade();
      else if (a.type === 'ACCEPT_OFFER' || a.type === 'SPOT_BUY' || a.type === 'SPOT_SELL') sfx.deal();
      else if (a.type === 'TRAVEL') sfx.takeoff();
    } else sfx.error();
    return r;
  },

  step: () => {
    const g = get().game;
    if (!g || g.status !== 'running') return;
    advanceDay(g);
    const alerts = consumeAlerts(g);
    let modal: Modal | null = get().modal;
    let pause = false;
    for (const al of alerts) {
      if (al.kind === 'delivery' || al.kind === 'limit_ok') get().toast(al.text, 'info');
      else if (al.kind === 'advice') continue;
      else if (al.kind === 'limit') {
        sfx.alarm();
        get().toast(`⚠️ ${al.text}`, 'bad');
        modal ??= { kind: 'limit', text: al.text };
        pause = true;
      }
      else if (al.kind === 'major_news') {
        sfx.news();
        get().toast(`📰 ${al.text}`, 'alert');
        modal ??= { kind: 'major_news', text: al.text };
        pause = true;
      } else {
        sfx.alarm();
        modal = { kind: al.kind, text: al.text };
        pause = true;
      }
    }
    // Les échéances expirées disparaissent : on garde une sélection valide.
    const months = listedMonths(COMMODITIES[get().commodity], g.day);
    const month = get().month !== null && months.includes(get().month!) ? get().month : months[0]!;
    set({ rev: get().rev + 1, modal, month, speed: pause ? 0 : get().speed });
    if (g.history.length % 20 === 0) void saveGame('auto', g).catch(() => undefined);
  },

  setSpeed: (s) => set({ speed: s }),
  setPanel: (p, force) => set({ panel: !force && get().panel === p ? null : p }),
  selectCommodity: (c, month) => {
    const g = get().game;
    const months = g ? listedMonths(COMMODITIES[c], g.day) : [];
    set({ commodity: c, month: month ?? months[0] ?? null });
  },
  selectCity: (id) => set({ selectedCity: id, panel: id ? 'travel' : get().panel }),
  toast: (text, tone = 'info') => {
    const t = { id: toastId++, text, tone };
    set({ toasts: [...get().toasts.slice(-3), t] });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== t.id) }), 4200);
  },
  closeModal: () => set({ modal: null }),
  seeTerm: (id) => {
    if (get().codexSeen.includes(id)) return;
    const seen = [...get().codexSeen, id];
    try {
      localStorage.setItem('tw-codex', JSON.stringify(seen));
    } catch {
      /* stockage indisponible */
    }
    set({ codexSeen: seen });
  },
  openCodex: (id) => {
    get().seeTerm(id);
    set({ panel: 'codex', codexFocus: id });
  },
}));
