import { useState } from 'react';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { formatDayShort, monthLabel } from '../engine/calendar';
import { optionMonths, strikeGrid, optionExpiry } from '../engine/contracts';
import { avgInputs, expectedAverage, optionQuote, otcMonths, otcQuote } from '../engine/derivatives';
import { futuresPrice } from '../engine/market';
import { computeVar } from '../engine/risk';
import { previewOption } from '../engine/trading';
import type { CommodityId, OptType } from '../engine/types';
import { impliedVolAt } from '../engine/volsurface';
import { Panel, Term } from './common';
import { bookWithOption, bookWithOtc, useLiveVar } from './derived';
import { price, qty, signedUsd, usd } from './format';
import { useStore } from './store';

export function OptionsPanel() {
  const setPanel = useStore((s) => s.setPanel);
  const c = useStore((s) => s.commodity);
  const select = useStore((s) => s.selectCommodity);
  const [tab, setTab] = useState<'listed' | 'otc'>('listed');
  return (
    <Panel title="Options & OTC" icon="🎯" onClose={() => setPanel('options')} wide>
      <div className="chips">
        {COMMODITY_IDS.map((id) => (
          <button key={id} className={c === id ? 'on' : ''} onClick={() => select(id)}>{COMMODITIES[id].icon} {COMMODITIES[id].short}</button>
        ))}
      </div>
      <div className="tabs">
        <button className={tab === 'listed' ? 'on' : ''} onClick={() => setTab('listed')}>Options listées (bourse)</button>
        <button className={tab === 'otc' ? 'on' : ''} onClick={() => setTab('otc')}>Swaps & APO (banques)</button>
      </div>
      {tab === 'listed' ? <Listed c={c} /> : <Otc c={c} />}
    </Panel>
  );
}

