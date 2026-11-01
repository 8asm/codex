/** Effets sonores synthétisés (WebAudio), aucun fichier audio. */
let ctx: AudioContext | null = null;
let muted = false;

export function setMuted(m: boolean) {
  muted = m;
}
export function isMuted() {
  return muted;
}

function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08, delay = 0) {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  } catch {
    /* audio indisponible */
  }
}

export const sfx = {
  trade: () => { tone(880, 0.08, 'triangle', 0.06); tone(1320, 0.1, 'triangle', 0.05, 0.06); },
  deal: () => { tone(523, 0.12, 'sine', 0.07); tone(659, 0.12, 'sine', 0.07, 0.1); tone(784, 0.2, 'sine', 0.07, 0.2); },
  alarm: () => { for (let i = 0; i < 3; i++) { tone(740, 0.16, 'square', 0.05, i * 0.32); tone(554, 0.16, 'square', 0.05, i * 0.32 + 0.16); } },
  news: () => { tone(660, 0.1, 'sine', 0.05); tone(990, 0.18, 'sine', 0.05, 0.08); },
  error: () => tone(180, 0.2, 'sawtooth', 0.05),
  takeoff: () => { tone(220, 0.6, 'sine', 0.04); tone(330, 0.6, 'sine', 0.03, 0.2); },
};
