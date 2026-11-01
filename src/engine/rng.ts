/**
 * Générateur pseudo-aléatoire déterministe (sfc32), état entièrement sérialisable.
 * Toute la simulation tire ses aléas d'ici : même seed + mêmes actions => même partie.
 */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** Hache une chaîne / un nombre en état initial (xmur3). */
export function seedRng(seed: string | number): RngState {
  const str = String(seed);
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  const next = () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  };
  const s: RngState = { a: next(), b: next(), c: next(), d: next() };
  // quelques tours de chauffe
  for (let i = 0; i < 12; i++) uniform(s);
  return s;
}

/** Uniforme sur [0,1). Mute l'état. */
export function uniform(s: RngState): number {
  s.a >>>= 0;
  s.b >>>= 0;
  s.c >>>= 0;
  s.d >>>= 0;
  let t = (s.a + s.b) | 0;
  s.a = s.b ^ (s.b >>> 9);
  s.b = (s.c + (s.c << 3)) | 0;
  s.c = (s.c << 21) | (s.c >>> 11);
  s.d = (s.d + 1) | 0;
  t = (t + s.d) | 0;
  s.c = (s.c + t) | 0;
  return (t >>> 0) / 4294967296;
}

/** Normale centrée réduite (Box-Muller, sans cache pour rester trivialement sérialisable). */
export function normal(s: RngState): number {
  let u = 0;
  while (u <= 1e-12) u = uniform(s);
  const v = uniform(s);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function randInt(s: RngState, minIncl: number, maxIncl: number): number {
  return minIncl + Math.floor(uniform(s) * (maxIncl - minIncl + 1));
}

export function pick<T>(s: RngState, arr: readonly T[]): T {
  return arr[Math.floor(uniform(s) * arr.length)]!;
}

export function chance(s: RngState, p: number): boolean {
  return uniform(s) < p;
}

/** Tirage de Poisson (Knuth) pour de petits lambdas. */
export function poisson(s: RngState, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= uniform(s);
  } while (p > L);
  return k - 1;
}
