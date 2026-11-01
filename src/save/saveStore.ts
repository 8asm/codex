/** Sauvegardes locales en IndexedDB + export/import JSON. Aucun backend. */
import type { GameState } from '../engine/types';
import { SAVE_VERSION } from '../engine/game';

const DB = 'tradewinds';
const STORE = 'saves';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export interface SaveMeta {
  slot: string;
  company: string;
  day: number;
  savedAt: number;
}

export async function saveGame(slot: string, state: GameState): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ meta: { slot, company: state.company.name, day: state.day, savedAt: Date.now() }, state: JSON.parse(JSON.stringify(state)) }, slot);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadGame(slot: string): Promise<GameState | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(slot);
    req.onsuccess = () => resolve(req.result ? validate(req.result.state) : null);
    req.onerror = () => reject(req.error);
  });
}

export async function listSaves(): Promise<SaveMeta[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).getAll();
    req.onsuccess = () => resolve((req.result as { meta: SaveMeta }[]).map((r) => r.meta).sort((a, b) => b.savedAt - a.savedAt));
    req.onerror = () => reject(req.error);
  });
}

export function validate(raw: unknown): GameState {
  const s = raw as GameState;
  if (!s || typeof s !== 'object' || s.version !== SAVE_VERSION || !s.market || !s.company) {
    throw new Error('Sauvegarde invalide ou d’une version incompatible.');
  }
  return s;
}

export function exportJson(state: GameState) {
  const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `tradewinds-${state.company.name.replace(/\W+/g, '_')}-${state.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importJson(file: File): Promise<GameState> {
  return validate(JSON.parse(await file.text()));
}
