import type { CommodityId, CommoditySpec, Currency, FreightIndex, Incoterm, LtdRule, OptionExpiryRule, OptStyle } from '../engine/types';

/**
 * Commodités de la phase 1. Les contrats sont calqués sur les références réelles
 * (ICE Brent, ICE Endex TTF, LME Copper, CBOT Wheat, ICE Rotterdam Coal) mais les bourses sont fictives.
 * Les paramètres de modèle sont des ordres de grandeur plausibles, pas des calibrations.
 */
const CORE: Partial<Record<CommodityId, CommoditySpec>> = {
  BRENT: {
    id: 'BRENT',
    group: 'brut',
    name: 'Brent (brut léger mer du Nord)',
    short: 'Brent',
    family: 'energy',
    exchange: 'ICX Europe',
    currency: 'USD',
    priceUnit: '$/bbl',
    qtyUnit: 'bbl',
    lot: { kind: 'fixed', qty: 1000 },
    tick: 0.01,
    valuePerUnit: 1,
    decimals: 2,
    listing: { kind: 'monthly', count: 24 },
    ltdRule: 'BRENT',
    model: {
      s0: 78,
      chi0: 0.04,
      kappa: 1.4,
      sigmaChi: 0.28,
      sigmaXi: 0.16,
      rho: 0.3,
      longDrift: -0.02,
      seasonalAmp: 0.012,
      seasonalPeak: 6.5,
    },
    liquidity: { halfSpreadTicks: 1, depthLots: 800, commission: 2.5 },
    options: { style: 'A', expiryRule: 'BRENT', strikeStep: 1, months: 12, skew: -0.05, curvature: 0.025, volHalfSpread: 0.006 },
    positionLimits: { spotMonth: 2500, allMonths: 12000 },
    logistics: { tonnesPerUnit: 0.1364, handlingPerT: 0.4, transitLoss: 0.0015, vessel: () => 'AFRA' },
    settlement: { kind: 'cash' },
    physical: {
      cargoSizes: [300_000, 600_000],
      storagePerUnitMonth: 0.45,
      spotSpreadPct: 0.004,
      locations: [
        { id: 'BRENT_RTM', cityId: 'rotterdam', label: 'CIF Rotterdam', incoterm: 'CIF', basisMean: 1.1, basisVol: 0.9 , freightLink: { index: 'AFRA', perUnit: 1.4 } },
        { id: 'BRENT_USGC', cityId: 'houston', label: 'FOB US Gulf', incoterm: 'FOB', basisMean: -1.9, basisVol: 1.2 , freightLink: { index: 'AFRA', perUnit: -1.4 } },
        { id: 'BRENT_FUJ', cityId: 'dubai', label: 'FOB Fujairah', incoterm: 'FOB', basisMean: -0.3, basisVol: 1.0 , freightLink: { index: 'AFRA', perUnit: -1.2 } },
        { id: 'BRENT_SIN', cityId: 'singapore', label: 'CFR Singapour', incoterm: 'CFR', basisMean: 2.1, basisVol: 1.1 , freightLink: { index: 'AFRA', perUnit: 1.2 } },
      ],
    },
    color: '#ff8a3d',
    icon: '🛢️',
    blurb: 'La référence mondiale du brut. Cargaisons de 600 kbbl, futures réglés en cash.',
  },
  TTF: {
    id: 'TTF',
    group: 'gaz',
    name: 'Gaz naturel TTF (Pays-Bas)',
    short: 'TTF',
    family: 'energy',
    exchange: 'ICX Endex',
    currency: 'EUR',
    priceUnit: '€/MWh',
    qtyUnit: 'MWh',
    lot: { kind: 'mwMonth', mw: 1 },
    tick: 0.005,
    valuePerUnit: 1,
    decimals: 3,
    listing: { kind: 'monthly', count: 18 },
    ltdRule: 'TTF',
    model: {
      s0: 36,
      chi0: 0,
      kappa: 3,
      sigmaChi: 0.65,
      sigmaXi: 0.25,
      rho: 0.2,
      longDrift: -0.03,
      seasonalAmp: 0.14,
      seasonalPeak: 0.5,
    },
    liquidity: { halfSpreadTicks: 4, depthLots: 300, commission: 3 },
    options: { style: 'E', expiryRule: 'TTF', strikeStep: 1, months: 12, skew: 0.06, curvature: 0.04, volHalfSpread: 0.012 },
    positionLimits: { spotMonth: 900, allMonths: 5000 },
    logistics: { tonnesPerUnit: 0, handlingPerT: 0, transitLoss: 0, vessel: () => 'AFRA' },
    settlement: { kind: 'physical', locationId: 'TTF_HUB' },
    physical: {
      cargoSizes: [50_000, 100_000, 200_000],
      storagePerUnitMonth: 0.25,
      spotSpreadPct: 0.005,
      locations: [
        { id: 'TTF_HUB', cityId: 'rotterdam', label: 'TTF (hub virtuel NL)', incoterm: 'HUB', basisMean: 0, basisVol: 0.3 },
        { id: 'TTF_NBP', cityId: 'london', label: 'NBP (Royaume-Uni)', incoterm: 'HUB', basisMean: -0.6, basisVol: 0.9 },
        { id: 'TTF_CH', cityId: 'geneva', label: 'Frontière suisse', incoterm: 'DAP', basisMean: 1.8, basisVol: 0.5 },
      ],
    },
    color: '#4cc3ff',
    icon: '🔥',
    blurb: 'Le prix du gaz européen. Très saisonnier : l’hiver coûte plus cher que l’été.',
  },
  CU: {
    id: 'CU',
    group: 'base',
    name: 'Cuivre grade A',
    short: 'Cuivre',
    family: 'metals',
    exchange: 'LMM Londres',
    currency: 'USD',
    priceUnit: '$/t',
    qtyUnit: 't',
    lot: { kind: 'fixed', qty: 25 },
    tick: 0.5,
    valuePerUnit: 1,
    decimals: 1,
    listing: { kind: 'monthly', count: 15 },
    ltdRule: 'LME',
    model: {
      s0: 9300,
      chi0: -0.01,
      kappa: 0.9,
      sigmaChi: 0.17,
      sigmaXi: 0.15,
      rho: 0.25,
      longDrift: 0.025,
      seasonalAmp: 0,
      seasonalPeak: 0,
    },
    liquidity: { halfSpreadTicks: 4, depthLots: 600, commission: 6 },
    options: { style: 'E', expiryRule: 'LME', strikeStep: 100, months: 12, skew: -0.03, curvature: 0.02, volHalfSpread: 0.006 },
    positionLimits: { spotMonth: 1800, allMonths: 9000 },
    logistics: { tonnesPerUnit: 1, handlingPerT: 55, transitLoss: 0, vessel: () => 'SMX' },
    settlement: { kind: 'physical', locationId: 'CU_RTM' },
    physical: {
      cargoSizes: [500, 1000, 2000],
      storagePerUnitMonth: 18,
      spotSpreadPct: 0.003,
      locations: [
        { id: 'CU_RTM', cityId: 'rotterdam', label: 'Entrepôt Rotterdam (DDP)', incoterm: 'DAP', basisMean: 85, basisVol: 30 },
        { id: 'CU_SHA', cityId: 'shanghai', label: 'CIF Shanghai (Yangshan)', incoterm: 'CIF', basisMean: 85, basisVol: 45 , freightLink: { index: 'SMX', perUnit: 15 } },
        { id: 'CU_SIN', cityId: 'singapore', label: 'CIF Singapour', incoterm: 'CIF', basisMean: 70, basisVol: 30 , freightLink: { index: 'SMX', perUnit: 12 } },
        { id: 'CU_DUR', cityId: 'johannesburg', label: 'FOB Durban (cuivre africain)', incoterm: 'FOB', basisMean: -40, basisVol: 30, freightLink: { index: 'SMX', perUnit: -15 } },
        { id: 'CU_SCL', cityId: 'santiago', label: 'FOB San Antonio (Chili)', incoterm: 'FOB', basisMean: -60, basisVol: 25 , freightLink: { index: 'SMX', perUnit: -15 } },
      ],
    },
    color: '#e8875b',
    icon: '🔶',
    blurb: 'Le métal de l’électrification. Échéances mensuelles au 3ᵉ mercredi (logique LME).',
  },
  WHEAT: {
    id: 'WHEAT',
    group: 'grains',
    name: 'Blé tendre rouge d’hiver',
    short: 'Blé',
    family: 'agri',
    exchange: 'CGX Chicago',
    currency: 'USD',
    priceUnit: 'c/bu',
    qtyUnit: 'bu',
    lot: { kind: 'fixed', qty: 5000 },
    tick: 0.25,
    valuePerUnit: 0.01,
    decimals: 2,
    listing: { kind: 'months', months: [2, 4, 6, 8, 11], count: 7 },
    ltdRule: 'CBOT',
    model: {
      s0: 590,
      chi0: 0.02,
      kappa: 1.1,
      sigmaChi: 0.3,
      sigmaXi: 0.17,
      rho: 0.2,
      longDrift: 0.03,
      seasonalAmp: 0.035,
      seasonalPeak: 1.5,
    },
    liquidity: { halfSpreadTicks: 1, depthLots: 500, commission: 2.5 },
    options: { style: 'A', expiryRule: 'CBOT', strikeStep: 10, months: 5, skew: 0.05, curvature: 0.03, volHalfSpread: 0.008 },
    positionLimits: { spotMonth: 1500, allMonths: 7500 },
    logistics: { tonnesPerUnit: 1 / 36.7437, handlingPerT: 4, transitLoss: 0.002, vessel: (q) => (q * (1 / 36.7437) >= 50_000 ? 'PMX' : 'SMX') },
    settlement: { kind: 'physical', locationId: 'WHT_CHI' },
    physical: {
      cargoSizes: [1_102_300, 2_204_600],
      storagePerUnitMonth: 4,
      spotSpreadPct: 0.005,
      locations: [
        { id: 'WHT_GULF', cityId: 'houston', label: 'FOB US Gulf', incoterm: 'FOB', basisMean: 65, basisVol: 15 , freightLink: { index: 'PMX', perUnit: -20 } },
        { id: 'WHT_CHI', cityId: 'chicago', label: 'Silo Chicago (track)', incoterm: 'FCA', basisMean: 2, basisVol: 10 },
        { id: 'WHT_RTM', cityId: 'rotterdam', label: 'CIF Rotterdam', incoterm: 'CIF', basisMean: 117, basisVol: 20 , freightLink: { index: 'PMX', perUnit: 25 } },
        { id: 'WHT_DXB', cityId: 'dubai', label: 'CFR Golfe Persique', incoterm: 'CFR', basisMean: 152, basisVol: 25 , freightLink: { index: 'PMX', perUnit: 30 } },
      ],
    },
    display: { unit: 't', factor: 1 / 36.7437 },
    color: '#f2c94c',
    icon: '🌾',
    blurb: 'Coté en cents par boisseau. Cinq échéances par an (mars, mai, juil., sept., déc.).',
  },
  API2: {
    id: 'API2',
    group: 'charbon',
    name: 'Charbon thermique API2 (CIF ARA)',
    short: 'Charbon API2',
    family: 'energy',
    exchange: 'ICX Europe',
    currency: 'USD',
    priceUnit: '$/t',
    qtyUnit: 't',
    lot: { kind: 'fixed', qty: 1000 },
    tick: 0.05,
    valuePerUnit: 1,
    decimals: 2,
    listing: { kind: 'monthly', count: 24 },
    ltdRule: 'LAST_FRIDAY',
    model: {
      s0: 112,
      chi0: 0.03,
      kappa: 1.5,
      sigmaChi: 0.4,
      sigmaXi: 0.2,
      rho: 0.25,
      longDrift: -0.01,
      seasonalAmp: 0.05,
      seasonalPeak: 0.5,
    },
    liquidity: { halfSpreadTicks: 3, depthLots: 250, commission: 3 },
    options: { style: 'E', expiryRule: 'WITH_FUTURE', strikeStep: 2, months: 12, skew: 0.04, curvature: 0.03, volHalfSpread: 0.012 },
    positionLimits: { spotMonth: 750, allMonths: 4000 },
    logistics: { tonnesPerUnit: 1, handlingPerT: 2, transitLoss: 0.001, vessel: (q) => (q >= 100_000 ? 'CAPE' : 'PMX') },
    settlement: { kind: 'cash' },
    physical: {
      cargoSizes: [50_000, 75_000],
      storagePerUnitMonth: 0.9,
      spotSpreadPct: 0.006,
      locations: [
        { id: 'COAL_ARA', cityId: 'rotterdam', label: 'CIF ARA', incoterm: 'CIF', basisMean: 0, basisVol: 1.5 , freightLink: { index: 'PMX', perUnit: 8 } },
        { id: 'COAL_RB', cityId: 'johannesburg', label: 'FOB Richards Bay', incoterm: 'FOB', basisMean: -14, basisVol: 4 , freightLink: { index: 'PMX', perUnit: -8 } },
        { id: 'COAL_CN', cityId: 'shanghai', label: 'CFR Chine du Sud', incoterm: 'CFR', basisMean: 5, basisVol: 4 , freightLink: { index: 'PMX', perUnit: 8 } },
      ],
    },
    color: '#9aa4b2',
    icon: '⚫',
    blurb: 'Le charbon livré à Amsterdam-Rotterdam-Anvers. Lié au gaz : quand le gaz flambe, le charbon suit.',
  },
};

