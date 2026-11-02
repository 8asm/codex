import { LESSONS, LESSON_BY_ID } from '../data/lessons';
import { lessonBlock } from '../engine/lessons';
import { Panel } from './common';
import { useStore, type PanelId } from './store';

/** Catalogue des leçons guidées. */
export function LessonsPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const st = g.lessons ?? { active: null, step: 0, done: [] };
  return (
    <Panel title="Leçons guidées" icon="🎓" onClose={() => setPanel('lessons')} wide>
      <p className="muted small">Chaque leçon explique un concept, puis vous fait agir dans la partie. Les étapes se valident d’elles-mêmes : aucune récompense en argent, la leçon ne change pas l’économie du jeu. {st.done.length}/{LESSONS.length} terminées.</p>
      <div className="lessons">
        {LESSONS.map((l) => {
          const block = lessonBlock(g, l);
          const done = st.done.includes(l.id);
          const active = st.active === l.id;
          return (
            <div key={l.id} className={`lesson ${done ? 'done' : ''} ${active ? 'on' : ''}`}>
              <div className="lesson-top"><span className="lesson-icon">{l.icon}</span><b>{l.title}</b>{done && <span className="badge">✓ terminée</span>}</div>
              <p className="small">{l.concept}</p>
              <ol className="small muted">{l.steps.map((s, i) => <li key={i} className={active && i < st.step ? 'pos' : ''}>{s.text}</li>)}</ol>
              {block ? <div className="muted small">{block}</div> : active ? (
                <button className="ghost" onClick={() => act({ type: 'QUIT_LESSON' })}>Interrompre</button>
              ) : (
                <button className="primary" onClick={() => act({ type: 'START_LESSON', id: l.id })}>{done ? 'Refaire' : 'Commencer'}</button>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/** Carte flottante de la leçon en cours : étape courante et raccourci vers le bon panneau. */
export function LessonCard() {
  const g = useStore((s) => s.game);
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const st = g?.lessons;
  if (!g || !st?.active) return null;
  const l = LESSON_BY_ID[st.active];
  const step = l?.steps[st.step];
  if (!l || !step) return null;
  return (
    <div className="lesson-card">
      <div className="lesson-top"><span className="lesson-icon">{l.icon}</span><b>{l.title}</b><span className="muted small">étape {st.step + 1}/{l.steps.length}</span></div>
      <p className="small">{step.text}</p>
      <div className="row">
        {step.panel && <button className="primary" onClick={() => setPanel(step.panel as PanelId, true)}>Ouvrir</button>}
        <button className="ghost" onClick={() => setPanel('lessons', true)}>Détails</button>
        <button className="ghost" onClick={() => act({ type: 'QUIT_LESSON' })}>✕</button>
      </div>
    </div>
  );
}
