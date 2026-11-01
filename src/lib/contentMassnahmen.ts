// Content-Massnahmen (EzyRank, Blog-Register): EINE Quelle fuer Texte und
// Regeln, die das Massnahmen-Modal (ContentModule.jsx), die KI-Empfehlung
// (/api/content/refresh-brief) und die Admin-Routen /api/admin/content-actions*
// gemeinsam nutzen (01.11.2026 aus ContentModule.jsx/refresh-brief verschoben,
// Texte unveraendert). Die Regeln/Schwellen selbst rechnet die SQL-View
// content_decision (28-Tage-Fenster) — hier wird nichts neu berechnet.

/** Kurztitel und Kurz-Aktion je Empfehlung (Farben setzt das UI). */
export const REC_TEXTE: Record<string, { t: string; a: string }> = {
  not_indexed: {
    t: "Nicht im Google-Index",
    a: "Auffindbarkeit herstellen – Content-Massnahmen wirken hier nicht",
  },
  refresh_decay: { t: "Decay – Refresh fällig", a: "Freshness-Update gegen aktuelle SERP" },
  tech_fix: { t: "Technik prüfen", a: "An Tech/Agent (Index/interne Links) – nicht Content" },
  consolidate: { t: "Kannibalisierung – zusammenführen", a: "Zwei Artikel mergen" },
  push_expand: {
    t: "Striking Distance – ausbauen",
    a: "Content erweitern, E-E-A-T, Intent schärfen",
  },
  ctr_fix: { t: "Title/Meta optimieren", a: "Snippet überarbeiten (kein Volltext-Refresh)" },
  ceiling_new_kw: { t: "Keyword-Ceiling – neues Ziel", a: "Nicht refreshen – neues KW/Strategie" },
  low_visibility: {
    t: "Kaum sichtbar",
    a: "Sichtbarkeit aufbauen: Keyword-Fokus, Intent, interne Links",
  },
  stable_hold: { t: "Stabil", a: "Nichts tun" },
  monitor: { t: "Beobachten", a: "Beobachten" },
  maturing_wait: { t: "Reift noch", a: "Warten (< 30 Tage)" },
  insufficient_data: {
    t: "Zu wenig Daten",
    a: "Beobachten, kein Urteil (Messfenster füllt sich noch)",
  },
  unpublished: { t: "Unpubliziert", a: "—" },
};

/** Empfehlungen mit Handlungsbedarf (Filter «Nur handlungsbedürftig» + Modal). */
export const ACTION_RECS = [
  "not_indexed",
  "tech_fix",
  "ctr_fix",
  "push_expand",
  "refresh_decay",
  "consolidate",
  "ceiling_new_kw",
  "low_visibility",
];

