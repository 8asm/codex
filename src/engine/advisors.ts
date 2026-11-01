/**
 * Conseillers : des règles lisent l'état et produisent des conseils, avec une humeur et parfois une action.
 * Ils se contredisent volontairement (risk vs trader) et le trader fait des paris directionnels qui sont
 * évalués après coup : dans un marché efficient (futures martingales), son taux de réussite tend vers 50 %.
 * Les conseils de portage de l'analyste, eux, reposent sur des calculs exacts.
 */
import { COMMODITIES, COMMODITY_IDS, RATES } from '../data/commodities';
import { COUNTERPARTY_BY_ID } from '../data/counterparties';
import { addBusinessDays, formatDayShort, monthLabel, ymd } from './calendar';
import { lastTradingDay, listedMonths, physicalDeliveryDay } from './contracts';
import { newId } from './ledger';
import { forwardAt, futuresPrice, fx, spotPrice } from './market';
import { otcNotional } from './derivatives';
import { physicalExposureUsd, PHYSICAL_LEVERAGE } from './physical';
import { chance, pick, uniform } from './rng';
import { freeCash, rcfHeadroom } from './treasury';
import { COVENANT_VAR_PCT } from './limits';
import type { Advice, AdvisorId, CommodityId, GameState } from './types';
import { exposures, nav } from './valuation';

const MAX_PER_DAY = 3;
const fmtM = (x: number) => `${(x / 1e6).toFixed(2)} M$`;
const fmtK = (x: number) => (Math.abs(x) >= 1e6 ? fmtM(x) : `${Math.round(x / 1e3)} k$`);

type Draft = Omit<Advice, 'id' | 'day'> & { cooldown: number };

/** Vol réalisée annualisée du front sur ~20 jours, depuis l'historique des facteurs. */
export function realizedVol(state: GameState, c: CommodityId, n = 20): number {
  const h = state.market.history.slice(-(n + 1));
  if (h.length < 3) return 0;
  const px = h.map((s) => forwardAt(state.market, c, s.day + 45, s.day, s.f[c][0], s.f[c][1], s.volMult));
  let sum = 0, cnt = 0;
  for (let i = 1; i < px.length; i++) {
    const dt = (h[i]!.day - h[i - 1]!.day) / 365;
    const r = Math.log(px[i]! / px[i - 1]!);
    sum += (r * r) / dt;
    cnt++;
  }
  return Math.sqrt(sum / cnt);
}

/** Opportunité de cash-and-carry : meilleur portage net entre spot et une échéance à 2–6 mois, par unité. */
export function carryOpportunity(state: GameState, c: CommodityId) {
  const spec = COMMODITIES[c];
  const S = spotPrice(state.market, c);
  let best: null | { months: number; perUnit: number; pct: number; mi: number; total: number } = null;
  const cur = listedMonths(spec, state.day);
  for (const mi of cur.slice(0, 8)) {
    const T = physicalDeliveryDay(mi);
    const months = (T - state.day) / 30;
    if (months < 1.5 || months > 7) continue;
    const F = futuresPrice(state.market, c, mi);
    const storage = spec.physical.storagePerUnitMonth * months;
    const financing = S * (RATES.USD + 0.025) * (months / 12);
    const frictions = S * spec.physical.spotSpreadPct * 2 + spec.tick * spec.liquidity.halfSpreadTicks * 2;
    const perUnit = F - S - storage - financing - frictions;
    const total = perUnit * spec.physical.cargoSizes[0]! * spec.valuePerUnit * fx(state.market, spec.currency);
    if (!best || perUnit > best.perUnit) best = { months, perUnit, pct: perUnit / S, mi, total };
  }
  return best;
}

