import { progressive } from '../engine/progression';
import { MusicButton } from './common';
import { t } from './i18n';
import { effectiveScale, useSettings, type UiScale } from './settings';
import { useStore } from './store';

const SCALES: UiScale[] = ['auto', 0.8, 0.9, 1, 1.1, 1.25];

/** Paramètres du joueur : langue, taille de l'interface, mode simplifié, musique, affichage des panneaux. */
export function SettingsModal() {
  const s = useSettings();
  const game = useStore((x) => x.game);
  const act = useStore((x) => x.act);
  if (!s.open) return null;
  return (
    <div className="modal-bg" onClick={() => s.setOpen(false)}>
      <div className="modal settings" onClick={(e) => e.stopPropagation()}>
        <h2>🛠️ {t('Paramètres')}</h2>
        <div className="settings-row">
          <span>{t('Langue')}</span>
          <div className="chips">
            <button className={s.lang === 'fr' ? 'on' : ''} onClick={() => s.set({ lang: 'fr' })}>🇫🇷 Français</button>
            <button className={s.lang === 'en' ? 'on' : ''} onClick={() => s.set({ lang: 'en' })}>🇬🇧 English</button>
          </div>
        </div>
        <div className="settings-row">
          <span>{t('Taille de l’interface')}</span>
          <div className="chips">
            {SCALES.map((x) => (
              <button key={String(x)} className={s.uiScale === x ? 'on' : ''} onClick={() => s.set({ uiScale: x })}>
                {x === 'auto' ? `${t('Auto')} (${Math.round(effectiveScale('auto') * 100)} %)` : `${Math.round(x * 100)} %`}
              </button>
            ))}
          </div>
        </div>
        <div className="settings-row">
          <span>{t('Mode simplifié')}</span>
          <label className="switch">
            <input type="checkbox" checked={s.simplified} onChange={(e) => s.set({ simplified: e.target.checked })} />
            <small className="muted">{t('Moins de chiffres et d’alertes à l’écran : marge, VaR et calques ne s’affichent que s’ils deviennent préoccupants ; les conseillers ne parlent que pour les vrais risques. Le jeu complet reste là, il suffit de décocher.')}</small>
          </label>
        </div>
        <div className="settings-row">
          <span>{t('Musique')}</span>
          <MusicButton className="" />
        </div>
        {game && progressive(game) && (
          <div className="settings-row">
            <span>{t('Complexité progressive')}</span>
            <div>
              <small className="muted">{t('Les panneaux apparaissent quand vous en avez besoin.')} {game.unlocked?.length ?? 0} {t('débloqués')}.</small>
              <button className="ghost" onClick={() => act({ type: 'UNLOCK_ALL' })}>{t('Tout afficher maintenant')}</button>
            </div>
          </div>
        )}
        <div className="modal-actions"><button className="primary" onClick={() => s.setOpen(false)}>{t('Fermer')}</button></div>
      </div>
    </div>
  );
}
