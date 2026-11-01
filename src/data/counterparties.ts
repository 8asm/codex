import type { Counterparty } from '../engine/types';
import { COMPANIES } from './companies';
import { CITY_ZONE } from './world';

/** Toutes les sociétés peuvent être contreparties ; dérivé de `companies.ts` (identifiants stables). */
export const COUNTERPARTIES: Counterparty[] = COMPANIES.map((c) => ({
  id: c.id,
  name: c.name,
  cityId: c.cityId,
  kind: c.kind,
  zone: c.zone ?? CITY_ZONE[c.cityId]!,
}));

export const COUNTERPARTY_BY_ID: Record<string, Counterparty> = Object.fromEntries(COUNTERPARTIES.map((c) => [c.id, c]));
