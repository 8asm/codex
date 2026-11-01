/** Décomposition de Cholesky d'une matrice symétrique définie positive : A = L·Lᵀ. */
export function cholesky(a: number[][]): number[][] {
  const n = a.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = a[i]![j]!;
      for (let k = 0; k < j; k++) sum -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (sum <= 0) throw new Error('Matrice non définie positive');
        L[i]![j] = Math.sqrt(sum);
      } else {
        L[i]![j] = sum / L[j]![j]!;
      }
    }
  }
  return L;
}

/** y = L·z (L triangulaire inférieure). */
export function mulLower(L: number[][], z: number[]): number[] {
  const n = L.length;
  const out = new Array<number>(n).fill(0);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 0; k <= i; k++) s += L[i]![k]! * z[k]!;
    out[i] = s;
  }
  return out;
}

/** Fonction de répartition de la loi normale (Abramowitz-Stegun 26.2.17 améliorée, erreur < 1e-7). */
export function normCdf(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + p * z);
  const y = 1 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1 + sign * y);
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function roundTo(x: number, step: number): number {
  return Math.round(x / step) * step;
}
