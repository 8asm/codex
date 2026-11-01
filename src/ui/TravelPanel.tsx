import { CITIES, CITY_BY_ID } from '../data/cities';
import { COMMODITIES, COMMODITY_IDS } from '../data/commodities';
import { formatDayShort } from '../engine/calendar';
import { flightInfo } from '../engine/travel';
import { Panel } from './common';
import { usd } from './format';
import { useStore } from './store';

export function TravelPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const sel = useStore((s) => s.selectedCity);
  const selectCity = useStore((s) => s.selectCity);
  const act = useStore((s) => s.act);
  const here = g.player.cityId;
  const t = g.player.travel;
  const focus = CITY_BY_ID[sel ?? here ?? g.company.hqCity]!;
  const hubs = COMMODITY_IDS.flatMap((c) => COMMODITIES[c].physical.locations.filter((l) => l.cityId === focus.id).map((l) => ({ c, l })));
  const offersThere = g.offers.filter((o) => o.cityId === focus.id).length;

  return (
    <Panel title="Voyages d’affaires" icon="✈️" onClose={() => setPanel('travel')}>
      {t ? (
        <div className="callout">✈ En vol {CITY_BY_ID[t.from]!.name} → {CITY_BY_ID[t.to]!.name} ({t.hours.toFixed(1)} h). Arrivée à l’ouverture du {formatDayShort(t.arriveDay)}. Les futures restent accessibles par téléphone.</div>
      ) : (
        <p className="muted small">On ne peut pas être partout : sur place, vous négociez mieux les cargaisons et le spot local. Pendant le vol, seul le téléphone fonctionne.</p>
      )}
      <div className="city-card">
        <h3>{focus.name} <small className="muted">{focus.country}</small>{focus.id === g.company.hqCity && <span className="badge here">siège</span>}</h3>
        <p className="small">{focus.blurb}</p>
        <div className="city-grid">
          <div><span>Impôt société</span><b>{(focus.corporateTax * 100).toFixed(1)} %</b></div>
          <div><span>Loyer bureau</span><b>{usd(focus.officeRentMonthly)}/mois</b></div>
          <div><span>Stabilité</span><b>{focus.politicalStability}/100</b></div>
          <div><span>Hub bancaire</span><b>{'★'.repeat(Math.round(focus.bankingHub * 5))}</b></div>
          <div><span>Régulateur</span><b className="small">{focus.regulator}</b></div>
          <div><span>Contrôle des capitaux</span><b>{focus.capitalControls ? 'oui' : 'non'}</b></div>
        </div>
        {hubs.length > 0 && (
          <div className="hubs">
            {hubs.map(({ c, l }) => <span key={l.id} className="chip" style={{ borderColor: COMMODITIES[c].color }}>{COMMODITIES[c].icon} {l.label}</span>)}
          </div>
        )}
        <div className="muted small">{offersThere} offre(s) physique(s) en cours ici.</div>
        {!t && here !== focus.id && (() => {
          const fi = flightInfo(here!, focus.id);
          return (
            <button className="primary" onClick={() => act({ type: 'TRAVEL', to: focus.id })}>
              Partir pour {focus.name} · {fi.hours.toFixed(1)} h · {fi.days} j · {usd(fi.cost)}
            </button>
          );
        })()}
        {here === focus.id && <div className="badge here">📍 Vous êtes ici</div>}
      </div>
      <div className="city-list">
        {CITIES.map((c) => {
          const fi = here && here !== c.id ? flightInfo(here, c.id) : null;
          return (
            <button key={c.id} className={`city-row ${focus.id === c.id ? 'on' : ''}`} onClick={() => selectCity(c.id)}>
              <span>{c.id === here ? '📍' : c.id === g.company.hqCity ? '🏢' : '·'} {c.name}</span>
              <span className="muted small">{fi ? `${fi.hours.toFixed(1)} h` : ''}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
