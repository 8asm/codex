/**
 * Folklore du négoce : quelques bruits de couloir, rares et jamais développés. Rien ici n'influence les marchés,
 * l'argent ou les probabilités du jeu ; les tirages sont hachés (graine, jour), la séquence aléatoire reste intacte.
 */
import { addBusinessDays } from './calendar';
import { addNews } from './news';
import { hashUniform } from './rng';
import type { GameState } from './types';

interface Whisper { id: string; from: number; headline: string; body?: string }

/** Les échos s'affinent avec le temps : d'abord « un acheteur lyonnais », puis un nom, puis des initiales. */
const WHISPERS: Whisper[] = [
  { id: 'w1', from: 150, headline: 'Bois de sciage : les prix tiennent malgré le ralentissement du bâtiment', body: 'Les courtiers évoquent « un acheteur lyonnais » très régulier, sans en dire plus.' },
  { id: 'w2', from: 230, headline: 'Scandinavie : des volumes de résineux partent vers un acheteur que personne ne sait nommer', body: 'Un courtier d’Oslo parle d’une petite structure basée à Lyon. Il n’a pas voulu en dire davantage.' },
  { id: 'w3', from: 400, headline: 'Une certaine Everpine aurait sécurisé la production de plusieurs scieries finlandaises', body: 'Ni site internet ni communiqué. Les scieries confirment, sans commenter.' },
  { id: 'w4', from: 480, headline: 'Bois d’œuvre : les analystes cherchent qui se cache derrière Everpine', body: 'Une adresse à Lyon, un capital modeste sur le papier, et des volumes qui ne collent pas avec.' },
  { id: 'w5', from: 650, headline: 'Dans les salles de marché, trois lettres circulent : « BBM »', body: 'Personne ne sait vraiment de qui il s’agit. Certains jurent qu’il tient à lui seul le marché mondial du bois.' },
  { id: 'w6', from: 760, headline: 'Everpine décline toute demande d’interview', body: 'Comme d’habitude.' },
  { id: 'w7', from: 880, headline: 'Selon une source non vérifiée, BBM n’aurait jamais perdu d’argent sur le bois', body: 'Personne n’a pu le confirmer. Personne n’a pu l’infirmer non plus.' },
];

const ASIDES: { from: number; text: string }[] = [
  { from: 200, text: 'Paraît qu’un type à Lyon fait tourner tout le marché du bois. Enfin, c’est ce qu’on dit.' },
  { from: 420, text: 'Au fait, tu as entendu parler d’Everpine ?' },
  { from: 420, text: 'Everpine… Non, rien. Oublie.' },
  { from: 680, text: 'Tu connais BBM ? Non ? Moi non plus. Personne ne le connaît.' },
];

const elapsed = (s: GameState) => s.day - s.startDay;
const lore = (s: GameState) => (s.lore ??= { lastNews: -1e9, lastAside: -1e9, seen: [] });

/** Une rumeur de temps en temps (en moyenne une tous les deux à trois mois une fois le bruit lancé). */
export function loreDay(s: GameState) {
  const L = lore(s);
  if (s.day < L.lastNews) return;
  const next = WHISPERS.find((w) => !L.seen.includes(w.id) && elapsed(s) >= w.from);
  if (!next) return;
  if (hashUniform(s.config.seed, 'lore', s.day) > 1 / 45) return;
  L.seen.push(next.id);
  L.lastNews = addBusinessDays(s.day, 40);
  addNews(s, { headline: next.headline, body: next.body, tone: 'neutral', major: false, category: 'entreprises', cityId: 'lyon' });
}

/** Un aparté très rare glissé dans une conversation (chaîne vide la plupart du temps). */
export function loreAside(s: GameState, key: string): string {
  const L = lore(s);
  if (s.day < L.lastAside) return '';
  const pool = ASIDES.filter((a) => elapsed(s) >= a.from);
  if (!pool.length || hashUniform(s.config.seed, 'aside', key, s.day) > 0.04) return '';
  L.lastAside = addBusinessDays(s.day, 90);
  return pool[Math.floor(hashUniform(s.config.seed, 'aside-pick', s.day) * pool.length)]!.text;
}
