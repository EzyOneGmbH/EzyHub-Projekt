// Sprach-Umschaltung (Volkan 05.10.2026): übersetzt die gerenderte Oberfläche.
// Statt jede der ~70'000 Zeilen Komponenten-Code umzubauen, ersetzt ein
// MutationObserver Textknoten und UI-Attribute, die EXAKT einem bekannten
// Oberflächentext entsprechen. React aktualisiert Textknoten über nodeValue —
// geänderte Texte laufen daher automatisch wieder durch die Übersetzung.
// Ausgenommen: Eingabefelder, Editoren, Code und alles mit translate="no".
import { uebersetze, type Woerterbuch } from "./uebersetzer";

const ATTRIBUTE = ["title", "placeholder", "aria-label", "alt"] as const;
const AUSSCHLUSS =
  "script,style,code,pre,textarea,[contenteditable=''],[contenteditable='true'],[translate='no'],.notranslate";

let observer: MutationObserver | null = null;
const gesetzt = new WeakMap<Node, string>(); // Knoten → von uns gesetzter Text

function ausgeschlossen(el: Element | null): boolean {
  return !!el && !!el.closest(AUSSCHLUSS);
}

function textKnoten(n: Text, wb: Woerterbuch) {
  const v = n.nodeValue || "";
  if (gesetzt.get(n) === v) return;
  if (ausgeschlossen(n.parentElement)) return;
  const neu = uebersetze(v, wb);
  if (neu != null) {
    gesetzt.set(n, neu);
    n.nodeValue = neu;
  }
}

function attribute(el: Element, wb: Woerterbuch) {
  for (const a of ATTRIBUTE) {
    const v = el.getAttribute(a);
    if (!v) continue;
    const merk = `${a}\u0000${v}`;
    if (gesetzt.get(el) === merk) continue;
    const neu = uebersetze(v, wb);
    if (neu != null) {
      el.setAttribute(a, neu);
      gesetzt.set(el, `${a}\u0000${neu}`);
    }
  }
  // <input type="submit|button" value="…">
  if (
    el instanceof HTMLInputElement &&
    (el.type === "submit" || el.type === "button") &&
    el.value
  ) {
    const neu = uebersetze(el.value, wb);
    if (neu != null) el.value = neu;
  }
}

function baum(root: Node, wb: Woerterbuch) {
  if (root.nodeType === Node.TEXT_NODE) return textKnoten(root as Text, wb);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (ausgeschlossen(el)) return;
  attribute(el, wb);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) =>
      n.nodeType === Node.ELEMENT_NODE && (n as Element).matches(AUSSCHLUSS)
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  let n = walker.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) textKnoten(n as Text, wb);
    else attribute(n as Element, wb);
    n = walker.nextNode();
  }
}

export function starteDomUebersetzung(wb: Woerterbuch) {
  stoppeDomUebersetzung();
  baum(document.body, wb);
  document.title = uebersetze(document.title, wb) ?? document.title;
  const warteschlange = new Set<Node>();
  let geplant = false;
  const abarbeiten = () => {
    geplant = false;
    const liste = [...warteschlange];
    warteschlange.clear();
    for (const n of liste) if (n.isConnected) baum(n, wb);
  };
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") warteschlange.add(m.target);
      else if (m.type === "attributes") warteschlange.add(m.target);
      else m.addedNodes.forEach((n) => warteschlange.add(n));
    }
    if (!geplant && warteschlange.size) {
      geplant = true;
      // Microtask statt rAF: übersetzt vor dem nächsten Zeichnen, kein Aufblitzen.
      queueMicrotask(abarbeiten);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRIBUTE],
  });
}

export function stoppeDomUebersetzung() {
  observer?.disconnect();
  observer = null;
}

/**
 * Datumsnamen (Wochentag, Monat) kommen aus Intl, nicht aus dem Code — bei
 * en/fr werden deutsche Datums-Locales auf die Schweizer Variante der Sprache
 * umgelenkt (de-CH → en-CH / fr-CH). Zahlenformate bleiben unverändert.
 */
export function lenkeDatumsLocaleUm(lang: "en" | "fr") {
  const ziel = lang === "en" ? "en-CH" : "fr-CH";
  const um = (loc?: string | string[]) => {
    const l = Array.isArray(loc) ? loc[0] : loc;
    return !l || /^de\b/i.test(l) ? ziel : loc;
  };
  const D = Date.prototype as any;
  if (D.__ezyLocale) return;
  D.__ezyLocale = true;
  const ds = D.toLocaleDateString;
  const ts = D.toLocaleTimeString;
  const s = D.toLocaleString;
  D.toLocaleDateString = function (loc?: any, o?: any) {
    return ds.call(this, um(loc), o);
  };
  D.toLocaleTimeString = function (loc?: any, o?: any) {
    return ts.call(this, um(loc), o);
  };
  D.toLocaleString = function (loc?: any, o?: any) {
    return s.call(this, um(loc), o);
  };
  const DTF = Intl.DateTimeFormat;
  const Ersatz = function (this: unknown, loc?: any, o?: any) {
    return new DTF(um(loc) as any, o);
  } as unknown as typeof Intl.DateTimeFormat;
  (Ersatz as any).prototype = DTF.prototype;
  (Ersatz as any).supportedLocalesOf = DTF.supportedLocalesOf;
  (Intl as any).DateTimeFormat = Ersatz;
}
