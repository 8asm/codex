import { describe, expect, it } from 'vitest';
import { listedMonths } from '../contracts';
import { COMMODITIES } from '../../data/commodities';
import { applyFrame, checksum, createMultiGame, restore, snapshot, type Frame, type MpSetup } from '../multiplayer';
import { createGame, dispatch, advanceDay } from '../game';
import { isUnlocked, stepProgression } from '../progression';
import { govState, generateTenders, resolveTenders, submitBid, tenderFairDiff, buyLicence } from '../government';
import { skipLessonStep, stepDiagnostic } from '../lessons';
import { customizeOffice, seatsTotal } from '../offices';
import { leaderboard } from '../companies';

const quiet = { crisisFrequency: 0 };
const setup: MpSetup = {
  config: { seed: 'mp-test', years: 1, ...quiet },
  companies: [{ name: 'Alpha', hqCity: 'geneva', capital: 25e6 }, { name: 'Bêta', hqCity: 'singapore', capital: 25e6 }, { name: 'Gamma', hqCity: 'houston', capital: 25e6 }],
};

describe('multijoueur : lockstep déterministe', () => {
  it('deux navigateurs qui appliquent les mêmes trames restent identiques ; le monde est partagé', () => {
    const a = createMultiGame(setup);
    const b = createMultiGame(setup);
    expect(checksum(a)).toBe(checksum(b));
    expect(a[1]!.market).toBe(a[0]!.market); // monde commun par référence
    const mi = listedMonths(COMMODITIES.BRENT, a[0]!.day)[1]!;
    const frames: Frame[] = [
      { seq: 1, kind: 'action', player: 'p1', company: 0, action: { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: 20 } },
      { seq: 2, kind: 'action', player: 'p2', company: 1, action: { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: -35 } },
      { seq: 3, kind: 'tick' }, { seq: 4, kind: 'tick' },
      { seq: 5, kind: 'action', player: 'p3', company: 2, action: { type: 'TRADE_FUTURE', commodity: 'CU', month: listedMonths(COMMODITIES.CU, a[0]!.day)[1]!, lots: 5 } },
      ...Array.from({ length: 20 }, (_, k) => ({ seq: 6 + k, kind: 'tick' as const })),
    ];
    for (const f of frames) { applyFrame(a, f); applyFrame(b, f); }
    expect(checksum(a)).toBe(checksum(b));
    expect(a[0]!.day).toBe(a[1]!.day);
    expect(a[1]!.futures[0]!.lots).toBe(-35);
    // chaque société voit les autres maisons humaines au classement
    expect(leaderboard(a[0]!).some((r) => r.name.includes('Bêta'))).toBe(true);
  });

  it('instantané : rejoindre en cours de partie donne exactement le même état', () => {
    const a = createMultiGame(setup);
    for (let k = 0; k < 10; k++) applyFrame(a, { seq: k, kind: 'tick' });
    const c = restore(snapshot(a));
    expect(checksum(c)).toBe(checksum(a));
    expect(c[2]!.market).toBe(c[0]!.market);
    for (let k = 0; k < 10; k++) { applyFrame(a, { seq: 100 + k, kind: 'tick' }); applyFrame(c, { seq: 100 + k, kind: 'tick' }); }
    expect(checksum(c)).toBe(checksum(a));
  });

  it('société partagée : un trader trade, mais ne peut pas recruter ni ouvrir de bureau', () => {
    const a = createMultiGame(setup);
    const mi = listedMonths(COMMODITIES.BRENT, a[0]!.day)[1]!;
    const ok = applyFrame(a, { seq: 1, kind: 'action', player: 't', company: 0, action: { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: 1 } }, { t: 'trader' });
    expect(ok?.ok).toBe(true);
    const no = applyFrame(a, { seq: 2, kind: 'action', player: 't', company: 0, action: { type: 'OPEN_BRANCH', cityId: 'london', size: 'bureau' } }, { t: 'trader' });
    expect(no?.ok).toBe(false);
  });
});

