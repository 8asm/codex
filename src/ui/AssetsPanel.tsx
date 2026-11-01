import { ASSET_DEF_BY_ID, ASSET_TYPE_LABEL } from '../data/assets';
import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { COMPANY_BY_ID } from '../data/companies';
import { ZONE_BY_ID } from '../data/world';
import { formatDayShort } from '../engine/calendar';
import { heldAssetNpv, isProducer, nationalisationPA, opportunityValue, POLICY, streamBook } from '../engine/assets';
import type { AssetPolicy, AssetState } from '../engine/types';
import { Panel, Term } from './common';
import { qty, signedUsd, tone, usd } from './format';
import { useStore } from './store';

const STATUS: Record<string, string> = { operating: 'en service', building: 'en construction', maintenance: 'maintenance', strike: 'grève', damaged: 'accident / réparation' };
const KIND: Record<string, string> = { acquisition: 'Acquisition', greenfield: 'Construction', stream: 'Stream', royalty: 'Royalty', offtake: 'Offtake prépayé', tcin: 'Affrètement à temps' };

export function AssetsPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  return (
    <Panel title="Actifs industriels" icon="🏭" onClose={() => setPanel('assets')} wide>
      <p className="muted small">
        Un actif produit des flux physiques qui créent une exposition à couvrir. Au bilan : coût amorti (pas de marquage au marché), déprécié si sa
        <Term id="dcf"> valeur actualisée</Term> s’effondre. Déléguez à un manager avec une politique ; il peut se tromper.
      </p>
      {g.assets.length === 0 && <div className="empty">Aucun actif. Étudiez les opportunités ci-dessous.</div>}
      {g.assets.map((a) => <AssetCard key={a.id} a={a} />)}
      {g.streams.length > 0 && (
        <>
          <h4>Streams, royalties, offtakes</h4>
          <table className="tbl">
            <thead><tr><th>Contrat</th><th>Contrepartie</th><th>Mois restants</th><th>Au bilan</th></tr></thead>
            <tbody>{g.streams.map((s) => <tr key={s.id}><td>{KIND[s.kind]} · {ASSET_DEF_BY_ID[s.defId!]!.name}</td><td>{COMPANY_BY_ID[s.counterpartyId]?.name}</td><td>{s.monthsLeft}/{s.monthsTotal}</td><td>{usd(streamBook(s))}</td></tr>)}</tbody>
          </table>
        </>
      )}
      <h4>Opportunités</h4>
      {g.opportunities.length === 0 && <div className="empty">De nouvelles opportunités arrivent chaque mois.</div>}
      <div className="opps">
        {g.opportunities.map((o) => {
          const d = ASSET_DEF_BY_ID[o.defId]!;
          const v = opportunityValue(g, o);
          const created = o.kind === 'tcin' ? v : v - o.price;
          const st = g.world.zones[d.zone]?.stability ?? 80;
          return (
            <div key={o.id} className="opp-card">
              <div className="opp-head"><span className="badge">{KIND[o.kind]}</span>{o.share > 0 && o.share < 1 && <span className="badge">{Math.round(o.share * 100)} % (coentreprise)</span>}<small className="muted">expire le {formatDayShort(o.expiresDay)}</small></div>
              <b>{d.name}</b>
              <div className="muted small">{ASSET_TYPE_LABEL[d.type]} · {CITY_BY_ID[d.cityId]!.name} · {ZONE_BY_ID[d.zone]?.name} (stabilité {Math.round(st)}){o.counterpartyId ? ` · avec ${COMPANY_BY_ID[o.counterpartyId]?.name}` : ''}</div>
              <div className="small">{d.blurb}</div>
              <div className="city-grid">
                {o.kind === 'tcin'
                  ? <><div><span>Loyer</span><b>{o.hire?.toLocaleString('fr-FR')} $/j × {o.months} mois</b></div><div><span>Gain espéré vs FFA</span><b className={tone(v)}>{signedUsd(v)}</b></div></>
                  : <><div><span>Prix</span><b>{usd(o.price)}</b></div><div><span><Term id="dcf">Valeur DCF</Term></span><b>{usd(v)}</b></div><div><span>Valeur créée</span><b className={tone(created)}>{signedUsd(created)}</b></div>{o.kind === 'greenfield' && <div><span>Construction</span><b>~{Math.round(d.buildDays / 21)} mois, risque de dépassement</b></div>}</>}
                {st < 45 && <div><span>Nationalisation</span><b className="neg">≈ {Math.round(nationalisationPA(st) * 100)} %/an</b></div>}
              </div>
              <button className="primary" onClick={() => act({ type: 'BUY_OPPORTUNITY', id: o.id })}>{o.kind === 'tcin' ? 'Affréter' : o.kind === 'greenfield' ? 'Lancer la construction' : 'Signer'}</button>
            </div>
          );
        })}
      </div>
      <h4>Managers disponibles</h4>
      <table className="tbl">
        <thead><tr><th>Nom</th><th>Compétence</th><th>Spécialité</th><th>Salaire</th><th>Affectation</th></tr></thead>
        <tbody>
          {g.managers.map((m) => (
            <tr key={m.id}>
              <td>{m.name}{m.mistakes > 0 && <span className="muted small"> ({m.mistakes} erreur{m.mistakes > 1 ? 's' : ''})</span>}</td>
              <td>{'★'.repeat(Math.round(m.skill / 20))}<span className="muted small"> {m.skill}</span></td>
              <td className="small">{m.specialty}</td>
              <td>{usd(m.salary)}/mois</td>
              <td>{m.assetId ? <>{ASSET_DEF_BY_ID[g.assets.find((a) => a.id === m.assetId)?.defId ?? '']?.name ?? '—'} <button className="small" onClick={() => act({ type: 'FIRE_MANAGER', id: m.id })}>Licencier</button></> : <span className="muted small">libre</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

function AssetCard({ a }: { a: AssetState }) {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const d = ASSET_DEF_BY_ID[a.defId]!;
  const spec = COMMODITIES[d.commodity];
  const npv = heldAssetNpv(g, a);
  const mgr = g.managers.find((m) => m.id === a.managerId);
  const free = g.managers.filter((m) => !m.assetId);
  return (
    <div className={`asset-card ${a.status}`}>
      <div className="opp-head">
        <b>{d.name}</b>{a.share < 1 && <span className="badge">{Math.round(a.share * 100)} %</span>}
        <span className={`badge st-${a.status}`}>{STATUS[a.status]}{a.status !== 'operating' ? ` jusqu’au ${formatDayShort(a.statusUntil)}` : ''}</span>
      </div>
      <div className="city-grid">
        <div><span>État</span><b><span className="cond"><i style={{ width: `${a.condition}%`, background: `hsl(${a.condition * 1.2},70%,45%)` }} /></span> {Math.round(a.condition)}</b></div>
        <div><span>Utilisation</span><b>{Math.round(a.utilization * 100)} %</b></div>
        {isProducer(d) && <div><span>Production cumulée</span><b>{qty(d.commodity, a.produced)}</b></div>}
        {d.type === 'refinery' && <div><span>Marge de raffinage</span><b>{((a.crack ?? 0) * 100).toFixed(1)} % du Brent</b></div>}
        <div><span>Flux cumulés</span><b className={tone(a.cumCash)}>{signedUsd(a.cumCash)}</b></div>
        {!a.tcEndDay && <div><span>Valeur comptable / DCF</span><b>{usd(a.bookValue)} / {usd(npv)}</b></div>}
      </div>
      {!mgr && a.status !== 'building' && !a.tcEndDay && (
        <label className="slider small">Utilisation <input type="range" min={30} max={100} value={Math.round(a.utilization * 100)} onChange={(e) => act({ type: 'SET_ASSET', id: a.id, utilization: Number(e.target.value) / 100 }, true)} /></label>
      )}
      <div className="asset-actions">
        <select value={mgr?.id ?? ''} onChange={(e) => e.target.value && act({ type: 'HIRE_MANAGER', id: e.target.value, assetId: a.id })}>
          <option value="">{mgr ? `${mgr.name} (${mgr.skill})` : 'Déléguer à un manager…'}</option>
          {free.map((m) => <option key={m.id} value={m.id}>{m.name} — compétence {m.skill}, {Math.round(m.salary / 1000)} k$/mois</option>)}
        </select>
        <select value={a.policy} onChange={(e) => act({ type: 'SET_ASSET', id: a.id, policy: e.target.value as AssetPolicy })} title={POLICY[a.policy].label}>
          {(Object.keys(POLICY) as AssetPolicy[]).map((p) => <option key={p} value={p}>Politique {p}</option>)}
        </select>
        <button className="small" disabled={a.status !== 'operating'} onClick={() => act({ type: 'MAINTAIN_ASSET', id: a.id })}>Maintenance</button>
        {isProducer(d) && <button className="small" onClick={() => act({ type: 'HEDGE_PRODUCTION', id: a.id, months: 6, ratio: 0.5 })}>Couvrir 50 % sur 6 mois</button>}
        {!a.tcEndDay && <button className="small" onClick={() => act({ type: 'SELL_ASSET', id: a.id })}>Vendre (~{usd(npv * 0.92)})</button>}
      </div>
      {mgr && <div className="muted small">Géré par {mgr.name} : {POLICY[a.policy].label}.</div>}
      <div className="muted small">Lieu de production : {spec.physical.locations.find((l) => l.id === d.locationId)?.label}. {g.automation.autoSellProduction ? 'Production vendue automatiquement au spot.' : 'Production mise en stock.'}</div>
    </div>
  );
}
