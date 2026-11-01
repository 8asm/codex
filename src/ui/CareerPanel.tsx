import { useState } from 'react';
import { CITIES, CITY_BY_ID } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { COMPANY_BY_ID } from '../data/companies';
import { MIN_MONTHS, SKILL_LABEL, TRACK_LABEL, TRACK_TITLES, WITHHOLDING } from '../data/career';
import { formatDayShort } from '../engine/calendar';
import { evaluate, FOUND_MIN_REPUTATION, FOUND_MIN_WEALTH, foundingCheck, interviewChance, title } from '../engine/career';
import { relationLabel } from '../engine/npcs';
import { activeSituations } from '../engine/situations';
import type { CareerTrack, NpcRole, Skill } from '../engine/types';
import { Panel, Term } from './common';
import { usd } from './format';
import { useStore } from './store';

const ROLE_ICON: Record<NpcRole, string> = { manager: '👔', collègue: '🧑‍💼', risk: '🛡️', conformité: '⚖️', client: '🤝', banquier: '🏦', chasseur: '🎯', journaliste: '📰', officiel: '🏛️', investisseur: '💼', mentor: '🎓' };

export function CareerPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const [tab, setTab] = useState<'profile' | 'inbox' | 'people' | 'jobs' | 'found'>('profile');
  const n = activeSituations(g).length;
  return (
    <Panel title="Carrière" icon="👔" onClose={() => setPanel('career')} wide>
      <div className="tabs">
        <button className={tab === 'profile' ? 'on' : ''} onClick={() => setTab('profile')}>Profil</button>
        <button className={tab === 'inbox' ? 'on' : ''} onClick={() => setTab('inbox')}>Situations {n > 0 && <span className="pill">{n}</span>}</button>
        <button className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>Relations</button>
        <button className={tab === 'jobs' ? 'on' : ''} onClick={() => setTab('jobs')}>Emploi {g.career!.offers.length > 0 && <span className="pill">{g.career!.offers.length}</span>}</button>
        <button className={tab === 'found' ? 'on' : ''} onClick={() => setTab('found')}>{g.career!.status === 'founder' ? 'Ma société' : 'Créer ma société'}</button>
      </div>
      {tab === 'profile' ? <Profile /> : tab === 'inbox' ? <Inbox /> : tab === 'people' ? <People /> : tab === 'jobs' ? <Jobs /> : <Found />}
    </Panel>
  );
}

