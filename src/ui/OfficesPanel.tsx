import { CITY_BY_ID } from '../data/cities';
import { COMPANY_BY_ID } from '../data/companies';
import { BUILDING_DEPRECIATION_PA, ITEMS, OFFICE_CAP_RATE, OWNER_COSTS_PA, STYLES, TIERS } from '../data/offices';
import { rate } from '../engine/market';
import {
  buildingBook, buildingPrice, fitOutCost, localCost, managesOffice, negotiationEdge, officeBookValue, officeEffects, officeMonthly, prestige, rentFor, seatsUsed, styleCost, tierForNav,
} from '../engine/offices';
import type { NpcRole, OfficeTier } from '../engine/types';
import { nav } from '../engine/valuation';
import { Panel, Term } from './common';
import { usd } from './format';
import { useStore } from './store';

const INVITE_ROLES: NpcRole[] = ['client', 'banquier', 'investisseur', 'officiel', 'journaliste'];

export function OfficesPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const requestCity = useStore((s) => s.requestCity);
  const cityPhase = useStore((s) => s.cityPhase);
  const o = g.office;
  const city = CITY_BY_ID[g.company.hqCity]!;
  const view = () => {
    const c = g.career;
    const target = c && !managesOffice(g) && c.employerId ? COMPANY_BY_ID[c.employerId]!.cityId : g.company.hqCity;
    if (!cityPhase) requestCity(target);
  };

  if (!managesOffice(g)) {
    const c = g.career!;
    const emp = c.employerId ? COMPANY_BY_ID[c.employerId] : null;
    const st = emp ? g.companies.find((x) => x.id === emp.id) : null;
    return (
      <Panel title="Bureaux" icon="🏛️" onClose={() => setPanel('offices')}>
        {emp ? (
          <>
            <p>Vous travaillez au siège de <b>{emp.name}</b> à {CITY_BY_ID[emp.cityId]!.name} : {TIERS[tierForNav(st?.nav ?? 0)]!.name.toLowerCase()}.</p>
            <p className="muted small">Les bureaux appartiennent à votre employeur. Fondez votre maison (ou prenez la direction) pour choisir vos locaux, votre salle de marché et vos objets de prestige.</p>
          </>
        ) : (
          <p className="muted">Sans poste, vous n’avez pas de bureau.</p>
        )}
        <button className="primary" onClick={view} disabled={!emp}>🏙️ Voir le siège en 3D</button>
      </Panel>
    );
  }

  const m = officeMonthly(g);
  const P = prestige(g);
  const e = officeEffects(g);
  const def = TIERS[o.tier]!;
  const used = seatsUsed(g);
  const v = nav(g);
  const free = g.company.cash - g.company.im;
  const r = rate(g.market, 'USD');
  const atHq = g.player.cityId === g.company.hqCity;

  // Louer ou acheter : coût annuel complet de chaque option au palier courant
  const leaseBuy = (t: OfficeTier) => {
    const price = buildingPrice(g, t);
    const rentY = rentFor(g, t) * 12;
    const ownY = price * (r + OWNER_COSTS_PA + BUILDING_DEPRECIATION_PA);
    return { price, rentY, ownY };
  };

  const contacts = g.npcs.filter((n) => INVITE_ROLES.includes(n.role)).sort((a, b) => b.trust - a.trust).slice(0, 8);

  return (
    <Panel title="Bureaux" icon="🏛️" onClose={() => setPanel('offices')} wide>
      <div className="office-head">
        <div>
          <h3>{def.name} · {city.name}</h3>
          <p className="muted small">{def.blurb}</p>
          <button className="primary" onClick={view}>🏙️ Voir le siège en 3D</button>
        </div>
        <div className="office-kpis">
          <div><small><Term id="prestige">Prestige</Term></small><b>{Math.round(P)}/100</b><div className="gauge"><i style={{ width: `${P}%` }} /></div></div>
          <div><small>Postes</small><b className={used > def.seats ? 'neg' : ''}>{used}/{def.seats}</b></div>
          <div><small>Loyer / mois</small><b>{usd(m.rent)}</b></div>
          <div><small>Charges / mois</small><b>{usd(m.upkeep + m.overflow)}</b></div>
          <div><small>Valeur au bilan</small><b>{usd(officeBookValue(g))}</b></div>
        </div>
      </div>
      {used > def.seats && <p className="warn small">Locaux saturés : {used - def.seats} poste(s) en coworking ({usd(m.overflow)}/mois) et prestige réduit. Agrandissez-vous, ou réduisez gérants et automatismes.</p>}

      <h4>Locaux</h4>
      <div className="tier-grid">
        {TIERS.map((t) => {
          const cur = t.tier === o.tier;
          const fit = fitOutCost(g, t.tier);
          const lb = leaseBuy(t.tier);
          const blocked = t.tier > o.tier && v < t.minNav;
          const recent = g.day - o.movedDay < 60;
          return (
            <div key={t.tier} className={`tier-card ${cur ? 'on' : ''}`}>
              <b>{t.name}</b>
              <div className="muted small">{t.seats} postes · loyer {usd(rentFor(g, t.tier))}/mois</div>
              <div className="muted small">Agencement {usd(fit)} · prestige +{t.prestige}</div>
              {t.minNav > 0 && <div className={`small ${blocked ? 'neg' : 'muted'}`}>VL requise {usd(t.minNav, 0)}</div>}
              {cur ? (
                <span className="tag">Vos locaux{o.owned ? ' · propriétaire' : ''}</span>
              ) : (
                <div className="row">
                  <button disabled={blocked || recent || fit > free} onClick={() => act({ type: 'OFFICE_MOVE', tier: t.tier })}>{t.tier > o.tier ? 'Emménager' : 'Réduire'}</button>
                  {t.tier >= 2 && <button disabled={blocked || recent || fit + lb.price > free} onClick={() => act({ type: 'OFFICE_MOVE', tier: t.tier, buy: true })} title="Emménager et acheter l’immeuble">Acheter {usd(lb.price, 0)}</button>}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {o.tier >= 2 && (() => {
        const lb = leaseBuy(o.tier);
        const better = lb.ownY < lb.rentY;
        return (
          <div className="leasebuy">
            <h4><Term id="leasebuy">Louer ou acheter</Term></h4>
            <table className="small">
              <tbody>
                <tr><td>Prix de l’immeuble (loyer / cap rate {(OFFICE_CAP_RATE * 100).toFixed(0)} %)</td><td>{usd(lb.price)}</td></tr>
                <tr><td>Louer : loyer annuel</td><td>{usd(lb.rentY)}</td></tr>
                <tr><td>Acheter : coût de l’argent {(r * 100).toFixed(2)} % + charges {(OWNER_COSTS_PA * 100).toFixed(1)} % + usure {(BUILDING_DEPRECIATION_PA * 100).toFixed(1)} %</td><td>{usd(lb.ownY)}</td></tr>
              </tbody>
            </table>
            <p className="muted small">{better ? 'Aux taux actuels, être propriétaire coûte moins cher chaque année' : 'Aux taux actuels, louer reste moins cher'} — mais acheter immobilise {usd(lb.price)} de trésorerie qui ne sert plus de marge. Propriétaire : prestige +5.</p>
            {o.owned ? (
              <button onClick={() => act({ type: 'OFFICE_PROPERTY', buy: false })}>Cession-bail : vendre ({usd(buildingBook(g) * 0.97)})</button>
            ) : (
              <button disabled={lb.price > free} onClick={() => act({ type: 'OFFICE_PROPERTY', buy: true })}>Acheter l’immeuble ({usd(lb.price)})</button>
            )}
          </div>
        );
      })()}

      <h4>Salle de marché</h4>
      <div className="style-grid">
        {STYLES.map((s) => (
          <div key={s.id} className={`style-card style-${s.id} ${o.style === s.id ? 'on' : ''}`}>
            <b>{s.name}</b>
            <div className="small">{s.effect}</div>
            <div className="muted small">{s.blurb}</div>
            {o.style === s.id ? <span className="tag">Actuel</span> : <button onClick={() => act({ type: 'OFFICE_STYLE', style: s.id })}>Réaménager · {usd(styleCost(g, s.id))}</button>}
          </div>
        ))}
      </div>
      <p className="muted small">Réaménagements et agencements sont <Term id="capex">capitalisés et amortis</Term> sur 60 mois : la valeur liquidative ne baisse pas le jour de la dépense, mais au fil du temps.</p>

      <h4>Prestige</h4>
      <div className="item-grid">
        {ITEMS.map((it) => {
          const own = o.items.some((x) => x.id === it.id);
          const locked = o.tier < it.minTier;
          const cost = it.resale > 0 ? it.cost : it.cost * localCost(g);
          return (
            <div key={it.id} className={`item-card ${own ? 'on' : ''} ${locked ? 'locked' : ''}`}>
              <span className="icon">{it.icon}</span>
              <div>
                <b>{it.name}</b>
                <div className="small">{it.effect}</div>
                <div className="muted small">{usd(cost)}{it.monthly ? ` + ${usd(it.monthly)}/mois` : ''}{locked ? ` · requiert : ${TIERS[it.minTier]!.name.toLowerCase()}` : ''}</div>
              </div>
              {own ? (
                <button onClick={() => act({ type: 'OFFICE_ITEM', item: it.id, sell: true })}>{it.resale > 0 ? 'Vendre' : 'Retirer'}</button>
              ) : (
                <button disabled={locked || cost > free} onClick={() => act({ type: 'OFFICE_ITEM', item: it.id })}>Installer</button>
              )}
            </div>
          );
        })}
      </div>

      <h4>Recevoir au siège</h4>
      <p className="muted small">
        {atHq ? 'Invitez un contact dans vos bureaux : plus le siège impressionne, plus la confiance progresse.' : `Vous devez être à ${city.name} pour recevoir.`}
        {' '}Effets actuels : relations ×{(e.relationMult * e.inviteMult).toFixed(2)}, marge de négociation +{(negotiationEdge(g) * 1e4).toFixed(1)} pb, candidatures {Math.round(e.talentRate * 100)} %/mois{o.applicants ? ` (${o.applicants} reçues)` : ''}.
      </p>
      <div className="invite-list">
        {contacts.map((n) => (
          <div key={n.id} className="invite-row">
            <span>{n.name} <span className="muted small">· {n.role}{n.companyId ? ` · ${COMPANY_BY_ID[n.companyId]?.name ?? ''}` : ''}</span></span>
            <span className={n.trust >= 0 ? 'pos' : 'neg'}>{Math.round(n.trust)}</span>
            <button disabled={!atHq} onClick={() => act({ type: 'INVITE_HQ', npcId: n.id })}>Inviter</button>
          </div>
        ))}
      </div>
    </Panel>
  );
}
