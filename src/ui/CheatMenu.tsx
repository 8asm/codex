import { useState } from 'react';
import { create } from 'zustand';
import { CHEATS } from '../engine/cheats';
import { useStore } from './store';

/** Ouverture du menu caché : cinq clics sur l'Antarctique en moins de six secondes. */
export const useCheatMenu = create<{ open: boolean; clicks: number[]; tap: () => void; close: () => void }>((set, get) => ({
  open: false,
  clicks: [],
  tap: () => {
    const now = performance.now();
    const clicks = [...get().clicks.filter((t) => now - t < 6000), now];
    if (clicks.length >= 5) set({ open: true, clicks: [] });
    else set({ clicks });
  },
  close: () => set({ open: false }),
}));

export function CheatMenu() {
  const { open, close } = useCheatMenu();
  const act = useStore((s) => s.act);
  const game = useStore((s) => s.game);
  const [code, setCode] = useState('');
  if (!open || !game) return null;
  const used = game.stats.cheats ?? [];
  return (
    <div className="modal-bg" onClick={close}>
      <div className="modal cheats" onClick={(e) => e.stopPropagation()} data-no-i18n>
        <h2>🐧 Codes secrets</h2>
        <p className="muted small">Une partie où un code a servi n’accorde plus de succès.</p>
        <form onSubmit={(e) => { e.preventDefault(); if (code.trim()) { act({ type: 'CHEAT', code }); setCode(''); } }} className="row">
          <input autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Entrez un code…" maxLength={20} className="code-input" />
          <button className="primary" type="submit">Valider</button>
        </form>
        <table className="tbl small">
          <tbody>
            {CHEATS.map((c) => (
              <tr key={c.code} className={used.includes(c.code) ? 'pos' : ''}>
                <td><button className="ghost" onClick={() => act({ type: 'CHEAT', code: c.code })}>{c.code}</button></td>
                <td>{c.effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="modal-actions"><button onClick={close}>Fermer</button></div>
      </div>
    </div>
  );
}
