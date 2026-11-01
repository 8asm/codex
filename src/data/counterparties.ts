import type { Counterparty } from '../engine/types';

/** Contreparties fictives (inspirées du secteur, noms modifiés). Les sociétés IA complètes arrivent en phase 3. */
export const COUNTERPARTIES: Counterparty[] = [
  { id: 'glenmoor', name: 'Glenmoor', cityId: 'geneva', kind: 'trader' },
  { id: 'vitaro', name: 'Vitaro', cityId: 'geneva', kind: 'trader' },
  { id: 'trafigera', name: 'Trafigera', cityId: 'singapore', kind: 'trader' },
  { id: 'gunvald', name: 'Gunvald', cityId: 'geneva', kind: 'trader' },
  { id: 'mercuris', name: 'Mercuris', cityId: 'geneva', kind: 'trader' },
  { id: 'cargall', name: 'Cargall', cityId: 'chicago', kind: 'agri' },
  { id: 'delfus', name: 'Louis Delfus', cityId: 'rotterdam', kind: 'agri' },
  { id: 'bunje', name: 'Bunje', cityId: 'houston', kind: 'agri' },
  { id: 'castlemoor', name: 'Castlemoor', cityId: 'london', kind: 'trader' },
  { id: 'northsea', name: 'Nordhavn Petroleum', cityId: 'london', kind: 'major' },
  { id: 'gulfstar', name: 'Gulfstar Refining', cityId: 'houston', kind: 'major' },
  { id: 'emiroil', name: 'Emirates Bunker & Oil', cityId: 'dubai', kind: 'producer' },
  { id: 'andescu', name: 'Andes Cobre', cityId: 'santiago', kind: 'miner' },
  { id: 'yangtze', name: 'Yangtze Metals', cityId: 'shanghai', kind: 'trader' },
  { id: 'huadian', name: 'Huanan Power', cityId: 'shanghai', kind: 'utility' },
  { id: 'rbcoal', name: 'Zulu Coal Exports', cityId: 'johannesburg', kind: 'miner' },
  { id: 'rhineutil', name: 'Rhein Energie AG', cityId: 'rotterdam', kind: 'utility' },
  { id: 'lemanutil', name: 'Services Industriels du Léman', cityId: 'geneva', kind: 'utility' },
  { id: 'albion', name: 'Albion Gas Supply', cityId: 'london', kind: 'utility' },
  { id: 'straits', name: 'Straits Energy', cityId: 'singapore', kind: 'trader' },
  { id: 'prairie', name: 'Prairie Grain Coop', cityId: 'chicago', kind: 'agri' },
  // Banques de dérivés (contreparties OTC : swaps et options asiatiques)
  { id: 'bln', name: 'Banque Lémanique de Négoce', cityId: 'geneva', kind: 'bank' },
  { id: 'atlas', name: 'Atlas Commodities Bank', cityId: 'london', kind: 'bank' },
  { id: 'orientpac', name: 'Orient Pacific Bank', cityId: 'singapore', kind: 'bank' },
];

export const COUNTERPARTY_BY_ID: Record<string, Counterparty> = Object.fromEntries(
  COUNTERPARTIES.map((c) => [c.id, c]),
);
