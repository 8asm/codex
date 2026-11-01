import { useState } from 'react';
import { COMMODITIES } from '../data/commodities';
import { COMPANY_BY_ID } from '../data/companies';
import { formatDayShort, businessDaysBetween } from '../engine/calendar';
import type { NewsCategory } from '../engine/types';
import { Panel, Term } from './common';
import { useStore } from './store';

const CATS: (NewsCategory | 'tout')[] = ['tout', 'marché', 'géopolitique', 'macro', 'météo', 'entreprises', 'réglementation', 'logistique'];
const STAGE: Record<string, { label: string; cls: string; term: string }> = {
  rumor: { label: 'RUMEUR', cls: 'rumor', term: 'rumor' },
  confirmed: { label: 'CONFIRMÉ', cls: 'confirmed', term: 'rumor' },
  denied: { label: 'DÉMENTI', cls: 'denied', term: 'rumor' },
};

export function NewsPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const focusCompany = useStore((s) => s.focusCompany);
  const [cat, setCat] = useState<NewsCategory | 'tout'>('tout');
  const cal = g.world.calendar;
  const upcoming = [
    { day: cal.opec, label: 'Réunion du cartel des producteurs', icon: '🛢️' },
    { day: cal.fomc, label: 'Réserve fédérale (taux USD)', icon: '🏛️' },
    { day: cal.ecb, label: 'Banque centrale européenne (taux EUR)', icon: '🏛️' },
  ].sort((a, b) => a.day - b.day);
  const items = g.news.filter((n) => cat === 'tout' || (n.category ?? 'marché') === cat).slice(0, 60);
  return (
    <Panel title="Actualités" icon="📰" onClose={() => setPanel('news')} wide>
      <div className="calendar">
        {upcoming.map((u) => (
          <div key={u.label} className="cal-item"><span>{u.icon}</span><b>{u.label}</b><small>dans {businessDaysBetween(g.day, u.day)} j · {formatDayShort(u.day)}</small></div>
        ))}
        <div className="cal-item"><span>📦</span><b>Stocks pétroliers US</b><small>chaque mercredi</small></div>
        <div className="cal-item"><span>🌾</span><b>Rapport agricole mensuel</b><small>vers le 10 du mois</small></div>
      </div>
      <div className="chips">
        {CATS.map((c) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
      </div>
      <p className="muted small">Les <Term id="rumor">rumeurs</Term> font bouger le marché avant d’être confirmées… ou démenties. Les grosses news sont souvent déjà dans les prix quand vous les lisez.</p>
      <div className="newsfeed">
        {items.map((n) => (
          <article key={n.id} className={`news-card ${n.tone} ${n.major ? 'major' : ''}`}>
            <div className="nc-head">
              <small className="muted">{formatDayShort(n.day)}</small>
              <span className="nc-cat">{n.category ?? 'marché'}</span>
              {n.stage && <span className={`stage ${STAGE[n.stage]!.cls}`}>{STAGE[n.stage]!.label}</span>}
              {n.impacts?.map((i) => <span key={i.c} className={`imp ${i.dir > 0 ? 'pos' : 'neg'}`}>{COMMODITIES[i.c].icon}{i.dir > 0 ? '▲' : '▼'}</span>)}
              {!n.impacts?.length && n.commodity && <span className="imp">{COMMODITIES[n.commodity].icon}</span>}
            </div>
            <h4>{n.headline}</h4>
            {n.body && <p>{n.body}</p>}
            {n.companyId && COMPANY_BY_ID[n.companyId] && <button className="small" onClick={() => focusCompany(n.companyId!)}>Voir {COMPANY_BY_ID[n.companyId]!.name}</button>}
          </article>
        ))}
      </div>
    </Panel>
  );
}
