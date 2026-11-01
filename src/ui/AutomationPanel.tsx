import { Panel, Term } from './common';
import { useStore } from './store';

export function AutomationPanel() {
  const g = useStore((s) => s.game)!;
  useStore((s) => s.rev);
  const setPanel = useStore((s) => s.setPanel);
  const act = useStore((s) => s.act);
  const au = g.automation;
  const set = (patch: Parameters<typeof act>[0] extends infer A ? (A extends { type: 'SET_AUTOMATION'; patch: infer P } ? P : never) : never) => act({ type: 'SET_AUTOMATION', patch }, true);
  const Row = ({ on, onChange, title, desc }: { on: boolean; onChange: (v: boolean) => void; title: string; desc: React.ReactNode }) => (
    <label className="auto-row">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} />
      <div><b>{title}</b><div className="muted small">{desc}</div></div>
    </label>
  );
  return (
    <Panel title="Automatisation" icon="⚙️" onClose={() => setPanel('automation')}>
      <p className="muted small">Confiez les tâches répétitives à des règles simples. Elles sont utiles… et imparfaites : à vous de garder la main sur ce qui compte.</p>
      <Row on={g.company.autoTreasury} onChange={(v) => act({ type: 'SET_AUTO_TREASURY', on: v }, true)} title="Trésorerie" desc="Tire la RCF pour couvrir les marges, rembourse l’excédent." />
      <Row on={au.autoRoll} onChange={(v) => set({ autoRoll: v })} title="Roll des futures" desc={<>Roule chaque position 2 jours avant son dernier jour de cotation. Évite les <Term id="exdelivery">livraisons bourse</Term> involontaires (cuivre, gaz, blé).</>} />
      <Row on={au.autoHedge.on} onChange={(v) => set({ autoHedge: { ...au.autoHedge, on: v } })} title="Couverture de base" desc="Maintient la couverture du physique (stocks, cargaisons, forwards) par des futures du 2ᵉ mois. Risque de base et de calendrier non couverts." />
      {au.autoHedge.on && (
        <div className="limits">
          <label>Ratio de couverture <b>{Math.round(au.autoHedge.ratio * 100)} %</b><input type="range" min={0} max={120} step={10} value={au.autoHedge.ratio * 100} onChange={(e) => set({ autoHedge: { ...au.autoHedge, ratio: Number(e.target.value) / 100 } })} /></label>
          <label>Seuil de réajustement <b>{Math.round(au.autoHedge.threshold * 100)} %</b><input type="range" min={5} max={50} step={5} value={au.autoHedge.threshold * 100} onChange={(e) => set({ autoHedge: { ...au.autoHedge, threshold: Number(e.target.value) / 100 } })} /></label>
        </div>
      )}
      <Row on={au.autoLogistics} onChange={(v) => set({ autoLogistics: v })} title="Logistique" desc="Affrète au dernier moment raisonnable les navires nécessaires pour honorer les ventes livrables à destination, depuis le stock le moins cher à acheminer." />
      <Row on={au.autoSellProduction} onChange={(v) => set({ autoSellProduction: v })} title="Vente de la production" desc="La production des mines et gisements est vendue chaque jour au spot local. Désactivé : elle s’accumule en stock (à vendre, expédier ou stocker vous-même)." />
      <Row on={au.marineInsurance} onChange={(v) => set({ marineInsurance: v })} title="Assurance marine" desc="0,12 % de la valeur par voyage ; rembourse la cargaison en cas d’accident en mer (franchise 1 %)." />
      <p className="muted small">Gestion d’actifs : déléguez chaque actif à un manager depuis le panneau Actifs.</p>
    </Panel>
  );
}
