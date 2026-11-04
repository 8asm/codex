import { useState } from 'react';
import { CITIES, CITY_BY_ID } from '../data/cities';
import { MARKET_SETS } from '../data/commodities';
import type { MpRole } from '../engine/multiplayer';
import { MAX_PLAYERS, useMp } from './mp';

/**
 * Salon de la partie en ligne : héberger (l'hôte est un joueur) ou rejoindre avec un code. Chacun choisit une
 * société (rejoindre celle d'un autre, ou fonder la sienne) et un rôle (PDG : toutes les décisions ; trader :
 * marchés et physique). Coopération, compétition, ou un mélange des deux.
 */
export function OnlineLobby() {
  const mp = useMp();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [company, setCompany] = useState('Ma maison de négoce');
  const [city, setCity] = useState('geneva');
  const [years, setYears] = useState(3);
  const [markets, setMarkets] = useState('extended');
  const [difficulty, setDifficulty] = useState<'debutant' | 'normal' | 'expert'>('normal');

  if (mp.phase === 'idle') {
    return (
      <div className="online">
        <p className="muted small">Jusqu’à {MAX_PLAYERS} joueurs, sans serveur : l’un de vous héberge la partie, les autres la rejoignent avec son code. Travaillez ensemble dans la même maison, bâtissez chacun votre empire, ou un peu des deux.</p>
        <label>Votre nom<input value={name} onChange={(e) => setName(e.target.value)} maxLength={24} placeholder="Votre nom" /></label>
        <div className="online-cols">
          <div className="online-card">
            <h4>🖥️ Héberger une partie</h4>
            <label>Nom de votre société<input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={40} /></label>
            <label>Ville du siège<select value={city} onChange={(e) => setCity(e.target.value)}>{CITIES.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Durée : <b>{years} an{years > 1 ? 's' : ''}</b><input type="range" min={1} max={8} value={years} onChange={(e) => setYears(Number(e.target.value))} /></label>
            <label>Marchés suivis<select value={markets} onChange={(e) => setMarkets(e.target.value)}>{MARKET_SETS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}</select></label>
            <label>Difficulté<select value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}><option value="debutant">Débutant</option><option value="normal">Normal</option><option value="expert">Expert</option></select></label>
            <button className="primary" onClick={() => void mp.host(name || 'Hôte', {
              config: { seed: Math.random().toString(36).slice(2, 8), years, difficulty, progressive: true, commodities: MARKET_SETS.find((x) => x.id === markets)?.ids.length ? MARKET_SETS.find((x) => x.id === markets)!.ids : undefined, playerName: name || 'Hôte' },
              companies: [{ name: company || 'Ma maison', hqCity: city, capital: 25e6 }],
            })}>Créer le salon</button>
          </div>
          <div className="online-card">
            <h4>🔗 Rejoindre une partie</h4>
            <label>Code de partie<input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="ABC123" className="code-input" /></label>
            <button className="primary" disabled={code.length !== 6} onClick={() => void mp.join(code, name || 'Joueur')}>Rejoindre</button>
          </div>
        </div>
      </div>
    );
  }
  if (mp.phase === 'connecting') return <div className="online"><p>Connexion en cours…</p><button className="ghost" onClick={mp.leave}>Annuler</button></div>;
  if (mp.phase === 'error') return <div className="online"><p className="neg">{mp.error}</p><button onClick={mp.leave}>Retour</button></div>;
  return <LobbyRoom />;
}

