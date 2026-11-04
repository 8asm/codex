import { CITY_BY_ID } from '../data/cities';
import { COMPANY_BY_ID } from '../data/companies';
import { BUILDING_DEPRECIATION_PA, ITEMS, OFFICE_CAP_RATE, OWNER_COSTS_PA, STYLES, TIERS } from '../data/offices';
import { rate } from '../engine/market';
import {
  buildingBook, buildingPrice, fitOutCost, localCost, managesOffice, negotiationEdge, officeBookValue, officeEffects, officeMonthly, prestige, rentFor, seatsUsed, styleCost, tierForNav,
} from '../engine/offices';
import type { OfficeCustom } from '../engine/types';
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
      <CustomizeSection />
    </Panel>
  );
}

const FACADES = ['#5d8fb8', '#2b3a4a', '#9fb7c9', '#b08d57', '#3d6b5a', '#e8e4dc', '#7a2e3a'];
const ACCENTS = ['#ffb703', '#e11d48', '#2563eb', '#10b981', '#a855f7', '#f97316', '#f1f5f9'];
const FLOORS: [string, string][] = [['#c8a27a', 'parquet'], ['#e9e6df', 'marbre'], ['#5b6470', 'moquette'], ['#9ca3af', 'béton ciré'], ['#2a2f36', 'ardoise']];
const WALLS: [string, string][] = [['#f4f1ea', 'blanc cassé'], ['#dfe7ef', 'bleu glacier'], ['#e8dccb', 'sable'], ['#2f3b4a', 'anthracite'], ['#6b4f3a', 'noyer']];
const SHAPES: [NonNullable<OfficeCustom['shape']>, string][] = [['stepped', 'en gradins'], ['straight', 'droite'], ['tapered', 'effilée'], ['cylinder', 'cylindrique'], ['twin', 'tours jumelles']];
const ROOFS: [NonNullable<OfficeCustom['roof']>, string][] = [['flat', 'plat'], ['garden', 'jardin'], ['spire', 'flèche'], ['crown', 'couronne lumineuse']];

/** Personnalisation du siège : silhouette, couleurs, toit, ailes, intérieur. Chaque changement est un chantier facturé. */
function CustomizeSection() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  if (!managesOffice(g)) return null;
  const cu = g.office.custom ?? {};
  const tower = g.office.tier >= 2;
  const set = (patch: OfficeCustom) => act({ type: 'CUSTOMIZE_OFFICE', patch });
  return (
    <>
      <h4>Personnalisation du siège</h4>
      <p className="muted small">Travaux facturés au coût local et amortis sur 60 mois. Forme et hauteur : réservées à un immeuble entier (tour ou campus). Chaque aile ajoute 15 % de postes et 12 % de loyer. Plongez dans la ville (H) pour voir le résultat.</p>
      <div className="custom-grid">
        <span>Façade (80 k$)</span>
        <div className="swatches">{FACADES.map((c) => <button key={c} className={`swatch ${cu.facade === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ facade: c })} title={c} />)}</div>
        <span>Couleur de la marque</span>
        <div className="swatches">{ACCENTS.map((c) => <button key={c} className={`swatch ${cu.accent === c ? 'on' : ''}`} style={{ background: c }} onClick={() => set({ accent: c })} title={c} />)}</div>
        <span>Forme (1,5 M$)</span>
        <div className="chips">{SHAPES.map(([id, l]) => <button key={id} disabled={!tower} className={(cu.shape ?? 'stepped') === id ? 'on' : ''} onClick={() => set({ shape: id })}>{l}</button>)}</div>
        <span>Hauteur (1,5 M$)</span>
        <div className="chips">{[0.8, 1, 1.25, 1.5].map((h) => <button key={h} disabled={!tower} className={(cu.height ?? 1) === h ? 'on' : ''} onClick={() => set({ height: h })}>{Math.round(h * 100)} %</button>)}</div>
        <span>Toit (300 k$)</span>
        <div className="chips">{ROOFS.map(([id, l]) => <button key={id} className={(cu.roof ?? 'flat') === id ? 'on' : ''} onClick={() => set({ roof: id })}>{l}</button>)}</div>
        <span>Ailes d’extension (2 M$ l’aile)</span>
        <div className="chips">{[0, 1, 2, 3].map((n) => <button key={n} className={(cu.extension ?? 0) === n ? 'on' : ''} onClick={() => set({ extension: n })}>{n === 0 ? 'aucune' : `${n} aile${n > 1 ? 's' : ''}`}</button>)}</div>
        <span>Sol de la salle (50 k$)</span>
        <div className="chips">{FLOORS.map(([c, l]) => <button key={c} className={cu.floor === c ? 'on' : ''} onClick={() => set({ floor: c })}><i className="dot" style={{ background: c }} /> {l}</button>)}</div>
        <span>Murs (50 k$)</span>
        <div className="chips">{WALLS.map(([c, l]) => <button key={c} className={cu.wall === c ? 'on' : ''} onClick={() => set({ wall: c })}><i className="dot" style={{ background: c }} /> {l}</button>)}</div>
        <span>Éclairage (50 k$)</span>
        <div className="chips">{([['chaud', 'chaud'], ['froid', 'froid'], ['neon', 'néon']] as const).map(([id, l]) => <button key={id} className={cu.lighting === id ? 'on' : ''} onClick={() => set({ lighting: id })}>{l}</button>)}</div>
        <span>Plantes (50 k$)</span>
        <div className="chips"><button className={cu.plants ? 'on' : ''} onClick={() => set({ plants: !cu.plants })}>{cu.plants ? '🪴 oui' : 'non'}</button></div>
      </div>
    </>
  );
}
