import { fmt } from '../engine/negotiation';
import type { NegotiationMove } from '../engine/types';
import { Term } from './common';
import { useStore } from './store';
import { SituationCard } from './CareerPanel';

const MOVES: { m: NegotiationMove; label: string; tip: string }[] = [
  { m: 'ancrer', label: '⚓ Ancrer haut', tip: 'Demander plus : efficace si c’est plausible' },
  { m: 'concéder', label: '🤝 Concéder', tip: 'Faire un pas : la contrepartie aussi' },
  { m: 'bluffer', label: '🃏 Bluffer', tip: 'Invoquer une alternative : sûr si elle est réelle' },
  { m: 'argumenter', label: '📊 Argumenter', tip: 'Faits et expertise : gain sûr mais modeste' },
  { m: 'accepter', label: '✅ Accepter', tip: '' },
  { m: 'rompre', label: '🚪 Rompre', tip: '' },
];

export function NegotiationModal() {
  const g = useStore((s) => s.game);
  useStore((s) => s.rev);
  const act = useStore((s) => s.act);
  const n = g?.negotiation;
  if (!g || !n || n.done) return null;
  const who = g.npcs.find((x) => x.id === n.npcId);
  const final = n.round >= n.maxRounds || n.patience <= 0;
  return (
    <div className="modal-bg">
      <div className="modal negotiation">
        <div className="flash-tag">NÉGOCIATION</div>
        <h2>{n.title}</h2>
        {who && <div className="muted small">Face à {who.name} — confiance {Math.round(who.trust)}{n.leverage ? ' · vous avez une vraie alternative' : ''}</div>}
        <div className="stats">
          <div className="stat"><div className="stat-label">Leur proposition</div><div className="stat-value">{fmt(n, n.offer)}</div><div className="stat-sub">{n.unit}</div></div>
          <div className="stat"><div className="stat-label">Votre demande</div><div className="stat-value">{fmt(n, n.ask)}</div></div>
          <div className="stat"><div className="stat-label">Patience</div><div className="bar"><div style={{ width: `${Math.max(0, n.patience)}%` }} /></div><div className="stat-sub">tour {n.round}/{n.maxRounds}</div></div>
        </div>
        <ul className="neg-log">{n.log.slice(-5).map((l, i) => <li key={i}>{l}</li>)}</ul>
        <div className="neg-moves">
          {MOVES.filter((x) => !final || x.m === 'accepter' || x.m === 'rompre').map((x) => (
            <button key={x.m} className={x.m === 'accepter' ? 'primary' : ''} title={x.tip} onClick={() => act({ type: 'NEGOTIATE', move: x.m }, true)}>{x.label}{x.tip && <small>{x.tip}</small>}</button>
          ))}
        </div>
        <p className="muted small"><Term id="negotiation">Comment ça marche ?</Term></p>
      </div>
    </div>
  );
}

/** Situation urgente présentée en plein écran (le jeu est en pause). */
export function SituationOverlay() {
  const g = useStore((s) => s.game);
  useStore((s) => s.rev);
  const modal = useStore((s) => s.modal);
  if (!g?.career || modal || (g.negotiation && !g.negotiation.done)) return null;
  const sit = g.situations.find((x) => x.urgent && x.day <= g.day);
  if (!sit) return null;
  return (
    <div className="modal-bg">
      <div className="modal sit-modal">
        <div className="flash-tag">À DÉCIDER</div>
        <SituationCard id={sit.id} />
      </div>
    </div>
  );
}
