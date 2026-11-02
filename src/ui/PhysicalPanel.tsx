import { useState } from 'react';
import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { activeCommodities } from '../engine/physical';
import { COUNTERPARTY_BY_ID } from '../data/counterparties';
import { formatDayShort, monthLabel } from '../engine/calendar';
import { basis } from '../engine/market';
import { roundTo } from '../engine/math';
import { effectiveDiff, offerCosts, offerNetEdge, INSPECTION_COST, isPresent, LOCAL_EDGE_PCT, notionalUsd, offerBlock, offerDeliveryDay, offerEdge, offerPrice, offerToleranceValue, offSpecProbability, REMOTE_SPOT_PENALTY } from '../engine/physical';
import { offerHasBuyerLc, offerNeedsLc } from '../engine/financing';
import { sanctionedOrigin } from '../engine/compliance';
import { cpRating } from '../engine/credit';
import { ZONE_BY_ID } from '../data/world';
import type { CommodityId, GameState, Offer } from '../engine/types';
import { GRADE_BY_ID } from '../data/grades';
import { gradeDiff } from '../engine/grades';
import { localSpot } from '../engine/valuation';
import { Panel, Term } from './common';
import { CommodityPicker } from './common';
import { hedgeLots, hedgeMonthFor } from './derived';
import { price, qty, signedUsd, tone, usd } from './format';
import { useStore } from './store';

const INCOTERM_TERM: Record<string, string> = { FOB: 'fob', CIF: 'cif', CFR: 'cif', DAP: 'dap', DES: 'dap', FCA: 'fob', HUB: 'basis' };
const INCOTERM_DUTY: Record<string, string> = {
  FOB: 'livré à bord au port de départ — l’acheteur affrète, paie fret et assurance et porte le risque dès le chargement',
  CFR: 'le vendeur paie le fret jusqu’à destination ; le risque passe à l’acheteur au chargement',
  CIF: 'le vendeur paie fret et assurance jusqu’à destination ; le risque passe à l’acheteur au chargement',
  DAP: 'livré à destination — le vendeur porte transport et risque jusqu’au lieu convenu',
  DES: 'livré à destination à bord du navire',
  FCA: 'remis au transporteur (rail, barge) au lieu convenu',
  HUB: 'transfert de propriété sur le hub virtuel, sans transport physique',
};

export function PhysicalPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const [tab, setTab] = useState<'offers' | 'spot'>('offers');
  return (
    <Panel title="Physique" icon="🚢" onClose={() => setPanel('physical')} wide>
      <div className="tabs">
        <button className={tab === 'offers' ? 'on' : ''} onClick={() => setTab('offers')}>Offres de cargaisons <span className="pill">{g.offers.length}</span></button>
        <button className={tab === 'spot' ? 'on' : ''} onClick={() => setTab('spot')}>Marché spot</button>
      </div>
      {tab === 'offers' ? <Offers /> : <Spot />}
    </Panel>
  );
}

function Offers() {
  const g = useStore((s) => s.game)!;
  if (!g.offers.length) return <div className="empty">Pas d’offre pour l’instant. Les contreparties appellent chaque matin.</div>;
  return (
    <div className="offers">
      <p className="muted small">
        Prix fixe = courbe au mois de livraison + <Term id="basis">différentiel</Term>. Sur place, vous renégociez d’environ {(LOCAL_EDGE_PCT * 100).toFixed(1)} % : voyager paie.
      </p>
      {g.offers.map((o) => <OfferCard key={o.id} o={o} />)}
    </div>
  );
}