// ------------------------------------------------------------------ phase 8 : toutes les familles
type Loc = [id: string, cityId: string, label: string, incoterm: Incoterm, basisMean: number, basisVol: number, freight?: [FreightIndex, number]];
interface Mk {
  id: CommodityId; name: string; short: string; family: CommoditySpec['family']; group: string; exchange: string; currency?: Currency;
  priceUnit: string; qtyUnit: string; lot: number | { mw: number }; tick: number; decimals: number; vpu?: number;
  listing?: CommoditySpec['listing']; ltd: LtdRule; optRule?: OptionExpiryRule; optStyle?: OptStyle;
  /** s0, χ0, κ, σχ, σξ, ρ, pente longue, amplitude saisonnière, mois du pic */
  m: [number, number, number, number, number, number, number, number, number]; shift?: number;
  liq: [number, number, number]; strike: number; skew?: number; curv?: number; volHs?: number; optMonths?: number;
  limits: [number, number]; logi: [number, number, number]; vessel: FreightIndex | ((q: number) => FreightIndex);
  settle?: string; cargo: number[]; storage: number; spread: number; storable?: boolean;
  locs: Loc[]; display?: CommoditySpec['display']; color: string; icon: string; blurb: string;
}

function mk(x: Mk): CommoditySpec {
  const [s0, chi0, kappa, sigmaChi, sigmaXi, rho, longDrift, seasonalAmp, seasonalPeak] = x.m;
  return {
    id: x.id, name: x.name, short: x.short, family: x.family, group: x.group, exchange: x.exchange, currency: x.currency ?? 'USD',
    priceUnit: x.priceUnit, qtyUnit: x.qtyUnit, lot: typeof x.lot === 'number' ? { kind: 'fixed', qty: x.lot } : { kind: 'mwMonth', mw: x.lot.mw },
    tick: x.tick, valuePerUnit: x.vpu ?? 1, decimals: x.decimals, listing: x.listing ?? { kind: 'monthly', count: 18 }, ltdRule: x.ltd,
    model: { s0, chi0, kappa, sigmaChi, sigmaXi, rho, longDrift, seasonalAmp, seasonalPeak, shift: x.shift },
    liquidity: { halfSpreadTicks: x.liq[0], depthLots: x.liq[1], commission: x.liq[2] },
    options: { style: x.optStyle ?? 'E', expiryRule: x.optRule ?? 'WITH_FUTURE', strikeStep: x.strike, months: x.optMonths ?? 12, skew: x.skew ?? 0.02, curvature: x.curv ?? 0.03, volHalfSpread: x.volHs ?? 0.01 },
    positionLimits: { spotMonth: x.limits[0], allMonths: x.limits[1] },
    logistics: { tonnesPerUnit: x.logi[0], handlingPerT: x.logi[1], transitLoss: x.logi[2], vessel: typeof x.vessel === 'function' ? x.vessel : (() => x.vessel as FreightIndex) },
    settlement: x.settle ? { kind: 'physical', locationId: x.settle } : { kind: 'cash' },
    physical: {
      cargoSizes: x.cargo, storagePerUnitMonth: x.storage, spotSpreadPct: x.spread, storable: x.storable,
      locations: x.locs.map(([id, cityId, label, incoterm, basisMean, basisVol, fr]) => ({ id, cityId, label, incoterm, basisMean, basisVol, ...(fr ? { freightLink: { index: fr[0], perUnit: fr[1] } } : {}) })),
    },
    display: x.display, color: x.color, icon: x.icon, blurb: x.blurb,
  };
}

const LB = 2204.62; // livres par tonne
const GRAINS = [2, 4, 6, 8, 11]; // mars, mai, juil., sept., déc.
const tanker = (q: number): FreightIndex => (q >= 450_000 ? 'AFRA' : 'AFRA');
const bulk = (tPerUnit: number) => (q: number): FreightIndex => (q * tPerUnit >= 100_000 ? 'CAPE' : q * tPerUnit >= 50_000 ? 'PMX' : 'SMX');

