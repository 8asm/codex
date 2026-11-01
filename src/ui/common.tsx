import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CODEX_BY_ID } from '../data/glossary';
import { useStore } from './store';

/** Terme technique : infobulle courte + clic vers le codex. Le survol débloque l'entrée. */
export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const entry = CODEX_BY_ID[id];
  const seeTerm = useStore((s) => s.seeTerm);
  const openCodex = useStore((s) => s.openCodex);
  if (!entry) return <>{children}</>;
  return (
    <span className="term" onMouseEnter={() => seeTerm(id)} onClick={(e) => { e.stopPropagation(); openCodex(id); }}>
      {children ?? entry.term}
      <span className="term-tip">
        <b>{entry.term}</b>
        {entry.short}
        <em>Clic : ouvrir le codex</em>
      </span>
    </span>
  );
}

/** Nombre animé (interpolation + flash coloré au changement). */
export function AnimatedNumber({ value, format, className = '' }: { value: number; format: (x: number) => string; className?: string }) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState<'' | 'up' | 'down'>('');
  const from = useRef(value);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    if (Math.abs(value - a) > 1e-6) setFlash(value > a ? 'up' : 'down');
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / 550);
      const e = 1 - (1 - k) ** 3;
      const v = a + (value - a) * e;
      setShown(v);
      from.current = v;
      if (k < 1) raf.current = requestAnimationFrame(tick);
      else setTimeout(() => setFlash(''), 250);
    };
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <span className={`anim-num ${flash} ${className}`}>{format(shown)}</span>;
}

export function Sparkline({ data, width = 90, height = 26, color = '#7dd3fc', fill = true }: { data: number[]; width?: number; height?: number; color?: string; fill?: boolean }) {
  if (data.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
  return (
    <svg width={width} height={height} className="spark">
      {fill && <path d={`${d}L${width},${height}L0,${height}Z`} fill={color} opacity={0.15} />}
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
    </svg>
  );
}

export function Panel({ title, icon, children, onClose, wide }: { title: string; icon: string; children: ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <section className={`panel ${wide ? 'wide' : ''}`}>
      <header>
        <span className="panel-icon">{icon}</span>
        <h2>{title}</h2>
        <button className="ghost close" onClick={onClose} aria-label="Fermer">✕</button>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, className = '' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={`stat ${className}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}
