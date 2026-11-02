import { useMemo, useState } from 'react';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { formatDayShort, monthLabel } from '../engine/calendar';
import { optionExpiry, optionMonths } from '../engine/contracts';
import { cliquetDays, exoticLabel, exoticQuote, exoticUnitPrice, exoticValueUsd, mcExotic, quantoCcy } from '../engine/exotics';
import { futuresPrice, fx } from '../engine/market';
import type { BarrierType, ExoticKind, ExoticSpec, OptType } from '../engine/types';
import { Panel, Term } from './common';
import { price, signedUsd, usd } from './format';
import { useStore } from './store';

const KINDS: { id: ExoticKind; label: string; term: string; blurb: string }[] = [
  { id: 'barrier', label: 'Barrière', term: 'barrier', blurb: 'Une vanille qui s’active ou meurt si le prix touche un niveau. Moins chère, mais attention au saut au-dessus de la barrière.' },
  { id: 'digital', label: 'Digitale', term: 'digital', blurb: 'Tout ou rien : un montant fixe si le prix finit au-delà du strike.' },
  { id: 'lookback', label: 'Lookback', term: 'lookback', blurb: 'Achetez au plus bas (call) ou vendez au plus haut (put) de la période. Chère : on paie le regret.' },
  { id: 'spread', label: 'Spread calendaire', term: 'spreadoption', blurb: 'Option sur l’écart entre deux échéances : un pari sur la forme de la courbe (contango, backwardation).' },
  { id: 'compound', label: 'Composée', term: 'compound', blurb: 'Une option sur une option : payer peu aujourd’hui pour décider plus tard si l’on veut la protection.' },
  { id: 'quanto', label: 'Quanto', term: 'quanto', blurb: 'Le payoff est versé dans l’autre devise à un taux fixé : exposition au prix sans risque de change.' },
  { id: 'cliquet', label: 'Cliquet', term: 'cliquet', blurb: 'Une série d’options à la monnaie qui se recalent à chaque période : on encaisse chaque hausse.' },
];

