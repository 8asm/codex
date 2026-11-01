import { useEffect, useRef, useState } from 'react';
import { exportJson, saveGame } from '../save/saveStore';
import { BookPanel } from './BookPanel';
import { CodexPanel } from './CodexPanel';
import { GlobeCanvas } from './GlobeCanvas';
import { Hud } from './Hud';
import { MarketPanel } from './MarketPanel';
import { Modals } from './Modals';
import { NewsTicker } from './NewsTicker';
import { PhysicalPanel } from './PhysicalPanel';
import { StartScreen } from './StartScreen';
import { TravelPanel } from './TravelPanel';
import { TreasuryPanel } from './TreasuryPanel';
import { clock, DAY_SECONDS, useStore, type PanelId } from './store';

const DOCK: { id: PanelId; icon: string; label: string; key: string }[] = [
  { id: 'market', icon: '📈', label: 'Marchés', key: 'M' },
  { id: 'physical', icon: '🚢', label: 'Physique', key: 'P' },
  { id: 'book', icon: '📒', label: 'Livre', key: 'L' },
  { id: 'treasury', icon: '🏦', label: 'Trésorerie', key: 'T' },
  { id: 'travel', icon: '✈️', label: 'Voyages', key: 'V' },
  { id: 'codex', icon: '📚', label: 'Codex', key: 'C' },
];

function useGameLoop() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (t - last) / 1000);
      last = t;
      const st = useStore.getState();
      if (!st.game || st.speed === 0 || st.modal || st.game.status !== 'running') {
        clock.dayFrac = st.speed === 0 ? clock.dayFrac : 0;
        return;
      }
      const len = DAY_SECONDS[st.speed];
      acc += dt;
      if (acc >= len) {
        acc = 0;
        st.step();
      }
      clock.dayFrac = acc / len;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA') return;
      const st = useStore.getState();
      if (!st.game) return;
      if (e.key === 'Escape') {
        if (st.modal) st.closeModal();
        else st.setPanel(st.panel ?? 'market');
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        st.setSpeed(st.speed === 0 ? 1 : 0);
      } else if (e.key === '1') st.setSpeed(1);
      else if (e.key === '2') st.setSpeed(2);
      else if (e.key === '3') st.setSpeed(5);
      else if (e.key.toLowerCase() === 'n' && st.speed === 0) st.step();
      else {
        const d = DOCK.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (d) st.setPanel(d.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function App() {
  const game = useStore((s) => s.game);
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const toasts = useStore((s) => s.toasts);
  const [menu, setMenu] = useState(false);
  const toast = useStore((s) => s.toast);
  const quit = useStore((s) => s.quit);
  useGameLoop();
  useKeyboard();
  const menuRef = useRef<HTMLDivElement>(null);

  // Divulgation progressive : la trésorerie n'apparaît qu'une fois des marges ou de la dette en jeu.
  const showTreasury = !!game && (game.company.im > 0 || game.company.rcfDrawn > 0 || game.history.length > 15);

  return (
    <div className="app">
      <GlobeCanvas />
      {!game && <StartScreen />}
      {game && (
        <>
          <Hud onMenu={() => setMenu(!menu)} />
          {menu && (
            <div className="menu" ref={menuRef}>
              <button onClick={async () => { await saveGame('manuel', game); toast('Partie sauvegardée.', 'good'); setMenu(false); }}>💾 Sauvegarder</button>
              <button onClick={() => { exportJson(game); setMenu(false); }}>⬇ Exporter (JSON)</button>
              <button onClick={() => { setMenu(false); quit(); }}>⏏ Quitter vers l’accueil</button>
              <div className="muted small keys">Espace : pause · 1/2/3 : vitesse · N : jour suivant · M P L T V C : panneaux · Échap : fermer</div>
            </div>
          )}
          <nav className="dock">
            {DOCK.filter((d) => d.id !== 'treasury' || showTreasury).map((d) => (
              <button key={d.id} className={panel === d.id ? 'on' : ''} onClick={() => setPanel(d.id)} title={`${d.label} (${d.key})`}>
                <span>{d.icon}</span>
                <small>{d.label}</small>
              </button>
            ))}
          </nav>
          <div className="panel-slot">
            {panel === 'market' && <MarketPanel />}
            {panel === 'physical' && <PhysicalPanel />}
            {panel === 'book' && <BookPanel />}
            {panel === 'treasury' && <TreasuryPanel />}
            {panel === 'travel' && <TravelPanel />}
            {panel === 'codex' && <CodexPanel />}
          </div>
          <NewsTicker />
          <Modals />
        </>
      )}
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
      </div>
    </div>
  );
}
