/**
 * Phase 9 — Moteur des leçons guidées : une leçon active, des étapes vérifiées sur l'état (après chaque action
 * et à chaque clôture). Aucune récompense en argent : la leçon n'altère jamais l'économie de la partie.
 */
import { LESSON_BY_ID, type Lesson } from '../data/lessons';
import { activeCommodities } from './physical';
import type { ActionResult, GameState, LessonState } from './types';

export function lessonState(s: GameState): LessonState {
  return (s.lessons ??= { active: null, step: 0, done: [] });
}

const manages = (s: GameState) => !s.career || s.career.status === 'founder' || s.career.status === 'ceo';

/** Raison pour laquelle une leçon n'est pas disponible dans cette partie (ou null). */
export function lessonBlock(s: GameState, l: Lesson): string | null {
  const active = activeCommodities(s);
  const missing = (l.requires ?? []).filter((c) => !active.includes(c));
  if (missing.length) return `Marchés non suivis dans cette partie : ${missing.join(', ')}.`;
  if (l.managing && !manages(s)) return 'Réservée à qui dirige une maison.';
  return null;
}

export function startLesson(s: GameState, id: string): ActionResult {
  const l = LESSON_BY_ID[id];
  if (!l) return { ok: false, message: 'Leçon inconnue.' };
  const block = lessonBlock(s, l);
  if (block) return { ok: false, message: block };
  const st = lessonState(s);
  st.active = id;
  st.step = 0;
  lessonTick(s);
  return { ok: true, message: `Leçon : ${l.title}` };
}

export function quitLesson(s: GameState): ActionResult {
  lessonState(s).active = null;
  return { ok: true, message: 'Leçon interrompue.' };
}

/** Fait avancer la leçon active d'autant d'étapes que l'état en valide. */
export function lessonTick(s: GameState) {
  const st = s.lessons;
  if (!st?.active) return;
  const l = LESSON_BY_ID[st.active];
  if (!l) { st.active = null; return; }
  while (st.step < l.steps.length) {
    let ok = false;
    try { ok = l.steps[st.step]!.check(s); } catch { ok = false; }
    if (!ok) break;
    st.step++;
    if (st.step < l.steps.length) s.pendingAlerts.push({ kind: 'achievement', text: `${l.icon} Étape réussie : ${l.steps[st.step]!.text}` });
  }
  if (st.step >= l.steps.length) {
    if (!st.done.includes(l.id)) st.done.push(l.id);
    st.active = null;
    s.pendingAlerts.push({ kind: 'achievement', text: `${l.icon} Leçon terminée : ${l.title}. ${l.outro}` });
  }
}

/** Passe l'étape courante (le joueur la juge inutile ou ne peut pas la réaliser). */
export function skipLessonStep(s: GameState): ActionResult {
  const st = s.lessons;
  if (!st?.active) return { ok: false, message: 'Pas de leçon en cours.' };
  const l = LESSON_BY_ID[st.active];
  if (!l) return { ok: false, message: 'Leçon inconnue.' };
  st.step++;
  st.skipped = (st.skipped ?? 0) + 1;
  if (st.step >= l.steps.length) {
    if (!st.done.includes(l.id)) st.done.push(l.id);
    st.active = null;
    return { ok: true, message: `Leçon terminée (étape passée) : ${l.title}.` };
  }
  lessonTick(s); // l'étape suivante est peut-être déjà réalisée
  return { ok: true, message: 'Étape passée.' };
}

/**
 * Diagnostic de l'étape courante : réalisable maintenant ? Si un déclencheur manque (pas d'offre, marché non suivi,
 * attente d'une livraison), le joueur sait quoi faire ou peut passer l'étape.
 */
export function stepDiagnostic(s: GameState): { blocker: string | null; done: boolean } {
  const st = s.lessons;
  const l = st?.active ? LESSON_BY_ID[st.active] : undefined;
  const step = l?.steps[st!.step];
  if (!l || !step) return { blocker: null, done: false };
  let done = false;
  try { done = step.check(s); } catch { done = false; }
  let blocker: string | null = null;
  try { blocker = step.blocker?.(s) ?? null; } catch { blocker = null; }
  return { blocker: done ? null : blocker, done };
}