function OfferCard({ o }: { o: Offer }) {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const toast = useStore((s) => s.toast);
  const spec = COMMODITIES[o.commodity];
  const loc = spec.physical.locations.find((l) => l.id === o.locationId)!;
  const cp = COUNTERPARTY_BY_ID[o.counterpartyId]!;
  const city = CITY_BY_ID[o.cityId]!;
  const here = isPresent(g, o.cityId);
  const px = offerPrice(g, o);
  const diff = effectiveDiff(g, o);
  const fair = basis(g.market, o.commodity, o.locationId);
  const edge = offerEdge(g, o);
  const hm = hedgeMonthFor(g, o.commodity, offerDeliveryDay(o));
  const hl = hedgeLots(o.commodity, hm, o.qty);
  const block = offerBlock(g, o);
  const rating = cpRating(g, o.counterpartyId);
  const zone = ZONE_BY_ID[cp.zone];
  const focusCompany = useStore.getState().focusCompany;

  const [inspect, setInspect] = useState(false);
  const needLc = offerNeedsLc(g, o);
  const buyerLc = offerHasBuyerLc(g, o);
  const sanct = sanctionedOrigin(g, o);
  const pOff = o.side > 0 ? offSpecProbability(g, o.counterpartyId) : 0;
  const accept = (hedge: boolean) => {
    const r = act({ type: 'ACCEPT_OFFER', offerId: o.id, inspect });
    if (r.ok && hedge) {
      const h = act({ type: 'TRADE_FUTURE', commodity: o.commodity, month: hm, lots: -o.side * hl }, true);
      toast(h.ok ? `Couvert : ${o.side > 0 ? 'vente' : 'achat'} de ${hl} lots ${monthLabel(hm)}.` : `Couverture refusée : ${h.message}`, h.ok ? 'good' : 'bad');
    }
  };

  return (
    <div className="offer" style={{ ['--c' as string]: spec.color }}>
      <div className="offer-top">
        <span className="mkt-icon">{spec.icon}</span>
        <div className="offer-title">
          <b className="link" onClick={() => focusCompany(cp.id)}>{cp.name}</b> <span className={`rating ${['BB', 'B', 'CCC'].includes(rating) ? 'warn' : ''}`} title="Notation de crédit">{rating}</span>{zone?.fictional && <span className="badge">{zone.name}</span>} {o.side > 0 ? 'vend' : 'cherche à acheter'} <b>{qty(o.commodity, o.qty)}</b> de {spec.short}
          <div className="muted small">
            {o.grade && <GradeTag grade={o.grade} g={g} day={offerDeliveryDay(o)} />}
            <Term id={INCOTERM_TERM[loc.incoterm] ?? 'basis'}>{loc.label}</Term> · livraison {monthLabel(o.month)} ({formatDayShort(offerDeliveryDay(o))}) · {city.name}
          </div>
        </div>
        {o.side < 0 && g.forwards.some((d) => d.side > 0 && d.commodity === o.commodity && d.locationId === o.locationId && d.deliveryDay <= offerDeliveryDay(o)) && <span className="badge here" title="Même commodité, même lieu, livrée après votre achat : votre cargaison servira cette vente.">✓ adosse votre achat</span>}
        {o.side < 0 && g.inventory.some((l) => l.commodity === o.commodity && l.locationId === o.locationId) && <span className="badge here" title="Vous avez du stock à ce lieu pour servir cette vente.">✓ servie par votre stock</span>}
        <span className={`badge ${here ? 'here' : ''}`}>{here ? '🤝 sur place' : '📞 téléphone'}</span>
      </div>
      <div className="offer-grid">
        <div><span>Diff proposé</span><b>{diff >= 0 ? '+' : ''}{price(o.commodity, diff)}</b></div>
        <div><span>Diff de marché</span><b>{fair >= 0 ? '+' : ''}{price(o.commodity, roundTo(fair, spec.tick))}</b></div>
        <div><span>Prix fixe</span><b>{price(o.commodity, px)} {spec.priceUnit}</b></div>
        <div title={(() => { const c = offerCosts(g, o); return `Valeur nette ${signedUsd(offerNetEdge(g, o))} = valeur du prix ${signedUsd(edge)} − sortie au comptant ${usd(c.exit)} − couverture aller-retour ${usd(c.hedge)}${c.lc ? ` − lettre de crédit ${usd(c.lc)}` : ''}${c.inspection ? ` − inspection ${usd(c.inspection)}` : ''}. Restent hors calcul : stockage, financement du stock et risque de base.`; })()}><span>Valeur estimée</span><b className={tone(edge)}>{signedUsd(edge)}</b><small className="muted"> net seul {signedUsd(offerNetEdge(g, o))}</small></div>
      </div>
      <div className="incoterm small">
        <Term id={INCOTERM_TERM[loc.incoterm] ?? 'basis'}>{loc.incoterm}</Term> : {INCOTERM_DUTY[loc.incoterm]} · laycan {formatDayShort(offerDeliveryDay(o) - 2)} – {formatDayShort(offerDeliveryDay(o) + 2)}
        {o.tolerance ? <> · <Term id="tolerance">tolérance ±{Math.round(o.tolerance * 100)} %</Term> au choix du vendeur ({signedUsd(offerToleranceValue(g, o))})</> : null}
      </div>
      <div className="offer-tags small">
        {needLc && <span className="tag-chip" title="Le vendeur exige une lettre de crédit : commission 0,15 % + 0,08 %/mois, ligne de crédit documentaire consommée."><Term id="lc">LC exigée</Term></span>}
        {buyerLc && <span className="tag-chip good" title="L'acheteur fournit une lettre de crédit confirmée : sa banque paie même s'il fait défaut."><Term id="lc">LC confirmée</Term></span>}
        {sanct && <span className="tag-chip bad" title="Marchandise d'une zone sous sanctions : décote attractive, mais risque de poursuites (sanctions secondaires)."><Term id="secondary">origine sanctionnée</Term></span>}
        {o.bribe && <span className="tag-chip bad" title="Un « consultant » réclame une commission pour ce contrat. Rien ne vous y oblige.">💼 commission {usd(o.bribe)}</span>}
        {o.side > 0 && (
          <label className="tag-chip" title={`Probabilité de cargaison hors spécification : ${Math.round(pOff * 100)} %. L'inspecteur indépendant la détecte au chargement : réfaction ou refus.`}>
            <input type="checkbox" checked={inspect} onChange={(e) => setInspect(e.target.checked)} /> <Term id="inspection">inspection</Term> ({usd(notionalUsd(g, o.commodity, o.qty, px) * INSPECTION_COST)}) · risque qualité {Math.round(pOff * 100)} %
          </label>
        )}
      </div>
      {block && <div className="offer-block">⛔ {block}{o.kycReadyDay && g.day < o.kycReadyDay ? ` (prêt le ${formatDayShort(o.kycReadyDay)})` : ''}</div>}
      <div className="offer-actions">
        <span className="muted small">expire le {formatDayShort(o.expiresDay)}</span>
        {!o.negotiated && <button disabled={!!block} onClick={() => act({ type: 'START_NEGOTIATION', kind: 'deal', target: o.id })} title="Mini-jeu : améliorer le différentiel (une seule tentative)">Négocier</button>}
        <button disabled={!!block} onClick={() => accept(false)}>{o.side > 0 ? 'Acheter' : 'Vendre'}</button>
        <button className="primary" disabled={!!block} onClick={() => accept(true)} title={`+ ${o.side > 0 ? 'vente' : 'achat'} de ${hl} lots ${monthLabel(hm)}`}>
          {o.side > 0 ? 'Acheter' : 'Vendre'} + <Term id="hedge">couvrir</Term> ({hl} lots {monthLabel(hm)})
        </button>
      </div>
    </div>
  );
}

