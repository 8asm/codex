import { useEffect, useRef } from 'react';
import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { COMPANY_BY_ID } from '../data/companies';
import { TIERS } from '../data/offices';
import { listedMonths } from '../engine/contracts';
import { futuresPrice } from '../engine/market';
import { managesOffice, prestige, seatsTotal, seatsUsed, tierForNav } from '../engine/offices';
import type { GameState } from '../engine/types';
import { CityView, type CityViewState } from '../render/CityView';
import { BRANCH } from '../engine/staff';
import { prevPrice } from './derived';
import { price as fmtPrice } from './format';
import { clock, useStore } from './store';

export const PLAYER_COLOR = '#ffb703';

/** État de la vue ville dérivé de la partie (aucune logique de jeu ici). */
export function cityViewState(g: GameState, cityId: string): CityViewState {
  const city = CITY_BY_ID[cityId]!;
  const c = g.career;
  let hq: CityViewState['hq'] = null;
  let employerId: string | null = null;
  if (managesOffice(g) && g.company.hqCity === cityId) {
    const o = g.office;
    hq = { name: g.company.name, color: PLAYER_COLOR, tier: o.tier, style: o.style, items: o.items.map((i) => i.id), owned: !!o.owned, staff: seatsUsed(g), seats: seatsTotal(g), employer: false, custom: o.custom };
  } else if (managesOffice(g) && g.staff?.branches.some((b) => b.cityId === cityId)) {
    // bureau à l'étranger : petit immeuble (représentation) ou étages loués (régional), sans personnalisation
    const b = g.staff.branches.find((x) => x.cityId === cityId)!;
    hq = { name: g.company.name, color: PLAYER_COLOR, tier: b.size === 'grand' ? 1 : 0, style: 'openspace', items: [], owned: false, staff: g.staff.employees.filter((e) => e.cityId === cityId).length, seats: BRANCH[b.size].seats, employer: false, label: BRANCH[b.size].label };
  } else if (c?.employerId && COMPANY_BY_ID[c.employerId]?.cityId === cityId) {
    employerId = c.employerId;
    const d = COMPANY_BY_ID[c.employerId]!;
    const st = g.companies.find((x) => x.id === d.id);
    const tier = tierForNav(st?.nav ?? d.capital);
    hq = { name: d.name, color: d.color, tier, style: 'openspace', items: [], owned: tier >= 2, staff: Math.round(TIERS[tier]!.seats * 0.4), seats: TIERS[tier]!.seats, employer: true };
  }
  const rivals = g.companies
    .filter((x) => x.alive && x.id !== employerId && COMPANY_BY_ID[x.id]?.cityId === cityId)
    .sort((a, b) => b.nav - a.nav)
    .map((x) => ({ id: x.id, name: COMPANY_BY_ID[x.id]!.name, color: COMPANY_BY_ID[x.id]!.color, tier: tierForNav(x.nav) }));
  const tickers = Object.values(COMMODITIES).map((spec) => {
    const mi = listedMonths(spec, g.day)[0]!;
    const p = futuresPrice(g.market, spec.id, mi);
    const prev = prevPrice(g.market, spec.id, mi);
    return { label: spec.short, price: fmtPrice(spec.id, p), change: prev ? p / prev - 1 : 0 };
  });
  return { cityId, cityName: city.name, port: city.port, hq, rivals, tickers, dayFrac: clock.dayFrac };
}

export function CityCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const view = useRef<CityView | null>(null);
  const g = useStore((s) => s.game);
  const rev = useStore((s) => s.rev);
  const cityId = useStore((s) => s.cityView);
  const phase = useStore((s) => s.cityPhase);
  const interior = useStore((s) => s.interior);
  const setInterior = useStore((s) => s.setInterior);
  const exitCity = useStore((s) => s.exitCity);
  const setPanel = useStore((s) => s.setPanel);

  useEffect(() => {
    if (!ref.current) return;
    const v = new CityView(ref.current, {
      onExit: () => useStore.getState().exitCity(),
      onHqClick: () => useStore.getState().setInterior(true),
      onInteriorExit: () => useStore.getState().setInterior(false),
    });
    view.current = v;
    const st = useStore.getState();
    if (st.game && st.cityView) v.setState(cityViewState(st.game, st.cityView));
    v.enter();
    // la lumière du jour suit la séance : rafraîchissement léger hors des changements d'état
    const timer = window.setInterval(() => {
      const s = useStore.getState();
      if (s.game && s.cityView) v.setState(cityViewState(s.game, s.cityView));
    }, 1500);
    return () => {
      window.clearInterval(timer);
      v.dispose();
      view.current = null;
    };
  }, []);

  useEffect(() => {
    if (g && cityId) view.current?.setState(cityViewState(g, cityId));
  }, [g, rev, cityId]);

  useEffect(() => {
    if (phase === 'leaving') view.current?.leave(() => useStore.getState().cityGone());
  }, [phase]);

  useEffect(() => {
    view.current?.setInterior(interior);
  }, [interior]);

  if (!g || !cityId) return null;
  const s = cityViewState(g, cityId);
  const mine = s.hq && !s.hq.employer && !s.hq.label;
  return (
    <div className={`cityview ${phase === 'leaving' ? 'leaving' : ''}`}>
      <div className="cityview-canvas" ref={ref} />
      <div className="cityview-bar">
        <button onClick={exitCity} title="Retour au globe (Échap, ou dézoomez)">🌍 Globe</button>
        <div className="cityview-title">
          <b>{s.cityName}</b>
          {s.hq && <span className="muted small">{s.hq.name} · {s.hq.label ?? TIERS[s.hq.tier]!.name}{mine ? ` · prestige ${Math.round(prestige(g))}` : ''}</span>}
        </div>
        {s.hq && <button className={interior ? 'on' : ''} onClick={() => setInterior(!interior)}>{interior ? '🏙️ Extérieur' : s.hq.label ? '💹 Bureau' : '💹 Salle de marché'}</button>}
        {mine && <button onClick={() => setPanel('offices', true)}>🏛️ Personnaliser</button>}
        {s.hq?.label && <button onClick={() => setPanel('staff', true)}>👥 Équipe</button>}
      </div>
      {interior && s.hq && (
        <div className="cityview-caption small">
          {s.hq.staff} personnes sur {s.hq.seats} postes{mine ? ` · style ${g.office.style}` : ''} · le mur d’écrans affiche les cours en direct
        </div>
      )}
      {!interior && s.hq && <div className="cityview-caption small muted">Cliquez sur le siège, ou zoomez dessus, pour entrer dans la salle de marché · dézoomez pour revenir au globe</div>}
    </div>
  );
}
