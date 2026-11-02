/**
 * Musique d'ambiance synthétisée (WebAudio, aucun fichier) : boucle « lounge » façon jeux de gestion.
 * Piano électrique en rythme bossa sur une grille jazz (II-V-I), basse ronde, marimba qui improvise sur la gamme
 * pentatonique, charleston très léger. Volume volontairement bas ; activable et désactivable à tout moment
 * (préférence mémorisée dans le navigateur quand c'est possible).
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer: number | null = null;
let nextTime = 0;
let step = 0; // croches depuis le début
let on = false;
const listeners = new Set<(on: boolean) => void>();

const BPM = 92;
const EIGHTH = 60 / BPM / 2;
const VOLUME = 0.045;
const KEY = 'tradewinds.music';

// grille : 8 mesures de 4 temps (accords en demi-tons au-dessus de do 3 = MIDI 48)
const CHORDS: { root: number; notes: number[] }[] = [
  { root: 48, notes: [52, 55, 59, 62] }, // Cmaj9
  { root: 45, notes: [52, 55, 57, 60] }, // Am7
  { root: 50, notes: [53, 57, 60, 64] }, // Dm9
  { root: 43, notes: [53, 55, 59, 62] }, // G13
  { root: 41, notes: [52, 55, 57, 60] }, // Fmaj7
  { root: 40, notes: [50, 55, 59, 62] }, // Em7
  { root: 50, notes: [53, 57, 60, 64] }, // Dm9
  { root: 43, notes: [53, 56, 59, 62] }, // G7(b9 léger)
];
const PENTA = [60, 62, 64, 67, 69, 72, 74, 76];
const BOSSA = [1, 0, 0, 1, 0, 0, 1, 0]; // accents du piano sur les croches d'une mesure

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Pseudo-aléa déterministe (la mélodie varie d'une boucle à l'autre sans être chaotique). */
function rnd(n: number) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

function voice(freq: number, t: number, dur: number, type: OscillatorType, gain: number, cutoff = 2400, detune = 0) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  const f = ctx.createBiquadFilter();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  o.detune.setValueAtTime(detune, t);
  f.type = 'lowpass';
  f.frequency.setValueAtTime(cutoff, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function hat(t: number, gain: number) {
  if (!ctx || !master) return;
  const len = Math.floor(ctx.sampleRate * 0.04);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'highpass';
  f.frequency.value = 7000;
  const g = ctx.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(master);
  src.start(t);
}

function schedule(t: number, s: number) {
  const bar = Math.floor(s / 8) % CHORDS.length;
  const e = s % 8;
  const ch = CHORDS[bar]!;
  const swing = e % 2 === 1 ? EIGHTH * 0.18 : 0;
  const tt = t + swing;
  // piano électrique : accord sur les accents bossa
  if (BOSSA[e]) for (const n of ch.notes) { voice(hz(n), tt, 0.9, 'sine', 0.05); voice(hz(n), tt, 0.5, 'triangle', 0.018, 1800, 6); }
  // basse : fondamentale sur 1, quinte sur 3, approche chromatique en fin de mesure
  if (e === 0) voice(hz(ch.root - 12), tt, 0.7, 'triangle', 0.16, 600);
  if (e === 4) voice(hz(ch.root - 5), tt, 0.6, 'triangle', 0.13, 600);
  if (e === 7) { const nxt = CHORDS[(bar + 1) % CHORDS.length]!; voice(hz(nxt.root - 13), tt, 0.25, 'triangle', 0.1, 600); }
  // charleston très discret sur les contretemps
  if (e % 2 === 1) hat(tt, 0.02);
  // marimba : phrases courtes, plus présentes dans la seconde moitié de la grille
  const loop = Math.floor(s / 64);
  const density = bar >= 4 ? 0.45 : 0.25;
  if (rnd(s * 7 + loop * 131) < density) {
    const idx = Math.floor(rnd(s * 3 + loop * 17) * PENTA.length);
    voice(hz(PENTA[idx]!), tt, 0.35, 'sine', 0.06, 3200);
    voice(hz(PENTA[idx]! + 12), tt, 0.12, 'sine', 0.015, 4000);
  }
}

function tick() {
  if (!ctx) return;
  while (nextTime < ctx.currentTime + 0.35) {
    schedule(nextTime, step);
    nextTime += EIGHTH;
    step++;
  }
}

export function musicOn(): boolean {
  return on;
}

export function setMusic(enable: boolean) {
  if (enable === on) return;
  on = enable;
  try { localStorage.setItem(KEY, enable ? '1' : '0'); } catch { /* stockage indisponible */ }
  if (enable) {
    try {
      ctx ??= new AudioContext();
      if (ctx.state === 'suspended') void ctx.resume();
      if (!master) {
        master = ctx.createGain();
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp).connect(ctx.destination);
      }
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      master.gain.linearRampToValueAtTime(VOLUME, ctx.currentTime + 2.5); // fondu d'entrée
      nextTime = ctx.currentTime + 0.1;
      timer = window.setInterval(tick, 90);
    } catch {
      on = false;
    }
  } else {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    if (ctx && master) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0.0001, ctx.currentTime + 0.6);
    }
  }
  for (const l of listeners) l(on);
}

export function onMusicChange(f: (on: boolean) => void) {
  listeners.add(f);
  return () => { listeners.delete(f); };
}

/** Préférence enregistrée (activée par défaut). */
export function musicPreferred(): boolean {
  try { return localStorage.getItem(KEY) !== '0'; } catch { return true; }
}

/**
 * Les navigateurs n'autorisent le son qu'après un geste de l'utilisateur : la musique démarre au premier clic ou
 * à la première touche, si le joueur ne l'a pas coupée.
 */
export function armMusic() {
  const start = (e: Event) => {
    window.removeEventListener('pointerdown', start);
    window.removeEventListener('keydown', start);
    // premier geste sur le bouton musique lui-même : c'est lui qui décide
    if ((e.target as Element | null)?.closest?.('[data-music]')) return;
    if (musicPreferred()) setMusic(true);
  };
  window.addEventListener('pointerdown', start);
  window.addEventListener('keydown', start);
}
