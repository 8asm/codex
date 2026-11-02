/**
 * Négociation en mini-jeu : quelques tours, cinq coups possibles.
 *   ancrer     : demander haut ; efficace si la demande reste plausible, sinon la contrepartie s'agace
 *   concéder   : réduire sa demande ; la contrepartie rend la pareille (plus si elle vous fait confiance)
 *   bluffer    : invoquer une alternative ; certain si elle est réelle (levier), risqué sinon (confiance, patience)
 *   argumenter : faits et expertise ; gain modeste mais sûr, proportionnel à la compétence de négociation
 *   accepter / rompre
 * La contrepartie a une limite cachée (réservation) qui dépend de la relation et de l'information détenue.
 * Tout est exprimé dans l'espace « plus grand = mieux pour le joueur » (les prix d'achat sont inversés).
 */
import { loreAside } from './lore';
import { newId } from './ledger';
import { remember, npc } from './npcs';
import { uniform } from './rng';
import type { GameState, Negotiation, NegotiationMove } from './types';

export function startNegotiation(state: GameState, spec: Omit<Negotiation, 'id' | 'offer' | 'ask' | 'round' | 'maxRounds' | 'patience' | 'log' | 'done'>): Negotiation {
  const g = (x: number) => (spec.higherIsBetter ? x : -x);
  const opening = g(spec.opening), res = g(spec.reservation);
  const n: Negotiation = {
    ...spec, id: newId(state, 'ng'), opening, reservation: res, offer: opening,
    ask: opening + (res - opening) * 1.4 + Math.abs(opening) * 0.02, round: 0, maxRounds: 5, patience: 70, log: [], done: false,
  };
  n.log.push(`Proposition de départ : ${fmt(n, n.offer)} ${n.unit}.`);
  state.negotiation = n;
  return n;
}

export function fmt(n: Negotiation, v: number): string {
  const x = n.higherIsBetter ? v : -v;
  return Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('fr-FR') : x.toFixed(2);
}

/** Valeur conclue dans l'unité d'origine. */
export function realValue(n: Negotiation, v: number) {
  return n.higherIsBetter ? v : -v;
}

export function negotiate(state: GameState, move: NegotiationMove, skill: number): string {
  const n = state.negotiation;
  if (!n || n.done) return 'Pas de négociation en cours.';
  const p = npc(state, n.npcId);
  const trust = p?.trust ?? 0;
  const R = n.reservation, O = n.opening;
  const span = Math.max(1e-9, Math.abs(R - O));
  const final = n.round >= n.maxRounds || n.patience <= 0;
  if (final && move !== 'accepter' && move !== 'rompre') move = 'rompre';
  let msg = '';
  switch (move) {
    case 'ancrer': {
      n.ask = Math.max(n.ask, n.offer + span * 0.9);
      if (n.ask <= R + span * 0.15) {
        n.offer += (Math.min(n.ask, R) - n.offer) * 0.35;
        n.patience -= 10;
        msg = `Vous demandez ${fmt(n, n.ask)}. La contrepartie remonte à ${fmt(n, n.offer)}.`;
      } else {
        n.offer += (R - n.offer) * 0.08;
        n.patience -= 25;
        msg = `Demande jugée irréaliste (${fmt(n, n.ask)}) : la contrepartie se crispe (${fmt(n, n.offer)}).`;
      }
      break;
    }
    case 'concéder': {
      n.ask -= (n.ask - n.offer) * 0.4;
      n.offer += (R - n.offer) * 0.3 * (0.7 + trust / 200);
      n.patience = Math.min(100, n.patience + 10);
      msg = `Vous faites un pas (${fmt(n, n.ask)}) ; elle aussi : ${fmt(n, n.offer)}.`;
      break;
    }
    case 'bluffer': {
      const ok = n.leverage || uniform(state.rng) < 0.3 + trust / 250 + skill / 250 - (p?.honesty ?? 0.5) * 0.15;
      if (ok) {
        n.offer += (R - n.offer) * 0.55;
        msg = n.leverage ? `Votre alternative est réelle : la contrepartie s’aligne à ${fmt(n, n.offer)}.` : `Le bluff passe : ${fmt(n, n.offer)}.`;
        n.patience -= 5;
      } else {
        n.offer -= (n.offer - O) * 0.2;
        n.patience -= 35;
        remember(state, n.npcId, -12, 'A deviné un bluff en négociation');
        msg = `Bluff éventé ! La confiance en prend un coup (${fmt(n, n.offer)}).`;
      }
      break;
    }
    case 'argumenter': {
      const f = 0.15 + skill / 400 + (n.leverage ? 0.1 : 0);
      n.offer += (R - n.offer) * f;
      n.patience -= 8;
      msg = `Arguments factuels : ${fmt(n, n.offer)}.`;
      break;
    }
    case 'accepter': {
      n.done = true;
      n.result = realValue(n, n.offer);
      const greed = (n.offer - O) / span;
      if (greed > 0.85) remember(state, n.npcId, -3, 'Négociation serrée');
      else remember(state, n.npcId, 2, 'Accord trouvé');
      msg = `Accord à ${fmt(n, n.offer)} ${n.unit}.`;
      { const a = loreAside(state, `nego:${n.id}`); if (a) msg += ` En raccrochant : « ${a} »`; }
      break;
    }
    case 'rompre': {
      if (n.leverage && !final && uniform(state.rng) < 0.5) {
        n.offer = R - span * 0.02;
        n.round = n.maxRounds;
        msg = `« Attendez… » Dernière offre : ${fmt(n, n.offer)}.`;
      } else {
        n.done = true;
        n.result = undefined;
        remember(state, n.npcId, -4, 'Négociation rompue');
        msg = 'Négociation rompue.';
      }
      break;
    }
  }
  n.offer = Math.min(n.offer, R);
  n.round++;
  if (!n.done && (n.round >= n.maxRounds || n.patience <= 0)) msg += ' C’est leur dernière offre : à prendre ou à laisser.';
  n.log.push(msg);
  return msg;
}
