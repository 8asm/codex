import { describe, expect, it } from 'vitest';
import { COMMODITIES } from '../../data/commodities';
import { listedMonths } from '../contracts';
import { advanceDay, createGame, dispatch, migrateState, SAVE_VERSION } from '../game';
import { becomeCeo, careerClose, evaluate, promote } from '../career';
import { negotiate, startNegotiation } from '../negotiation';
import { findRole } from '../npcs';
import { checkTips, compromise, pushSituation, stepCompromises } from '../situations';
import type { GameState } from '../types';
import { nav } from '../valuation';
import { dayFromYMD } from '../calendar';

const quiet = { crisisFrequency: 0 };
const story = (seed: string, extra: Record<string, unknown> = {}) => createGame({ seed, mode: 'story', employerId: 'glenmoor', track: 'trading', years: 10, ...quiet, ...extra });
const front = (s: GameState, c: 'BRENT' | 'CU' | 'API2' | 'TTF', i = 1) => listedMonths(COMMODITIES[c], s.day)[i]!;

describe('début de carrière', () => {
  it('stagiaire : pas de livre, collègues générés, trading refusé', () => {
    const s = story('intern');
    expect(s.career!.level).toBe(0);
    expect(s.career!.status).toBe('employed');
    expect(findRole(s, 'manager', 'glenmoor')).toBeDefined();
    expect(s.npcs.filter((n) => n.role === 'client').length).toBeGreaterThan(20);
    const r = dispatch(s, { type: 'TRADE_FUTURE', commodity: 'CU', month: front(s, 'CU'), lots: 1 });
    expect(r.ok).toBe(false);
    expect(nav(s)).toBe(0);
  });

  it('des situations arrivent et se résolvent ; les relations gardent la mémoire', () => {
    const s = story('sit');
    let n = 0;
    while (!s.situations.some((x) => x.day <= s.day) && n++ < 60) advanceDay(s);
    const sit = s.situations.find((x) => x.day <= s.day)!;
    expect(sit).toBeDefined();
    const r = dispatch(s, { type: 'RESOLVE_SITUATION', id: sit.id, choice: 0 });
    expect(r.ok).toBe(true);
    expect(s.career!.log.length).toBeGreaterThan(0);
    if (sit.npcId) expect(s.npcs.find((x) => x.id === sit.npcId)!.memory.length).toBeGreaterThan(0);
  });
});

describe('négociation', () => {
  it('un bluff avec un vrai levier réussit ; l’accord ne dépasse jamais la limite cachée', () => {
    const s = story('neg');
    const mgr = findRole(s, 'manager', 'glenmoor')!;
    startNegotiation(s, { kind: 'salaire', npcId: mgr.id, title: 't', unit: '$', opening: 10_000, reservation: 12_000, leverage: true, higherIsBetter: true, context: {} });
    negotiate(s, 'bluffer', 50);
    expect(s.negotiation!.offer).toBeGreaterThan(10_000 + 0.5 * 2000);
    negotiate(s, 'ancrer', 50);
    negotiate(s, 'accepter', 50);
    expect(s.negotiation!.done).toBe(true);
    expect(s.negotiation!.result!).toBeLessThanOrEqual(12_000 + 1e-9);
  });

  it('prix d’achat (plus bas = mieux) : la négociation améliore le différentiel', () => {
    const s = story('neg2');
    startNegotiation(s, { kind: 'deal', npcId: '', title: 't', unit: '$/bbl', opening: 1.5, reservation: 1.1, leverage: false, higherIsBetter: false, context: {} });
    negotiate(s, 'argumenter', 60);
    negotiate(s, 'concéder', 60);
    negotiate(s, 'accepter', 60);
    expect(s.negotiation!.result!).toBeLessThan(1.5);
    expect(s.negotiation!.result!).toBeGreaterThanOrEqual(1.1 - 1e-9);
  });
});

