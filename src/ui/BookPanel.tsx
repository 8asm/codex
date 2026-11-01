import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES, COMMODITY_IDS, findLocation } from '../data/commodities';
import { COUNTERPARTY_BY_ID } from '../data/counterparties';
import { formatDayShort, monthLabel } from '../engine/calendar';
import { listedMonths } from '../engine/contracts';
import { futuresPrice } from '../engine/market';
import { exposures, forwardMtm, futuresPnlVsEntry, inventoryValue, localSpot, nav } from '../engine/valuation';
import { optionUnitPrice, optionValueUsd, otcValueUsd } from '../engine/derivatives';
import { lotQty } from '../engine/contracts';
import { fx } from '../engine/market';
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
  const exps = exposures(g).filter((e) => e.futuresQty || e.forwardQty || e.inventoryQty || e.optionQty || e.otcQty);
  const empty = !g.futures.length && !g.forwards.length && !g.inventory.length && !g.options.length && !g.otc.length;

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
            <thead><tr><th /><th>Futures</th><th>Physique à terme</th><th>Stocks</th><th>Options & OTC (Δ)</th><th>Net</th><th>Δ pour +1 %</th><th /></tr></thead>
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
                    <td>{qty(e.commodity, e.optionQty + e.otcQty)}</td>
                    <td><b>{qty(e.commodity, e.netQty)}</b>{gross > 0 && <div className="hedge-bar" title={`Ratio de couverture ${(ratio * 100).toFixed(0)} %`}><div style={{ width: `${Math.min(100, ratio * 50)}%` }} /></div>}</td>
                    <td className={tone(e.delta1pct)}>{signedUsd(e.delta1pct)}</td>
                    <td><button className="small" onClick={() => act({ type: 'HEDGE_DELTA', commodity: e.commodity })} title="Vendre/acheter des futures (front) pour annuler le delta">Neutraliser Δ</button></td>
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

      {g.options.length > 0 && (
        <>
          <h4><Term id="option">Options listées</Term> <small className="muted">(prime payée, marge SPAN sur les ventes)</small></h4>
          <table className="tbl">
            <thead><tr><th>Option</th><th>Lots</th><th>Prime</th><th>Valeur</th><th>P&L</th><th /></tr></thead>
            <tbody>
              {g.options.map((o) => {
                const spec = COMMODITIES[o.commodity];
                const unit = optionUnitPrice(g.market, o);
                const pnl = (unit - o.avgPremium) * o.lots * lotQty(spec, o.month) * spec.valuePerUnit * fx(g.market, spec.currency);
                return (
                  <tr key={o.id}>
                    <td>{spec.icon} {o.type === 'C' ? 'Call' : 'Put'} {spec.short} {monthLabel(o.month)} {o.strike}<div className="muted small">{o.style === 'A' ? 'américaine' : 'européenne'} · exp. {formatDayShort(o.expiry)}</div></td>
                    <td className={o.lots > 0 ? 'pos' : 'neg'}>{o.lots > 0 ? '+' : ''}{o.lots}</td>
                    <td>{price(o.commodity, o.avgPremium)}</td>
                    <td>{usd(optionValueUsd(g.market, o))}</td>
                    <td className={tone(pnl)}>{signedUsd(pnl)}</td>
                    <td className="actions">
                      {o.style === 'A' && o.lots > 0 && <button className="small" onClick={() => act({ type: 'EXERCISE_OPTION', id: o.id })}>Exercer</button>}
                      <button className="small" onClick={() => act({ type: 'TRADE_OPTION', commodity: o.commodity, month: o.month, optType: o.type, strike: o.strike, lots: -o.lots })}>Clôturer</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}

      {g.otc.length > 0 && (
        <>
          <h4>OTC <small className="muted">(réglés sur la moyenne du mois, sans marge)</small></h4>
          <table className="tbl">
            <thead><tr><th>Contrat</th><th>Qté</th><th>Fixe / strike</th><th>Banque</th><th>MTM</th></tr></thead>
            <tbody>
              {g.otc.map((x) => (
                <tr key={x.id}>
                  <td>{COMMODITIES[x.commodity].icon} {x.kind === 'swap' ? 'Swap' : `APO ${x.type === 'C' ? 'call' : 'put'}`} {COMMODITIES[x.commodity].short} {monthLabel(x.month)}</td>
                  <td className={x.qty > 0 ? 'pos' : 'neg'}>{qty(x.commodity, x.qty)}</td>
                  <td>{price(x.commodity, x.strike)}</td>
                  <td className="small">{COUNTERPARTY_BY_ID[x.bankId]?.name}</td>
                  <td className={tone(otcValueUsd(g, x) - (x.kind === 'apo' ? 0 : 0))}>{signedUsd(otcValueUsd(g, x))}</td>
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
