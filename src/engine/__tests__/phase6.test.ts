import { describe, expect, it } from 'vitest';
import { CITY_BY_ID } from '../../data/cities';
import { FIT_OUT_MONTHS, ITEM_BY_ID, OFFICE_CAP_RATE, OWNER_COSTS_PA, PROPERTY_SALE_COST, TIERS } from '../../data/offices';
import { advanceDay, createGame, dispatch, migrateState, SAVE_VERSION } from '../game';
import {
  buildingBook, buildingPrice, fitOutCost, inviteToHq, negotiationEdge, officeBookValue, officeEffects, officeMonthly, prestige, seatsUsed,
} from '../offices';
import type { GameState } from '../types';
import { nav } from '../valuation';

const quiet = { crisisFrequency: 0 };
const rich = (seed: string, capital = 600e6) => createGame({ seed, capital, ...quiet });
const jump = (s: GameState, days: number) => {
  // fait vieillir les immobilisations sans faire tourner le marché (les VNC ne dépendent que du temps)
  s.day += days;
};

describe('bureaux : comptabilité exacte', () => {
  it('départ : un étage loué, aucun actif, loyer = loyer de base de la ville', () => {
    const s = createGame({ seed: 'o1', ...quiet });
    expect(s.office.tier).toBe(0);
    expect(officeBookValue(s)).toBe(0);
    expect(officeMonthly(s).rent).toBe(CITY_BY_ID[s.company.hqCity]!.officeRentMonthly);
    expect(seatsUsed(s)).toBe(3 + 1); // équipe de base + vente automatique de la production (active par défaut)
  });

  it('agrandissement refusé sans la solvabilité requise', () => {
    const s = createGame({ seed: 'o2', ...quiet });
    const r = dispatch(s, { type: 'OFFICE_MOVE', tier: 2 });
    expect(r.ok).toBe(false);
    expect(s.office.tier).toBe(0);
  });

  it('un agencement capitalisé ne change pas la VL le jour de l’achat, puis s’amortit linéairement', () => {
    const s = rich('o3');
    s.office.movedDay -= 100;
    const v0 = nav(s);
    const c0 = s.company.cash;
    expect(dispatch(s, { type: 'OFFICE_MOVE', tier: 1 }).ok).toBe(true);
    const fit = fitOutCost(s, 1);
    expect(c0 - s.company.cash).toBeCloseTo(fit, 2);
    expect(nav(s)).toBeCloseTo(v0, 2);
    jump(s, (365.25 / 12) * (FIT_OUT_MONTHS / 2));
    expect(officeBookValue(s)).toBeCloseTo(fit / 2, 0);
  });

  it('déménager passe la valeur nette des anciens agencements en perte', () => {
    const s = rich('o4');
    s.office.movedDay -= 100;
    dispatch(s, { type: 'OFFICE_MOVE', tier: 1 });
    jump(s, 365);
    const book = officeBookValue(s);
    const v0 = nav(s);
    expect(dispatch(s, { type: 'OFFICE_MOVE', tier: 2 }).ok).toBe(true);
    // nouvel agencement : neutre ; ancien : perdu
    expect(nav(s)).toBeCloseTo(v0 - book, 2);
  });

  it('achat de l’immeuble : prix = loyer capitalisé, VL inchangée, loyer remplacé par les charges ; revente à −3 %', () => {
    const s = rich('o5');
    s.office.movedDay -= 100;
    dispatch(s, { type: 'OFFICE_MOVE', tier: 2 });
    const rent = officeMonthly(s).rent;
    const price = buildingPrice(s);
    expect(price).toBeCloseTo((rent * 12) / OFFICE_CAP_RATE, -1);
    const v0 = nav(s);
    expect(dispatch(s, { type: 'OFFICE_PROPERTY', buy: true }).ok).toBe(true);
    expect(nav(s)).toBeCloseTo(v0, 2);
    const m = officeMonthly(s);
    expect(m.rent).toBe(0);
    expect(m.upkeep).toBeCloseTo((price * OWNER_COSTS_PA) / 12, 2);
    jump(s, 365.25 * 2);
    const book = buildingBook(s);
    expect(book).toBeCloseTo(price * (1 - 0.015 * 2), -1);
    const c0 = s.company.cash;
    expect(dispatch(s, { type: 'OFFICE_PROPERTY', buy: false }).ok).toBe(true);
    expect(s.company.cash - c0).toBeCloseTo(book * (1 - PROPERTY_SALE_COST), 2);
  });

  it('œuvre d’art : la VL ne perd que les frais d’enchères', () => {
    const s = rich('o6');
    s.office.movedDay -= 100;
    dispatch(s, { type: 'OFFICE_MOVE', tier: 1 });
    const v0 = nav(s);
    expect(dispatch(s, { type: 'OFFICE_ITEM', item: 'art' }).ok).toBe(true);
    expect(nav(s)).toBeCloseTo(v0 - ITEM_BY_ID.art.cost * 0.25, 2);
    const c0 = s.company.cash;
    dispatch(s, { type: 'OFFICE_ITEM', item: 'art', sell: true });
    expect(s.company.cash - c0).toBeCloseTo(ITEM_BY_ID.art.cost * 0.75, 2);
  });

  it('le loyer est prélevé au changement de mois avec les frais généraux', () => {
    const s = createGame({ seed: 'o7', ...quiet });
    let n = 0;
    const o0 = s.company.cumCashByCategory.overhead;
    while (n++ < 40) advanceDay(s);
    const city = CITY_BY_ID[s.company.hqCity]!;
    // au moins un mois écoulé : loyer + équipe
    expect(o0 - s.company.cumCashByCategory.overhead).toBeGreaterThanOrEqual(city.officeRentMonthly + 90_000 * city.staffCostIndex - 1);
  });

  it('postes en débordement : coût de coworking et prestige réduit', () => {
    const s = createGame({ seed: 'o8', ...quiet });
    const p0 = prestige(s);
    const u0 = seatsUsed(s);
    for (let i = 0; i < 7; i++) s.managers.push({ id: `x${i}`, name: `X${i}`, skill: 50, salary: 1, specialty: 'production', assetId: `a${i}`, mistakes: 0 });
    expect(seatsUsed(s)).toBe(u0 + 7);
    expect(officeMonthly(s).overflow).toBeGreaterThan(0);
    expect(prestige(s)).toBeLessThan(p0);
  });
});