function Profile() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const c = g.career!;
  const ev = c.status === 'employed' ? evaluate(g) : null;
  const months = (g.day - c.sinceDay) / 30.4;
  const open = g.compromises.filter((x) => !x.resolved);
  return (
    <div>
      <div className="career-head">
        <div className="career-avatar">🧑‍💼</div>
        <div>
          <h3>{g.player.name} — {title(c)}</h3>
          <div className="muted small">{c.status === 'employed' ? `${COMPANY_BY_ID[c.employerId!]?.name} · filière ${TRACK_LABEL[c.track]}` : c.status === 'founder' ? g.company.name : c.status === 'ceo' ? `CEO de ${g.company.name}` : `sans emploi depuis le ${formatDayShort(c.unemployedSince ?? g.day)}`}{c.desk.length && c.track === 'trading' && c.status === 'employed' && c.level >= 2 ? ` · desk ${c.desk.map((x) => COMMODITIES[x].short).join(', ')}` : ''}</div>
        </div>
      </div>
      <div className="stats">
        <div className="stat"><div className="stat-label">Patrimoine personnel</div><div className="stat-value">{usd(c.wealth, 2)}</div><div className="stat-sub">salaire {usd(c.salary)}/mois</div></div>
        <div className="stat"><div className="stat-label">Réputation</div><div className="stat-value">{Math.round(c.reputation)}/100</div></div>
        {ev && <div className="stat"><div className="stat-label">Évaluation estimée</div><div className="stat-value">{Math.round(ev.score)}/100</div><div className="stat-sub">perf {Math.round(ev.perf)} · compétence {Math.round(ev.skill)} · manager {Math.round(ev.trust)}</div></div>}
        {c.status === 'employed' && <div className="stat"><div className="stat-label">Dans le poste</div><div className="stat-value">{months.toFixed(1)} mois</div><div className="stat-sub">promotion possible après {MIN_MONTHS[c.level]} mois si évaluation ≥ 65 (janvier, juillet)</div></div>}
      </div>
      {c.status === 'employed' && (
        <div className="ladder-career">
          {TRACK_TITLES[c.track].map((t, i) => <span key={t} className={i === c.level ? 'on' : i < c.level ? 'done' : ''}>{t}</span>)}
        </div>
      )}
      {c.strikes > 0 && <div className="callout danger">⚠️ {c.strikes} dépassement(s) de limites sanctionné(s). {g.day <= c.frozenUntil ? `Livre gelé jusqu’au ${formatDayShort(c.frozenUntil)}.` : 'Gel au 3ᵉ, licenciement au 5ᵉ.'}</div>}
      <h4>Compétences</h4>
      <div className="skills">
        {(Object.keys(c.skills) as Skill[]).map((k) => (
          <div key={k} className="skill"><span>{SKILL_LABEL[k]}</span><div className="bar"><div style={{ width: `${c.skills[k]}%` }} /></div><b>{Math.round(c.skills[k])}</b></div>
        ))}
      </div>
      {c.team.length > 0 && (
        <>
          <h4>Votre équipe</h4>
          <table className="tbl"><tbody>{c.team.map((t) => <tr key={t.id}><td>{t.name}</td><td>compétence {Math.round(t.skill)}</td><td>{usd(t.pnlYtd)} cette année</td></tr>)}</tbody></table>
        </>
      )}
      {open.length > 0 && (
        <>
          <h4><Term id="compromise">Squelettes dans le placard</Term></h4>
          <ul className="small">{open.map((x) => <li key={x.id} className="neg">{formatDayShort(x.day)} — {x.label} (gravité {x.severity}/5{x.witnesses.length ? `, ${x.witnesses.length} témoin(s)` : ''})</li>)}</ul>
        </>
      )}
      <div className="asset-actions">
        {c.status === 'employed' && <button onClick={() => act({ type: 'START_NEGOTIATION', kind: 'salaire', target: 'manager' })}>Demander une augmentation</button>}
        <button onClick={() => act({ type: 'RETIRE' })} title="Terminer la partie maintenant">Prendre sa retraite</button>
      </div>
      <h4>Journal de carrière</h4>
      <ul className="career-log">{c.log.slice(0, 25).map((l, i) => <li key={i}><small className="muted">{formatDayShort(l.day)}</small> {l.text}</li>)}</ul>
    </div>
  );
}

export function SituationCard({ id }: { id: string }) {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const sit = g.situations.find((x) => x.id === id);
  if (!sit) return null;
  const who = sit.npcId ? g.npcs.find((n) => n.id === sit.npcId) : undefined;
  return (
    <div className={`situation ${sit.urgent ? 'urgent' : ''}`}>
      <div className="sit-head">
        {who && <span className="npc-chip">{ROLE_ICON[who.role]} {who.name} <small className="muted">({relationLabel(who.trust)})</small></span>}
        <small className="muted">répondre avant le {formatDayShort(sit.expiresDay)}</small>
      </div>
      <h4>{sit.title}</h4>
      <p>{sit.text}</p>
      <div className="sit-choices">
        {sit.choices.map((ch, i) => (
          <button key={i} className={i === 0 ? 'primary' : ''} onClick={() => act({ type: 'RESOLVE_SITUATION', id: sit.id, choice: i })}>
            {ch.label}{ch.hint && <small>{ch.hint}</small>}
          </button>
        ))}
      </div>
    </div>
  );
}

function Inbox() {
  const g = useStore((s) => s.game)!;
  const list = activeSituations(g);
  if (!list.length) return <div className="empty">Aucune situation en attente. Elles arrivent au fil des jours : demandes, appels, dilemmes…</div>;
  return <div>{list.map((s) => <SituationCard key={s.id} id={s.id} />)}</div>;
}

