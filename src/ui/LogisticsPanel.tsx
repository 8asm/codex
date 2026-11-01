import { useState } from 'react';
import { ASSET_DEF_BY_ID } from '../data/assets';
import { COMMODITIES, findLocation } from '../data/commodities';
import { FREIGHT, FREIGHT_IDS } from '../data/freight';
import { CHOKEPOINT_NAMES } from '../data/routes';
import { formatDayShort, monthLabel } from '../engine/calendar';
import { ffaFair, ffaMonths, ffaValue, freightRate } from '../engine/freight';
import { availableVessels, closedPassages, shipQuote, voyageValue } from '../engine/logistics';
import { ownedCapacity, storageRate } from '../engine/assets';
import type { FreightIndex, InventoryLot } from '../engine/types';
import { Panel, Sparkline, Term } from './common';
import { price, qty, signedUsd, tone, usd } from './format';
import { useStore } from './store';

export function LogisticsPanel() {
  const setPanel = useStore((s) => s.setPanel);
  const [tab, setTab] = useState<'ship' | 'freight' | 'fleet'>('ship');
  return (
    <Panel title="Logistique & fret" icon="🚢" onClose={() => setPanel('logistics')} wide>
      <div className="tabs">
        <button className={tab === 'ship' ? 'on' : ''} onClick={() => setTab('ship')}>Cargaisons & expéditions</button>
        <button className={tab === 'freight' ? 'on' : ''} onClick={() => setTab('freight')}>Marché du fret & FFA</button>
        <button className={tab === 'fleet' ? 'on' : ''} onClick={() => setTab('fleet')}>Flotte & stockage</button>
      </div>
      {tab === 'ship' ? <Shipping /> : tab === 'freight' ? <FreightMarket /> : <Fleet />}
    </Panel>
  );
}

