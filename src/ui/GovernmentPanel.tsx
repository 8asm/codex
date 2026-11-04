import { useState } from 'react';
import { COMMODITIES, findLocation } from '../data/commodities';
import { COMPANY_BY_ID } from '../data/companies';
import { CITY_ZONE, ZONES } from '../data/world';
import { formatDayShort, monthLabel } from '../engine/calendar';
import { physicalDeliveryDay } from '../engine/contracts';
import { govState, hasLicence, licenceFee, LOBBY, relation, taxRulingCut, tenderBlock, tenderFairDiff } from '../engine/government';
import { forwardAt } from '../engine/market';
import type { Tender } from '../engine/types';
import { Panel } from './common';
import { price, qty, usd } from './format';
import { useStore } from './store';

/** Gouvernements : appels d'offres publics, licences, relations, rescrit fiscal. */
export function GovernmentPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const gov = govState(g);
  const [zone, setZone] = useState(CITY_ZONE[g.company.hqCity] ?? 'CH');
  const hqZone = CITY_ZONE[g.company.hqCity]!;
  const real = ZONES.filter((z) => !z.fictional || true).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <Panel title="Gouvernements & États" icon="🏛️" onClose={() => setPanel('government')} wide>
      <p className="muted small">Les États achètent et vendent par appels d’offres, délivrent des licences et négocient la fiscalité. Une bonne relation départage les offres à quelques points de base près ; elle s’érode si on ne l’entretient pas.</p>

      <h4>Appels d’offres publics</h4>
      {gov.tenders.length === 0 ? <div className="empty">Aucun appel d’offres ouvert. Il en paraît chaque mois.</div> : gov.tenders.map((t) => <TenderRow key={t.id} t={t} />)}
      {gov.results.length > 0 && (
        <details className="small"><summary>Derniers résultats</summary>
          <ul>{gov.results.slice(0, 8).map((r) => <li key={r.tenderId}>{formatDayShort(r.day)} · {COMPANY_BY_ID[r.agencyId]?.name} · {COMMODITIES[r.commodity].short} : {r.bid === undefined ? 'pas d’offre' : r.won ? '✅ remporté' : '❌ perdu'}</li>)}</ul>
        </details>
      )}

      <h4>Licences et relations</h4>
      <div className="row">
        <select value={zone} onChange={(e) => setZone(e.target.value)}>
          {real.map((z) => <option key={z.id} value={z.id}>{z.name} · relation {Math.round(relation(g, z.id))}{hasLicence(g, z.id) ? ' · licence ✓' : ''}</option>)}
        </select>
      </div>
      <div className="row">
        <button disabled={hasLicence(g, zone)} onClick={() => act({ type: 'GOV_LICENCE', zone })} title="Nécessaire pour soumissionner aux appels d’offres du pays ; améliore un peu les offres de ses contreparties">Licence d’import-export ({usd(licenceFee(zone))} / an)</button>
        <button onClick={() => act({ type: 'GOV_LOBBY', zone, kind: 'dossier' })} title="Étude technique, rencontres avec l’administration : propre, effet modeste">{LOBBY.dossier.label} ({usd(LOBBY.dossier.cost)})</button>
        <button className="ghost" onClick={() => act({ type: 'GOV_LOBBY', zone, kind: 'diner' })} title="Effet fort… mais, dans un pays opaque, un risque de dossier pour corruption">{LOBBY.diner.label} ({usd(LOBBY.diner.cost)})</button>
      </div>
      <div className="gauge" title={`Relation ${Math.round(relation(g, zone))}/100`}><i style={{ width: `${Math.max(0, relation(g, zone))}%` }} /></div>

      <h4>Fiscalité du siège</h4>
      {taxRulingCut(g) > 0 ? (
        <p className="small">Rescrit fiscal en vigueur : −{(taxRulingCut(g) * 100).toFixed(0)} points d’impôt jusqu’au {formatDayShort(gov.taxRuling!.untilDay)}.</p>
      ) : (
        <div className="row">
          <span className="small muted">Relation avec {ZONES.find((z) => z.id === hqZone)?.name} : {Math.round(relation(g, hqZone))}/100 (40 requis) · volume physique de l’année : {usd(g.company.physVolumeYtd)} (50 M$ requis).</span>
          <button onClick={() => act({ type: 'GOV_TAX_RULING' })}>Demander un rescrit fiscal (150 k$)</button>
        </div>
      )}
    </Panel>
  );
}

function TenderRow({ t }: { t: Tender }) {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const spec = COMMODITIES[t.commodity];
  const fair = tenderFairDiff(g, t);
  const mine = govState(g).bids.find((b) => b.tenderId === t.id);
  const [diff, setDiff] = useState(() => Number((mine?.diff ?? fair).toFixed(spec.decimals)));
  const block = tenderBlock(g, t);
  const F = forwardAt(g.market, t.commodity, physicalDeliveryDay(t.month));
  const loc = findLocation(t.commodity, t.locationId);
  // valeur de l'enchère pour le joueur si elle est retenue (différentiel vs marché, sur la quantité)
  const edge = t.playerSide * (fair - diff) * t.qty * spec.valuePerUnit;
  return (
    <div className="offer">
      <div className="offer-top">
        <span className="mkt-icon">{spec.icon}</span>
        <div className="offer-title">
          <b>{COMPANY_BY_ID[t.agencyId]?.name}</b> {t.playerSide > 0 ? 'vend' : 'achète'} <b>{qty(t.commodity, t.qty)}</b> de {spec.short}
          <div className="muted small">{loc.label} · livraison {monthLabel(t.month)} · {t.bidders} concurrents · clôture le {formatDayShort(t.closeDay)}</div>
        </div>
      </div>
      <div className="offer-grid">
        <div><span>Diff de marché</span><b>{fair >= 0 ? '+' : ''}{price(t.commodity, fair)}</b></div>
        <div><span>Votre différentiel</span><input type="number" step={spec.tick * 10} value={diff} onChange={(e) => setDiff(Number(e.target.value))} /></div>
        <div><span>Prix résultant</span><b>{price(t.commodity, F + diff)}</b></div>
        <div title="Gain (ou perte) par rapport au marché si votre offre est retenue, avant couverture"><span>Valeur si retenue</span><b className={edge >= 0 ? 'pos' : 'neg'}>{usd(edge)}</b></div>
      </div>
      <div className="offer-actions">
        <span className="muted small">{block ?? (mine ? `offre déposée : ${mine.diff >= 0 ? '+' : ''}${mine.diff}` : t.playerSide > 0 ? 'plus vous offrez, plus vous avez de chances' : 'plus vous demandez peu, plus vous avez de chances')}</span>
        <button className="primary" disabled={!!block} onClick={() => act({ type: 'GOV_BID', tenderId: t.id, diff })}>{mine ? 'Modifier l’offre' : 'Soumissionner'}</button>
      </div>
    </div>
  );
}
