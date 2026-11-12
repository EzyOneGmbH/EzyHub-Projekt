import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Feld,
  Hinweis,
  Karte,
  Knopf,
  MODUS_TEXT,
  P,
  StatusMarke,
  api,
  datumText,
  eingabe,
  tagLokal,
  zeitText,
} from "@/ezy/BlogUi";

// Blog-Autopilot: «Artikel prüfen» (Kap. 6.5, 6.6, 9). Lesemodus mit markierten
// offenen Behauptungen, Faktencheck, WordPress-Status, Freigabe und Regeln aus
// Feedback. Ezy One kann Titel, SEO-Felder und Text bearbeiten. Jeder Schritt
// läuft über /api/blog/*: dort werden Zugriff und Statuswechsel geprüft.

type Meldung = { ton: "fehler" | "ok" | "info"; text: string };

const FEHLER = "Das hat nicht geklappt. Bitte nochmals versuchen.";

const CLAIM_TYP: Record<string, string> = {
  zahl: "Zahl",
  statistik: "Statistik",
  zitat: "Zitat",
  rechtlich: "Rechtliches",
  preis: "Preis",
  sonstiges: "Sonstiges",
};

const WP_STATUS: Record<string, string> = {
  draft: "Entwurf",
  pending: "Wartet auf Review",
  future: "Geplant",
  publish: "Veröffentlicht",
  private: "Privat",
  trash: "Im Papierkorb",
  fehlt: "Nicht gefunden",
};

const spanNr = (c: any): string | null => /^span:(\d+)$/.exec(String(c?.note || ""))?.[1] ?? null;

const httpUrl = (u: unknown): string | null =>
  typeof u === "string" && /^https?:\/\//i.test(u) ? u : null;

// ── HTML für die Anzeige säubern ───────────────────────────────────────────
// Der Server liefert bereits bereinigtes HTML. Vor dem Einsetzen in die Seite
// wird trotzdem nochmals nach fester Liste gefiltert.

const ERLAUBT: Record<string, string[]> = {
  h2: ["id"],
  h3: ["id"],
  h4: ["id"],
  p: ["class"],
  ul: [],
  ol: [],
  li: [],
  a: ["href", "title"],
  strong: [],
  b: [],
  em: [],
  i: [],
  br: [],
  hr: [],
  blockquote: [],
  figure: [],
  figcaption: [],
  img: ["src", "alt", "width", "height"],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  th: ["colspan", "rowspan"],
  td: ["colspan", "rowspan"],
  details: [],
  summary: [],
  span: ["data-claim"],
};

const GANZ_WEG = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "svg",
  "math",
  "template",
  "noscript",
  "form",
  "input",
  "button",
  "textarea",
  "select",
  "link",
  "meta",
  "base",
]);

