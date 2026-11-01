/**
 * Carrières : filières, niveaux, rémunérations, allocations de capital, noms des PNJ.
 * Niveaux 0..7 communs à toutes les filières ; 6 = direction de la filière, 7 = CEO.
 */
import type { CareerTrack, Skill } from '../engine/types';

export const TRACK_TITLES: Record<CareerTrack, string[]> = {
  trading: ['Stagiaire', 'Analyste', 'Trader junior', 'Trader', 'Senior trader', 'Head of desk', 'Directeur du trading', 'CEO'],
  risk: ['Stagiaire risques', 'Analyste risques', 'Risk manager junior', 'Risk manager', 'Senior risk manager', 'Head of risk', 'Chief Risk Officer', 'CEO'],
  operations: ['Stagiaire opérations', 'Opérateur', 'Chargé d’affrètement', 'Responsable logistique', 'Senior opérateur', 'Head of operations', 'Directeur des opérations', 'CEO'],
  structured: ['Stagiaire financement', 'Analyste financement', 'Associé', 'Chargé d’affaires', 'Senior banker', 'Head of structured finance', 'Directeur financier', 'CEO'],
  research: ['Stagiaire recherche', 'Analyste recherche', 'Économiste', 'Stratégiste', 'Senior stratégiste', 'Head of research', 'Chef économiste', 'CEO'],
};

export const TRACK_LABEL: Record<CareerTrack, string> = {
  trading: 'Trading', risk: 'Risques', operations: 'Opérations', structured: 'Financement structuré', research: 'Recherche',
};

/** Compétence principale de chaque filière (pèse dans les évaluations). */
export const TRACK_SKILL: Record<CareerTrack, Skill> = { trading: 'marché', risk: 'risque', operations: 'opérations', structured: 'finance', research: 'marché' };

/** Mois minimum dans un niveau avant promotion. */
export const MIN_MONTHS = [4, 8, 10, 12, 14, 18, 24, 999];
/** Salaire mensuel de base (USD) par niveau, multiplié par la taille de l'employeur. */
export const BASE_SALARY = [3_500, 9_000, 14_000, 20_000, 30_000, 45_000, 70_000, 120_000];
/** Capital alloué au livre de trading (USD) par niveau (filière trading uniquement). */
export const ALLOCATION = [0, 0, 8e6, 25e6, 60e6, 150e6, 400e6, 0];
/** Part du P&L positif du livre versée en bonus (trading). */
export const BONUS_RATE = [0, 0, 0.06, 0.08, 0.1, 0.07, 0.04, 0.02];
/** Objectif de rendement annuel du livre (trading). */
export const PNL_TARGET = 0.08;

export const SKILL_LABEL: Record<Skill, string> = {
  marché: 'Lecture de marché', risque: 'Gestion des risques', négociation: 'Négociation', opérations: 'Opérations & logistique', finance: 'Finance', relationnel: 'Réseau & relationnel',
};

export const FIRST_NAMES = ['Lucas', 'Emma', 'Noah', 'Chloé', 'Omar', 'Sofia', 'Liam', 'Aïcha', 'Mateo', 'Inès', 'Hiroshi', 'Priya', 'Kofi', 'Elena', 'Jonas', 'Leïla', 'Viktor', 'Mei', 'Rafael', 'Nadia', 'Sven', 'Fatou', 'Diego', 'Yara', 'Arthur', 'Zoe', 'Karim', 'Ingrid', 'Tariq', 'Camila', 'Felix', 'Amina', 'Pavel', 'Clara', 'Juan', 'Hana', 'Oscar', 'Salomé', 'Ravi', 'Greta'];
export const LAST_NAMES = ['Moreau', 'Schneider', 'Haddad', 'Okafor', 'Rossi', 'Tanaka', 'Novak', 'Dubois', 'Mensah', 'García', 'Lindqvist', 'Petrov', 'Chen', 'Kowalski', 'Baptiste', 'Mahmoud', 'Fischer', 'Silva', 'Andersen', 'Kumar', 'Lefèvre', 'Osei', 'Weber', 'Nakamura', 'Costa', 'Ivanova', 'Bakker', 'Diallo', 'Romano', 'Eriksson'];

/** Retenue à la source sur les dividendes versés à des actionnaires (taux simplifiés, sans conventions fiscales). */
export const WITHHOLDING: Record<string, number> = {
  geneva: 0.35, london: 0, rotterdam: 0.15, singapore: 0, houston: 0.3, dubai: 0, shanghai: 0.1, chicago: 0.3, santiago: 0.35, johannesburg: 0.2,
};

/** Coût de la vie mensuel (USD) dans chaque ville. */
export const COST_OF_LIVING: Record<string, number> = {
  geneva: 7_000, london: 6_500, rotterdam: 4_000, singapore: 6_000, houston: 4_000, dubai: 5_000, shanghai: 3_500, chicago: 4_500, santiago: 2_500, johannesburg: 2_200,
};
