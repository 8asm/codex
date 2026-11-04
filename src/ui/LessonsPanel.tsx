import { LESSONS, LESSON_BY_ID, type Lesson } from '../data/lessons';
import { LESSONS_EN } from '../data/lessons-en';
import { lessonBlock, stepDiagnostic } from '../engine/lessons';
import { Panel } from './common';
import { t } from './i18n';
import { useSettings } from './settings';
import { useStore, type PanelId } from './store';

/** Texte d'une leçon dans la langue choisie (le français est la source). */
function lessonText(l: Lesson, lang: 'fr' | 'en') {
  const en = lang === 'en' ? LESSONS_EN[l.id] : undefined;
  return {
    title: en?.title ?? l.title,
    concept: en?.concept ?? l.concept,
    steps: l.steps.map((s, i) => en?.steps[i] ?? s.text),
    outro: en?.outro ?? l.outro,
  };
}

/** Catalogue des leçons guidées : la visite guidée d'abord, puis les leçons facultatives, dans n'importe quel ordre. */
export function LessonsPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const lang = useSettings((s) => s.lang);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const st = g.lessons ?? { active: null, step: 0, done: [] };
  const ready = LESSONS.filter((l) => !lessonBlock(g, l));
  return (
    <Panel title={t('Leçons guidées')} icon="🎓" onClose={() => setPanel('lessons')} wide>
      <p className="muted small" data-no-i18n>{t('Chaque leçon explique un concept, puis vous fait agir dans la partie. Les étapes se valident d’elles-mêmes : aucune récompense en argent, la leçon ne change pas l’économie du jeu.')} {st.done.length}/{ready.length} {lang === 'en' ? 'done' : 'terminées'}.</p>
      <div className="lessons" data-no-i18n>
        {LESSONS.map((l) => {
          const block = lessonBlock(g, l);
          const done = st.done.includes(l.id);
          const active = st.active === l.id;
          const tx = lessonText(l, lang);
          return (
            <div key={l.id} className={`lesson ${done ? 'done' : ''} ${active ? 'on' : ''} ${block ? 'blocked' : ''}`}>
              <div className="lesson-top"><span className="lesson-icon">{l.icon}</span><b>{tx.title}</b>{done && <span className="badge">{t('✓ terminée')}</span>}</div>
              <p className="small">{tx.concept}</p>
              <ol className="small muted">{tx.steps.map((s, i) => <li key={i} className={active && i < st.step ? 'pos' : ''}>{s}</li>)}</ol>
              {block ? <div className="muted small">{t(block)}</div> : active ? (
                <button className="ghost" onClick={() => act({ type: 'QUIT_LESSON' })}>{t('Interrompre')}</button>
              ) : (
                <button className="primary" onClick={() => act({ type: 'START_LESSON', id: l.id })}>{done ? t('Refaire') : t('Commencer')}</button>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

/**
 * Carte flottante de la leçon en cours : étape courante, raccourci vers le bon panneau, diagnostic (ce qui bloque et
 * comment débloquer) et possibilité de passer l'étape ou la leçon.
 */
export function LessonCard() {
  const g = useStore((s) => s.game);
  useStore((s) => s.rev);
  const lang = useSettings((s) => s.lang);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const st = g?.lessons;
  if (!g || !st?.active) return null;
  const l = LESSON_BY_ID[st.active];
  const step = l?.steps[st.step];
  if (!l || !step) return null;
  const tx = lessonText(l, lang);
  const diag = stepDiagnostic(g);
  return (
    <div className="lesson-card" data-no-i18n>
      <div className="lesson-top"><span className="lesson-icon">{l.icon}</span><b>{tx.title}</b><span className="muted small">{lang === 'en' ? 'step' : 'étape'} {st.step + 1}/{l.steps.length}</span></div>
      <p className="small">{tx.steps[st.step]}</p>
      {diag.blocker && <p className="small warn">⏳ {t(diag.blocker)}</p>}
      <div className="row">
        {step.panel && <button className="primary" onClick={() => setPanel(step.panel as PanelId, true)}>{t('Ouvrir')}</button>}
        <button className="ghost" onClick={() => act({ type: 'SKIP_LESSON_STEP' })} title={lang === 'en' ? 'Skip this step if it is not relevant or cannot be done now' : 'Passer cette étape si elle ne vous concerne pas ou ne peut pas se faire maintenant'}>{t('Passer l’étape')}</button>
        <button className="ghost" onClick={() => setPanel('lessons', true)}>{t('Détails')}</button>
        <button className="ghost" onClick={() => act({ type: 'QUIT_LESSON' })} title={t('Passer la leçon')}>✕</button>
      </div>
    </div>
  );
}