describe('prestige : effets de jeu', () => {
  it('le prestige grandit avec les locaux, le style et les objets', () => {
    const s = rich('p1');
    const p0 = prestige(s);
    s.office.movedDay -= 100;
    dispatch(s, { type: 'OFFICE_MOVE', tier: 2 });
    dispatch(s, { type: 'OFFICE_STYLE', style: 'verriere' });
    dispatch(s, { type: 'OFFICE_ITEM', item: 'reception' });
    expect(prestige(s)).toBeGreaterThan(p0 + TIERS[2]!.prestige - TIERS[0]!.prestige);
    expect(officeEffects(s).inviteMult).toBe(1.5);
  });

  it('un client reçu dans un siège prestigieux gagne plus de confiance', () => {
    const gainWith = (upgrade: boolean) => {
      const s = rich('p2');
      if (upgrade) {
        s.office.movedDay -= 100;
        dispatch(s, { type: 'OFFICE_MOVE', tier: 2 });
        dispatch(s, { type: 'OFFICE_ITEM', item: 'reception' });
      }
      const n = s.npcs.find((x) => x.role === 'client')!;
      const t0 = n.trust;
      expect(inviteToHq(s, n.id).ok).toBe(true);
      expect(inviteToHq(s, n.id).ok).toBe(false); // délai entre deux rendez-vous
      return n.trust - t0;
    };
    expect(gainWith(true)).toBeGreaterThan(gainWith(false) * 1.8);
  });

  it('le prestige améliore la marge de négociation et attire des candidats', () => {
    const s = rich('p3');
    const e0 = negotiationEdge(s);
    const t0 = officeEffects(s).talentRate;
    s.office.movedDay -= 100;
    dispatch(s, { type: 'OFFICE_MOVE', tier: 3 });
    dispatch(s, { type: 'OFFICE_ITEM', item: 'bienetre' });
    expect(negotiationEdge(s)).toBeGreaterThan(e0 * 3);
    expect(officeEffects(s).talentRate).toBeGreaterThan(t0 + 0.3);
    const m0 = s.managers.length;
    for (let i = 0; i < 200; i++) advanceDay(s);
    expect(s.office.applicants).toBeGreaterThan(0);
    expect(s.managers.length).toBeGreaterThan(m0);
  });

  it('salle blindée : moins d’erreurs des gérants ; open space : compétences plus rapides', () => {
    const s = rich('p4');
    dispatch(s, { type: 'OFFICE_STYLE', style: 'bunker' });
    expect(officeEffects(s).mistakeMult).toBeCloseTo(0.65);
    dispatch(s, { type: 'OFFICE_STYLE', style: 'openspace' });
    expect(officeEffects(s).skillMult).toBeCloseTo(1.25);
  });

  it('un salarié n’a pas la main sur les bureaux de son employeur', () => {
    const s = createGame({ seed: 'p5', mode: 'story', employerId: 'glenmoor', track: 'trading', ...quiet });
    expect(dispatch(s, { type: 'OFFICE_STYLE', style: 'verriere' }).ok).toBe(false);
    expect(officeEffects(s).skillMult).toBe(1);
  });
});

describe('sauvegardes', () => {
  it('migration v5 → v6', () => {
    const s = createGame({ seed: 'm6' }) as unknown as Record<string, unknown> & GameState;
    delete (s as Partial<GameState>).office;
    delete (s.company.cumCashByCategory as Partial<Record<string, number>>).office;
    s.version = 5;
    const m = migrateState(s);
    expect(m.version).toBe(SAVE_VERSION);
    expect(m.office.tier).toBe(0);
    advanceDay(m);
    expect(m.status).toBe('running');
  });
});
