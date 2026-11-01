import { useEffect, useRef, useState } from 'react';
import { CITIES } from '../data/cities';
import { DEFAULT_CONFIG } from '../engine/game';
import { importJson, listSaves, loadGame, type SaveMeta } from '../save/saveStore';
import { formatDay } from '../engine/calendar';
import { usd } from './format';
import { useStore } from './store';

const randomSeed = () => Math.random().toString(36).slice(2, 8);

export function StartScreen() {
  const newGame = useStore((s) => s.newGame);
  const loadState = useStore((s) => s.loadState);
  const toast = useStore((s) => s.toast);
  const [name, setName] = useState(DEFAULT_CONFIG.companyName);
  const [city, setCity] = useState('geneva');
  const [capital, setCapital] = useState(25);
  const [years, setYears] = useState(3);
  const [vol, setVol] = useState(1);
  const [crisis, setCrisis] = useState(1);
  const [seed, setSeed] = useState(randomSeed());
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    listSaves().then(setSaves).catch(() => setSaves([]));
  }, []);

  const start = () => newGame({ companyName: name || 'Ma société', hqCity: city, capital: capital * 1e6, years, volatility: vol, crisisFrequency: crisis, seed });

  return (
    <div className="start">
      <div className="start-card">
        <div className="start-title">
          <span className="logo">⛵</span>
          <div>
            <h1>TRADEWINDS</h1>
            <p>Bâtissez une maison de négoce. Aucune armée : des cargaisons, des courbes et du cash.</p>
          </div>
        </div>
        {saves.length > 0 && (
          <div className="saves">
            {saves.map((s) => (
              <button key={s.slot} className="save-row" onClick={async () => { try { const st = await loadGame(s.slot); if (st) loadState(st); } catch (e) { toast(String((e as Error).message), 'bad'); } }}>
                ▶ Continuer : <b>{s.company}</b> — {formatDay(s.day)} <small className="muted">({s.slot})</small>
              </button>
            ))}
          </div>
        )}
        <h3>Nouvelle partie · Sandbox</h3>
        <label>Nom de la société<input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} /></label>
        <div className="label">Ville du siège</div>
        <div className="city-pick">
          {CITIES.map((c) => (
            <button key={c.id} className={city === c.id ? 'on' : ''} onClick={() => setCity(c.id)}>
              <b>{c.name}</b>
              <small>IS {(c.corporateTax * 100).toFixed(0)} % · loyer {usd(c.officeRentMonthly)}</small>
            </button>
          ))}
        </div>
        <div className="row2">
          <label>Capital initial : <b>{capital} M$</b><input type="range" min={5} max={100} step={5} value={capital} onChange={(e) => setCapital(Number(e.target.value))} /></label>
          <label>Durée : <b>{years} an{years > 1 ? 's' : ''}</b><input type="range" min={1} max={8} value={years} onChange={(e) => setYears(Number(e.target.value))} /></label>
        </div>
        <div className="row2">
          <label>Volatilité du monde
            <select value={vol} onChange={(e) => setVol(Number(e.target.value))}>
              <option value={0.7}>Calme</option><option value={1}>Normale</option><option value={1.4}>Agitée</option>
            </select>
          </label>
          <label>Fréquence des crises
            <select value={crisis} onChange={(e) => setCrisis(Number(e.target.value))}>
              <option value={0.3}>Rare</option><option value={1}>Normale</option><option value={2}>Fréquente</option>
            </select>
          </label>
          <label>Graine<input value={seed} onChange={(e) => setSeed(e.target.value)} /></label>
        </div>
        <div className="start-actions">
          <button className="ghost" onClick={() => fileRef.current?.click()}>Importer une sauvegarde…</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { loadState(await importJson(f)); } catch (err) { toast((err as Error).message, 'bad'); } }} />
          <button className="primary big" onClick={start}>Ouvrir les bureaux →</button>
        </div>
        <p className="muted small">Mode Histoire (carrière de stagiaire à CEO) : phase 5.</p>
      </div>
    </div>
  );
}
