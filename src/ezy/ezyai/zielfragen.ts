// Zielfragen (18.11.2026): die Fragen aus der GEO-Strategie eines Kunden, bei
// denen er in den KI-Systemen genannt werden soll. Gespeichert als normale
// Mess-Fragen (ai_visibility_prompt_defs) mit origin = "zielfrage"; das Thema
// (topic) bündelt die Sprachfassungen einer Frage. Hier nur die Auswertung,
// ohne Netz und ohne React.

export const ZIEL_ORIGIN = "zielfrage";
export const ZIEL_SPRACHEN = ["de", "fr", "it", "en"] as const;
export type ZielSprache = (typeof ZIEL_SPRACHEN)[number];
export const SPRACH_NAME: Record<string, string> = {
  de: "Deutsch",
  fr: "Französisch",
  it: "Italienisch",
  en: "Englisch",
};

export type ZielDef = {
  id: string;
  prompt: string;
  topic: string | null;
  language: string | null;
  active: boolean;
};

export type ZielMessung = {
  prompt: string | null;
  platform: string | null;
  status: string | null;
  checked_at: string | null;
};

/** quelle = eigene Website als Quelle verlinkt, genannt = im Text erwähnt,
 *  nicht = Antwort ohne Nennung, offen = von diesem System keine Antwort. */
export type ZielStand = "quelle" | "genannt" | "nicht" | "offen";

export type ZielZeile = {
  def: ZielDef;
  sprache: string;
  zellen: Record<string, ZielStand>;
};

export type ZielThema = {
  thema: string;
  zeilen: ZielZeile[];
  gemessen: boolean;
  genannt: boolean;
  quelle: boolean;
};

export type ZielAuswertung = {
  themen: ZielThema[];
  systeme: string[];
  total: number;
  gemessen: number;
  genannt: number;
  quelle: number;
  stand: string | null;
};

const norm = (s: unknown) => String(s ?? "").trim();
const sprachRang = (s: string) => {
  const i = (ZIEL_SPRACHEN as readonly string[]).indexOf(s);
  return i < 0 ? ZIEL_SPRACHEN.length : i;
};

export function standAus(status: unknown): Exclude<ZielStand, "offen"> {
  const s = norm(status);
  if (s === "Referenziert") return "quelle";
  return s && s !== "Nicht erwähnt" ? "genannt" : "nicht";
}

/**
 * Ordnet die Mess-Zeilen den Zielfragen zu. Je Frage und KI-System zählt die
 * jüngste Antwort. Eine Frage gilt als genannt, sobald sie in mindestens einer
 * Sprache von mindestens einem System genannt wird. Pausierte Fragen zählen
 * nicht mit. Pure.
 */
export function zielAuswertung(defsRoh: ZielDef[], messungen: ZielMessung[]): ZielAuswertung {
  const defs = (Array.isArray(defsRoh) ? defsRoh : []).filter((d) => d && norm(d.prompt));
  const gesucht = new Set(defs.map((d) => norm(d.prompt)));

  // Jüngste Antwort je Frage und System.
  const juengste = new Map<string, Map<string, ZielMessung>>();
  const systeme = new Set<string>();
  let stand: string | null = null;
  for (const m of Array.isArray(messungen) ? messungen : []) {
    const system = norm(m?.platform);
    if (!system) continue;
    systeme.add(system);
    const frage = norm(m?.prompt);
    if (!gesucht.has(frage)) continue;
    let jeSystem = juengste.get(frage);
    if (!jeSystem) juengste.set(frage, (jeSystem = new Map()));
    const alt = jeSystem.get(system);
    if (!alt || norm(m.checked_at) > norm(alt.checked_at)) jeSystem.set(system, m);
    if (m.checked_at && (!stand || m.checked_at > stand)) stand = m.checked_at;
  }
  const systemListe = [...systeme].sort((a, b) => a.localeCompare(b, "de"));

  const nachThema = new Map<string, ZielThema>();
  for (const d of defs) {
    const thema = norm(d.topic) || norm(d.prompt);
    let t = nachThema.get(thema);
    if (!t)
      nachThema.set(
        thema,
        (t = { thema, zeilen: [], gemessen: false, genannt: false, quelle: false }),
      );
    const jeSystem = juengste.get(norm(d.prompt));
    const zellen: Record<string, ZielStand> = {};
    for (const s of systemListe) {
      const m = jeSystem?.get(s);
      zellen[s] = m ? standAus(m.status) : "offen";
      if (!d.active || !m) continue;
      t.gemessen = true;
      if (zellen[s] !== "nicht") t.genannt = true;
      if (zellen[s] === "quelle") t.quelle = true;
    }
    t.zeilen.push({ def: d, sprache: norm(d.language).toLowerCase() || "de", zellen });
  }
  const themen = [...nachThema.values()];
  for (const t of themen) t.zeilen.sort((a, b) => sprachRang(a.sprache) - sprachRang(b.sprache));
  const aktiv = themen.filter((t) => t.zeilen.some((z) => z.def.active));
  return {
    themen,
    systeme: systemListe,
    total: aktiv.length,
    gemessen: aktiv.filter((t) => t.gemessen).length,
    genannt: aktiv.filter((t) => t.genannt).length,
    quelle: aktiv.filter((t) => t.quelle).length,
    stand,
  };
}
