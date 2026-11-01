import { useState } from 'react';
import { rate } from '../engine/market';
import { freeCash, rcfHeadroom, rcfLimit, RCF_SPREAD } from '../engine/treasury';
import type { CashCategory } from '../engine/types';
import { nav } from '../engine/valuation';
import { Panel, Stat, Term } from './common';
import { signedUsd, tone, usd } from './format';
import { useStore } from './store';

const CAT_LABEL: Record<CashCategory, string> = {
  vm: 'Marge de variation', commission: 'Commissions', physical: 'Flux physiques', storage: 'Stockage', interest: 'Intérêts',
  overhead: 'Frais généraux', tax: 'Impôts', travel: 'Voyages', liquidation: 'Liquidations forcées',
  premium: 'Primes d’options', otc: 'Règlements OTC', compliance: 'Conformité & reporting', credit: 'Crédit (défauts, assurance)',
  freight: 'Fret (voyages, FFA, surestaries)', assets: 'Actifs industriels',
};

export function TreasuryPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const [amt, setAmt] = useState(5);
  const co = g.company;
  const n = nav(g);
  return (
    <Panel title="Trésorerie" icon="🏦" onClose={() => setPanel('treasury')}>
      {co.marginCall && (
        <div className="callout danger">
          🚨 <Term id="margincall">Appel de marge</Term> : {usd(co.marginCall.amount, 2)} à couvrir avant la clôture, sinon liquidation.
        </div>
      )}
      <div className="stats">
        <Stat label="Cash (dépôts inclus)" value={usd(co.cash, 2)} />
        <Stat label={<Term id="im">Marge initiale</Term>} value={usd(co.im, 2)} />
        <Stat label="Cash libre" value={<span className={tone(freeCash(g))}>{usd(freeCash(g), 2)}</span>} />
        <Stat label={<Term id="rcf">RCF tirée</Term>} value={usd(co.rcfDrawn, 2)} sub={`limite ${usd(rcfLimit(g, n))} · dispo ${usd(rcfHeadroom(g, n))}`} />
      </div>
      <p className="muted small">
        La limite de RCF vaut 2,5× vos fonds propres (plafond 4× le capital initial) au taux {((rate(g.market, 'USD') + RCF_SPREAD + g.risk.rcfPenalty) * 100).toFixed(2)} %.
        Si vous perdez de l’argent, la banque réduit la ligne.
      </p>
      <label className="toggle">
        <input type="checkbox" checked={co.autoTreasury} onChange={(e) => act({ type: 'SET_AUTO_TREASURY', on: e.target.checked })} />
        Trésorerie automatique <span className="muted small">(tire la RCF pour couvrir les marges, rembourse l’excédent)</span>
      </label>
      <div className="rcf-actions">
        <input type="number" min={1} value={amt} onChange={(e) => setAmt(Math.max(1, Number(e.target.value) || 1))} /> M$
        <button onClick={() => act({ type: 'RCF_DRAW', amount: amt * 1e6 })}>Tirer</button>
        <button onClick={() => act({ type: 'RCF_REPAY', amount: amt * 1e6 })}>Rembourser</button>
      </div>
      <h4>Flux cumulés depuis le début</h4>
      <table className="tbl">
        <tbody>
          {(Object.keys(CAT_LABEL) as CashCategory[]).filter((k) => Math.abs(co.cumCashByCategory[k]) > 0.5).map((k) => (
            <tr key={k}><td>{CAT_LABEL[k]}</td><td className={tone(co.cumCashByCategory[k])}>{signedUsd(co.cumCashByCategory[k], 2)}</td></tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
