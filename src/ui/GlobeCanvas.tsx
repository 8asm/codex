import { useEffect, useRef } from 'react';
import { CITIES } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { Globe, type GlobeMarker, type GlobeOverlay } from '../render/Globe';
import { COMPANY_BY_ID } from '../data/companies';
import { ZONES } from '../data/world';
import { listedMonths } from '../engine/contracts';
import { futuresPrice } from '../engine/market';
import { rivalOf } from '../engine/companies';
import type { GameState } from '../engine/types';
import { prevPrice } from './derived';
import type { LayerId } from './store';
import { clock, useStore } from './store';

export function GlobeCanvas() {
  const ref = useRef<HTMLDivElement>(null);
  const globe = useRef<Globe | null>(null);
  const g = useStore((s) => s.game);
  const rev = useStore((s) => s.rev);
  const selectedCity = useStore((s) => s.selectedCity);
  const layers = useStore((s) => s.layers);
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
      ...worldLayers(g, layers),
    });
  }, [g, rev, selectedCity, layers]);

  return <div className="globe" ref={ref} />;
}

const stabColor = (st: number, a = 0.75) => `hsla(${Math.round((st / 100) * 120)}, 85%, 50%, ${a})`;

/** Calques du globe dérivés de l'état du monde. */
function worldLayers(g: GameState, layers: Record<LayerId, boolean>) {
  const w = g.world;
  const markers: GlobeMarker[] = [];
  for (const e of w.effects) {
    if (e.layer === 'météo' && !layers.meteo) continue;
    markers.push({ id: e.id, lat: e.lat, lon: e.lon, icon: e.icon, label: e.label, tone: e.layer === 'météo' ? 'weather' : 'alert' });
  }
  for (const z of ZONES.filter((x) => x.fictional)) {
    const sanc = w.sanctions.filter((s) => s.zone === z.id);
    const ban = w.restrictions.some((r) => r.zone === z.id);
    if (layers.tension || layers.sanctions || sanc.length || ban) {
      const st = Math.round(w.zones[z.id]!.stability);
      const tag = sanc.length ? (sanc.some((s) => s.kind === 'full') ? ' · sanctions' : ' · plafond') : ban ? ' · export bloqué' : '';
      markers.push({ id: `zone-${z.id}`, lat: z.lat, lon: z.lon, icon: sanc.length ? '🚫' : '🏴', label: `${z.name} ${layers.tension ? `${st}/100` : ''}${tag}`, tone: sanc.length || st < 40 ? 'alert' : 'info' });
    }
  }
  let cityBadges: Record<string, { initials: string; color: string; title: string; rival?: boolean }[]> | undefined;
  if (layers.rivals) {
    cityBadges = {};
    const rival = rivalOf(g);
    for (const c of g.companies.filter((x) => x.alive)) {
      const d = COMPANY_BY_ID[c.id]!;
      const initials = d.name.replace(/[^A-Za-zÀ-ÿ ]/g, '').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('');
      (cityBadges[d.cityId] ??= []).push({ initials, color: d.color, title: `${d.name} — ${(c.nav / 1e9).toFixed(2)} Md$`, rival: c.id === rival });
    }
  }
  let cityChips: Record<string, { text: string; tone: 'pos' | 'neg' | 'flat' }[]> | undefined;
  if (layers.prix) {
    cityChips = {};
    for (const c of Object.values(COMMODITIES)) {
      const mi = listedMonths(c, g.day)[0]!;
      const p = futuresPrice(g.market, c.id, mi);
      const prev = prevPrice(g.market, c.id, mi);
      const ch = prev ? p / prev - 1 : 0;
      for (const cityId of new Set(c.physical.locations.map((l) => l.cityId))) {
        const arr = (cityChips[cityId] ??= []);
        if (arr.length < 3) arr.push({ text: `${c.icon}${ch >= 0 ? '+' : ''}${(ch * 100).toFixed(1)}%`, tone: ch > 0.0005 ? 'pos' : ch < -0.0005 ? 'neg' : 'flat' });
      }
    }
  }
  let overlay: GlobeOverlay | null = null;
  if (layers.tension) {
    const countries: Record<number, string> = {};
    const blobs: GlobeOverlay['blobs'] = [];
    for (const z of ZONES) {
      const col = stabColor(w.zones[z.id]!.stability);
      if (z.fictional) blobs.push({ lat: z.lat, lon: z.lon, r: 14, color: col });
      else for (const iso of z.iso) countries[iso] = col;
    }
    overlay = { key: `t:${ZONES.map((z) => Math.round(w.zones[z.id]!.stability / 5)).join(',')}`, countries, blobs };
  } else if (layers.sanctions) {
    const countries: Record<number, string> = {};
    const blobs: GlobeOverlay['blobs'] = [];
    const mark = (zid: string, color: string) => {
      const z = ZONES.find((x) => x.id === zid)!;
      if (z.fictional) blobs.push({ lat: z.lat, lon: z.lon, r: 16, color });
      else for (const iso of z.iso) countries[iso] = color;
    };
    for (const r of w.restrictions) {
      mark(r.zone, 'rgba(251,146,60,0.8)');
      if (r.importer) mark(r.importer, 'rgba(168,85,247,0.6)');
    }
    for (const s of w.sanctions) mark(s.zone, s.kind === 'full' ? 'rgba(239,68,68,0.85)' : 'rgba(244,114,182,0.75)');
    overlay = { key: `s:${w.sanctions.map((x) => x.id).join()}|${w.restrictions.map((x) => x.id).join()}`, countries, blobs };
  }
  return { markers, cityBadges, cityChips, overlay };
}