// Massnahmen-Playbook je Empfehlung (Kurzfassung von content-fix-playbook/fix-procedures.md)
// fuer das Mitarbeiter-Pop-up: Befund -> konkrete Schritte -> Exit-Kriterium.
export const REC_PLAYBOOK: Record<string, { befund: string; schritte: string[]; exit: string }> = {
  not_indexed: {
    befund:
      'Google hat den Artikel nicht im Index — geprüft über die GSC-URL-Prüfung. Steht dort "URL is unknown to Google", hat Google die Seite noch nie gesehen: das ist ein Auffindbarkeits-Problem, kein Qualitätsproblem. Solange das so ist, bleibt JEDE Content-Massnahme wirkungslos.',
    schritte: [
      "Erreichbarkeit bestätigen: Seite liefert HTTP 200, kein noindex, Canonical zeigt auf sich selbst, robots.txt erlaubt den Zugriff.",
      "Sitemap prüfen: Ist der Artikel in der Sitemap UND ist die Sitemap in der Search Console eingereicht? (Ein Eintrag in der robots.txt allein reicht Google oft nicht.)",
      "Interne Verlinkung prüfen — der häufigste Grund: Verlinkt eine bereits indexierte Seite auf den Artikel? Eine Blog-Übersicht, die selbst nicht im Index ist, vererbt nichts. Links von starken, indexierten Seiten setzen.",
      'In der GSC "Indexierung beantragen" für die betroffenen URLs auslösen (manuell, wirkt pro URL).',
      "KEINEN Refresh und keine Title-Optimierung vornehmen — beides ändert am Indexstatus nichts.",
    ],
    exit: 'Artikel in der GSC-URL-Prüfung auf "URL ist auf Google"; Re-Check in 2–3 Wochen.',
  },
  ctr_fix: {
    befund:
      "Gute Position (Top 10), Impressionen vorhanden, aber kaum Klicks — das Problem sitzt im Snippet, nicht im Inhalt.",
    schritte: [
      "SERP für das Ziel-Keyword ansehen: welche Snippets gewinnen den Klick — und warum?",
      "Title neu schreiben: Ziel-Keyword vorn, konkreter Nutzen/Differenzierung, Zahl/Jahr wo sinnvoll, unter 60 Zeichen.",
      "Meta-Description: Suchintention beantworten + klarer Grund zu klicken, 150–160 Zeichen.",
      "KEIN Volltext-Refresh — der Inhalt rankt bereits.",
    ],
    exit: "Neuer Title/Meta nach QA live; Re-Test in 3–4 Wochen auf CTR terminieren.",
  },
  push_expand: {
    befund:
      "Position 11–20 — knapp vor Seite 1. Höchster Refresh-ROI: ein gezielter Schub bringt überproportional Traffic.",
    schritte: [
      "Top 5 der SERP analysieren: welche Subtopics/Fragen decken sie ab, die diesem Artikel fehlen?",
      "Lücken als Answer-first-Blöcke schliessen: Frage als H2, Antwort im ersten Satz, 130–170 Wörter.",
      "E-E-A-T stärken: Autor/Quellen/Aktualität sichtbar machen; interne Links von starken Seiten auf diesen Artikel setzen.",
      "Intent schärfen: passt das Format zur Suchintention (Guide vs. Liste vs. Definition)?",
    ],
    exit: "Ausbau live, interne Links gesetzt; Re-Test in 4 Wochen auf Position terminieren.",
  },
  refresh_decay: {
    befund:
      "War gut, fällt jetzt (Decay ab Tag 90) — die SERP hat sich bewegt oder der Inhalt ist veraltet.",
    schritte: [
      "Zuerst Saisonalität prüfen: gleichen Kalendermonat im Vorjahr vergleichen (GSC). Entspricht der Rückgang dem Vorjahresmuster → KEIN Refresh, nur vermerken.",
      "Aktuelle SERP vs. Artikel: was ist bei den Gewinnern neu oder anders?",
      "Veraltetes aktualisieren (Zahlen, Jahr, Fakten), fehlende neue Aspekte ergänzen — Substanz statt Kosmetik.",
      "Modified-Datum sauber setzen; interne Links prüfen.",
    ],
    exit: "Update nach QA live, Refresh datiert; Re-Test in 4 Wochen terminieren.",
  },
  consolidate: {
    befund:
      "Mehrere publizierte Artikel ranken auf demselben Keyword und nehmen sich gegenseitig die Sichtbarkeit (Kannibalisierung).",
    schritte: [
      "Stärkeren Artikel bestimmen (Position, Backlinks, Traffic).",
      "Einzigartige Inhalte des schwächeren Artikels in den stärkeren mergen.",
      "Schwächeren per 301 auf den stärkeren umleiten — Redirect ist strukturell: erst Freigabe einholen, nie eigenmächtig.",
      "Interne Links auf die neue Ziel-URL umbiegen.",
    ],
    exit: "Merge + Redirect live; Re-Test in 4–6 Wochen terminieren.",
  },
  tech_fix: {
    befund:
      "Keine verwertbare Position trotz Sichtbarkeitsdaten — das Problem liegt in der Technik (Indexierung, interne Verlinkung, Crawlbarkeit), nicht im Text.",
    schritte: [
      "Indexierungsstatus prüfen (GSC URL-Prüfung: ist die Seite im Index?).",
      "Interne Verlinkung prüfen: erreichen starke Seiten diesen Artikel?",
      "An Technik/SEO übergeben — an diesem Artikel KEINE Text-Änderung vornehmen.",
    ],
    exit: "Übergabe/Ticket an Technik erstellt; Artikel bleibt unverändert.",
  },
  low_visibility: {
    befund:
      "Über 90 Tage publiziert und volle Messabdeckung, aber unter 100 Impressionen in 28 Tagen — Google zeigt den Artikel kaum. Meist kein Technik-, sondern ein Relevanz-Problem (Keyword ohne Nachfrage, Intent-Mismatch, fehlende interne Links).",
    schritte: [
      "Indexierung einmal bestätigen (GSC URL-Prüfung). Nicht indexiert → als Technik-Fall behandeln.",
      "Saisonalität prüfen: Winterthemen sind im Sommer natürlich unsichtbar — dann nur für die Saison terminieren, nichts ändern.",
      "Ziel-Keyword hinterfragen: hat es Suchvolumen, und deckt der Artikel die Suchintention (Format, Tiefe)? GSC-Top-Query mit dem gemeinten Thema vergleichen.",
      "Interne Links von starken Seiten (Startseite, Hub-Seiten) auf den Artikel setzen — unsichtbare Artikel sind oft Waisen.",
      "Title/H1 auf das Ziel-Keyword schärfen; ggf. auf ein nachgefragtes, angrenzendes Keyword erweitern.",
    ],
    exit: "Massnahmen live; Re-Check in 6–8 Wochen mit Ziel >100 Impressionen/28 Tage.",
  },
  ceiling_new_kw: {
    befund:
      "Rankt bereits top, aber das Keyword hat zu wenig Suchvolumen — ein Refresh bringt hier nichts mehr.",
    schritte: [
      "Keinen Refresh an diesem Artikel durchführen.",
      "Grösseres, angrenzendes Ziel-Keyword identifizieren (Keyword-Recherche).",
      "Entscheiden: bestehenden Artikel auf das neue Keyword erweitern ODER zusätzlichen Artikel für die angrenzende Nachfrage planen.",
    ],
    exit: "Neues Keyword-Ziel an Strategie/Content-Planung übergeben.",
  },
};

