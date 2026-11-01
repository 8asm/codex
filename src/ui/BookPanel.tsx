import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES, COMMODITY_IDS, findLocation } from '../data/commodities';
import { COUNTERPARTY_BY_ID } from '../data/counterparties';
import { formatDayShort, monthLabel } from '../engine/calendar';
import { listedMonths } from '../engine/contracts';
import { futuresPrice } from '../engine/market';
import { exposures, forwardMtm, futuresPnlVsEntry, inventoryValue, localSpot, nav } from '../engine/valuation';
import { Panel, Sparkline, Term } from './common';
import { price, qty, signedUsd, tone, usd } from './format';
import { useStore } from './store';

export function BookPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const select = useStore((s) => s.selectCommodity);
  const last = g.history[g.history.length - 1];
  const navSeries = g.history.slice(-250).map((h) => h.nav);
  const exps = exposures(g).filter((e) => e.futuresQty || e.forwardQty || e.inventoryQty);
  const empty = !g.futures.length && !g.forwards.length && !g.inventory.length;

  const roll = (c: (typeof g.futures)[number]) => {
    const months = listedMonths(COMMODITIES[c.commodity], g.day);
    const next = months[months.indexOf(c.month) + 1];
    if (next === undefined) return;
    const lots = c.lots;
    const r = act({ type: 'TRADE_FUTURE', commodity: c.commodity, month: c.month, lots: -lots }, true);
    if (r.ok) act({ type: 'TRADE_FUTURE', commodity: c.commodity, month: next, lots });
  };

  return (
    <Panel title="Livre de positions" icon="📒" onClose={() => setPanel('book')} wide>
      <div className="book-top">
        <div>
          <div className="muted small"><Term id="nav">Fonds propres</Term></div>
          <div className="big-num">{usd(nav(g), 2)}</div>
          <Sparkline data={navSeries} width={220} height={44} color="#ffd166" />
        </div>
        <div className="pnl-by">
          <div className="muted small">P&L du jour par commodité</div>
          {COMMODITY_IDS.map((c) => (
            <div key={c} className="pnl-row">
              <span>{COMMODITIES[c].icon} {COMMODITIES[c].short}</span>
              <b className={tone(last?.pnlBy[c] ?? 0)}>{signedUsd(last?.pnlBy[c] ?? 0)}</b>
            </div>
          ))}
        </div>
      </div>

      {empty && <div className="empty">Aucune position. Commencez par un <b>Marchés</b> → future, ou une cargaison dans <b>Physique</b>.</div>}

      {exps.length > 0 && (
        <>
          <h4>Exposition nette (prix) — le cœur du <Term id="hedge">hedging</Term></h4>
          <table className="tbl">
            <thead><tr><th /><th>Futures</th><th>Physique à terme</th><th>Stocks</th><th>Net</th><th>Δ pour +1 %</th></tr></thead>
            <tbody>
              {exps.map((e) => {
                const gross = Math.abs(e.forwardQty + e.inventoryQty);
                const ratio = gross ? Math.min(2, Math.abs(e.futuresQty) / gross) : 0;
                return (
                  <tr key={e.commodity}>
                    <td>{COMMODITIES[e.commodity].icon} {COMMODITIES[e.commodity].short}</td>
                    <td>{qty(e.commodity, e.futuresQty)}</td>
                    <td>{qty(e.commodity, e.forwardQty)}</td>
                    <td>{qty(e.commodity, e.inventoryQty)}</td>
                    <td><b>{qty(e.commodity, e.netQty)}</b>{gross > 0 && <div className="hedge-bar" title={`Ratio de couverture ${(ratio * 100).toFixed(0)} %`}><div style={{ width: `${Math.min(100, ratio * 50)}%` }} /></div>}</td>
                    <td className={tone(e.delta1pct)}>{signedUsd(e.delta1pct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {g.futures.length > 0 && (
        <>
          <h4><Term id="futures">Futures</Term> <small className="muted">(marge de variation réglée chaque soir)</small></h4>
          <table className="tbl">
            <thead><tr><th>Contrat</th><th>Lots</th><th>Entrée</th><th>Marché</th><th>P&L</th><th /></tr></thead>
            <tbody>
              {g.futures.map((p) => (
                <tr key={`${p.commodity}${p.month}`}>
                  <td className="link" onClick={() => { select(p.commodity, p.month); setPanel('market'); }}>{COMMODITIES[p.commodity].icon} {COMMODITIES[p.commodity].short} {monthLabel(p.month)}</td>
                  <td className={p.lots > 0 ? 'pos' : 'neg'}>{p.lots > 0 ? '+' : ''}{p.lots}</td>
                  <td>{price(p.commodity, p.avgPrice)}</td>
                  <td>{price(p.commodity, futuresPrice(g.market, p.commodity, p.month))}</td>
                  <td className={tone(futuresPnlVsEntry(g, p))}>{signedUsd(futuresPnlVsEntry(g, p))}</td>
                  <td className="actions">
                    <button className="small" title="Rouler vers l'échéance suivante" onClick={() => roll(p)}><Term id="roll">Roll</Term> →</button>
                    <button className="small" onClick={() => act({ type: 'TRADE_FUTURE', commodity: p.commodity, month: p.month, lots: -p.lots })}>Clôturer</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {g.forwards.length > 0 && (
        <>
          <h4><Term id="forward">Physique à terme</Term> <small className="muted">(latent jusqu’à livraison)</small></h4>
          <table className="tbl">
            <thead><tr><th>Deal</th><th>Qté</th><th>Prix</th><th>Livraison</th><th>MTM</th></tr></thead>
            <tbody>
              {g.forwards.map((d) => (
                <tr key={d.id}>
                  <td>{d.side > 0 ? 'Achat' : 'Vente'} {COMMODITIES[d.commodity].short} {findLocation(d.commodity, d.locationId).label}<div className="muted small">{COUNTERPARTY_BY_ID[d.counterpartyId]?.name}</div></td>
                  <td>{qty(d.commodity, d.qty)}</td>
                  <td>{price(d.commodity, d.price)}</td>
                  <td>{monthLabel(d.month)} <small className="muted">{formatDayShort(d.deliveryDay)}</small></td>
                  <td className={tone(forwardMtm(g, d))}>{signedUsd(forwardMtm(g, d))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {g.inventory.length > 0 && (
        <>
          <h4>Stocks <small className="muted">(frais de stockage quotidiens)</small></h4>
          <table className="tbl">
            <thead><tr><th>Lieu</th><th>Qté</th><th>Revient</th><th>Spot local</th><th>Valeur</th><th /></tr></thead>
            <tbody>
              {g.inventory.map((l) => {
                const loc = findLocation(l.commodity, l.locationId);
                return (
                  <tr key={l.id}>
                    <td>{COMMODITIES[l.commodity].icon} {loc.label}<div className="muted small">{CITY_BY_ID[loc.cityId]!.name}</div></td>
                    <td>{qty(l.commodity, l.qty)}</td>
                    <td>{price(l.commodity, l.cost)}</td>
                    <td>{price(l.commodity, localSpot(g, l.commodity, l.locationId))}</td>
                    <td>{usd(inventoryValue(g, l))}</td>
                    <td><button className="small" onClick={() => act({ type: 'SPOT_SELL', lotId: l.id })}>Vendre spot</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Panel>
  );
}
