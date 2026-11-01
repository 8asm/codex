import { CITIES, CITY_BY_ID } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { ZONES } from '../data/world';
import { formatDayShort } from '../engine/calendar';
import { effectiveTaxRate, relocationCost } from '../engine/game';
import { Panel, Term } from './common';
import { usd } from './format';
import { useStore } from './store';

const REGIME: Record<string, string> = { west: 'sanctions occidentales', un: 'sanctions ONU seulement', east: 'sanctions orientales', none: 'aucune sanction appliquée' };

export function WorldPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const sel = useStore((s) => s.selectedCity);
  const w = g.world;
  const hq = CITY_BY_ID[g.company.hqCity]!;
  const other = CITY_BY_ID[sel && sel !== hq.id ? sel : CITIES.find((c) => c.id !== hq.id)!.id]!;
  const tax = effectiveTaxRate(g);
  const t = w.blocTension;

  return (
    <Panel title="Monde & réglementation" icon="🌍" onClose={() => setPanel('world')} wide>
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Tension entre blocs</div>
          <div className={`limitbar ${t > 70 ? 'over' : t > 55 ? 'warn' : ''}`}><div style={{ width: `${t}%` }} /><span>{Math.round(t)}/100</span></div>
          <div className="stat-sub">Plus elle monte, plus sanctions et embargos sont probables.</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Term id="cbank">Taux directeurs</Term></div>
          <div className="stat-value small2">USD {(g.market.rates.USD * 100).toFixed(2)} % · EUR {(g.market.rates.EUR * 100).toFixed(2)} %</div>
          <div className="stat-sub">Prochaines décisions : Fed {formatDayShort(w.calendar.fomc)}, BCE {formatDayShort(w.calendar.ecb)}</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Term id="enso">ENSO (El Niño / La Niña)</Term></div>
          <div className="stat-value small2">{w.enso > 0.5 ? '🔥 El Niño' : w.enso < -0.5 ? '💧 La Niña' : 'Neutre'} ({w.enso.toFixed(1)})</div>
          <div className="stat-sub">Pèse sur le blé et le charbon.</div>
        </div>
        <div className="stat">
          <div className="stat-label">Thèmes de marché</div>
          <div className="stat-value small2">{w.narratives.length ? w.narratives.map((n) => n.name).join(' · ') : '—'}</div>
          <div className="stat-sub"><Term id="narrative">Narratifs</Term> : tendances de fond de quelques mois.</div>
        </div>
      </div>

      {(w.sanctions.length > 0 || w.restrictions.length > 0) && (
        <>
          <h4>Sanctions & restrictions en vigueur</h4>
          <ul className="restrictions">
            {w.sanctions.map((s) => <li key={s.id}>🚫 <Term id={s.kind === 'full' ? 'sanctions' : 'pricecap'}>{s.kind === 'full' ? 'Sanctions totales' : 'Plafond de prix'}</Term> ({s.by === 'west' ? 'Occident' : 'Orient'}) contre {ZONES.find((z) => z.id === s.zone)!.name}{s.c ? ` sur le ${COMMODITIES[s.c].short} (−${Math.round((s.capPct ?? 0) * 100)} %)` : ''} depuis le {formatDayShort(s.sinceDay)}</li>)}
            {w.restrictions.map((r) => <li key={r.id}>⛔ <Term id="embargo">{r.kind === 'exportBan' ? 'Interdiction d’export' : 'Embargo'}</Term> : {COMMODITIES[r.c].short} de {ZONES.find((z) => z.id === r.zone)!.name}{r.importer ? ` vers ${ZONES.find((z) => z.id === r.importer)!.name}` : ''} jusqu’au {formatDayShort(r.untilDay)}</li>)}
          </ul>
        </>
      )}

      <h4>Pays et zones de production</h4>
      <table className="tbl">
        <thead><tr><th>Zone</th><th>Bloc</th><th>Stabilité</th><th>Production</th></tr></thead>
        <tbody>
          {ZONES.map((z) => {
            const st = w.zones[z.id]!.stability;
            return (
              <tr key={z.id} title={z.blurb}>
                <td>{z.name}{z.fictional && <small className="muted"> (fictif)</small>}</td>
                <td className="small">{z.bloc === 'west' ? 'Occident' : z.bloc === 'east' ? 'Orient' : 'non-aligné'}</td>
                <td style={{ width: 120 }}><div className={`limitbar ${st < 35 ? 'over' : st < 55 ? 'warn' : ''}`}><div style={{ width: `${st}%`, background: `hsl(${st * 1.2},80%,45%)` }} /><span>{Math.round(st)}</span></div></td>
                <td>{Object.keys(z.produces).map((c) => COMMODITIES[c as keyof typeof COMMODITIES].icon).join(' ')}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h4>Réglementation : votre siège vs une autre ville</h4>
      <div className="reg-compare">
        {[hq, other].map((c, i) => {
          const r = w.cityRegs[c.id]!;
          return (
            <div key={c.id} className="city-card">
              <h3>{c.name} {i === 0 && <span className="badge here">siège</span>}</h3>
              <div className="city-grid">
                <div><span>Impôt sur les sociétés</span><b>{(r.taxRate * 100).toFixed(1)} %</b></div>
                <div><span>Régime spécial</span><b className="small">{c.specialRegime ? `${c.specialRegime.label} (${(c.specialRegime.rate * 100).toFixed(0)} %)` : '—'}</b></div>
                <div><span><Term id="kyc">Exigence KYC</Term></span><b>{Math.round(r.kyc * 100)} %</b></div>
                <div><span><Term id="reporting">Reporting dérivés</Term></span><b>{r.reportingFee} $/transaction</b></div>
                <div><span><Term id="sanctions">Sanctions</Term></span><b className="small">{REGIME[c.sanctionsRegime]}</b></div>
                <div><span><Term id="capctl">Contrôle des capitaux</Term></span><b>{r.capitalControls ? 'oui' : 'non'}</b></div>
                <div><span>Régulateur</span><b className="small">{c.regulator}</b></div>
              </div>
              {i === 0 && <div className="muted small">Taux effectif cette année : <b>{(tax.rate * 100).toFixed(1)} %</b>{tax.regime ? ` (${tax.regime.label})` : c.specialRegime?.minPhysicalVolume ? ` — régime spécial si volume physique ≥ ${usd(c.specialRegime.minPhysicalVolume)} (actuel ${usd(g.company.physVolumeYtd)})` : ''}</div>}
              {i === 1 && (
                <button className="primary" onClick={() => act({ type: 'RELOCATE_HQ', city: c.id })}>
                  Transférer le siège à {c.name} · {usd(relocationCost(g, c.id))}
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="muted small">Choisissez la ville comparée en cliquant sur le globe.</p>
    </Panel>
  );
}
