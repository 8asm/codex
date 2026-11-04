/**
 * Langue de l'interface (français par défaut, anglais en option).
 *  - `t(texte)` traduit une chaîne connue (le texte français sert de clé : rien à maintenir en double côté FR) ;
 *  - un traducteur DOM remplace, à l'affichage, les textes exacts connus (libellés, boutons, en-têtes) et quelques
 *    modèles dynamiques (messages fréquents), sans réécrire chaque composant ; le texte d'origine est conservé et
 *    restauré si l'on revient au français.
 * Les textes générés par le moteur (actualités, journal) ne sont traduits que pour les modèles les plus courants.
 */
import { EN, EN_PATTERNS } from './i18n-en';
import { useSettings } from './settings';

export function lang() {
  return useSettings.getState().lang;
}

export function t(fr: string): string {
  if (lang() !== 'en') return fr;
  return EN[fr] ?? translateDynamic(fr) ?? fr;
}

function translateDynamic(s: string): string | null {
  for (const [re, rep] of EN_PATTERNS) {
    if (!re.test(s)) continue;
    // remplacement par fonction : les morceaux capturés sont eux-mêmes traduits (« 🔓 Nouveau panneau : Risque. … »)
    return typeof rep === 'function' ? s.replace(re, (...m: string[]) => rep(...m.map((x) => (typeof x === 'string' ? EN[x] ?? x : x)))) : s.replace(re, rep);
  }
  return null;
}

/** Traduction d'un texte de nœud : correspondance exacte (espaces préservés), sinon modèle dynamique. */
function translateText(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 600) return null;
  const hit = EN[trimmed] ?? translateDynamic(trimmed);
  if (!hit || hit === trimmed) return null;
  return raw.replace(trimmed, hit);
}

const original = new WeakMap<Node, string>();
const originalTitle = new WeakMap<Element, string>();
let observer: MutationObserver | null = null;

function walk(root: Node) {
  const doc = root.ownerDocument ?? document;
  if (root.nodeType === Node.TEXT_NODE) return visitText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (el.closest?.('[data-no-i18n]')) return;
  visitTitle(el);
  const it = doc.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = it.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) visitText(n as Text);
    else visitTitle(n as Element);
    n = it.nextNode();
  }
}

function visitText(n: Text) {
  const p = n.parentElement;
  if (!p || p.tagName === 'SCRIPT' || p.tagName === 'STYLE' || p.closest('[data-no-i18n]')) return;
  const cur = n.data;
  const tr = translateText(cur);
  if (tr && tr !== cur) {
    if (!original.has(n)) original.set(n, cur);
    n.data = tr;
  }
}

function visitTitle(el: Element) {
  const tt = el.getAttribute?.('title');
  if (!tt) return;
  const tr = translateText(tt);
  if (tr && tr !== tt) {
    if (!originalTitle.has(el)) originalTitle.set(el, tt);
    el.setAttribute('title', tr);
  }
}

/** Démarre (ou arrête) la traduction à l'affichage selon la langue choisie. */
export function applyLanguage(l: 'fr' | 'en') {
  document.documentElement.lang = l;
  if (l === 'en') {
    walk(document.body);
    if (!observer) {
      observer = new MutationObserver((muts) => {
        for (const m of muts) {
          if (m.type === 'characterData') visitText(m.target as Text);
          else if (m.type === 'attributes') visitTitle(m.target as Element);
          else m.addedNodes.forEach((x) => walk(x));
        }
      });
      observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['title'] });
    }
  } else {
    observer?.disconnect();
    observer = null;
    // retour au français : on restaure ce qui a été traduit
    const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let n = it.nextNode();
    while (n) {
      if (n.nodeType === Node.TEXT_NODE && original.has(n)) (n as Text).data = original.get(n)!;
      if (n.nodeType === Node.ELEMENT_NODE && originalTitle.has(n as Element)) (n as Element).setAttribute('title', originalTitle.get(n as Element)!);
      n = it.nextNode();
    }
  }
}
