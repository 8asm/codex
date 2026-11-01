import { useEffect, useState } from 'react';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { formatDayShort, monthLabel } from '../engine/calendar';
import { listedMonths } from '../engine/contracts';
import { quote } from '../engine/liquidity';
import { futuresPrice, pastCurve } from '../engine/market';
import { previewFuture, previewSpread } from '../engine/trading';
import { computeVar } from '../engine/risk';
import { nav } from '../engine/valuation';
import { Portrait } from './Advisors';
import { bookWithFuture, useLiveVar } from './derived';
import type { CommodityId } from '../engine/types';
import { Panel, Sparkline, Term } from './common';
import { constantMaturitySeries, curveShape, prevPrice } from './derived';
import { pct, price, qty, signedUsd, tone, usd } from './format';
import { useStore } from './store';

export function MarketPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const c = useStore((s) => s.commodity);
  const select = useStore((s) => s.selectCommodity);
  const setPanel = useStore((s) => s.setPanel);

  return (
    <Panel title="Marchés" icon="📈" onClose={() => setPanel('market')} wide>
      <div className="mkt-list">
        {COMMODITY_IDS.map((id) => {
          const spec = COMMODITIES[id];
          const mi = listedMonths(spec, g.day)[0]!;
          const p = futuresPrice(g.market, id, mi);
          const prev = prevPrice(g.market, id, mi);
          const ch = prev ? p / prev - 1 : 0;
          return (
            <button key={id} className={`mkt-row ${c === id ? 'on' : ''}`} onClick={() => select(id)} style={{ ['--c' as string]: spec.color }}>
              <span className="mkt-icon">{spec.icon}</span>
              <span className="mkt-name">{spec.short}<small>{monthLabel(mi)}</small></span>
              <Sparkline data={constantMaturitySeries(g.market, id, 60)} color={spec.color} width={70} height={24} />
              <span className="mkt-px">{price(id, p)}<small>{spec.priceUnit}</small></span>
              <span className={`mkt-ch ${tone(ch)}`}>{pct(ch)}</span>
            </button>
          );
        })}
      </div>
      <CurveAndTicket c={c} />
    </Panel>
  );
}

function CurveAndTicket({ c }: { c: CommodityId }) {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const month = useStore((s) => s.month);
  const select = useStore((s) => s.selectCommodity);
  const spec = COMMODITIES[c];
  const months = listedMonths(spec, g.day);
  const prices = months.map((mi) => futuresPrice(g.market, c, mi));
  const ghost = pastCurve(g.market, c, 30, months);
  const shape = curveShape(prices);
  const sel = month !== null && months.includes(month) ? month : months[0]!;

  return (
    <div className="curve-ticket">
      <div className="curve-head">
        <div>
          <h3 style={{ color: spec.color }}>{spec.icon} {spec.name}</h3>
          <div className="muted">{spec.exchange} · lot <Term id="lot">{qty(c, spec.lot.kind === 'fixed' ? spec.lot.qty : 720)}</Term>{spec.lot.kind === 'mwMonth' ? ' (1 MW × heures du mois)' : ''} · {spec.currency}</div>
        </div>
        <div className={`shape ${shape.label}`}>
          <Term id={shape.label === 'plate' ? 'curve' : shape.label}>{shape.label === 'plate' ? 'courbe plate' : shape.label}</Term>
          <small>{pct(shape.slope)} sur 6 échéances</small>
        </div>
      </div>
      <CurveChart prices={prices} ghost={ghost} labels={months.map(monthLabel)} color={spec.color} selected={months.indexOf(sel)} onPick={(i) => select(c, months[i]!)} />
      <div className="muted small">Trait plein : <Term id="curve">courbe forward</Term> du jour · pointillés : il y a 30 jours. Cliquez une échéance pour la trader.</div>
      <TicketSwitch c={c} mi={sel} months={months} />
    </div>
  );
}

