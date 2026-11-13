// KI-Sichtbarkeit: reine Helfer für die Quellen von Gemini (Grounding) und für
// den Stand der KI-Systeme je Messung. Kein Zugriff auf Datenbank oder Netz.
//
// Gemini nennt seine Web-Quellen nicht im Antworttext, sondern in
// groundingMetadata. Ohne diese Angaben blieb fast jede Gemini-Antwort ohne
// Quelle. Der Stand je System (gefragt, beantwortet, Fehlergrund) wird in
// ai_visibility_reports.parts.eng abgelegt, damit ein stummes System im
// Systemcheck sichtbar wird.

export type GroundingRef = { uri: string; host: string };
export type EngineStand = { gefragt: number; beantwortet: number; fehler?: string };
/** parts.eng: je Abschnitt (Offset) der Messung der Stand je System. */
export type EngineTeile = Record<string, Record<string, EngineStand>>;

const MAX_QUELLEN = 20;
const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/**
 * Web-Quellen aus einem Gemini-Kandidaten. `uri` ist der Weiterleitungs-Link
 * von Google, `host` die Domain der Quelle (steht bei Gemini im Titel), sonst
 * leer. Ohne Doppelte, höchstens 20. Pure.
 */
export function groundingRefs(candidate: unknown): GroundingRef[] {
  const chunks = (candidate as any)?.groundingMetadata?.groundingChunks;
  const out: GroundingRef[] = [];
  const gesehen = new Set<string>();
  for (const c of Array.isArray(chunks) ? chunks : []) {
    const uri = String(c?.web?.uri ?? "").trim();
    if (!/^https?:\/\//i.test(uri)) continue;
    const titel = String(c?.web?.title ?? "")
      .trim()
      .toLowerCase()
      .replace(/^www\./, "");
    const host = HOST_RE.test(titel) ? titel : "";
    const k = host || uri;
    if (gesehen.has(k)) continue;
    gesehen.add(k);
    out.push({ uri, host });
    if (out.length >= MAX_QUELLEN) break;
  }
  return out;
}

/** Gehört der Host zur Domain (gleich oder Subdomain)? Pure. */
export function hostGehoertZu(host: string, domain: string): boolean {
  const d = String(domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^www\./, "");
  return !!host && !!d && (host === d || host.endsWith(`.${d}`));
}

/** Listen zusammenführen: nur nicht leere Texte, ohne Doppelte, Reihenfolge bleibt. Pure. */
export function vereint(...listen: unknown[]): string[] {
  const out: string[] = [];
  const gesehen = new Set<string>();
  for (const l of listen)
    for (const x of Array.isArray(l) ? l : []) {
      const s = String(x ?? "").trim();
      const k = s.toLowerCase().replace(/\/+$/, "");
      if (!s || gesehen.has(k)) continue;
      gesehen.add(k);
      out.push(s);
    }
  return out;
}

/**
 * Fehlertext eines Anbieters kürzen und entschärfen: keine Adressen (der
 * Gemini-Aufruf trägt den Schlüssel in der Adresse), keine Schlüssel, keine
 * Tokens. Pure.
 */
export function fehlerKurz(roh: unknown, max = 140): string {
  return String(roh ?? "")
    .replace(/https?:\/\/\S+/gi, "[Adresse]")
    .replace(/\b(api[_-]?key|access[_-]?token|token|key)=[^&\s"']+/gi, "$1=***")
    .replace(/\bBearer\s+\S+/gi, "Bearer ***")
    .replace(/\b(sk-|xai-|pplx-|AIza|gsk_)[A-Za-z0-9_-]{8,}/g, "***")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/** Stand je System aus einem Abschnitt der Messung. Pure. */
export function engineStaende(
  zeilen: Array<{ name: string; gefragt: number; beantwortet: number; fehler?: unknown }>,
): Record<string, EngineStand> {
  const out: Record<string, EngineStand> = {};
  for (const z of zeilen) {
    if (!z.name || z.gefragt <= 0) continue;
    const fehler =
      fehlerKurz(z.fehler) || (z.beantwortet === 0 ? "kein Key gesetzt oder leere Antwort" : "");
    out[z.name] = {
      gefragt: z.gefragt,
      beantwortet: z.beantwortet,
      ...(fehler ? { fehler } : {}),
    };
  }
  return out;
}

/** Stand eines Abschnitts in parts.eng einfügen (gleicher Abschnitt: je System ersetzen). Pure. */
export function engineTeileMit(
  bisher: unknown,
  offset: number,
  stand: Record<string, EngineStand>,
): EngineTeile {
  const alt: EngineTeile = bisher && typeof bisher === "object" ? (bisher as EngineTeile) : {};
  const k = String(offset);
  return { ...alt, [k]: { ...(alt[k] || {}), ...stand } };
}

const datumCH = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".");

/**
 * Befund für den Systemcheck: je Kunde zählt die neueste Messung. Liefert nur
 * Status und Kurzdetail (Systemnamen, Zahlen, Fehlergrund), nie Inhalte. Pure.
 */
export function engineBefund(
  berichte: Array<{ client_id?: unknown; snapshot_date?: unknown; eng?: unknown }>,
  tage: number,
): { status: "vorhanden" | "fehlerhaft" | "nicht_pruefbar"; detail: string } {
  const neueste = new Map<string, { datum: string; eng: unknown }>();
  for (const b of berichte) {
    const id = String(b.client_id ?? "");
    const datum = String(b.snapshot_date ?? "");
    if (!id || !datum) continue;
    const da = neueste.get(id);
    if (!da || datum > da.datum) neueste.set(id, { datum, eng: b.eng });
  }
  if (!neueste.size)
    return { status: "nicht_pruefbar", detail: `Keine Messung in den letzten ${tage} Tagen` };

  const summe = new Map<string, EngineStand>();
  let mitStand = 0;
  let stand = "";
  for (const { datum, eng } of neueste.values()) {
    if (!eng || typeof eng !== "object") continue;
    mitStand++;
    if (datum > stand) stand = datum;
    for (const teil of Object.values(eng as EngineTeile))
      for (const [name, s] of Object.entries(teil || {})) {
        const z = summe.get(name) ?? { gefragt: 0, beantwortet: 0 };
        z.gefragt += Number(s?.gefragt || 0);
        z.beantwortet += Number(s?.beantwortet || 0);
        if (!z.fehler && s?.fehler) z.fehler = fehlerKurz(s.fehler, 100);
        summe.set(name, z);
      }
  }
  if (!mitStand || !summe.size)
    return {
      status: "nicht_pruefbar",
      detail: "Noch keine Messung mit Systemstand. Nach der nächsten Messung erneut prüfen",
    };

  const alle = [...summe.entries()].filter(([, s]) => s.gefragt > 0);
  const stumm = alle.filter(([, s]) => s.beantwortet === 0);
  const zahlen = alle
    .filter(([, s]) => s.beantwortet > 0)
    .map(([n, s]) => `${n} ${s.beantwortet}/${s.gefragt}`)
    .join(", ");
  const fuss = `Stand ${datumCH(stand)}, ${mitStand} ${mitStand === 1 ? "Kunde" : "Kunden"}`;
  if (stumm.length)
    return {
      status: "fehlerhaft",
      detail: `Ohne Antwort: ${stumm
        .map(([n, s]) => `${n} (${s.fehler || "Grund unbekannt"})`)
        .join("; ")}. ${zahlen ? `Antworten: ${zahlen}. ` : ""}${fuss}`,
    };
  return { status: "vorhanden", detail: `Antworten: ${zahlen}. ${fuss}` };
}
