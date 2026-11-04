/**
 * Partie en ligne (2 à 4 joueurs) : couche réseau et contrôleur.
 *
 * Pas de serveur de jeu : l'hôte est un joueur. Les navigateurs se relient en pair-à-pair (WebRTC, via PeerJS ; le
 * service public de PeerJS ne sert qu'à la mise en relation). Code de partie à 6 caractères, sans mot de passe.
 *
 * Protocole (lockstep déterministe, voir engine/multiplayer.ts) :
 *  - salon : chaque joueur choisit une société existante (et un rôle : PDG ou trader) ou crée la sienne ;
 *  - au lancement, l'hôte envoie la configuration : chacun crée exactement la même partie ;
 *  - un joueur envoie ses actions à l'hôte ; l'hôte les numérote et les renvoie à tous (y compris à lui-même) ;
 *  - le temps avance quand l'hôte envoie une trame « jour suivant » ;
 *  - tous les 25 jours, l'hôte diffuse une empreinte de l'état ; en cas d'écart, le joueur demande un instantané.
 */
import { create } from 'zustand';
import type Peer from 'peerjs';
import type { DataConnection } from 'peerjs';
import { applyFrame, checksum, createMultiGame, restore, snapshot, type Frame, type MpPlayer, type MpRole, type MpSetup } from '../engine/multiplayer';
import type { Action, GameState } from '../engine/types';

type Msg =
  | { t: 'hello'; name: string }
  | { t: 'lobby'; players: MpPlayer[]; setup: MpSetup; code: string }
  | { t: 'claim'; company: number | 'new'; role: MpRole; hqCity?: string; companyName?: string }
  | { t: 'start'; setup: MpSetup; players: MpPlayer[] }
  | { t: 'snapshot'; json: string; seq: number; players: MpPlayer[]; setup: MpSetup }
  | { t: 'action'; action: Action; quiet?: boolean }
  | { t: 'frame'; frame: Frame; quiet?: boolean }
  | { t: 'hash'; seq: number; h: string }
  | { t: 'resync' }
  | { t: 'chat'; from: string; text: string }
  | { t: 'kick'; reason: string };

const PREFIX = 'tradewinds-v1-';
const COLORS = ['#ffb703', '#38bdf8', '#f472b6', '#4ade80'];
export const MAX_PLAYERS = 4;

function makeCode() {
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += A[Math.floor(Math.random() * A.length)];
  return s;
}

interface MpStore {
  active: boolean; // partie en ligne lancée
  phase: 'idle' | 'connecting' | 'lobby' | 'playing' | 'error';
  isHost: boolean;
  code: string;
  me: string;
  myName: string;
  players: MpPlayer[];
  setup: MpSetup | null;
  states: GameState[];
  seq: number;
  error: string;
  chat: { from: string; text: string }[];
  host: (name: string, setup: MpSetup) => Promise<void>;
  join: (code: string, name: string) => Promise<void>;
  claim: (company: number | 'new', role: MpRole, hqCity?: string, companyName?: string) => void;
  updateSetup: (p: Partial<MpSetup['config']>) => void;
  start: () => void;
  sendAction: (a: Action, quiet?: boolean) => void;
  tick: () => void;
  say: (text: string) => void;
  leave: () => void;
}

let peer: Peer | null = null;
const conns = new Map<string, DataConnection>(); // côté hôte : un lien par joueur ; côté joueur : le lien vers l'hôte
let hooks: { onFrame?: (f: Frame, result: { ok: boolean; message: string } | null, mine: boolean, quiet?: boolean) => void; onStart?: (states: GameState[], myCompany: number) => void } = {};

export function setMpHooks(h: typeof hooks) {
  hooks = h;
}

async function loadPeer(): Promise<typeof Peer> {
  const mod = await import('peerjs');
  return mod.default ?? (mod as unknown as { Peer: typeof Peer }).Peer;
}