function CurveChart({ prices, ghost, labels, color, selected, onPick }: { prices: number[]; ghost: number[] | null; labels: string[]; color: string; selected: number; onPick: (i: number) => void }) {
  const W = 560, H = 170, P = { l: 52, r: 10, t: 12, b: 26 };
  const all = [...prices, ...(ghost ?? [])];
  const min = Math.min(...all), max = Math.max(...all);
  const pad = (max - min) * 0.12 || max * 0.02;
  const y0 = min - pad, y1 = max + pad;
  const x = (i: number) => P.l + (i / Math.max(1, prices.length - 1)) * (W - P.l - P.r);
  const y = (v: number) => P.t + (1 - (v - y0) / (y1 - y0)) * (H - P.t - P.b);
  const path = (arr: number[]) => arr.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const ticks = [y0 + pad, (y0 + y1) / 2, y1 - pad];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="curve-chart">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} className="grid" />
          <text x={P.l - 6} y={y(t) + 4} textAnchor="end" className="axis">{t.toFixed(t > 1000 ? 0 : 2)}</text>
        </g>
      ))}
      {ghost && <path d={path(ghost)} fill="none" stroke="#9fb3c8" strokeDasharray="4 4" strokeWidth={1.4} />}
      <path d={`${path(prices)}L${x(prices.length - 1)},${H - P.b}L${x(0)},${H - P.b}Z`} fill={color} opacity={0.12} />
      <path d={path(prices)} fill="none" stroke={color} strokeWidth={2.4} strokeLinejoin="round" />
      {prices.map((v, i) => (
        <g key={i} onClick={() => onPick(i)} className="pt">
          <rect x={x(i) - 9} y={P.t} width={18} height={H - P.t - P.b} fill="transparent" />
          <circle cx={x(i)} cy={y(v)} r={i === selected ? 5.5 : 3} fill={i === selected ? '#fff' : color} stroke={color} strokeWidth={2} />
          {(i % Math.ceil(prices.length / 8) === 0 || i === selected) && (
            <text x={x(i)} y={H - 8} textAnchor="middle" className={`axis ${i === selected ? 'sel' : ''}`}>{labels[i]}</text>
          )}
        </g>
      ))}
    </svg>
  );
}

function TicketSwitch({ c, mi, months }: { c: CommodityId; mi: number; months: number[] }) {
  const [mode, setMode] = useState<'outright' | 'spread'>('outright');
  return (
    <>
      <div className="tabs mode">
        <button className={mode === 'outright' ? 'on' : ''} onClick={() => setMode('outright')}>Position sèche</button>
        <button className={mode === 'spread' ? 'on' : ''} onClick={() => setMode('spread')}><Term id="calspread">Spread calendaire</Term></button>
      </div>
      {mode === 'outright' ? <Ticket c={c} mi={mi} /> : <SpreadTicket c={c} near={mi} months={months} />}
    </>
  );
}