// Was die jeweilige Empfehlung bedeutet + worauf sich der Plan konzentrieren soll.
export const REC_FOCUS: Record<string, string> = {
  ctr_fix:
    "Das Snippet verliert den Klick, nicht der Inhalt. Liefere 3 konkrete neue Title-Varianten (<=60 Zeichen, Keyword vorn, klarer Klick-Grund) und 2 Meta-Description-Varianten (150-160 Zeichen) fuer GENAU diesen Artikel. KEIN Volltext-Refresh empfehlen.",
  push_expand:
    "Position 11-20 (Striking Distance). Benenne die konkreten fehlenden Subtopics/Fragen als vorgeschlagene neue H2-Ueberschriften (mit 1 Satz, was darunter stehen soll), 3-5 FAQ-Fragen im Answer-first-Format und 2-3 interne Link-Quellen-Ideen (Seitentypen, die auf den Artikel verlinken sollten).",
  refresh_decay:
    "Der Artikel faellt gegen seinen eigenen Peak. Benenne konkret, WAS zu aktualisieren ist: veraltete Jahres-/Zahlenangaben, fehlende neue Aspekte des Themas, Freshness-Signale. Weise zuerst auf den Saisonalitaets-Check hin (Vorjahresmonat in GSC vergleichen), bevor refresht wird.",
  consolidate:
    "Kannibalisierung: mehrere Artikel desselben Kunden ranken auf dem Keyword. Beschreibe, welche einzigartigen Inhalte dieses Artikels in den staerkeren Artikel zu mergen waeren und was beim 301-Redirect zu beachten ist (Redirect nur nach Freigabe).",
  tech_fix:
    "Kein Text-Problem: pruefe Indexierung/interne Verlinkung. Liste die konkreten Pruefschritte (GSC-URL-Pruefung, interne Links, Sitemap) — KEINE Textaenderungen vorschlagen.",
  ceiling_new_kw:
    "Rankt bereits top, Keyword-Volumen ist zu klein. Schlage 3-5 angrenzende, groessere Ziel-Keywords/Themen vor, die zum Artikelthema passen, und ob Erweiterung oder neuer Artikel sinnvoller ist. KEINEN Refresh dieses Artikels empfehlen.",
  low_visibility:
    "Der Artikel ist alt genug und die Messung vollstaendig, aber Google spielt ihn kaum aus (<100 Impressionen/28T). Beurteile zuerst Saisonalitaet (Thema vs. Jahreszeit!) — dann: passt das Ziel-Keyword (Nachfrage? Intent?), welche konkreten internen Link-Quellen fehlen, und wie waeren Title/H1 auf ein nachgefragtes Keyword zu schaerfen? Konkrete Keyword-Alternativen mit Begruendung nennen.",
};

// ── Admin-Routen /api/admin/content-actions (01.11.2026) ──────────────────────

