import { formatDayShort } from '../engine/calendar';
import { caseKindLabel, estimateFine, LEVELS, spotMonthLimit } from '../engine/compliance';
import { activeCommodities } from '../engine/physical';
import type { ComplianceLevel } from '../engine/types';
import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { Panel, Term } from './common';
import { usd } from './format';
import { useStore } from './store';

const STAGES = ['enquête', 'poursuites', 'jugement', 'appel'];

export function CompliancePanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const c = g.compliance;
  const idx = CITY_BY_ID[g.company.hqCity]?.staffCostIndex ?? 1;
  const latent = c.cases.filter((x) => x.status === 'latent');
  const flagged = latent.filter((x) => x.flagged);
  const hidden = latent.length - flagged.length;
  return (
    <Panel title="Conformité" icon="⚖️" onClose={() => setPanel('compliance')} wide>
      <p className="muted small">Sanctions, <Term id="kyc">KYC</Term>, corruption, abus de marché : aucun sermon, seulement des conséquences. Les raccourcis rapportent… jusqu’à ce qu’une autorité s’y intéresse, parfois des années plus tard.</p>
      {c.suspendedUntil >= g.day && <p className="warn">⛔ Licence de négoce suspendue jusqu’au {formatDayShort(c.suspendedUntil)}.</p>}
      {c.banksCutUntil >= g.day && <p className="warn">⛔ Banques occidentales : lignes coupées jusqu’au {formatDayShort(c.banksCutUntil)}.</p>}

      <h4>Programme de conformité</h4>
      <div className="style-grid">
        {(Object.keys(LEVELS) as ComplianceLevel[]).map((l) => (
          <div key={l} className={`style-card ${c.level === l ? 'on' : ''}`}>
            <b>{LEVELS[l].label}</b>
            <div className="small">{usd(LEVELS[l].monthly * idx)}/mois · {LEVELS[l].seats} poste(s)</div>
            <div className="muted small">Détection interne {Math.round(LEVELS[l].detect * 100)} % · amendes ×{LEVELS[l].fineMult}{l === 'renforcé' ? ' · bloque les opérations à risque' : l === 'standard' ? ' · alerte avant opération' : ' · aucun contrôle'}</div>
            {c.level === l ? <span className="tag">Actuel</span> : <button onClick={() => act({ type: 'SET_COMPLIANCE', level: l })}>Choisir</button>}
          </div>
        ))}
      </div>

      <h4>Dossiers latents</h4>
      {latent.length === 0 ? <div className="empty">Rien à se reprocher. Pour l’instant.</div> : (
        <>
          {flagged.map((f) => (
            <div key={f.id} className="case-row">
              <div>
                <b>{caseKindLabel(f.kind)}</b> · gravité {'●'.repeat(Math.round(f.severity))}{'○'.repeat(5 - Math.round(f.severity))} · {formatDayShort(f.day)}
                <div className="muted small">{f.label}{f.gain > 0 ? ` · gain ${usd(f.gain)}` : ''}</div>
              </div>
              <button onClick={() => act({ type: 'SELF_REPORT', caseId: f.id })} title="Coopération totale : amende divisée par deux, pas de poursuites ni de sanctions annexes.">Se dénoncer (≈ {usd(estimateFine(g, { caseIds: [f.id], strategy: 'coopérer', selfReported: true }))})</button>
            </div>
          ))}
          {hidden > 0 && <p className="muted small">… et {hidden} dossier(s) que votre conformité n’a pas repéré(s). Vous savez ce que vous avez fait.</p>}
        </>
      )}

      <h4>Enquêtes</h4>
      {c.investigations.length === 0 ? <div className="empty">Aucune enquête.</div> : c.investigations.slice().reverse().map((inv) => {
        const active = !inv.done;
        const canAppeal = inv.done && inv.outcome === 'condamnation' && g.day - inv.stageEnds <= 30;
        return (
          <div key={inv.id} className={`inv-card ${active ? 'active' : ''}`}>
            <div><b>{caseKindLabel(inv.kind)}</b> — {inv.authority}</div>
            <div className="inv-stages">
              {STAGES.map((s) => <span key={s} className={inv.stage === s ? 'on' : STAGES.indexOf(s) < STAGES.indexOf(inv.stage) ? 'done' : ''}>{s}</span>)}
            </div>
            <div className="muted small">
              ouverte le {formatDayShort(inv.opened)} · avocats {usd(inv.legalSpent)}
              {active ? ` · prochaine étape le ${formatDayShort(inv.stageEnds)} · amende estimée ${usd(estimateFine(g, inv))}` : ` · issue : ${inv.outcome}`}
              {inv.selfReported ? ' · auto-déclaration' : ''}
            </div>
            {active && !inv.selfReported && (
              <div className="row">
                <div className="seg">
                  <button className={inv.strategy === 'coopérer' ? 'on' : ''} onClick={() => act({ type: 'SET_DEFENSE', id: inv.id, strategy: 'coopérer' })} title="Frais d'avocats modérés (selon la gravité), amende −25 %, mais les preuves s'accumulent">Coopérer</button>
                  <button className={inv.strategy === 'contester' ? 'on' : ''} onClick={() => act({ type: 'SET_DEFENSE', id: inv.id, strategy: 'contester' })} title="Frais d'avocats ×2,2, meilleures chances de relaxe, amende +30 % si condamnation">Contester</button>
                </div>
                {(inv.stage === 'enquête' || inv.stage === 'poursuites') && <button onClick={() => act({ type: 'SETTLE_CASE', id: inv.id })}>Transiger ({usd(estimateFine(g, inv) * 0.8)})</button>}
              </div>
            )}
            {canAppeal && <button onClick={() => act({ type: 'APPEAL', id: inv.id })}>Faire appel</button>}
          </div>
        );
      })}

      <h4>Règles de marché</h4>
      <p className="muted small">
        <Term id="poslimit">Limites de position</Term> des bourses dans les 15 derniers jours de cotation (hors couverture de bonne foi d’une exposition physique) : {activeCommodities(g).map((k) => `${COMMODITIES[k].short} ${spotMonthLimit(k)} lots`).join(' · ')}.
        {' '}<Term id="secondary">Sanctions secondaires</Term> : acheter une marchandise d’origine sanctionnée depuis un siège hors du régime occidental reste poursuivable par l’autorité américaine dès qu’un dollar est en jeu. Amendes cumulées : {usd(c.fines)}.
      </p>
    </Panel>
  );
}
