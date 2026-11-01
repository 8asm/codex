import { useEffect, useRef } from 'react';
import { CITIES } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { Globe } from '../render/Globe';
import { clock, useStore } from './store';

export function GlobeCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const globe = useRef<Globe | null>(null);
  const g = useStore((s) => s.game);
  const rev = useStore((s) => s.rev);
  const selectedCity = useStore((s) => s.selectedCity);
  const selectCity = useStore((s) => s.selectCity);

  useEffect(() => {
    if (!ref.current) return;
    globe.current = new Globe(ref.current, {
      cities: CITIES,
      onCityClick: (id) => {
        selectCity(id);
        globe.current?.focusCity(id);
      },
      travelProgress: () => {
        const t = useStore.getState().game?.player.travel;
        const st = useStore.getState().game;
        if (!t || !st) return null;
        // progression continue : jours écoulés + fraction du jour courant
        const total = Math.max(1, t.arriveDay - t.departDay);
        return Math.min(1, (st.day - t.departDay + clock.dayFrac * (st.day < t.arriveDay ? 1 : 0)) / total);
      },
    });
    return () => globe.current?.dispose();
  }, [selectCity]);

  const startDay = g?.startDay;
  const hq = g?.company.hqCity;
  useEffect(() => {
    if (hq) globe.current?.focusCity(hq, true);
  }, [startDay, hq]);

  useEffect(() => {
    if (!g || !globe.current) return;
    const active: Record<string, string> = {};
    for (const d of g.forwards) {
      const loc = COMMODITIES[d.commodity].physical.locations.find((l) => l.id === d.locationId)!;
      active[loc.cityId] = COMMODITIES[d.commodity].color;
    }
    for (const l of g.inventory) {
      const loc = COMMODITIES[l.commodity].physical.locations.find((x) => x.id === l.locationId)!;
      active[loc.cityId] = COMMODITIES[l.commodity].color;
    }
    globe.current.setView({
      hqCity: g.company.hqCity,
      playerCity: g.player.cityId,
      travel: g.player.travel ? { from: g.player.travel.from, to: g.player.travel.to } : null,
      selectedCity,
      activeCities: active,
    });
  }, [g, rev, selectedCity]);

  return <div className="globe" ref={ref} />;
}