function LobbyRoom() {
  const mp = useMp();
  const [newName, setNewName] = useState('');
  const [newCity, setNewCity] = useState('london');
  const [msg, setMsg] = useState('');
  const me = mp.players.find((p) => p.id === mp.me);
  const setup = mp.setup!;
  const claim = (company: number | 'new', role: MpRole) => mp.claim(company, role, newCity, newName || undefined);
  return (
    <div className="online">
      <div className="lobby-code">Code de partie : <b>{mp.code}</b> <button className="ghost" onClick={() => void navigator.clipboard?.writeText(mp.code)}>Copier</button></div>
      <p className="muted small">Donnez ce code à vos amis (jusqu’à {MAX_PLAYERS} joueurs). {mp.isHost ? 'Vous êtes l’hôte : vous lancez la partie et réglez le temps.' : 'L’hôte lance la partie et règle le temps.'}</p>
      <h4>Sociétés</h4>
      {setup.companies.map((c, k) => (
        <div key={k} className="lobby-company">
          <div><b>{c.name}</b> <span className="muted small">{CITY_BY_ID[c.hqCity]?.name}</span></div>
          <div className="lobby-players">{mp.players.filter((p) => p.company === k).map((p) => <span key={p.id} className="badge" style={{ borderColor: p.color }}>{p.name} · {p.role === 'ceo' ? 'PDG' : 'trader'}{p.id === mp.me ? ' (vous)' : ''}</span>)}</div>
          {me && (
            <div className="row">
              <button className={me.company === k && me.role === 'ceo' ? 'on' : ''} onClick={() => claim(k, 'ceo')}>Rejoindre en PDG</button>
              <button className={me.company === k && me.role === 'trader' ? 'on' : ''} onClick={() => claim(k, 'trader')}>Rejoindre en trader</button>
            </div>
          )}
        </div>
      ))}
      {setup.companies.length < MAX_PLAYERS && me && (
        <div className="lobby-company new">
          <b>Fonder votre propre société</b> <span className="muted small">(vous serez concurrents dans le même monde)</span>
          <div className="row">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nom de la société" maxLength={40} />
            <select value={newCity} onChange={(e) => setNewCity(e.target.value)}>{CITIES.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <button onClick={() => claim('new', 'ceo')}>Fonder</button>
          </div>
        </div>
      )}
      {mp.isHost && (
        <div className="row">
          <span className="small muted">{setup.config.years} an(s) · difficulté {setup.config.difficulty} · complexité progressive</span>
        </div>
      )}
      <div className="lobby-chat">
        {mp.chat.slice(-6).map((c, i) => <div key={i} className="small"><b>{c.from}</b> : {c.text}</div>)}
        <form onSubmit={(e) => { e.preventDefault(); if (msg.trim()) { mp.say(msg.trim()); setMsg(''); } }}><input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message…" maxLength={200} /></form>
      </div>
      <div className="row">
        <button className="ghost" onClick={mp.leave}>Quitter le salon</button>
        {mp.isHost ? <button className="primary big" onClick={mp.start}>Lancer la partie →</button> : <span className="muted">En attente de l’hôte…</span>}
      </div>
    </div>
  );
}

/** Pendant la partie en ligne : joueurs, code, discussion. */
export function MpBar() {
  const mp = useMp();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState('');
  if (!mp.active) return null;
  return (
    <div className={`mp-bar ${open ? 'open' : ''}`}>
      <button className="ghost" onClick={() => setOpen(!open)} title="Partie en ligne">🌐 {mp.code} · {mp.players.length} joueur{mp.players.length > 1 ? 's' : ''}{mp.chat.length ? ' · 💬' : ''}</button>
      {open && (
        <div className="mp-panel">
          {mp.setup?.companies.map((c, k) => (
            <div key={k} className="small"><b>{c.name}</b> : {mp.players.filter((p) => p.company === k).map((p) => `${p.name} (${p.role === 'ceo' ? 'PDG' : 'trader'})`).join(', ') || '—'}</div>
          ))}
          <div className="lobby-chat">
            {mp.chat.slice(-8).map((c, i) => <div key={i} className="small"><b>{c.from}</b> : {c.text}</div>)}
            <form onSubmit={(e) => { e.preventDefault(); if (msg.trim()) { mp.say(msg.trim()); setMsg(''); } }}><input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Message…" maxLength={200} /></form>
          </div>
          <div className="small muted">{mp.isHost ? 'Vous êtes l’hôte : le temps avance à votre vitesse pour tous.' : 'L’hôte règle le temps.'}</div>
        </div>
      )}
    </div>
  );
}
