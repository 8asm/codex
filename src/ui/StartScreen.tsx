import { useEffect, useRef, useState } from 'react';
import { CITIES } from '../data/cities';
import { DEFAULT_CONFIG } from '../engine/game';
import { importJson, listSaves, loadGame, type SaveMeta } from '../save/saveStore';
import { formatDay } from '../engine/calendar';
import { usd } from './format';
import { COMPANIES } from '../data/companies';
import { TRACK_LABEL } from '../data/career';
import type { CareerTrack, GoalId } from '../engine/types';
import { SCENARIOS } from '../data/scenarios';
import { MARKET_SETS } from '../data/commodities';
import { GOALS } from '../data/achievements';
import { useStore } from './store';
import { MusicButton } from './common';
import { OnlineLobby } from './OnlineLobby';
import { useSettings } from './settings';
import { DIFFICULTY_BLURB, DIFFICULTY_LABEL, DIFFICULTY_PRESET, type Difficulty } from '../engine/difficulty';

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
  const [mode, setMode] = useState<'story' | 'found' | 'join' | 'scenario' | 'online'>('story');
  const [scenario, setScenario] = useState(SCENARIOS[0]!.id);
  const [goal, setGoal] = useState<GoalId>('taille');
  const [markets, setMarkets] = useState('extended');
  const [employer, setEmployer] = useState('glenmoor');
  const [track, setTrack] = useState<CareerTrack>('trading');
  const [player, setPlayer] = useState('Alex Martin');
  const [saves, setSaves] = useState<SaveMeta[]>([]);
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [progressive, setProgressive] = useState(true);
  const pickDiff = (d: Difficulty) => {
    setDiff(d);
    const p = DIFFICULTY_PRESET[d];
    setVol(p.volatility);
    setCrisis(p.crisisFrequency);
    setMarkets(p.markets);
  };
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // première partie (aucune sauvegarde) : on propose d'emblée le mode débutant en sandbox
    listSaves().then((l) => { setSaves(l); if (!l.length) { setMode('found'); pickDiff('debutant'); } }).catch(() => setSaves([]));
  }, []);

  const start = () =>
    mode === 'scenario' ? newGame({ scenario, seed, playerName: player || 'Vous' }) : newGame({
      goal,
      difficulty: diff,
      progressive,
      commodities: MARKET_SETS.find((x) => x.id === markets)?.ids.length ? MARKET_SETS.find((x) => x.id === markets)!.ids : undefined,
      mode: mode === 'story' ? 'story' : 'sandbox', start: mode === 'join' ? 'join' : 'found', employerId: employer, track, playerName: player || 'Vous',
      companyName: name || 'Ma société', hqCity: city, capital: capital * 1e6, years: mode === 'story' ? Math.max(years, 6) : years, volatility: vol, crisisFrequency: crisis, seed,
    });
  const employers = COMPANIES.filter((c) => c.ai);

  return (
    <div className="start">
      <div className="start-music"><button className="ghost" onClick={() => useSettings.getState().setOpen(true)} title="Paramètres">🛠️</button> <MusicButton className="ghost" /></div>
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
        <h3>Nouvelle partie</h3>
        <div className="tabs mode-pick">
          <button className={mode === 'story' ? 'on' : ''} onClick={() => setMode('story')}>📖 Histoire<small>de stagiaire à CEO</small></button>
          <button className={mode === 'found' ? 'on' : ''} onClick={() => setMode('found')}>🏢 Sandbox : ma société</button>
          <button className={mode === 'join' ? 'on' : ''} onClick={() => setMode('join')}>👔 Sandbox : trader salarié</button>
          <button className={mode === 'scenario' ? 'on' : ''} onClick={() => setMode('scenario')}>📜 Scénarios<small>crises historiques</small></button>
          <button className={mode === 'online' ? 'on' : ''} onClick={() => setMode('online')}>🌐 En ligne<small>jusqu’à 4 joueurs</small></button>
        </div>
        {mode === 'online' && <OnlineLobby />}
        {mode !== 'scenario' && mode !== 'online' && (
          <>
            <div className="label">Difficulté {saves.length === 0 && <span className="badge">première partie ? choisissez Débutant</span>}</div>
            <div className="tabs mode-pick">
              {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => (
                <button key={d} className={diff === d ? 'on' : ''} onClick={() => pickDiff(d)}>{d === 'debutant' ? '🌱' : d === 'normal' ? '⚖️' : '🔥'} {DIFFICULTY_LABEL[d]}<small>{DIFFICULTY_BLURB[d]}</small></button>
              ))}
            </div>
            {diff === 'debutant' && mode !== 'found' && <div className="muted small">La visite guidée démarre en « Sandbox : ma société ». Ici, seules les conditions sont adoucies.</div>}
            {mode !== 'story' && mode !== 'join' && (
              <label className="check-row"><input type="checkbox" checked={progressive} onChange={(e) => setProgressive(e.target.checked)} /> <b>Complexité progressive</b> <span className="muted small">Les panneaux apparaissent au fil de la partie, quand vous en avez besoin, avec une explication et une leçon.</span></label>
            )}
          </>
        )}
        {mode === 'scenario' && (
          <div className="scenario-pick">
            {SCENARIOS.map((sc) => (
              <button key={sc.id} className={scenario === sc.id ? 'on' : ''} onClick={() => setScenario(sc.id)}>
                <span className="sc-icon">{sc.icon}</span>
                <div>
                  <b>{sc.name}</b> <small className="muted">{sc.era}</small>
                  <div className="small">{sc.intro}</div>
                  <div className="small muted">🎯 {sc.objective.desc}</div>
                </div>
              </button>
            ))}
          </div>
        )}
        {(mode === 'story' || mode === 'join') && (
          <>
            {mode === 'story' && <label>Votre nom<input value={player} onChange={(e) => setPlayer(e.target.value)} maxLength={30} /></label>}
            <div className="label">Société d’entrée</div>
            <div className="city-pick employers">
              {employers.map((c) => (
                <button key={c.id} className={employer === c.id ? 'on' : ''} onClick={() => setEmployer(c.id)} title={c.culture}>
                  <b>{c.name}</b>
                  <small>{CITIES.find((x) => x.id === c.cityId)?.name} · {c.kind} · {c.temperament}</small>
                </button>
              ))}
            </div>
            {mode === 'story' && (
              <div className="chips">
                {(Object.keys(TRACK_LABEL) as CareerTrack[]).map((t) => <button key={t} className={track === t ? 'on' : ''} onClick={() => setTrack(t)}>Filière {TRACK_LABEL[t]}</button>)}
              </div>
            )}
          </>
        )}
        {mode === 'found' && (
          <>
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
          </>
        )}
        {mode === 'found' && (
          <label>Marchés suivis
            <select value={markets} onChange={(e) => setMarkets(e.target.value)}>
              {MARKET_SETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        )}
        {mode !== 'scenario' && mode !== 'online' && (
          <label>Objectif de victoire
            <select value={goal} onChange={(e) => setGoal(e.target.value as GoalId)}>
              {GOALS.filter((x) => x.id !== 'scenario').map((x) => <option key={x.id} value={x.id}>{x.label} — {x.desc}</option>)}
            </select>
          </label>
        )}
        {mode !== 'scenario' && mode !== 'online' && <><div className="row2">
          {mode !== 'story' && <label>{mode === 'join' ? 'Capital alloué au livre' : 'Capital initial'} : <b>{capital} M$</b><input type="range" min={5} max={100} step={5} value={capital} onChange={(e) => setCapital(Number(e.target.value))} /></label>}
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
        </div></>}
        {mode !== 'online' && <div className="start-actions">
          <button className="ghost" onClick={() => fileRef.current?.click()}>Importer une sauvegarde…</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; try { loadState(await importJson(f)); } catch (err) { toast((err as Error).message, 'bad'); } }} />
          <button className="primary big" onClick={start}>{mode === 'story' ? 'Premier jour →' : mode === 'join' ? 'Rejoindre le desk →' : mode === 'scenario' ? 'Entrer dans l’histoire →' : 'Ouvrir les bureaux →'}</button>
        </div>}
      </div>
    </div>
  );
}
