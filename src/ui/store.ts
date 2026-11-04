/**
 * Store UI (Zustand). L'état de jeu est un objet muté par le moteur ; `rev` est incrémenté après
 * chaque mutation pour re-rendre les composants.
 */
import { setMpHooks, useMp } from './mp';
import { create } from 'zustand';
import { COMMODITIES } from '../data/commodities';
import { listedMonths } from '../engine/contracts';
import { advanceDay, consumeAlerts, createGame, dispatch } from '../engine/game';
import type { Action, ActionResult, CommodityId, GameConfig, GameState } from '../engine/types';
import { saveGame } from '../save/saveStore';
import { sfx } from './sound';

export type PanelId = 'market' | 'physical' | 'book' | 'treasury' | 'travel' | 'codex' | 'options' | 'risk' | 'news' | 'world' | 'rivals' | 'logistics' | 'assets' | 'automation' | 'career' | 'offices' | 'exotics' | 'finance' | 'compliance' | 'game' | 'staff' | 'lessons' | 'government';
export type LayerId = 'tension' | 'sanctions' | 'meteo' | 'prix' | 'rivals' | 'routes' | 'stocks';
export type Speed = 0 | 1 | 2 | 5;

export interface Toast {
  id: number;
  text: string;
  tone: 'good' | 'bad' | 'info' | 'alert';
}

export interface Modal {
  kind: 'margin_call' | 'bankrupt' | 'ended' | 'major_news' | 'liquidation' | 'limit' | 'career' | 'scenario';
  text: string;
}

/** Horloge partagée hors React (lue par le globe à chaque frame). */
export const clock = { dayFrac: 0 };

export const DAY_SECONDS: Record<Exclude<Speed, 0>, number> = { 1: 8, 2: 3.5, 5: 1.2 }; // secondes réelles par jour de jeu

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
  layers: Record<LayerId, boolean>;
  toggleLayer: (l: LayerId) => void;
  companyFocus: string | null;
  focusCompany: (id: string | null) => void;
  newGame: (cfg: Partial<GameConfig>) => void;
  loadState: (s: GameState) => void;
  quit: () => void;
  act: (a: Action, quiet?: boolean) => ActionResult;
  step: () => void;
  /** traitement des alertes d'une journée écoulée (jeu solo ou trame reçue en ligne) */
  afterDay: () => void;
  setSpeed: (s: Speed) => void;
  setPanel: (p: PanelId | null, force?: boolean) => void;
  selectCommodity: (c: CommodityId, month?: number | null) => void;
  selectCity: (id: string | null) => void;
  toast: (text: string, tone?: Toast['tone']) => void;
  closeModal: () => void;
  seeTerm: (id: string) => void;
  openCodex: (id: string) => void;
  /** Vue ville : ville affichée et phase de la transition globe ↔ ville. */
  cityView: string | null;
  cityPhase: null | 'diving' | 'city' | 'leaving' | 'rising';
  interior: boolean;
  requestCity: (id: string) => void;
  cityReady: () => void;
  exitCity: () => void;
  cityGone: () => void;
  setInterior: (on: boolean) => void;
}

let toastId = 1;

/** Collection de succès persistante entre les parties (navigateur). */
export function loadCollection(): string[] {
  try {
    return JSON.parse(localStorage.getItem('tw-achievements') ?? '[]') as string[];
  } catch {
    return [];
  }
}

