// Content/Editor-Bereich (aus EzyOneApp.jsx extrahiert, 21.08.2026 — reines
// Verschieben): Refresh-Radar, Content-Editor, Reports und Content-Seite.
import { useState, useEffect, useMemo, useCallback } from "react";
import DataStatus from "@/ezy/DataStatus";
import WordPressPublishModal from "@/ezy/PublishFlow";
import { Badge, Btn, useToast } from "./shared-ui";
import { C } from "./theme";
import { Modal, TabBar, downloadFile } from "./ui-kit";
import { escapeHtml, markdownToHtml, sanitizeHref } from "@/ezy/lib/markdown";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertCircle,
  Award,
  Bold,
  Bookmark,
  ChevronLeft,
  Code,
  Copy,
  Download,
  FileText,
  Globe,
  Heading2,
  Heading3,
  Italic,
  Layers,
  Link2,
  PenTool,
  RefreshCw,
  Save,
  Search,
  Sparkles,
} from "lucide-react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export function ContentEditor({ item, stCo, stLb, onBack, onSave }) {
  const toast = useToast();
  const [md, setMd] = useState(item.content);
  const [showWpPublish, setShowWpPublish] = useState(false);
  const renderMd = (s) =>
    escapeHtml(s)
      .replace(
        /^### (.+)$/gm,
        '<h3 style="color:' + C.text + ';font-size:15px;margin:16px 0 8px">$1</h3>',
      )
      .replace(
        /^## (.+)$/gm,
        '<h2 style="color:' + C.text + ';font-size:17px;margin:20px 0 8px">$1</h2>',
      )
      .replace(
        /^# (.+)$/gm,
        '<h1 style="color:' + C.text + ';font-size:20px;margin:24px 0 10px">$1</h1>',
      )
      .replace(/\*\*(.+?)\*\*/g, '<strong style="color:' + C.text + '">$1</strong>')
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(
        /`(.+?)`/g,
        '<code style="background:' +
          C.card +
          ";border:1px solid " +
          C.border +
          ";border-radius:5px;padding:1px 6px;color:" +
          C.accentLight +
          '">$1</code>',
      )
      .replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        (_, label, href) =>
          `<a href="${sanitizeHref(href)}" target="_blank" rel="noopener noreferrer" style="color:${C.accentLight};text-decoration:underline">${label}</a>`,
      )
      .replace(/^- (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">• $1</div>')
      .replace(/^\d+\. (.+)$/gm, '<div style="padding-left:12px;margin:2px 0">$&</div>')
      .replace(
        /\[\[(.+?)\]\]/g,
        '<span style="color:' + C.accent + ';text-decoration:underline">$1</span>',
      )
      .replace(/✅/g, '<span style="color:' + C.green + '">✅</span>')
      .replace(/⚠️/g, '<span style="color:' + C.orange + '">⚠️</span>')
      .replace(/\n/g, "<br/>");
  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 0, height: "calc(100vh - 140px)" }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button
            onClick={onBack}
            style={{
              background: "none",
              border: "none",
              color: C.textMuted,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontFamily: "inherit",
              fontSize: 13,
            }}
          >
            <ChevronLeft size={14} />
            Zurück
          </button>
          <span style={{ fontSize: 16, fontWeight: 700, color: C.text }}>{item.title}</span>
          <Badge color={stCo[item.status]}>{stLb[item.status]}</Badge>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Btn
            variant="secondary"
            size="sm"
            icon={Copy}
            onClick={() => {
              navigator.clipboard?.writeText(md);
              toast("Kopiert", "success");
            }}
          >
            Copy
          </Btn>
          <Btn
            variant="secondary"
            size="sm"
            icon={Download}
            onClick={() => downloadFile(md, "text/markdown", `${item.title}.md`)}
          >
            Download
          </Btn>
          {item.clientId && (
            <Btn variant="secondary" size="sm" icon={Globe} onClick={() => setShowWpPublish(true)}>
              WordPress
            </Btn>
          )}
          <Btn size="sm" icon={Save} onClick={() => onSave(item.id, md)}>
            Speichern
          </Btn>
        </div>
      </div>
      {showWpPublish && (
        <WordPressPublishModal
          clientId={item.clientId}
          defaultTitle={item.title}
          markdown={md}
          onClose={() => setShowWpPublish(false)}
          notify={toast}
        />
      )}
      {/* Redesign 1b (Screen 2g): Editor als Hi-Fi-Karte — Toolbar mit
        Hairline, Panes r16, Dokument-Typografie in der Vorschau. */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "8px 12px",
          background: C.card,
          borderRadius: "16px 16px 0 0",
          border: `1px solid ${C.border}`,
          borderBottom: `1px solid ${C.hairline}`,
          boxShadow: C.cardShadow,
        }}
      >
        {[
          [Bold, "**text**"],
          [Italic, "*text*"],
          [Heading2, "\n## "],
          [Heading3, "\n### "],
          [Link2, "[text](url)"],
          [Code, "`code`"],
        ].map(([Ic, txt], i) => (
          <button
            key={i}
            onClick={() => setMd((p) => p + txt)}
            style={{
              background: "none",
              border: "none",
              padding: 6,
              borderRadius: 6,
              cursor: "pointer",
              color: C.textMuted,
              display: "flex",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
          >
            <Ic size={14} />
          </button>
        ))}
      </div>
      <div
        className="split-pane"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          flex: 1,
          border: `1px solid ${C.border}`,
          borderTop: "none",
          borderRadius: "0 0 16px 16px",
          boxShadow: C.cardShadow,
          overflow: "hidden",
        }}
      >
        <textarea
          value={md}
          onChange={(e) => setMd(e.target.value)}
          style={{
            background: C.bg,
            color: C.text,
            border: "none",
            borderRight: `1px solid ${C.hairline}`,
            padding: "20px 22px",
            fontSize: 13,
            fontFamily: "'JetBrains Mono',monospace",
            lineHeight: 1.7,
            resize: "none",
            outline: "none",
          }}
        />
        <div
          style={{
            background: C.surface,
            padding: "24px 28px",
            fontSize: 14.5,
            lineHeight: 1.75,
            color: "#3a3340",
            overflowY: "auto",
          }}
          dangerouslySetInnerHTML={{ __html: renderMd(md) }}
        />
      </div>
    </div>
  );
}

