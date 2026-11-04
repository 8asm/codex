import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MpBar } from './OnlineLobby';
import { GovernmentPanel } from './GovernmentPanel';
import { SettingsModal } from './SettingsModal';
import { applyLanguage } from './i18n';
import { isUnlocked } from '../engine/progression';
import { effectiveScale, useSettings } from './settings';
import { exportJson, saveGame } from '../save/saveStore';
import { BookPanel } from './BookPanel';
import { CodexPanel } from './CodexPanel';
import { GlobeCanvas } from './GlobeCanvas';
import { Hud } from './Hud';
import { MarketPanel } from './MarketPanel';
import { Modals } from './Modals';
import { NewsTicker } from './NewsTicker';
import { PhysicalPanel } from './PhysicalPanel';
import { StartScreen } from './StartScreen';
import { TravelPanel } from './TravelPanel';
import { TreasuryPanel } from './TreasuryPanel';
import { OptionsPanel } from './OptionsPanel';
import { RiskPanel } from './RiskPanel';
import { AdvisorBar } from './Advisors';
import { NewsPanel } from './NewsPanel';
import { WorldPanel } from './WorldPanel';
import { RivalsPanel } from './RivalsPanel';
import { LogisticsPanel } from './LogisticsPanel';
import { AssetsPanel } from './AssetsPanel';
import { AutomationPanel } from './AutomationPanel';
import type { LayerId } from './store';
import { CareerPanel } from './CareerPanel';
import { NegotiationModal, SituationOverlay } from './NegotiationModal';
import { rights } from '../engine/career';
import { clock, DAY_SECONDS, useStore, type PanelId } from './store';
import { OfficesPanel } from './OfficesPanel';
import { ExoticsPanel } from './ExoticsPanel';
import { FinancePanel } from './FinancePanel';
import { CompliancePanel } from './CompliancePanel';
import { GamePanel } from './GamePanel';
import { StaffPanel } from './StaffPanel';
import { LessonCard, LessonsPanel } from './LessonsPanel';
const CityCanvas = lazy(() => import('./CityCanvas').then((m) => ({ default: m.CityCanvas })));
import { COMPANY_BY_ID } from '../data/companies';
import { CITY_BY_ID } from '../data/cities';
import type { GameState } from '../engine/types';

const DOCK: { id: PanelId; icon: string; label: string; key: string }[] = [
  { id: 'career', icon: '👔', label: 'Carrière', key: 'J' },
  { id: 'market', icon: '📈', label: 'Marchés', key: 'M' },
  { id: 'physical', icon: '📦', label: 'Physique', key: 'P' },
  { id: 'logistics', icon: '🚢', label: 'Fret', key: 'F' },
  { id: 'assets', icon: '🏭', label: 'Actifs', key: 'I' },
  { id: 'options', icon: '🎯', label: 'Options', key: 'O' },
  { id: 'book', icon: '📒', label: 'Livre', key: 'L' },
  { id: 'risk', icon: '🛡️', label: 'Risque', key: 'R' },
  { id: 'treasury', icon: '🏦', label: 'Trésorerie', key: 'T' },
  { id: 'travel', icon: '✈️', label: 'Voyages', key: 'V' },
  { id: 'news', icon: '📰', label: 'Actu', key: 'A' },
  { id: 'world', icon: '🌍', label: 'Monde', key: 'G' },
  { id: 'rivals', icon: '🏢', label: 'Rivaux', key: 'K' },
  { id: 'offices', icon: '🏛️', label: 'Bureaux', key: 'B' },
  { id: 'staff', icon: '👥', label: 'Équipes', key: 'E' },
  { id: 'exotics', icon: '🧪', label: 'Structurés', key: 'X' },
  { id: 'finance', icon: '🏧', label: 'Financement', key: 'Y' },
  { id: 'compliance', icon: '⚖️', label: 'Conformité', key: 'Z' },
  { id: 'government', icon: '🏛️', label: 'Gouvernements', key: 'D' },
  { id: 'game', icon: '🏆', label: 'Partie', key: 'Q' },
  { id: 'lessons', icon: '🎓', label: 'Leçons', key: 'W' },
  { id: 'codex', icon: '📚', label: 'Codex', key: 'C' },
];

function useGameLoop() {
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (t - last) / 1000);
      last = t;
      const st = useStore.getState();
      if (!st.game || st.speed === 0 || st.modal || st.game.status !== 'running') {
        clock.dayFrac = st.speed === 0 ? clock.dayFrac : 0;
        return;
      }
      const len = DAY_SECONDS[st.speed];
      acc += dt;
      if (acc >= len) {
        acc = 0;
        st.step();
      }
      clock.dayFrac = acc / len;
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);
}