function rules(state: GameState): Draft[] {
  const out: Draft[] = [];
  const co = state.company;
  const navV = nav(state);
  const head = rcfHeadroom(state, navV);
  const capacity = Math.max(1, co.cash + head);
  const exps = exposures(state);
  const r = state.risk;
  const todayNews = state.news.filter((n) => n.day === state.day);

  // ---------------------------------------------------------------- RISK
  if (co.im / capacity > 0.7) {
    out.push({ advisor: 'risk', mood: 'worried', rule: 'risk.margin', cooldown: 4, text: `La marge consomme ${Math.round((co.im / capacity) * 100)} % de notre capacité de financement. Un mouvement de 3 % contre nous et c’est l’appel de marge. Je réduirais maintenant, pas demain.`, action: { kind: 'panel', panel: 'treasury' } });
  }
  for (const e of exps) {
    const phys = e.forwardQty + e.inventoryQty;
    if (!phys) continue;
    const spec = COMMODITIES[e.commodity];
    const notional = Math.abs(phys) * spotPrice(state.market, e.commodity) * spec.valuePerUnit * fx(state.market, spec.currency);
    const hedged = 1 - Math.abs(e.netQty) / Math.abs(phys);
    if (notional > 2e6 && hedged < 0.5) {
      out.push({ advisor: 'risk', mood: 'worried', rule: `risk.unhedged.${e.commodity}`, cooldown: 6, text: `Notre physique ${spec.short} n’est couvert qu’à ${Math.max(0, Math.round(hedged * 100))} %. Un mouvement de 10 % du prix, c’est ${fmtK(Math.abs(e.delta1pct) * 10)} de P&L. On est négociant, pas spéculateur : couvrons.`, action: { kind: 'hedge', commodity: e.commodity } });
    }
  }
  if (r.var99 > 0.9 * r.limits.varPctNav * navV) {
    out.push({ advisor: 'risk', mood: 'angry', rule: 'risk.var', cooldown: 3, text: `VaR à ${fmtM(r.var99)}, pour une limite interne de ${fmtM(r.limits.varPctNav * navV)}. Ce n’est pas une suggestion.`, action: { kind: 'panel', panel: 'risk' } });
  }
  const h = state.market.history;
  if (h.length > 2 && state.market.volRegime === 'stressed' && h[h.length - 2]!.volMult < state.market.volMult) {
    out.push({ advisor: 'risk', mood: 'worried', rule: 'risk.regime', cooldown: 10, text: 'La volatilité explose. Les bourses vont relever les marges dans les jours qui viennent : gardez du cash disponible, la liquidité va s’évaporer.' });
  }
  const shortGamma = state.options.filter((o) => o.lots < 0 && o.expiry - state.day <= 7);
  if (shortGamma.length) {
    const o = shortGamma[0]!;
    out.push({ advisor: 'risk', mood: 'worried', rule: 'risk.gamma', cooldown: 5, text: `Nous sommes vendeurs d’options ${COMMODITIES[o.commodity].short} qui expirent le ${formatDayShort(o.expiry)}. Gamma court à l’approche de l’échéance : le moindre mouvement autour du strike ${o.strike} fait sauter le delta.`, action: { kind: 'panel', panel: 'book' } });
  }

  // ---------------------------------------------------------------- TRADER
  for (const n of todayNews.filter((x) => x.major && x.commodity)) {
    const c = n.commodity!;
    const dir: 1 | -1 = n.tone === 'up' ? 1 : -1;
    const mi = listedMonths(COMMODITIES[c], state.day)[0]!;
    out.push({
      advisor: 'trader', mood: 'smug', rule: `trader.news.${c}`, cooldown: 3,
      text: `Tu as vu la news ? Le ${COMMODITIES[c].short} va ${dir > 0 ? 'continuer à monter' : 'encore baisser'}, c’est évident. Moi je ${dir > 0 ? 'charge' : 'vends'} 20 lots tout de suite.`,
      action: { kind: 'trade', action: { type: 'TRADE_FUTURE', commodity: c, month: mi, lots: 20 * dir }, label: `${dir > 0 ? 'Acheter' : 'Vendre'} 20 lots` },
      prediction: { commodity: c, dir, ref: futuresPrice(state.market, c, mi), month: mi, evalDay: addBusinessDays(state.day, 10) },
    });
  }
  if (chance(state.rng, 0.12)) {
    const c = pick(state.rng, COMMODITY_IDS);
    const dir: 1 | -1 = uniform(state.rng) < 0.5 ? 1 : -1;
    const mi = listedMonths(COMMODITIES[c], state.day)[0]!;
    out.push({
      advisor: 'trader', mood: 'smug', rule: 'trader.hunch', cooldown: 4,
      text: `Mon instinct me dit que le ${COMMODITIES[c].short} va ${dir > 0 ? 'monter' : 'baisser'} dans les deux semaines. J’ai un bon feeling.`,
      action: { kind: 'trade', action: { type: 'TRADE_FUTURE', commodity: c, month: mi, lots: 10 * dir }, label: `${dir > 0 ? 'Acheter' : 'Vendre'} 10 lots` },
      prediction: { commodity: c, dir, ref: futuresPrice(state.market, c, mi), month: mi, evalDay: addBusinessDays(state.day, 10) },
    });
  }
  if (state.history.length > 20 && r.var99 < 0.005 * navV) {
    out.push({ advisor: 'trader', mood: 'smug', rule: 'trader.bored', cooldown: 20, text: `On dort ? ${fmtM(navV)} de fonds propres et une VaR de ${fmtK(r.var99)}. Avec ça, on devrait prendre de vraies positions.` });
  }
  const pricey = COMMODITY_IDS.find((c) => state.market.ivLevel[c] > 1.35);
  if (pricey) {
    out.push({ advisor: 'trader', mood: 'happy', rule: 'trader.sellvol', cooldown: 15, text: `Les options ${COMMODITIES[pricey].short} sont hors de prix. Vendons des puts : on encaisse la prime, c’est de l’argent gratuit !`, action: { kind: 'panel', panel: 'options' } });
  }
  if (co.marginCall) {
    out.push({ advisor: 'trader', mood: 'angry', rule: 'trader.hold', cooldown: 3, text: 'Ne coupe surtout pas maintenant ! Ça va revenir, c’est toujours comme ça. Tiens bon.' });
  }

  // ---------------------------------------------------------------- ANALYST
  for (const c of COMMODITY_IDS) {
    const opp = carryOpportunity(state, c);
    if (opp && opp.pct > 0.006) {
      const spec = COMMODITIES[c];
      out.push({ advisor: 'analyst', mood: 'happy', rule: `analyst.carry.${c}`, cooldown: 12, text: `Contango ${spec.short} : entre le spot et ${monthLabel(opp.mi)}, après stockage, financement et frictions, il reste ${opp.perUnit.toFixed(spec.decimals)} ${spec.priceUnit} (${(opp.pct * 100).toFixed(1)} %). Acheter une cargaison spot et vendre ${monthLabel(opp.mi)} rapporterait environ ${fmtK(opp.total)} sans risque de prix.`, action: { kind: 'panel', panel: 'physical' } });
      break;
    }
  }
  for (const c of COMMODITY_IDS) {
    const rv = realizedVol(state, c);
    const lvl = state.market.ivLevel[c];
    if (rv > 0 && lvl > 1.3) {
      out.push({ advisor: 'analyst', mood: 'neutral', rule: `analyst.ivhigh.${c}`, cooldown: 12, text: `Vol implicite ${COMMODITIES[c].short} environ ${(lvl * 100 - 100).toFixed(0)} % au-dessus de la vol du modèle, réalisée récente ${(rv * 100).toFixed(0)} %. Les options sont chères : acheter de la protection coûte cher en ce moment.` });
      break;
    }
    if (rv > 0 && lvl < 0.9) {
      out.push({ advisor: 'analyst', mood: 'happy', rule: `analyst.ivlow.${c}`, cooldown: 12, text: `Vol implicite ${COMMODITIES[c].short} basse (réalisée ${(rv * 100).toFixed(0)} %). Se couvrir avec des options n’a jamais été aussi bon marché.`, action: { kind: 'panel', panel: 'options' } });
      break;
    }
  }
  for (const c of COMMODITY_IDS) {
    const shortFut = state.futures.filter((p) => p.commodity === c && p.lots < 0);
    if (!shortFut.length) continue;
    const months = listedMonths(COMMODITIES[c], state.day);
    const f0 = futuresPrice(state.market, c, months[0]!), f1 = futuresPrice(state.market, c, months[1]!);
    if (f0 > f1 * 1.005) {
      out.push({ advisor: 'analyst', mood: 'neutral', rule: `analyst.rollcost.${c}`, cooldown: 15, text: `${COMMODITIES[c].short} en backwardation : rouler notre short du front vers l’échéance suivante coûtera environ ${(((f0 - f1) / f1) * 100).toFixed(1)} % par roll. C’est le prix de la couverture d’un marché tendu.` });
    }
  }
  if (ymd(state.day).d <= 3 && chance(state.rng, 0.5)) {
    const c = pick(state.rng, COMMODITY_IDS);
    const months = listedMonths(COMMODITIES[c], state.day);
    const s = futuresPrice(state.market, c, months[Math.min(6, months.length - 1)]!) / futuresPrice(state.market, c, months[0]!) - 1;
    out.push({ advisor: 'analyst', mood: 'neutral', rule: 'analyst.curve', cooldown: 18, text: `Point mensuel : la courbe ${COMMODITIES[c].short} est en ${s > 0 ? 'contango' : 'backwardation'} de ${(Math.abs(s) * 100).toFixed(1)} % sur six échéances. ${s > 0 ? 'Le marché est bien approvisionné : le stockage est rémunéré.' : 'Le marché est tendu : détenir la marchandise rapporte.'}`, action: { kind: 'panel', panel: 'market' } });
  }

  // ---------------------------------------------------------------- OPS
  for (const d of state.forwards.filter((x) => x.side < 0 && x.deliveryDay - state.day <= 7)) {
    const stock = state.inventory.filter((l) => l.commodity === d.commodity).reduce((s, l) => s + l.qty, 0);
    if (stock < d.qty) {
      out.push({ advisor: 'ops', mood: 'worried', rule: `ops.short.${d.id}`, cooldown: 3, text: `Livraison de vente ${COMMODITIES[d.commodity].short} le ${formatDayShort(d.deliveryDay)} et pas assez de stock. Sans achat spot, ce sera un rachat d’urgence à +1,5 %.`, action: { kind: 'panel', panel: 'physical' } });
    }
  }
  for (const p of state.futures) {
    const ltd = lastTradingDay(COMMODITIES[p.commodity], p.month);
    if (ltd - state.day <= 4 && ltd >= state.day) {
      out.push({ advisor: 'ops', mood: 'neutral', rule: `ops.expiry.${p.commodity}${p.month}`, cooldown: 5, text: `Le ${COMMODITIES[p.commodity].short} ${monthLabel(p.month)} cesse de coter le ${formatDayShort(ltd)}. On roule la position ou on la laisse partir en règlement cash ?`, action: { kind: 'panel', panel: 'book' } });
    }
  }
  for (const o of state.options.filter((x) => x.expiry - state.day <= 4 && x.expiry >= state.day)) {
    out.push({ advisor: 'ops', mood: 'neutral', rule: `ops.optexp.${o.id}`, cooldown: 5, text: `Options ${COMMODITIES[o.commodity].short} ${monthLabel(o.month)} K=${o.strike} : expiration le ${formatDayShort(o.expiry)}. Dans la monnaie, elles seront exercées automatiquement en futures.` });
  }
  const storageMonthly = state.inventory.reduce((s, l) => {
    const spec = COMMODITIES[l.commodity];
    return s + l.qty * spec.physical.storagePerUnitMonth * spec.valuePerUnit * fx(state.market, spec.currency);
  }, 0);
  if (storageMonthly > 60_000) {
    out.push({ advisor: 'ops', mood: 'neutral', rule: 'ops.storage', cooldown: 20, text: `Nos stocks coûtent ${fmtK(storageMonthly)} par mois en stockage. Ça ne vaut le coup que si la courbe paie le portage.`, action: { kind: 'panel', panel: 'book' } });
  }

  // ---------------------------------------------------------------- LEGAL
  for (const c of COMMODITY_IDS) {
    const spec = COMMODITIES[c];
    const net = Math.abs(state.futures.filter((p) => p.commodity === c).reduce((s, p) => s + p.lots, 0));
    if (net > 0.8 * spec.positionLimits.allMonths) {
      out.push({ advisor: 'legal', mood: 'worried', rule: `legal.poslimit.${c}`, cooldown: 6, text: `Nous détenons ${net} lots nets de ${spec.short}, pour une limite de position de la bourse à ${spec.positionLimits.allMonths}. Au-delà, l’ordre sera refusé et le régulateur nous demandera des comptes.` });
    }
  }
  const byBank = new Map<string, number>();
  for (const x of state.otc) {
    const spec = COMMODITIES[x.commodity];
    byBank.set(x.bankId, (byBank.get(x.bankId) ?? 0) + Math.abs(x.qty * x.strike * spec.valuePerUnit * fx(state.market, spec.currency)));
  }
  for (const [bank, n] of byBank) {
    if (n > 0.5 * navV) out.push({ advisor: 'legal', mood: 'worried', rule: `legal.otc.${bank}`, cooldown: 15, text: `Nous avons ${fmtM(n)} de notionnel OTC avec ${COUNTERPARTY_BY_ID[bank]?.name ?? bank}, sans accord de collatéral (CSA). Si elle fait défaut, nos gains latents s’envolent.` });
  }
  if (otcNotional(state) > 0 && r.covenantBreachDays === 1) {
    out.push({ advisor: 'legal', mood: 'angry', rule: 'legal.covenant', cooldown: 10, text: `Article 22.3 de la convention de crédit : VaR au-dessus de ${COVENANT_VAR_PCT * 100} % des fonds propres, la banque peut suspendre la ligne. Je l’avais dit.` });
  } else if (r.covenantBreachDays === 1) {
    out.push({ advisor: 'legal', mood: 'worried', rule: 'legal.covenant', cooldown: 10, text: `Covenant de VaR dépassé. Article 22.3 : sous trois jours, la banque peut geler la ligne de crédit.`, action: { kind: 'panel', panel: 'risk' } });
  }
  if (physicalExposureUsd(state) > 0.8 * PHYSICAL_LEVERAGE * Math.max(0, navV)) {
    out.push({ advisor: 'legal', mood: 'worried', rule: 'legal.physcap', cooldown: 10, text: 'Nous approchons le plafond de nos lignes de trade finance. Les banques vont exiger des garanties supplémentaires.' });
  }
  if (freeCash(state) < 0 && !co.marginCall) {
    out.push({ advisor: 'risk', mood: 'angry', rule: 'risk.freecash', cooldown: 2, text: 'Notre cash libre est négatif. À la clôture, ce sera un appel de marge.', action: { kind: 'panel', panel: 'treasury' } });
  }
  return out;
}

