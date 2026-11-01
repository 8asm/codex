import { COMMODITIES } from '../data/commodities';
import type { CommodityId } from '../engine/types';

export function usd(x: number, digits = 1): string {
  const s = x < 0 ? '−' : '';
  const a = Math.abs(x);
  if (a >= 1e9) return `${s}${(a / 1e9).toFixed(digits)} Md$`;
  if (a >= 1e6) return `${s}${(a / 1e6).toFixed(digits)} M$`;
  if (a >= 1e3) return `${s}${(a / 1e3).toFixed(0)} k$`;
  return `${s}${a.toFixed(0)} $`;
}

export function signedUsd(x: number, digits = 1): string {
  return (x > 0 ? '+' : '') + usd(x, digits);
}

export function price(c: CommodityId, p: number): string {
  return p.toLocaleString('fr-FR', { minimumFractionDigits: COMMODITIES[c].decimals, maximumFractionDigits: COMMODITIES[c].decimals });
}

export function qty(c: CommodityId, q: number): string {
  const spec = COMMODITIES[c];
  const fmt = (v: number, u: string) => {
    const a = Math.abs(v);
    const s = a >= 1e6 ? `${(v / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} M` : a >= 1e4 ? `${(v / 1e3).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k` : v.toLocaleString('fr-FR', { maximumFractionDigits: 0 });
    return `${s} ${u}`;
  };
  if (spec.display) return `${fmt(q * spec.display.factor, spec.display.unit)}`;
  return fmt(q, spec.qtyUnit);
}

export function pct(x: number, digits = 1): string {
  return `${x > 0 ? '+' : ''}${(x * 100).toFixed(digits)} %`;
}

export const tone = (x: number) => (x > 1e-9 ? 'pos' : x < -1e-9 ? 'neg' : 'flat');