// Kunden-Reports: zeigt content_items vom Typ "report" des gewählten Kunden,
// für die Viewer-Rolle freigeschaltet. PDF via Print-to-PDF (sauberes Druck-Fenster).
// ── Content-Refresh-Radar ─────────────────────────────────────────────────
// Worklist aus der SQL-View content_decision via rpc('get_content_dashboard').
// Gate/Trend/Empfehlung werden in der DB berechnet (agentenunabhaengig); RLS via
// SECURITY-DEFINER-Gate. Detail-Chart = content_metrics-Zeitreihe (recharts).
export const REC_META = {
  not_indexed: {
    t: "Nicht im Google-Index",
    c: C.red,
    a: "Auffindbarkeit herstellen – Content-Massnahmen wirken hier nicht",
  },
  refresh_decay: {
    t: "Decay – Refresh fällig",
    c: C.red,
    a: "Freshness-Update gegen aktuelle SERP",
  },
  tech_fix: {
    t: "Technik prüfen",
    c: C.blue,
    a: "An Tech/Agent (Index/interne Links) – nicht Content",
  },
  consolidate: { t: "Kannibalisierung – zusammenführen", c: C.pink, a: "Zwei Artikel mergen" },
  push_expand: {
    t: "Striking Distance – ausbauen",
    c: C.accent,
    a: "Content erweitern, E-E-A-T, Intent schärfen",
  },
  ctr_fix: {
    t: "Title/Meta optimieren",
    c: C.cyan,
    a: "Snippet überarbeiten (kein Volltext-Refresh)",
  },
  ceiling_new_kw: {
    t: "Keyword-Ceiling – neues Ziel",
    c: C.orange,
    a: "Nicht refreshen – neues KW/Strategie",
  },
  low_visibility: {
    t: "Kaum sichtbar",
    c: C.orange,
    a: "Sichtbarkeit aufbauen: Keyword-Fokus, Intent, interne Links",
  },
  stable_hold: { t: "Stabil", c: C.green, a: "Nichts tun" },
  monitor: { t: "Beobachten", c: C.textMuted, a: "Beobachten" },
  maturing_wait: { t: "Reift noch", c: C.textDim, a: "Warten (< 30 Tage)" },
  insufficient_data: {
    t: "Zu wenig Daten",
    c: C.textDim,
    a: "Beobachten, kein Urteil (Messfenster füllt sich noch)",
  },
  unpublished: { t: "Unpubliziert", c: C.textDim, a: "—" },
};

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
export const REC_PLAYBOOK = {
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
      "Lücken als Answer-first-Blöcke schließen: Frage als H2, Antwort im ersten Satz, 130–170 Wörter.",
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
      "Größeres, angrenzendes Ziel-Keyword identifizieren (Keyword-Recherche).",
      "Entscheiden: bestehenden Artikel auf das neue Keyword erweitern ODER zusätzlichen Artikel für die angrenzende Nachfrage planen.",
    ],
    exit: "Neues Keyword-Ziel an Strategie/Content-Planung übergeben.",
  },
};