/** Évalue les prédictions échues (palmarès), puis produit les conseils du matin. */
export function morningAdvice(state: GameState) {
  for (const a of state.advice) {
    const p = a.prediction;
    if (!p || p.outcome || p.evalDay > state.day) continue;
    const months = listedMonths(COMMODITIES[p.commodity], state.day);
    const mi = months.includes(p.month) ? p.month : months[0]!;
    const now = futuresPrice(state.market, p.commodity, mi);
    const right = Math.sign(now - p.ref) === p.dir;
    p.outcome = right ? 'right' : 'wrong';
    state.track[a.advisor][right ? 'right' : 'wrong']++;
  }
  const drafts = rules(state).filter((d) => (state.adviceCooldown[d.rule] ?? -1e9) <= state.day);
  // priorité : colère > inquiétude > le reste ; on ne garde que quelques conseils par jour
  const order = { angry: 0, worried: 1, smug: 2, happy: 2, neutral: 3 } as const;
  drafts.sort((a, b) => order[a.mood] - order[b.mood]);
  const seenAdvisors = new Set<AdvisorId>();
  let n = 0;
  for (const d of drafts) {
    if (n >= MAX_PER_DAY) break;
    if (seenAdvisors.has(d.advisor) && d.mood !== 'angry') continue;
    seenAdvisors.add(d.advisor);
    state.adviceCooldown[d.rule] = addBusinessDays(state.day, d.cooldown);
    const { cooldown: _cd, ...rest } = d;
    void _cd;
    state.advice.unshift({ ...rest, id: newId(state, 'a'), day: state.day });
    n++;
  }
  if (state.advice.length > 80) state.advice.length = 80;
}