function saveToCollection(ids: string[]) {
  try {
    const cur = new Set(loadCollection());
    for (const id of ids) cur.add(id);
    localStorage.setItem('tw-achievements', JSON.stringify([...cur]));
  } catch {
    /* stockage indisponible */
  }
}
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
  layers: { tension: false, sanctions: false, meteo: true, prix: false, rivals: true, routes: false, stocks: false },
  toggleLayer: (l) => {
    const cur = get().layers;
    // tensions et sanctions partagent le même calque coloré : exclusifs
    const next = { ...cur, [l]: !cur[l] };
    if (l === 'tension' && next.tension) next.sanctions = false;
    if (l === 'sanctions' && next.sanctions) next.tension = false;
    set({ layers: next });
  },
  companyFocus: null,
  focusCompany: (id) => set({ companyFocus: id, panel: id ? 'rivals' : get().panel }),

  newGame: (cfg) => {
    const g = createGame(cfg);
    const intro = consumeAlerts(g).find((a) => a.kind === 'scenario');
    set({ game: g, rev: 0, speed: 0, panel: 'market', modal: intro ? { kind: 'scenario', text: intro.text } : null, month: listedMonths(COMMODITIES.BRENT, g.day)[0]!, commodity: 'BRENT', selectedCity: null });
  },
  loadState: (s) => set({ game: s, rev: get().rev + 1, speed: 0, modal: null, month: listedMonths(COMMODITIES[get().commodity], s.day)[0]! }),
  quit: () => { if (useMp.getState().active) useMp.getState().leave(); set({ game: null, speed: 0, modal: null, cityView: null, cityPhase: null, interior: false }); },

  act: (a, quiet) => {
    const g = get().game;
    if (!g) return { ok: false, message: 'Pas de partie' };
    // partie en ligne : l'action part chez l'hôte, qui l'ordonne et la renvoie à tous ; le résultat s'affiche au retour
    const mp = useMp.getState();
    if (mp.active) {
      mp.sendAction(a, quiet);
      return { ok: true, message: '' };
    }
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
    if (!g) return;
    // partie en ligne : seul l'hôte fait avancer le temps (trame « jour suivant » diffusée à tous)
    const mp = useMp.getState();
    if (mp.active) {
      if (mp.isHost) mp.tick();
      return;
    }
    if (g.status !== 'running') return;
    advanceDay(g);
    get().afterDay();
  },
  afterDay: () => {
    const g = get().game;
    if (!g) return;
    const alerts = consumeAlerts(g);
    let modal: Modal | null = get().modal;
    let pause = false;
    for (const al of alerts) {
      if (al.kind === 'delivery' || al.kind === 'limit_ok') get().toast(al.text, 'info');
      else if (al.kind === 'situation') {
        sfx.advisor();
        get().toast(`📩 ${al.text}`, 'alert');
        pause = true;
      } else if (al.kind === 'career') {
        sfx.news();
        modal ??= { kind: 'career', text: al.text };
        pause = true;
      }
      else if (al.kind === 'advice') continue;
      else if (al.kind === 'achievement') {
        sfx.deal();
        get().toast(al.text, 'good');
        saveToCollection(g.achievements.map((a) => a.id));
      }
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
      } else if (al.kind === 'margin_call' || al.kind === 'bankrupt' || al.kind === 'ended' || al.kind === 'liquidation') {
        sfx.alarm();
        modal = { kind: al.kind, text: al.text };
        pause = true;
      }
    }
    // Les échéances expirées disparaissent : on garde une sélection valide.
    const months = listedMonths(COMMODITIES[get().commodity], g.day);
    const month = get().month !== null && months.includes(get().month!) ? get().month : months[0]!;
    set({ rev: get().rev + 1, modal, month, speed: pause ? 0 : get().speed });
    if (g.history.length % 20 === 0 && !useMp.getState().active) void saveGame('auto', g).catch(() => undefined);
  },

  setSpeed: (s) => {
    const mp = useMp.getState();
    if (mp.active && !mp.isHost) { get().toast('En ligne, c’est l’hôte qui règle le temps.', 'info'); return; }
    set({ speed: s });
  },
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
  cityView: null,
  cityPhase: null,
  interior: false,
  requestCity: (id) => {
    if (get().cityPhase) return;
    set({ cityView: id, cityPhase: 'diving', interior: false });
  },
  cityReady: () => set({ cityPhase: 'city' }),
  exitCity: () => {
    if (get().cityPhase === 'city') set({ cityPhase: 'leaving', interior: false });
  },
  cityGone: () => set({ cityPhase: 'rising' }),
  setInterior: (on) => set({ interior: on }),
}));

// Accès de débogage (serveur de développement uniquement) : scripts de capture et console.
if (import.meta.env.DEV) (window as unknown as { __tw: typeof useStore }).__tw = useStore;

// ---------------------------------------------------------------- partie en ligne : raccordement au contrôleur réseau
setMpHooks({
  onStart: (states, myCompany) => {
    const g = states[myCompany] ?? states[0]!;
    consumeAlerts(g);
    useStore.setState({ game: g, rev: 0, speed: 0, panel: 'market', modal: null, month: listedMonths(COMMODITIES.BRENT, g.day)[0]!, commodity: 'BRENT', selectedCity: null });
  },
  onFrame: (f, result, mine, quiet) => {
    const st = useStore.getState();
    if (f.kind === 'tick') {
      st.afterDay();
      return;
    }
    useStore.setState({ rev: st.rev + 1 });
    if (mine && result) {
      if (!quiet && result.message) st.toast(result.message, result.ok ? 'good' : 'bad');
      if (result.ok) {
        if (f.action.type === 'TRADE_FUTURE') sfx.trade();
        else if (f.action.type === 'ACCEPT_OFFER' || f.action.type === 'SPOT_BUY' || f.action.type === 'SPOT_SELL') sfx.deal();
      } else sfx.error();
    }
  },
});