const EXTRA: CommoditySpec[] = [
  // ---------------------------------------------------------------- énergie : bruts
  mk({ id: 'WTI', name: 'WTI (brut léger américain, Cushing)', short: 'WTI', family: 'energy', group: 'brut', exchange: 'NYMX New York', priceUnit: '$/bbl', qtyUnit: 'bbl', lot: 1000, tick: 0.01, decimals: 2,
    listing: { kind: 'monthly', count: 24 }, ltd: 'WTI', optStyle: 'A', m: [74, 0.03, 1.5, 0.24, 0.12, 0.3, -0.02, 0.012, 6.5], shift: 20,
    liq: [1, 900, 2.5], strike: 1, skew: -0.06, curv: 0.03, volHs: 0.006, limits: [3000, 15000], logi: [0.1364, 0.4, 0.0015], vessel: tanker, settle: 'WTI_CUS',
    cargo: [300_000, 600_000], storage: 0.6, spread: 0.004,
    locs: [['WTI_CUS', 'houston', 'Cushing (Oklahoma, enclavé)', 'FCA', 0, 0.8], ['WTI_HOU', 'houston', 'FOB Houston (MEH)', 'FOB', 0.9, 0.7, ['AFRA', -1.2]], ['WTI_RTM', 'rotterdam', 'CIF Rotterdam (WTI Midland)', 'CIF', 3.2, 1.0, ['AFRA', 1.4]]],
    color: '#ffb37a', icon: '🛢️', blurb: 'Le brut américain, livré dans les cuves enclavées de Cushing : quand elles débordent, le prix peut devenir négatif.' }),
  mk({ id: 'DUBAI', name: 'Dubaï / Oman (brut moyen soufré)', short: 'Dubaï', family: 'energy', group: 'brut', exchange: 'ICX Singapour', priceUnit: '$/bbl', qtyUnit: 'bbl', lot: 1000, tick: 0.01, decimals: 2,
    listing: { kind: 'monthly', count: 18 }, ltd: 'BRENT', m: [76, 0.04, 1.4, 0.27, 0.16, 0.3, -0.02, 0.01, 6.5], liq: [2, 1000, 3], strike: 1, skew: -0.05, volHs: 0.008,
    limits: [1500, 8000], logi: [0.1364, 0.4, 0.0015], vessel: tanker, cargo: [500_000, 1_000_000], storage: 0.45, spread: 0.005,
    locs: [['DUB_FUJ', 'dubai', 'FOB Fujairah', 'FOB', 0, 0.9, ['AFRA', -1.0]], ['DUB_MCT', 'muscat', 'FOB Mina al-Fahal (Oman)', 'FOB', 0.3, 0.8, ['AFRA', -1.0]], ['DUB_SIN', 'singapore', 'CFR Singapour', 'CFR', 1.5, 1.0, ['AFRA', 1.0]], ['DUB_TKY', 'tokyo', 'CFR Japon', 'CFR', 2.2, 1.1, ['AFRA', 1.3]]],
    color: '#c2410c', icon: '🛢️', blurb: 'Le brut soufré du Golfe, référence des raffineurs asiatiques. Le spread Brent-Dubaï mesure la prime de qualité.' }),
  // ---------------------------------------------------------------- produits raffinés ($/t)
  mk({ id: 'GASOIL', name: 'Gazole 10 ppm (barges ARA)', short: 'Gasoil', family: 'energy', group: 'produits', exchange: 'ICX Europe', priceUnit: '$/t', qtyUnit: 't', lot: 100, tick: 0.25, decimals: 2,
    listing: { kind: 'monthly', count: 24 }, ltd: 'GASOIL', m: [720, 0.03, 1.3, 0.3, 0.15, 0.3, -0.02, 0.03, 0.5], liq: [1, 700, 3], strike: 10, skew: -0.03, volHs: 0.008,
    limits: [2000, 10000], logi: [1, 3, 0.002], vessel: 'AFRA', settle: 'GO_ARA', cargo: [30_000, 60_000], storage: 6, spread: 0.004,
    locs: [['GO_ARA', 'rotterdam', 'FOB barges ARA', 'FOB', 0, 8], ['GO_USGC', 'houston', 'FOB US Gulf', 'FOB', -18, 10, ['AFRA', -18]], ['GO_SIN', 'singapore', 'FOB Singapour', 'FOB', -12, 9, ['AFRA', -14]], ['GO_LAG', 'lagos', 'CIF Afrique de l’Ouest', 'CIF', 38, 15, ['AFRA', 20]]],
    color: '#facc15', icon: '⛽', blurb: 'Diesel, fioul domestique, kérosène de base : le produit le plus échangé du monde. Hiver = demande de chauffage.' }),
  mk({ id: 'GASOLINE', name: 'Essence Eurobob (barges ARA)', short: 'Essence', family: 'energy', group: 'produits', exchange: 'ICX Europe', priceUnit: '$/t', qtyUnit: 't', lot: 100, tick: 0.25, decimals: 2,
    ltd: 'LAST_FRIDAY', m: [830, 0.02, 1.4, 0.32, 0.15, 0.3, -0.02, 0.06, 6], liq: [2, 450, 3], strike: 10, volHs: 0.01, limits: [1000, 5000], logi: [1, 3, 0.003], vessel: 'AFRA',
    cargo: [25_000, 37_000], storage: 7, spread: 0.005,
    locs: [['GL_ARA', 'rotterdam', 'FOB barges ARA', 'FOB', 0, 10], ['GL_NYH', 'newyork', 'CIF port de New York', 'CIF', 28, 14, ['AFRA', 22]], ['GL_SIN', 'singapore', 'FOB Singapour (92 RON)', 'FOB', -22, 12, ['AFRA', -14]], ['GL_LAG', 'lagos', 'CIF Lagos', 'CIF', 45, 18, ['AFRA', 20]]],
    color: '#fde047', icon: '🚗', blurb: 'L’essence européenne, exportée vers New York et l’Afrique. Saison de conduite l’été.' }),
  mk({ id: 'JET', name: 'Kérosène Jet A-1 (CIF NWE)', short: 'Jet', family: 'energy', group: 'produits', exchange: 'ICX Europe', priceUnit: '$/t', qtyUnit: 't', lot: 100, tick: 0.25, decimals: 2,
    ltd: 'LAST_FRIDAY', m: [790, 0.03, 1.3, 0.33, 0.16, 0.3, -0.02, 0.02, 7], liq: [2, 600, 3], strike: 10, volHs: 0.012, limits: [800, 4000], logi: [1, 3, 0.002], vessel: 'AFRA',
    cargo: [30_000, 60_000], storage: 7, spread: 0.006,
    locs: [['JET_NWE', 'rotterdam', 'CIF Europe du Nord-Ouest', 'CIF', 0, 10], ['JET_FUJ', 'dubai', 'FOB Golfe Arabique', 'FOB', -32, 12, ['AFRA', -24]], ['JET_SIN', 'singapore', 'FOB Singapour', 'FOB', -24, 11, ['AFRA', -14]], ['JET_LDN', 'london', 'Aéroports de Londres (DAP)', 'DAP', 18, 9]],
    color: '#93c5fd', icon: '✈️', blurb: 'Le carburant des avions : effondré en pandémie, tendu l’été.' }),
  mk({ id: 'FUELOIL', name: 'Fioul lourd 3,5 % (barges Rotterdam)', short: 'Fioul', family: 'energy', group: 'produits', exchange: 'ICX Europe', priceUnit: '$/t', qtyUnit: 't', lot: 100, tick: 0.25, decimals: 2,
    ltd: 'LAST_FRIDAY', m: [460, 0.02, 1.2, 0.33, 0.16, 0.3, -0.02, 0, 0], liq: [1, 800, 3], strike: 10, volHs: 0.01, limits: [1000, 5000], logi: [1, 2.5, 0.002], vessel: 'AFRA',
    cargo: [40_000, 80_000], storage: 5, spread: 0.005,
    locs: [['FO_RTM', 'rotterdam', 'FOB barges Rotterdam', 'FOB', 0, 9], ['FO_SIN', 'singapore', 'Soutes Singapour (DAP)', 'DAP', 14, 10, ['AFRA', 12]], ['FO_FUJ', 'dubai', 'Soutes Fujairah (DAP)', 'DAP', 6, 10]],
    color: '#57534e', icon: '🛳️', blurb: 'Le fond du baril : soutes des navires et centrales. Les soutes du jeu suivent ce prix.' }),
  // ---------------------------------------------------------------- gaz et GNL
  mk({ id: 'HH', name: 'Gaz naturel Henry Hub', short: 'Henry Hub', family: 'energy', group: 'gaz', exchange: 'NYMX New York', priceUnit: '$/MMBtu', qtyUnit: 'MMBtu', lot: 10_000, tick: 0.001, decimals: 3,
    listing: { kind: 'monthly', count: 24 }, ltd: 'TTF', m: [3.2, 0, 2.5, 0.6, 0.25, 0.2, 0.01, 0.12, 0.5], liq: [2, 900, 2.5], strike: 0.1, skew: 0.05, curv: 0.04, volHs: 0.012,
    limits: [2000, 12000], logi: [0, 0, 0], vessel: 'AFRA', settle: 'HH_HUB', cargo: [500_000, 1_000_000, 2_000_000], storage: 0.06, spread: 0.006,
    locs: [['HH_HUB', 'houston', 'Henry Hub (Louisiane)', 'HUB', 0, 0.15], ['HH_CHI', 'chicago', 'Chicago Citygate', 'HUB', 0.25, 0.3], ['HH_NY', 'newyork', 'Transco Zone 6 (New York)', 'HUB', 0.9, 0.9], ['HH_CAL', 'calgary', 'AECO (Alberta)', 'HUB', -1.0, 0.35]],
    color: '#38bdf8', icon: '🔥', blurb: 'Le gaz américain, abondant et bon marché grâce au schiste. Il alimente les usines de GNL du Golfe.' }),
  mk({ id: 'JKM', name: 'GNL Japon-Corée (JKM)', short: 'GNL JKM', family: 'energy', group: 'gaz', exchange: 'ICX Singapour', priceUnit: '$/MMBtu', qtyUnit: 'MMBtu', lot: 10_000, tick: 0.005, decimals: 3,
    ltd: 'TTF', m: [11.5, 0.02, 2.2, 0.55, 0.22, 0.2, -0.03, 0.12, 0.5], liq: [2, 400, 3], strike: 0.25, skew: 0.06, curv: 0.04, volHs: 0.015,
    limits: [600, 3000], logi: [1 / 52, 4, 0.004], vessel: 'LNGC', cargo: [3_400_000], storage: 0.35, spread: 0.008,
    locs: [['JKM_TKY', 'tokyo', 'DES baie de Tokyo', 'DES', 0, 0.6, ['LNGC', 0.5]], ['JKM_SHA', 'shanghai', 'DES Chine', 'DES', -0.2, 0.7, ['LNGC', 0.5]], ['JKM_SAB', 'houston', 'FOB Sabine Pass (GNL américain)', 'FOB', -2.8, 0.8, ['LNGC', -1.0]], ['JKM_RAS', 'doha', 'FOB Ras Laffan', 'FOB', -1.3, 0.7, ['LNGC', -0.7]], ['JKM_RTM', 'rotterdam', 'DES Gate Rotterdam', 'DES', -1.0, 0.9, ['LNGC', 0.3]]],
    color: '#22d3ee', icon: '🧊', blurb: 'Le gaz liquéfié transporté par méthanier. L’arbitrage entre Henry Hub, l’Europe et l’Asie fait la fortune des portefeuilles de GNL.' }),
  // ---------------------------------------------------------------- électricité et carbone (EUR)
  mk({ id: 'POWER', name: 'Électricité allemande en base (EEX)', short: 'Électricité', family: 'energy', group: 'électricité', exchange: 'EEX Leipzig', currency: 'EUR', priceUnit: '€/MWh', qtyUnit: 'MWh', lot: { mw: 1 }, tick: 0.01, decimals: 2,
    ltd: 'TTF', m: [85, 0, 6, 0.8, 0.22, 0.2, -0.02, 0.12, 0.5], liq: [5, 250, 3], strike: 2, skew: 0.08, curv: 0.05, volHs: 0.015, limits: [900, 5000], logi: [0, 0, 0], vessel: 'AFRA',
    cargo: [10_000, 20_000, 40_000], storage: 0, spread: 0.008, storable: false,
    locs: [['PWR_DE', 'frankfurt', 'Zone Allemagne-Luxembourg', 'HUB', 0, 2], ['PWR_FR', 'paris', 'Zone France', 'HUB', 4, 7], ['PWR_NL', 'rotterdam', 'Zone Pays-Bas', 'HUB', 2, 3], ['PWR_PL', 'warsaw', 'Zone Pologne', 'HUB', 8, 6]],
    color: '#a78bfa', icon: '⚡', blurb: 'Non stockable : produite et consommée à la seconde près. Le prix suit le gaz, le charbon et le carbone (spark et dark spreads).' }),
  mk({ id: 'EUA', name: 'Quotas carbone européens (EUA)', short: 'Carbone EUA', family: 'energy', group: 'carbone', exchange: 'ICX Endex', currency: 'EUR', priceUnit: '€/t CO₂', qtyUnit: 't CO₂', lot: 1000, tick: 0.01, decimals: 2,
    listing: { kind: 'months', months: [2, 5, 8, 11], count: 6 }, ltd: 'LAST_FRIDAY', m: [75, 0, 0.8, 0.3, 0.2, 0.2, 0.03, 0, 0], liq: [2, 500, 2], strike: 2, volHs: 0.01,
    limits: [2000, 10000], logi: [0, 0, 0], vessel: 'AFRA', settle: 'EUA_REG', cargo: [50_000, 100_000, 250_000], storage: 0, spread: 0.003,
    locs: [['EUA_REG', 'london', 'Registre de l’Union (livraison)', 'HUB', 0, 0.1], ['EUA_FRA', 'frankfurt', 'Enchères primaires (EEX)', 'HUB', -0.4, 0.3]],
    color: '#4ade80', icon: '🌍', blurb: 'Le droit d’émettre une tonne de CO₂ en Europe. Une décision politique peut le faire bondir ou s’effondrer.' }),
  // ---------------------------------------------------------------- charbons
  mk({ id: 'NEWC', name: 'Charbon thermique Newcastle (FOB)', short: 'Charbon Newcastle', family: 'energy', group: 'charbon', exchange: 'ICX Singapour', priceUnit: '$/t', qtyUnit: 't', lot: 1000, tick: 0.05, decimals: 2,
    ltd: 'LAST_FRIDAY', m: [135, 0.03, 1.4, 0.42, 0.2, 0.25, -0.01, 0.04, 0.5], liq: [2, 250, 3], strike: 2, volHs: 0.012, limits: [600, 3000], logi: [1, 2, 0.001], vessel: bulk(1),
    cargo: [70_000, 150_000], storage: 0.9, spread: 0.006,
    locs: [['NEWC_FOB', 'sydney', 'FOB Newcastle', 'FOB', 0, 4, ['PMX', -9]], ['NEWC_JP', 'tokyo', 'CFR Japon', 'CFR', 12, 4, ['PMX', 9]], ['NEWC_CN', 'shanghai', 'CFR Chine du Sud', 'CFR', 9, 5, ['PMX', 8]], ['NEWC_IN', 'mumbai', 'CFR Inde', 'CFR', 14, 6, ['PMX', 10]]],
    color: '#6b7280', icon: '⚫', blurb: 'Le charbon de haute qualité du Pacifique : Japon, Corée, Chine.' }),
  mk({ id: 'METCOAL', name: 'Charbon métallurgique (FOB Australie)', short: 'Charbon coke', family: 'energy', group: 'charbon', exchange: 'SGX Singapour', priceUnit: '$/t', qtyUnit: 't', lot: 1000, tick: 0.05, decimals: 2,
    ltd: 'LAST_FRIDAY', m: [240, 0.02, 1.2, 0.45, 0.22, 0.25, -0.01, 0, 0], liq: [4, 180, 4], strike: 5, volHs: 0.015, limits: [300, 1500], logi: [1, 2.5, 0.001], vessel: bulk(1),
    cargo: [70_000, 150_000], storage: 1, spread: 0.008,
    locs: [['MC_FOB', 'sydney', 'FOB Queensland', 'FOB', 0, 8, ['PMX', -10]], ['MC_CN', 'shanghai', 'CFR Chine', 'CFR', 14, 10, ['PMX', 9]], ['MC_IN', 'mumbai', 'CFR Inde', 'CFR', 20, 10, ['PMX', 11]], ['MC_VAN', 'vancouver', 'FOB Vancouver', 'FOB', -6, 9, ['PMX', -9]]],
    color: '#44403c', icon: '🏗️', blurb: 'Le charbon à coke des hauts-fourneaux : il suit l’acier plus que l’énergie.' }),
  // ---------------------------------------------------------------- métaux de base (logique LME)
  mk({ id: 'AL', name: 'Aluminium primaire', short: 'Aluminium', family: 'metals', group: 'base', exchange: 'LMM Londres', priceUnit: '$/t', qtyUnit: 't', lot: 25, tick: 0.5, decimals: 1,
    ltd: 'LME', optRule: 'LME', m: [2450, -0.01, 0.9, 0.16, 0.14, 0.25, 0.03, 0, 0], liq: [3, 700, 6], strike: 50, skew: -0.02, volHs: 0.006, limits: [2000, 10000], logi: [1, 45, 0], vessel: 'SMX', settle: 'AL_RTM',
    cargo: [1000, 2500, 5000], storage: 16, spread: 0.003,
    locs: [['AL_RTM', 'rotterdam', 'Entrepôt Rotterdam (dédouané)', 'DAP', 250, 60], ['AL_SHA', 'shanghai', 'CIF Shanghai', 'CIF', 110, 40, ['SMX', 15]], ['AL_TKY', 'tokyo', 'CIF Japon (prime MJP)', 'CIF', 180, 50, ['SMX', 14]], ['AL_DXB', 'dubai', 'FOB Jebel Ali', 'FOB', -30, 30, ['SMX', -12]]],
    color: '#cbd5e1', icon: '🥫', blurb: 'De l’électricité solidifiée : un tiers du coût de production est l’énergie. Les primes physiques régionales comptent autant que le LMM.' }),
  mk({ id: 'ZN', name: 'Zinc spécial haute qualité', short: 'Zinc', family: 'metals', group: 'base', exchange: 'LMM Londres', priceUnit: '$/t', qtyUnit: 't', lot: 25, tick: 0.5, decimals: 1,
    ltd: 'LME', optRule: 'LME', m: [2700, 0, 0.9, 0.2, 0.15, 0.25, 0.02, 0, 0], liq: [3, 400, 6], strike: 50, volHs: 0.008, limits: [1200, 6000], logi: [1, 45, 0], vessel: 'SMX', settle: 'ZN_RTM',
    cargo: [500, 1000, 2000], storage: 16, spread: 0.004,
    locs: [['ZN_RTM', 'rotterdam', 'Entrepôt Rotterdam', 'DAP', 120, 40], ['ZN_SHA', 'shanghai', 'CIF Shanghai', 'CIF', 100, 45, ['SMX', 15]], ['ZN_LIM', 'lima', 'FOB Callao', 'FOB', -50, 30, ['SMX', -15]]],
    color: '#94a3b8', icon: '🔩', blurb: 'La galvanisation de l’acier : très lié à la construction chinoise.' }),
  mk({ id: 'NI', name: 'Nickel primaire', short: 'Nickel', family: 'metals', group: 'batterie', exchange: 'LMM Londres', priceUnit: '$/t', qtyUnit: 't', lot: 6, tick: 5, decimals: 0,
    ltd: 'LME', optRule: 'LME', m: [17_000, 0, 1, 0.3, 0.2, 0.25, 0.01, 0, 0], liq: [3, 300, 8], strike: 250, skew: 0.04, curv: 0.04, volHs: 0.01, limits: [800, 4000], logi: [1, 50, 0], vessel: 'SMX', settle: 'NI_RTM',
    cargo: [120, 300, 600], storage: 18, spread: 0.005,
    locs: [['NI_RTM', 'rotterdam', 'Entrepôt Rotterdam', 'DAP', 400, 120], ['NI_SHA', 'shanghai', 'CIF Shanghai', 'CIF', 300, 150, ['SMX', 15]], ['NI_JKT', 'jakarta', 'FOB Insulinde (fonte de nickel)', 'FOB', -900, 300, ['SMX', -15]], ['NI_MNL', 'manila', 'FOB Philippines (équiv. métal)', 'FOB', -700, 280, ['SMX', -15]]],
    color: '#a3e635', icon: '🔋', blurb: 'Acier inoxydable et batteries. Petit marché, positions concentrées : squeezes historiques.' }),
  mk({ id: 'PB', name: 'Plomb', short: 'Plomb', family: 'metals', group: 'base', exchange: 'LMM Londres', priceUnit: '$/t', qtyUnit: 't', lot: 25, tick: 0.5, decimals: 1,
    ltd: 'LME', optRule: 'LME', m: [2100, 0, 0.9, 0.18, 0.14, 0.25, 0.01, 0, 0], liq: [4, 200, 6], strike: 50, volHs: 0.01, limits: [600, 3000], logi: [1, 45, 0], vessel: 'SMX', settle: 'PB_RTM',
    cargo: [500, 1000], storage: 15, spread: 0.005,
    locs: [['PB_RTM', 'rotterdam', 'Entrepôt Rotterdam', 'DAP', 100, 30], ['PB_SHA', 'shanghai', 'CIF Shanghai', 'CIF', 60, 35, ['SMX', 15]], ['PB_MEX', 'mexicocity', 'FOB Manzanillo', 'FOB', -40, 25, ['SMX', -15]]],
    color: '#64748b', icon: '⚙️', blurb: 'Batteries au plomb : un marché mûr, recyclé à plus de moitié.' }),
  mk({ id: 'SN', name: 'Étain', short: 'Étain', family: 'metals', group: 'base', exchange: 'LMM Londres', priceUnit: '$/t', qtyUnit: 't', lot: 5, tick: 5, decimals: 0,
    ltd: 'LME', optRule: 'LME', m: [30_000, 0.01, 1, 0.26, 0.18, 0.25, 0.02, 0, 0], liq: [4, 100, 10], strike: 500, volHs: 0.012, limits: [300, 1500], logi: [1, 60, 0], vessel: 'SMX', settle: 'SN_RTM',
    cargo: [50, 100, 250], storage: 20, spread: 0.006,
    locs: [['SN_RTM', 'rotterdam', 'Entrepôt Rotterdam', 'DAP', 600, 200], ['SN_KL', 'kualalumpur', 'FOB Port Klang', 'FOB', -200, 180, ['SMX', -15]], ['SN_JKT', 'jakarta', 'FOB Insulinde (Bangka)', 'FOB', -350, 220, ['SMX', -15]]],
    color: '#e5e7eb', icon: '🥈', blurb: 'La soudure de l’électronique. Production concentrée, interdictions d’export fréquentes.' }),
  mk({ id: 'CO', name: 'Cobalt métal', short: 'Cobalt', family: 'metals', group: 'batterie', exchange: 'LMM Londres', priceUnit: '$/t', qtyUnit: 't', lot: 1, tick: 5, decimals: 0,
    ltd: 'LME', optRule: 'LME', m: [33_000, 0, 0.7, 0.35, 0.25, 0.2, 0, 0, 0], liq: [6, 100, 12], strike: 1000, volHs: 0.02, limits: [150, 600], logi: [1, 80, 0], vessel: 'SMX',
    cargo: [20, 50, 100], storage: 25, spread: 0.01,
    locs: [['CO_RTM', 'rotterdam', 'Entrepôt Rotterdam', 'DAP', 500, 400], ['CO_DUR', 'johannesburg', 'FOB Durban', 'FOB', -1500, 600, ['SMX', -20]], ['CO_LUB', 'lubumbashi', 'FCA Katanga (Kassaï)', 'FCA', -3200, 1500]],
    color: '#2563eb', icon: '🔷', blurb: 'Cathodes de batteries : 70 % vient du Kassaï. Marché opaque, risques éthiques et politiques.' }),
  mk({ id: 'LI', name: 'Hydroxyde de lithium (CIF Asie)', short: 'Lithium', family: 'metals', group: 'batterie', exchange: 'CMX Chicago', priceUnit: '$/t', qtyUnit: 't', lot: 1, tick: 10, decimals: 0,
    ltd: 'LAST_FRIDAY', m: [14_000, -0.05, 0.7, 0.45, 0.3, 0.2, 0.02, 0, 0], liq: [3, 120, 12], strike: 500, skew: 0.05, volHs: 0.02, limits: [150, 600], logi: [1, 80, 0], vessel: 'SMX',
    cargo: [20, 50, 100], storage: 20, spread: 0.01,
    locs: [['LI_SHA', 'shanghai', 'CIF Chine', 'CIF', 0, 600, ['SMX', 15]], ['LI_SCL', 'santiago', 'FOB Chili (carbonate, équiv.)', 'FOB', -1600, 800, ['SMX', -15]], ['LI_PER', 'perth', 'FOB Australie (équiv. hydroxyde)', 'FOB', -2400, 900, ['SMX', -15]], ['LI_TKY', 'tokyo', 'CIF Japon/Corée', 'CIF', 300, 600, ['SMX', 14]]],
    color: '#f0abfc', icon: '🪫', blurb: 'Le métal des voitures électriques : des envolées et des effondrements de 80 % en quelques mois.' }),
  // ---------------------------------------------------------------- précieux
  mk({ id: 'AU', name: 'Or (loco Londres)', short: 'Or', family: 'metals', group: 'précieux', exchange: 'CMX New York', priceUnit: '$/oz', qtyUnit: 'oz', lot: 100, tick: 0.1, decimals: 1,
    listing: { kind: 'monthly', count: 12 }, ltd: 'LAST_FRIDAY', m: [2350, 0, 0.5, 0.05, 0.15, 0, 0.035, 0, 0], liq: [2, 1500, 2], strike: 25, skew: 0.02, curv: 0.02, volHs: 0.004, limits: [6000, 30000],
    logi: [1 / 32_150.7, 2000, 0], vessel: 'SMX', settle: 'AU_LDN', cargo: [5_000, 10_000, 30_000], storage: 0.12, spread: 0.0015,
    locs: [['AU_LDN', 'london', 'Loco Londres (coffres)', 'HUB', 0, 0.8], ['AU_LUG', 'lugano', 'Raffinerie suisse (lingots 1 kg)', 'DAP', 1.5, 0.6], ['AU_HK', 'hongkong', 'Hong Kong (prime d’import)', 'DAP', 2.5, 2], ['AU_DXB', 'dubai', 'Souk de Dubaï', 'DAP', -1.5, 2], ['AU_MUM', 'mumbai', 'Mumbai (prime indienne)', 'DAP', 4, 5]],
    color: '#fbbf24', icon: '🥇', blurb: 'Valeur refuge : il monte quand le monde a peur. Sa courbe forward est un pur portage financier.' }),
  mk({ id: 'AG', name: 'Argent (loco Londres)', short: 'Argent', family: 'metals', group: 'précieux', exchange: 'CMX New York', priceUnit: '$/oz', qtyUnit: 'oz', lot: 5000, tick: 0.005, decimals: 3,
    listing: { kind: 'monthly', count: 12 }, ltd: 'LAST_FRIDAY', m: [28, 0, 0.6, 0.1, 0.25, 0.1, 0.035, 0, 0], liq: [2, 600, 2.5], strike: 0.5, volHs: 0.008, limits: [3000, 15000],
    logi: [1 / 32_150.7, 1500, 0], vessel: 'SMX', settle: 'AG_LDN', cargo: [250_000, 500_000, 1_000_000], storage: 0.004, spread: 0.002,
    locs: [['AG_LDN', 'london', 'Loco Londres', 'HUB', 0, 0.05], ['AG_NY', 'newyork', 'Entrepôts New York', 'HUB', 0.05, 0.06], ['AG_SHA', 'shanghai', 'Shanghai', 'DAP', 0.3, 0.2], ['AG_MEX', 'mexicocity', 'Fonderies mexicaines (FCA)', 'FCA', -0.2, 0.1]],
    color: '#d1d5db', icon: '🥈', blurb: 'Métal précieux et industriel (solaire) : plus volatil que l’or.' }),
  mk({ id: 'FE', name: 'Minerai de fer 62 % Fe (CFR Chine)', short: 'Minerai de fer', family: 'metals', group: 'ferreux', exchange: 'SGX Singapour', priceUnit: '$/t', qtyUnit: 't', lot: 100, tick: 0.05, decimals: 2,
    listing: { kind: 'monthly', count: 18 }, ltd: 'LAST_FRIDAY', m: [112, 0.02, 1.5, 0.38, 0.2, 0.25, -0.02, 0.03, 3], liq: [2, 1800, 2], strike: 2, volHs: 0.01, limits: [3000, 15000], logi: [1, 1.5, 0.001], vessel: 'CAPE',
    cargo: [170_000], storage: 0.6, spread: 0.004,
    locs: [['FE_CN', 'dalian', 'CFR Qingdao', 'CFR', 0, 3, ['CAPE', 9]], ['FE_PHED', 'perth', 'FOB Port Hedland', 'FOB', -10, 3, ['CAPE', -9]], ['FE_BR', 'saopaulo', 'FOB Tubarão (Brésil)', 'FOB', -21, 4, ['CAPE', -20]], ['FE_SA', 'johannesburg', 'FOB Saldanha', 'FOB', -17, 4, ['CAPE', -15]]],
    color: '#b45309', icon: '⛰️', blurb: 'La matière première de l’acier chinois. Capesize, Pilbara et Brésil : le fret pèse lourd.' }),
  // ---------------------------------------------------------------- grains et oléagineux (c/bu)
  mk({ id: 'CORN', name: 'Maïs jaune n° 2', short: 'Maïs', family: 'agri', group: 'grains', exchange: 'CGX Chicago', priceUnit: 'c/bu', qtyUnit: 'bu', lot: 5000, tick: 0.25, decimals: 2, vpu: 0.01,
    listing: { kind: 'months', months: GRAINS, count: 7 }, ltd: 'CBOT', optRule: 'CBOT', optStyle: 'A', optMonths: 5, m: [450, 0.02, 1.1, 0.3, 0.16, 0.2, 0.03, 0.04, 6], liq: [1, 900, 2.5], strike: 10, skew: 0.06, volHs: 0.008,
    limits: [3000, 15000], logi: [1 / 39.368, 4, 0.002], vessel: bulk(1 / 39.368), settle: 'CORN_CHI', cargo: [1_968_400, 2_952_600], storage: 3.5, spread: 0.005,
    locs: [['CORN_CHI', 'chicago', 'Silo Chicago (track)', 'FCA', 0, 10], ['CORN_GULF', 'houston', 'FOB US Gulf', 'FOB', 80, 15, ['PMX', -18]], ['CORN_BR', 'saopaulo', 'FOB Santos', 'FOB', 55, 20, ['PMX', -20]], ['CORN_CN', 'dalian', 'CFR Chine du Nord', 'CFR', 140, 25, ['PMX', 22]], ['CORN_MX', 'mexicocity', 'Rail Mexique (DAP)', 'DAP', 95, 15]],
    display: { unit: 't', factor: 1 / 39.368 }, color: '#facc15', icon: '🌽', blurb: 'Alimentation animale et éthanol : le grain le plus produit du monde.' }),
  mk({ id: 'SOY', name: 'Soja n° 1', short: 'Soja', family: 'agri', group: 'oléagineux', exchange: 'CGX Chicago', priceUnit: 'c/bu', qtyUnit: 'bu', lot: 5000, tick: 0.25, decimals: 2, vpu: 0.01,
    listing: { kind: 'months', months: [0, 2, 4, 6, 7, 8, 10], count: 8 }, ltd: 'CBOT', optRule: 'CBOT', optStyle: 'A', optMonths: 6, m: [1180, 0.02, 1, 0.25, 0.15, 0.2, 0.02, 0.03, 6], liq: [1, 800, 2.5], strike: 20, skew: 0.05, volHs: 0.008,
    limits: [2000, 10000], logi: [1 / 36.744, 4, 0.002], vessel: bulk(1 / 36.744), settle: 'SOY_CHI', cargo: [2_204_600, 2_755_800], storage: 4, spread: 0.005,
    locs: [['SOY_CHI', 'chicago', 'Silo Chicago (track)', 'FCA', 0, 12], ['SOY_GULF', 'houston', 'FOB US Gulf', 'FOB', 75, 18, ['PMX', -20]], ['SOY_BR', 'saopaulo', 'FOB Paranaguá', 'FOB', 40, 25, ['PMX', -22]], ['SOY_AR', 'buenosaires', 'FOB Up River (Paraná)', 'FOB', 20, 25, ['PMX', -22]], ['SOY_CN', 'dalian', 'CFR Chine', 'CFR', 150, 25, ['PMX', 24]]],
    display: { unit: 't', factor: 1 / 36.744 }, color: '#a3a957', icon: '🫘', blurb: 'La Chine achète 60 % du soja mondial. Triturée, la graine donne de la farine et de l’huile (le crush).' }),
  mk({ id: 'SOYMEAL', name: 'Farine de soja 48 %', short: 'Farine de soja', family: 'agri', group: 'oléagineux', exchange: 'CGX Chicago', priceUnit: '$/st', qtyUnit: 'st', lot: 100, tick: 0.1, decimals: 1,
    listing: { kind: 'months', months: [0, 2, 4, 6, 7, 8, 9, 11], count: 8 }, ltd: 'CBOT', optRule: 'CBOT', optStyle: 'A', optMonths: 6, m: [360, 0.02, 1.1, 0.27, 0.16, 0.2, 0.02, 0.02, 6], liq: [2, 650, 2.5], strike: 5, volHs: 0.01,
    limits: [1500, 7500], logi: [0.907185, 4, 0.002], vessel: bulk(0.907185), settle: 'SM_CHI', cargo: [30_000, 60_000], storage: 3, spread: 0.006,
    locs: [['SM_CHI', 'chicago', 'Usines de trituration (Illinois)', 'FCA', 0, 6], ['SM_AR', 'buenosaires', 'FOB Up River', 'FOB', 2, 8, ['PMX', -15]], ['SM_RTM', 'rotterdam', 'CIF Rotterdam', 'CIF', 45, 10, ['PMX', 18]], ['SM_HCM', 'hochiminh', 'CFR Viêt Nam', 'CFR', 50, 12, ['PMX', 18]]],
    color: '#c2a35a', icon: '🐄', blurb: 'La protéine de l’élevage mondial. L’Argentine en est le premier exportateur.' }),
  mk({ id: 'SOYOIL', name: 'Huile de soja', short: 'Huile de soja', family: 'agri', group: 'oléagineux', exchange: 'CGX Chicago', priceUnit: 'c/lb', qtyUnit: 'lb', lot: 60_000, tick: 0.01, decimals: 2, vpu: 0.01,
    listing: { kind: 'months', months: [0, 2, 4, 6, 7, 8, 9, 11], count: 8 }, ltd: 'CBOT', optRule: 'CBOT', optStyle: 'A', optMonths: 6, m: [44, 0.02, 1.1, 0.3, 0.18, 0.2, 0.02, 0, 0], liq: [2, 1100, 2.5], strike: 1, volHs: 0.01,
    limits: [1500, 7500], logi: [1 / LB, 5, 0.002], vessel: 'SMX', settle: 'SO_CHI', cargo: [44_092_000, 66_138_000], storage: 0.35, spread: 0.006,
    locs: [['SO_CHI', 'chicago', 'Usines de trituration (Illinois)', 'FCA', 0, 1], ['SO_AR', 'buenosaires', 'FOB Up River', 'FOB', -1.5, 1.5, ['SMX', -1]], ['SO_MUM', 'mumbai', 'CFR Inde', 'CFR', 4, 2, ['SMX', 1.2]]],
    display: { unit: 't', factor: 1 / LB }, color: '#eab308', icon: '🫗', blurb: 'Cuisine et biodiesel : de plus en plus lié au prix du gazole.' }),
  mk({ id: 'RICE', name: 'Riz paddy (Arkansas)', short: 'Riz', family: 'agri', group: 'grains', exchange: 'CGX Chicago', priceUnit: '$/cwt', qtyUnit: 'cwt', lot: 2000, tick: 0.005, decimals: 3,
    listing: { kind: 'months', months: [0, 2, 4, 6, 8, 10], count: 6 }, ltd: 'CBOT', optRule: 'CBOT', optStyle: 'A', optMonths: 4, m: [17, 0.02, 1, 0.22, 0.14, 0.2, 0.02, 0.03, 8], liq: [3, 350, 3], strike: 0.5, volHs: 0.015,
    limits: [300, 1500], logi: [0.0453592, 5, 0.003], vessel: 'SMX', settle: 'RICE_ARK', cargo: [400_000, 800_000], storage: 0.25, spread: 0.01,
    locs: [['RICE_ARK', 'houston', 'Silo Arkansas (track)', 'FCA', 0, 0.5], ['RICE_BKK', 'bangkok', 'FOB Bangkok (équiv. paddy)', 'FOB', 1.8, 1.5, ['SMX', -0.6]], ['RICE_HCM', 'hochiminh', 'FOB Hô Chi Minh', 'FOB', 1.2, 1.4, ['SMX', -0.6]], ['RICE_LAG', 'lagos', 'CFR Lagos', 'CFR', 4.5, 2, ['SMX', 0.8]]],
    color: '#fef3c7', icon: '🍚', blurb: 'Nourriture de la moitié de l’humanité, peu échangée : les interdictions d’export font les prix.' }),
  // ---------------------------------------------------------------- softs
  mk({ id: 'SUGAR', name: 'Sucre brut n° 11', short: 'Sucre', family: 'agri', group: 'softs', exchange: 'ICX US', priceUnit: 'c/lb', qtyUnit: 'lb', lot: 112_000, tick: 0.01, decimals: 2, vpu: 0.01,
    listing: { kind: 'months', months: [2, 4, 6, 9], count: 6 }, ltd: 'ICE_SOFTS', m: [21, 0.02, 1, 0.3, 0.18, 0.2, 0, 0.03, 3], liq: [1, 700, 2.5], strike: 0.5, skew: 0.05, volHs: 0.01,
    limits: [3000, 15000], logi: [1 / LB, 5, 0.002], vessel: 'SMX', settle: 'SUG_SAN', cargo: [55_000_000, 77_000_000], storage: 0.1, spread: 0.006,
    locs: [['SUG_SAN', 'saopaulo', 'FOB Santos', 'FOB', 0, 0.6, ['SMX', -0.6]], ['SUG_BKK', 'bangkok', 'FOB Thaïlande', 'FOB', 0.6, 0.7, ['SMX', -0.5]], ['SUG_DXB', 'dubai', 'CFR raffinerie de Dubaï', 'CFR', 1.9, 0.8, ['SMX', 0.6]], ['SUG_MUM', 'mumbai', 'FOB Inde', 'FOB', 0.4, 0.9, ['SMX', -0.5]]],
    display: { unit: 't', factor: 1 / LB }, color: '#f5f5f4', icon: '🍬', blurb: 'Canne brésilienne contre betterave et quotas indiens. Le Brésil arbitre entre sucre et éthanol.' }),
  mk({ id: 'COFFEE', name: 'Café arabica (« C »)', short: 'Café', family: 'agri', group: 'softs', exchange: 'ICX US', priceUnit: 'c/lb', qtyUnit: 'lb', lot: 37_500, tick: 0.05, decimals: 2, vpu: 0.01,
    listing: { kind: 'months', months: [2, 4, 6, 8, 11], count: 6 }, ltd: 'ICE_SOFTS', m: [230, 0.03, 0.9, 0.35, 0.22, 0.2, 0, 0.03, 6], liq: [2, 300, 3], strike: 5, skew: 0.08, curv: 0.04, volHs: 0.012,
    limits: [1500, 7500], logi: [1 / LB, 8, 0.002], vessel: 'SMX', settle: 'COF_NY', cargo: [1_320_000, 2_640_000], storage: 1.5, spread: 0.008,
    locs: [['COF_NY', 'newyork', 'Entrepôts agréés New York', 'HUB', 0, 6], ['COF_SAN', 'saopaulo', 'FOB Santos (naturel)', 'FOB', -10, 8, ['SMX', -2]], ['COF_BOG', 'bogota', 'FOB Colombie (lavé)', 'FOB', 28, 10, ['SMX', -2]], ['COF_NBO', 'nairobi', 'FOB Mombasa', 'FOB', 45, 15, ['SMX', -2]], ['COF_HAM', 'hamburg', 'Entrepôts Hambourg', 'DAP', 12, 8]],
    display: { unit: 't', factor: 1 / LB }, color: '#78350f', icon: '☕', blurb: 'Une gelée au Brésil et les prix doublent. Primes de qualité énormes selon l’origine.' }),
  mk({ id: 'COCOA', name: 'Cacao (New York)', short: 'Cacao', family: 'agri', group: 'softs', exchange: 'ICX US', priceUnit: '$/t', qtyUnit: 't', lot: 10, tick: 1, decimals: 0,
    listing: { kind: 'months', months: [2, 4, 6, 8, 11], count: 6 }, ltd: 'ICE_SOFTS', m: [5500, 0.05, 0.8, 0.42, 0.25, 0.2, -0.03, 0.02, 1], liq: [3, 300, 4], strike: 100, skew: 0.08, curv: 0.05, volHs: 0.015,
    limits: [1000, 5000], logi: [1, 25, 0.003], vessel: 'SMX', settle: 'COC_NY', cargo: [500, 1000, 3000], storage: 22, spread: 0.008,
    locs: [['COC_NY', 'newyork', 'Entrepôts agréés New York', 'HUB', 0, 120], ['COC_ABJ', 'abidjan', 'FOB San Pedro', 'FOB', -180, 150, ['SMX', -30]], ['COC_ACC', 'accra', 'FOB Tema', 'FOB', -120, 140, ['SMX', -30]], ['COC_RTM', 'rotterdam', 'CIF Amsterdam', 'CIF', 120, 140, ['SMX', 30]]],
    color: '#7c2d12', icon: '🍫', blurb: 'Deux pays font 60 % de la récolte. Maladies, pluies et réformes de commercialisation : des envolées historiques.' }),
  mk({ id: 'COTTON', name: 'Coton n° 2', short: 'Coton', family: 'agri', group: 'softs', exchange: 'ICX US', priceUnit: 'c/lb', qtyUnit: 'lb', lot: 50_000, tick: 0.01, decimals: 2, vpu: 0.01,
    listing: { kind: 'months', months: [2, 4, 6, 9, 11], count: 6 }, ltd: 'ICE_SOFTS', m: [78, 0.01, 0.9, 0.25, 0.16, 0.2, 0.01, 0.02, 7], liq: [2, 450, 3], strike: 1, volHs: 0.01,
    limits: [1500, 7500], logi: [1 / LB, 10, 0.001], vessel: 'SMX', settle: 'COT_HOU', cargo: [11_000_000, 22_000_000], storage: 0.25, spread: 0.007,
    locs: [['COT_HOU', 'houston', 'FOB Houston', 'FOB', 0, 2, ['SMX', -1]], ['COT_BR', 'saopaulo', 'FOB Santos', 'FOB', -2, 2.5, ['SMX', -1]], ['COT_KAR', 'karachi', 'CFR Karachi', 'CFR', 9, 3, ['SMX', 1.2]], ['COT_CN', 'shanghai', 'CFR Chine', 'CFR', 11, 3, ['SMX', 1.2]], ['COT_MUM', 'mumbai', 'Inde (Gujarat)', 'FCA', 3, 3]],
    display: { unit: 't', factor: 1 / LB }, color: '#f8fafc', icon: '🧵', blurb: 'Fibre du textile mondial : États-Unis, Brésil et Inde exportent, la Chine et l’Asie du Sud filent.' }),
  mk({ id: 'PALM', name: 'Huile de palme brute', short: 'Huile de palme', family: 'agri', group: 'oléagineux', exchange: 'BMK Kuala Lumpur', priceUnit: '$/t', qtyUnit: 't', lot: 25, tick: 0.5, decimals: 1,
    listing: { kind: 'monthly', count: 12 }, ltd: 'LAST_FRIDAY', m: [950, 0.02, 1.2, 0.3, 0.17, 0.2, -0.01, 0.04, 9], liq: [2, 800, 3], strike: 20, volHs: 0.012,
    limits: [1500, 7500], logi: [1, 6, 0.002], vessel: 'SMX', settle: 'PALM_PKL', cargo: [10_000, 20_000], storage: 5, spread: 0.006,
    locs: [['PALM_PKL', 'kualalumpur', 'FOB Port Klang', 'FOB', 0, 20, ['SMX', -12]], ['PALM_JKT', 'jakarta', 'FOB Dumai (Insulinde)', 'FOB', -18, 25, ['SMX', -12]], ['PALM_MUM', 'mumbai', 'CFR Inde', 'CFR', 38, 25, ['SMX', 12]], ['PALM_RTM', 'rotterdam', 'CIF Rotterdam', 'CIF', 85, 25, ['SMX', 18]]],
    color: '#ea580c', icon: '🌴', blurb: 'L’huile végétale la moins chère : alimentation, cosmétiques, biodiesel. Taxes à l’export d’Insulinde.' }),
  mk({ id: 'OJ', name: 'Jus d’orange concentré surgelé', short: 'Jus d’orange', family: 'agri', group: 'softs', exchange: 'ICX US', priceUnit: 'c/lb', qtyUnit: 'lb', lot: 15_000, tick: 0.05, decimals: 2, vpu: 0.01,
    listing: { kind: 'months', months: [0, 2, 4, 6, 8, 10], count: 6 }, ltd: 'ICE_SOFTS', m: [300, 0.04, 0.8, 0.4, 0.25, 0.2, -0.03, 0.03, 9], liq: [4, 180, 4], strike: 10, skew: 0.08, volHs: 0.02,
    limits: [300, 1500], logi: [1 / LB, 20, 0.002], vessel: 'SMX', settle: 'OJ_FL', cargo: [1_500_000, 3_000_000], storage: 3, spread: 0.012,
    locs: [['OJ_FL', 'newyork', 'Entrepôts agréés (Floride)', 'HUB', 0, 10], ['OJ_SAN', 'saopaulo', 'FOB Santos (jus en vrac)', 'FOB', -22, 15, ['SMX', -3]], ['OJ_RTM', 'rotterdam', 'Terminal de Gand (CIF)', 'CIF', 18, 15, ['SMX', 3]]],
    display: { unit: 't', factor: 1 / LB }, color: '#fb923c', icon: '🍊', blurb: 'Un marché minuscule : un ouragan en Floride ou une maladie des agrumes au Brésil et tout s’emballe.' }),
];