export const TREND_META = {
  steigend_stabil: { c: C.green, t: "steigend/stabil" },
  stabil: { c: C.orange, t: "stabil" },
  decay: { c: C.red, t: "Decay" },
  kein_traffic: { c: C.textDim, t: "kein Traffic" },
};

export function RefreshDetailChart({ item }) {
  const [series, setSeries] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const { data } = await supabase
        .from("content_metrics")
        .select("captured_on, clicks, position")
        .eq("content_item_id", item.id)
        .order("captured_on", { ascending: true });
      if (alive) setSeries(data || []);
    })();
    return () => {
      alive = false;
    };
  }, [item.id]);
  if (!series)
    return <div style={{ color: C.textMuted, fontSize: 12.5, padding: 16 }}>Zeitreihe lädt…</div>;
  if (!series.length)
    return (
      <div style={{ color: C.textMuted, fontSize: 12.5, padding: 16 }}>
        Noch keine Metriken erfasst — der tägliche Sync füllt die Daten.
      </div>
    );
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={series} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.border} />
        <XAxis dataKey="captured_on" tick={{ fill: C.textDim, fontSize: 11 }} minTickGap={26} />
        <YAxis yAxisId="l" tick={{ fill: C.textDim, fontSize: 11 }} />
        <YAxis yAxisId="r" orientation="right" reversed tick={{ fill: C.textDim, fontSize: 11 }} />
        <Tooltip
          contentStyle={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            fontSize: 12,
            color: C.text,
          }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line
          yAxisId="l"
          type="monotone"
          dataKey="clicks"
          stroke={C.green}
          strokeWidth={2}
          dot={false}
          name="Klicks"
        />
        <Line
          yAxisId="r"
          type="monotone"
          dataKey="position"
          stroke={C.accent}
          strokeWidth={2}
          dot={false}
          name="Position (invers)"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function RefreshRadar({ selectedClient }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onlyAction, setOnlyAction] = useState(false);
  const [detail, setDetail] = useState(null);
  const [playbook, setPlaybook] = useState(null); // Zeile fuer Massnahmen-Pop-up
  // Artikel-spezifische KI-Empfehlung je content_item_id: {loading|text|error}.
  // Bleibt im State gecacht, damit erneutes Oeffnen nicht erneut generiert (Kosten).
  const [briefs, setBriefs] = useState({});
  const generateBrief = useCallback(
    async (row) => {
      setBriefs((p) => ({ ...p, [row.id]: { loading: true } }));
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch("/api/content/refresh-brief", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token || ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ clientId: selectedClient.id, contentItemId: row.id }),
        });
        const j = await r.json().catch(() => null);
        if (!r.ok || !j?.ok) throw new Error(j?.error || `HTTP ${r.status}`);
        setBriefs((p) => ({ ...p, [row.id]: { text: j.content } }));
      } catch (e) {
        setBriefs((p) => ({ ...p, [row.id]: { error: e?.message || "Analyse fehlgeschlagen" } }));
      }
    },
    [selectedClient?.id],
  );
  // Google-Verbindungsstatus: erklaert "keine Metriken" ehrlich (Token fehlt/abgelaufen)
  // statt sie als "kein Traffic" aussehen zu lassen. null = unbekannt -> kein Banner.
  const [gConn, setGConn] = useState(null);
  useEffect(() => {
    let alive = true;
    setGConn(null);
    if (!selectedClient?.id) return undefined;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch("/api/google/connection", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session?.access_token || ""}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ clientId: selectedClient.id }),
        });
        const j = await r.json().catch(() => null);
        if (alive && r.ok && j) setGConn(j);
      } catch {
        /* Status unbekannt -> kein Banner */
      }
    })();
    return () => {
      alive = false;
    };
  }, [selectedClient?.id]);
  const connHint = !selectedClient?.id
    ? null
    : gConn && !gConn.connected
      ? "Google ist für diesen Kunden nicht verbunden — GSC/GA4-Metriken können nicht erfasst werden. Verbinden unter Onboarding → Google."
      : gConn?.connected && !selectedClient?.gscSiteUrl
        ? "Keine GSC-Property hinterlegt — Ranking-Metriken (Klicks/Impressionen/Position) bleiben leer. Property im Kunden-Profil eintragen."
        : null;
  const reload = useCallback(async () => {
    if (!selectedClient?.id) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await supabase.rpc("get_content_dashboard", {
      p_client_id: selectedClient.id,
    });
    setRows(error ? [] : data || []);
    setLoading(false);
  }, [selectedClient?.id]);
  useEffect(() => {
    reload();
  }, [reload]);
  const shown = useMemo(
    () => rows.filter((r) => !onlyAction || ACTION_RECS.includes(r.recommendation)),
    [rows, onlyAction],
  );

  if (!selectedClient?.id)
    return (
      <div style={{ padding: 30, color: C.textMuted, fontSize: 13 }}>
        Wähle einen Kunden, um den Refresh-Radar zu sehen.
      </div>
    );

  // Datenstatus (EzyRank-Ausbau 2026-08-18): letzter Index-Check als ehrlicher
  // Sync-Zeitpunkt (täglicher Content-Sync schreibt ihn); Google-Verbindung separat.
  const lastSync = rows.reduce((acc, r) => {
    const t = r?.index_checked_at ? new Date(r.index_checked_at).getTime() : 0;
    return t > acc ? t : acc;
  }, 0);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <DataStatus
        items={[
          {
            source: "Blog-Artikel (Content-Sync)",
            lastAt: lastSync ? new Date(lastSync).toISOString() : null,
            staleDays: 3,
            state: rows.length && !lastSync ? "present" : undefined,
            detail: loading ? "lädt…" : `${rows.length} publizierte Artikel`,
          },
          gConn == null
            ? null
            : {
                source: "Google (GSC/GA4)",
                state: gConn.connected ? "connected" : "disconnected",
              },
        ].filter(Boolean)}
        action={{
          label: "Daten neu laden",
          kind: "reload",
          title:
            "Liest nur den gespeicherten Datenbankstand neu — den Content-Sync fährt der tägliche Lauf",
          onClick: () => void reload(),
        }}
        hint={
          gConn && !gConn.connected ? "Verbinden: Admin → Kunden → Onboarding → Google" : undefined
        }
      />
      {connHint ? (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            padding: "10px 14px",
            borderRadius: 10,
            background: C.orange + "1a",
            border: `1px solid ${C.orange}55`,
            fontSize: 12.5,
            color: C.text,
          }}
        >
          <AlertCircle size={16} color={C.orange} style={{ flexShrink: 0 }} />
          <span>{connHint}</span>
        </div>
      ) : null}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div style={{ fontSize: 13, color: C.textMuted }}>
          {loading ? "lädt…" : `${shown.length} von ${rows.length} publizierten Artikeln`}
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <label
            style={{
              fontSize: 12.5,
              color: C.textMuted,
              display: "flex",
              gap: 6,
              alignItems: "center",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={onlyAction}
              onChange={(e) => setOnlyAction(e.target.checked)}
            />
            Nur handlungsbedürftig
          </label>
          <Btn
            variant="secondary"
            size="sm"
            icon={RefreshCw}
            onClick={reload}
            title="Liest nur den gespeicherten Datenbankstand neu"
          >
            Daten neu laden
          </Btn>
        </div>
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {loading ? (
          <div style={{ padding: 30, color: C.textMuted, fontSize: 13 }}>Lade Refresh-Daten…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center" }}>
            <RefreshCw size={30} color={C.textDim} style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Nichts zu tun</div>
            <div style={{ fontSize: 13, color: C.textMuted }}>
              Keine handlungsbedürftigen Artikel — oder noch keine Metriken. Der tägliche Sync füllt
              die Daten.
            </div>
          </div>
        ) : (
          shown.map((r, i) => {
            const rec = REC_META[r.recommendation] || {
              t: r.recommendation,
              c: C.textMuted,
              a: "",
            };
            const tr = TREND_META[r.trend] || { c: C.textDim, t: r.trend || "—" };
            const open = detail === r.id;
            return (
              <div
                key={r.id}
                style={{ borderBottom: i < shown.length - 1 ? `1px solid ${C.border}` : "none" }}
              >
                <div
                  onClick={() => setDetail(open ? null : r.id)}
                  style={{
                    padding: "13px 18px",
                    display: "grid",
                    gridTemplateColumns: "1.6fr 1fr auto 14px 1.5fr auto",
                    gap: 12,
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: C.text,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.title}
                    </div>
                    {r.url ? (
                      <div
                        style={{
                          fontSize: 11.5,
                          color: C.textDim,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {r.url}
                      </div>
                    ) : null}
                  </div>
                  <div
                    style={{
                      fontSize: 12.5,
                      color: C.textMuted,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {r.primary_keyword || "—"}
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: C.textDim,
                      background: C.surface,
                      border: `1px solid ${C.border}`,
                      borderRadius: 6,
                      padding: "2px 7px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {r.gate}
                  </span>
                  <span
                    title={tr.t}
                    style={{
                      width: 10,
                      height: 10,
                      borderRadius: "50%",
                      background: tr.c,
                      display: "inline-block",
                    }}
                  />
                  <span
                    title={REC_PLAYBOOK[r.recommendation] ? "Klicken für Maßnahme" : undefined}
                    onClick={
                      REC_PLAYBOOK[r.recommendation]
                        ? (e) => {
                            e.stopPropagation();
                            setPlaybook(r);
                          }
                        : undefined
                    }
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: rec.c,
                      background: rec.c + "1f",
                      borderRadius: 7,
                      padding: "3px 9px",
                      whiteSpace: "nowrap",
                      justifySelf: "start",
                      cursor: REC_PLAYBOOK[r.recommendation] ? "pointer" : "default",
                      textDecoration: REC_PLAYBOOK[r.recommendation] ? "underline dotted" : "none",
                      textUnderlineOffset: 3,
                    }}
                  >
                    {rec.t}
                  </span>
                  <span
                    style={{
                      fontSize: 12,
                      color: C.textDim,
                      whiteSpace: "nowrap",
                      justifySelf: "end",
                    }}
                  >
                    {r.age_days != null ? `${r.age_days} T` : "—"}
                  </span>
                </div>
                {open ? (
                  <div
                    style={{
                      padding: "0 18px 16px",
                      display: "flex",
                      flexDirection: "column",
                      gap: 10,
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <div style={{ fontSize: 12.5, color: C.textMuted }}>
                        <b style={{ color: rec.c }}>{rec.t}</b>
                        {rec.a ? ` — ${rec.a}` : ""} · Klicks 28T:{" "}
                        <b style={{ color: C.text }}>{r.clicks_28 ?? 0}</b> (Peak{" "}
                        {r.peak_clicks_28 ?? 0}) · Ø-Pos: {r.position_28 ?? "—"} · Impr 28T:{" "}
                        {r.impr_28 ?? 0}
                        {r.measured_days_28 != null && r.measured_days_28 < 28
                          ? ` · erst ${r.measured_days_28} von 28 Messtagen`
                          : ""}
                        {r.language ? ` · ${String(r.language).toUpperCase()}` : ""}
                      </div>
                      {REC_PLAYBOOK[r.recommendation] ? (
                        <Btn variant="secondary" size="sm" onClick={() => setPlaybook(r)}>
                          Maßnahme anzeigen
                        </Btn>
                      ) : null}
                    </div>
                    <RefreshDetailChart item={r} />
                  </div>
                ) : null}
              </div>
            );
          })
        )}
      </div>
      {playbook
        ? (() => {
            const pb = REC_PLAYBOOK[playbook.recommendation];
            const rec = REC_META[playbook.recommendation] || {
              t: playbook.recommendation,
              c: C.textMuted,
            };
            if (!pb) return null;
            return (
              <Modal
                open
                onClose={() => setPlaybook(null)}
                title={`Maßnahme: ${rec.t}`}
                width={620}
              >
                <div
                  style={{
                    padding: "18px 22px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 16,
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 2 }}>
                      {playbook.title}
                    </div>
                    {playbook.url ? (
                      <a
                        href={playbook.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{ fontSize: 12, color: C.accent, wordBreak: "break-all" }}
                      >
                        {playbook.url}
                      </a>
                    ) : null}
                    <div style={{ fontSize: 12, color: C.textMuted, marginTop: 6 }}>
                      Keyword: <b style={{ color: C.text }}>{playbook.primary_keyword || "—"}</b> ·
                      Klicks 28T: <b style={{ color: C.text }}>{playbook.clicks_28 ?? 0}</b> (Peak{" "}
                      {playbook.peak_clicks_28 ?? 0}) · Ø-Pos: {playbook.position_28 ?? "—"} · Impr
                      28T: {playbook.impr_28 ?? 0}
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: rec.c + "14",
                      border: `1px solid ${rec.c}44`,
                      fontSize: 12.5,
                      color: C.text,
                      lineHeight: 1.55,
                    }}
                  >
                    <b style={{ color: rec.c }}>Befund:</b> {pb.befund}
                  </div>
                  <div>
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: C.textMuted,
                        textTransform: "uppercase",
                        letterSpacing: 0.5,
                        marginBottom: 8,
                      }}
                    >
                      So gehst du vor
                    </div>
                    <ol
                      style={{
                        margin: 0,
                        paddingLeft: 20,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      }}
                    >
                      {pb.schritte.map((s, i) => (
                        <li key={i} style={{ fontSize: 13, color: C.text, lineHeight: 1.55 }}>
                          {s}
                        </li>
                      ))}
                    </ol>
                  </div>
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      background: C.green + "14",
                      border: `1px solid ${C.green}44`,
                      fontSize: 12.5,
                      color: C.text,
                      lineHeight: 1.55,
                    }}
                  >
                    <b style={{ color: C.green }}>Fertig, wenn:</b> {pb.exit}
                  </div>
                  {(() => {
                    const brief = briefs[playbook.id];
                    return (
                      <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 14 }}>
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            gap: 10,
                            marginBottom: 8,
                            flexWrap: "wrap",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: C.textMuted,
                              textTransform: "uppercase",
                              letterSpacing: 0.5,
                            }}
                          >
                            Konkrete Empfehlung für diesen Artikel
                          </div>
                          {!brief?.text ? (
                            <Btn
                              variant="secondary"
                              size="sm"
                              icon={Sparkles}
                              disabled={!!brief?.loading}
                              onClick={() => generateBrief(playbook)}
                            >
                              {brief?.loading
                                ? "Analysiere…"
                                : brief?.error
                                  ? "Nochmal versuchen"
                                  : "Mit KI erstellen"}
                            </Btn>
                          ) : null}
                        </div>
                        {brief?.loading ? (
                          <div style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.55 }}>
                            Der Artikel wird live von der Kundenseite geladen und zusammen mit den
                            28-Tage-Zahlen analysiert — dauert ca. 20–30 Sekunden…
                          </div>
                        ) : brief?.error ? (
                          <div style={{ fontSize: 12.5, color: C.red, lineHeight: 1.55 }}>
                            {brief.error}
                          </div>
                        ) : brief?.text ? (
                          <div
                            style={{
                              fontSize: 13,
                              color: C.text,
                              lineHeight: 1.65,
                              maxHeight: 340,
                              overflowY: "auto",
                              padding: "4px 2px",
                            }}
                            dangerouslySetInnerHTML={{ __html: markdownToHtml(brief.text) }}
                          />
                        ) : (
                          <div style={{ fontSize: 12.5, color: C.textMuted, lineHeight: 1.55 }}>
                            Lädt den Live-Artikel (Title, Meta, Überschriften) und die GSC-Zahlen
                            und erstellt daraus einen Massnahmenplan mit konkreten
                            Formulierungsvorschlägen — z. B. neue Title-Varianten, fehlende
                            Themen-Abschnitte oder zu aktualisierende Inhalte.
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </Modal>
            );
          })()
        : null}
    </div>
  );
}