function Shipping() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const closed = closedPassages(g);
  const lots = g.inventory.filter((l) => COMMODITIES[l.commodity].logistics.tonnesPerUnit > 0);
  return (
    <div>
      <p className="muted small">
        Acheter <Term id="fob">FOB</Term> oblige à organiser le transport ; vendre <Term id="cif">CIF/CFR</Term> oblige à livrer à destination.
        L’<Term id="geoarb">arbitrage géographique</Term> consiste à expédier quand l’écart de prix entre deux ports dépasse le coût du fret.
        {closed.size > 0 && <b className="warn"> Passages fermés : {[...closed].map((c) => CHOKEPOINT_NAMES[c]).join(', ')}.</b>}
      </p>
      {lots.length === 0 && <div className="empty">Aucun stock expédiable. Achetez une cargaison FOB (Physique) ou produisez-en (Actifs).</div>}
      {lots.map((l) => <ShipCard key={l.id} lot={l} />)}
      {g.voyages.length > 0 && (
        <>
          <h4>Navires en mer</h4>
          <table className="tbl">
            <thead><tr><th>Cargaison</th><th>Trajet</th><th>Arrivée</th><th>Valeur</th></tr></thead>
            <tbody>
              {g.voyages.map((v) => (
                <tr key={v.id}>
                  <td>{COMMODITIES[v.commodity].icon} {qty(v.commodity, v.qty)}<div className="muted small">{v.vessel.kind === 'spot' ? FREIGHT[v.vessel.index].vessel : 'navire de notre flotte'}</div></td>
                  <td className="small">{findLocation(v.commodity, v.from).label} → {findLocation(v.commodity, v.to).label}{v.viaCanals.length ? <div className="muted">via {v.viaCanals.map((c) => CHOKEPOINT_NAMES[c]).join(', ')}</div> : null}</td>
                  <td>{formatDayShort(v.arriveDay)}{v.delayDays > 0 && <div className="warn small">+{v.delayDays} j de retard</div>}</td>
                  <td>{usd(voyageValue(g, v))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function ShipCard({ lot }: { lot: InventoryLot }) {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const spec = COMMODITIES[lot.commodity];
  const dests = spec.physical.locations.filter((l) => l.id !== lot.locationId);
  const quotes = dests.map((d) => ({ d, q: shipQuote(g, lot.commodity, lot.locationId, d.id, lot.qty) })).filter((x) => x.q.ok);
  const best = [...quotes].sort((a, b) => b.q.arbUsd - a.q.arbUsd)[0];
  const [to, setTo] = useState<string | null>(null);
  const sel = quotes.find((x) => x.d.id === (to ?? best?.d.id));
  const vessels = sel ? availableVessels(g, sel.q.index) : [];
  const [useFleet, setUseFleet] = useState(false);
  const vq = sel && useFleet && vessels[0] ? shipQuote(g, lot.commodity, lot.locationId, sel.d.id, lot.qty, vessels[0].id) : sel?.q;
  return (
    <div className="ship-card" style={{ ['--c' as string]: spec.color }}>
      <div className="offer-top">
        <span className="mkt-icon">{spec.icon}</span>
        <div className="offer-title"><b>{qty(lot.commodity, lot.qty)}</b> de {spec.short} à {findLocation(lot.commodity, lot.locationId).label}</div>
      </div>
      <table className="tbl dest">
        <thead><tr><th>Destination</th><th>Jours</th><th>Fret / unité</th><th>Arbitrage</th></tr></thead>
        <tbody>
          {quotes.map(({ d, q }) => (
            <tr key={d.id} className={sel?.d.id === d.id ? 'sel' : ''} onClick={() => setTo(d.id)}>
              <td>{d.label}</td>
              <td>{q.days}</td>
              <td>{price(lot.commodity, q.perUnit)}</td>
              <td className={tone(q.arbUsd)}>{signedUsd(q.arbUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {vq && sel && (
        <div className="preview">
          <div><span>Navire</span><b>{FREIGHT[vq.index].vessel} ({Math.round(vq.share * 100)} %)</b></div>
          <div><span>Route</span><b className="small">{Math.round(vq.nm).toLocaleString('fr-FR')} milles{vq.chokepoints.length ? ` via ${vq.chokepoints.map((c) => CHOKEPOINT_NAMES[c]).join(', ')}` : ''}</b></div>
          <div><span><Term id="tce">Affrètement</Term></span><b>{usd(vq.hireUsd)}</b></div>
          <div><span>Soutes</span><b>{usd(vq.bunkerUsd)}</b></div>
          <div><span>Port & manutention</span><b>{usd(vq.portUsd + vq.handlingUsd + vq.inlandUsd)}</b></div>
          <div><span>Assurance marine</span><b>{usd(vq.insuranceUsd)}</b></div>
          <div><span>Financement du stock</span><b>{usd(vq.financingUsd)}</b></div>
          <div><span>Arrivée</span><b>{formatDayShort(vq.arriveDay)}</b></div>
          {vq.opportunityUsd > 0 && <div><span>Coût d’opportunité (loyer non perçu)</span><b className="warn">{usd(vq.opportunityUsd)}</b></div>}
          <div><span>Arbitrage net</span><b className={tone(vq.arbUsd - vq.opportunityUsd)}>{signedUsd(vq.arbUsd - vq.opportunityUsd)}</b></div>
        </div>
      )}
      <div className="offer-actions">
        {vessels.length > 0 && <label className="toggle small"><input type="checkbox" checked={useFleet} onChange={(e) => setUseFleet(e.target.checked)} /> Utiliser notre navire</label>}
        <button className="primary" disabled={!sel} onClick={() => sel && act({ type: 'SHIP_CARGO', lotId: lot.id, to: sel.d.id, vesselAssetId: useFleet && vessels[0] ? vessels[0].id : undefined })}>Affréter et expédier</button>
      </div>
    </div>
  );
}

function FreightMarket() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const act = useStore((s) => s.act);
  const [idx, setIdx] = useState<FreightIndex>('CAPE');
  const months = ffaMonths(g);
  const [mi, setMi] = useState(months[1] ?? months[0]!);
  const [days, setDays] = useState(30);
  const fair = ffaFair(g, idx, months.includes(mi) ? mi : months[0]!);
  return (
    <div>
      <div className="freight-grid">
        {FREIGHT_IDS.map((i) => {
          const series = g.market.history.slice(-80).map((h) => Math.exp(h.fr?.[i] ?? Math.log(FREIGHT[i].mean)));
          return (
            <button key={i} className={`fr-card ${idx === i ? 'on' : ''}`} onClick={() => setIdx(i)}>
              <b>{FREIGHT[i].name}</b>
              <span className="big">{Math.round(freightRate(g.market, i)).toLocaleString('fr-FR')} $/j</span>
              <Sparkline data={series} width={110} height={26} color={FREIGHT[i].color} />
              <small className="muted">moyenne {FREIGHT[i].mean.toLocaleString('fr-FR')} $/j</small>
            </button>
          );
        })}
      </div>
      <p className="muted small">Le <Term id="tce">taux d’affrètement</Term> est très volatil : il est à la fois un coût (vos expéditions) et un marché. Les <Term id="ffa">FFA</Term> permettent de couvrir ou de spéculer sur la moyenne mensuelle de l’indice.</p>
      <h4>Courbe FFA {FREIGHT[idx].name}</h4>
      <div className="chips months">
        {months.map((m) => <button key={m} className={m === mi ? 'on' : ''} onClick={() => setMi(m)}>{monthLabel(m)} · {Math.round(ffaFair(g, idx, m) / 100) / 10}k</button>)}
      </div>
      <div className="ticket">
        <div className="ticket-row">
          <span>FFA {FREIGHT[idx].name} {monthLabel(mi)} · juste valeur <b>{Math.round(fair).toLocaleString('fr-FR')} $/jour</b></span>
          <div className="lots"><input type="number" min={1} value={days} onChange={(e) => setDays(Math.max(1, Math.floor(Number(e.target.value) || 1)))} /><span className="muted">jours</span></div>
        </div>
        <div className="offer-actions">
          <button className="primary buy" onClick={() => act({ type: 'TRADE_FFA', index: idx, month: mi, days })}>Acheter du fret</button>
          <button className="primary sell" onClick={() => act({ type: 'TRADE_FFA', index: idx, month: mi, days: -days })}>Vendre du fret</button>
        </div>
      </div>
      {g.ffa.length > 0 && (
        <table className="tbl">
          <thead><tr><th>FFA</th><th>Jours</th><th>Prix</th><th>Juste valeur</th><th>MTM</th></tr></thead>
          <tbody>{g.ffa.map((p) => <tr key={p.id}><td>{FREIGHT[p.index].name} {monthLabel(p.month)}</td><td className={p.days > 0 ? 'pos' : 'neg'}>{p.days}</td><td>{p.price.toLocaleString('fr-FR')}</td><td>{Math.round(ffaFair(g, p.index, p.month)).toLocaleString('fr-FR')}</td><td className={tone(ffaValue(g, p))}>{signedUsd(ffaValue(g, p))}</td></tr>)}</tbody>
        </table>
      )}
    </div>
  );
}

function Fleet() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const act = useStore((s) => s.act);
  const vessels = g.assets.filter((a) => ASSET_DEF_BY_ID[a.defId]!.type === 'vessel');
  const locs = [...new Set(g.inventory.map((l) => l.locationId))];
  return (
    <div>
      <h4>Flotte</h4>
      {vessels.length === 0 && <div className="empty">Pas de navire. Achetez-en un ou affrétez-en un à temps dans « Actifs ».</div>}
      {vessels.map((a) => {
        const d = ASSET_DEF_BY_ID[a.defId]!;
        return (
          <div key={a.id} className="ship-card">
            <b>{d.name}</b> {a.tcEndDay && <span className="badge">affrété à temps jusqu’au {formatDayShort(a.tcEndDay)} · {a.hire?.toLocaleString('fr-FR')} $/j</span>}
            <div className="muted small">{FREIGHT[d.freightIndex!].vessel} · TCE du marché {Math.round(freightRate(g.market, d.freightIndex!)).toLocaleString('fr-FR')} $/j{(a.busyUntil ?? 0) >= g.day ? ` · en voyage jusqu’au ${formatDayShort(a.busyUntil!)}` : ''}</div>
            <div className="seg">
              <button className={a.vesselMode === 'charter' ? 'on' : ''} onClick={() => act({ type: 'SET_ASSET', id: a.id, vesselMode: 'charter' })}>Affréter au marché</button>
              <button className={a.vesselMode === 'own' ? 'on' : ''} onClick={() => act({ type: 'SET_ASSET', id: a.id, vesselMode: 'own' })}>Réserver à nos cargaisons</button>
            </div>
          </div>
        );
      })}
      <h4>Stockage</h4>
      {locs.length === 0 ? <div className="empty">Aucun stock.</div> : (
        <table className="tbl">
          <thead><tr><th>Lieu</th><th>Stock</th><th>Capacité détenue</th><th>Tarif tiers</th></tr></thead>
          <tbody>
            {locs.map((loc) => {
              const c = g.inventory.find((l) => l.locationId === loc)!.commodity;
              const q = g.inventory.filter((l) => l.locationId === loc).reduce((s, l) => s + l.qty, 0);
              return <tr key={loc}><td>{findLocation(c, loc).label}</td><td>{qty(c, q)}</td><td>{qty(c, ownedCapacity(g, loc))}</td><td>{price(c, storageRate(g, c))} {COMMODITIES[c].priceUnit}/mois</td></tr>;
            })}
          </tbody>
        </table>
      )}
      <p className="muted small">Le stockage tiers renchérit quand la courbe est en contango : tout le monde veut stocker. Posséder ses cuves protège de cette hausse et loue la capacité inutilisée.</p>
    </div>
  );
}
