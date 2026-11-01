/**
 * Conseillers animés : portraits SVG originaux (clignement, bouche qui parle, humeurs), bulle de dialogue,
 * fiche avec palmarès. Principal vecteur d'apprentissage du jeu.
 */
import { useEffect, useMemo, useState } from 'react';
import { ADVISOR_BY_ID, ADVISORS } from '../data/advisors';
import { formatDayShort } from '../engine/calendar';
import type { Advice, AdvisorId } from '../engine/types';
import { sfx } from './sound';
import { useStore } from './store';

type Mood = Advice['mood'];

export function Portrait({ id, mood = 'neutral', talking = false, size = 56 }: { id: AdvisorId; mood?: Mood; talking?: boolean; size?: number }) {
  const a = ADVISOR_BY_ID[id];
  const brows: Record<Mood, [string, string]> = {
    neutral: ['M30 38 L42 37', 'M58 37 L70 38'],
    happy: ['M30 36 Q36 33 42 36', 'M58 36 Q64 33 70 36'],
    worried: ['M30 37 L42 34', 'M58 34 L70 37'],
    angry: ['M30 34 L42 39', 'M58 39 L70 34'],
    smug: ['M30 37 L42 37', 'M58 34 Q64 32 70 35'],
  };
  const mouths: Record<Mood, string> = {
    neutral: 'M42 66 Q50 68 58 66',
    happy: 'M40 63 Q50 74 60 63',
    worried: 'M42 68 Q46 64 50 67 Q54 70 58 66',
    angry: 'M41 69 Q50 62 59 69',
    smug: 'M42 66 Q52 70 60 61',
  };
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} className={`portrait ${talking ? 'talking' : ''} mood-${mood}`}>
      <defs>
        <radialGradient id={`bg-${id}`} cx="50%" cy="40%" r="70%">
          <stop offset="0%" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="100%" stopColor={a.color} stopOpacity="0.95" />
        </radialGradient>
      </defs>
      <circle cx="50" cy="50" r="49" fill={`url(#bg-${id})`} stroke="#ffd166" strokeWidth="3" />
      {/* cheveux arrière */}
      {id === 'ops' && <path d="M70 40 Q88 55 78 82 Q72 70 68 55 Z" fill={a.hair} />}
      {id === 'risk' && <circle cx="50" cy="16" r="10" fill={a.hair} />}
      {/* buste */}
      <path d="M18 100 Q22 78 50 76 Q78 78 82 100 Z" fill={a.color} stroke="#0003" strokeWidth="1" />
      <path d="M42 77 L50 88 L58 77" fill="#fff" />
      {id === 'legal' && <path d="M43 86 L50 82 L57 86 L57 80 L50 84 L43 80 Z" fill="#b91c1c" />}
      {/* tête */}
      <ellipse cx="50" cy="48" rx="23" ry="26" fill={a.skin} />
      <ellipse cx="27" cy="50" rx="4" ry="6" fill={a.skin} />
      <ellipse cx="73" cy="50" rx="4" ry="6" fill={a.skin} />
      {/* cheveux avant */}
      {id === 'risk' && <path d="M27 44 Q28 22 50 21 Q72 22 73 44 Q66 30 50 31 Q36 30 27 44 Z" fill={a.hair} />}
      {id === 'trader' && <path d="M28 40 Q27 17 50 16 Q73 17 72 40 L70 30 Q50 24 30 30 Z" fill={a.hair} />}
      {id === 'analyst' && <path d="M26 42 L30 24 L36 30 L41 19 L47 27 L53 17 L58 27 L64 20 L68 30 L74 26 L74 42 Q64 30 50 30 Q36 30 26 42 Z" fill={a.hair} />}
      {id === 'ops' && <path d="M27 46 Q26 22 50 21 Q75 22 73 46 Q70 32 56 30 Q40 34 27 46 Z" fill={a.hair} />}
      {id === 'legal' && <path d="M26 50 Q24 34 30 30 L32 46 Z M74 50 Q76 34 70 30 L68 46 Z" fill={a.hair} />}
      {/* sourcils */}
      <path d={brows[mood][0]} stroke="#3b2a20" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      <path d={brows[mood][1]} stroke="#3b2a20" strokeWidth="2.6" strokeLinecap="round" fill="none" />
      {/* yeux */}
      <g className="eyes">
        <ellipse cx="38" cy="46" rx="3.2" ry="4" fill="#1f2937" />
        <ellipse cx="62" cy="46" rx="3.2" ry="4" fill="#1f2937" />
        <circle cx="39.2" cy="44.6" r="1" fill="#fff" />
        <circle cx="63.2" cy="44.6" r="1" fill="#fff" />
      </g>
      {(id === 'analyst' || id === 'legal') && (
        <g fill="none" stroke="#111" strokeWidth="2">
          <circle cx="38" cy="46" r="7" />
          <circle cx="62" cy="46" r="7" />
          <path d="M45 46 L55 46" />
        </g>
      )}
      {id === 'ops' && <path d="M24 46 Q24 18 50 18 Q76 18 76 46 M76 46 L76 56 Q70 64 60 64" stroke="#111" strokeWidth="2.5" fill="none" />}
      {/* bouche */}
      <g className="mouth">
        <path d={mouths[mood]} stroke="#7f1d1d" strokeWidth="2.6" strokeLinecap="round" fill={mood === 'happy' ? '#7f1d1d' : 'none'} />
      </g>
      {(mood === 'worried' || mood === 'angry') && <circle cx="72" cy="34" r="2.6" fill="#7dd3fc" className="sweat" />}
    </svg>
  );
}