function SpreadTicket({ c, near, months }: { c: CommodityId; near: number; months: number[] }) {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const act = useStore((s) => s.act);
  const spec = COMMODITIES[c];
  const others = months.filter((m) => m > near).slice(0, 8);
  const [farSel, setFar] = useState<number | null>(null);
  const far = farSel !== null && others.includes(farSel) ? farSel : others[0];
  const [side, setSide] = useState<1 | -1>(1);
  const [lots, setLots] = useState(10);
  if (far === undefined) return <div className="empty">Choisissez une échéance plus proche pour construire un spread.</div>;
  const pv = previewSpread(g, c, near, far, side * lots);
  const legs = previewFuture(g, c, near, side * lots).slippageUsd + previewFuture(g, c, far, -side * lots).slippageUsd + 2 * previewFuture(g, c, near, lots).commissionUsd;
  return (
    <div className="ticket">
      <div className="ticket-row">
        <div className="seg">
          <button className={side > 0 ? 'on buy' : ''} onClick={() => setSide(1)}>Acheter</button>
          <button className={side < 0 ? 'on sell' : ''} onClick={() => setSide(-1)}>Vendre</button>
        </div>
        <div className="contract">
          <span>Spread {spec.short} <b>{monthLabel(near)} / {monthLabel(far)}</b></span>
          <small>{side > 0 ? 'achat' : 'vente'} de {monthLabel(near)}, {side > 0 ? 'vente' : 'achat'} de {monthLabel(far)}</small>
        </div>
        <div className="lots">
          <button onClick={() => setLots(Math.max(1, lots - (lots > 10 ? 10 : 1)))}>−</button>
          <input type="number" min={1} value={lots} onChange={(e) => setLots(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          <button onClick={() => setLots(lots + (lots >= 10 ? 10 : 1))}>+</button>
        </div>
      </div>
      <div className="chips">{others.map((m) => <button key={m} className={m === far ? 'on' : ''} onClick={() => setFar(m)}>{monthLabel(m)}</button>)}</div>
      <div className="preview">
        <div><span>Spread (mid)</span><b>{price(c, pv.spreadMid)}</b></div>
        <div><span>Spread exécuté</span><b>{price(c, pv.spreadExec)}</b></div>
        <div><span>Coût en un ordre</span><b>{usd(pv.cost)}</b></div>
        <div><span>Coût jambe par jambe</span><b className="neg">{usd(legs)}</b></div>
        <div><span><Term id="spancredit">Marge</Term> après</span><b>{usd(pv.imAfter)}</b></div>
        <div><span>Liquidité restante</span><b className={pv.liquidityAfter < 0 ? 'neg' : ''}>{usd(pv.liquidityAfter)}</b></div>
      </div>
      <p className="muted small">Un spread parie sur la <b>forme</b> de la courbe, pas sur son niveau : il gagne si {monthLabel(near)} {side > 0 ? 'se renchérit' : 'baisse'} par rapport à {monthLabel(far)}.</p>
      <button className={`primary big ${side > 0 ? 'buy' : 'sell'}`} onClick={() => act({ type: 'TRADE_SPREAD', commodity: c, near, far, lots: side * lots })}>
        {side > 0 ? 'Acheter' : 'Vendre'} {lots} spreads {monthLabel(near)}/{monthLabel(far)}
      </button>
    </div>
  );
}

function Reactions({ varBefore, varAfter, lots, depth, limitIssue, navV, limitPct }: { varBefore: number; varAfter: number; lots: number; depth: number; limitIssue: string | null; navV: number; limitPct: number }) {
  const limit = limitPct * navV;
  const ratio = varAfter / Math.max(1, limit);
  const risk = varAfter <= varBefore
    ? { mood: 'happy' as const, t: `Ça réduit notre risque : VaR ${usd(varBefore)} → ${usd(varAfter)}.` }
    : ratio > 1 ? { mood: 'angry' as const, t: `VaR ${usd(varAfter)} : au-delà de notre limite (${usd(limit)}). Non.` }
    : ratio > 0.7 ? { mood: 'worried' as const, t: `VaR ${usd(varAfter)}, soit ${Math.round(ratio * 100)} % de la limite. Ça commence à peser.` }
    : { mood: 'neutral' as const, t: `VaR ${usd(varBefore)} → ${usd(varAfter)}. Acceptable.` };
  const r = Math.abs(lots) / depth;
  const trader = r > 1 ? { mood: 'worried' as const, t: 'Le carnet est trop mince pour ça, on va payer l’impact.' } : r < 0.03 ? { mood: 'smug' as const, t: 'Petit bras…' } : { mood: 'happy' as const, t: 'Ça, c’est une position !' };
  return (
    <div className="reactions">
      <div><Portrait id="risk" mood={risk.mood} size={30} /><span>{risk.t}</span></div>
      <div><Portrait id="trader" mood={trader.mood} size={30} /><span>{trader.t}</span></div>
      {limitIssue && <div><Portrait id="legal" mood="angry" size={30} /><span>{limitIssue} Ordre refusé par la bourse.</span></div>}
    </div>
  );
}

function Ticket({ c, mi }: { c: CommodityId; mi: number }) {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const act = useStore((s) => s.act);
  const spec = COMMODITIES[c];
  const [side, setSide] = useState<1 | -1>(1);
  const [lots, setLots] = useState(10);
  const pos = g.futures.find((p) => p.commodity === c && p.month === mi);
  useEffect(() => setLots((l) => Math.max(1, l)), [c]);
  const pv = previewFuture(g, c, mi, side * lots);
  const q = quote(g.market, c, mi);
  const live = useLiveVar();
  const varAfter = computeVar(g, bookWithFuture(g, c, mi, side * lots, pv.exec)).var99;
  const submit = () => act({ type: 'TRADE_FUTURE', commodity: c, month: mi, lots: side * lots });
  const liqClass = { profonde: 'pos', correcte: 'flat', mince: 'warn', illiquide: 'neg' }[pv.liquidity];

  return (
    <div className="ticket" onKeyDown={(e) => e.key === 'Enter' && submit()}>
      <div className="ticket-row">
        <div className="seg">
          <button className={side > 0 ? 'on buy' : ''} onClick={() => setSide(1)}>Acheter</button>
          <button className={side < 0 ? 'on sell' : ''} onClick={() => setSide(-1)}>Vendre</button>
        </div>
        <div className="contract">
          <span><Term id="futures">Future</Term> {spec.short} <b>{monthLabel(mi)}</b></span>
          <small>bid {price(c, q.bid)} · ask {price(c, q.ask)}</small>
        </div>
        <div className="lots">
          <button onClick={() => setLots(Math.max(1, lots - (lots > 10 ? 10 : 1)))}>−</button>
          <input type="number" min={1} value={lots} onChange={(e) => setLots(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          <button onClick={() => setLots(lots + (lots >= 10 ? 10 : 1))}>+</button>
          <span className="muted">lots</span>
        </div>
      </div>
      <div className="quick">
        {[1, 10, 50, 100, 250].map((n) => <button key={n} className={lots === n ? 'on' : ''} onClick={() => setLots(n)}>{n}</button>)}
        {pos && <button className="close-pos" onClick={() => { setSide(pos.lots > 0 ? -1 : 1); setLots(Math.abs(pos.lots)); }}>Clôturer ({pos.lots > 0 ? '+' : ''}{pos.lots})</button>}
      </div>
      <div className="preview">
        <div><span>Prix d'exécution</span><b>{price(c, pv.exec)} {spec.priceUnit}</b></div>
        <div><span>Équivalent physique</span><b>{qty(c, pv.qty)}</b></div>
        <div><span>Notionnel</span><b>{usd(pv.notionalUsd)}</b></div>
        <div><span><Term id="im">Marge initiale</Term></span><b>{usd(pv.imBefore)} → {usd(pv.imAfter)}</b></div>
        <div><span>Coûts (fourchette + comm.)</span><b>{usd(pv.slippageUsd + pv.commissionUsd)}</b></div>
        <div><span><Term id="liquidity">Liquidité</Term></span><b className={liqClass}>{pv.liquidity} <small>(~{Math.round(pv.depth)} lots)</small></b></div>
        <div><span><Term id="var">Pire cas 2 j (99 %)</Term></span><b className="neg">{signedUsd(-pv.var99_2d)}</b></div>
        <div><span>Choc de 20 %</span><b className="neg">{signedUsd(-pv.stress20)}</b></div>
        <div><span>Liquidité restante</span><b className={pv.liquidityAfter < 0 ? 'neg' : ''}>{usd(pv.liquidityAfter)}</b></div>
        <div><span><Term id="ltd">Dernier jour</Term></span><b>{formatDayShort(pv.ltd)}</b></div>
      </div>
      <Reactions varBefore={live?.var99 ?? 0} varAfter={varAfter} lots={lots} depth={pv.depth} limitIssue={pv.limitIssue} navV={nav(g)} limitPct={g.risk.limits.varPctNav} />
      <button className={`primary big ${side > 0 ? 'buy' : 'sell'}`} disabled={pv.liquidityAfter < 0 && !pos} onClick={submit}>
        {side > 0 ? 'Acheter' : 'Vendre'} {lots} lot{lots > 1 ? 's' : ''} · {monthLabel(mi)}
      </button>
    </div>
  );
}
