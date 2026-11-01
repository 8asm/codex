import { COMMODITIES } from '../data/commodities';
import { formatDayShort } from '../engine/calendar';
import { useStore } from './store';

export function NewsTicker() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const items = g.news.slice(0, 14);
  return (
    <footer className="ticker">
      <div className="ticker-label">ACTU</div>
      <div className="ticker-track">
        <div className="ticker-inner" key={g.news[0]?.id}>
          {[...items, ...items].map((n, i) => (
            <span key={`${n.id}-${i}`} className={`news ${n.tone} ${n.major ? 'major' : ''}`}>
              <small>{formatDayShort(n.day)}</small>
              {n.commodity && <em>{COMMODITIES[n.commodity].icon}</em>}
              {n.headline}
            </span>
          ))}
        </div>
      </div>
    </footer>
  );
}