/** Barre des conseillers (bas à droite) + bulle du dernier conseil non lu. */
export function AdvisorBar() {
  const g = useStore((s) => s.game)!;
  const rev = useStore((s) => s.rev);
  const act = useStore((s) => s.act);
  const setPanel = useStore((s) => s.setPanel);
  const [open, setOpen] = useState<AdvisorId | null>(null);
  const unseen = useMemo(() => g.advice.filter((a) => !a.seen && g.day - a.day <= 2), [g, rev]);
  const current = unseen[0];
  const [lastId, setLastId] = useState<string | null>(null);
  useEffect(() => {
    if (current && current.id !== lastId) {
      setLastId(current.id);
      sfx.advisor();
    }
  }, [current, lastId]);

  const doAction = (a: Advice) => {
    const x = a.action;
    if (!x) return;
    if (x.kind === 'hedge') act({ type: 'HEDGE_DELTA', commodity: x.commodity });
    else if (x.kind === 'panel') setPanel(x.panel, true);
    else act(x.action);
    act({ type: 'DISMISS_ADVICE', id: a.id }, true);
  };

  return (
    <div className="advisors">
      {current && (
        <div className="bubble" key={current.id} style={{ ['--c' as string]: ADVISOR_BY_ID[current.advisor].color }}>
          <div className="bubble-head">
            <b>{ADVISOR_BY_ID[current.advisor].name}</b> <small>{ADVISOR_BY_ID[current.advisor].role}</small>
            {unseen.length > 1 && <span className="pill">+{unseen.length - 1}</span>}
          </div>
          <p>{current.text}</p>
          <div className="bubble-actions">
            {current.action && (
              <button className="primary small" onClick={() => doAction(current)}>
                {current.action.kind === 'hedge' ? 'Couvrir le delta' : current.action.kind === 'panel' ? 'Voir' : current.action.label}
              </button>
            )}
            <button className="small" onClick={() => act({ type: 'DISMISS_ADVICE', id: current.id }, true)}>{current.action ? 'Ignorer' : 'Compris'}</button>
          </div>
        </div>
      )}
      <div className="advisor-row">
        {ADVISORS.map((a) => {
          const mine = unseen.filter((x) => x.advisor === a.id);
          const mood = (current?.advisor === a.id ? current.mood : mine[0]?.mood) ?? 'neutral';
          return (
            <button key={a.id} className={`advisor-btn ${current?.advisor === a.id ? 'speaking' : ''}`} onClick={() => setOpen(open === a.id ? null : a.id)} title={`${a.name} — ${a.role}`}>
              <Portrait id={a.id} mood={mood} talking={current?.advisor === a.id} size={52} />
              {mine.length > 0 && <span className="badge-count">{mine.length}</span>}
            </button>
          );
        })}
      </div>
      {open && <AdvisorCard id={open} onClose={() => setOpen(null)} onAction={doAction} />}
    </div>
  );
}

function AdvisorCard({ id, onClose, onAction }: { id: AdvisorId; onClose: () => void; onAction: (a: Advice) => void }) {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const a = ADVISOR_BY_ID[id];
  const tr = g.track[id];
  const n = tr.right + tr.wrong;
  const list = g.advice.filter((x) => x.advisor === id).slice(0, 8);
  return (
    <div className="advisor-card">
      <header>
        <Portrait id={id} mood="neutral" size={64} />
        <div>
          <h3>{a.name}</h3>
          <div className="muted small">{a.role} · « {a.tagline} »</div>
        </div>
        <button className="ghost close" onClick={onClose}>✕</button>
      </header>
      <p className="small">{a.bias}</p>
      {n > 0 && (
        <div className="track">
          Palmarès des prédictions : <b>{tr.right}</b> justes / <b>{tr.wrong}</b> fausses ({Math.round((tr.right / n) * 100)} %)
          <div className="bar"><div style={{ width: `${(tr.right / n) * 100}%` }} /></div>
        </div>
      )}
      <div className="advice-list">
        {list.length === 0 && <div className="muted small">Rien à signaler pour l’instant.</div>}
        {list.map((x) => (
          <div key={x.id} className={`advice-item ${x.seen ? 'seen' : ''}`}>
            <small className="muted">{formatDayShort(x.day)}</small> {x.text}
            {x.prediction?.outcome && <span className={`badge ${x.prediction.outcome === 'right' ? 'here' : 'bad'}`}>{x.prediction.outcome === 'right' ? '✓ juste' : '✗ raté'}</span>}
            {x.action && !x.seen && <button className="small" onClick={() => onAction(x)}>Agir</button>}
          </div>
        ))}
      </div>
    </div>
  );
}