export const COMMODITIES = { ...CORE, ...Object.fromEntries(EXTRA.map((x) => [x.id, x])) } as Record<CommodityId, CommoditySpec>;

/** Ordre stable : les cinq commodités historiques d'abord (les tirages aléatoires du marché en dépendent). */
export const COMMODITY_IDS: CommodityId[] = ['BRENT', 'TTF', 'CU', 'WHEAT', 'API2', ...EXTRA.map((x) => x.id)];
export const CORE_IDS: CommodityId[] = ['BRENT', 'TTF', 'CU', 'WHEAT', 'API2'];
/** Jeux de marchés proposés au lancement d'une partie (divulgation progressive). */
export const MARKET_SETS: { id: string; label: string; ids: CommodityId[] }[] = [
  { id: 'core', label: 'Essentiels (5 marchés)', ids: CORE_IDS },
  { id: 'extended', label: 'Étendus (20 marchés)', ids: [...CORE_IDS, 'WTI', 'GASOIL', 'HH', 'JKM', 'POWER', 'EUA', 'AL', 'NI', 'AU', 'FE', 'CORN', 'SOY', 'SUGAR', 'COFFEE', 'COCOA'] },
  { id: 'all', label: 'Tous (38 marchés)', ids: [] },
];

/** Taux sans risque (continus, constants en phase 1). */
export const RATES: Record<'USD' | 'EUR', number> = { USD: 0.04, EUR: 0.0225 };