export function ExoticsPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const c = useStore((s) => s.commodity);
  const select = useStore((s) => s.selectCommodity);
  const spec = COMMODITIES[c];
  const months = optionMonths(spec, g.day);
  const [kind, setKind] = useState<ExoticKind>('barrier');
  const [mSel, setM] = useState<number | null>(null);
  const mi = mSel !== null && months.includes(mSel) ? mSel : months[Math.min(1, months.length - 1)]!;
  const F = futuresPrice(g.market, c, mi);
  const [type, setType] = useState<OptType>('C');
  const [kPct, setK] = useState(100);
  const [hPct, setH] = useState(115);
  const [bt, setBt] = useState<BarrierType>('up-out');
  const [payout, setPayout] = useState(5);
  const [resets, setResets] = useState(3);
  const [qty, setQty] = useState(spec.physical.cargoSizes[0]!);
  const [mc, setMc] = useState<null | { price: number; se: number; key: string }>(null);
  const expiry = optionExpiry(spec, mi);
  const later = months.filter((x) => x > mi);
  const mi2 = later[Math.min(1, later.length - 1)];
  const F2 = mi2 !== undefined ? futuresPrice(g.market, c, mi2) : F;
  const round = (x: number) => Math.round(x / spec.tick) * spec.tick;

  const x: ExoticSpec | null = useMemo(() => {
    const base = { commodity: c, month: mi, type, expiry };
    switch (kind) {
      case 'barrier': {
        const H = round(F * hPct / 100);
        const up = bt.startsWith('up');
        if (up ? H <= F : H >= F) return null;
        return { ...base, kind, strike: round((F * kPct) / 100), barrier: H, barrierType: bt };
      }
      case 'digital': return { ...base, kind, strike: round((F * kPct) / 100), payout };
      case 'lookback': return { ...base, kind, strike: 1 };
      case 'spread': return mi2 === undefined ? null : { ...base, kind, month2: mi2, strike: round((F - F2) * kPct / 100) };
      case 'compound': {
        if (mi2 === undefined) return null;
        const exp2 = optionExpiry(spec, mi2);
        return { ...base, kind, type: 'C', month: mi2, strike: round(F2 * kPct / 100), expiry, expiry2: exp2, strike2: round(F2 * 0.03) };
      }
      case 'quanto': return { ...base, kind, strike: round((F * kPct) / 100) };
      case 'cliquet': return { ...base, kind, strike: 1, resets };
    }
  }, [kind, c, mi, type, kPct, hPct, bt, payout, resets, F, F2, mi2, expiry]);

  const st = x?.kind === 'cliquet' ? { resetDays: cliquetDays(g.day, expiry, resets), refs: [F] } : x?.kind === 'lookback' ? { extreme: F } : {};
  const q = x ? exoticQuote(g.market, x, st) : null;
  const key = x ? JSON.stringify(x) : '';
  const k = q ? fx(g.market, q.ccy) : 1;
  const info = KINDS.find((y) => y.id === kind)!;

  return (
    <Panel title="Produits structurés" icon="🧪" onClose={() => setPanel('exotics')} wide>
      <p className="muted small">Options sur mesure de gré à gré, cotées par les banques. Formules fermées vérifiées par Monte Carlo ; fourchettes larges et débouclage coûteux : c’est le prix du sur-mesure.</p>
      <div className="chips">
        {COMMODITY_IDS.map((id) => <button key={id} className={c === id ? 'on' : ''} onClick={() => select(id)}>{COMMODITIES[id].icon} {COMMODITIES[id].short}</button>)}
      </div>
      <div className="chips">
        {KINDS.map((y) => <button key={y.id} className={kind === y.id ? 'on' : ''} onClick={() => setKind(y.id)}>{y.label}</button>)}
      </div>
      <p className="small"><Term id={info.term}>{info.label}</Term> — {info.blurb}</p>
      <div className="chips months">
        {months.slice(0, 8).map((m) => <button key={m} className={m === mi ? 'on' : ''} onClick={() => setM(m)}>{monthLabel(m)}</button>)}
      </div>
      <div className="exo-form">
        {kind !== 'compound' && (
          <div className="seg">
            <button className={type === 'C' ? 'on' : ''} onClick={() => setType('C')}>Call</button>
            <button className={type === 'P' ? 'on' : ''} onClick={() => setType('P')}>Put</button>
          </div>
        )}
        {kind !== 'lookback' && kind !== 'cliquet' && (
          <label>{kind === 'spread' ? 'Strike du spread' : 'Strike'} <b>{kPct} %</b><input type="range" min={kind === 'spread' ? -200 : 70} max={kind === 'spread' ? 300 : 130} step={kind === 'spread' ? 10 : 1} value={kPct} onChange={(e) => setK(Number(e.target.value))} /></label>
        )}
        {kind === 'barrier' && (
          <>
            <select value={bt} onChange={(e) => { const v = e.target.value as BarrierType; setBt(v); setH(v.startsWith('up') ? 115 : 85); }}>
              <option value="up-out">up-and-out</option><option value="up-in">up-and-in</option><option value="down-out">down-and-out</option><option value="down-in">down-and-in</option>
            </select>
            <label>Barrière <b>{hPct} %</b><input type="range" min={bt.startsWith('up') ? 101 : 60} max={bt.startsWith('up') ? 150 : 99} value={hPct} onChange={(e) => setH(Number(e.target.value))} /></label>
          </>
        )}
        {kind === 'digital' && <label>Montant par unité <b>{payout} {spec.currency}</b><input type="range" min={1} max={20} value={payout} onChange={(e) => setPayout(Number(e.target.value))} /></label>}
        {kind === 'cliquet' && <label>Périodes <b>{resets}</b><input type="range" min={2} max={6} value={resets} onChange={(e) => setResets(Number(e.target.value))} /></label>}
        <label>Quantité <b>{qty.toLocaleString('fr-FR')} {spec.qtyUnit}</b><input type="range" min={spec.physical.cargoSizes[0]! / 10} max={spec.physical.cargoSizes[spec.physical.cargoSizes.length - 1]!} step={spec.physical.cargoSizes[0]! / 10} value={qty} onChange={(e) => setQty(Number(e.target.value))} /></label>
      </div>
      {x && q ? (
        <div className="ticket">
          <div className="muted small">
            {exoticLabel(x)} · future {monthLabel(x.month)} à {price(c, x.kind === 'compound' ? F2 : F)} · échéance {formatDayShort(x.expiry)}
            {x.kind === 'spread' && <> · spread actuel {price(c, F - F2)}</>}
            {x.kind === 'compound' && <> · call sous-jacent strike {x.strike} échéance {formatDayShort(x.expiry2!)}, prime à payer {x.strike2}</>}
            {x.kind === 'quanto' && <> · payé en {quantoCcy(c)} au taux fixe actuel</>}
          </div>
          <div className="preview">
            <div><span>Prix (mid)</span><b>{q.mid.toFixed(3)} {q.ccy}</b></div>
            <div><span>Achat / vente banque</span><b>{q.ask.toFixed(3)} / {q.bid.toFixed(3)}</b></div>
            <div><span>Prime totale (achat)</span><b>{usd(q.ask * qty * k)}</b></div>
            <div><span><Term id="delta">Delta</Term></span><b>{Math.round(q.deltaUnits * qty).toLocaleString('fr-FR')} {spec.qtyUnit}</b></div>
            <div><span><Term id="vega">Vega</Term> (1 pt)</span><b>{usd(q.vegaUsd * qty)}</b></div>
            <div>
              <span>Contrôle Monte Carlo</span>
              {x.kind === 'quanto' ? <b className="muted">formule fermée seule</b> : mc && mc.key === key ? <b>{mc.price.toFixed(3)} ± {(2 * mc.se).toFixed(3)}</b> : <button onClick={() => { const r = mcExotic(g.market, x, st, 3000, key); setMc({ ...r, key }); }}>Lancer (3 000 chemins)</button>}
            </div>
          </div>
          <div className="row">
            <button className="primary big buy" onClick={() => act({ type: 'TRADE_EXOTIC', spec: x, qty })}>Acheter</button>
            <button className="big sell" onClick={() => act({ type: 'TRADE_EXOTIC', spec: x, qty: -qty })}>Vendre</button>
          </div>
        </div>
      ) : (
        <div className="empty">Paramètres incohérents (barrière déjà franchie ou échéances manquantes).</div>
      )}
      <h4>Positions</h4>
      {g.exotics.length === 0 ? <div className="empty">Aucune exotique en portefeuille.</div> : (
        <table className="tbl">
          <thead><tr><th>Produit</th><th>Qté</th><th>Échéance</th><th>État</th><th>Valeur</th><th>P&amp;L</th><th /></tr></thead>
          <tbody>
            {g.exotics.map((p) => {
              const val = exoticValueUsd(g, p);
              const pnl = (exoticUnitPrice(g.market, p, p) - p.premium) * p.qty * fx(g.market, quantoOrNative(p));
              return (
                <tr key={p.id}>
                  <td>{exoticLabel(p)}</td>
                  <td>{p.qty.toLocaleString('fr-FR')}</td>
                  <td>{formatDayShort(p.expiry)}</td>
                  <td className="small">{p.kind === 'barrier' ? (p.hit ? (p.barrierType!.endsWith('out') ? '💀 désactivée' : '✅ activée') : 'barrière intacte') : p.kind === 'lookback' ? `extrême ${price(p.commodity, p.extreme ?? 0)}` : p.kind === 'cliquet' ? `${(p.refs?.length ?? 1) - 1}/${p.resets} constatations` : ''}</td>
                  <td>{usd(val)}</td>
                  <td className={pnl >= 0 ? 'pos' : 'neg'}>{signedUsd(pnl)}</td>
                  <td><button onClick={() => act({ type: 'CLOSE_EXOTIC', id: p.id })}>Déboucler</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function quantoOrNative(p: ExoticSpec) {
  return p.kind === 'quanto' ? quantoCcy(p.commodity) : COMMODITIES[p.commodity].currency;
}