function Spot() {
  const g = useStore((s) => s.game)!;
  const act = useStore((s) => s.act);
  const [c, setC] = useState<CommodityId>('BRENT');
  const spec = COMMODITIES[c];
  const [size, setSize] = useState(spec.physical.cargoSizes[0]!);
  const sizes = spec.physical.cargoSizes;
  const sz = sizes.includes(size) ? size : sizes[0]!;
  return (
    <div className="spot">
      <CommodityPicker value={c} onChange={setC} only={activeCommodities(g).filter((x) => COMMODITIES[x].physical.storable !== false)} />
      <p className="muted small">
        Acheter une cargaison prompte et la stocker : intéressant en <Term id="contango">contango</Term> si l’écart de courbe paie le stockage
        ({price(c, spec.physical.storagePerUnitMonth)} {spec.priceUnit}/mois) et le financement (<Term id="cashcarry">cash-and-carry</Term>).
        Hors place : +{(REMOTE_SPOT_PENALTY * 100).toFixed(1)} %.
      </p>
      <div className="chips">
        {sizes.map((s) => <button key={s} className={sz === s ? 'on' : ''} onClick={() => setSize(s)}>{qty(c, s)}</button>)}
      </div>
      <table className="tbl">
        <thead><tr><th>Lieu</th><th>Ville</th><th>Spot local</th><th>Diff</th><th>Coût</th><th /></tr></thead>
        <tbody>
          {spec.physical.locations.map((l) => {
            const sp = localSpot(g, c, l.id);
            const pen = isPresent(g, l.cityId) ? 0 : REMOTE_SPOT_PENALTY;
            const ask = sp * (1 + spec.physical.spotSpreadPct + pen);
            const cost = ask * sz * spec.valuePerUnit * (spec.currency === 'EUR' ? Math.exp(g.market.fxLog) : 1);
            return (
              <tr key={l.id}>
                <td><Term id={INCOTERM_TERM[l.incoterm] ?? 'basis'}>{l.label}</Term></td>
                <td>{CITY_BY_ID[l.cityId]!.name}{isPresent(g, l.cityId) ? ' 📍' : ''}</td>
                <td>{price(c, sp)}</td>
                <td>{price(c, basis(g.market, c, l.id))}</td>
                <td>{usd(cost)}</td>
                <td><button onClick={() => act({ type: 'SPOT_BUY', commodity: c, locationId: l.id, qty: sz })}>Acheter</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Fiche de qualité de brut : densité, soufre, différentiel courant de valeur d'usage. */
export function GradeTag({ grade, g, day }: { grade: string; g: GameState; day?: number }) {
  const gr = GRADE_BY_ID[grade];
  if (!gr) return null;
  const d = gradeDiff(g.market, grade, day ?? g.day);
  return (
    <span className="badge" title={`${gr.origin} · ${gr.api}° API · soufre ${gr.sulfur} % · rendements : essence ${Math.round(gr.yields[0] * 100)} %, kérosène ${Math.round(gr.yields[1] * 100)} %, gazole ${Math.round(gr.yields[2] * 100)} %, fioul ${Math.round(gr.yields[3] * 100)} %. Le différentiel suit la valeur des produits : un brut lourd et soufré baisse quand le fioul baisse.`}>
      🛢️ {gr.name} {gr.api}° · {gr.sulfur} % S · {d >= 0 ? '+' : ''}{d.toFixed(2)} $/bbl
    </span>
  );
}