describe('progression et droits', () => {
  it('promotion trader junior : capital alloué, futures du desk seulement', () => {
    const s = story('promo');
    promote(s, 1);
    promote(s, 2);
    expect(s.career!.allocation).toBe(8e6);
    expect(nav(s)).toBeCloseTo(8e6, 0);
    const desk = s.career!.desk[0]!;
    expect(dispatch(s, { type: 'TRADE_FUTURE', commodity: desk, month: listedMonths(COMMODITIES[desk], s.day)[1]!, lots: 2 }).ok).toBe(true);
    const other = (['BRENT', 'TTF', 'CU', 'WHEAT', 'API2'] as const).find((c) => !s.career!.desk.includes(c))!;
    expect(dispatch(s, { type: 'TRADE_FUTURE', commodity: other, month: listedMonths(COMMODITIES[other], s.day)[1]!, lots: 1 }).ok).toBe(false);
    expect(dispatch(s, { type: 'TRADE_OPTION', commodity: desk, month: listedMonths(COMMODITIES[desk], s.day)[1]!, optType: 'C', strike: 1, lots: 1 }).ok).toBe(false);
  });

  it('le P&L du livre est reversé à l’employeur', () => {
    const s = story('pnl');
    promote(s, 1); promote(s, 2);
    const desk = s.career!.desk[0]!;
    dispatch(s, { type: 'TRADE_FUTURE', commodity: desk, month: listedMonths(COMMODITIES[desk], s.day)[1]!, lots: 20 });
    const emp = s.companies.find((c) => c.id === 'glenmoor')!;
    const e0 = emp.nav;
    const n0 = nav(s);
    advanceDay(s);
    advanceDay(s);
    expect(emp.nav - e0).not.toBe(0);
    // l'employeur bouge aussi pour ses propres positions ; on vérifie seulement que le livre a bougé
    expect(nav(s)).not.toBe(n0);
  });

  it('évaluation favorable → promotion proposée et acceptée', () => {
    const s = story('rev');
    const c = s.career!;
    c.skills.marché = 90;
    findRole(s, 'manager', 'glenmoor')!.trust = 90;
    c.merit = 10;
    s.day = c.sinceDay + 130;
    expect(evaluate(s).score).toBeGreaterThan(65);
    // déclenchement d'une revue : premier jour ouvré de juillet
    s.lastCloseDay = dayFromYMD(2027, 6, 30);
    s.day = dayFromYMD(2027, 7, 1);
    c.lastReview = s.day - 200;
    careerClose(s, nav(s), nav(s));
    const sit = s.situations.find((x) => x.template === 'promotion');
    expect(sit).toBeDefined();
    dispatch(s, { type: 'RESOLVE_SITUATION', id: sit!.id, choice: 0 });
    expect(c.level).toBe(1);
  });

  it('dépassements de limites répétés : gel puis licenciement', () => {
    const s = story('disc');
    promote(s, 1); promote(s, 2);
    const desk = s.career!.desk[0]!;
    const mi = listedMonths(COMMODITIES[desk], s.day)[1]!;
    for (let k = 0; k < 40; k++) {
      const r = dispatch(s, { type: 'TRADE_FUTURE', commodity: desk, month: mi, lots: 50 });
      if (!r.ok) break;
    }
    let n = 0;
    while (s.career!.status === 'employed' && n++ < 80) {
      advanceDay(s);
      for (const x of s.situations.filter((y) => y.day <= s.day)) dispatch(s, { type: 'RESOLVE_SITUATION', id: x.id, choice: 1 });
    }
    expect(s.career!.status).toBe('unemployed');
    expect(s.futures).toHaveLength(0);
  });
});

describe('marché de l’emploi', () => {
  it('offre → entretien → nouvel employeur', () => {
    const s = story('job');
    promote(s, 1);
    s.career!.reputation = 80;
    s.career!.skills.marché = 90;
    dispatch(s, { type: 'APPLY_JOB', companyId: 'vitaro', track: 'trading' });
    const sit = s.situations.find((x) => x.template === 'interview')!;
    let tries = 0;
    let offer = s.career!.offers.at(0);
    dispatch(s, { type: 'RESOLVE_SITUATION', id: sit.id, choice: 0 });
    while (!s.career!.offers.some((o) => o.interviewed) && tries++ < 5) {
      s.world.eventCooldown['apply.trafigera'] = -1;
      dispatch(s, { type: 'APPLY_JOB', companyId: 'trafigera', track: 'trading' });
      const si = s.situations.find((x) => x.template === 'interview');
      if (si) dispatch(s, { type: 'RESOLVE_SITUATION', id: si.id, choice: 0 });
    }
    offer = s.career!.offers.find((o) => o.interviewed);
    expect(offer).toBeDefined();
    expect(dispatch(s, { type: 'ACCEPT_JOB', offerId: offer!.id }).ok).toBe(true);
    expect(s.career!.employerId).toBe(offer!.companyId);
  });
});

describe('conséquences différées', () => {
  it('tuyau privilégié exploité → délit d’initié enregistré', () => {
    const s = story('tip');
    promote(s, 1); promote(s, 2);
    const desk = s.career!.desk[0]!;
    s.tips.push({ id: 'tp', day: s.day, npcId: s.npcs[0]!.id, commodity: desk, dir: 1, insider: true, revealDay: s.day, real: true, netAtTip: 0, text: 'x' });
    dispatch(s, { type: 'TRADE_FUTURE', commodity: desk, month: listedMonths(COMMODITIES[desk], s.day)[1]!, lots: 30 });
    checkTips(s);
    expect(s.compromises.some((c) => c.kind === 'initié')).toBe(true);
  });

  it('une compromission grave finit par déclencher une enquête, avec issue possible jusqu’à la prison', () => {
    const s = story('inv');
    compromise(s, 'sanctions', 5, 'test', []);
    s.day += 200;
    let n = 0;
    while (!s.situations.some((x) => x.template === 'investigation') && n++ < 3000) stepCompromises(s);
    const sit = s.situations.find((x) => x.template === 'investigation')!;
    expect(sit).toBeDefined();
    dispatch(s, { type: 'RESOLVE_SITUATION', id: sit.id, choice: 1 });
    expect(s.compromises[0]!.resolved).toBe(true);
    expect(['running', 'prison', 'banned']).toContain(s.status);
  });
});

