// EzyAI — Ads-Modus, Bereich «Kampagnen» als Nachbau des OpenAI Ads Managers
// (15.09.2026, Volkan: «genau nachbauen»). Drei Ebenen-Tabs (Kampagnen /
// Anzeigengruppen / Anzeigen) mit denselben Spalten, Aktiv-Schalter, Status
// «Wird bereitgestellt», Zeilen-Menü (Insights anzeigen, Änderungsverlauf,
// Bearbeiten, Duplizieren, Archivieren), Auswahl-Leiste (Bearbeiten / Aktiv ▾ /
// Exportieren ▾), rechtes Panel «Trends bei Kennzahlen», Fusszeile mit Summen
// und «Vorläufige Daten». Datenbasis: Sync-Layer (/api/admin/chatgpt-ads GET
// scopes=all — Insights je Kampagne/Gruppe/Anzeige), Schreibaktionen über die
// bestehenden Actions (entity-command, command, ad-update, …) mit Audit.
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import { authedFetch } from "@/lib/authed-fetch";
import { supabase } from "@/integrations/supabase/client";
import { isoDay, type ResolvedRange } from "@/ezy/data/rangeStore";
import {
  AccountControls,
  AudiencesEditor,
  CampaignDrilldown,
  CampaignWizard,
  ImagePicker,
  TargetingEditor,
  type AccountMeta,
  type AdGroup,
  type AdLite,
  type CampaignLite,
  type GeoLocation,
} from "@/ezy/EzyAiCampaignWizard";

type Tokens = Record<string, string>;

type Level = "campaign" | "ad_group" | "ad";
type Ad = AdLite & { query_string_template?: string | null };
type InsightRow = {
  scope: Level;
  scope_openai_id: string;
  date: string;
  impressions: number;
  clicks: number;
  spend: number;
  conversions: number | null;
  ctc: number | null;
};
type CmdRow = {
  action: string;
  target_openai_id: string;
  target_type: string | null;
  status: string;
  error: string | null;
  created_at: string;
  payload: any;
};
type Account = {
  id: string;
  openai_ad_account_id: string;
  name: string;
  currency_code: string;
  status: string;
  is_mock: boolean;
  last_synced_at: string | null;
  last_sync_error: string | null;
  meta?: AccountMeta;
};
type Data = {
  account: Account;
  campaigns: CampaignLite[];
  adGroups: AdGroup[];
  ads: Ad[];
  insights: InsightRow[];
  commands: CmdRow[];
  audiences: Array<{
    openai_audience_id: string;
    name: string;
    status: string;
    matched_user_count_range?: string | null;
  }>;
};
type Agg = { imp: number; clk: number; conv: number; ctc: number; spend: number };
const ZERO: Agg = { imp: 0, clk: 0, conv: 0, ctc: 0, spend: 0 };
// Spalten je Ebene — Namen und Reihenfolge exakt wie im OpenAI Ads Manager
// (Live-Durchklick 15.09.). group = Gruppe im Dialog «Spalten anpassen».
type ColKey =
  | "status"
  | "typ"
  | "campaign"
  | "adgroup"
  | "actions"
  | "imp"
  | "clk"
  | "conv"
  | "ctc"
  | "spend"
  | "ctr"
  | "cpc"
  | "cpm"
  | "budget"
  | "start"
  | "end"
  | "hints"
  | "billing"
  | "strategy"
  | "url";
type Col = {
  key: ColKey;
  label: string;
  group: "Einrichtung" | "Lieferung" | "Conversion-Ereignisse";
  num?: boolean;
};
const COLS: Record<Level, Col[]> = {
  campaign: [
    { key: "status", label: "Status", group: "Einrichtung" },
    { key: "typ", label: "Typ", group: "Einrichtung" },
    { key: "actions", label: "Aktionen", group: "Einrichtung" },
    { key: "imp", label: "Impressionen", group: "Lieferung", num: true },
    { key: "clk", label: "Klicks", group: "Lieferung", num: true },
    { key: "conv", label: "Conversions", group: "Conversion-Ereignisse", num: true },
    { key: "ctc", label: "CTC (30 T.)", group: "Conversion-Ereignisse", num: true },
    { key: "spend", label: "Ausgaben", group: "Lieferung", num: true },
    { key: "ctr", label: "CTR", group: "Lieferung", num: true },
    { key: "cpc", label: "Durchschn. CPC", group: "Lieferung", num: true },
    { key: "cpm", label: "Durchschn. CPM", group: "Lieferung", num: true },
    { key: "budget", label: "Budget", group: "Einrichtung" },
    { key: "start", label: "Startdatum", group: "Einrichtung" },
    { key: "end", label: "Enddatum", group: "Einrichtung" },
  ],
  ad_group: [
    { key: "campaign", label: "Campaign name", group: "Einrichtung" },
    { key: "status", label: "Status", group: "Einrichtung" },
    { key: "actions", label: "Aktionen", group: "Einrichtung" },
    { key: "spend", label: "Ausgaben", group: "Lieferung", num: true },
    { key: "imp", label: "Impressionen", group: "Lieferung", num: true },
    { key: "clk", label: "Klicks", group: "Lieferung", num: true },
    { key: "conv", label: "Conversions", group: "Conversion-Ereignisse", num: true },
    { key: "ctc", label: "CTC (30 T.)", group: "Conversion-Ereignisse", num: true },
    { key: "ctr", label: "CTR", group: "Lieferung", num: true },
    { key: "cpc", label: "Durchschn. CPC", group: "Lieferung", num: true },
    { key: "cpm", label: "Durchschn. CPM", group: "Lieferung", num: true },
    { key: "hints", label: "Kontexthinweise", group: "Einrichtung" },
    { key: "billing", label: "Abrechnungsereignis", group: "Einrichtung" },
    { key: "strategy", label: "Gebotsstrategie", group: "Einrichtung" },
  ],
  ad: [
    { key: "status", label: "Status", group: "Einrichtung" },
    { key: "actions", label: "Aktionen", group: "Einrichtung" },
    { key: "imp", label: "Impressionen", group: "Lieferung", num: true },
    { key: "clk", label: "Klicks", group: "Lieferung", num: true },
    { key: "conv", label: "Conversions", group: "Conversion-Ereignisse", num: true },
    { key: "ctc", label: "CTC (30 T.)", group: "Conversion-Ereignisse", num: true },
    { key: "spend", label: "Ausgaben", group: "Lieferung", num: true },
    { key: "ctr", label: "CTR", group: "Lieferung", num: true },
    { key: "cpc", label: "Durchschn. CPC", group: "Lieferung", num: true },
    { key: "cpm", label: "Durchschn. CPM", group: "Lieferung", num: true },
    { key: "url", label: "URL", group: "Einrichtung" },
    { key: "campaign", label: "Campaign name", group: "Einrichtung" },
    { key: "adgroup", label: "Anzeigengruppe", group: "Einrichtung" },
  ],
};
const colsKey = (l: Level) => "ezyai.ads.cols." + l;
function loadHidden(l: Level): Set<ColKey> {
  try {
    const v = localStorage.getItem(colsKey(l));
    return new Set(v ? (JSON.parse(v) as ColKey[]) : []);
  } catch {
    return new Set();
  }
}
const MONTHS_SHORT = [
  "Jan.",
  "Feb.",
  "März",
  "Apr.",
  "Mai",
  "Juni",
  "Juli",
  "Aug.",
  "Sept.",
  "Okt.",
  "Nov.",
  "Dez.",
];
const fmtDateLong = (iso: string | null | undefined) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    String(d.getDate()).padStart(2, "0") + ". " + MONTHS_SHORT[d.getMonth()] + " " + d.getFullYear()
  );
};
type Metric = "impressions" | "clicks" | "conversions" | "ctc" | "spend" | "ctr" | "cpc";
const METRIC_LABEL: Record<Metric, string> = {
  impressions: "Impressionen",
  clicks: "Klicks",
  conversions: "Conversions",
  ctc: "CTC (30 T.)",
  spend: "Ausgaben",
  ctr: "CTR",
  cpc: "CPC",
};

const LEVEL_LABEL: Record<Level, string> = {
  campaign: "Kampagnen",
  ad_group: "Anzeigengruppen",
  ad: "Anzeigen",
};
const LEVEL_ONE: Record<Level, string> = {
  campaign: "Kampagne",
  ad_group: "Anzeigengruppe",
  ad: "Anzeige",
};

const fmtMoney = (n: number, cur: string) =>
  `${cur}${n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtInt = (n: number) => String(Math.round(n));
const fmtIntTotal = (n: number) => Math.round(n).toLocaleString("de-DE");
const fmtPct = (n: number) => `${n.toFixed(2).replace(".", ".")}%`;
const fmtShort = (iso: string) => {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
};
const fmtSep = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return `${["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"][d.getMonth()]} ${d.getDate()}`;
};
const fmtLong = (iso: string) => {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()}. ${["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."][d.getMonth()]}`;
};
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
const addDays = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5) + 1;