function People() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const [role, setRole] = useState<NpcRole | 'tous'>('tous');
  const roles: (NpcRole | 'tous')[] = ['tous', 'manager', 'collègue', 'mentor', 'risk', 'conformité', 'client', 'banquier', 'chasseur', 'investisseur', 'journaliste', 'officiel'];
  const list = g.npcs.filter((n) => role === 'tous' || n.role === role).sort((a, b) => Math.abs(b.trust) - Math.abs(a.trust)).slice(0, 40);
  return (
    <div>
      <div className="chips">{roles.map((r) => <button key={r} className={role === r ? 'on' : ''} onClick={() => setRole(r)}>{r === 'tous' ? 'tous' : `${ROLE_ICON[r]} ${r}`}</button>)}</div>
      <p className="muted small">Les relations ouvrent des deals (meilleurs différentiels), des entretiens, des informations… et peuvent se retourner contre vous. Un déjeuner en personne compte double : voyagez.</p>
      <div className="people">
        {list.map((n) => (
          <div key={n.id} className="npc-card">
            <div className="npc-top"><b>{ROLE_ICON[n.role]} {n.name}</b><small className="muted">{n.role}{n.companyId ? ` · ${COMPANY_BY_ID[n.companyId]?.name}` : ''} · {CITY_BY_ID[n.cityId]?.name}</small></div>
            <div className="trustbar"><div className={n.trust >= 0 ? 'pos' : 'neg'} style={{ width: `${Math.abs(n.trust) / 2}%`, left: n.trust >= 0 ? '50%' : `${50 - Math.abs(n.trust) / 2}%` }} /></div>
            <div className="small">{relationLabel(n.trust)} ({Math.round(n.trust)}) · veut {n.interest}</div>
            {n.memory.slice(0, 2).map((m, i) => <div key={i} className="muted small">{formatDayShort(m.day)} : {m.text} ({m.delta > 0 ? '+' : ''}{Math.round(m.delta)})</div>)}
            <button className="small" onClick={() => act({ type: 'MEET_NPC', npcId: n.id })}>{g.player.cityId === n.cityId ? 'Inviter à déjeuner' : 'Appel vidéo'}</button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Jobs() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const c = g.career!;
  const [track, setTrack] = useState<CareerTrack>(c.track);
  const companies = g.companies.filter((x) => x.alive && x.id !== c.employerId);
  return (
    <div>
      {c.offers.length > 0 && (
        <>
          <h4>Offres en cours</h4>
          {c.offers.map((o) => (
            <div key={o.id} className="opp-card">
              <b>{COMPANY_BY_ID[o.companyId]?.name} — {TRACK_TITLES[o.track][o.level]}</b>
              <div className="small">{usd(o.salary)}/mois · expire le {formatDayShort(o.expiresDay)} · {o.interviewed ? 'entretien réussi : offre ferme' : 'entretien à passer'}</div>
              {o.interviewed && (
                <div className="asset-actions">
                  <button className="primary" onClick={() => act({ type: 'ACCEPT_JOB', offerId: o.id })}>Accepter</button>
                  <button onClick={() => act({ type: 'START_NEGOTIATION', kind: 'offre', target: o.id })}>Négocier le salaire</button>
                </div>
              )}
            </div>
          ))}
        </>
      )}
      <h4>Postuler</h4>
      <div className="chips">{(Object.keys(TRACK_LABEL) as CareerTrack[]).map((t) => <button key={t} className={track === t ? 'on' : ''} onClick={() => setTrack(t)}>{TRACK_LABEL[t]}</button>)}</div>
      <table className="tbl">
        <thead><tr><th>Société</th><th>Siège</th><th>Chance (préparé)</th><th /></tr></thead>
        <tbody>
          {companies.slice(0, 18).map((x) => (
            <tr key={x.id}>
              <td>{COMPANY_BY_ID[x.id]?.name}</td>
              <td className="small">{CITY_BY_ID[COMPANY_BY_ID[x.id]!.cityId]?.name}</td>
              <td>{Math.round(interviewChance(g, x.id, track, Math.max(1, Math.min(5, c.level - (track !== c.track ? 1 : 0))), true) * 100)} %</td>
              <td><button className="small" onClick={() => act({ type: 'APPLY_JOB', companyId: x.id, track })}>Postuler</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {c.status === 'employed' && (
        <div className="asset-actions">
          {track !== c.track && <button onClick={() => act({ type: 'REQUEST_TRANSFER', track })}>Demander un transfert vers {TRACK_LABEL[track]}</button>}
          <button onClick={() => act({ type: 'RESIGN' })}>Démissionner</button>
        </div>
      )}
    </div>
  );
}

function Found() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const c = g.career!;
  const [name, setName] = useState('Mistral Commodities');
  const [city, setCity] = useState('geneva');
  if (c.status === 'founder') {
    return (
      <div>
        <div className="stats">
          <div className="stat"><div className="stat-label">Votre part</div><div className="stat-value">{Math.round(c.equity * 100)} %</div></div>
          <div className="stat"><div className="stat-label">Ligne bancaire</div><div className="stat-value">×{(g.company.creditMult ?? 1).toFixed(2)}</div><div className="stat-sub">selon la confiance des banquiers</div></div>
        </div>
        <h4>Actionnaires</h4>
        <table className="tbl"><tbody>{c.investors.map((i) => { const n = g.npcs.find((x) => x.id === i.npcId); return <tr key={i.npcId}><td>{n?.name}</td><td>{(i.share * 100).toFixed(1)} %</td><td>{usd(i.capital)} apportés</td><td>{relationLabel(n?.trust ?? 0)}</td></tr>; })}</tbody></table>
        <label className="limits">Taux de distribution des dividendes <b>{Math.round(c.payout * 100)} %</b> du bénéfice annuel
          <input type="range" min={0} max={80} step={5} value={c.payout * 100} onChange={(e) => act({ type: 'SET_PAYOUT', payout: Number(e.target.value) / 100 }, true)} />
        </label>
        <p className="muted small">Retenue à la source sur les dividendes à {CITY_BY_ID[g.company.hqCity]?.name} : <Term id="withholding">{Math.round((WITHHOLDING[g.company.hqCity] ?? 0) * 100)} %</Term>. Les investisseurs attendent au moins 20 % de distribution.</p>
      </div>
    );
  }
  const err = foundingCheck(g);
  const raised = c.investors.reduce((s, i) => s + i.capital, 0);
  return (
    <div>
      <p className="muted small">Il faut un apport personnel (≥ {usd(FOUND_MIN_WEALTH)} ; 80 % de votre patrimoine sera investi), une réputation d’au moins {FOUND_MIN_REPUTATION}, des investisseurs et des banquiers qui vous font confiance.</p>
      <div className="stats">
        <div className="stat"><div className="stat-label">Apport personnel</div><div className="stat-value">{usd(c.wealth * 0.8)}</div></div>
        <div className="stat"><div className="stat-label">Investisseurs engagés</div><div className="stat-value">{usd(raised)}</div><div className="stat-sub">{c.investors.reduce((s, i) => s + i.share, 0) * 100 | 0} % du capital cédé</div></div>
      </div>
      <h4>Lever des fonds</h4>
      <table className="tbl"><tbody>
        {g.npcs.filter((n) => n.role === 'investisseur').map((n) => (
          <tr key={n.id}><td>💼 {n.name}</td><td className="small">{relationLabel(n.trust)} · veut {n.interest}</td><td>{c.investors.some((i) => i.npcId === n.id) ? <span className="badge here">engagé</span> : <button className="small" onClick={() => act({ type: 'START_NEGOTIATION', kind: 'investisseur', target: n.id })}>Pitcher</button>}</td></tr>
        ))}
      </tbody></table>
      <div className="row2">
        <label>Nom<input value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Siège<select value={city} onChange={(e) => setCity(e.target.value)}>{CITIES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      </div>
      {err && <div className="callout">{err}</div>}
      <button className="primary big" disabled={!!err} onClick={() => act({ type: 'FOUND_COMPANY', name, city })}>Créer {name}</button>
    </div>
  );
}
