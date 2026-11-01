import { CITY_BY_ID } from '../data/cities';
import { COMMODITIES } from '../data/commodities';
import { COMPANY_BY_ID } from '../data/companies';
import { formatDayShort } from '../engine/calendar';
import { leaderboard, rivalOf } from '../engine/companies';
import { cpRating, exposureTo, insuranceCostAnnual, INSURANCE_COVER, RECOVERY } from '../engine/credit';
import type { CommodityId } from '../engine/types';
import { Panel, Sparkline, Term } from './common';
import { pct, signedUsd, tone, usd } from './format';
import { useStore } from './store';

export function RivalsPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const focus = useStore((s) => s.companyFocus);
  const focusCompany = useStore((s) => s.focusCompany);
  const act = useStore((s) => s.act);
  const board = leaderboard(g);
  const rival = rivalOf(g);
  const myRank = board.findIndex((r) => r.id === 'player') + 1;
  const banks = g.companies.filter((c) => COMPANY_BY_ID[c.id]!.kind === 'bank');
  const fallen = g.companies.filter((c) => !c.alive);

  return (
    <Panel title="Concurrents & contreparties" icon="🏢" onClose={() => setPanel('rivals')} wide>
      {focus && <CompanyCard id={focus} onClose={() => focusCompany(null)} rival={focus === rival} />}
      <h4>Classement des maisons{myRank > 0 ? <> · vous êtes <b>#{myRank}</b> sur {board.length}</> : ''}</h4>
      <table className="tbl board">
        <thead><tr><th>#</th><th>Maison</th><th>Siège</th><th>Fonds propres</th><th>Année</th><th><Term id="rating">Note</Term></th></tr></thead>
        <tbody>
          {board.map((r, i) => (
            <tr key={r.id} className={`${r.id === 'player' ? 'me' : ''} ${r.id === rival ? 'rival' : ''}`} onClick={() => r.id !== 'player' && focusCompany(r.id)}>
              <td>{i + 1}</td>
              <td>{r.id !== 'player' && <i className="swatch" style={{ background: COMPANY_BY_ID[r.id]!.color }} />}{r.name}{r.id === rival && <span className="badge bad">rival</span>}</td>
              <td className="small">{CITY_BY_ID[r.cityId]!.name}</td>
              <td>{usd(r.nav, 2)}</td>
              <td className={tone(r.ytd)}>{pct(r.ytd)}</td>
              <td>{r.rating}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {fallen.length > 0 && <p className="muted small">Disparues : {fallen.map((c) => `${COMPANY_BY_ID[c.id]!.name} (${c.mergedInto ? `rachetée par ${COMPANY_BY_ID[c.mergedInto]!.name}` : `faillite le ${formatDayShort(c.defaultDay!)}`})`).join(' · ')}</p>}

      <h4><Term id="cptyrisk">Risque de contrepartie</Term></h4>
      <label className="toggle">
        <input type="checkbox" checked={g.credit.insurance} onChange={(e) => act({ type: 'SET_CREDIT_INSURANCE', on: e.target.checked })} />
        <Term id="creditins">Assurance-crédit</Term> sur le physique <span className="muted small">(couvre {INSURANCE_COVER * 100} % des pertes de défaut · coût actuel ≈ {usd(insuranceCostAnnual(g))}/an)</span>
      </label>
      <p className="muted small">En cas de défaut, les contrats sont résiliés et <Term id="netting">compensés</Term> : on récupère environ {RECOVERY * 100} % de ce qui nous est dû, mais on paie intégralement ce qu’on doit.</p>
      <ExposureTable />
      <h4>Banques OTC et <Term id="csa">CSA</Term></h4>
      <table className="tbl">
        <thead><tr><th>Banque</th><th>Note</th><th>MTM OTC</th><th>Collatéral</th><th>CSA</th></tr></thead>
        <tbody>
          {banks.map((b) => {
            const e = exposureTo(g, b.id);
            return (
              <tr key={b.id}>
                <td>{COMPANY_BY_ID[b.id]!.name}{!b.alive && <span className="badge bad">défaut</span>}</td>
                <td>{cpRating(g, b.id)}</td>
                <td className={tone(e.otc)}>{signedUsd(e.otc)}</td>
                <td>{e.collateral > 0 ? `posté ${usd(e.collateral)}` : e.collateral < 0 ? `reçu ${usd(-e.collateral)}` : '—'}</td>
                <td><input type="checkbox" checked={!!g.credit.csa[b.id]} disabled={!b.alive} onChange={(ev) => act({ type: 'SET_CSA', bankId: b.id, on: ev.target.checked })} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">Avec CSA : collatéral échangé chaque soir sur le MTM net (risque de défaut quasi nul, mais appels de cash quand le marché va contre vous) et fourchettes normales. Sans CSA : la banque facture une <Term id="cva">CVA</Term> (fourchette ×1,3) et vous portez son risque.</p>
      {g.credit.losses.length > 0 && (
        <>
          <h4>Défauts subis</h4>
          <table className="tbl"><tbody>{g.credit.losses.map((l, i) => <tr key={i}><td>{formatDayShort(l.day)}</td><td>{COMPANY_BY_ID[l.cp]?.name ?? l.cp}</td><td className="neg">perte {usd(l.loss)}</td><td className="small">récupéré {usd(l.recovered)} · assuré {usd(l.insured)}</td></tr>)}</tbody></table>
        </>
      )}
    </Panel>
  );
}

function ExposureTable() {
  const g = useStore((s) => s.game)!;
  const ids = [...new Set([...g.forwards.map((d) => d.counterpartyId), ...g.otc.map((x) => x.bankId)])];
  if (!ids.length) return <div className="empty">Aucune exposition de contrepartie.</div>;
  return (
    <table className="tbl">
      <thead><tr><th>Contrepartie</th><th>Note</th><th>Physique (MTM)</th><th>OTC (MTM)</th><th>Exposition nette</th></tr></thead>
      <tbody>
        {ids.map((id) => {
          const e = exposureTo(g, id);
          const r = cpRating(g, id);
          return (
            <tr key={id}>
              <td>{COMPANY_BY_ID[id]?.name ?? id}</td>
              <td className={['BB', 'B', 'CCC', 'D'].includes(r) ? 'warn' : ''}>{r}</td>
              <td className={tone(e.physical)}>{signedUsd(e.physical)}</td>
              <td className={tone(e.otc)}>{signedUsd(e.otc)}</td>
              <td className={e.net > 0 ? 'warn' : ''}>{usd(Math.max(0, e.net))}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CompanyCard({ id, onClose, rival }: { id: string; onClose: () => void; rival: boolean }) {
  const g = useStore((s) => s.game)!;
  const d = COMPANY_BY_ID[id]!;
  const st = g.companies.find((c) => c.id === id);
  const news = g.news.filter((n) => n.companyId === id).slice(0, 5);
  return (
    <div className="company-card" style={{ borderColor: d.color }}>
      <header>
        <div className="logo-badge" style={{ background: d.color }}>{d.name.split(' ').map((x) => x[0]).slice(0, 2).join('')}</div>
        <div>
          <h3>{d.name} {rival && <span className="badge bad">votre rival</span>}</h3>
          <div className="muted small">{CITY_BY_ID[d.cityId]!.name} · {d.kind} · tempérament {d.temperament}{d.star ? ` · trader vedette : ${d.star}` : ''}</div>
        </div>
        <button className="ghost close" onClick={onClose}>✕</button>
      </header>
      <p className="small">{d.culture}</p>
      {st && (
        <div className="city-grid">
          <div><span>Fonds propres</span><b>{st.alive ? usd(st.nav, 2) : 'disparue'}</b></div>
          <div><span>Note</span><b>{st.rating}</b></div>
          <div><span>Réputation</span><b>{Math.round(st.reputation)}/100</b></div>
          <div><span>Scandales</span><b>{st.scandals}</b></div>
        </div>
      )}
      <div className="desks">{Object.entries(d.desks).map(([c, v]) => <span key={c} className="chip" style={{ borderColor: COMMODITIES[c as CommodityId].color }}>{COMMODITIES[c as CommodityId].icon} {COMMODITIES[c as CommodityId].short} {'●'.repeat(Math.round((v ?? 0) * 3))}</span>)}</div>
      {st && st.history.length > 2 && <Sparkline data={st.history} width={300} height={40} color={d.color} />}
      {news.length > 0 && <ul className="small">{news.map((n) => <li key={n.id}>{formatDayShort(n.day)} — {n.headline}</li>)}</ul>}
    </div>
  );
}
