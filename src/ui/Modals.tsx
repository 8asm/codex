import { rcfHeadroom } from '../engine/treasury';
import { nav } from '../engine/valuation';
import { Sparkline, Term } from './common';
import { signedUsd, usd } from './format';
import { useStore } from './store';

export function Modals() {
  const modal = useStore((s) => s.modal);
  const g = useStore((s) => s.game);
  useStore((s) => s.rev);
  const close = useStore((s) => s.closeModal);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const quit = useStore((s) => s.quit);
  if (!modal || !g) return null;

  if (modal.kind === 'major_news') {
    return (
      <div className="modal-bg" onClick={close}>
        <div className="modal news-flash" onClick={(e) => e.stopPropagation()}>
          <div className="flash-tag">FLASH MARCHÉS</div>
          <h2>{modal.text}</h2>
          <p>{g.news.find((n) => n.headline === modal.text)?.body}</p>
          <div className="modal-actions">
            <button onClick={() => { close(); setPanel('market'); }}>Voir les marchés</button>
            <button className="primary" onClick={close}>Continuer</button>
          </div>
        </div>
      </div>
    );
  }

  if (modal.kind === 'margin_call' || modal.kind === 'liquidation') {
    const head = rcfHeadroom(g);
    const amount = g.company.marginCall?.amount ?? 0;
    return (
      <div className="modal-bg">
        <div className="modal danger">
          <div className="siren">🚨</div>
          <h2>{modal.kind === 'margin_call' ? 'Appel de marge !' : 'Liquidation forcée'}</h2>
          <p>{modal.text}</p>
          {modal.kind === 'margin_call' && (
            <>
              <p className="small">
                Votre courtier exige du cash pour couvrir la <Term id="im">marge initiale</Term> et les pertes de <Term id="vm">variation</Term>.
                Options : tirer sur la <Term id="rcf">RCF</Term>, réduire des positions, vendre du stock. Sinon, liquidation à la prochaine clôture.
              </p>
              <div className="modal-actions">
                {head > 0 && <button className="primary" onClick={() => { act({ type: 'RCF_DRAW', amount: Math.min(head, amount * 1.1) }); close(); }}>Tirer {usd(Math.min(head, amount * 1.1))} sur la RCF</button>}
                <button onClick={() => { close(); setPanel('book'); }}>Réduire les positions</button>
                <button className="ghost" onClick={close}>Plus tard</button>
              </div>
            </>
          )}
          {modal.kind === 'liquidation' && <div className="modal-actions"><button className="primary" onClick={close}>Encaisser le choc</button></div>}
        </div>
      </div>
    );
  }

  // fin de partie / faillite
  const n = nav(g);
  const ret = n / g.company.initialCapital - 1;
  const best = [...g.history].sort((a, b) => b.pnl - a.pnl)[0];
  const worst = [...g.history].sort((a, b) => a.pnl - b.pnl)[0];
  return (
    <div className="modal-bg">
      <div className={`modal ${modal.kind === 'bankrupt' ? 'danger' : 'victory'}`}>
        <h2>{modal.kind === 'bankrupt' ? '💥 Faillite' : '🏁 Fin de partie'}</h2>
        <p>{modal.text}</p>
        <Sparkline data={g.history.map((h) => h.nav)} width={420} height={80} color={ret >= 0 ? '#5eead4' : '#f87171'} />
        <div className="stats">
          <div className="stat"><div className="stat-label">Fonds propres finaux</div><div className="stat-value">{usd(n, 2)}</div></div>
          <div className="stat"><div className="stat-label">Rendement</div><div className="stat-value">{(ret * 100).toFixed(1)} %</div></div>
          {best && <div className="stat"><div className="stat-label">Meilleur jour</div><div className="stat-value pos">{signedUsd(best.pnl)}</div></div>}
          {worst && <div className="stat"><div className="stat-label">Pire jour</div><div className="stat-value neg">{signedUsd(worst.pnl)}</div></div>}
        </div>
        <div className="modal-actions">
          <button onClick={close}>Revoir le livre</button>
          <button className="primary" onClick={quit}>Nouvelle partie</button>
        </div>
      </div>
    </div>
  );
}