function sicheresHtml(html: string, neuerTab: boolean): string {
  if (typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
  const putze = (knoten: Element) => {
    for (const kind of Array.from(knoten.children)) {
      const name = kind.tagName.toLowerCase();
      if (GANZ_WEG.has(name)) {
        kind.remove();
        continue;
      }
      putze(kind);
      const erlaubt = ERLAUBT[name];
      if (!erlaubt) {
        kind.replaceWith(...Array.from(kind.childNodes));
        continue;
      }
      for (const attr of Array.from(kind.attributes)) {
        const k = attr.name.toLowerCase();
        const w = attr.value.trim();
        const ok =
          erlaubt.includes(k) &&
          (k !== "href" || /^(https?:\/\/|mailto:|tel:|#)/i.test(w)) &&
          (k !== "src" || /^https:\/\//i.test(w)) &&
          (k !== "data-claim" || /^\d{1,5}$/.test(w));
        if (!ok) kind.removeAttribute(attr.name);
      }
      if (name === "a" && neuerTab) {
        kind.setAttribute("target", "_blank");
        kind.setAttribute("rel", "noopener noreferrer");
      }
    }
  };
  putze(doc.body);
  return doc.body.innerHTML;
}

// ── Darstellung ────────────────────────────────────────────────────────────

const STIL = `
.ezr-raster{display:grid;grid-template-columns:minmax(0,1fr);gap:24px;align-items:start}
@media (min-width:1000px){
  .ezr-raster{grid-template-columns:minmax(0,1fr) 340px;gap:32px}
  .ezr-rand{position:sticky;top:16px;max-height:calc(100vh - 32px);overflow-y:auto}
}
.ezr-seite button:focus-visible,.ezr-seite a:focus-visible,.ezr-seite input:focus-visible,.ezr-seite textarea:focus-visible,.ezr-seite summary:focus-visible{outline:2px solid ${P.accent};outline-offset:2px}
.ezr-artikel{font-size:17px;line-height:1.65;color:${P.text};overflow-wrap:anywhere}
.ezr-artikel h2{font-size:24px;line-height:1.25;margin:32px 0 12px}
.ezr-artikel h3{font-size:19px;line-height:1.3;margin:24px 0 8px}
.ezr-artikel h4{font-size:17px;margin:20px 0 6px}
.ezr-artikel p{margin:0 0 16px}
.ezr-artikel ul,.ezr-artikel ol{margin:0 0 16px;padding-left:24px}
.ezr-artikel li{margin:0 0 6px}
.ezr-artikel a{color:${P.accent};text-decoration:underline;text-underline-offset:2px}
.ezr-artikel blockquote{margin:0 0 16px;padding:4px 0 4px 16px;border-left:3px solid ${P.input};color:${P.muted}}
.ezr-artikel img{max-width:100%;height:auto;border-radius:12px}
.ezr-artikel figure{margin:0 0 16px}
.ezr-artikel figcaption{font-size:13px;color:${P.muted}}
.ezr-artikel table{display:block;overflow-x:auto;border-collapse:collapse;margin:0 0 16px;font-size:15px}
.ezr-artikel th,.ezr-artikel td{border:1px solid ${P.input};padding:8px 10px;text-align:left}
.ezr-artikel hr{border:none;border-top:1px solid ${P.input};margin:24px 0}
.ezr-artikel details{margin:0 0 12px}
.ezr-artikel summary{font-weight:700;cursor:pointer}
.ezr-artikel p.ezyrank-cta{background:${P.accentDim};padding:16px 20px;margin:0}
.ezr-artikel p.ezyrank-cta-text{margin-top:28px;border-radius:14px 14px 0 0;font-weight:600;padding-bottom:6px}
.ezr-artikel p.ezyrank-cta-button{margin-bottom:28px;border-radius:0 0 14px 14px;padding-top:6px}
.ezr-artikel p.ezyrank-cta-button a{display:inline-flex;align-items:center;min-height:44px;padding:0 20px;border-radius:99px;background:${P.grad};color:#fff;text-decoration:none}
.ezr-artikel[contenteditable="true"]{border:1px solid ${P.input};border-radius:14px;padding:18px 20px;background:#fff;min-height:320px}
.ezr-artikel[contenteditable="true"]:focus-visible{outline:2px solid ${P.accent};outline-offset:2px}
`;

const klein: React.CSSProperties = { fontSize: 13.5, color: P.muted, lineHeight: 1.45 };

const verweis: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 44,
  color: P.accent,
  fontSize: 14,
  fontWeight: 700,
  textDecoration: "none",
  overflowWrap: "anywhere",
};

function Block({ titel, children }: { titel: string; children: ReactNode }) {
  return (
    <Karte style={{ padding: "16px 16px", gap: 10, borderRadius: 16 }}>
      <h2 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: P.text }}>{titel}</h2>
      {children}
    </Karte>
  );
}

function Werkzeug({
  children,
  onClick,
  title,
}: {
  children: ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      // Auswahl im Text behalten: der Knopf nimmt den Fokus nicht.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      style={{
        minHeight: 44,
        minWidth: 44,
        padding: "0 12px",
        borderRadius: 10,
        border: `1px solid ${P.input}`,
        background: "#fff",
        color: P.text,
        fontSize: 14,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function Rahmen({ children }: { children: ReactNode }) {
  return (
    <div className="ezr-seite" style={{ minHeight: "100vh", background: P.bg, color: P.text }}>
      <style dangerouslySetInnerHTML={{ __html: STIL }} />
      <main style={{ maxWidth: 1120, margin: "0 auto", padding: "20px 16px 80px" }}>
        <a href="/ezyrank?tab=blog" style={{ ...verweis, color: P.muted }}>
          ← Zurück zum Blog
        </a>
        {children}
      </main>
    </div>
  );
}

export default function BlogArtikel({ id }: { id: string }) {
  const [daten, setDaten] = useState<any>(null);
  const [ladeFehler, setLadeFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<Meldung | null>(null);
  const [frage, setFrage] = useState<string | null>(null);
  const [aktiv, setAktiv] = useState<string | null>(null);
  const [quelle, setQuelle] = useState<Record<string, string>>({});
  const [bearbeiten, setBearbeiten] = useState(false);
  const [form, setForm] = useState({ title: "", seo_title: "", meta_description: "", excerpt: "" });
  const [startHtml, setStartHtml] = useState("");
  const [dirty, setDirty] = useState(false);
  const [linkOffen, setLinkOffen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [regel, setRegel] = useState("");
  const [auswahl, setAuswahl] = useState("");
  const textRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const bereich = useRef<Range | null>(null);

  const lade = useCallback(async () => {
    const r = await api(`/api/blog/articles/${id}`);
    if (r.ok && r.json?.ok) {
      setDaten(r.json);
      setLadeFehler(null);
      return;
    }
    setLadeFehler(
      r.json?.error ||
        (r.status === 404 ? "Artikel nicht gefunden" : "Der Artikel konnte nicht geladen werden."),
    );
  }, [id]);

  useEffect(() => {
    void lade();
  }, [lade]);

  // Solange geschrieben wird, von selbst nachladen.
  const status: string = daten?.article?.status ?? "";
  useEffect(() => {
    if (bearbeiten || (status !== "freigegeben" && status !== "schreibt")) return;
    const t = window.setInterval(() => void lade(), 15_000);
    return () => window.clearInterval(t);
  }, [status, bearbeiten, lade]);

  const rohHtml: string = daten?.article?.content_html || "";
  const html = useMemo(() => sicheresHtml(rohHtml, true), [rohHtml]);

  // Der Editor ist nicht von React gesteuert: Inhalt einmal beim Öffnen setzen.
  useEffect(() => {
    if (!bearbeiten || !editorRef.current) return;
    editorRef.current.innerHTML = startHtml;
    try {
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // Ohne den Befehl entstehen <div>-Absätze; der Server macht daraus <p>.
    }
  }, [bearbeiten, startHtml]);

  if (!daten) {
    return (
      <Rahmen>
        <div style={{ marginTop: 24 }}>
          {ladeFehler ? (
            <Hinweis ton="fehler">{ladeFehler}</Hinweis>
          ) : (
            <div style={klein}>Lädt…</div>
          )}
        </div>
      </Rahmen>
    );
  }

  const a = daten.article;
  const agentur: boolean = !!daten.agentur;
  const wp = daten.wp ?? {};
  const claims: any[] = daten.claims ?? [];
  const offen = claims.filter((c) => c.status === "offen");
  const erledigt = claims.filter((c) => c.status !== "offen");
  const belegt = claims.filter((c) => c.status === "belegt" || c.status === "manuell_belegt");
  const geprueft = !!a.review;
  const textEditierbar = status === "entwurf_wp";
  const darfBearbeiten = agentur && (status === "entwurf_wp" || status === "faktencheck");
  const wpStatus: string | null = a.wordpress?.status ?? null;
  const freigabeText = wp.kann_veroeffentlichen ? "Freigeben und live schalten" : "Freigeben";

  const markierung =
    offen
      .map(spanNr)
      .filter(Boolean)
      .map((n) => `.ezr-artikel span[data-claim="${n}"]`)
      .join(",") || ".ezr-keine";
  const claimStil =
    `${markierung}{background:${P.orangeDim};box-shadow:inset 0 -2px 0 ${P.orange};border-radius:3px;cursor:pointer}` +
    (aktiv
      ? `.ezr-artikel span[data-claim="${aktiv}"]{outline:2px solid ${P.orange};outline-offset:2px}`
      : "");

  const aktion = async (schluessel: string, pfad: string, body: unknown, method = "POST") => {
    setBusy(schluessel);
    setMeldung(null);
    setFrage(null);
    const r = await api(pfad, method, body);
    setBusy(null);
    if (!r.ok || !r.json?.ok) {
      setMeldung({ ton: "fehler", text: r.json?.error || FEHLER });
      return null;
    }
    return r.json;
  };

  const sanft = (): ScrollBehavior =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";

  const zeigeImText = (c: any) => {
    const n = spanNr(c);
    setAktiv(n);
    if (!n) return;
    textRef.current
      ?.querySelector(`span[data-claim="${n}"]`)
      ?.scrollIntoView({ behavior: sanft(), block: "center" });
  };

  const klickImText = (e: React.MouseEvent) => {
    const span = (e.target as HTMLElement).closest?.("span[data-claim]");
    const n = span?.getAttribute("data-claim");
    const c = n ? offen.find((x) => spanNr(x) === n) : null;
    if (!c) return;
    setAktiv(n as string);
    document
      .getElementById(`claim-${c.id}`)
      ?.scrollIntoView({ behavior: sanft(), block: "nearest" });
  };

  const merkeAuswahl = () => {
    const t = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (t.length >= 3) setAuswahl(t.slice(0, 500));
  };

  const loeseClaim = async (c: any, action: "belegen" | "entfernen") => {
    const body =
      action === "belegen" ? { action, source_url: (quelle[c.id] || "").trim() } : { action };
    const j = await aktion(`claim:${c.id}`, `/api/blog/claims/${c.id}/resolve`, body);
    if (!j) return;
    setAktiv(null);
    await lade();
    const teile = [
      action === "belegen" ? "Quelle gespeichert." : "Satz entfernt.",
      j.hinweis || "",
      j.offen === 0
        ? j.weiter
          ? "Faktencheck abgeschlossen: der Entwurf wird jetzt an WordPress gesendet."
          : "Faktencheck abgeschlossen."
        : "",
    ];
    setMeldung({ ton: j.hinweis ? "info" : "ok", text: teile.filter(Boolean).join(" ") });
  };

  const freigeben = async (action: "review" | "review_zurueck" | "approve" | "erledigt") => {
    const j = await aktion(action, `/api/blog/articles/${id}/approve`, { action });
    if (!j) return;
    await lade();
    const text: Record<string, string> = {
      review: "Als geprüft markiert. Der Kunde kann den Artikel jetzt ansehen und freigeben.",
      review_zurueck: "Prüfung zurückgenommen. Der Kunde sieht den Artikel nicht mehr.",
      approve: "Freigegeben.",
      erledigt: "Als veröffentlicht markiert.",
    };
    setMeldung({ ton: "ok", text: j.hinweis || text[action] });
  };

  const sendeWp = async () => {
    const j = await aktion("senden", `/api/blog/articles/${id}/sync-wp`, { mode: "senden" });
    if (!j) return;
    await lade();
    setMeldung({ ton: "ok", text: "Änderungen an WordPress gesendet." });
  };

  const pruefeWp = async () => {
    const j = await aktion("wpstatus", `/api/blog/articles/${id}/sync-wp`, { mode: "status" });
    if (!j) return;
    await lade();
    const s = j.wp?.status ? (WP_STATUS[j.wp.status] ?? j.wp.status) : null;
    setMeldung({
      ton: j.hinweis ? "info" : "ok",
      text: j.hinweis || (s ? `Status in WordPress: ${s}.` : "Status abgeglichen."),
    });
  };

  const starteBearbeiten = () => {
    setForm({
      title: a.title || "",
      seo_title: a.seo_title || "",
      meta_description: a.meta_description || "",
      excerpt: a.excerpt || "",
    });
    setStartHtml(sicheresHtml(a.content_html || "", false));
    setDirty(false);
    setLinkOffen(false);
    setMeldung(null);
    setBearbeiten(true);
  };

  const speichere = async () => {
    if (form.title.trim().length < 3) {
      setMeldung({ ton: "fehler", text: "Der Titel braucht mindestens 3 Zeichen." });
      return;
    }
    const patch: Record<string, string> = {};
    for (const k of ["title", "seo_title", "meta_description", "excerpt"] as const) {
      if (form[k].trim() !== String(a[k] || "").trim()) patch[k] = form[k].trim();
    }
    // Den Text nur mitschicken, wenn er wirklich angefasst wurde (sonst
    // entstünde bei jedem Speichern eine leere Version).
    if (textEditierbar && dirty && editorRef.current)
      patch.content_html = editorRef.current.innerHTML;
    if (Object.keys(patch).length === 0) {
      setBearbeiten(false);
      return;
    }
    const j = await aktion("speichern", `/api/blog/articles/${id}`, patch, "PATCH");
    if (!j) return;
    setBearbeiten(false);
    await lade();
    const nachWp = !a.nur_hub && !!a.wp_post_id && status === "entwurf_wp";
    setMeldung({
      ton: "ok",
      text:
        (j.geaendert ?? []).length === 0
          ? "Keine Änderungen."
          : nachWp
            ? "Gespeichert. Sende die Änderungen jetzt an WordPress."
            : "Gespeichert.",
    });
  };

  const befehl = (name: string, wert?: string) => {
    document.execCommand(name, false, wert);
    setDirty(true);
  };

  const linkStart = () => {
    const sel = window.getSelection();
    if (
      !sel ||
      sel.rangeCount === 0 ||
      sel.isCollapsed ||
      !editorRef.current?.contains(sel.anchorNode)
    ) {
      setMeldung({ ton: "info", text: "Markiere zuerst den Text, der zum Link werden soll." });
      return;
    }
    bereich.current = sel.getRangeAt(0).cloneRange();
    setLinkUrl("");
    setLinkOffen(true);
  };

  const linkSetzen = () => {
    const url = linkUrl.trim();
    if (!/^(https?:\/\/|mailto:|tel:)\S+$/i.test(url)) {
      setMeldung({
        ton: "fehler",
        text: "Der Link braucht eine vollständige Adresse (https://…).",
      });
      return;
    }
    editorRef.current?.focus();
    const sel = window.getSelection();
    if (sel && bereich.current) {
      sel.removeAllRanges();
      sel.addRange(bereich.current);
    }
    befehl("createLink", url);
    setLinkOffen(false);
    setMeldung(null);
  };

  const speichereRegel = async () => {
    const text = regel.trim();
    if (text.length < 3) return;
    const j = await aktion("regel", `/api/blog/projects/${a.project_id}/rules`, {
      rule: text,
      source: "feedback",
      ...(auswahl ? { anchor_excerpt: auswahl } : {}),
    });
    if (!j) return;
    setRegel("");
    setAuswahl("");
    setMeldung({
      ton: "ok",
      text: j.created
        ? "Regel gespeichert. Sie gilt für alle künftigen Artikel."
        : "Diese Regel gibt es schon. Sie ist aktiv.",
    });
  };

  const termin = tagLokal(a.scheduled_for);
  const bild = httpUrl(a.featured_image?.url)?.startsWith("https://") ? a.featured_image : null;
  const editUrl = httpUrl(a.wp_edit_url);
  const liveUrl = httpUrl(a.wp_permalink);
  const originalUrl = httpUrl(a.original_url);
  const quellen: any[] = (a.quellen ?? []).filter((q: any) => httpUrl(q?.url));
  const linksEntfernt: string[] = a.pruefung?.links_entfernt ?? [];
  const linksUnklar: string[] = a.pruefung?.links_unklar ?? [];

  return (
    <Rahmen>
      <style dangerouslySetInnerHTML={{ __html: claimStil }} />

      <header style={{ margin: "8px 0 24px", display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px 12px" }}>
          <StatusMarke status={status} agentur={agentur} geprueft={geprueft} />
          <span style={klein}>
            {MODUS_TEXT[a.modus] ?? a.modus}
            {termin ? ` · ${datumText(termin, true)}` : ""}
            {a.word_count ? ` · ${a.word_count} Wörter` : ""}
          </span>
        </div>
        <h1
          style={{
            margin: 0,
            fontSize: "clamp(26px, 4.5vw, 36px)",
            lineHeight: 1.15,
            fontWeight: 700,
            textWrap: "balance" as any,
            overflowWrap: "anywhere",
          }}
        >
          {a.title || a.focus_keyword || "Ohne Titel"}
        </h1>
      </header>

      <div className="ezr-raster">
        {/* ── Text ─────────────────────────────────────────────────────── */}
        <div style={{ minWidth: 0, maxWidth: 720 }}>
          {bearbeiten ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <Feld label="Titel" id="ezr-titel">
                <input
                  id="ezr-titel"
                  style={eingabe}
                  value={form.title}
                  maxLength={200}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </Feld>
              <Feld
                label="SEO-Titel"
                id="ezr-seo"
                hilfe={`${form.seo_title.length} Zeichen, ideal bis 60`}
              >
                <input
                  id="ezr-seo"
                  style={eingabe}
                  value={form.seo_title}
                  maxLength={200}
                  onChange={(e) => setForm({ ...form, seo_title: e.target.value })}
                />
              </Feld>
              <Feld
                label="Meta-Beschreibung"
                id="ezr-meta"
                hilfe={`${form.meta_description.length} Zeichen, ideal bis 155`}
              >
                <textarea
                  id="ezr-meta"
                  style={{ ...eingabe, minHeight: 84, resize: "vertical" }}
                  value={form.meta_description}
                  maxLength={400}
                  onChange={(e) => setForm({ ...form, meta_description: e.target.value })}
                />
              </Feld>
              <Feld label="Auszug" id="ezr-auszug">
                <textarea
                  id="ezr-auszug"
                  style={{ ...eingabe, minHeight: 84, resize: "vertical" }}
                  value={form.excerpt}
                  maxLength={1000}
                  onChange={(e) => setForm({ ...form, excerpt: e.target.value })}
                />
              </Feld>

              {textEditierbar ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 700 }} id="ezr-text-label">
                    Text
                  </div>
                  <div
                    role="toolbar"
                    aria-label="Text formatieren"
                    style={{ display: "flex", flexWrap: "wrap", gap: 6 }}
                  >
                    <Werkzeug title="Fett" onClick={() => befehl("bold")}>
                      Fett
                    </Werkzeug>
                    <Werkzeug title="Kursiv" onClick={() => befehl("italic")}>
                      Kursiv
                    </Werkzeug>
                    <Werkzeug title="Überschrift 2" onClick={() => befehl("formatBlock", "h2")}>
                      H2
                    </Werkzeug>
                    <Werkzeug title="Überschrift 3" onClick={() => befehl("formatBlock", "h3")}>
                      H3
                    </Werkzeug>
                    <Werkzeug title="Absatz" onClick={() => befehl("formatBlock", "p")}>
                      Absatz
                    </Werkzeug>
                    <Werkzeug title="Liste" onClick={() => befehl("insertUnorderedList")}>
                      Liste
                    </Werkzeug>
                    <Werkzeug title="Link setzen" onClick={linkStart}>
                      Link
                    </Werkzeug>
                    <Werkzeug title="Link entfernen" onClick={() => befehl("unlink")}>
                      Link entfernen
                    </Werkzeug>
                  </div>
                  {linkOffen && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "end" }}>
                      <div style={{ flex: "1 1 240px" }}>
                        <Feld label="Adresse des Links" id="ezr-link">
                          <input
                            id="ezr-link"
                            type="url"
                            inputMode="url"
                            placeholder="https://"
                            style={eingabe}
                            value={linkUrl}
                            autoFocus
                            onChange={(e) => setLinkUrl(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                linkSetzen();
                              }
                            }}
                          />
                        </Feld>
                      </div>
                      <Knopf art="sekundaer" onClick={linkSetzen}>
                        Link setzen
                      </Knopf>
                      <Knopf art="text" onClick={() => setLinkOffen(false)}>
                        Abbrechen
                      </Knopf>
                    </div>
                  )}
                  <div
                    ref={editorRef}
                    className="ezr-artikel"
                    contentEditable
                    suppressContentEditableWarning
                    role="textbox"
                    aria-multiline="true"
                    aria-labelledby="ezr-text-label"
                    onInput={() => setDirty(true)}
                    onPaste={(e) => {
                      // Nur Text einfügen: fremde Formatierung bleibt draussen.
                      e.preventDefault();
                      const text = e.clipboardData.getData("text/plain");
                      if (text) befehl("insertText", text);
                    }}
                  />
                </div>
              ) : (
                <Hinweis>
                  Der Text lässt sich erst nach dem Faktencheck bearbeiten. Titel und SEO-Felder
                  kannst du jetzt schon anpassen.
                </Hinweis>
              )}

              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                <Knopf onClick={() => void speichere()} disabled={busy !== null}>
                  {busy === "speichern" ? "Speichert…" : "Speichern"}
                </Knopf>
                <Knopf art="text" onClick={() => setBearbeiten(false)} disabled={busy !== null}>
                  Abbrechen
                </Knopf>
              </div>
            </div>
          ) : (
            <>
              {bild && (
                <img
                  src={bild.url}
                  alt={bild.alt || ""}
                  style={{ width: "100%", height: "auto", borderRadius: 14, marginBottom: 20 }}
                />
              )}
              {html ? (
                <div
                  ref={textRef}
                  className="ezr-artikel"
                  onClick={klickImText}
                  onMouseUp={merkeAuswahl}
                  onKeyUp={merkeAuswahl}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              ) : (
                <div style={klein}>
                  {status === "freigegeben" || status === "schreibt"
                    ? "Der Artikel wird gerade geschrieben. Die Seite lädt von selbst nach."
                    : "Noch kein Text vorhanden."}
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Rand ─────────────────────────────────────────────────────── */}
        <aside className="ezr-rand" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div aria-live="polite">
            {meldung && <Hinweis ton={meldung.ton}>{meldung.text}</Hinweis>}
          </div>

          <Block titel="Freigabe">
            {(status === "freigegeben" || status === "schreibt" || status === "geplant") && (
              <div style={klein}>
                Der Artikel wird geschrieben. Das dauert ein paar Minuten, die Seite lädt von selbst
                nach.
              </div>
            )}

            {status === "fehler" && (
              <Hinweis ton="fehler">
                {agentur && a.error ? a.error : "Beim Schreiben ist ein Fehler aufgetreten."}
              </Hinweis>
            )}

            {status === "faktencheck" && (
              <div style={klein}>
                {offen.length === 1
                  ? "Eine Behauptung ist noch nicht belegt."
                  : `${offen.length} Behauptungen sind noch nicht belegt.`}{" "}
                Erst danach geht der Entwurf {a.nur_hub ? "weiter" : "an WordPress"}.
              </div>
            )}

            {status === "entwurf_wp" && (
              <>
                {a.ungesendet && (
                  <Hinweis>
                    {agentur
                      ? "Deine Änderungen sind noch nicht in WordPress. Sende sie zuerst."
                      : "Ezy One überträgt noch Änderungen nach WordPress. Bitte später nochmals versuchen."}
                  </Hinweis>
                )}
                {agentur && (
                  <div style={klein}>
                    {geprueft
                      ? `Geprüft am ${zeitText(a.review?.at)}. Der Kunde kann den Artikel ansehen und freigeben.`
                      : "Noch nicht geprüft. Der Kunde sieht den Artikel erst nach deiner Prüfung."}
                  </div>
                )}
                {!agentur && (
                  <div style={klein}>
                    Ezy One hat den Artikel geprüft. Lies ihn durch und gib ihn frei. Live geht
                    nichts ohne dich.
                  </div>
                )}

                {frage === "approve" ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: 700 }}>
                      {wp.kann_veroeffentlichen
                        ? "Der Artikel wird sofort auf der Website veröffentlicht. Fortfahren?"
                        : "Artikel freigeben? Das lässt sich hier nicht zurücknehmen."}
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <Knopf onClick={() => void freigeben("approve")} disabled={busy !== null}>
                        {busy === "approve" ? "Gibt frei…" : `Ja, ${freigabeText.toLowerCase()}`}
                      </Knopf>
                      <Knopf art="text" onClick={() => setFrage(null)} disabled={busy !== null}>
                        Abbrechen
                      </Knopf>
                    </div>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {agentur && !geprueft && (
                      <Knopf
                        onClick={() => void freigeben("review")}
                        disabled={busy !== null || a.ungesendet || bearbeiten}
                      >
                        {busy === "review" ? "Speichert…" : "Als geprüft markieren"}
                      </Knopf>
                    )}
                    <Knopf
                      art={agentur && !geprueft ? "sekundaer" : "primaer"}
                      onClick={() => setFrage("approve")}
                      disabled={busy !== null || a.ungesendet || bearbeiten}
                    >
                      {freigabeText}
                    </Knopf>
                    {agentur && geprueft && (
                      <Knopf
                        art="text"
                        onClick={() => void freigeben("review_zurueck")}
                        disabled={busy !== null}
                      >
                        Prüfung zurücknehmen
                      </Knopf>
                    )}
                  </div>
                )}
              </>
            )}

            {status === "kunde_freigegeben" && (
              <>
                <div style={klein}>
                  Freigegeben{a.freigabe?.at ? ` am ${zeitText(a.freigabe.at)}` : ""}
                  {a.freigabe?.rolle === "kunde"
                    ? " vom Kunden"
                    : a.freigabe?.rolle === "agentur"
                      ? " von Ezy One"
                      : ""}
                  .{" "}
                  {a.modus === "vorschlag"
                    ? "Ezy One setzt die Änderungen auf der Seite um."
                    : a.modus === "refresh"
                      ? "Der überarbeitete Text wird in den bestehenden Beitrag übernommen."
                      : "Der Artikel wird in WordPress veröffentlicht."}
                </div>
                {agentur && (
                  <Knopf
                    art="sekundaer"
                    onClick={() => void freigeben("erledigt")}
                    disabled={busy !== null}
                  >
                    {busy === "erledigt" ? "Speichert…" : "Als veröffentlicht markieren"}
                  </Knopf>
                )}
              </>
            )}

            {status === "live" && (
              <>
                <div style={klein}>
                  Live{a.published_at ? ` seit ${zeitText(a.published_at)}` : ""}.
                </div>
                {liveUrl && (
                  <a href={liveUrl} target="_blank" rel="noopener noreferrer" style={verweis}>
                    Auf der Website ansehen
                  </a>
                )}
              </>
            )}

            {darfBearbeiten && !bearbeiten && (
              <Knopf art="sekundaer" onClick={starteBearbeiten} disabled={busy !== null}>
                {textEditierbar ? "Text und SEO bearbeiten" : "Titel und SEO bearbeiten"}
              </Knopf>
            )}
          </Block>

          {agentur && claims.length > 0 && (
            <Block titel={offen.length > 0 ? `Faktencheck (${offen.length} offen)` : "Faktencheck"}>
              {offen.length === 0 && <div style={klein}>Alle Behauptungen sind geklärt.</div>}
              {offen.length > 0 && (
                <ul
                  style={{
                    listStyle: "none",
                    margin: 0,
                    padding: 0,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                  }}
                >
                  {offen.map((c) => {
                    const n = spanNr(c);
                    const q = (quelle[c.id] || "").trim();
                    const dran = busy === `claim:${c.id}`;
                    return (
                      <li
                        key={c.id}
                        id={`claim-${c.id}`}
                        style={{
                          border: `1px solid ${n && n === aktiv ? P.orange : P.border}`,
                          background: P.orangeDim,
                          borderRadius: 12,
                          padding: "10px 12px",
                          display: "flex",
                          flexDirection: "column",
                          gap: 8,
                        }}
                      >
                        <button
                          type="button"
                          onClick={() => zeigeImText(c)}
                          disabled={!n}
                          title={n ? "Im Text zeigen" : undefined}
                          style={{
                            border: "none",
                            background: "transparent",
                            padding: 0,
                            minHeight: 44,
                            textAlign: "left",
                            font: "inherit",
                            fontSize: 14,
                            lineHeight: 1.45,
                            color: P.text,
                            cursor: n ? "pointer" : "default",
                            overflowWrap: "anywhere",
                          }}
                        >
                          «{c.claim_text}»
                        </button>
                        <div style={{ fontSize: 12.5, color: P.muted }}>
                          {CLAIM_TYP[c.claim_type] ?? "Behauptung"}
                          {n ? " · im Text markiert" : " · ohne Markierung im Text"}
                        </div>
                        <Feld label="Quelle" id={`quelle-${c.id}`}>
                          <input
                            id={`quelle-${c.id}`}
                            type="url"
                            inputMode="url"
                            placeholder="https://"
                            style={eingabe}
                            value={quelle[c.id] || ""}
                            onChange={(e) => setQuelle({ ...quelle, [c.id]: e.target.value })}
                          />
                        </Feld>
                        {frage === `weg:${c.id}` ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ fontSize: 13.5, fontWeight: 700 }}>
                              Den Satz wirklich aus dem Text entfernen?
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                              <Knopf
                                art="sekundaer"
                                onClick={() => void loeseClaim(c, "entfernen")}
                                disabled={busy !== null}
                              >
                                {dran ? "Entfernt…" : "Ja, entfernen"}
                              </Knopf>
                              <Knopf
                                art="text"
                                onClick={() => setFrage(null)}
                                disabled={busy !== null}
                              >
                                Abbrechen
                              </Knopf>
                            </div>
                          </div>
                        ) : (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                            <Knopf
                              art="sekundaer"
                              onClick={() => void loeseClaim(c, "belegen")}
                              disabled={
                                busy !== null || bearbeiten || !/^https:\/\/\S+\.\S+/.test(q)
                              }
                            >
                              {dran ? "Speichert…" : "Quelle speichern"}
                            </Knopf>
                            <Knopf
                              art="text"
                              onClick={() => setFrage(`weg:${c.id}`)}
                              disabled={busy !== null || bearbeiten}
                            >
                              Satz entfernen
                            </Knopf>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              {erledigt.length > 0 && (
                <details>
                  <summary
                    style={{ ...klein, cursor: "pointer", minHeight: 44, alignContent: "center" }}
                  >
                    Erledigt ({erledigt.length})
                  </summary>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18, ...klein }}>
                    {erledigt.map((c) => (
                      <li key={c.id} style={{ marginBottom: 8, overflowWrap: "anywhere" }}>
                        «{c.claim_text}»{" "}
                        {c.status === "entfernt" ? (
                          <span>(entfernt)</span>
                        ) : httpUrl(c.source_url) ? (
                          <a
                            href={c.source_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: P.accent }}
                          >
                            Quelle
                          </a>
                        ) : (
                          <span>(belegt)</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Block>
          )}

          {!agentur && belegt.length > 0 && (
            <Block titel="Faktencheck">
              <div style={klein}>
                {belegt.length === 1
                  ? "Eine Aussage ist mit einer Quelle belegt."
                  : `${belegt.length} Aussagen sind mit Quellen belegt.`}
              </div>
            </Block>
          )}

          <Block titel="WordPress">
            {a.nur_hub ? (
              <div style={klein}>
                {a.modus === "vorschlag"
                  ? "Das ist ein Vorschlag für eine bestehende Seite. Er bleibt im Hub, in WordPress wird nichts angelegt."
                  : "Dieser Artikel bleibt im Hub und wird von Hand in WordPress übernommen."}
              </div>
            ) : !wp.verbunden ? (
              <div style={klein}>WordPress ist nicht verbunden.</div>
            ) : !a.wp_post_id ? (
              <div style={klein}>Noch kein Entwurf in WordPress.</div>
            ) : (
              <>
                <div style={klein}>
                  {a.modus === "refresh" ? "Überarbeitung als eigener Entwurf" : "Beitrag"} Nr.{" "}
                  {a.wp_post_id}
                  {wpStatus ? ` · ${WP_STATUS[wpStatus] ?? wpStatus}` : ""}
                  {a.wordpress?.at ? ` · gesendet am ${zeitText(a.wordpress.at)}` : ""}
                </div>
                {editUrl && (
                  <a href={editUrl} target="_blank" rel="noopener noreferrer" style={verweis}>
                    In WordPress öffnen
                  </a>
                )}
                {agentur && status === "entwurf_wp" && (
                  <Knopf
                    art={a.ungesendet ? "primaer" : "sekundaer"}
                    onClick={() => void sendeWp()}
                    disabled={busy !== null || bearbeiten}
                  >
                    {busy === "senden"
                      ? "Sendet…"
                      : a.ungesendet
                        ? "Änderungen an WordPress senden"
                        : "Nochmals an WordPress senden"}
                  </Knopf>
                )}
                <Knopf art="text" onClick={() => void pruefeWp()} disabled={busy !== null}>
                  {busy === "wpstatus" ? "Prüft…" : "Status in WordPress prüfen"}
                </Knopf>
              </>
            )}
            {originalUrl && (
              <a href={originalUrl} target="_blank" rel="noopener noreferrer" style={verweis}>
                Bestehende Seite ansehen
              </a>
            )}
          </Block>

          <Block titel="SEO">
            <dl style={{ margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
              {(
                [
                  ["Fokus-Keyword", a.focus_keyword],
                  ["SEO-Titel", a.seo_title],
                  ["Meta-Beschreibung", a.meta_description],
                  ["Auszug", a.excerpt],
                ] as const
              )
                .filter(([, wert]) => !!wert)
                .map(([name, wert]) => (
                  <div key={name}>
                    <dt style={{ fontSize: 12.5, fontWeight: 700, color: P.muted }}>{name}</dt>
                    <dd
                      style={{
                        margin: 0,
                        fontSize: 14,
                        lineHeight: 1.45,
                        overflowWrap: "anywhere",
                      }}
                    >
                      {wert}
                    </dd>
                  </div>
                ))}
            </dl>
          </Block>

          {agentur && a.pruefung && (
            <Block titel="Prüfung">
              <div style={klein}>
                CTA-Blöcke im Text: {a.pruefung.cta ?? 0}
                {(a.pruefung.cta ?? 0) === 0 ? " (keiner gefunden, bitte ansehen)" : ""}
              </div>
              {linksUnklar.length > 0 && (
                <div style={klein}>
                  <div style={{ fontWeight: 700 }}>Links, die sich nicht prüfen liessen</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {linksUnklar.map((u) => (
                      <li key={u} style={{ overflowWrap: "anywhere" }}>
                        {httpUrl(u) ? (
                          <a
                            href={u}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: P.accent }}
                          >
                            {u}
                          </a>
                        ) : (
                          u
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {linksEntfernt.length > 0 && (
                <div style={klein}>
                  <div style={{ fontWeight: 700 }}>Entfernte Links (nicht erreichbar)</div>
                  <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                    {linksEntfernt.map((u) => (
                      <li key={u} style={{ overflowWrap: "anywhere" }}>
                        {u}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Block>
          )}

          {quellen.length > 0 && (
            <Block titel="Quellen der Recherche">
              <ul style={{ margin: 0, paddingLeft: 18, ...klein }}>
                {quellen.map((q) => (
                  <li key={q.url} style={{ marginBottom: 6, overflowWrap: "anywhere" }}>
                    <a
                      href={q.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: P.accent }}
                    >
                      {q.titel || q.url}
                    </a>
                  </li>
                ))}
              </ul>
            </Block>
          )}

          <Block titel="Regel für künftige Artikel">
            <div style={klein}>
              Stört dich etwas am Text? Schreib es als Regel auf. Sie gilt für alle Artikel, die
              danach geschrieben werden.
            </div>
            {auswahl ? (
              <div
                style={{
                  ...klein,
                  borderLeft: `3px solid ${P.input}`,
                  paddingLeft: 10,
                  overflowWrap: "anywhere",
                }}
              >
                Markierte Stelle: «{auswahl.length > 160 ? `${auswahl.slice(0, 160)}…` : auswahl}»{" "}
                <button
                  type="button"
                  onClick={() => setAuswahl("")}
                  style={{
                    border: "none",
                    background: "transparent",
                    color: P.accent,
                    fontWeight: 700,
                    cursor: "pointer",
                    minHeight: 44,
                    padding: "0 4px",
                    fontFamily: "inherit",
                    fontSize: 13.5,
                  }}
                >
                  Entfernen
                </button>
              </div>
            ) : (
              <div style={{ ...klein, color: P.dim }}>
                Tipp: Markiere eine Stelle im Text, dann wird sie als Beispiel mitgespeichert.
              </div>
            )}
            <Feld label="Regel" id="ezr-regel">
              <textarea
                id="ezr-regel"
                style={{ ...eingabe, minHeight: 84, resize: "vertical" }}
                value={regel}
                maxLength={1000}
                placeholder="Zum Beispiel: Keine Superlative wie «einzigartig» verwenden."
                onChange={(e) => setRegel(e.target.value)}
              />
            </Feld>
            <Knopf
              art="sekundaer"
              onClick={() => void speichereRegel()}
              disabled={busy !== null || regel.trim().length < 3}
            >
              {busy === "regel" ? "Speichert…" : "Regel speichern"}
            </Knopf>
          </Block>
        </aside>
      </div>
    </Rahmen>
  );
}