export const useMp = create<MpStore>((set, get) => {
  const roles = () => Object.fromEntries(get().players.map((p) => [p.id, p.role]));
  const myCompany = () => get().players.find((p) => p.id === get().me)?.company ?? 0;

  const broadcast = (m: Msg) => { for (const c of conns.values()) if (c.open) c.send(m); };
  const sendHost = (m: Msg) => { for (const c of conns.values()) if (c.open) c.send(m); };

  /** Applique une trame localement (tous les navigateurs font exactement la même chose). */
  const apply = (f: Frame, quiet?: boolean) => {
    const st = get();
    if (f.seq !== st.seq + 1) {
      // trame manquante : on demande l'état complet à l'hôte
      if (!st.isHost) sendHost({ t: 'resync' });
      return;
    }
    const r = applyFrame(st.states, f, roles());
    set({ seq: f.seq });
    hooks.onFrame?.(f, r, f.kind === 'action' && f.player === st.me, quiet);
  };

  const hostHandle = (from: string, m: Msg) => {
    const st = get();
    if (m.t === 'hello') {
      if (st.players.length >= MAX_PLAYERS) { conns.get(from)?.send({ t: 'kick', reason: 'Partie complète (4 joueurs).' } satisfies Msg); return; }
      const players = [...st.players.filter((p) => p.id !== from), { id: from, name: m.name.slice(0, 24) || 'Joueur', company: 0, role: 'trader' as MpRole, color: COLORS[st.players.length % 4]! }];
      set({ players });
      if (st.phase === 'playing') {
        // rejoindre une partie en cours : instantané de toutes les sociétés
        conns.get(from)?.send({ t: 'snapshot', json: snapshot(st.states), seq: st.seq, players, setup: st.setup! } satisfies Msg);
        broadcast({ t: 'lobby', players, setup: st.setup!, code: st.code });
      } else broadcast({ t: 'lobby', players, setup: st.setup!, code: st.code });
    } else if (m.t === 'claim') {
      if (st.phase !== 'lobby') return;
      let setup = st.setup!;
      let company = m.company;
      if (company === 'new') {
        if (setup.companies.length >= MAX_PLAYERS) return;
        setup = { ...setup, companies: [...setup.companies, { name: m.companyName || `Maison de ${st.players.find((p) => p.id === from)?.name ?? 'joueur'}`, hqCity: m.hqCity || 'geneva', capital: setup.companies[0]!.capital }] };
        company = setup.companies.length - 1;
      }
      const players = st.players.map((p) => (p.id === from ? { ...p, company: company as number, role: m.role } : p));
      // une société sans joueur disparaît (sauf la première)
      const used = new Set(players.map((p) => p.company));
      if (setup.companies.some((_, k) => k > 0 && !used.has(k))) {
        const keep = setup.companies.map((_, k) => k).filter((k) => k === 0 || used.has(k));
        const remap = new Map(keep.map((k, i) => [k, i]));
        setup = { ...setup, companies: keep.map((k) => setup.companies[k]!) };
        for (const p of players) p.company = remap.get(p.company) ?? 0;
      }
      set({ players, setup });
      broadcast({ t: 'lobby', players, setup, code: st.code });
    } else if (m.t === 'action') {
      const p = st.players.find((x) => x.id === from);
      if (!p || st.phase !== 'playing') return;
      const frame: Frame = { seq: st.seq + 1, kind: 'action', player: from, company: p.company, action: m.action };
      apply(frame, m.quiet);
      broadcast({ t: 'frame', frame, quiet: m.quiet });
    } else if (m.t === 'resync') {
      conns.get(from)?.send({ t: 'snapshot', json: snapshot(st.states), seq: st.seq, players: st.players, setup: st.setup! } satisfies Msg);
    } else if (m.t === 'chat') {
      const line = { from: st.players.find((p) => p.id === from)?.name ?? '?', text: m.text.slice(0, 200) };
      set({ chat: [...st.chat.slice(-40), line] });
      broadcast({ t: 'chat', ...line });
    }
  };

  const clientHandle = (m: Msg) => {
    const st = get();
    if (m.t === 'lobby') set({ players: m.players, setup: m.setup, code: m.code, phase: st.phase === 'playing' ? 'playing' : 'lobby' });
    else if (m.t === 'start') {
      const states = createMultiGame(m.setup);
      set({ setup: m.setup, players: m.players, states, seq: 0, phase: 'playing', active: true });
      hooks.onStart?.(states, myCompany());
    } else if (m.t === 'snapshot') {
      const states = restore(m.json);
      set({ setup: m.setup, players: m.players, states, seq: m.seq, phase: 'playing', active: true });
      hooks.onStart?.(states, myCompany());
    } else if (m.t === 'frame') apply(m.frame, m.quiet);
    else if (m.t === 'hash') {
      if (m.seq === st.seq && checksum(st.states) !== m.h) sendHost({ t: 'resync' });
    } else if (m.t === 'chat') set({ chat: [...st.chat.slice(-40), { from: m.from, text: m.text }] });
    else if (m.t === 'kick') set({ phase: 'error', error: m.reason });
  };

  return {
    active: false, phase: 'idle', isHost: false, code: '', me: '', myName: '', players: [], setup: null, states: [], seq: 0, error: '', chat: [],

    host: async (name, setup) => {
      const P = await loadPeer();
      const code = makeCode();
      set({ phase: 'connecting', isHost: true, code, myName: name, error: '' });
      peer = new P(PREFIX + code);
      peer.on('open', () => {
        const me = 'host';
        set({ me, phase: 'lobby', setup, players: [{ id: me, name: name || 'Hôte', company: 0, role: 'ceo', color: COLORS[0]! }] });
      });
      peer.on('connection', (c) => {
        c.on('open', () => conns.set(c.peer, c));
        c.on('data', (d) => hostHandle(c.peer, d as Msg));
        c.on('close', () => {
          conns.delete(c.peer);
          const players = get().players.filter((p) => p.id !== c.peer);
          set({ players });
          broadcast({ t: 'lobby', players, setup: get().setup!, code: get().code });
        });
      });
      peer.on('error', (e) => set({ phase: 'error', error: `Réseau : ${String((e as Error).message ?? e)}` }));
    },

    join: async (code, name) => {
      const P = await loadPeer();
      set({ phase: 'connecting', isHost: false, code: code.toUpperCase(), myName: name, error: '' });
      peer = new P();
      peer.on('open', (id) => {
        set({ me: id });
        const c = peer!.connect(PREFIX + code.toUpperCase(), { reliable: true, serialization: 'json' });
        c.on('open', () => { conns.set('host', c); c.send({ t: 'hello', name } satisfies Msg); });
        c.on('data', (d) => clientHandle(d as Msg));
        c.on('close', () => set({ phase: 'error', error: 'L’hôte a quitté la partie.' }));
      });
      peer.on('error', (e) => set({ phase: 'error', error: String((e as Error).message ?? e).includes('Could not connect') ? 'Code inconnu : vérifiez-le auprès de l’hôte.' : `Réseau : ${String((e as Error).message ?? e)}` }));
    },

    claim: (company, role, hqCity, companyName) => {
      const st = get();
      if (st.isHost) hostHandle('host', { t: 'claim', company, role, hqCity, companyName });
      else sendHost({ t: 'claim', company, role, hqCity, companyName });
    },

    updateSetup: (p) => {
      const st = get();
      if (!st.isHost || !st.setup) return;
      const setup = { ...st.setup, config: { ...st.setup.config, ...p } };
      set({ setup });
      broadcast({ t: 'lobby', players: st.players, setup, code: st.code });
    },

    start: () => {
      const st = get();
      if (!st.isHost || !st.setup) return;
      const states = createMultiGame(st.setup);
      set({ states, seq: 0, phase: 'playing', active: true });
      broadcast({ t: 'start', setup: st.setup, players: st.players });
      hooks.onStart?.(states, myCompany());
    },

    sendAction: (a, quiet) => {
      const st = get();
      if (st.isHost) hostHandle('host', { t: 'action', action: a, quiet });
      else sendHost({ t: 'action', action: a, quiet });
    },

    tick: () => {
      const st = get();
      if (!st.isHost || st.phase !== 'playing') return;
      const frame: Frame = { seq: st.seq + 1, kind: 'tick' };
      apply(frame);
      broadcast({ t: 'frame', frame });
      if (frame.seq % 25 === 0) broadcast({ t: 'hash', seq: frame.seq, h: checksum(get().states) });
    },

    say: (text) => {
      const st = get();
      if (st.isHost) hostHandle('host', { t: 'chat', from: st.myName, text });
      else sendHost({ t: 'chat', from: st.myName, text });
    },

    leave: () => {
      for (const c of conns.values()) c.close();
      conns.clear();
      peer?.destroy();
      peer = null;
      set({ active: false, phase: 'idle', isHost: false, code: '', players: [], setup: null, states: [], seq: 0, chat: [] });
    },
  };
});

export function myCompanyIndex(): number {
  const st = useMp.getState();
  return st.players.find((p) => p.id === st.me)?.company ?? 0;
}
