import { CITY_BY_ID } from '../data/cities';
import { useSettings } from './settings';
import { formatDay } from '../engine/calendar';
import { freeCash, rcfHeadroom } from '../engine/treasury';
import { nav } from '../engine/valuation';
import { AnimatedNumber, Term } from './common';
import { signedUsd, tone, usd } from './format';
import { isMuted, setMuted } from './sound';
import { MusicButton } from './common';
import { useStore, type Speed } from './store';
import { useState } from 'react';
import { useLiveVar } from './derived';
import { COVENANT_VAR_PCT } from '../engine/limits';
import { leaderboard } from '../engine/companies';
import { evaluate, title } from '../engine/career';
import { activeSituations } from '../engine/situations';
import { COMPANY_BY_ID } from '../data/companies';

const SPEEDS: { s: Speed; label: string; key: string }[] = [
  { s: 0, label: '❚❚', key: 'Espace' },
  { s: 1, label: '▶', key: '1' },
  { s: 2, label: '▶▶', key: '2' },
  { s: 5, label: '▶▶▶', key: '3' },
];

export function Hud({ onMenu }: { onMenu: () => void }) {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const speed = useStore((s) => s.speed);
  const setSpeed = useStore((s) => s.setSpeed);
  const step = useStore((s) => s.step);
  const setPanel = useStore((s) => s.setPanel);
  const [muted, setM] = useState(isMuted());

  const navV = nav(g);
  const last = g.history[g.history.length - 1];
  const dayPnl = last?.pnl ?? 0;
  const free = freeCash(g);
  const head = rcfHeadroom(g, navV);
  const capacity = Math.max(1, g.company.cash + head);
  const marginUse = g.company.im / capacity;
  const ret = navV / g.company.initialCapital - 1;
  const board = leaderboard(g);
  const employee = g.career?.status === 'employed';
  const noBook = !!g.career && (g.career.status === 'unemployed' || (employee && g.career.allocation <= 0));
  const pending = g.career ? activeSituations(g).length : 0;
  const rank = board.findIndex((r) => r.id === 'player') + 1;
  const where = g.player.travel ? `✈ vers ${CITY_BY_ID[g.player.travel.to]!.name}` : `📍 ${CITY_BY_ID[g.player.cityId!]!.name}`;
  const live = useLiveVar();
  const v = live?.var99 ?? 0;
  const varUse = v / Math.max(1, Math.min(g.risk.limits.varPctNav, COVENANT_VAR_PCT) * navV);
  const alerts = (g.world.sanctions.length ? 1 : 0) + (g.company.marginCall ? 1 : 0) + (g.market.volRegime === 'stressed' ? 1 : 0) + g.risk.breaches.length + (g.risk.rcfFrozen ? 1 : 0);

  return (
    <header className="hud">
      <div className="hud-brand" onClick={onMenu} title="Menu">
        <span className="logo">⛵</span>
        <div>
          <div className="brand-name">TRADEWINDS</div>
          <div className="brand-co">{g.career ? `${title(g.career)}${g.career.status === 'employed' ? ` · ${COMPANY_BY_ID[g.career.employerId!]?.name}` : g.career.status === 'unemployed' ? '' : ` · ${g.company.name}`}` : g.company.name}</div>
        </div>
      </div>

      <div className="hud-time">
        <div className="hud-date">{formatDay(g.day)}</div>
        <div className="hud-where">{where}</div>
        <div className="speed">
          {SPEEDS.map((x) => (
            <button key={x.s} className={speed === x.s ? 'on' : ''} onClick={() => setSpeed(x.s)} title={`Raccourci : ${x.key}`}>
              {x.label}
            </button>
          ))}
          <button onClick={step} title="Jour suivant (N)" disabled={speed !== 0}>⏭</button>
        </div>
      </div>

      <div className="hud-kpis">
        {g.career && (
          <div className="kpi" onClick={() => setPanel('career')}>
            <div className="kpi-label">Patrimoine perso</div>
            <AnimatedNumber value={g.career.wealth} format={(x) => usd(x, 2)} />
            <div className="kpi-sub">réputation {Math.round(g.career.reputation)}{pending > 0 ? ` · 📩 ${pending}` : ''}</div>
          </div>
        )}
        {noBook && g.career && (
          <div className="kpi" onClick={() => setPanel('career')}>
            <div className="kpi-label">Poste</div>
            <div className="anim-num">{title(g.career)}</div>
            <div className="kpi-sub">{employee ? `évaluation ≈ ${Math.round(evaluate(g).score)}/100` : 'en recherche d’emploi'}</div>
          </div>
        )}
        {!noBook && <>
        <div className="kpi" onClick={() => setPanel('treasury')}>
          <div className="kpi-label">{employee ? 'Cash du livre' : 'Cash libre'}</div>
          <AnimatedNumber value={free} format={(x) => usd(x)} className={free < 0 ? 'neg' : ''} />
        </div>
        <div className="kpi" onClick={() => setPanel('book')}>
          <div className="kpi-label">{employee ? 'Livre alloué' : <Term id="nav">Fonds propres</Term>}</div>
          <AnimatedNumber value={navV} format={(x) => usd(x, 2)} />
          <div className={`kpi-sub ${tone(ret)}`}>{(ret * 100).toFixed(1)} %{rank > 0 && <> · <span className="rank" onClick={(e) => { e.stopPropagation(); setPanel('rivals'); }}>#{rank}/{board.length}</span></>}</div>
        </div>
        <div className={`kpi big ${tone(dayPnl)}`} onClick={() => setPanel('book')}>
          <div className="kpi-label">P&L du jour</div>
          <AnimatedNumber value={dayPnl} format={(x) => signedUsd(x, 2)} />
        </div>
        <div className={`kpi ${marginUse > 0.8 ? 'danger' : marginUse > 0.5 ? 'warn' : 'adv'}`} onClick={() => setPanel('treasury')}>
          <div className="kpi-label"><Term id="im">Marge</Term> utilisée</div>
          <div className="bar"><div style={{ width: `${Math.min(100, marginUse * 100)}%` }} /></div>
          <div className="kpi-sub">{usd(g.company.im)} / {usd(capacity)}</div>
        </div>
        <div className={`kpi ${varUse > 1 ? 'danger' : varUse > 0.8 ? 'warn' : 'adv'}`} onClick={() => setPanel('risk')}>
          <div className="kpi-label"><Term id="var">Risque (VaR 1 j)</Term></div>
          <div className="bar"><div style={{ width: `${Math.min(100, varUse * 100)}%` }} /></div>
          <div className="kpi-sub">{usd(v)} · {(v / Math.max(1, navV) * 100).toFixed(1)} % FP</div>
        </div>
        </>}
        <div className={`kpi alerts ${alerts ? 'on' : ''}`} title="Alertes">
          <div className="kpi-label">Alertes</div>
          <div className="alert-icons">
            {g.company.marginCall && <span title="Appel de marge en cours">🚨</span>}
            {g.market.volRegime === 'stressed' && <span title="Marchés en turbulence : vol et marges relevées">🌪️</span>}
            {g.risk.breaches.length > 0 && <span title={`Limites dépassées : ${g.risk.breaches.join(', ')}`}>⚠️</span>}
            {g.risk.rcfFrozen && <span title="Ligne de crédit gelée par la banque">🧊</span>}
            {g.world.sanctions.length > 0 && <span title="Sanctions internationales en vigueur">🚫</span>}
            {Object.values(g.market.halted).some((d) => (d ?? -1) >= g.day) && <span title="Cotation suspendue">⏸️</span>}
            {g.company.frozenCash && g.company.frozenCash.untilDay >= g.day && <span title="Trésorerie partiellement gelée">🔒</span>}
            {!alerts && <span className="calm">✓</span>}
          </div>
        </div>
      </div>
      <div className="hud-tools">
        <button className="ghost mute" onClick={() => useSettings.getState().setOpen(true)} title="Paramètres">🛠️</button>
        <button className="ghost mute adv" onClick={() => setPanel('automation')} title="Automatisation (U)">⚙️</button>
        <button className="ghost mute" onClick={() => { setMuted(!muted); setM(!muted); }} title="Effets sonores">{muted ? '🔇' : '🔊'}</button>
        <MusicButton />
      </div>
    </header>
  );
}
