import { useState } from 'react';
import { CITIES, CITY_BY_ID } from '../data/cities';
import { COMPANY_BY_ID } from '../data/companies';
import { formatDayShort } from '../engine/calendar';
import { BRANCH, branchSeatsFree, continentOf, continentsCovered, FAMILY_LABEL, marketSalary, ROLE_EFFECT, ROLE_LABEL, staffMonthlyCost } from '../engine/staff';
import { nav } from '../engine/valuation';
import { Panel } from './common';
import { usd } from './format';
import { useStore } from './store';

export function StaffPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const t = g.staff;
  const [branchCity, setBranchCity] = useState('');
  const [size, setSize] = useState<'bureau' | 'grand'>('bureau');
  const cost = staffMonthlyCost(g);
  const sites = [g.company.hqCity, ...t.branches.map((b) => b.cityId)];
  const [site, setSite] = useState(g.company.hqCity);
  const managing = !g.career || g.career.status === 'founder' || g.career.status === 'ceo';

  if (!managing) {
    return (
      <Panel title="Équipes" icon="👥" onClose={() => setPanel('staff')}>
        <p className="muted">Le recrutement et l’ouverture de bureaux relèvent de la direction. Fondez votre maison ou devenez CEO.</p>
      </Panel>
    );
  }

  return (
    <Panel title="Équipes et bureaux" icon="👥" onClose={() => setPanel('staff')} wide>
      <div className="preview">
        <div><span>Collaborateurs</span><b>{t.employees.length}</b></div>
        <div><span>Masse salariale</span><b>{usd(cost.salaries)}/mois</b></div>
        <div><span>Bureaux</span><b>{t.branches.length}</b></div>
        <div><span>Loyers des bureaux</span><b>{usd(cost.rent)}/mois</b></div>
        <div><span>Continents</span><b>{continentsCovered(g)}/6</b></div>
      </div>

      <h4>Candidats</h4>
      <p className="muted small">Un siège prestigieux et une place bancaire attirent de meilleurs profils. Prime d’arrivée : deux mois de salaire.</p>
      <div className="row">
        Rattacher à : <select value={site} onChange={(e) => setSite(e.target.value)}>{sites.map((c) => <option key={c} value={c}>{CITY_BY_ID[c]!.name}{c === g.company.hqCity ? ' (siège)' : ` (${branchSeatsFree(g, c)} postes libres)`}</option>)}</select>
      </div>
      {t.candidates.length === 0 ? <div className="empty">Aucun candidat ce mois-ci.</div> : (
        <table className="tbl">
          <thead><tr><th>Nom</th><th>Métier</th><th>Compétence</th><th>Ambition</th><th>Salaire</th><th /></tr></thead>
          <tbody>
            {t.candidates.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td title={ROLE_EFFECT[c.role]}>{ROLE_LABEL[c.role]}{c.family ? ` · ${FAMILY_LABEL[c.family]}` : ''}{c.network ? ` · ${c.network} clients` : ''}</td>
                <td>{c.skill}</td>
                <td>{Math.round(c.ambition * 100)} %</td>
                <td>{usd(c.salary)}</td>
                <td><button onClick={() => act({ type: 'HIRE', candidateId: c.id, cityId: site })}>Recruter</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4>Équipe</h4>
      {t.employees.length === 0 ? <div className="empty">Vous travaillez seul avec l’équipe de base de trois personnes.</div> : (
        <table className="tbl">
          <thead><tr><th>Nom</th><th>Métier</th><th>Ville</th><th>Compétence</th><th>Loyauté</th><th>Salaire / marché</th><th /></tr></thead>
          <tbody>
            {t.employees.map((e) => {
              const mkt = marketSalary(e.role, e.skill, e.cityId);
              const offer = t.poach.find((p) => p.employeeId === e.id);
              return (
                <tr key={e.id} className={offer ? 'warn-row' : ''}>
                  <td>{e.name}</td>
                  <td title={ROLE_EFFECT[e.role]}>{ROLE_LABEL[e.role]}{e.family ? ` · ${FAMILY_LABEL[e.family]}` : ''}</td>
                  <td>{CITY_BY_ID[e.cityId]?.name}</td>
                  <td>{Math.round(e.skill)}</td>
                  <td><div className="gauge"><i style={{ width: `${e.loyalty}%` }} /></div></td>
                  <td className={e.salary < mkt ? 'neg' : ''}>{usd(e.salary)} / {usd(mkt)}</td>
                  <td>
                    {offer ? (
                      <button className="primary" onClick={() => act({ type: 'COUNTER_OFFER', id: e.id })} title={`Offre de ${COMPANY_BY_ID[offer.companyId]?.name} jusqu’au ${formatDayShort(offer.expiresDay)}`}>Contre-offre {usd(offer.salary)}</button>
                    ) : (
                      <button onClick={() => act({ type: 'RAISE', id: e.id, pct: 0.1 })}>+10 %</button>
                    )}
                    <button className="ghost" onClick={() => act({ type: 'FIRE_EMPLOYEE', id: e.id })}>Licencier</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h4>Bureaux dans d’autres villes</h4>
      <p className="muted small">Un bureau vaut présence permanente : conditions locales sur les offres de la ville, plus d’offres sur place, et des postes pour l’équipe. Licence locale et agencement à l’ouverture, loyer chaque mois.</p>
      <div className="row">
        <select value={branchCity} onChange={(e) => setBranchCity(e.target.value)}>
          <option value="">Choisir une ville…</option>
          {CITIES.filter((c) => c.id !== g.company.hqCity && !t.branches.some((b) => b.cityId === c.id)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => <option key={c.id} value={c.id}>{c.name} · {continentOf(c.id)} · loyer {usd(c.officeRentMonthly)}</option>)}
        </select>
        <select value={size} onChange={(e) => setSize(e.target.value as 'bureau' | 'grand')}>
          <option value="bureau">{BRANCH.bureau.label} ({BRANCH.bureau.seats} postes, VL 15 M$)</option>
          <option value="grand">{BRANCH.grand.label} ({BRANCH.grand.seats} postes, VL 60 M$)</option>
        </select>
        <button disabled={!branchCity} onClick={() => act({ type: 'OPEN_BRANCH', cityId: branchCity, size })}>Ouvrir</button>
      </div>
      {t.branches.length > 0 && (
        <table className="tbl">
          <tbody>
            {t.branches.map((b) => (
              <tr key={b.cityId}>
                <td>{CITY_BY_ID[b.cityId]!.name}</td>
                <td>{BRANCH[b.size].label}</td>
                <td>{BRANCH[b.size].seats - branchSeatsFree(g, b.cityId)}/{BRANCH[b.size].seats} postes</td>
                <td>{usd(CITY_BY_ID[b.cityId]!.officeRentMonthly * BRANCH[b.size].rentMult)}/mois</td>
                <td>depuis le {formatDayShort(b.openedDay)}</td>
                <td><button className="ghost" onClick={() => act({ type: 'CLOSE_BRANCH', cityId: b.cityId })}>Fermer</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">Fonds propres : {usd(nav(g))}.</p>
    </Panel>
  );
}