/** Ville à visiter : la ville sélectionnée, sinon le siège (ou celui de l'employeur). */
function cityTarget(g: GameState, selected: string | null): string {
  if (selected) return selected;
  const c = g.career;
  if (c?.employerId && c.status === 'employed') return COMPANY_BY_ID[c.employerId]!.cityId;
  return g.company.hqCity;
}

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tgt = e.target as HTMLElement;
      if (tgt.tagName === 'INPUT' || tgt.tagName === 'SELECT' || tgt.tagName === 'TEXTAREA') return;
      const st = useStore.getState();
      if (!st.game) return;
      if (e.key === 'Escape') {
        if (st.modal) st.closeModal();
        else if (st.cityPhase === 'city' && !st.panel) {
          if (st.interior) st.setInterior(false);
          else st.exitCity();
        }
        else st.setPanel(st.panel ?? 'market');
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        st.setSpeed(st.speed === 0 ? 1 : 0);
      } else if (e.key === '1') st.setSpeed(1);
      else if (e.key === '2') st.setSpeed(2);
      else if (e.key === '3') st.setSpeed(5);
      else if (e.key.toLowerCase() === 'n' && st.speed === 0) st.step();
      else if (e.key.toLowerCase() === 'u') st.setPanel('automation');
      else if (e.key.toLowerCase() === 'h') {
        if (st.cityPhase === 'city') st.exitCity();
        else st.requestCity(cityTarget(st.game, st.selectedCity));
      }
      else {
        const d = DOCK.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
        if (d && (!st.game || isUnlocked(st.game, d.id))) st.setPanel(d.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

/** Échelle de l'interface (variable CSS --ui), recalculée au redimensionnement de la fenêtre. */
function useUiScale() {
  const pref = useSettings((s) => s.uiScale);
  const simple = useSettings((s) => s.simplified);
  useEffect(() => { document.documentElement.classList.toggle('simple', simple); }, [simple]);
  const lang = useSettings((s) => s.lang);
  useEffect(() => { applyLanguage(lang); }, [lang]);
  useEffect(() => {
    const apply = () => document.documentElement.style.setProperty('--ui', String(effectiveScale(pref)));
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, [pref]);
}

export function App() {
  const game = useStore((s) => s.game);
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  const toasts = useStore((s) => s.toasts);
  const [menu, setMenu] = useState(false);
  const toast = useStore((s) => s.toast);
  const quit = useStore((s) => s.quit);
  useGameLoop();
  useKeyboard();
  useUiScale();
  const menuRef = useRef<HTMLDivElement>(null);
  const cityPhase = useStore((s) => s.cityPhase);
  const selectedCity = useStore((s) => s.selectedCity);
  const requestCity = useStore((s) => s.requestCity);
  const inCity = cityPhase === 'city' || cityPhase === 'leaving';

  // Divulgation progressive : la trésorerie n'apparaît qu'une fois des marges ou de la dette en jeu.
  const showTreasury = !!game && (game.company.im > 0 || game.company.rcfDrawn > 0 || game.history.length > 15);
  const hasPositions = !!game && (game.futures.length + game.forwards.length + game.inventory.length + game.options.length + game.otc.length > 0);
  const showOptions = !!game && (hasPositions || game.history.length > 5);
  const showRisk = !!game && (hasPositions || game.history.length > 10);
  const showWorld = !!game && (game.history.length > 8 || game.world.sanctions.length > 0 || game.world.effects.length > 0);
  const showRivals = !!game && (game.history.length > 4 || game.forwards.length > 0);
  const showLogi = !!game && (game.history.length > 6 || game.inventory.length > 0 || game.forwards.length > 0);
  const showAssets = !!game && (game.history.length > 12 || game.assets.length > 0);
  const rg = game ? rights(game) : null;
  const byRights = (id: PanelId) => {
    if (!rg) return true;
    if (id === 'career') return !!game?.career;
    if (id === 'options') return rg.options;
    if (id === 'physical') return rg.physical;
    if (id === 'logistics') return rg.otc;
    if (id === 'assets') return rg.assets;
    if (id === 'treasury') return rg.treasury || rg.trade;
    if (id === 'risk' || id === 'book') return rg.trade;
    if (id === 'exotics') return rg.otc;
    if (id === 'staff') return !game?.career || game.career.status === 'founder' || game.career.status === 'ceo';
    if (id === 'finance') return rg.treasury;
    if (id === 'government') return !game?.career || game.career.status === 'founder' || game.career.status === 'ceo';
    if (id === 'compliance') return !game?.career || game.career.status === 'founder' || game.career.status === 'ceo';
    return true;
  };
  const visible0 = (id: PanelId) => byRights(id) && (id === 'logistics' ? showLogi || !!game?.career : id === 'assets' ? showAssets || !!game?.career : id === 'automation' ? false : true);
  // complexité progressive : un panneau n'apparaît qu'une fois débloqué par l'activité du joueur
  const visible = (id: PanelId) => visible0(id) && visible1(id) && (!game || isUnlocked(game, id));
  const visible1 = (id: PanelId) => (id === 'exotics' ? showOptions && (game!.history.length > 20 || game!.exotics.length > 0) : id === 'finance' ? showTreasury : id === 'compliance' ? game!.history.length > 10 || game!.compliance.cases.length > 0 : id === 'treasury' ? showTreasury : id === 'options' ? showOptions : id === 'risk' ? showRisk : id === 'world' ? showWorld : id === 'rivals' ? showRivals : true);

  return (
    <div className="app">
      <GlobeCanvas />
      {game && inCity && <Suspense fallback={null}><CityCanvas /></Suspense>}
      {!game && <StartScreen />}
      <SettingsModal />
      {game && (
        <>
          <Hud onMenu={() => setMenu(!menu)} />
          {menu && (
            <div className="menu" ref={menuRef}>
              <button onClick={async () => { await saveGame('manuel', game); toast('Partie sauvegardée.', 'good'); setMenu(false); }}>💾 Sauvegarder</button>
              <button onClick={() => { exportJson(game); setMenu(false); }}>⬇ Exporter (JSON)</button>
              <button onClick={() => { setMenu(false); quit(); }}>⏏ Quitter vers l’accueil</button>
              <div className="muted small keys">Espace : pause · 1/2/3 : vitesse · N : jour suivant · J M P F I O L R T V A G K B E X Y Z Q C U : panneaux · H : vue ville · Échap : fermer</div>
            </div>
          )}
          <nav className="dock">
            {DOCK.filter((d) => visible(d.id)).map((d) => (
              <button key={d.id} className={panel === d.id ? 'on' : ''} onClick={() => setPanel(d.id)} title={`${d.label} (${d.key})`}>
                <span>{d.icon}</span>
                <small>{d.label}</small>
              </button>
            ))}
          </nav>
          <div className="panel-slot">
            {panel === 'market' && <MarketPanel />}
            {panel === 'physical' && <PhysicalPanel />}
            {panel === 'book' && <BookPanel />}
            {panel === 'treasury' && <TreasuryPanel />}
            {panel === 'travel' && <TravelPanel />}
            {panel === 'codex' && <CodexPanel />}
            {panel === 'options' && <OptionsPanel />}
            {panel === 'risk' && <RiskPanel />}
            {panel === 'news' && <NewsPanel />}
            {panel === 'world' && <WorldPanel />}
            {panel === 'rivals' && <RivalsPanel />}
            {panel === 'logistics' && <LogisticsPanel />}
            {panel === 'assets' && <AssetsPanel />}
            {panel === 'automation' && <AutomationPanel />}
            {panel === 'career' && <CareerPanel />}
            {panel === 'offices' && <OfficesPanel />}
            {panel === 'exotics' && <ExoticsPanel />}
            {panel === 'finance' && <FinancePanel />}
            {panel === 'compliance' && <CompliancePanel />}
            {panel === 'game' && <GamePanel />}
            {panel === 'staff' && <StaffPanel />}
            {panel === 'lessons' && <LessonsPanel />}
            {panel === 'government' && <GovernmentPanel />}
          </div>
          {!cityPhase && <LayerBar />}
          {!cityPhase && (
            <button className="city-btn" onClick={() => requestCity(cityTarget(game, selectedCity))} title="Plonger dans la ville (H) — ou zoomez au maximum sur une ville">
              🏙️ {CITY_BY_ID[cityTarget(game, selectedCity)]!.name}
            </button>
          )}
          <LessonCard />
          <MpBar />
          <AdvisorBar />
          <NewsTicker />
          <Modals />
          <SituationOverlay />
          <NegotiationModal />
        </>
      )}
      <div className="toasts">
        {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
      </div>
    </div>
  );
}

const LAYERS: { id: LayerId; icon: string; label: string }[] = [
  { id: 'tension', icon: '🌡️', label: 'Tensions' },
  { id: 'sanctions', icon: '🚫', label: 'Sanctions' },
  { id: 'meteo', icon: '🌀', label: 'Météo' },
  { id: 'prix', icon: '📊', label: 'Prix' },
  { id: 'rivals', icon: '🏢', label: 'Concurrents' },
  { id: 'routes', icon: '🧭', label: 'Routes' },
  { id: 'stocks', icon: '🛢️', label: 'Stocks' },
];

function LayerBar() {
  const layers = useStore((s) => s.layers);
  const toggle = useStore((s) => s.toggleLayer);
  return (
    <div className="layerbar adv">
      <span className="muted small">Calques</span>
      {LAYERS.map((l) => (
        <button key={l.id} className={layers[l.id] ? 'on' : ''} onClick={() => toggle(l.id)} title={l.label}>{l.icon}<small>{l.label}</small></button>
      ))}
    </div>
  );
}
