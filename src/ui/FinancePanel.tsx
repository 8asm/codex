import { COMMODITIES } from '../data/commodities';
import { COUNTERPARTY_BY_ID } from '../data/counterparties';
import { findLocation } from '../data/commodities';
import { formatDayShort } from '../engine/calendar';
import { cpRating } from '../engine/credit';
import { banksCut, haircutFor, lcLine, lcUsed, LOAN_SPREAD, prepayTerms, prepayValue } from '../engine/financing';
import { rate } from '../engine/market';
import { inventoryValue, nav } from '../engine/valuation';
import { Panel, Term } from './common';
import { qty as fmtQty, usd } from './format';
import { useStore } from './store';

export function FinancePanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const f = g.financing;
  const v = nav(g);
  const line = lcLine(g, v);
  const used = lcUsed(g);
  const r = rate(g.market, 'USD');
  const cut = banksCut(g);
  return (
    <Panel title="Financement" icon="🏧" onClose={() => setPanel('finance')} wide>
      <p className="muted small">Le négoce vit à crédit : les banques garantissent les paiements, financent les stocks, et vous pouvez vous-même préfinancer des producteurs. Chaque outil a un coût et un risque.</p>
      {cut && <p className="warn">⛔ Les banques ont coupé vos lignes jusqu’au {formatDayShort(g.compliance.banksCutUntil)} : plus de lettres de crédit, de prêts sur stock ni de tirages RCF.</p>}

      <h4><Term id="lc">Crédits documentaires</Term></h4>
      <div className="preview">
        <div><span>Ligne de financement du commerce</span><b>{usd(line)}</b></div>
        <div><span>Utilisée</span><b>{usd(used)}</b></div>
        <div><span>Commission</span><b>0,15 % + 0,08 %/mois</b></div>
      </div>
      {f.lcs.length > 0 && (
        <table className="tbl small"><tbody>
          {f.lcs.map((l) => <tr key={l.id}><td>LC {l.id}</td><td>{usd(l.amount)}</td><td>jusqu’au {formatDayShort(l.expiry)}</td></tr>)}
        </tbody></table>
      )}

      <h4><Term id="borrowingbase">Financement de stock</Term></h4>
      <p className="muted small">La banque prête (1 − décote) × la valeur du lot au taux USD + {(LOAN_SPREAD * 100).toFixed(2)} % (aujourd’hui {((r + LOAN_SPREAD) * 100).toFixed(2)} %), moins cher que la RCF. Si le prix baisse, appel de marge ; la vente du lot rembourse le prêt.</p>
      {g.inventory.length === 0 ? <div className="empty">Aucun stock à nantir.</div> : (
        <table className="tbl">
          <thead><tr><th>Lot</th><th>Valeur</th><th>Décote</th><th>Prêt</th><th /></tr></thead>
          <tbody>
            {g.inventory.map((l) => {
              const loan = f.loans.find((x) => x.lotId === l.id);
              const val = inventoryValue(g, l);
              return (
                <tr key={l.id}>
                  <td>{COMMODITIES[l.commodity].icon} {fmtQty(l.commodity, l.qty)} · {findLocation(l.commodity, l.locationId).label}{(l.quality ?? 1) < 1 ? ' · hors spéc.' : ''}</td>
                  <td>{usd(val)}</td>
                  <td>{Math.round(haircutFor(l.commodity) * 100)} %</td>
                  <td>{loan ? <>{usd(loan.principal)} <span className="muted small">(LTV {Math.round((loan.principal / Math.max(1, val)) * 100)} %)</span></> : '—'}</td>
                  <td>{loan ? <button onClick={() => act({ type: 'REPAY_LOAN', id: loan.id })}>Rembourser</button> : <button disabled={cut} onClick={() => act({ type: 'FINANCE_LOT', lotId: l.id })}>Financer {usd((1 - haircutFor(l.commodity)) * val)}</button>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h4><Term id="prepay">Préfinancements</Term></h4>
      <p className="muted small">Payez un producteur aujourd’hui contre des livraisons mensuelles décotées. Vous devenez acheteur à terme (à couvrir) et créancier du producteur (risque de défaut).</p>
      {f.offers.length === 0 && <div className="empty">Pas de demande de préfinancement ce mois-ci.</div>}
      {f.offers.map((o) => {
        const t = prepayTerms(g, o);
        const spec = COMMODITIES[o.commodity];
        const cp = COUNTERPARTY_BY_ID[o.counterpartyId];
        return (
          <div key={o.id} className="offer" style={{ ['--c' as string]: spec.color }}>
            <div className="offer-top">
              <span className="mkt-icon">{spec.icon}</span>
              <div className="offer-title"><b>{cp?.name}</b> <span className="rating">{cpRating(g, o.counterpartyId)}</span> demande un préfinancement : {fmtQty(o.commodity, o.qtyPerMonth)} par mois pendant {o.months} mois, livrés {findLocation(o.commodity, o.locationId).label}</div>
            </div>
            <div className="offer-grid">
              <div><span>À verser</span><b>{usd(t.paid)}</b></div>
              <div><span>Valeur au forward</span><b>{usd(t.pv)}</b></div>
              <div><span>Décote</span><b>{(o.discount * 100).toFixed(1)} %</b></div>
              <div><span>Spread implicite</span><b>{(t.spread * 100).toFixed(2)} %/an</b></div>
            </div>
            <div className="offer-actions"><span className="muted small">expire le {formatDayShort(o.expiresDay)}</span><button className="primary" onClick={() => act({ type: 'ACCEPT_PREPAY', offerId: o.id })}>Préfinancer</button></div>
          </div>
        );
      })}
      {f.prepays.length > 0 && (
        <table className="tbl">
          <thead><tr><th>Producteur</th><th>Reste à livrer</th><th>Prochaine livraison</th><th>Valeur</th></tr></thead>
          <tbody>
            {f.prepays.map((p) => (
              <tr key={p.id}>
                <td>{COUNTERPARTY_BY_ID[p.counterpartyId]?.name} <span className="rating">{cpRating(g, p.counterpartyId)}</span></td>
                <td>{fmtQty(p.commodity, p.schedule.reduce((s, x) => s + x.qty, 0))}</td>
                <td>{p.schedule[0] ? formatDayShort(p.schedule[0].day) : '—'}</td>
                <td>{usd(prepayValue(g, p))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