function Listed({ c }: { c: CommodityId }) {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const spec = COMMODITIES[c];
  const months = optionMonths(spec, g.day);
  const [mSel, setM] = useState<number | null>(null);
  const mi = mSel !== null && months.includes(mSel) ? mSel : months[Math.min(1, months.length - 1)]!;
  const expiry = optionExpiry(spec, mi);
  const F = futuresPrice(g.market, c, mi);
  const strikes = strikeGrid(spec, F, 6);
  const [sel, setSel] = useState<{ type: OptType; strike: number } | null>(null);
  const style = spec.options.style === 'A' ? 'américaines' : 'européennes';
  return (
    <div>
      <div className="chips months">
        {months.map((x) => <button key={x} className={x === mi ? 'on' : ''} onClick={() => setM(x)}>{monthLabel(x)}</button>)}
      </div>
      <div className="muted small">
        Options <Term id="american">{style}</Term> sur le future {spec.short} {monthLabel(mi)} ({price(c, F)} {spec.priceUnit}) · expiration {formatDayShort(expiry)} ·
        vol <Term id="impliedvol">implicite</Term> ATM {(impliedVolAt(g.market, c, mi, expiry, F) * 100).toFixed(1)} %
      </div>
      <SmileChart c={c} mi={mi} expiry={expiry} strikes={strikes} F={F} />
      <table className="tbl chain">
        <thead>
          <tr><th colSpan={4} className="center">CALLS</th><th className="center">Strike</th><th colSpan={4} className="center">PUTS</th></tr>
          <tr><th>Δ</th><th>Vol</th><th>Bid</th><th>Ask</th><th /><th>Bid</th><th>Ask</th><th>Vol</th><th>Δ</th></tr>
        </thead>
        <tbody>
          {strikes.map((K) => {
            const qc = optionQuote(g.market, { commodity: c, month: mi, type: 'C', strike: K, expiry, style: spec.options.style });
            const qp = optionQuote(g.market, { commodity: c, month: mi, type: 'P', strike: K, expiry, style: spec.options.style });
            const atm = Math.abs(K - F) < spec.options.strikeStep * Math.max(1, Math.round(F / spec.options.strikeStep / 40)) / 2;
            const isSel = (t: OptType) => sel?.type === t && sel.strike === K;
            return (
              <tr key={K} className={atm ? 'atm' : ''}>
                <td className="muted">{qc.greeks.delta.toFixed(2)}</td>
                <td className="muted">{(qc.iv * 100).toFixed(1)}</td>
                <td className={`q ${isSel('C') ? 'sel' : ''} ${K < F ? 'itm' : ''}`} onClick={() => setSel({ type: 'C', strike: K })}>{price(c, qc.bid)}</td>
                <td className={`q ${isSel('C') ? 'sel' : ''} ${K < F ? 'itm' : ''}`} onClick={() => setSel({ type: 'C', strike: K })}>{price(c, qc.ask)}</td>
                <td className="strike">{K}</td>
                <td className={`q ${isSel('P') ? 'sel' : ''} ${K > F ? 'itm' : ''}`} onClick={() => setSel({ type: 'P', strike: K })}>{price(c, qp.bid)}</td>
                <td className={`q ${isSel('P') ? 'sel' : ''} ${K > F ? 'itm' : ''}`} onClick={() => setSel({ type: 'P', strike: K })}>{price(c, qp.ask)}</td>
                <td className="muted">{(qp.iv * 100).toFixed(1)}</td>
                <td className="muted">{qp.greeks.delta.toFixed(2)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {sel ? <OptionTicket c={c} mi={mi} type={sel.type} strike={sel.strike} /> : <div className="empty">Cliquez un prix pour préparer un ordre.</div>}
    </div>
  );
}

function SmileChart({ c, mi, expiry, strikes, F }: { c: CommodityId; mi: number; expiry: number; strikes: number[]; F: number }) {
  const g = useStore((s) => s.game)!;
  const W = 560, H = 80, P = 6;
  const ks: number[] = [];
  for (let i = 0; i <= 40; i++) ks.push(strikes[0]! + ((strikes[strikes.length - 1]! - strikes[0]!) * i) / 40);
  const vols = ks.map((k) => impliedVolAt(g.market, c, mi, expiry, k, F));
  const lo = Math.min(...vols) * 0.97, hi = Math.max(...vols) * 1.03;
  const x = (k: number) => P + ((k - ks[0]!) / (ks[ks.length - 1]! - ks[0]!)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="smile-chart">
      <line x1={x(F)} x2={x(F)} y1={0} y2={H} stroke="#ffffff33" strokeDasharray="3 3" />
      <path d={ks.map((k, i) => `${i ? 'L' : 'M'}${x(k).toFixed(1)},${y(vols[i]!).toFixed(1)}`).join('')} fill="none" stroke="#ffd166" strokeWidth={2.2} />
      <text x={W - 8} y={14} textAnchor="end" className="axis"><tspan>smile de vol · {(lo * 100).toFixed(0)}–{(hi * 100).toFixed(0)} %</tspan></text>
    </svg>
  );
}

function OptionTicket({ c, mi, type, strike }: { c: CommodityId; mi: number; type: OptType; strike: number }) {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const act = useStore((s) => s.act);
  const spec = COMMODITIES[c];
  const [side, setSide] = useState<1 | -1>(1);
  const [lots, setLots] = useState(10);
  const pv = previewOption(g, c, mi, type, strike, side * lots);
  const live = useLiveVar();
  if (!pv) return null;
  const varAfter = computeVar(g, bookWithOption(g, c, mi, type, strike, side * lots, pv.exec)).var99;
  const pos = g.options.find((o) => o.commodity === c && o.month === mi && o.type === type && o.strike === strike);
  return (
    <div className="ticket">
      <div className="ticket-row">
        <div className="seg">
          <button className={side > 0 ? 'on buy' : ''} onClick={() => setSide(1)}>Acheter</button>
          <button className={side < 0 ? 'on sell' : ''} onClick={() => setSide(-1)}>Vendre</button>
        </div>
        <div className="contract">
          <span><Term id={type === 'C' ? 'call' : 'put'}>{type === 'C' ? 'Call' : 'Put'}</Term> {spec.short} {monthLabel(mi)} <b>K = {strike}</b></span>
          <small>{pv.style === 'A' ? 'américaine' : 'européenne'} · expire le {formatDayShort(pv.expiry)} · vol {(pv.iv * 100).toFixed(1)} %</small>
        </div>
        <div className="lots">
          <button onClick={() => setLots(Math.max(1, lots - (lots > 10 ? 10 : 1)))}>−</button>
          <input type="number" min={1} value={lots} onChange={(e) => setLots(Math.max(1, Math.floor(Number(e.target.value) || 1)))} />
          <button onClick={() => setLots(lots + (lots >= 10 ? 10 : 1))}>+</button>
        </div>
      </div>
      {pos && <div className="quick"><button className="close-pos" onClick={() => { setSide(pos.lots > 0 ? -1 : 1); setLots(Math.abs(pos.lots)); }}>Clôturer ({pos.lots > 0 ? '+' : ''}{pos.lots})</button></div>}
      <div className="preview-split">
        <div className="preview">
          <div><span>Prime unitaire</span><b>{price(c, pv.exec)}</b></div>
          <div><span>Prime totale</span><b className={pv.premiumUsd < 0 ? 'neg' : 'pos'}>{signedUsd(pv.premiumUsd)}</b></div>
          <div><span><Term id="delta">Delta</Term></span><b>{qty(c, pv.delta)}</b></div>
          <div><span><Term id="gamma">Gamma</Term> (+1 %)</span><b>{qty(c, pv.gamma1pct)}</b></div>
          <div><span><Term id="vega">Vega</Term> (+1 pt)</span><b>{signedUsd(pv.vegaUsd)}</b></div>
          <div><span><Term id="theta">Theta</Term> / jour</span><b>{signedUsd(pv.thetaUsd)}</b></div>
          <div><span>Point mort</span><b>{price(c, pv.breakeven)}</b></div>
          <div><span><Term id="span">Marge</Term> après</span><b>{usd(pv.imAfter)}</b></div>
          <div><span><Term id="var">VaR</Term> 1 j après</span><b>{usd(live?.var99 ?? 0)} → {usd(varAfter)}</b></div>
          <div><span>Liquidité restante</span><b className={pv.liquidityAfter < 0 ? 'neg' : ''}>{usd(pv.liquidityAfter)}</b></div>
        </div>
        <Payoff type={type} strike={strike} premium={pv.exec} side={side} F={futuresPrice(g.market, c, mi)} c={c} />
      </div>
      <button className={`primary big ${side > 0 ? 'buy' : 'sell'}`} onClick={() => act({ type: 'TRADE_OPTION', commodity: c, month: mi, optType: type, strike, lots: side * lots })}>
        {side > 0 ? 'Acheter' : 'Vendre'} {lots} {type === 'C' ? 'calls' : 'puts'} {strike}
      </button>
    </div>
  );
}

/** Profil de gain à l'expiration (par unité), prime incluse. */
function Payoff({ type, strike, premium, side, F, c }: { type: OptType; strike: number; premium: number; side: 1 | -1; F: number; c: CommodityId }) {
  const W = 200, H = 130, P = 10;
  const lo = Math.min(F, strike) * 0.7, hi = Math.max(F, strike) * 1.3;
  const pts: [number, number][] = [];
  for (let i = 0; i <= 50; i++) {
    const s = lo + ((hi - lo) * i) / 50;
    const pay = (type === 'C' ? Math.max(0, s - strike) : Math.max(0, strike - s)) - premium;
    pts.push([s, side * pay]);
  }
  const ys = pts.map((p) => p[1]);
  const ymin = Math.min(...ys, -premium * 1.2), ymax = Math.max(...ys, premium * 1.2);
  const x = (s: number) => P + ((s - lo) / (hi - lo)) * (W - 2 * P);
  const y = (v: number) => H - P - ((v - ymin) / (ymax - ymin)) * (H - 2 * P);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="payoff">
      <line x1={P} x2={W - P} y1={y(0)} y2={y(0)} stroke="#ffffff55" />
      <line x1={x(F)} x2={x(F)} y1={P} y2={H - P} stroke="#7dd3fc" strokeDasharray="3 3" />
      <path d={pts.map((p, i) => `${i ? 'L' : 'M'}${x(p[0]).toFixed(1)},${y(p[1]).toFixed(1)}`).join('')} fill="none" stroke={side > 0 ? '#4ade80' : '#fb7185'} strokeWidth={2.4} />
      <text x={W / 2} y={H - 1} textAnchor="middle" className="axis">gain à l’échéance · prix {price(c, F)}</text>
    </svg>
  );
}

function Otc({ c }: { c: CommodityId }) {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const act = useStore((s) => s.act);
  const live = useLiveVar();
  const spec = COMMODITIES[c];
  const months = otcMonths(g);
  const [mSel, setM] = useState<number | null>(null);
  const mi = mSel !== null && months.includes(mSel) ? mSel : months[Math.min(1, months.length - 1)]!;
  const [kind, setKind] = useState<'swap' | 'apo'>('swap');
  const [type, setType] = useState<OptType>('P');
  const [side, setSide] = useState<1 | -1>(-1);
  const sizes = spec.physical.cargoSizes;
  const [size, setSize] = useState(sizes[0]!);
  const sz = sizes.includes(size) ? size : sizes[0]!;
  const avg = expectedAverage(avgInputs(g, c, mi));
  const step = spec.options.strikeStep * Math.max(1, Math.round(avg / spec.options.strikeStep / 40));
  const [kOff, setKOff] = useState(0);
  const K = Math.round(avg / step) * step + kOff * step;
  const q = otcQuote(g, kind, c, mi, K, type);
  const px = side > 0 ? q.ask : q.bid;
  const varAfter = computeVar(g, bookWithOtc(g, kind, c, mi, side * sz, kind === 'swap' ? px : K, kind === 'apo' ? type : undefined)).var99;
  return (
    <div className="otc">
      <p className="muted small">
        Gré à gré avec une banque, réglé en cash sur la <b>moyenne des cotations quotidiennes</b> du mois : c’est ainsi qu’on couvre une cargaison
        dont le prix est fixé sur une moyenne mensuelle. Pas de marge (pas de <Term id="csa">CSA</Term>), mais un plafond de crédit bancaire.
      </p>
      <div className="tabs">
        <button className={kind === 'swap' ? 'on' : ''} onClick={() => setKind('swap')}><Term id="swap">Swap</Term> mensuel</button>
        <button className={kind === 'apo' ? 'on' : ''} onClick={() => setKind('apo')}><Term id="apo">APO</Term> (option asiatique)</button>
      </div>
      <div className="chips months">
        {months.map((x) => <button key={x} className={x === mi ? 'on' : ''} onClick={() => setM(x)}>{monthLabel(x)}</button>)}
      </div>
      <div className="ticket">
        <div className="ticket-row">
          <div className="seg">
            <button className={side > 0 ? 'on buy' : ''} onClick={() => setSide(1)}>{kind === 'swap' ? 'Payer le fixe' : 'Acheter'}</button>
            <button className={side < 0 ? 'on sell' : ''} onClick={() => setSide(-1)}>{kind === 'swap' ? 'Recevoir le fixe' : 'Vendre'}</button>
          </div>
          {kind === 'apo' && (
            <div className="seg">
              <button className={type === 'C' ? 'on' : ''} onClick={() => setType('C')}>Call</button>
              <button className={type === 'P' ? 'on' : ''} onClick={() => setType('P')}>Put</button>
            </div>
          )}
          <div className="chips">{sizes.map((s) => <button key={s} className={sz === s ? 'on' : ''} onClick={() => setSize(s)}>{qty(c, s)}</button>)}</div>
        </div>
        {kind === 'apo' && (
          <div className="ticket-row">
            <span className="muted">Strike</span>
            <button onClick={() => setKOff(kOff - 1)}>−</button><b>{K}</b><button onClick={() => setKOff(kOff + 1)}>+</button>
            <span className="muted small">moyenne attendue {price(c, avg)}</span>
          </div>
        )}
        <div className="preview">
          <div><span>Moyenne attendue {monthLabel(mi)}</span><b>{price(c, avg)}</b></div>
          <div><span>{kind === 'swap' ? 'Prix fixe' : 'Prime unitaire'} (bid/ask)</span><b>{price(c, q.bid)} / {price(c, q.ask)}</b></div>
          {kind === 'apo' && <div><span>Prime totale</span><b>{usd(px * sz * spec.valuePerUnit)}</b></div>}
          <div><span>VaR 1 j</span><b>{usd(live?.var99 ?? 0)} → {usd(varAfter)}</b></div>
        </div>
        <button className={`primary big ${side > 0 ? 'buy' : 'sell'}`} onClick={() => act({ type: 'TRADE_OTC', kind, commodity: c, month: mi, qty: side * sz, strike: kind === 'apo' ? K : undefined, optType: kind === 'apo' ? type : undefined })}>
          {kind === 'swap' ? (side > 0 ? 'Acheter' : 'Vendre') + ` le swap à ${price(c, px)}` : `${side > 0 ? 'Acheter' : 'Vendre'} l’APO ${type === 'C' ? 'call' : 'put'} ${K}`}
        </button>
      </div>
    </div>
  );
}