describe('complexité progressive', () => {
  it('les panneaux avancés n’apparaissent qu’à leur déclencheur', () => {
    const s = createGame({ seed: 'prog', ...quiet, progressive: true });
    expect(isUnlocked(s, 'market')).toBe(true);
    expect(isUnlocked(s, 'risk')).toBe(false);
    const mi = listedMonths(COMMODITIES.BRENT, s.day)[1]!;
    dispatch(s, { type: 'TRADE_FUTURE', commodity: 'BRENT', month: mi, lots: 5 });
    expect(isUnlocked(s, 'risk')).toBe(true);
    expect(isUnlocked(s, 'exotics')).toBe(false);
    stepProgression(s);
    expect(s.pendingAlerts.some((a) => a.text.includes('Risque'))).toBe(true);
    dispatch(s, { type: 'UNLOCK_ALL' });
    expect(isUnlocked(s, 'exotics')).toBe(true);
    const n = createGame({ seed: 'prog2', ...quiet });
    expect(isUnlocked(n, 'exotics')).toBe(true); // sans l'option, tout est visible
  });
});

describe('leçons : diagnostic et étape passée', () => {
  it('diagnostic d’une étape bloquée, passage d’étape, validation d’office d’une étape déjà réalisée', () => {
    const s = createGame({ seed: 'lesson-skip', ...quiet });
    dispatch(s, { type: 'START_LESSON', id: 'carry' });
    s.offers = [];
    expect(stepDiagnostic(s).done).toBe(false);
    skipLessonStep(s);
    expect(s.lessons!.step).toBe(1);
    skipLessonStep(s); skipLessonStep(s);
    expect(s.lessons!.active).toBeNull();
    expect(s.lessons!.done).toContain('carry');
  });
});

describe('gouvernements', () => {
  it('appel d’offres : sans licence on ne peut pas soumissionner ; une enquête généreuse l’emporte et crée un contrat', () => {
    const s = createGame({ seed: 'gov', ...quiet, commodities: ['BRENT', 'TTF', 'CU', 'WHEAT', 'API2'] });
    generateTenders(s);
    const t = govState(s).tenders[0]!;
    expect(submitBid(s, t.id, 0).ok).toBe(false);
    expect(buyLicence(s, t.zone).ok).toBe(true);
    const fair = tenderFairDiff(s, t);
    const F = 100; void F;
    // offre très agressive : gagne à coup sûr
    const generous = t.playerSide > 0 ? fair + 50 : fair - 50;
    expect(submitBid(s, t.id, generous).ok).toBe(true);
    const n0 = s.forwards.length;
    s.day = t.closeDay;
    resolveTenders(s);
    expect(s.forwards.length).toBe(n0 + 1);
    expect(s.forwards.at(-1)!.counterpartyId).toBe(t.agencyId);
    expect(govState(s).results[0]!.won).toBe(true);
  });
});

describe('personnalisation du siège', () => {
  it('les ailes ajoutent des postes ; la forme exige un immeuble entier', () => {
    const s = createGame({ seed: 'office', ...quiet });
    const seats0 = seatsTotal(s);
    expect(customizeOffice(s, { extension: 2 }).ok).toBe(true);
    expect(seatsTotal(s)).toBeGreaterThan(seats0);
    expect(customizeOffice(s, { shape: 'twin' }).ok).toBe(false);
    expect(customizeOffice(s, { facade: '#2b3a4a', plants: true }).ok).toBe(true);
    expect(s.office.custom?.plants).toBe(true);
    advanceDay(s);
    expect(s.status).toBe('running');
  });
});

describe('codes de triche', () => {
  it('un code connu s’applique et marque la partie (plus de succès) ; un code inconnu est refusé', async () => {
    const { applyCheat } = await import('../cheats');
    const s = createGame({ seed: 'cheat', ...quiet });
    const cash = s.company.cash;
    expect(applyCheat(s, 'midas').ok).toBe(true);
    expect(s.company.cash).toBeCloseTo(cash + 10e6, 2);
    expect(s.stats.cheats).toContain('MIDAS');
    expect(applyCheat(s, 'abracadabra').ok).toBe(false);
    expect(dispatch(s, { type: 'CHEAT', code: 'Panorama' }).ok).toBe(true);
    const n = s.achievements.length;
    for (let i = 0; i < 5; i++) advanceDay(s);
    expect(s.achievements.length).toBe(n);
  });
});
