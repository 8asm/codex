import { useMemo, useState } from 'react';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { monthLabel } from '../engine/calendar';
import { COVENANT_VAR_PCT } from '../engine/limits';
import { bookGreeks, deltaLadder, runStress } from '../engine/risk';
import type { CommodityId, PnlExplain } from '../engine/types';
import { nav } from '../engine/valuation';
import { Panel, Term } from './common';
import { useLiveVar } from './derived';
import { qty, signedUsd, tone, usd } from './format';
import { useStore } from './store';

export function RiskPanel() {
  const g = useStore((s) => s.game)!;
  const rev = useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const live = useLiveVar();
  const greeks = useMemo(() => bookGreeks(g), [g, rev]);
  const stress = useMemo(() => runStress(g), [g, rev]);
  const n = nav(g);
  const lim = g.risk.limits;
  const covenant = COVENANT_VAR_PCT * Math.max(0, n);
  const internal = lim.varPctNav * Math.max(0, n);
  const v = live?.var99 ?? 0;
  const [ladderC, setLadderC] = useState<CommodityId>(useStore.getState().commodity);
  const ladder = deltaLadder(g, ladderC);
  const active = greeks.filter((x) => Math.abs(x.delta1pct) > 1 || Math.abs(x.vega) > 1);
  const mtd = n - g.risk.monthStartNav;

  return (
    <Panel title="Risque" icon="🛡️" onClose={() => setPanel('risk')} wide>
      {g.risk.breaches.length > 0 && (
        <div className="callout danger">
          ⚠️ Limites dépassées : {g.risk.breaches.map((b) => ({ covenant: 'covenant bancaire', var: 'VaR interne', stoploss: 'stop-loss mensuel' } as Record<string, string>)[b] ?? `delta ${COMMODITIES[b.split(':')[1] as CommodityId]?.short}`).join(', ')}
          {g.risk.rcfFrozen && ' · RCF GELÉE par la banque'}
        </div>
      )}
      <div className="stats">
        <div className="stat">
          <div className="stat-label"><Term id="var">VaR 99 % 1 jour</Term></div>
          <div className="stat-value">{usd(v, 2)}</div>
          <div className="stat-sub">ES 99 % : {usd(live?.es99 ?? 0, 2)} · {(v / Math.max(1, n) * 100).toFixed(2)} % des fonds propres</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Term id="covenant">Covenant bancaire</Term> (8 %)</div>
          <LimitBar value={v} limit={covenant} />
          <div className="stat-sub">{usd(covenant)} · jours en dépassement : {g.risk.covenantBreachDays}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Limite interne de VaR</div>
          <LimitBar value={v} limit={internal} />
          <div className="stat-sub">{usd(internal)} ({(lim.varPctNav * 100).toFixed(1)} %)</div>
        </div>
        <div className="stat">
          <div className="stat-label"><Term id="stoploss">Stop-loss mensuel</Term></div>
          <LimitBar value={Math.max(0, -mtd)} limit={lim.stopLossPctNav * g.risk.monthStartNav} />
          <div className="stat-sub">P&L du mois : <span className={tone(mtd)}>{signedUsd(mtd)}</span></div>
        </div>
      </div>

      <h4><Term id="greeks">Greeks</Term> du livre</h4>
      {active.length === 0 ? <div className="empty">Aucune exposition.</div> : (
        <table className="tbl">
          <thead><tr><th /><th><Term id="delta">Δ</Term> +1 %</th><th>Δ physique</th><th><Term id="gamma">Γ</Term> +1 %</th><th><Term id="vega">Vega</Term> +1 pt</th><th><Term id="theta">Θ</Term> / j</th><th>VaR seule</th><th /></tr></thead>
          <tbody>
            {active.map((x) => (
              <tr key={x.commodity}>
                <td>{COMMODITIES[x.commodity].icon} {COMMODITIES[x.commodity].short}</td>
                <td className={tone(x.delta1pct)}>{signedUsd(x.delta1pct)}</td>
                <td>{qty(x.commodity, x.deltaUnits)}</td>
                <td className={tone(x.gamma1pct)}>{signedUsd(x.gamma1pct)}</td>
                <td className={tone(x.vega)}>{signedUsd(x.vega)}</td>
                <td className={tone(x.theta)}>{signedUsd(x.theta)}</td>
                <td>{usd(live?.varBy[x.commodity] ?? 0)}</td>
                <td><button className="small" onClick={() => act({ type: 'HEDGE_DELTA', commodity: x.commodity })} title="Neutraliser le delta avec le front">Neutraliser Δ</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        La somme des VaR par commodité dépasse la VaR totale : c’est l’effet de <Term id="diversification">diversification</Term>.
      </p>

      <h4><Term id="ladder">Échéancier des deltas</Term></h4>
      <div className="chips">
        {COMMODITY_IDS.map((c) => <button key={c} className={ladderC === c ? 'on' : ''} onClick={() => setLadderC(c)}>{COMMODITIES[c].icon}</button>)}
      </div>
      <Ladder c={ladderC} rows={ladder} />

      <h4><Term id="stress">Stress tests</Term></h4>
      <table className="tbl">
        <tbody>
          {stress.map(({ s, pnl }) => (
            <tr key={s.id}>
              <td><b>{s.name}</b><div className="muted small">{s.desc}</div></td>
              <td className={tone(pnl)} style={{ whiteSpace: 'nowrap' }}>{signedUsd(pnl, 2)}</td>
              <td style={{ width: 90 }}><div className="hbar"><div className={pnl < 0 ? 'neg' : 'pos'} style={{ width: `${Math.min(100, (Math.abs(pnl) / Math.max(1, n)) * 400)}%` }} /></div></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4><Term id="explain">P&L expliqué</Term></h4>
      <Explain rows={g.explain} />

      <h4>Limites internes</h4>
      <Limits />
    </Panel>
  );
}

function LimitBar({ value, limit }: { value: number; limit: number }) {
  const r = limit > 0 ? value / limit : 0;
  return (
    <div className={`limitbar ${r > 1 ? 'over' : r > 0.8 ? 'warn' : ''}`}>
      <div style={{ width: `${Math.min(100, r * 100)}%` }} />
      <span>{Math.round(r * 100)} %</span>
    </div>
  );
}

function Ladder({ c, rows }: { c: CommodityId; rows: { month: number; qty: number }[] }) {
  if (!rows.length) return <div className="empty">Pas d’exposition sur cette commodité.</div>;
  const max = Math.max(...rows.map((r) => Math.abs(r.qty)), 1);
  const net = rows.reduce((s, r) => s + r.qty, 0);
  return (
    <div className="ladder">
      {rows.map((r) => (
        <div key={r.month} className="ladder-row">
          <span className="lm">{monthLabel(r.month)}</span>
          <div className="lbar">
            <div className="mid" />
            <div className={r.qty >= 0 ? 'pos' : 'neg'} style={{ width: `${(Math.abs(r.qty) / max) * 50}%`, left: r.qty >= 0 ? '50%' : `${50 - (Math.abs(r.qty) / max) * 50}%` }} />
          </div>
          <span className="lq">{qty(c, r.qty)}</span>
        </div>
      ))}
      <div className="muted small">Net : <b>{qty(c, net)}</b>. Un livre « plat » au total peut cacher un gros risque de calendrier mois par mois.</div>
    </div>
  );
}

function Explain({ rows }: { rows: PnlExplain[] }) {
  const last = rows[rows.length - 1];
  if (!last) return <div className="empty">Disponible après la première clôture.</div>;
  const cum = rows.slice(-20).reduce((a, r) => ({ price: a.price + r.price, basis: a.basis + r.basis, fx: a.fx + r.fx, vol: a.vol + r.vol, time: a.time + r.time, other: a.other + r.other, total: a.total + r.total }), { price: 0, basis: 0, fx: 0, vol: 0, time: 0, other: 0, total: 0 });
  const keys: [keyof typeof cum, string, string][] = [
    ['price', 'Prix', 'Mouvements des courbes'],
    ['basis', 'Base', 'Différentiels physiques'],
    ['fx', 'Change', 'EURUSD'],
    ['vol', 'Vol', 'Vol implicite'],
    ['time', 'Temps', 'Theta, actualisation'],
    ['other', 'Deals & coûts', 'Nouveaux deals, commissions, intérêts, frais'],
  ];
  return (
    <table className="tbl">
      <thead><tr><th /><th>Dernier jour</th><th>20 derniers jours</th></tr></thead>
      <tbody>
        {keys.map(([k, label, tip]) => (
          <tr key={k}><td title={tip}>{label} <span className="muted small">{tip}</span></td><td className={tone(last[k])}>{signedUsd(last[k])}</td><td className={tone(cum[k])}>{signedUsd(cum[k])}</td></tr>
        ))}
        <tr><td><b>Total</b></td><td className={tone(last.total)}><b>{signedUsd(last.total)}</b></td><td className={tone(cum.total)}><b>{signedUsd(cum.total)}</b></td></tr>
      </tbody>
    </table>
  );
}

function Limits() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const l = g.risk.limits;
  const set = (patch: Partial<typeof l>) => act({ type: 'SET_LIMITS', limits: patch }, true);
  return (
    <div className="limits">
      <label>VaR max <b>{(l.varPctNav * 100).toFixed(1)} %</b> des fonds propres<input type="range" min={0.5} max={10} step={0.5} value={l.varPctNav * 100} onChange={(e) => set({ varPctNav: Number(e.target.value) / 100 })} /></label>
      <label>Stop-loss mensuel <b>{(l.stopLossPctNav * 100).toFixed(0)} %</b><input type="range" min={2} max={30} step={1} value={l.stopLossPctNav * 100} onChange={(e) => set({ stopLossPctNav: Number(e.target.value) / 100 })} /></label>
      <label>Delta max par commodité <b>{(l.deltaPctNav * 100).toFixed(1)} %</b> des fonds propres pour +1 %<input type="range" min={0.5} max={10} step={0.5} value={l.deltaPctNav * 100} onChange={(e) => set({ deltaPctNav: Number(e.target.value) / 100 })} /></label>
      <label className="toggle"><input type="checkbox" checked={l.strict} onChange={(e) => set({ strict: e.target.checked })} /> Discipline stricte <span className="muted small">(refuse tout ordre qui aggrave une limite dépassée)</span></label>
    </div>
  );
}
