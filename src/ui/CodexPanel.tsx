import { useEffect, useRef } from 'react';
import { CODEX } from '../data/glossary';
import { Panel } from './common';
import { useStore } from './store';

export function CodexPanel() {
  const setPanel = useStore((s) => s.setPanel);
  const seen = useStore((s) => s.codexSeen);
  const focus = useStore((s) => s.codexFocus);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.querySelector(`[data-id="${focus}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focus]);
  return (
    <Panel title={`Codex · ${seen.length}/${CODEX.length}`} icon="📚" onClose={() => setPanel('codex')}>
      <p className="muted small">Chaque terme souligné rencontré en jeu débloque sa fiche.</p>
      <div className="codex" ref={ref}>
        {CODEX.map((e) => {
          const open = seen.includes(e.id);
          return (
            <article key={e.id} data-id={e.id} className={`codex-entry ${open ? '' : 'locked'} ${focus === e.id ? 'focus' : ''}`}>
              <h4>{open ? e.term : '???'} <small>{e.family}</small></h4>
              <p>{open ? e.long : 'Notion pas encore rencontrée.'}</p>
            </article>
          );
        })}
      </div>
    </Panel>
  );
}