/** Öffentlicher Typ-Name je Empfehlung (push_expand heisst nach aussen striking_distance). */
export const TYP_VON_REC: Record<string, string> = {
  not_indexed: "not_indexed",
  tech_fix: "tech_fix",
  ctr_fix: "ctr_fix",
  push_expand: "striking_distance",
  refresh_decay: "refresh_decay",
  consolidate: "consolidate",
  ceiling_new_kw: "ceiling_new_kw",
  low_visibility: "low_visibility",
};

/** Typ (oder interner Schlüssel) → interner Empfehlungs-Schlüssel; null = unbekannt. */
export function recVonTyp(typ: unknown): string | null {
  const t = String(typ ?? "").trim();
  if (TYP_VON_REC[t]) return t;
  const hit = Object.entries(TYP_VON_REC).find(([, v]) => v === t);
  return hit ? hit[0] : null;
}

// Dringlichkeit wie die Agenten-Read-Bridge /api/admin/content-decision (ORDER):
// ohne Index wirkt keine andere Massnahme, dann Technik/Kannibalisierung, Decay,
// Ausbau, CTR, Ceiling, Sichtbarkeit.
const DRINGLICHKEIT: Record<string, number> = {
  not_indexed: 0,
  tech_fix: 1,
  consolidate: 2,
  refresh_decay: 3,
  push_expand: 4,
  ctr_fix: 5,
  ceiling_new_kw: 6,
  low_visibility: 7,
};

/**
 * Priorität: Dringlichkeits-Stufe (80 … 10, je 10 Punkte) plus Potenzial
 * innerhalb der Stufe (0–9.9, aus Impressionen 28T und verlorenen Klicks
 * gegen den eigenen Peak). Die Stufen überschneiden sich nie.
 */
export function prioritaet(r: {
  recommendation?: unknown;
  impr_28?: unknown;
  clicks_28?: unknown;
  peak_clicks_28?: unknown;
}): number {
  const stufe = DRINGLICHKEIT[String(r.recommendation)];
  if (stufe == null) return 0;
  const impr = Math.max(0, Number(r.impr_28) || 0);
  const verlust = Math.max(0, (Number(r.peak_clicks_28) || 0) - (Number(r.clicks_28) || 0));
  const pot = Math.min(9.9, Math.log10(1 + impr) * 1.8 + Math.log10(1 + verlust) * 1.2);
  return Math.round(((8 - stufe) * 10 + pot) * 10) / 10;
}

export type ContentAction = {
  action_id: string;
  type: string;
  label: string;
  url: string;
  title: string;
  keyword: string | null;
  clicks_28d: number;
  clicks_peak: number;
  position_avg: number | null;
  impressions_28d: number;
  befund: string;
  steps: string[];
  done_when: string;
  priority_score: number;
};

const zahl = (v: unknown) => (v == null || v === "" ? 0 : Number(v) || 0);

/** content_decision-Zeilen → offene Massnahmen (wie Modal), nach Priorität absteigend. */
export function baueAktionen(rows: Array<Record<string, unknown>>): ContentAction[] {
  const out: ContentAction[] = [];
  for (const r of rows) {
    const rec = String(r.recommendation ?? "");
    const pb = REC_PLAYBOOK[rec];
    if (!ACTION_RECS.includes(rec) || !pb) continue;
    const type = TYP_VON_REC[rec] ?? rec;
    const url = String(r.url ?? "");
    const pos = r.position_28 == null ? null : Number(r.position_28);
    out.push({
      action_id: `${type}|${url}`,
      type,
      label: REC_TEXTE[rec]?.t ?? rec,
      url,
      title: String(r.title ?? ""),
      keyword: r.primary_keyword ? String(r.primary_keyword) : null,
      clicks_28d: zahl(r.clicks_28),
      clicks_peak: zahl(r.peak_clicks_28),
      position_avg: pos != null && Number.isFinite(pos) ? pos : null,
      impressions_28d: zahl(r.impr_28),
      befund: pb.befund,
      steps: [...pb.schritte],
      done_when: pb.exit,
      priority_score: prioritaet(r),
    });
  }
  return out.sort(
    (a, b) => b.priority_score - a.priority_score || a.action_id.localeCompare(b.action_id),
  );
}

/** Ersetzt ß durch ss (Ausgabe Deutsch-Schweiz), rekursiv über Strings in Objekten/Arrays. */
export function ohneEszett<T>(v: T): T {
  if (typeof v === "string") return v.replace(/ß/g, "ss") as T;
  if (Array.isArray(v)) return v.map((x) => ohneEszett(x)) as T;
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, ohneEszett(x)]),
    ) as T;
  return v;
}