export function ReportsPage({ items, selectedClient }) {
  const reports = useMemo(
    () =>
      (items || [])
        .filter(
          (it) =>
            it.type === "report" && (!selectedClient?.id || it.clientId === selectedClient.id),
        )
        .sort((a, b) =>
          String(b.updatedAt || b.createdAt || "").localeCompare(
            String(a.updatedAt || a.createdAt || ""),
          ),
        ),
    [items, selectedClient],
  );
  const [sel, setSel] = useState(null);
  const current = reports.find((r) => r.id === sel) || reports[0] || null;

  const printReport = (rep) => {
    if (!rep) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const body = markdownToHtml(rep.content || "");
    const title = String(rep.title || "Report").replace(/</g, "&lt;");
    const meta = `${selectedClient?.name || ""} · ${rep.updatedAt || rep.createdAt || ""}`;
    w.document.write(
      `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>${title}</title>` +
        `<style>body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:820px;margin:32px auto;padding:0 24px;color:#1a2233;line-height:1.6}` +
        `h1{font-size:22px;border-bottom:2px solid #e3e8f0;padding-bottom:8px}h2{font-size:17px;margin-top:22px}h3{font-size:14px}` +
        `table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #d8dee9;padding:6px 10px;text-align:left;font-size:13px}` +
        `th{background:#f3f6fb}code{background:#f3f6fb;padding:1px 5px;border-radius:4px}.m{display:flex;justify-content:space-between;color:#6b7894;font-size:12px;margin-bottom:10px}` +
        `</style></head><body><div class="m"><span>${meta}</span><span>EzyOne</span></div><div>${body}</div>` +
        `<script>window.onload=function(){window.print()}</script></body></html>`,
    );
    w.document.close();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Reports</h1>
          <p style={{ color: C.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            {reports.length} Reports{selectedClient?.name ? ` · ${selectedClient.name}` : ""}
          </p>
        </div>
        {current && (
          <Btn icon={Download} onClick={() => printReport(current)}>
            PDF / Drucken
          </Btn>
        )}
      </div>
      {reports.length === 0 ? (
        <div
          style={{
            color: C.textMuted,
            fontSize: 13,
            padding: 28,
            textAlign: "center",
            border: `1px dashed ${C.border}`,
            borderRadius: 12,
          }}
        >
          Noch keine Reports vorhanden. Der monatliche Report wird automatisch erstellt.
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {reports.map((r) => (
              <button
                key={r.id}
                onClick={() => setSel(r.id)}
                style={{
                  textAlign: "left",
                  padding: "10px 12px",
                  borderRadius: 10,
                  cursor: "pointer",
                  background: current?.id === r.id ? C.card : "transparent",
                  border: `1px solid ${current?.id === r.id ? C.accent : C.border}`,
                  color: C.text,
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontSize: 13, fontWeight: 600 }}>{r.title}</div>
                <div style={{ fontSize: 11, color: C.textMuted }}>{r.updatedAt || r.createdAt}</div>
              </button>
            ))}
          </div>
          <div
            style={{
              background: C.card,
              border: `1px solid ${C.border}`,
              borderRadius: 14,
              padding: 22,
              fontSize: 13,
              lineHeight: 1.7,
              color: C.text,
              overflowY: "auto",
            }}
            dangerouslySetInnerHTML={{ __html: markdownToHtml(current?.content || "") }}
          />
        </div>
      )}
    </div>
  );
}

export function ContentPage({
  clients,
  items,
  onSaveContent,
  selectedClient,
  openEditId,
  onOpenEditConsumed,
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(null);
  // Weiterbearbeiten-Flow (2026-08-18): von aussen angeforderter Entwurf wird
  // direkt im Editor geoeffnet (einmalig konsumiert).
  useEffect(() => {
    if (openEditId) {
      setEditing(openEditId);
      onOpenEditConsumed?.();
    }
  }, [openEditId, onOpenEditConsumed]);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const typeIc = { blog: PenTool, audit: Layers, note: Bookmark, report: FileText, win: Award };
  const typeCo = { blog: C.cyan, audit: C.accent, note: C.pink, report: C.blue, win: C.green };
  const stCo = { draft: C.textMuted, published: C.green, archived: C.textDim };
  const stLb = { draft: "Entwurf", published: "Publiziert", archived: "Archiviert" };
  // Content pro Kunde trennen: nur Inhalte des aktuell gewählten Kunden zeigen.
  const clientItems = items.filter(
    (it) => !selectedClient?.id || it.clientId === selectedClient.id,
  );
  const filtered = clientItems.filter(
    (it) =>
      (filter === "all" ? it.type !== "report" : it.type === filter) &&
      it.title.toLowerCase().includes(search.toLowerCase()),
  );
  const saveContent = async (id, content) => {
    try {
      await onSaveContent(id, content);
      toast("Inhalt gespeichert", "success");
    } catch (e) {
      toast(e?.message || "Speichern fehlgeschlagen", "error");
    }
  };

  if (editing) {
    const it = items.find((i) => i.id === editing);
    if (!it)
      return (
        <div style={{ padding: 30, fontSize: 13, color: C.textMuted }}>
          Entwurf nicht gefunden (evtl. noch nicht geladen).{" "}
          <button
            onClick={() => setEditing(null)}
            style={{
              background: "none",
              border: "none",
              color: C.accent,
              cursor: "pointer",
              fontSize: 13,
              fontFamily: "inherit",
              textDecoration: "underline",
            }}
          >
            Zurück zur Liste
          </button>
        </div>
      );
    return (
      <ContentEditor
        item={it}
        stCo={stCo}
        stLb={stLb}
        onBack={() => setEditing(null)}
        onSave={(id, md) => {
          saveContent(id, md);
          setEditing(null);
        }}
      />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Content</h1>
          <p style={{ color: C.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            {clientItems.length} Inhalte{selectedClient?.name ? ` · ${selectedClient.name}` : ""}
          </p>
        </div>
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ position: "relative", width: 280 }}>
          <Search
            size={15}
            color={C.textDim}
            style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen..."
            style={{
              width: "100%",
              padding: "9px 12px 9px 36px",
              borderRadius: 10,
              background: C.card,
              border: `1px solid ${C.border}`,
              color: C.text,
              fontSize: 13,
              outline: "none",
              fontFamily: "inherit",
              boxSizing: "border-box",
            }}
          />
        </div>
        <TabBar
          tabs={[
            { id: "all", label: "Alle" },
            { id: "win", label: "Erfolge" },
            { id: "audit", label: "Audit" },
            { id: "note", label: "Notes" },
            { id: "report", label: "Berichte" },
          ]}
          active={filter}
          onChange={setFilter}
        />
      </div>
      {filter === "report" ? (
        <ReportsPage items={items} selectedClient={selectedClient} />
      ) : (
        <div
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 14,
            overflow: "hidden",
          }}
        >
          {filtered.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center" }}>
              <FileText size={32} color={C.textDim} style={{ marginBottom: 12 }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: C.text }}>Noch kein Content</div>
              <div style={{ fontSize: 13, color: C.textMuted, maxWidth: 440, margin: "0 auto" }}>
                Nächster Schritt: unter{" "}
                <strong style={{ color: C.text }}>AI-Tools → Content erstellen</strong> z. B. «Blog
                Post generieren» starten und das Ergebnis dort «Als Entwurf speichern» — es
                erscheint dann hier.
              </div>
            </div>
          ) : (
            filtered.map((it, i) => {
              const TI = typeIc[it.type] || FileText;
              const cl = clients.find((c) => c.id === it.clientId);
              return (
                <div
                  key={it.id}
                  onClick={() => setEditing(it.id)}
                  style={{
                    padding: "14px 20px",
                    borderBottom: i < filtered.length - 1 ? `1px solid ${C.border}` : "none",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = C.cardHover)}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: `${typeCo[it.type]}18`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}
                  >
                    <TI size={16} color={typeCo[it.type]} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{it.title}</div>
                    <div style={{ fontSize: 11, color: C.textMuted }}>
                      {cl?.name || "—"} • {it.wordCount} Wörter • {it.updatedAt}
                    </div>
                  </div>
                  <Badge color={typeCo[it.type]}>{it.type}</Badge>
                  <Badge color={stCo[it.status]}>{stLb[it.status]}</Badge>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
