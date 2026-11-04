/**
 * Codes de triche (menu caché : cinq clics sur l'Antarctique). Ils passent par le moteur comme n'importe quelle
 * action (en ligne, ils s'appliquent donc chez tous), et la partie est marquée : les succès ne se débloquent plus.
 */
import { addCash, log } from './ledger';
import { unlockAll } from './progression';
import { govState } from './government';
import { ZONES } from '../data/world';
import { COMMODITIES } from '../data/commodities';
import type { ActionResult, GameState } from './types';

export interface Cheat { code: string; effect: string; apply: (s: GameState) => string }

export const CHEATS: Cheat[] = [
  { code: 'MIDAS', effect: '+10 M$ de trésorerie', apply: (s) => { addCash(s, 10e6, 'cheat'); return '10 M$ tombent du ciel.'; } },
  { code: 'CRESUS', effect: '+100 M$ de trésorerie', apply: (s) => { addCash(s, 100e6, 'cheat'); return '100 M$ crédités. Personne ne posera de questions.'; } },
  { code: 'PANORAMA', effect: 'Tous les panneaux affichés', apply: (s) => { unlockAll(s); return 'Tous les panneaux sont affichés.'; } },
  { code: 'ORACLE', effect: 'Révèle les tendances de fond du marché', apply: (s) => {
    const d = Object.entries(s.market.drift).filter(([, v]) => Math.abs(v ?? 0) > 0.01);
    return d.length ? `Tendances de fond : ${d.map(([c, v]) => `${COMMODITIES[c as keyof typeof COMMODITIES]?.short ?? c} ${(v! * 100).toFixed(0)} %/an`).join(', ')}.` : 'Aucune tendance de fond en ce moment : le marché est une martingale.';
  } },
  { code: 'AMNISTIE', effect: 'Efface dossiers et enquêtes de conformité', apply: (s) => { if (s.compliance) { s.compliance.cases = []; s.compliance.investigations = []; s.compliance.suspendedUntil = -1; s.compliance.banksCutUntil = -1; } return 'Ardoise effacée.'; } },
  { code: 'DIPLOMATE', effect: 'Relations à 100 et licences dans tous les pays', apply: (s) => { const g = govState(s); for (const z of ZONES) { g.relations[z.id] = 100; g.licences = g.licences.filter((l) => l.zone !== z.id); g.licences.push({ zone: z.id, untilDay: s.day + 365 }); } return 'Tous les ministres vous tutoient.'; } },
  { code: 'LOYAUTE', effect: 'Équipe fidèle à 100 %, débauchages annulés', apply: (s) => { for (const e of s.staff?.employees ?? []) e.loyalty = 100; if (s.staff) s.staff.poach = []; return 'Votre équipe vous suivrait au bout du monde.'; } },
  { code: 'TELEPORT', effect: 'Voyage instantané (vous arrivez à destination)', apply: (s) => { const t = s.player.travel; if (!t) return 'Aucun voyage en cours.'; s.player.cityId = t.to; s.player.travel = null; return 'Vous y êtes déjà.'; } },
  { code: 'CALME', effect: 'Annule l’appel de marge en cours', apply: (s) => { s.company.marginCall = null; return 'Le courtier a perdu votre dossier.'; } },
  { code: 'ELEVE', effect: 'Termine la leçon en cours', apply: (s) => { const st = s.lessons; if (!st?.active) return 'Pas de leçon en cours.'; if (!st.done.includes(st.active)) st.done.push(st.active); st.active = null; return 'Leçon validée.'; } },
];

export function applyCheat(s: GameState, raw: string): ActionResult {
  const code = raw.trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const c = CHEATS.find((x) => x.code === code);
  if (!c) return { ok: false, message: 'Code inconnu.' };
  const msg = c.apply(s);
  s.stats.cheats = [...new Set([...(s.stats.cheats ?? []), c.code])];
  log(s, `Code de triche : ${c.code}`);
  return { ok: true, message: `🎩 ${msg}` };
}