async function post(body: any) {
  const session = (await supabase.auth.getSession()).data.session;
  const r = await authedFetch("/api/admin/chatgpt-ads", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token || ""}`,
    },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { ...j, ok: !!j.ok, error: j.error || (r.ok ? undefined : `HTTP ${r.status}`) };
}

/* ── Kleine Bausteine im Ads-Manager-Look ─────────────────────────────────── */
function Toggle({
  on,
  busy,
  disabled,
  onChange,
}: {
  on: boolean;
  busy?: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled && !busy) onChange();
      }}
      title={disabled ? undefined : on ? "Pausieren" : "Aktivieren"}
      style={{
        width: 30,
        height: 16,
        borderRadius: 999,
        border: "none",
        background: on ? "#111" : "#c9c9cf",
        position: "relative",
        cursor: disabled ? "default" : "pointer",
        opacity: busy ? 0.5 : 1,
        padding: 0,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 2,
          left: on ? 16 : 2,
          width: 12,
          height: 12,
          borderRadius: 999,
          background: "#fff",
          transition: "left .15s",
        }}
      />
    </button>
  );
}
function Checkbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
}) {
  return (
    <span
      onClick={(e) => {
        e.stopPropagation();
        onChange();
      }}
      style={{
        width: 16,
        height: 16,
        borderRadius: 4,
        border: `1.5px solid ${checked || indeterminate ? "#111" : "#c9c9cf"}`,
        background: checked || indeterminate ? "#111" : "#fff",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        color: "#fff",
        fontSize: 11,
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      {indeterminate ? "–" : checked ? "✓" : ""}
    </span>
  );
}
function StatusCell({ label, color }: { label: string; color: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
      <span style={{ width: 7, height: 7, borderRadius: 999, background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}
function Menu({
  items,
  onClose,
  S,
}: {
  items: Array<{ label: string; icon: string; onClick: () => void; danger?: boolean }>;
  onClose: () => void;
  S: Tokens;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        zIndex: 30,
        marginTop: 6,
        minWidth: 190,
        background: "#fff",
        border: `1px solid ${S.line}`,
        borderRadius: 12,
        boxShadow: "0 8px 24px rgba(0,0,0,.10)",
        padding: 6,
      }}
    >
      {items.map((it) => (
        <button
          key={it.label}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
            it.onClick();
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            width: "100%",
            border: "none",
            background: "transparent",
            padding: "8px 10px",
            borderRadius: 8,
            fontSize: 13,
            color: it.danger ? "#b91c1c" : "#111",
            cursor: "pointer",
            textAlign: "left",
          }}
          onMouseEnter={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = "#f3f3f5")
          }
          onMouseLeave={(e) =>
            ((e.currentTarget as HTMLButtonElement).style.background = "transparent")
          }
        >
          <span style={{ width: 16, textAlign: "center", color: "#555" }}>{it.icon}</span>
          {it.label}
        </button>
      ))}
    </div>
  );
}
const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.35)",
  zIndex: 100,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const pill = (S: Tokens, active = false, black = false): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  border: black ? "none" : `1px solid ${S.line}`,
  borderRadius: 999,
  padding: black ? "8px 16px" : "7px 14px",
  fontSize: 13,
  fontWeight: 600,
  background: black ? "#111" : active ? "#f3f3f5" : "#fff",
  color: black ? "#fff" : "#111",
  cursor: "pointer",
  whiteSpace: "nowrap",
});
const iconBtn = (S: Tokens, active = false): React.CSSProperties => ({
  width: 32,
  height: 32,
  borderRadius: 8,
  border: "none",
  background: active ? "#ececf0" : "transparent",
  cursor: "pointer",
  color: "#333",
  fontSize: 15,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
});

/* ── Mini-Vorschau der Chat Card (Anzeigen-Spalte) ─────────────────────────── */
function AdThumb({ ad, S }: { ad: Ad; S: Tokens }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "stretch",
        width: 116,
        height: 42,
        border: `1px solid ${S.line}`,
        borderRadius: 8,
        overflow: "hidden",
        background: "#fff",
        flexShrink: 0,
      }}
      title={`${ad.creative.title || ""}\n${ad.creative.body || ""}`}
    >
      <span style={{ flex: 1, padding: "6px 7px", minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 7.5,
            fontWeight: 600,
            color: "#111",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
          }}
        >
          {ad.creative.title || "—"}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 6.5,
            color: "#666",
            overflow: "hidden",
            whiteSpace: "nowrap",
            textOverflow: "ellipsis",
            marginTop: 2,
          }}
        >
          {ad.creative.body || ""}
        </span>
      </span>
      <span
        style={{
          width: 46,
          background: ad.creative.file_id ? "linear-gradient(135deg,#3a0040,#77008C)" : "#ececf0",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 9,
          fontWeight: 700,
        }}
      >
        {ad.creative.file_id ? "IMG" : ""}
      </span>
    </span>
  );
}

/* ── «Anzeige bearbeiten» — Dialog wie im Ads Manager ─────────────────────── */
function AdEditModal({
  clientId,
  S,
  accountName,
  ad,
  onClose,
  onSaved,
}: {
  clientId: string;
  S: Tokens;
  accountName: string;
  ad: Ad;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(ad.name || "");
  const [title, setTitle] = useState(ad.creative.title || "");
  const [body, setBody] = useState(ad.creative.body || "");
  const [url, setUrl] = useState(ad.creative.target_url || "");
  const [qst, setQst] = useState(ad.query_string_template || "");
  const [fileId, setFileId] = useState<string | null>(ad.creative.file_id || null);
  const [img, setImg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const valid =
    name.trim().length >= 3 &&
    title.trim().length >= 1 &&
    title.length <= 50 &&
    body.length <= 100 &&
    (!url || /^https?:\/\/\S+$/i.test(url));
  const save = async () => {
    setBusy(true);
    setErr("");
    const j = await post({
      action: "ad-update",
      clientId,
      adId: ad.openai_ad_id,
      name: name.trim(),
      title: title.trim(),
      body: body.trim(),
      targetUrl: url.trim(),
      fileId,
      queryStringTemplate: qst.trim(),
    });
    setBusy(false);
    if (!j.ok) {
      setErr(j.error || "Fehler");
      return;
    }
    onSaved();
    onClose();
  };
  const field: React.CSSProperties = {
    width: "100%",
    border: `1px solid ${S.line}`,
    borderRadius: 10,
    padding: "10px 12px",
    fontSize: 14,
    background: "#fff",
    color: "#111",
    boxSizing: "border-box",
    fontFamily: "inherit",
  };
  const lbl: React.CSSProperties = {
    fontSize: 13.5,
    color: "#111",
    fontWeight: 500,
    marginBottom: 6,
  };
  const warn = (len: number, max: number) =>
    len > max * 0.8 ? (
      <div style={{ fontSize: 12.5, color: "#c2410c", marginBottom: 6 }}>
        Der Anzeigentext wird in einigen Platzierungen möglicherweise abgeschnitten.
      </div>
    ) : null;
  const counter = (len: number, max: number) => (
    <span
      style={{
        position: "absolute",
        right: 12,
        top: 11,
        fontSize: 12,
        color: len > max ? "#dc2626" : "#c2410c",
      }}
    >
      {len}/{max}
    </span>
  );
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.35)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "40px 16px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: "100%",
          background: "#fff",
          borderRadius: 16,
          boxShadow: "0 20px 60px rgba(0,0,0,.2)",
          display: "flex",
          flexDirection: "column",
          maxHeight: "calc(100vh - 80px)",
        }}
      >
        <div style={{ padding: "20px 20px 0", fontSize: 18, fontWeight: 600, color: "#111" }}>
          Anzeige bearbeiten
        </div>
        <div style={{ padding: 20, overflowY: "auto", display: "grid", gap: 18 }}>
          <div>
            <div style={lbl}>Anzeigenname</div>
            <input value={name} onChange={(e) => setName(e.target.value)} style={field} />
          </div>
          <div>
            <div style={lbl}>Titel</div>
            {warn(title.length, 50)}
            <div style={{ position: "relative" }}>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 50))}
                style={{ ...field, paddingRight: 64 }}
              />
              {counter(title.length, 50)}
            </div>
          </div>
          <div>
            <div style={lbl}>Beschreibung</div>
            {warn(body.length, 100)}
            <div style={{ position: "relative" }}>
              <input
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, 100))}
                style={{ ...field, paddingRight: 72 }}
              />
              {counter(body.length, 100)}
            </div>
          </div>
          <div>
            <div style={lbl}>Link</div>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              style={field}
              placeholder="https://…"
            />
          </div>
          <div>
            <div style={lbl}>Abfrageparameter der Landingpage</div>
            <div style={{ fontSize: 12.5, color: "#555", marginBottom: 6, lineHeight: 1.5 }}>
              Optional. Füge eigene Abfrageparameter hinzu. Unterstützte Vorlagenwerte:{" "}
              {"{campaign_id}"}, {"{ad_group_id}"}, {"{ad_id}"}, {"{ad_account_id}"}, {"{oppref}"}.
            </div>
            <input
              value={qst}
              onChange={(e) => setQst(e.target.value)}
              style={field}
              placeholder="utm_source=chatgpt&utm_medium=cpc&utm_campaign={campaign_id}&utm_term={ad_id}"
            />
          </div>
          <div>
            <div style={lbl}>Bild</div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <div style={{ position: "relative" }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 10,
                    background: img
                      ? `url(${img}) center/cover`
                      : fileId
                        ? "linear-gradient(135deg,#3a0040,#77008C)"
                        : "#ececf0",
                  }}
                />
                {fileId && (
                  <button
                    onClick={() => {
                      setFileId(null);
                      setImg(null);
                    }}
                    title="Bild entfernen"
                    style={{
                      position: "absolute",
                      top: -6,
                      right: -6,
                      width: 18,
                      height: 18,
                      borderRadius: 999,
                      border: "none",
                      background: "#fff",
                      boxShadow: "0 1px 4px rgba(0,0,0,.2)",
                      cursor: "pointer",
                      fontSize: 11,
                      lineHeight: 1,
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
              <ImagePicker
                clientId={clientId}
                S={S}
                fileId={fileId}
                onFileId={(id, p) => {
                  setFileId(id);
                  setImg(p);
                }}
              />
            </div>
          </div>
          <div>
            <div style={lbl}>Vorschau</div>
            <div
              style={{
                display: "flex",
                border: `1px solid ${S.line}`,
                borderRadius: 12,
                overflow: "hidden",
                maxWidth: 440,
              }}
            >
              <div
                style={{
                  width: 118,
                  background: img
                    ? `url(${img}) center/cover`
                    : fileId
                      ? "linear-gradient(135deg,#3a0040,#77008C)"
                      : "#ececf0",
                  flexShrink: 0,
                }}
              />
              <div style={{ padding: "12px 14px", minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 12.5,
                    marginBottom: 6,
                  }}
                >
                  <span
                    style={{
                      width: 14,
                      height: 14,
                      borderRadius: 999,
                      background: "#77008C",
                      display: "inline-block",
                    }}
                  />
                  <span style={{ fontWeight: 600, color: "#111" }}>{accountName}</span>
                  <span
                    style={{
                      marginLeft: "auto",
                      fontSize: 11,
                      color: "#555",
                      background: "#f3f3f5",
                      borderRadius: 6,
                      padding: "2px 7px",
                    }}
                  >
                    Anzeige
                  </span>
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#111" }}>
                  {title || "Titel"}
                </div>
                <div style={{ fontSize: 12.5, color: "#555", marginTop: 3, lineHeight: 1.45 }}>
                  {body || "Beschreibung"}
                </div>
              </div>
            </div>
          </div>
          {err && <div style={{ color: "#b91c1c", fontSize: 13 }}>{err}</div>}
        </div>
        <div
          style={{
            padding: "12px 20px 20px",
            display: "flex",
            justifyContent: "flex-end",
            gap: 10,
          }}
        >
          <button onClick={onClose} style={pill(S)}>
            Abbrechen
          </button>
          <button
            onClick={save}
            disabled={busy || !valid}
            style={{ ...pill(S, false, true), opacity: busy || !valid ? 0.4 : 1 }}
          >
            {busy ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Hauptkomponente ──────────────────────────────────────────────────────── */
export default function EzyAiAdsManager({
  clientId,
  clientName,
  range,
  S,
  isOrgAdmin,
}: {
  clientId: string;
  clientName: string;
  range: ResolvedRange;
  S: Tokens;
  isOrgAdmin: boolean;
}) {
  const start = isoDay(range.start);
  const end = isoDay(range.end);
  const days = daysBetween(start, end);
  const prevStart = addDays(start, -days);
  const prevEnd = addDays(start, -1);
  const today = new Date().toISOString().slice(0, 10);

  const [data, setData] = useState<Data | null | "none">(null);
  const [err, setErr] = useState("");
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((k) => k + 1), []);
  const [level, setLevel] = useState<Level>("campaign");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [openMenu, setOpenMenu] = useState<string | null>(null); // "create" | "filter" | "status" | "export" | "more" | row id
  const [trends, setTrends] = useState(false);
  const [metric, setMetric] = useState<Metric>("impressions");
  const [expanded, setExpanded] = useState<{ id: string; kind: "edit" | "history" } | null>(null);
  const [editAd, setEditAd] = useState<Ad | null>(null);
  const [wizard, setWizard] = useState<null | { prefill: any }>(null);
  const [busy, setBusy] = useState("");
  const [confirm, setConfirm] = useState<{ label: string; run: () => Promise<void> } | null>(null);
  const [showTotals, setShowTotals] = useState(true);
  // Breite der Karte: unter ~1150 px passt das Trends-Panel nicht neben die
  // Tabelle (sonst sind alle Kennzahlen-Spalten weggescrollt) — dann darunter.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(1200);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (w) setWrapW(Math.round(w));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const trendsBeside = wrapW >= 1150;
  const [hidden, setHidden] = useState<Set<ColKey>>(() => loadHidden("campaign"));
  const [colsDialog, setColsDialog] = useState(false);
  const [sort, setSort] = useState<{ key: ColKey; dir: "asc" | "desc" } | null>(null);
  const [filterDraft, setFilterDraft] = useState<"all" | "active" | "paused">("all");
  useEffect(() => {
    setHidden(loadHidden(level));
    setSort(null);
  }, [level]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await authedFetch(
          `/api/admin/chatgpt-ads?client=${encodeURIComponent(clientId)}&start=${prevStart}&end=${end}&scopes=all`,
          { headers: { Authorization: `Bearer ${session?.access_token || ""}` } },
        );
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!j.ok) {
          setErr(j.error || `HTTP ${r.status}`);
          setData("none");
        } else if (!j.connected) setData("none");
        else
          setData({
            account: j.account,
            campaigns: j.campaigns || [],
            adGroups: j.adGroups || [],
            ads: j.ads || [],
            insights: j.insights || [],
            commands: j.commands || [],
            audiences: j.audiences || [],
          });
      } catch (e: any) {
        if (alive) {
          setErr(String(e?.message || e));
          setData("none");
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, prevStart, end, reload]);

  // Aggregation je Entity (aktueller Zeitraum) + Vorperiode.
  const agg = useMemo(() => {
    const cur: Record<string, Agg> = {};
    const prev: Record<string, Agg> = {};
    if (data && data !== "none")
      for (const r of data.insights) {
        const key = `${r.scope}:${r.scope_openai_id}`;
        const inCur = r.date >= start && r.date <= end;
        const inPrev = r.date >= prevStart && r.date <= prevEnd;
        const tgt = inCur ? cur : inPrev ? prev : null;
        if (!tgt) continue;
        const a = (tgt[key] ??= { imp: 0, clk: 0, conv: 0, ctc: 0, spend: 0 });
        a.imp += Number(r.impressions || 0);
        a.clk += Number(r.clicks || 0);
        a.conv += Number(r.conversions || 0);
        a.ctc += Number(r.ctc ?? r.conversions ?? 0);
        a.spend += Number(r.spend || 0);
      }
    return { cur, prev };
  }, [data, start, end, prevStart, prevEnd]);
  const aggOf = (lvl: Level, id: string): Agg =>
    agg.cur[`${lvl}:${id}`] || { imp: 0, clk: 0, conv: 0, ctc: 0, spend: 0 };

  // Zeilen der aktiven Ebene (gefiltert).
  type RowT = {
    id: string;
    name: string;
    status: string;
    review?: string | null;
    sub?: string;
    typ?: string;
    ad?: Ad;
    campaign?: CampaignLite;
    group?: AdGroup;
  };
  const rows: RowT[] = useMemo(() => {
    if (!data || data === "none") return [];
    let out: RowT[] =
      level === "campaign"
        ? data.campaigns.map((c) => ({
            id: c.openai_campaign_id,
            name: c.name,
            status: c.status,
            typ:
              c.bidding_type === "clicks"
                ? "Klicks"
                : c.bidding_type === "conversions"
                  ? "Conversions"
                  : "Impressionen",
            campaign: c,
          }))
        : level === "ad_group"
          ? data.adGroups.map((g) => ({
              id: g.openai_ad_group_id,
              name: g.name,
              status: g.status,
              sub: data.campaigns.find((c) => c.openai_campaign_id === g.campaign_id)?.name || "—",
              group: g,
            }))
          : data.ads.map((a) => ({
              id: a.openai_ad_id,
              name: a.name || a.creative.title || a.openai_ad_id,
              status: a.status,
              review: a.review_status,
              sub: data.campaigns.find((c) => c.openai_campaign_id === a.campaign_id)?.name || "—",
              ad: a,
            }));
    if (statusFilter !== "all") out = out.filter((r) => r.status === statusFilter);
    if (search) out = out.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()));
    return out;
  }, [data, level, statusFilter, search]);
  const colVal = useCallback(
    (r: RowT, key: ColKey): number | string => {
      const a = agg.cur[level + ":" + r.id] || ZERO;
      switch (key) {
        case "imp":
          return a.imp;
        case "clk":
          return a.clk;
        case "conv":
          return a.conv;
        case "ctc":
          return a.ctc;
        case "spend":
          return a.spend;
        case "ctr":
          return a.imp ? (a.clk / a.imp) * 100 : 0;
        case "cpc":
          return a.clk ? a.spend / a.clk : 0;
        case "cpm":
          return a.imp ? (a.spend / a.imp) * 1000 : 0;
        default:
          return r.name;
      }
    },
    [agg, level],
  );
  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows.slice().sort((x, y) => {
      const a = colVal(x, sort.key);
      const b = colVal(y, sort.key);
      return (
        (typeof a === "number" && typeof b === "number"
          ? a - b
          : String(a).localeCompare(String(b))) * dir
      );
    });
  }, [rows, sort, colVal]);
  const statusOf = (r: RowT): [string, string] => {
    if (r.status === "archived") return ["Archiviert", "#8b8da3"];
    if (r.status === "paused") return ["Pausiert", "#8b8da3"];
    if (r.review === "rejected") return ["Abgelehnt", "#dc2626"];
    if (r.review === "in_review" || r.review === "pending") return ["In Prüfung", "#d97706"];
    return ["Wird bereitgestellt", "#16a34a"];
  };

  const cur = data && data !== "none" ? data.account.currency_code || "CHF" : "CHF";
  const allChecked = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someChecked = rows.some((r) => selected.has(r.id));
  const selRows = rows.filter((r) => selected.has(r.id));
  const trendRows = selRows.length ? selRows : rows;

  // Trends-Panel: Zeitreihe der gewählten Metrik über die (ausgewählten) Zeilen.
  const trend = useMemo(() => {
    if (!data || data === "none")
      return { pts: [] as Array<{ d: string; v: number }>, total: 0, prevTotal: 0 };
    const ids = new Set(trendRows.map((r) => r.id));
    const byDay: Record<string, Agg> = {};
    const pv: Agg = { imp: 0, clk: 0, conv: 0, ctc: 0, spend: 0 };
    const cv: Agg = { imp: 0, clk: 0, conv: 0, ctc: 0, spend: 0 };
    for (let d = start; d <= end; d = addDays(d, 1))
      byDay[d] = { imp: 0, clk: 0, conv: 0, ctc: 0, spend: 0 };
    const add = (a: Agg, r: InsightRow) => {
      a.imp += Number(r.impressions || 0);
      a.clk += Number(r.clicks || 0);
      a.conv += Number(r.conversions || 0);
      a.ctc += Number(r.ctc ?? r.conversions ?? 0);
      a.spend += Number(r.spend || 0);
    };
    for (const r of data.insights) {
      if (r.scope !== level || !ids.has(r.scope_openai_id)) continue;
      if (byDay[r.date]) {
        add(byDay[r.date], r);
        add(cv, r);
      } else if (r.date >= prevStart && r.date <= prevEnd) add(pv, r);
    }
    const val = (a: Agg) =>
      metric === "impressions"
        ? a.imp
        : metric === "clicks"
          ? a.clk
          : metric === "conversions"
            ? a.conv
            : metric === "ctc"
              ? a.ctc
              : metric === "spend"
                ? a.spend
                : metric === "ctr"
                  ? a.imp
                    ? (a.clk / a.imp) * 100
                    : 0
                  : a.clk
                    ? a.spend / a.clk
                    : 0;
    return {
      pts: Object.entries(byDay).map(([d, a]) => ({ d, v: val(a) })),
      total: val(cv),
      prevTotal: val(pv),
    };
  }, [data, level, trendRows, metric, start, end, prevStart, prevEnd]);
  const fmtMetric = (m: Metric, v: number) =>
    m === "spend" || m === "cpc" ? fmtMoney(v, cur) : m === "ctr" ? fmtPct(v) : fmtInt(v);

  // Aktionen.
  const run = async (key: string, body: any) => {
    setBusy(key);
    setErr("");
    const j = await post({ clientId, ...body });
    setBusy("");
    if (!j.ok) {
      setErr(j.error || "Fehler");
      return false;
    }
    refresh();
    return true;
  };
  const entityCmd = (id: string, cmd: "pause" | "activate" | "archive") =>
    run(`${cmd}:${id}`, { action: "entity-command", kind: level, id, cmd });
  const bulk = async (cmd: "pause" | "activate" | "archive") => {
    setOpenMenu(null);
    for (const r of selRows) await entityCmd(r.id, cmd);
    setSelected(new Set());
  };
  const duplicate = async (r: RowT) => {
    if (level === "campaign" && r.campaign) {
      const groups = (data as Data).adGroups.filter((g) => g.campaign_id === r.id);
      const ads = (data as Data).ads.filter((a) => a.campaign_id === r.id);
      setWizard({
        prefill: { campaign: r.campaign, group: groups[0] || null, ad: ads[0] || null },
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (level === "ad_group" && r.group) {
      const bc = r.group.bidding_config || {};
      await run(`dup:${r.id}`, {
        action: "adgroup-create",
        campaignId: r.group.campaign_id,
        name: `${r.name} (Kopie)`,
        billingEventType: bc.billing_event_type || "impression",
        strategy: bc.strategy || undefined,
        maxBidMicros: bc.max_bid_micros || undefined,
        contextHints: r.group.context_hints || [],
      });
    } else if (level === "ad" && r.ad) {
      await run(`dup:${r.id}`, {
        action: "ad-create",
        adGroupId: r.ad.ad_group_id,
        name: `${r.name} (Kopie)`,
        title: r.ad.creative.title,
        body: r.ad.creative.body,
        targetUrl: r.ad.creative.target_url,
        fileId: r.ad.creative.file_id,
        queryStringTemplate: r.ad.query_string_template || "",
      });
    }
  };
  const exportCsv = () => {
    setOpenMenu(null);
    const cols = COLS[level].filter((c) => !hidden.has(c.key) && c.key !== "actions");
    const head = ["Name", ...cols.map((c) => c.label)];
    const lines2 = (selRows.length ? selRows : sortedRows).map((r) => {
      const a2 = aggOf(level, r.id);
      const vals = cols.map((c) => {
        if (c.num) {
          if (c.key === "spend") return a2.spend.toFixed(2);
          if (c.key === "ctr") return a2.imp ? ((a2.clk / a2.imp) * 100).toFixed(2) : "0.00";
          if (c.key === "cpc") return a2.clk ? (a2.spend / a2.clk).toFixed(2) : "";
          if (c.key === "cpm") return a2.imp ? ((a2.spend / a2.imp) * 1000).toFixed(2) : "";
          return String(colVal(r, c.key));
        }
        if (c.key === "status") return statusOf(r)[0];
        if (c.key === "typ") return r.typ || "";
        if (c.key === "campaign") return r.sub || "";
        if (c.key === "adgroup") return r.ad?.ad_group_name || "";
        if (c.key === "url") return r.ad?.creative.target_url || "";
        if (c.key === "budget")
          return r.campaign?.budget_daily_micros != null
            ? (r.campaign.budget_daily_micros / 1e6).toFixed(2)
            : "";
        if (c.key === "start") return r.campaign?.start_time?.slice(0, 10) || "";
        if (c.key === "end") return r.campaign?.end_time?.slice(0, 10) || "";
        if (c.key === "hints") return (r.group?.context_hints || []).join(", ");
        if (c.key === "billing") return r.group?.bidding_config?.billing_event_type || "";
        if (c.key === "strategy") return r.group?.bidding_config?.strategy || "auto";
        return "";
      });
      return [r.name, ...vals].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(";");
    });
    const blob = new Blob(["\ufeff" + [head.join(";"), ...lines2].join("\n")], {
      type: "text/csv;charset=utf-8",
    });
    const el = document.createElement("a");
    el.href = URL.createObjectURL(blob);
    el.download = "chatgpt-ads-" + level + "-" + start + "_" + end + ".csv";
    el.click();
    URL.revokeObjectURL(el.href);
  };

  /* ── Rendering ── */
  const th: React.CSSProperties = {
    padding: "12px 12px",
    fontSize: 13,
    fontWeight: 500,
    color: "#555",
    textAlign: "right",
    whiteSpace: "nowrap",
    background: "#fafafa",
    borderBottom: `1px solid ${S.line}`,
  };
  const thL: React.CSSProperties = { ...th, textAlign: "left" };
  const td: React.CSSProperties = {
    padding: "0 12px",
    height: 58,
    fontSize: 13.5,
    color: "#111",
    textAlign: "right",
    whiteSpace: "nowrap",
    borderBottom: `1px solid ${S.line}`,
  };
  const tdL: React.CSSProperties = { ...td, textAlign: "left" };
  const divider: React.CSSProperties = { borderRight: `1px solid ${S.line}` };

  if (data === null)
    return (
      <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>
        Lade Kampagnen…
      </div>
    );
  if (data === "none")
    return (
      <div
        style={{
          background: "#fff",
          border: `1px solid ${S.line}`,
          borderRadius: 14,
          padding: 24,
          fontSize: 13.5,
          color: "#555",
          lineHeight: 1.6,
        }}
      >
        {err || (
          <>
            Kein ChatGPT-Ads-Konto verbunden. Den API-Key des Kontos unter{" "}
            <b>Zielgruppen → Konto verbinden</b> hinterlegen — oder «mock» für ein Demo-Konto.
          </>
        )}
      </div>
    );

  const totals = rows.reduce<Agg>(
    (t, r) => {
      const a = aggOf(level, r.id);
      t.imp += a.imp;
      t.clk += a.clk;
      t.conv += a.conv;
      t.ctc += a.ctc;
      t.spend += a.spend;
      return t;
    },
    { imp: 0, clk: 0, conv: 0, ctc: 0, spend: 0 },
  );
  const visibleCols = COLS[level].filter((c) => !hidden.has(c.key));
  const colSpanAll = 3 + visibleCols.length;
  const oneLabel = LEVEL_ONE[level];
  const manyLabel = LEVEL_LABEL[level];
  const metricText = (key: ColKey, a: Agg, total = false) => {
    const n = total ? fmtIntTotal : fmtInt;
    switch (key) {
      case "imp":
        return n(a.imp);
      case "clk":
        return n(a.clk);
      case "conv":
        return n(a.conv);
      case "ctc":
        return n(a.ctc);
      case "spend":
        return fmtMoney(a.spend, cur);
      case "ctr":
        return a.imp ? fmtPct((a.clk / a.imp) * 100) : "0.00%";
      case "cpc":
        return a.clk ? fmtMoney(a.spend / a.clk, cur) : "—";
      case "cpm":
        return a.imp ? fmtMoney((a.spend / a.imp) * 1000, cur) : "—";
      default:
        return "";
    }
  };
  const ellip = (text: string, max: number, color = "#111") => (
    <span
      style={{
        display: "inline-block",
        maxWidth: max,
        overflow: "hidden",
        textOverflow: "ellipsis",
        verticalAlign: "middle",
        color,
      }}
      title={text}
    >
      {text}
    </span>
  );
  const cellOf = (c: Col, r: RowT, a: Agg) => {
    switch (c.key) {
      case "status": {
        const [sl, sc] = statusOf(r);
        return <StatusCell label={sl} color={sc} />;
      }
      case "typ":
        return r.typ || "";
      case "campaign":
        return ellip(r.sub || "—", 220);
      case "adgroup":
        return r.ad?.ad_group_name || "—";
      case "actions":
        return "";
      case "conv":
        return (
          <span
            title={
              "30-Tage-Klick · 1-Tage-Ansicht\nCTC (30 T.): " +
              fmtInt(a.ctc) +
              "\nVTC (1 T.): " +
              fmtInt(Math.max(0, a.conv - a.ctc))
            }
            style={{ cursor: "help", borderBottom: "1px dotted #999" }}
          >
            {fmtInt(a.conv)}
          </span>
        );
      case "budget":
        return r.campaign
          ? r.campaign.budget_daily_micros != null
            ? fmtMoney(r.campaign.budget_daily_micros / 1e6, cur) + "/Tag"
            : r.campaign.budget_lifetime_micros != null
              ? fmtMoney(r.campaign.budget_lifetime_micros / 1e6, cur) + " gesamt"
              : "—"
          : "";
      case "start":
        return fmtDateLong(r.campaign?.start_time);
      case "end":
        return r.campaign?.end_time ? fmtDateLong(r.campaign.end_time) : "";
      case "hints":
        return r.group?.context_hints?.length
          ? ellip("[" + r.group.context_hints.join(", ") + "]", 260, "#555")
          : "—";
      case "billing":
        return r.group?.bidding_config?.billing_event_type === "click" ? "Klick" : "Impression";
      case "strategy": {
        const st = r.group?.bidding_config?.strategy;
        return st === "fixed_bid"
          ? "Manuell"
          : st === "maximize_clicks"
            ? "Klicks maximieren"
            : st === "maximize_conversions"
              ? "Conversions maximieren"
              : "Automatisch";
      }
      case "url":
        return r.ad?.creative.target_url ? (
          <a
            href={r.ad.creative.target_url}
            target="_blank"
            rel="noreferrer"
            style={{ color: "#111", textDecoration: "none" }}
          >
            {ellip(r.ad.creative.target_url, 260)}
          </a>
        ) : (
          "—"
        );
      default:
        return metricText(c.key, a);
    }
  };
  const rowMenu = (r: RowT) => [
    {
      label: "Insights anzeigen",
      icon: "▥",
      onClick: () => {
        setSelected(new Set([r.id]));
        setTrends(true);
      },
    },
    {
      label: "Änderungsverlauf",
      icon: "⟲",
      onClick: () =>
        setExpanded(
          expanded?.id === r.id && expanded.kind === "history"
            ? null
            : { id: r.id, kind: "history" },
        ),
    },
    ...(isOrgAdmin
      ? [
          {
            label: `${LEVEL_ONE[level]} bearbeiten`,
            icon: "✎",
            onClick: () =>
              level === "ad" && r.ad
                ? setEditAd(r.ad)
                : setExpanded(
                    expanded?.id === r.id && expanded.kind === "edit"
                      ? null
                      : { id: r.id, kind: "edit" },
                  ),
          },
          { label: `${LEVEL_ONE[level]} duplizieren`, icon: "⧉", onClick: () => duplicate(r) },
          {
            label: "Archivieren",
            icon: "▣",
            onClick: () =>
              setConfirm({
                label: `«${r.name}» archivieren?`,
                run: async () => {
                  await entityCmd(r.id, "archive");
                },
              }),
            danger: true,
          },
        ]
      : []),
  ];
  const deltaPct =
    trend.prevTotal > 0 ? ((trend.total - trend.prevTotal) / trend.prevTotal) * 100 : null;

  return (
    <div
      ref={wrapRef}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        background: "#fff",
        border: `1px solid ${S.line}`,
        borderRadius: 14,
        overflow: "hidden",
      }}
    >
      {/* Titelzeile */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 20px",
          borderBottom: `1px solid ${S.line}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginRight: "auto",
            fontSize: 14.5,
            fontWeight: 600,
            color: "#111",
          }}
        >
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 999,
              background: "#77008C",
              display: "inline-block",
            }}
          />
          {data.account.name || clientName}
          {data.account.is_mock && (
            <span
              style={{
                fontSize: 10.5,
                fontWeight: 700,
                color: "#92400e",
                background: "rgba(217,119,6,.12)",
                borderRadius: 999,
                padding: "2px 8px",
              }}
            >
              DEMO
            </span>
          )}
        </div>
        {search !== null ? (
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onBlur={() => !search && setSearch(null)}
            placeholder="Suchen…"
            style={{
              border: `1px solid ${S.line}`,
              borderRadius: 999,
              padding: "7px 14px",
              fontSize: 13,
              width: 220,
              fontFamily: "inherit",
            }}
          />
        ) : (
          <button onClick={() => setSearch("")} style={iconBtn(S)} title="Suchen">
            ⌕
          </button>
        )}
        {isOrgAdmin && (
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setOpenMenu(openMenu === "create" ? null : "create")}
              style={pill(S, false, true)}
            >
              ＋ Erstellen ⌄
            </button>
            {openMenu === "create" && (
              <Menu
                S={S}
                onClose={() => setOpenMenu(null)}
                items={[
                  {
                    label: "Kampagne erstellen",
                    icon: "▤",
                    onClick: () => setWizard({ prefill: null }),
                  },
                  {
                    label: "Anzeigengruppe erstellen",
                    icon: "▥",
                    onClick: () => {
                      setLevel("campaign");
                      setErr(
                        "Anzeigengruppe: bei der gewünschten Kampagne «Kampagne bearbeiten» → «+ Anzeigengruppe».",
                      );
                    },
                  },
                  {
                    label: "Anzeige erstellen",
                    icon: "▦",
                    onClick: () => {
                      setLevel("campaign");
                      setErr(
                        "Anzeige: bei der gewünschten Kampagne «Kampagne bearbeiten» → in der Anzeigengruppe «+ Anzeige».",
                      );
                    },
                  },
                  {
                    label: "Massen-Upload",
                    icon: "⇪",
                    onClick: () => setErr("Massen-Upload ist über EzyHub nicht verfügbar."),
                  },
                ]}
              />
            )}
          </div>
        )}
      </div>

      {wizard && (
        <div style={{ padding: 16, borderBottom: `1px solid ${S.line}` }}>
          <CampaignWizard
            clientId={clientId}
            S={S}
            card={{
              background: "#fff",
              border: `1px solid ${S.line}`,
              borderRadius: 14,
              padding: 18,
            }}
            cur={cur}
            audiences={data.audiences}
            prefill={wizard.prefill}
            onDone={() => {
              setWizard(null);
              refresh();
            }}
            onCancel={() => setWizard(null)}
          />
        </div>
      )}

      {/* Tabs + Werkzeuge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 20px",
          borderBottom: `1px solid ${S.line}`,
        }}
      >
        {(Object.keys(LEVEL_LABEL) as Level[]).map((l) => (
          <button
            key={l}
            onClick={() => {
              setLevel(l);
              setSelected(new Set());
              setExpanded(null);
            }}
            style={{
              border: "none",
              background: "transparent",
              padding: "14px 4px",
              marginRight: 14,
              fontSize: 13.5,
              fontWeight: level === l ? 600 : 400,
              color: level === l ? "#111" : "#555",
              borderBottom: level === l ? "2px solid #111" : "2px solid transparent",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            {LEVEL_LABEL[l]}
            {level === l && selected.size > 0 && (
              <span
                style={{
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: "#1d4ed8",
                  background: "#e6efff",
                  borderRadius: 999,
                  padding: "2px 8px",
                  display: "inline-flex",
                  gap: 6,
                }}
              >
                {selected.size} ausgewählt{" "}
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelected(new Set());
                  }}
                  style={{ cursor: "pointer" }}
                >
                  ×
                </span>
              </span>
            )}
          </button>
        ))}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          {selected.size > 0 && isOrgAdmin ? (
            <>
              {selRows.length === 1 && (
                <button
                  onClick={() => {
                    const r = selRows[0];
                    if (level === "ad" && r.ad) setEditAd(r.ad);
                    else setExpanded({ id: r.id, kind: "edit" });
                  }}
                  style={pill(S)}
                >
                  ✎ Bearbeiten
                </button>
              )}
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setOpenMenu(openMenu === "status" ? null : "status")}
                  style={pill(S)}
                >
                  {selRows.every((r) => r.status === "active")
                    ? "▶ Aktiv"
                    : selRows.every((r) => r.status === "paused")
                      ? "❚❚ Pausiert"
                      : "Status"}{" "}
                  ⌄
                </button>
                {openMenu === "status" && (
                  <Menu
                    S={S}
                    onClose={() => setOpenMenu(null)}
                    items={[
                      { label: "Aktiv", icon: "▶", onClick: () => bulk("activate") },
                      { label: "Pausiert", icon: "❚❚", onClick: () => bulk("pause") },
                      {
                        label: "Archivieren",
                        icon: "▣",
                        onClick: () =>
                          setConfirm({
                            label: `${selRows.length} ${LEVEL_LABEL[level]} archivieren?`,
                            run: () => bulk("archive"),
                          }),
                        danger: true,
                      },
                    ]}
                  />
                )}
              </div>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setOpenMenu(openMenu === "export" ? null : "export")}
                  style={pill(S)}
                >
                  ⤓ Exportieren ⌄
                </button>
                {openMenu === "export" && (
                  <Menu
                    S={S}
                    onClose={() => setOpenMenu(null)}
                    items={[{ label: "Als CSV (Auswahl)", icon: "⤓", onClick: exportCsv }]}
                  />
                )}
              </div>
              <button
                onClick={() => setTrends((v) => !v)}
                style={iconBtn(S, trends)}
                title="Trends bei Kennzahlen"
              >
                ▥
              </button>
            </>
          ) : (
            <>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setOpenMenu(openMenu === "filter" ? null : "filter")}
                  style={iconBtn(S, statusFilter !== "all")}
                  title="Filter"
                >
                  ⏷
                </button>
                {openMenu === "filter" && (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "100%",
                      zIndex: 30,
                      marginTop: 6,
                      width: 430,
                      background: "#fff",
                      border: "1px solid " + S.line,
                      borderRadius: 12,
                      boxShadow: "0 8px 24px rgba(0,0,0,.10)",
                      padding: 14,
                      fontSize: 13,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={pill(S)}>Status</span>
                      <span style={pill(S)}>ist</span>
                      <select
                        value={filterDraft}
                        onChange={(e) =>
                          setFilterDraft(e.target.value as "all" | "active" | "paused")
                        }
                        style={pill(S)}
                      >
                        <option value="all">Select…</option>
                        <option value="active">Wird bereitgestellt</option>
                        <option value="paused">Pausiert</option>
                      </select>
                      <button
                        onClick={() => setFilterDraft("all")}
                        style={{ ...iconBtn(S), marginLeft: "auto" }}
                        title="Filter entfernen"
                      >
                        ×
                      </button>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
                      <span style={{ ...pill(S), opacity: 0.5, cursor: "default" }}>
                        ＋ Filter hinzufügen
                      </span>
                      <button
                        onClick={() => {
                          setFilterDraft("all");
                          setStatusFilter("all");
                          setOpenMenu(null);
                        }}
                        style={{ ...pill(S), marginLeft: "auto" }}
                      >
                        Filter löschen
                      </button>
                      <button
                        onClick={() => {
                          setStatusFilter(filterDraft);
                          setOpenMenu(null);
                        }}
                        style={pill(S, false, true)}
                      >
                        Anwenden
                      </button>
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setColsDialog(true)}
                style={iconBtn(S, hidden.size > 0)}
                title="Spalten bearbeiten"
              >
                ▤
              </button>
              <div style={{ position: "relative" }}>
                <button
                  onClick={() => setOpenMenu(openMenu === "more" ? null : "more")}
                  style={iconBtn(S)}
                  title="Tabellenaktionen"
                >
                  ⋯
                </button>
                {openMenu === "more" && (
                  <Menu
                    S={S}
                    onClose={() => setOpenMenu(null)}
                    items={[
                      {
                        label: "Segmentieren",
                        icon: "◫",
                        onClick: () =>
                          setErr(
                            "Segmentierung nach Land/Gerät/Plattform: im Dashboard («Leistungstrend») oder im Kampagnen-Drilldown.",
                          ),
                      },
                      { label: "Exportieren", icon: "⤓", onClick: exportCsv },
                      {
                        label: "Massen-Upload",
                        icon: "⇪",
                        onClick: () => setErr("Massen-Upload ist über EzyHub nicht verfügbar."),
                      },
                      { label: "Insights anzeigen", icon: "▥", onClick: () => setTrends(true) },
                      ...(isOrgAdmin
                        ? [
                            {
                              label:
                                busy === "sync" ? "Synchronisiere…" : "Jetzt mit OpenAI syncen",
                              icon: "⟳",
                              onClick: () => run("sync", { action: "sync" }),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}
              </div>
              <span style={pill(S)} title="Zeitraum über den Filter oben ändern">
                ▦ {fmtShort(start)} - {fmtShort(end)} ⌄
              </span>
            </>
          )}
        </div>
      </div>

      {err && (
        <div
          style={{
            padding: "8px 20px",
            fontSize: 12.5,
            color: "#b91c1c",
            background: "rgba(220,38,38,.05)",
            borderBottom: `1px solid ${S.line}`,
          }}
        >
          {err}
        </div>
      )}
      {data.account.last_sync_error && (
        <div
          style={{
            padding: "8px 20px",
            fontSize: 12.5,
            color: "#92400e",
            background: "rgba(217,119,6,.06)",
            borderBottom: `1px solid ${S.line}`,
          }}
        >
          Sync-Hinweis: {data.account.last_sync_error}
        </div>
      )}

      {/* Tabelle + Trends-Panel */}
      <div
        style={{ display: "flex", flexDirection: trendsBeside ? "row" : "column", minHeight: 180 }}
      >
        <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...thL, width: 44, paddingRight: 0 }}>
                  <Checkbox
                    checked={allChecked}
                    indeterminate={!allChecked && someChecked}
                    onChange={() =>
                      setSelected(allChecked ? new Set() : new Set(rows.map((r) => r.id)))
                    }
                  />
                </th>
                <th style={{ ...thL, width: 54 }}>Aktiv</th>
                <th style={{ ...thL, ...divider, minWidth: 210 }}>
                  {level === "ad" ? "Anzeige" : "Name"}
                </th>
                {visibleCols.map((c) => (
                  <th
                    key={c.key}
                    onClick={
                      c.num
                        ? () =>
                            setSort((s0) =>
                              s0?.key === c.key
                                ? s0.dir === "desc"
                                  ? { key: c.key, dir: "asc" }
                                  : null
                                : { key: c.key, dir: "desc" },
                            )
                        : undefined
                    }
                    title={c.num ? manyLabel + " nach " + c.label + " sortieren" : undefined}
                    style={{
                      ...(c.num ? th : thL),
                      cursor: c.num ? "pointer" : "default",
                      color: sort?.key === c.key ? "#111" : "#555",
                    }}
                  >
                    {c.label}
                    {sort?.key === c.key ? (sort.dir === "desc" ? " ↓" : " ↑") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td
                    colSpan={colSpanAll}
                    style={{ ...tdL, height: 120, textAlign: "center", color: "#777" }}
                  >
                    Keine {LEVEL_LABEL[level]} {search ? "für diese Suche" : ""}.
                  </td>
                </tr>
              )}
              {sortedRows.map((r) => {
                const a = aggOf(level, r.id);
                const isSel = selected.has(r.id);
                const toggling = busy === `pause:${r.id}` || busy === `activate:${r.id}`;
                const isOpen = expanded?.id === r.id;
                return (
                  <Fragment key={r.id}>
                    <tr style={{ background: isSel ? "#f7f7fa" : "transparent" }}>
                      <td style={{ ...tdL, paddingRight: 0 }}>
                        <Checkbox
                          checked={isSel}
                          onChange={() =>
                            setSelected((p) => {
                              const n = new Set(p);
                              if (n.has(r.id)) n.delete(r.id);
                              else n.add(r.id);
                              return n;
                            })
                          }
                        />
                      </td>
                      <td style={tdL}>
                        <Toggle
                          on={r.status === "active"}
                          busy={toggling}
                          disabled={!isOrgAdmin || r.status === "archived"}
                          onChange={() =>
                            entityCmd(r.id, r.status === "active" ? "pause" : "activate")
                          }
                        />
                      </td>
                      <td style={{ ...tdL, ...divider, position: "relative" }}>
                        <span
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 14,
                            maxWidth: "100%",
                          }}
                        >
                          {r.ad && <AdThumb ad={r.ad} S={S} />}
                          <span
                            style={{
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              maxWidth: 260,
                            }}
                            title={r.name}
                          >
                            {r.name}
                          </span>
                          <span style={{ position: "relative" }}>
                            <button
                              onClick={() => setOpenMenu(openMenu === r.id ? null : r.id)}
                              style={{
                                ...iconBtn(S, openMenu === r.id),
                                width: 26,
                                height: 26,
                                border: `1px solid ${S.line}`,
                                borderRadius: 6,
                                fontSize: 13,
                              }}
                              title="Aktionen"
                            >
                              ⋯
                            </button>
                            {openMenu === r.id && (
                              <Menu S={S} onClose={() => setOpenMenu(null)} items={rowMenu(r)} />
                            )}
                          </span>
                        </span>
                      </td>
                      {visibleCols.map((c) => (
                        <td key={c.key} style={c.num ? td : tdL}>
                          {cellOf(c, r, a)}
                        </td>
                      ))}
                    </tr>
                    {isOpen && (
                      <tr>
                        <td
                          colSpan={colSpanAll}
                          style={{
                            padding: "6px 20px 18px",
                            background: "#fafafa",
                            borderBottom: `1px solid ${S.line}`,
                          }}
                        >
                          {expanded!.kind === "history" ? (
                            <HistoryPanel
                              S={S}
                              rows={data.commands.filter(
                                (c) =>
                                  c.target_openai_id === r.id ||
                                  (c.payload &&
                                    Array.isArray(c.payload.targetIds) &&
                                    c.payload.targetIds.includes(r.id)),
                              )}
                            />
                          ) : level === "campaign" && r.campaign ? (
                            <CampaignEditor
                              clientId={clientId}
                              S={S}
                              cur={cur}
                              campaign={r.campaign}
                              groups={data.adGroups.filter((g) => g.campaign_id === r.id)}
                              ads={data.ads.filter((x) => x.campaign_id === r.id)}
                              audiences={data.audiences}
                              canWrite={isOrgAdmin}
                              onChanged={refresh}
                              onDuplicate={() => duplicate(r)}
                            />
                          ) : level === "ad_group" && r.group ? (
                            <AdGroupEditor
                              clientId={clientId}
                              S={S}
                              cur={cur}
                              group={r.group}
                              onChanged={refresh}
                              onClose={() => setExpanded(null)}
                            />
                          ) : null}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
              {showTotals && rows.length > 0 && (
                <tr style={{ background: "#fafafa" }}>
                  <td style={{ ...tdL, height: 48, ...divider }} colSpan={3}>
                    <span style={{ color: "#111", fontSize: 13.5 }}>
                      Insgesamt {rows.length} {rows.length === 1 ? oneLabel : manyLabel}
                    </span>
                  </td>
                  {visibleCols.map((c) => (
                    <td key={c.key} style={c.num ? td : tdL}>
                      {c.num ? metricText(c.key, totals, true) : ""}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {trends && (
          <div
            style={{
              width: trendsBeside ? 360 : "auto",
              flexShrink: 0,
              borderLeft: trendsBeside ? `1px solid ${S.line}` : "none",
              borderTop: trendsBeside ? "none" : `1px solid ${S.line}`,
              padding: 18,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ fontSize: 14.5, fontWeight: 600, color: "#111" }}>
                Trends bei Kennzahlen
              </div>
              {selected.size > 0 && (
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#1d4ed8",
                    background: "#e6efff",
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  {selected.size} ausgewählt
                </span>
              )}
              <button
                onClick={() => setTrends(false)}
                style={{ ...iconBtn(S), marginLeft: "auto" }}
              >
                ×
              </button>
            </div>
            <select
              value={metric}
              onChange={(e) => setMetric(e.target.value as Metric)}
              style={{
                width: "100%",
                border: `1px solid ${S.line}`,
                borderRadius: 10,
                padding: "9px 12px",
                fontSize: 13.5,
                background: "#fff",
                fontFamily: "inherit",
                marginBottom: 14,
              }}
            >
              {(Object.keys(METRIC_LABEL) as Metric[]).map((m) => (
                <option key={m} value={m}>
                  {METRIC_LABEL[m]}
                </option>
              ))}
            </select>
            <div style={{ height: 200 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trend.pts} margin={{ top: 10, right: 6, left: 6, bottom: 0 }}>
                  <Tooltip
                    contentStyle={{ borderRadius: 10, border: `1px solid ${S.line}`, fontSize: 12 }}
                    labelFormatter={(l: any) => fmtLong(String(l))}
                    formatter={(v: any) => [fmtMetric(metric, Number(v)), METRIC_LABEL[metric]]}
                  />
                  <Line
                    type="monotone"
                    dataKey="v"
                    stroke="#3b82f6"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 11.5,
                color: "#777",
                marginTop: 4,
              }}
            >
              <span>{fmtSep(start)}</span>
              <span>{fmtSep(end)}</span>
            </div>
            <div style={{ borderTop: `1px solid ${S.line}`, marginTop: 14, paddingTop: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  color: "#333",
                }}
              >
                <span style={{ width: 8, height: 8, background: "#3b82f6", borderRadius: 2 }} />
                {METRIC_LABEL[metric]}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6 }}>
                <span style={{ fontSize: 20, fontWeight: 600, color: "#111" }}>
                  {fmtMetric(metric, trend.total)}
                </span>
                {deltaPct != null && (
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      borderRadius: 6,
                      padding: "2px 7px",
                      color: deltaPct >= 0 ? "#166534" : "#b91c1c",
                      background: deltaPct >= 0 ? "#dcfce7" : "#fee2e2",
                    }}
                    title={`vs. ${fmtShort(prevStart)} – ${fmtShort(prevEnd)}`}
                  >
                    {deltaPct >= 0 ? "↗" : "↘"} {Math.abs(deltaPct).toFixed(0)}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Fusszeile */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          padding: "10px 20px",
          borderTop: `1px solid ${S.line}`,
          fontSize: 12.5,
          color: "#555",
          background: "#fafafa",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#111" }}>
          <span
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              background: "#77008C",
              display: "inline-block",
            }}
          />
          {data.account.name || clientName}
        </span>
        {isOrgAdmin && !data.account.is_mock && (
          <AccountControls
            clientId={clientId}
            S={S}
            meta={data.account.meta ?? null}
            canWrite={isOrgAdmin}
            onChanged={refresh}
          />
        )}
        <button
          onClick={() => setShowTotals((v) => !v)}
          style={{
            border: "none",
            background: "transparent",
            cursor: "pointer",
            color: "#111",
            fontSize: 12.5,
          }}
        >
          Summen {showTotals ? "ausblenden ⌃" : "anzeigen ⌄"}
        </button>
        <span style={{ marginLeft: "auto" }}>
          Vorläufige Daten für {fmtLong(today)} ⓘ · Sync{" "}
          {data.account.last_synced_at ? fmtTime(data.account.last_synced_at) : "—"}
        </span>
        <span>{rows.length ? `1–${rows.length} von ${rows.length}` : "0 von 0"}</span>
      </div>

      {editAd && (
        <AdEditModal
          clientId={clientId}
          S={S}
          accountName={data.account.name || clientName}
          ad={editAd}
          onClose={() => setEditAd(null)}
          onSaved={refresh}
        />
      )}
      {colsDialog && (
        <div onClick={() => setColsDialog(false)} style={overlayStyle}>
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 22,
              width: 520,
              maxHeight: "80vh",
              overflowY: "auto",
              boxShadow: "0 20px 60px rgba(0,0,0,.2)",
            }}
          >
            <div style={{ fontSize: 17, fontWeight: 600, color: "#111", marginBottom: 14 }}>
              Spalten anpassen
            </div>
            {(["Conversion-Ereignisse", "Einrichtung", "Lieferung"] as const).map((g) => (
              <div key={g} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#111", marginBottom: 6 }}>
                  {g}{" "}
                  <span style={{ color: "#777", fontWeight: 400 }}>
                    · {COLS[level].filter((c) => c.group === g && !hidden.has(c.key)).length}{" "}
                    ausgewählt
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {COLS[level]
                    .filter((c) => c.group === g)
                    .map((c) => (
                      <label
                        key={c.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={!hidden.has(c.key)}
                          onChange={() =>
                            setHidden((h) => {
                              const n = new Set(h);
                              if (n.has(c.key)) n.delete(c.key);
                              else n.add(c.key);
                              return n;
                            })
                          }
                        />
                        {c.label}
                      </label>
                    ))}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 12.5, color: "#777", marginBottom: 14 }}>
              Klick-Attribution: 30 Tage · View-through-Attribution: 1 Tag (Konto-Standard).
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button
                onClick={() => {
                  setHidden(new Set());
                  try {
                    localStorage.removeItem(colsKey(level));
                  } catch {
                    /* egal */
                  }
                }}
                style={pill(S)}
              >
                Zurücksetzen
              </button>
              <button
                onClick={() => {
                  try {
                    localStorage.setItem(colsKey(level), JSON.stringify(Array.from(hidden)));
                  } catch {
                    /* egal */
                  }
                  setColsDialog(false);
                }}
                style={pill(S, false, true)}
              >
                Änderungen speichern
              </button>
            </div>
          </div>
        </div>
      )}
      {confirm && (
        <div
          onClick={() => setConfirm(null)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.35)",
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              background: "#fff",
              borderRadius: 16,
              padding: 22,
              width: 380,
              boxShadow: "0 20px 60px rgba(0,0,0,.2)",
            }}
          >
            <div style={{ fontSize: 15, fontWeight: 600, color: "#111", marginBottom: 6 }}>
              {confirm.label}
            </div>
            <div style={{ fontSize: 12.5, color: "#555", marginBottom: 16 }}>
              Archivierte Objekte werden nicht mehr ausgeliefert und verschwinden aus der Liste.
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => setConfirm(null)} style={pill(S)}>
                Abbrechen
              </button>
              <button
                onClick={async () => {
                  const c = confirm;
                  setConfirm(null);
                  await c.run();
                }}
                style={{ ...pill(S, false, true), background: "#dc2626" }}
              >
                Archivieren
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Änderungsverlauf je Objekt (Audit-Zeilen) ────────────────────────────── */
function HistoryPanel({ S, rows }: { S: Tokens; rows: CmdRow[] }) {
  if (!rows.length)
    return (
      <div style={{ fontSize: 12.5, color: "#777", padding: "8px 0" }}>
        Keine Änderungen über EzyHub protokolliert.
      </div>
    );
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ fontWeight: 600, color: "#111", margin: "8px 0" }}>Änderungsverlauf</div>
      {rows.slice(0, 30).map((c, i) => (
        <div
          key={i}
          style={{
            display: "flex",
            gap: 12,
            padding: "5px 0",
            borderBottom: `1px solid ${S.line}`,
          }}
        >
          <span style={{ minWidth: 92, color: "#777" }}>{fmtTime(c.created_at)}</span>
          <span style={{ fontWeight: 600, color: "#111", minWidth: 150 }}>{c.action}</span>
          <span
            style={{
              flex: 1,
              color: "#555",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {c.payload ? JSON.stringify(c.payload).slice(0, 140) : ""}
          </span>
          <span style={{ color: c.status === "success" ? "#16a34a" : "#dc2626" }}>
            {c.status === "success" ? "ok" : c.error || c.status}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Kampagne bearbeiten: Budget, Targeting, Zielgruppen + Drilldown ──────── */
function CampaignEditor({
  clientId,
  S,
  cur,
  campaign,
  groups,
  ads,
  audiences,
  canWrite,
  onChanged,
  onDuplicate,
}: {
  clientId: string;
  S: Tokens;
  cur: string;
  campaign: CampaignLite;
  groups: AdGroup[];
  ads: Ad[];
  audiences: Data["audiences"];
  canWrite: boolean;
  onChanged: () => void;
  onDuplicate: () => void;
}) {
  const [sub, setSub] = useState<"targeting" | "audiences" | null>(null);
  const [budget, setBudget] = useState(
    campaign.budget_daily_micros != null ? String(campaign.budget_daily_micros / 1e6) : "",
  );
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const cmd = async (key: string, c: string, extra: any) => {
    setBusy(key);
    setErr("");
    const j = await post({
      action: "command",
      clientId,
      cmd: c,
      targetType: "campaign",
      targetId: campaign.openai_campaign_id,
      ...extra,
    });
    setBusy("");
    if (!j.ok) {
      setErr(j.error || "Fehler");
      return false;
    }
    onChanged();
    return true;
  };
  return (
    <div style={{ display: "grid", gap: 12, paddingTop: 8 }}>
      {canWrite && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            flexWrap: "wrap",
            fontSize: 12.5,
          }}
        >
          <span style={{ fontWeight: 600, color: "#111" }}>Budget/Tag</span>
          <input
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            style={{
              width: 90,
              border: `1px solid ${S.line}`,
              borderRadius: 8,
              padding: "5px 8px",
              fontSize: 12.5,
            }}
          />
          <span style={{ color: "#777" }}>{cur}</span>
          <button
            onClick={() => {
              const v = Math.round(Number(budget.replace(",", ".")) * 1e6);
              if (v > 0) cmd("budget", "set_budget", { budgetDailyMicros: v });
            }}
            disabled={busy === "budget"}
            style={pill(S)}
          >
            {busy === "budget" ? "…" : "Speichern"}
          </button>
          <button
            onClick={() => setSub(sub === "targeting" ? null : "targeting")}
            style={pill(S, sub === "targeting")}
          >
            Targeting
          </button>
          <button
            onClick={() => setSub(sub === "audiences" ? null : "audiences")}
            style={pill(S, sub === "audiences")}
          >
            Zielgruppen
          </button>
          {err && <span style={{ color: "#b91c1c" }}>{err}</span>}
        </div>
      )}
      {sub === "targeting" && (
        <div
          style={{
            background: "#fff",
            border: `1px solid ${S.line}`,
            borderRadius: 12,
            padding: 14,
          }}
        >
          <TargetingEditor
            clientId={clientId}
            S={S}
            initial={(campaign.targeting_locations || []) as GeoLocation[]}
            initialExcluded={campaign.targeting?.excluded_locations?.include || []}
            busy={busy === "targeting"}
            onSave={async (locations, excludedLocations) => {
              if (await cmd("targeting", "set_targeting", { locations, excludedLocations }))
                setSub(null);
            }}
            onCancel={() => setSub(null)}
          />
        </div>
      )}
      {sub === "audiences" && (
        <div
          style={{
            background: "#fff",
            border: `1px solid ${S.line}`,
            borderRadius: 12,
            padding: 14,
          }}
        >
          <AudiencesEditor
            S={S}
            audiences={audiences}
            initialInclude={campaign.targeting?.custom_audiences?.ids || []}
            initialExclude={campaign.targeting?.excluded_custom_audiences?.ids || []}
            busy={busy === "audiences"}
            onSave={async (includeIds, excludeIds) => {
              if (await cmd("audiences", "set_audiences", { includeIds, excludeIds })) setSub(null);
            }}
            onCancel={() => setSub(null)}
          />
        </div>
      )}
      <CampaignDrilldown
        clientId={clientId}
        S={S}
        cur={cur}
        campaign={campaign}
        groups={groups}
        ads={ads}
        canWrite={canWrite}
        onChanged={onChanged}
        onDuplicate={onDuplicate}
      />
    </div>
  );
}

/* ── Anzeigengruppe bearbeiten (Name, Abrechnung, Strategie, Festgebot) ───── */
function AdGroupEditor({
  clientId,
  S,
  cur,
  group,
  onChanged,
  onClose,
}: {
  clientId: string;
  S: Tokens;
  cur: string;
  group: AdGroup;
  onChanged: () => void;
  onClose: () => void;
}) {
  const bc = group.bidding_config || {};
  const [name, setName] = useState(group.name);
  const [billing, setBilling] = useState<"impression" | "click">(
    bc.billing_event_type === "click" ? "click" : "impression",
  );
  const [strategy, setStrategy] = useState(bc.strategy || "");
  const [bid, setBid] = useState(bc.max_bid_micros ? String(bc.max_bid_micros / 1e6) : "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const inp: React.CSSProperties = {
    border: `1px solid ${S.line}`,
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 12.5,
    background: "#fff",
    fontFamily: "inherit",
  };
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap",
        paddingTop: 8,
        fontSize: 12.5,
      }}
    >
      <span style={{ fontWeight: 600, color: "#111" }}>Anzeigengruppe bearbeiten</span>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ ...inp, width: 240 }}
      />
      <select value={billing} onChange={(e) => setBilling(e.target.value as any)} style={inp}>
        <option value="impression">je Impression</option>
        <option value="click">je Klick</option>
      </select>
      <select value={strategy} onChange={(e) => setStrategy(e.target.value)} style={inp}>
        <option value="">Auto-Gebot</option>
        <option value="maximize_clicks">Klicks maximieren</option>
        <option value="maximize_conversions">Conversions maximieren</option>
        <option value="fixed_bid">Festgebot</option>
      </select>
      {strategy === "fixed_bid" && (
        <input
          value={bid}
          onChange={(e) => setBid(e.target.value)}
          placeholder={`max. ${cur}`}
          style={{ ...inp, width: 90 }}
        />
      )}
      <button
        onClick={async () => {
          setBusy(true);
          setErr("");
          const j = await post({
            action: "adgroup-update",
            clientId,
            adGroupId: group.openai_ad_group_id,
            name,
            billingEventType: billing,
            strategy: strategy || undefined,
            maxBidMicros:
              strategy === "fixed_bid"
                ? Math.round(Number(bid.replace(",", ".")) * 1e6)
                : undefined,
          });
          setBusy(false);
          if (!j.ok) {
            setErr(j.error || "Fehler");
            return;
          }
          onChanged();
          onClose();
        }}
        disabled={busy || name.trim().length < 3}
        style={pill(S, false, true)}
      >
        {busy ? "Speichere…" : "Speichern"}
      </button>
      <button onClick={onClose} style={pill(S)}>
        Abbrechen
      </button>
      {err && <span style={{ color: "#b91c1c" }}>{err}</span>}
    </div>
  );
}
