import { ACHIEVEMENTS } from '../data/achievements';
import { SCENARIO_BY_ID } from '../data/scenarios';
import { COMMODITIES } from '../data/commodities';
import { formatDayShort } from '../engine/calendar';
import { buildRecap, goalProgress, type Recap } from '../engine/progress';
import { Panel } from './common';
import { signedUsd, usd } from './format';
import { loadCollection, useStore } from './store';

export function GamePanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const goal = goalProgress(g);
  const got = new Map(g.achievements.map((a) => [a.id, a.day]));
  const collection = new Set(loadCollection());
  const sc = g.config.scenario ? SCENARIO_BY_ID[g.config.scenario] : null;
  return (
    <Panel title="Partie" icon="🏆" onClose={() => setPanel('game')} wide>
      {sc && (
        <div className="scenario-banner">
          <b>{sc.icon} {sc.name}</b> <span className="muted small">{sc.era}</span>
          <div className="small">{sc.intro}</div>
          <div className="small muted">Leçon : {sc.lesson}</div>
        </div>
      )}
      <h4>Objectif : {goal.label}</h4>
      <div className="small">{goal.desc}</div>
      <div className="goal-bar"><i style={{ width: `${Math.round(goal.progress * 100)}%` }} /></div>
      <div className="muted small">{goal.detail}{goal.done ? ' — atteint ! 🏆' : ''}</div>

      <h4>Succès ({g.achievements.filter((a) => !a.id.startsWith('goal.')).length}/{ACHIEVEMENTS.length} dans cette partie · {collection.size} dans votre collection)</h4>
      <div className="ach-grid">
        {ACHIEVEMENTS.map((a) => {
          const day = got.get(a.id);
          const known = day !== undefined || collection.has(a.id);
          return (
            <div key={a.id} className={`ach ${day !== undefined ? 'on' : known ? 'known' : ''}`} title={a.desc}>
              <span className="ach-icon">{known ? a.icon : '❔'}</span>
              <div>
                <b>{known ? a.name : '???'}</b>
                <div className="muted small">{a.desc}{day !== undefined ? ` · ${formatDayShort(day)}` : ''}</div>
              </div>
            </div>
          );
        })}
      </div>

      <h4>Chronologie</h4>
      {g.stats.timeline.length === 0 ? <div className="empty">L’histoire reste à écrire.</div> : (
        <ul className="timeline small">
          {g.stats.timeline.slice(-12).reverse().map((t, i) => <li key={i}><span className="muted">{formatDayShort(t.day)}</span> {t.text}</li>)}
        </ul>
      )}
    </Panel>
  );
}

/** Récapitulatif de fin de partie (dans la modale de fin). */
export function RecapView({ recap }: { recap?: Recap }) {
  const g = useStore((s) => s.game)!;
  const r = recap ?? buildRecap(g);
  return (
    <div className="recap">
      <p className="recap-verdict">{r.verdict}</p>
      <div className="stats">
        <div className="stat"><div className="stat-label">Fonds propres</div><div className="stat-value">{usd(r.startNav)} → {usd(r.endNav)}</div></div>
        <div className="stat"><div className="stat-label">{r.years < 1 ? 'Rendement' : 'Rendement annualisé'}</div><div className={`stat-value ${r.annualized >= 0 ? 'pos' : 'neg'}`}>{(r.annualized * 100).toFixed(1)} %</div></div>
        <div className="stat"><div className="stat-label">Pire repli</div><div className="stat-value neg">−{(r.maxDrawdown * 100).toFixed(0)} %</div></div>
        <div className="stat"><div className="stat-label">Objectif</div><div className="stat-value">{r.goal.done ? '🏆 atteint' : `${Math.round(r.goal.progress * 100)} %`}</div></div>
      </div>
      <div className="recap-cols">
        <div>
          <h4>Meilleurs deals</h4>
          {r.best.length ? <ul>{r.best.map((d, i) => <li key={i}>{d.label} <b className="pos">{signedUsd(d.pnl)}</b></li>)}</ul> : <div className="muted small">—</div>}
          <h4>Pires deals</h4>
          {r.worst.length ? <ul>{r.worst.map((d, i) => <li key={i}>{d.label} <b className="neg">{signedUsd(d.pnl)}</b></li>)}</ul> : <div className="muted small">—</div>}
        </div>
        <div>
          <h4>Par commodité</h4>
          <ul>{r.byCommodity.map((x) => <li key={x.c}>{COMMODITIES[x.c].icon} {COMMODITIES[x.c].short} <b className={x.pnl >= 0 ? 'pos' : 'neg'}>{signedUsd(x.pnl)}</b></li>)}</ul>
          <h4>Erreurs de risque</h4>
          {r.riskErrors.length ? <ul>{r.riskErrors.map((e, i) => <li key={i}>{e}</li>)}</ul> : <div className="muted small">Aucune erreur majeure : bravo.</div>}
        </div>
        <div>
          <h4>Chronologie</h4>
          <ul className="timeline">{r.timeline.map((t, i) => <li key={i}><span className="muted">{t.day}</span> {t.text}</li>)}</ul>
          {r.skills.length > 0 && <><h4>Compétences</h4><div className="small">{r.skills.map((s) => `${s.name} ${s.value}`).join(' · ')}</div></>}
          <div className="small muted">{r.achievements} succès{r.rank ? ` · ${r.rank}ᵉ maison mondiale` : ''}{r.fines ? ` · ${usd(r.fines)} d’amendes` : ''}</div>
        </div>
      </div>
    </div>
  );
}