/**
 * Corrélation des chocs (facteurs courts, et séparément facteurs longs), phase 8 : modèle à facteurs.
 *   choc_i = Σ_k L_ik f_k + √(1 − Σ_k L_ik²) ε_i
 * Facteurs : macro mondiale, pétrole, gaz/électricité européens, charbon, métaux, précieux, agricoles, oléagineux,
 * batteries. C = L Lᵀ + diag(idiosyncratique) est définie positive par construction (‖L_i‖ < 1).
 * Le dernier indice (après toutes les commodités) est l'EURUSD.
 */
type Factor = 'g' | 'oil' | 'eg' | 'coal' | 'met' | 'prec' | 'agri' | 'seed' | 'batt';
const L: Record<CommodityId, Partial<Record<Factor, number>>> = {
  BRENT: { g: 0.35, oil: 0.88 }, WTI: { g: 0.35, oil: 0.86 }, DUBAI: { g: 0.35, oil: 0.87 },
  GASOIL: { g: 0.3, oil: 0.82 }, GASOLINE: { g: 0.3, oil: 0.76 }, JET: { g: 0.3, oil: 0.8 }, FUELOIL: { g: 0.25, oil: 0.78 },
  TTF: { g: 0.15, oil: 0.2, eg: 0.85 }, POWER: { g: 0.12, eg: 0.75, coal: 0.3 }, EUA: { g: 0.25, eg: 0.45 },
  HH: { g: 0.2, oil: 0.2 }, JKM: { g: 0.2, oil: 0.4, eg: 0.55 },
  API2: { g: 0.2, oil: 0.2, eg: 0.4, coal: 0.65 }, NEWC: { g: 0.25, oil: 0.15, coal: 0.75 }, METCOAL: { g: 0.3, coal: 0.35, met: 0.4 },
  CU: { g: 0.45, met: 0.7 }, AL: { g: 0.4, met: 0.65, eg: 0.15 }, ZN: { g: 0.4, met: 0.65 }, PB: { g: 0.35, met: 0.6 }, SN: { g: 0.35, met: 0.55 },
  NI: { g: 0.35, met: 0.5, batt: 0.35 }, CO: { g: 0.25, met: 0.3, batt: 0.6 }, LI: { g: 0.25, met: 0.2, batt: 0.7 },
  AU: { g: 0.15, prec: 0.92 }, AG: { g: 0.25, prec: 0.8, met: 0.3 }, FE: { g: 0.4, met: 0.55 },
  WHEAT: { g: 0.15, agri: 0.7 }, CORN: { g: 0.2, agri: 0.8, oil: 0.1 }, RICE: { g: 0.1, agri: 0.4 },
  SOY: { g: 0.2, agri: 0.55, seed: 0.65 }, SOYMEAL: { g: 0.15, agri: 0.45, seed: 0.65 }, SOYOIL: { g: 0.2, agri: 0.35, seed: 0.55, oil: 0.3 }, PALM: { g: 0.2, agri: 0.25, seed: 0.5, oil: 0.3 },
  SUGAR: { g: 0.2, agri: 0.2, oil: 0.2 }, COFFEE: { g: 0.15, agri: 0.15 }, COCOA: { g: 0.1, agri: 0.1 }, COTTON: { g: 0.25, agri: 0.3 }, OJ: { g: 0.05, agri: 0.05 },
};
const FX_LOAD: Partial<Record<Factor, number>> = { g: 0.3 };
const FACTORS: Factor[] = ['g', 'oil', 'eg', 'coal', 'met', 'prec', 'agri', 'seed', 'batt'];

function buildCorrelation(): number[][] {
  const rows = [...COMMODITY_IDS.map((c) => L[c]), FX_LOAD];
  const n = rows.length;
  for (const r of rows) {
    const norm = FACTORS.reduce((s, f) => s + (r[f] ?? 0) ** 2, 0);
    if (norm >= 0.995) throw new Error('Chargements factoriels trop forts');
  }
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : FACTORS.reduce((s, f) => s + (rows[i]![f] ?? 0) * (rows[j]![f] ?? 0), 0))));
}

/** Matrice de corrélation (commodités puis EURUSD). Définie positive par construction (vérifié par les tests). */
export const CORRELATION: number[][] = buildCorrelation();
/** Indice de l'EURUSD dans la matrice. */
export const FX_INDEX = COMMODITY_IDS.length;

export function findLocation(commodity: CommodityId, locationId: string) {
  const loc = COMMODITIES[commodity].physical.locations.find((l) => l.id === locationId);
  if (!loc) throw new Error(`Lieu inconnu ${locationId}`);
  return loc;
}