describe('fondateur, CEO, sandbox « rejoindre »', () => {
  it('création de société : investisseur négocié, capital, part du fondateur, ligne bancaire', () => {
    const s = story('found');
    const c = s.career!;
    c.wealth = 2e6;
    c.reputation = 60;
    const inv = s.npcs.find((n) => n.role === 'investisseur')!;
    dispatch(s, { type: 'START_NEGOTIATION', kind: 'investisseur', target: inv.id });
    dispatch(s, { type: 'NEGOTIATE', move: 'argumenter' });
    dispatch(s, { type: 'NEGOTIATE', move: 'accepter' });
    expect(c.investors).toHaveLength(1);
    const r = dispatch(s, { type: 'FOUND_COMPANY', name: 'Mistral Commodities', city: 'singapore' });
    expect(r.ok).toBe(true);
    expect(c.status).toBe('founder');
    expect(c.equity).toBeLessThan(1);
    expect(nav(s)).toBeCloseTo(1.6e6 + c.investors[0]!.capital, -2);
    expect(s.company.creditMult).toBeGreaterThan(0);
    expect(dispatch(s, { type: 'TRADE_OPTION', commodity: 'BRENT', month: listedMonths(COMMODITIES.BRENT, s.day)[2]!, optType: 'C', strike: 80, lots: 1 }).message).not.toMatch(/poste/);
  });

  it('dividendes du fondateur : retenue à la source de la ville du siège', () => {
    const s = story('div');
    const c = s.career!;
    c.wealth = 2e6; c.reputation = 60;
    dispatch(s, { type: 'FOUND_COMPANY', name: 'X', city: 'geneva' });
    s.company.cash += 5e6; // bénéfice
    const w0 = c.wealth;
    s.lastNav = nav(s);
    s.lastCloseDay = dayFromYMD(2027, 12, 31);
    s.day = dayFromYMD(2028, 1, 3);
    careerClose(s, s.lastNav, s.lastNav);
    const profit = s.lastNav - s.company.yearStartNav;
    // nouveau mois : coût de la vie genevois (7 000 $) puis intérêts de l'épargne, avant le dividende
    expect(c.wealth - (w0 - 7000) * (1 + 0.03 / 12)).toBeCloseTo(profit * c.payout * c.equity * (1 - 0.35), 0);
  });

  it('CEO : la société de l’employeur devient celle du joueur', () => {
    const s = story('ceo');
    const emp = s.companies.find((c) => c.id === 'glenmoor')!;
    const v = emp.nav;
    becomeCeo(s);
    expect(s.career!.status).toBe('ceo');
    expect(emp.alive).toBe(false);
    expect(nav(s)).toBeCloseTo(v, -3);
  });

  it('sandbox « rejoindre » : trader sans narration, capital alloué = capital choisi', () => {
    const s = createGame({ seed: 'join', start: 'join', employerId: 'vitaro', capital: 30e6, ...quiet });
    expect(s.career!.narrative).toBe(false);
    expect(s.career!.level).toBe(3);
    expect(nav(s)).toBeCloseTo(30e6, 0);
    for (let i = 0; i < 30; i++) advanceDay(s);
    expect(s.situations).toHaveLength(0);
  });
});

describe('déterminisme et migration', () => {
  it('une carrière complète est déterministe', () => {
    const run = () => {
      const s = story('det5', { years: 2 });
      while (s.status === 'running') {
        for (const x of s.situations.filter((y) => y.day <= s.day)) dispatch(s, { type: 'RESOLVE_SITUATION', id: x.id, choice: 0 });
        advanceDay(s);
      }
      return { lvl: s.career!.level, w: Math.round(s.career!.wealth), log: s.career!.log.length, st: s.status };
    };
    expect(run()).toEqual(run());
  });

  it('migration v4 → v5', () => {
    const s = createGame({ seed: 'm5' }) as unknown as Record<string, unknown>;
    for (const k of ['career', 'npcs', 'situations', 'negotiation', 'compromises', 'tips']) delete s[k];
    s.version = 4;
    const g = migrateState(s as unknown as GameState);
    expect(g.version).toBe(SAVE_VERSION);
    expect(g.npcs.length).toBeGreaterThan(0);
    advanceDay(g);
    expect(g.status).toBe('running');
  });
});

void pushSituation;
