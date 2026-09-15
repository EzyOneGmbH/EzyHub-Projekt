// EzyAI — Ads-Modus, Vollsteuerung (13.09.2026): alles, was bisher nur im
// OpenAI Ads Manager ging — Kampagne/Anzeigengruppe/Anzeige anlegen und
// bearbeiten (inkl. Bild-Upload), Status auf allen Ebenen, Aufschlüsselung
// nach Land/Gerät/Plattform, Konto pausieren, Zielgruppen ergänzen, Konto-
// Auswahl beim Verbinden. Eigene Datei, damit EzyAiCampaignsPanel lesbar
// bleibt; alle Aufrufe gehen an /api/admin/chatgpt-ads (Server = Sync-Layer).
import { useCallback, useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { supabase } from "@/integrations/supabase/client";

type Tokens = Record<string, string>;
const accentOf = (S: Tokens) => S["accent"] || S.app || "#77008C";
const inkOf = (S: Tokens) => S["ink"] || S.txt || "#0D0D0D";

export type GeoLocation = { id: string; name: string; type?: string; country_code?: string };
export type AdGroup = {
  openai_ad_group_id: string;
  name: string;
  status: string;
  campaign_id: string | null;
  bidding_config: {
    billing_event_type?: string;
    strategy?: string;
    max_bid_micros?: number;
  } | null;
  context_hints?: string[];
};
export type AdLite = {
  openai_ad_id: string;
  name: string | null;
  status: string;
  review_status: string | null;
  ad_group_name: string | null;
  ad_group_id: string | null;
  campaign_id: string | null;
  creative: {
    type: string | null;
    title: string | null;
    body: string | null;
    target_url: string | null;
    file_id?: string | null;
  };
};
export type CampaignLite = {
  openai_campaign_id: string;
  name: string;
  status: string;
  bidding_type: string | null;
  objective: string | null;
  budget_daily_micros: number | null;
  budget_lifetime_micros: number | null;
  start_time?: string | null;
  end_time?: string | null;
  targeting_locations?: GeoLocation[] | null;
  targeting?: {
    custom_audiences?: { ids?: string[] };
    excluded_custom_audiences?: { ids?: string[] };
    excluded_locations?: { include?: GeoLocation[] };
  } | null;
  conversion_event_setting_ids?: string[] | null;
};
export type AccountMeta = {
  status: string | null;
  url: string | null;
  review: { status: string; reason: string | null } | null;
  integrity: { status: string; reason: string | null } | null;
  fetched_at: string;
} | null;

async function adsPost(body: any): Promise<any> {
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
  return {
    ...j,
    ok: !!j.ok,
    status: r.status,
    error: j.error || (r.ok ? undefined : `HTTP ${r.status}`),
  };
}

const fmtMoney = (n: number, cur: string) =>
  `${cur} ${n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n: number) => n.toLocaleString("de-CH");
const toMicros = (s: string) => Math.round((Number(String(s).replace(",", ".")) || 0) * 1_000_000);
const fromMicros = (m: number | null | undefined) => (m == null ? "" : String(m / 1_000_000));
const dayInput = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : "");

const REVIEW_LABEL: Record<string, [string, string]> = {
  approved: ["freigegeben", "#0f9d6c"],
  in_review: ["in Prüfung", "#d97706"],
  pending: ["in Prüfung", "#d97706"],
  rejected: ["abgelehnt", "#dc2626"],
};

function btnStyle(
  S: Tokens,
  primary: boolean,
  disabled = false,
  danger = false,
): React.CSSProperties {
  return {
    border: primary ? "none" : `1px solid ${danger ? "#dc262655" : S.line}`,
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? "default" : "pointer",
    background: primary ? (danger ? "#dc2626" : accentOf(S)) : "transparent",
    color: primary ? "#fff" : danger ? "#b91c1c" : inkOf(S),
    opacity: disabled ? 0.5 : 1,
  };
}
function inputStyle(S: Tokens): React.CSSProperties {
  return {
    border: `1px solid ${S.line}`,
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 12.5,
    background: S.bg,
    color: inkOf(S),
    boxSizing: "border-box",
    width: "100%",
  };
}
function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 10.5,
        fontWeight: 700,
        color,
        border: `1px solid ${color}44`,
        borderRadius: 99,
        padding: "1px 8px",
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
const statusPill = (status: string) =>
  status === "active" ? (
    <Pill label="aktiv" color="#0f9d6c" />
  ) : status === "paused" ? (
    <Pill label="pausiert" color="#92400e" />
  ) : (
    <Pill label={status} color="#8b8da3" />
  );

/* ── Geo-Suche (geo_lookup) als Chip-Editor, wiederverwendbar ─────────────── */
export function GeoChips({
  clientId,
  S,
  value,
  onChange,
  placeholder,
  emptyLabel,
}: {
  clientId: string;
  S: Tokens;
  value: GeoLocation[];
  onChange: (v: GeoLocation[]) => void;
  placeholder: string;
  emptyLabel: string;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<GeoLocation[]>([]);
  const [searching, setSearching] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    let alive = true;
    const t = setTimeout(async () => {
      setSearching(true);
      const j = await adsPost({ action: "geo-search", clientId, q: q.trim() });
      if (alive) {
        setResults(j.ok ? j.locations || [] : []);
        setSearching(false);
      }
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, clientId]);
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {value.length === 0 && <span style={{ color: S.mut }}>{emptyLabel}</span>}
        {value.map((l) => (
          <span
            key={l.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: `1px solid ${S.line}`,
              borderRadius: 999,
              padding: "3px 10px",
              background: S.panel,
              color: inkOf(S),
            }}
          >
            {l.name}
            {l.type && l.type !== "country" && (
              <span style={{ color: S.mut, fontSize: 10.5 }}>{l.type}</span>
            )}
            <button
              onClick={() => onChange(value.filter((x) => x.id !== l.id))}
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: S.mut,
                padding: 0,
              }}
              title="Entfernen"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div style={{ position: "relative", maxWidth: 420 }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          style={inputStyle(S)}
        />
        {(results.length > 0 || searching) && (
          <div
            style={{
              position: "absolute",
              top: "100%",
              left: 0,
              right: 0,
              zIndex: 5,
              background: S.panel,
              border: `1px solid ${S.line}`,
              borderRadius: 8,
              boxShadow: "0 6px 20px rgba(0,0,0,.08)",
              marginTop: 4,
              maxHeight: 220,
              overflowY: "auto",
            }}
          >
            {searching && <div style={{ padding: "6px 10px", color: S.mut }}>Suche…</div>}
            {results.map((l) => (
              <div
                key={l.id}
                onClick={() => {
                  if (!value.some((x) => x.id === l.id)) onChange([...value, l]);
                  setQ("");
                  setResults([]);
                }}
                style={{
                  padding: "6px 10px",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  color: inkOf(S),
                }}
              >
                <span>{l.name}</span>
                <span style={{ color: S.mut, fontSize: 11 }}>
                  {[l.type, l.country_code].filter(Boolean).join(" · ")}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Bild-Upload (Browser → Base64 → Server → POST /upload) ───────────────── */
export function ImagePicker({
  clientId,
  S,
  fileId,
  onFileId,
}: {
  clientId: string;
  S: Tokens;
  fileId: string | null;
  onFileId: (id: string | null, previewUrl: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const pick = async (f: File | null) => {
    if (!f) return;
    setErr("");
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) {
      setErr("Nur JPEG, PNG oder WebP");
      return;
    }
    if (f.size > 6 * 1024 * 1024) {
      setErr("Maximal 6 MB");
      return;
    }
    // Mindestgrösse 640×640 (Doku) lokal prüfen, bevor der Upload läuft.
    const url = URL.createObjectURL(f);
    const dims = await new Promise<{ w: number; h: number }>((res) => {
      const img = new Image();
      img.onload = () => res({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = () => res({ w: 0, h: 0 });
      img.src = url;
    });
    if (dims.w < 640 || dims.h < 640) {
      setErr(`Bild zu klein (${dims.w}×${dims.h}) — mindestens 640×640 Pixel`);
      URL.revokeObjectURL(url);
      return;
    }
    setBusy(true);
    const b64 = await new Promise<string>((res) => {
      const rd = new FileReader();
      rd.onload = () => res(String(rd.result || "").split(",")[1] || "");
      rd.readAsDataURL(f);
    });
    const j = await adsPost({
      action: "image-upload",
      clientId,
      fileName: f.name,
      mimeType: f.type,
      dataBase64: b64,
    });
    setBusy(false);
    if (!j.ok) {
      setErr(j.error || "Upload fehlgeschlagen");
      return;
    }
    setPreview(url);
    onFileId(j.fileId, url);
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 12.5 }}>
      <div
        style={{
          width: 72,
          height: 72,
          borderRadius: 10,
          border: `1px dashed ${S.line}`,
          background: preview ? `url(${preview}) center/cover` : S.bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: S.mut,
          fontSize: 11,
          flexShrink: 0,
        }}
      >
        {!preview && (fileId ? "Bild ✓" : "kein Bild")}
      </div>
      <div>
        <label style={{ ...btnStyle(S, false, busy), display: "inline-block" }}>
          {busy ? "Lade hoch…" : fileId ? "Bild ersetzen…" : "Bild wählen…"}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            style={{ display: "none" }}
            disabled={busy}
            onChange={(e) => pick(e.target.files?.[0] || null)}
          />
        </label>
        <div style={{ color: err ? "#b91c1c" : S.mut, fontSize: 11, marginTop: 4 }}>
          {err || "JPEG/PNG/WebP, quadratisch, mind. 640×640 px, max. 6 MB"}
        </div>
      </div>
    </div>
  );
}

/* ── Lokale Chat-Card-Vorschau (ohne API) ─────────────────────────────────── */
function CardPreview({
  S,
  title,
  body,
  url,
  img,
}: {
  S: Tokens;
  title: string;
  body: string;
  url: string;
  img: string | null;
}) {
  return (
    <div
      style={{
        maxWidth: 360,
        border: `1px solid ${S.line}`,
        borderRadius: 14,
        padding: "12px 14px",
        background: "#fff",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "#8b8da3",
          letterSpacing: ".04em",
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        Gesponsert
      </div>
      {img && (
        <div
          style={{
            width: "100%",
            aspectRatio: "1 / 1",
            borderRadius: 10,
            background: `url(${img}) center/cover`,
            marginBottom: 8,
          }}
        />
      )}
      <div style={{ fontSize: 14.5, fontWeight: 700, color: "#111", marginBottom: 3 }}>
        {title || "Titel der Anzeige"}
      </div>
      <div style={{ fontSize: 12.5, color: "#444", lineHeight: 1.45, marginBottom: 8 }}>
        {body || "Text der Anzeige (max. 100 Zeichen)"}
      </div>
      <div style={{ fontSize: 11.5, color: "#77008C", fontWeight: 600 }}>
        {url ? url.replace(/^https?:\/\//, "") : "ziel-url.ch"} →
      </div>
    </div>
  );
}

/* ── Anzeige anlegen/bearbeiten ───────────────────────────────────────────── */
function AdForm({
  clientId,
  S,
  initial,
  onSave,
  onCancel,
  busy,
  createMode,
}: {
  clientId: string;
  S: Tokens;
  initial?: {
    name?: string | null;
    title?: string | null;
    body?: string | null;
    target_url?: string | null;
    file_id?: string | null;
  };
  onSave: (v: {
    name: string;
    title: string;
    body: string;
    targetUrl: string;
    fileId: string | null;
    status: "active" | "paused";
  }) => void;
  onCancel: () => void;
  busy: boolean;
  createMode: boolean;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [title, setTitle] = useState(initial?.title || "");
  const [body, setBody] = useState(initial?.body || "");
  const [url, setUrl] = useState(initial?.target_url || "");
  const [fileId, setFileId] = useState<string | null>(initial?.file_id || null);
  const [img, setImg] = useState<string | null>(null);
  const [status, setStatus] = useState<"active" | "paused">("paused");
  const valid =
    title.trim().length >= 3 &&
    title.length <= 50 &&
    body.length <= 100 &&
    (!createMode || name.trim().length >= 3) &&
    (!url || /^https?:\/\/\S+$/i.test(url));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 8 }}>
        {createMode && (
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Interner Name der Anzeige"
            style={inputStyle(S)}
          />
        )}
        <div>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value.slice(0, 50))}
            placeholder="Titel (3–50 Zeichen)"
            style={inputStyle(S)}
          />
          <div style={{ fontSize: 10.5, color: S.mut, textAlign: "right" }}>{title.length}/50</div>
        </div>
        <div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 100))}
            placeholder="Text (max. 100 Zeichen)"
            rows={2}
            style={{ ...inputStyle(S), resize: "vertical" }}
          />
          <div style={{ fontSize: 10.5, color: S.mut, textAlign: "right" }}>{body.length}/100</div>
        </div>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Ziel-URL (https://…)"
          style={inputStyle(S)}
        />
        <ImagePicker
          clientId={clientId}
          S={S}
          fileId={fileId}
          onFileId={(id, p) => {
            setFileId(id);
            setImg(p);
          }}
        />
        {createMode && (
          <label
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: S.mut }}
          >
            <input
              type="checkbox"
              checked={status === "active"}
              onChange={(e) => setStatus(e.target.checked ? "active" : "paused")}
            />
            nach der Freigabe sofort aktiv (sonst pausiert angelegt)
          </label>
        )}
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() =>
              onSave({
                name: name.trim(),
                title: title.trim(),
                body: body.trim(),
                targetUrl: url.trim(),
                fileId,
                status,
              })
            }
            disabled={busy || !valid}
            style={btnStyle(S, true, busy || !valid)}
          >
            {busy ? "Speichere…" : createMode ? "Anzeige anlegen" : "Änderung speichern"}
          </button>
          <button onClick={onCancel} style={btnStyle(S, false)}>
            Abbrechen
          </button>
        </div>
        {!createMode && (
          <div style={{ fontSize: 11, color: S.mut }}>
            Jede Änderung geht erneut in die Prüfung durch OpenAI.
          </div>
        )}
      </div>
      <CardPreview S={S} title={title} body={body} url={url} img={img} />
    </div>
  );
}

/* ── Kampagnen-Wizard: Kampagne → Anzeigengruppe → Anzeige in einem Zug ───── */
export function CampaignWizard({
  clientId,
  S,
  card,
  cur,
  audiences,
  prefill,
  onDone,
  onCancel,
}: {
  clientId: string;
  S: Tokens;
  card: React.CSSProperties;
  cur: string;
  audiences: Array<{ openai_audience_id: string; name: string; status: string }>;
  prefill?: { campaign: CampaignLite; group?: AdGroup | null; ad?: AdLite | null } | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const pc = prefill?.campaign;
  const [name, setName] = useState(pc ? `${pc.name} (Kopie)` : "");
  const [objective, setObjective] = useState<"reach" | "clicks" | "conversions">(
    (pc?.objective as any) === "clicks" || (pc?.objective as any) === "conversions"
      ? (pc!.objective as any)
      : "reach",
  );
  const [daily, setDaily] = useState(fromMicros(pc?.budget_daily_micros) || "30");
  const [lifetime, setLifetime] = useState(fromMicros(pc?.budget_lifetime_micros));
  const [start, setStart] = useState(dayInput(pc?.start_time));
  const [end, setEnd] = useState(dayInput(pc?.end_time));
  const [locs, setLocs] = useState<GeoLocation[]>(pc?.targeting_locations || []);
  const [excl, setExcl] = useState<GeoLocation[]>(pc?.targeting?.excluded_locations?.include || []);
  const [incAud, setIncAud] = useState<string[]>(pc?.targeting?.custom_audiences?.ids || []);
  const [excAud, setExcAud] = useState<string[]>(
    pc?.targeting?.excluded_custom_audiences?.ids || [],
  );
  const [eventIds, setEventIds] = useState<string[]>(pc?.conversion_event_setting_ids || []);
  const [events, setEvents] = useState<Array<{ id: string; name: string; event_type: string }>>([]);
  const [withGroup, setWithGroup] = useState(true);
  const [groupName, setGroupName] = useState(prefill?.group?.name || "Anzeigengruppe 1");
  const [strategy, setStrategy] = useState<string>(prefill?.group?.bidding_config?.strategy || "");
  const [billing, setBilling] = useState<"impression" | "click">(
    (prefill?.group?.bidding_config?.billing_event_type as any) === "click"
      ? "click"
      : "impression",
  );
  const [maxBid, setMaxBid] = useState(fromMicros(prefill?.group?.bidding_config?.max_bid_micros));
  const [withAd, setWithAd] = useState(true);
  const [adName, setAdName] = useState(prefill?.ad?.name || "Anzeige 1");
  const [title, setTitle] = useState(prefill?.ad?.creative.title || "");
  const [body, setBody] = useState(prefill?.ad?.creative.body || "");
  const [url, setUrl] = useState(prefill?.ad?.creative.target_url || "");
  const [fileId, setFileId] = useState<string | null>(prefill?.ad?.creative.file_id || null);
  const [img, setImg] = useState<string | null>(null);
  const [activate, setActivate] = useState(false);
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [log, setLog] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    adsPost({ action: "conv-setup-get", clientId }).then((j) => {
      if (alive && j.ok) setEvents((j.eventSettings || []).filter((e: any) => !e.archived));
    });
    return () => {
      alive = false;
    };
  }, [clientId]);

  // Ziel → Gebotstyp (API: objective reach|clicks|conversions, bidding_type impressions|clicks|conversions).
  const biddingType = objective === "reach" ? "impressions" : objective;
  const dailyMicros = toMicros(daily);
  const lifetimeMicros = toMicros(lifetime);
  const campaignValid =
    name.trim().length >= 3 &&
    (dailyMicros >= 1_000_000 || lifetimeMicros >= 1_000_000) &&
    (objective !== "conversions" || eventIds.length > 0);
  const groupValid =
    !withGroup ||
    (groupName.trim().length >= 3 && (strategy !== "fixed_bid" || toMicros(maxBid) > 0));
  const adValid =
    !withAd ||
    !withGroup ||
    (adName.trim().length >= 3 &&
      title.trim().length >= 3 &&
      title.length <= 50 &&
      body.length <= 100 &&
      (!url || /^https?:\/\/\S+$/i.test(url)));
  const ready = campaignValid && groupValid && adValid && !busy;

  const submit = async () => {
    setErr("");
    setLog([]);
    setBusy("campaign");
    const c = await adsPost({
      action: "campaign-create",
      clientId,
      name: name.trim(),
      objective,
      biddingType,
      status: activate ? "active" : "paused",
      budgetDailyMicros: dailyMicros || undefined,
      budgetLifetimeMicros: lifetimeMicros || undefined,
      startTime: start || undefined,
      endTime: end || undefined,
      locations: locs,
      excludedLocations: excl,
      includeIds: incAud,
      excludeIds: excAud,
      eventSettingIds: eventIds,
    });
    if (!c.ok) {
      setErr(`Kampagne: ${c.error}`);
      setBusy("");
      return;
    }
    setLog((l) => [...l, `Kampagne angelegt (${c.id})`]);
    if (withGroup) {
      setBusy("group");
      const g = await adsPost({
        action: "adgroup-create",
        clientId,
        campaignId: c.id,
        name: groupName.trim(),
        status: activate ? "active" : "paused",
        billingEventType: billing,
        strategy: strategy || undefined,
        maxBidMicros: strategy === "fixed_bid" ? toMicros(maxBid) : undefined,
      });
      if (!g.ok) {
        setErr(
          `Anzeigengruppe: ${g.error} — die Kampagne existiert bereits, Gruppe im Drilldown nachholen.`,
        );
        setBusy("");
        onDone();
        return;
      }
      setLog((l) => [...l, `Anzeigengruppe angelegt (${g.id})`]);
      if (withAd) {
        setBusy("ad");
        const a = await adsPost({
          action: "ad-create",
          clientId,
          adGroupId: g.id,
          name: adName.trim(),
          status: activate ? "active" : "paused",
          title: title.trim(),
          body: body.trim(),
          targetUrl: url.trim(),
          fileId,
        });
        if (!a.ok) {
          setErr(
            `Anzeige: ${a.error} — Kampagne und Gruppe existieren, Anzeige im Drilldown nachholen.`,
          );
          setBusy("");
          onDone();
          return;
        }
        setLog((l) => [...l, `Anzeige angelegt (${a.id}) — geht in die Prüfung`]);
      }
    }
    setBusy("");
    onDone();
  };

  const sec: React.CSSProperties = {
    fontWeight: 800,
    fontSize: 13,
    margin: "14px 0 8px",
    color: inkOf(S),
  };
  const usableAud = audiences.filter((a) => a.status !== "archived");
  const toggleIn = (
    list: string[],
    set: (v: string[]) => void,
    other: string[],
    setOther: (v: string[]) => void,
    id: string,
  ) => {
    if (list.includes(id)) set(list.filter((x) => x !== id));
    else {
      set([...list, id]);
      if (other.includes(id)) setOther(other.filter((x) => x !== id));
    }
  };

  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 15 }}>
          {pc ? "Kampagne duplizieren" : "Neue Kampagne"}
        </div>
        <button onClick={onCancel} style={btnStyle(S, false)}>
          Schliessen
        </button>
      </div>
      <div style={{ fontSize: 12, color: S.mut, marginTop: 4, lineHeight: 1.6 }}>
        Kampagne, Anzeigengruppe und erste Anzeige werden nacheinander bei OpenAI angelegt —
        pausiert, bis du sie aktivierst. Anzeigen gehen automatisch in die Prüfung durch OpenAI.
      </div>

      <div style={sec}>1 · Kampagne</div>
      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 10 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Kampagnenname (z.B. Ezy One – Reichweite – CH)"
          style={inputStyle(S)}
        />
        <select
          value={objective}
          onChange={(e) => setObjective(e.target.value as any)}
          style={inputStyle(S)}
        >
          <option value="reach">Ziel: Reichweite (Gebot je Impression)</option>
          <option value="clicks">Ziel: Klicks (Gebot je Klick)</option>
          <option value="conversions">Ziel: Conversions</option>
        </select>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: S.mut }}
        >
          {cur}/Tag
          <input
            value={daily}
            onChange={(e) => setDaily(e.target.value)}
            style={{ ...inputStyle(S), width: 90 }}
          />
        </label>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 8 }}>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: S.mut }}
        >
          Laufzeitbudget ({cur}, optional)
          <input
            value={lifetime}
            onChange={(e) => setLifetime(e.target.value)}
            style={{ ...inputStyle(S), width: 100 }}
          />
        </label>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: S.mut }}
        >
          Start{" "}
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            style={inputStyle(S)}
          />
        </label>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: S.mut }}
        >
          Ende{" "}
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            style={inputStyle(S)}
          />
        </label>
      </div>
      {objective === "conversions" && (
        <div style={{ marginTop: 10, fontSize: 12.5 }}>
          <div style={{ color: S.mut, marginBottom: 4 }}>
            Conversion-Event (Pflicht bei Ziel Conversions):
          </div>
          {events.length === 0 ? (
            <div style={{ color: "#b45309" }}>
              Noch kein Conversion-Event definiert — unter Ads-Modus → Conversions anlegen.
            </div>
          ) : (
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {events.map((e) => (
                <label
                  key={e.id}
                  style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={eventIds.includes(e.id)}
                    onChange={() =>
                      setEventIds(
                        eventIds.includes(e.id)
                          ? eventIds.filter((x) => x !== e.id)
                          : [...eventIds, e.id],
                      )
                    }
                  />
                  {e.name} <span style={{ color: S.mut }}>({e.event_type})</span>
                </label>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12.5, color: S.mut, marginBottom: 4 }}>
          Regionen einschliessen (leer = weltweit):
        </div>
        <GeoChips
          clientId={clientId}
          S={S}
          value={locs}
          onChange={setLocs}
          placeholder="Land, Kanton oder Region suchen …"
          emptyLabel="weltweit"
        />
      </div>
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 12.5, color: S.mut, marginBottom: 4 }}>
          Regionen ausschliessen (optional):
        </div>
        <GeoChips
          clientId={clientId}
          S={S}
          value={excl}
          onChange={(v) => setExcl(v.filter((l) => !locs.some((x) => x.id === l.id)))}
          placeholder="Region ausschliessen …"
          emptyLabel="keine Ausschlüsse"
        />
      </div>
      {usableAud.length > 0 && (
        <div style={{ marginTop: 10, fontSize: 12.5 }}>
          <div style={{ color: S.mut, marginBottom: 4 }}>
            Zielgruppen (ein = nur diese Nutzer, aus = nicht bewerben):
          </div>
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
            {usableAud.map((a) => (
              <span
                key={a.openai_audience_id}
                style={{ display: "inline-flex", gap: 8, alignItems: "center" }}
              >
                {a.name}
                <label style={{ display: "flex", gap: 3, alignItems: "center", color: S.mut }}>
                  <input
                    type="checkbox"
                    checked={incAud.includes(a.openai_audience_id)}
                    onChange={() =>
                      toggleIn(incAud, setIncAud, excAud, setExcAud, a.openai_audience_id)
                    }
                  />{" "}
                  ein
                </label>
                <label style={{ display: "flex", gap: 3, alignItems: "center", color: S.mut }}>
                  <input
                    type="checkbox"
                    checked={excAud.includes(a.openai_audience_id)}
                    onChange={() =>
                      toggleIn(excAud, setExcAud, incAud, setIncAud, a.openai_audience_id)
                    }
                  />{" "}
                  aus
                </label>
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={sec}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={withGroup}
            onChange={(e) => setWithGroup(e.target.checked)}
          />{" "}
          2 · Anzeigengruppe gleich anlegen
        </label>
      </div>
      {withGroup && (
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 10 }}>
          <input
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Name der Anzeigengruppe"
            style={inputStyle(S)}
          />
          <select
            value={billing}
            onChange={(e) => setBilling(e.target.value as any)}
            style={inputStyle(S)}
          >
            <option value="impression">Abrechnung je Impression</option>
            <option value="click">Abrechnung je Klick</option>
          </select>
          <select
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
            style={inputStyle(S)}
          >
            <option value="">Auto-Gebot (empfohlen)</option>
            <option value="maximize_clicks">Klicks maximieren</option>
            <option value="maximize_conversions">Conversions maximieren</option>
            <option value="fixed_bid">Festgebot</option>
          </select>
          {strategy === "fixed_bid" && (
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12.5,
                color: S.mut,
              }}
            >
              max. {cur}{" "}
              <input
                value={maxBid}
                onChange={(e) => setMaxBid(e.target.value)}
                style={{ ...inputStyle(S), width: 80 }}
              />
            </label>
          )}
        </div>
      )}

      {withGroup && (
        <>
          <div style={sec}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={withAd}
                onChange={(e) => setWithAd(e.target.checked)}
              />{" "}
              3 · Erste Anzeige gleich anlegen
            </label>
          </div>
          {withAd && (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 16,
                alignItems: "start",
              }}
            >
              <div style={{ display: "grid", gap: 8 }}>
                <input
                  value={adName}
                  onChange={(e) => setAdName(e.target.value)}
                  placeholder="Interner Name der Anzeige"
                  style={inputStyle(S)}
                />
                <div>
                  <input
                    value={title}
                    onChange={(e) => setTitle(e.target.value.slice(0, 50))}
                    placeholder="Titel (3–50 Zeichen)"
                    style={inputStyle(S)}
                  />
                  <div style={{ fontSize: 10.5, color: S.mut, textAlign: "right" }}>
                    {title.length}/50
                  </div>
                </div>
                <div>
                  <textarea
                    value={body}
                    onChange={(e) => setBody(e.target.value.slice(0, 100))}
                    placeholder="Text (max. 100 Zeichen)"
                    rows={2}
                    style={{ ...inputStyle(S), resize: "vertical" }}
                  />
                  <div style={{ fontSize: 10.5, color: S.mut, textAlign: "right" }}>
                    {body.length}/100
                  </div>
                </div>
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="Ziel-URL (https://…)"
                  style={inputStyle(S)}
                />
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
              <CardPreview S={S} title={title} body={body} url={url} img={img} />
            </div>
          )}
        </>
      )}

      <div
        style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}
      >
        <button onClick={submit} disabled={!ready} style={btnStyle(S, true, !ready)}>
          {busy === "campaign"
            ? "Lege Kampagne an…"
            : busy === "group"
              ? "Lege Anzeigengruppe an…"
              : busy === "ad"
                ? "Lege Anzeige an…"
                : "Bei OpenAI anlegen"}
        </button>
        <label
          style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: S.mut }}
        >
          <input
            type="checkbox"
            checked={activate}
            onChange={(e) => setActivate(e.target.checked)}
          />{" "}
          sofort aktiv (statt pausiert)
        </label>
        {!campaignValid && (
          <span style={{ fontSize: 11.5, color: S.mut }}>
            Name (≥ 3 Zeichen) und Budget (≥ 1.00) nötig
            {objective === "conversions" ? ", plus Conversion-Event" : ""}
          </span>
        )}
      </div>
      {log.map((l, i) => (
        <div key={i} style={{ fontSize: 12, color: "#0f9d6c", marginTop: 4 }}>
          ✓ {l}
        </div>
      ))}
      {err && (
        <div style={{ fontSize: 12.5, color: "#b91c1c", marginTop: 6, fontWeight: 700 }}>{err}</div>
      )}
    </div>
  );
}

/* ── Drilldown je Kampagne: Details, Anzeigengruppen, Anzeigen ────────────── */
export function CampaignDrilldown({
  clientId,
  S,
  cur,
  campaign,
  groups,
  ads,
  canWrite,
  onChanged,
  onDuplicate,
}: {
  clientId: string;
  S: Tokens;
  cur: string;
  campaign: CampaignLite;
  groups: AdGroup[];
  ads: AdLite[];
  canWrite: boolean;
  onChanged: () => void;
  onDuplicate: () => void;
}) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [preview, setPreview] = useState<{ id: string; html?: string; error?: string } | null>(
    null,
  );
  const [editAd, setEditAd] = useState<string | null>(null);
  const [newAdIn, setNewAdIn] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState(false);
  const [details, setDetails] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [gName, setGName] = useState("Anzeigengruppe");
  const [gStrategy, setGStrategy] = useState("");
  const [gBilling, setGBilling] = useState<"impression" | "click">("impression");
  const [gBid, setGBid] = useState("");
  const [dName, setDName] = useState(campaign.name);
  const [dLifetime, setDLifetime] = useState(fromMicros(campaign.budget_lifetime_micros));
  const [dStart, setDStart] = useState(dayInput(campaign.start_time));
  const [dEnd, setDEnd] = useState(dayInput(campaign.end_time));

  const run = async (key: string, body: any) => {
    setBusy(key);
    setErr("");
    const j = await adsPost({ clientId, ...body });
    setBusy("");
    if (!j.ok) {
      setErr(j.error || "Fehler");
      return false;
    }
    onChanged();
    return true;
  };
  const openPreview = async (adId: string) => {
    if (preview?.id === adId) {
      setPreview(null);
      return;
    }
    setBusy(`prev:${adId}`);
    const j = await adsPost({ action: "ad-preview", clientId, adId });
    setBusy("");
    setPreview(j.ok ? { id: adId, html: j.html } : { id: adId, error: j.error });
  };
  const adsByGroup = useMemo(() => {
    const m: Record<string, AdLite[]> = {};
    for (const a of ads) (m[a.ad_group_id || "?"] ??= []).push(a);
    return m;
  }, [ads]);
  const small = (primary = false, disabled = false, danger = false): React.CSSProperties => ({
    ...btnStyle(S, primary, disabled, danger),
    padding: "3px 9px",
    fontSize: 11,
  });
  const confirmBtn = (key: string, label: string, body: any, danger = false) =>
    confirm === key ? (
      <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
        <span style={{ color: "#92400e", fontSize: 11.5 }}>{label}?</span>
        <button
          onClick={async () => {
            setConfirm(null);
            await run(key, body);
          }}
          style={small(true, false, danger)}
        >
          Ja
        </button>
        <button onClick={() => setConfirm(null)} style={small()}>
          Nein
        </button>
      </span>
    ) : (
      <button
        onClick={() => setConfirm(key)}
        disabled={busy === key}
        style={small(false, busy === key, danger)}
      >
        {label}
      </button>
    );

  return (
    <div style={{ fontSize: 12.5, display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Kampagnen-Ebene */}
      {canWrite && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontWeight: 700, color: inkOf(S) }}>Kampagne:</span>
          <button onClick={() => setDetails((v) => !v)} style={small(details)}>
            Details bearbeiten
          </button>
          <button onClick={onDuplicate} style={small()}>
            Duplizieren
          </button>
          <button onClick={() => setNewGroup((v) => !v)} style={small(newGroup)}>
            + Anzeigengruppe
          </button>
          {confirmBtn(
            "archive-camp",
            "Archivieren",
            {
              action: "entity-command",
              kind: "campaign",
              id: campaign.openai_campaign_id,
              cmd: "archive",
            },
            true,
          )}
        </div>
      )}
      {details && (
        <div
          style={{
            border: `1px solid ${S.line}`,
            borderRadius: 10,
            padding: 12,
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr 1fr auto",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            value={dName}
            onChange={(e) => setDName(e.target.value)}
            placeholder="Name"
            style={inputStyle(S)}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 6, color: S.mut }}>
            Laufzeit {cur}{" "}
            <input
              value={dLifetime}
              onChange={(e) => setDLifetime(e.target.value)}
              style={{ ...inputStyle(S), width: 90 }}
              placeholder="–"
            />
          </label>
          <input
            type="date"
            value={dStart}
            onChange={(e) => setDStart(e.target.value)}
            style={inputStyle(S)}
          />
          <input
            type="date"
            value={dEnd}
            onChange={(e) => setDEnd(e.target.value)}
            style={inputStyle(S)}
          />
          <button
            onClick={async () => {
              const ok = await run("details", {
                action: "campaign-update",
                campaignId: campaign.openai_campaign_id,
                name: dName,
                budgetLifetimeMicros: toMicros(dLifetime) || 0,
                startTime: dStart || null,
                endTime: dEnd || null,
              });
              if (ok) setDetails(false);
            }}
            disabled={busy === "details" || dName.trim().length < 3}
            style={small(true, busy === "details")}
          >
            Speichern
          </button>
        </div>
      )}
      {newGroup && (
        <div
          style={{
            border: `1px solid ${S.line}`,
            borderRadius: 10,
            padding: 12,
            display: "grid",
            gridTemplateColumns: "2fr 1fr 1fr auto auto",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            value={gName}
            onChange={(e) => setGName(e.target.value)}
            placeholder="Name der Anzeigengruppe"
            style={inputStyle(S)}
          />
          <select
            value={gBilling}
            onChange={(e) => setGBilling(e.target.value as any)}
            style={inputStyle(S)}
          >
            <option value="impression">je Impression</option>
            <option value="click">je Klick</option>
          </select>
          <select
            value={gStrategy}
            onChange={(e) => setGStrategy(e.target.value)}
            style={inputStyle(S)}
          >
            <option value="">Auto-Gebot</option>
            <option value="maximize_clicks">Klicks maximieren</option>
            <option value="maximize_conversions">Conversions maximieren</option>
            <option value="fixed_bid">Festgebot</option>
          </select>
          {gStrategy === "fixed_bid" ? (
            <input
              value={gBid}
              onChange={(e) => setGBid(e.target.value)}
              placeholder={`max. ${cur}`}
              style={{ ...inputStyle(S), width: 90 }}
            />
          ) : (
            <span />
          )}
          <button
            onClick={async () => {
              const ok = await run("newgroup", {
                action: "adgroup-create",
                campaignId: campaign.openai_campaign_id,
                name: gName,
                billingEventType: gBilling,
                strategy: gStrategy || undefined,
                maxBidMicros: gStrategy === "fixed_bid" ? toMicros(gBid) : undefined,
              });
              if (ok) setNewGroup(false);
            }}
            disabled={busy === "newgroup" || gName.trim().length < 3}
            style={small(true, busy === "newgroup")}
          >
            Anlegen
          </button>
        </div>
      )}
      {err && <div style={{ color: "#b91c1c", fontWeight: 700 }}>{err}</div>}

      {/* Anzeigengruppen */}
      {groups.length === 0 && (
        <div style={{ color: S.mut }}>
          Noch keine Anzeigengruppe — oben «+ Anzeigengruppe», danach Anzeigen anlegen.
        </div>
      )}
      {groups.map((g) => {
        const gAds = adsByGroup[g.openai_ad_group_id] || [];
        const bc = g.bidding_config || {};
        return (
          <div
            key={g.openai_ad_group_id}
            style={{
              border: `1px solid ${S.line}`,
              borderRadius: 10,
              padding: "8px 12px",
              background: S.panel,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontWeight: 700, color: inkOf(S) }}>{g.name}</span>
              {statusPill(g.status)}
              <span style={{ color: S.mut, fontSize: 11 }}>
                {bc.strategy === "fixed_bid"
                  ? `Festgebot ${bc.max_bid_micros ? fmtMoney(bc.max_bid_micros / 1e6, cur) : ""}`
                  : bc.strategy === "maximize_clicks"
                    ? "Klicks maximieren"
                    : bc.strategy === "maximize_conversions"
                      ? "Conversions maximieren"
                      : "Auto-Gebot"}
                {bc.billing_event_type
                  ? ` · je ${bc.billing_event_type === "click" ? "Klick" : "Impression"}`
                  : ""}
              </span>
              {canWrite && (
                <span style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
                  <button
                    onClick={() =>
                      run(`g:${g.openai_ad_group_id}`, {
                        action: "entity-command",
                        kind: "ad_group",
                        id: g.openai_ad_group_id,
                        cmd: g.status === "active" ? "pause" : "activate",
                      })
                    }
                    disabled={busy === `g:${g.openai_ad_group_id}`}
                    style={small()}
                  >
                    {g.status === "active" ? "Pausieren" : "Aktivieren"}
                  </button>
                  <button
                    onClick={() =>
                      setNewAdIn(newAdIn === g.openai_ad_group_id ? null : g.openai_ad_group_id)
                    }
                    style={small(newAdIn === g.openai_ad_group_id)}
                  >
                    + Anzeige
                  </button>
                  {confirmBtn(
                    `ga:${g.openai_ad_group_id}`,
                    "Archivieren",
                    {
                      action: "entity-command",
                      kind: "ad_group",
                      id: g.openai_ad_group_id,
                      cmd: "archive",
                    },
                    true,
                  )}
                </span>
              )}
            </div>
            {newAdIn === g.openai_ad_group_id && (
              <div style={{ marginTop: 10, borderTop: `1px solid ${S.line}22`, paddingTop: 10 }}>
                <AdForm
                  clientId={clientId}
                  S={S}
                  createMode
                  busy={busy === "newad"}
                  onCancel={() => setNewAdIn(null)}
                  onSave={async (v) => {
                    const ok = await run("newad", {
                      action: "ad-create",
                      adGroupId: g.openai_ad_group_id,
                      ...v,
                    });
                    if (ok) setNewAdIn(null);
                  }}
                />
              </div>
            )}
            {gAds.map((a) => {
              const [rl, rc] = REVIEW_LABEL[a.review_status || ""] || [
                a.review_status || "–",
                "#8b8da3",
              ];
              const isOpen = preview?.id === a.openai_ad_id;
              return (
                <div
                  key={a.openai_ad_id}
                  style={{ marginTop: 8, paddingTop: 8, borderTop: `1px solid ${S.line}22` }}
                >
                  {editAd === a.openai_ad_id ? (
                    <AdForm
                      clientId={clientId}
                      S={S}
                      createMode={false}
                      initial={{ name: a.name, ...a.creative }}
                      busy={busy === `edit:${a.openai_ad_id}`}
                      onCancel={() => setEditAd(null)}
                      onSave={async (v) => {
                        const ok = await run(`edit:${a.openai_ad_id}`, {
                          action: "ad-update",
                          adId: a.openai_ad_id,
                          title: v.title,
                          body: v.body,
                          targetUrl: v.targetUrl,
                          fileId: v.fileId,
                        });
                        if (ok) setEditAd(null);
                      }}
                    />
                  ) : (
                    <div
                      style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}
                    >
                      <div style={{ flex: 1, minWidth: 220 }}>
                        <span style={{ fontWeight: 700, color: inkOf(S) }}>
                          {a.creative.title || a.name || a.openai_ad_id}
                        </span>
                        {a.name && a.creative.title && (
                          <span style={{ color: S.mut, marginLeft: 8, fontSize: 11 }}>
                            {a.name}
                          </span>
                        )}
                        {a.creative.body && (
                          <div style={{ color: S.mut, marginTop: 2, lineHeight: 1.45 }}>
                            {a.creative.body}
                          </div>
                        )}
                        {a.creative.target_url && (
                          <div style={{ fontSize: 11, color: S.mut, marginTop: 2 }}>
                            {a.creative.target_url}
                          </div>
                        )}
                      </div>
                      {statusPill(a.status)}
                      <Pill label={rl} color={rc} />
                      <button
                        onClick={() => openPreview(a.openai_ad_id)}
                        disabled={busy === `prev:${a.openai_ad_id}`}
                        style={small(isOpen)}
                      >
                        {busy === `prev:${a.openai_ad_id}`
                          ? "Lade…"
                          : isOpen
                            ? "Vorschau zu"
                            : "Vorschau"}
                      </button>
                      {canWrite && (
                        <>
                          <button
                            onClick={() =>
                              run(`a:${a.openai_ad_id}`, {
                                action: "entity-command",
                                kind: "ad",
                                id: a.openai_ad_id,
                                cmd: a.status === "active" ? "pause" : "activate",
                              })
                            }
                            disabled={busy === `a:${a.openai_ad_id}`}
                            style={small()}
                          >
                            {a.status === "active" ? "Pausieren" : "Aktivieren"}
                          </button>
                          <button onClick={() => setEditAd(a.openai_ad_id)} style={small()}>
                            Bearbeiten
                          </button>
                          {confirmBtn(
                            `aa:${a.openai_ad_id}`,
                            "Archivieren",
                            {
                              action: "entity-command",
                              kind: "ad",
                              id: a.openai_ad_id,
                              cmd: "archive",
                            },
                            true,
                          )}
                        </>
                      )}
                    </div>
                  )}
                  {isOpen &&
                    (preview?.error ? (
                      <div style={{ color: "#b91c1c", marginTop: 8 }}>
                        Vorschau nicht ladbar: {preview.error}
                      </div>
                    ) : (
                      <iframe
                        title={`Vorschau ${a.openai_ad_id}`}
                        srcDoc={preview?.html || ""}
                        sandbox="allow-scripts allow-popups"
                        style={{
                          width: "100%",
                          height: 260,
                          border: `1px solid ${S.line}`,
                          borderRadius: 10,
                          marginTop: 10,
                          background: "#fff",
                        }}
                      />
                    ))}
                </div>
              );
            })}
            {gAds.length === 0 && newAdIn !== g.openai_ad_group_id && (
              <div style={{ color: S.mut, marginTop: 6, fontSize: 11.5 }}>
                Keine Anzeigen in dieser Gruppe.
              </div>
            )}
          </div>
        );
      })}
      <div style={{ fontSize: 11, color: S.mut }}>
        Review-Status und Freigabe entscheidet OpenAI; abgelehnte Anzeigen zeigen den Grund im Ads
        Manager (Einspruch nur dort).
      </div>
    </div>
  );
}

/* ── Aufschlüsselung nach Land / Gerät / Plattform ────────────────────────── */
export function BreakdownCard({
  clientId,
  S,
  card,
  cur,
  campaigns,
  start,
  end,
}: {
  clientId: string;
  S: Tokens;
  card: React.CSSProperties;
  cur: string;
  campaigns: Array<{ openai_campaign_id: string; name: string }>;
  start: string;
  end: string;
}) {
  const [segment, setSegment] = useState<"country" | "device" | "platform">("country");
  const [campaignId, setCampaignId] = useState("");
  const [rows, setRows] = useState<Array<{
    label: string;
    impressions: number;
    clicks: number;
    spend: number;
    conversions: number | null;
  }> | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [mock, setMock] = useState(false);
  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    const j = await adsPost({
      action: "insights-breakdown",
      clientId,
      segment,
      campaignId: campaignId || undefined,
      start,
      end,
    });
    setLoading(false);
    if (!j.ok) {
      setErr(j.error || "Fehler");
      setRows(null);
      return;
    }
    setRows(j.rows || []);
    setMock(!!j.mock);
  }, [clientId, segment, campaignId, start, end]);
  useEffect(() => {
    load();
  }, [load]);
  const total = (rows || []).reduce((a, r) => a + r.impressions, 0);
  const th: React.CSSProperties = {
    padding: "6px 10px",
    borderBottom: `1px solid ${S.line}`,
    textAlign: "left",
    color: S.mut,
    fontWeight: 600,
  };
  const td: React.CSSProperties = { padding: "6px 10px", borderBottom: `1px solid ${S.line}22` };
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 800 }}>Aufschlüsselung</div>
        <select
          value={segment}
          onChange={(e) => setSegment(e.target.value as any)}
          style={{ ...inputStyle(S), width: "auto" }}
        >
          <option value="country">nach Land</option>
          <option value="device">nach Gerät</option>
          <option value="platform">nach Plattform</option>
        </select>
        <select
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
          style={{ ...inputStyle(S), width: "auto", maxWidth: 320 }}
        >
          <option value="">alle Kampagnen</option>
          {campaigns.map((c) => (
            <option key={c.openai_campaign_id} value={c.openai_campaign_id}>
              {c.name}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11.5, color: S.mut }}>
          {start} – {end}
          {mock ? " · Demo-Verteilung" : ""}
        </span>
      </div>
      {err && <div style={{ color: "#b91c1c", fontSize: 12.5 }}>{err}</div>}
      {loading && !rows && <div style={{ color: S.mut, fontSize: 12.5 }}>Lade…</div>}
      {rows && rows.length === 0 && (
        <div style={{ color: S.mut, fontSize: 12.5 }}>Keine Daten im Zeitraum.</div>
      )}
      {rows && rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead>
              <tr>
                {[
                  segment === "country" ? "Land" : segment === "device" ? "Gerät" : "Plattform",
                  "Anteil",
                  "Impressionen",
                  "Klicks",
                  "CTR",
                  "Spend",
                  "Conv.",
                ].map((h) => (
                  <th key={h} style={th}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows
                .slice()
                .sort((a, b) => b.impressions - a.impressions)
                .map((r) => (
                  <tr key={r.label}>
                    <td style={{ ...td, fontWeight: 700, color: inkOf(S) }}>{r.label}</td>
                    <td style={td}>
                      <span
                        style={{
                          display: "inline-block",
                          width: 80,
                          height: 6,
                          background: `${accentOf(S)}22`,
                          borderRadius: 3,
                          verticalAlign: "middle",
                          marginRight: 6,
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            width: `${total ? (r.impressions / total) * 100 : 0}%`,
                            height: 6,
                            background: accentOf(S),
                            borderRadius: 3,
                          }}
                        />
                      </span>
                      {total ? ((r.impressions / total) * 100).toFixed(0) : 0} %
                    </td>
                    <td style={td}>{fmtNum(r.impressions)}</td>
                    <td style={td}>{fmtNum(r.clicks)}</td>
                    <td style={td}>
                      {r.impressions ? `${((r.clicks / r.impressions) * 100).toFixed(2)} %` : "–"}
                    </td>
                    <td style={td}>{fmtMoney(r.spend, cur)}</td>
                    <td style={td}>{r.conversions != null ? fmtNum(r.conversions) : "–"}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ── Konto-Leiste: Review-Status + Konto pausieren/aktivieren ─────────────── */
export function AccountControls({
  clientId,
  S,
  meta,
  canWrite,
  onChanged,
}: {
  clientId: string;
  S: Tokens;
  meta: AccountMeta;
  canWrite: boolean;
  onChanged: () => void;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const paused = meta?.status === "paused";
  const rv = meta?.review;
  const [rl, rc] = rv
    ? REVIEW_LABEL[rv.status] || [rv.status, "#8b8da3"]
    : ["Review unbekannt", "#8b8da3"];
  const toggle = async () => {
    setBusy(true);
    setErr("");
    const j = await adsPost({
      action: "account-command",
      clientId,
      cmd: paused ? "activate" : "pause",
    });
    setBusy(false);
    setConfirm(false);
    if (!j.ok) setErr(j.error || "Fehler");
    else onChanged();
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12 }}>
      <span title={rv?.reason || "Prüfung des Werbekontos durch OpenAI"}>
        <Pill label={`Konto: ${rl}`} color={rc} />
      </span>
      {meta?.integrity && meta.integrity.status !== "approved" && (
        <Pill
          label={`Integrität: ${REVIEW_LABEL[meta.integrity.status]?.[0] || meta.integrity.status}`}
          color="#d97706"
        />
      )}
      {paused && <Pill label="Konto pausiert" color="#dc2626" />}
      {canWrite &&
        (confirm ? (
          <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            <span style={{ color: "#92400e" }}>
              {paused ? "Konto aktivieren" : "Alle Kampagnen stoppen"}?
            </span>
            <button
              onClick={toggle}
              disabled={busy}
              style={{ ...btnStyle(S, true, busy, !paused), padding: "3px 9px", fontSize: 11 }}
            >
              Ja
            </button>
            <button
              onClick={() => setConfirm(false)}
              style={{ ...btnStyle(S, false), padding: "3px 9px", fontSize: 11 }}
            >
              Nein
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirm(true)}
            style={{ ...btnStyle(S, false, false, !paused), padding: "3px 9px", fontSize: 11 }}
          >
            {paused ? "Konto aktivieren" : "Not-Aus: Konto pausieren"}
          </button>
        ))}
      {err && <span style={{ color: "#b91c1c" }}>{err}</span>}
    </div>
  );
}

/* ── Zielgruppe ergänzen / entfernen (Browser-Hashing wie beim Upload) ────── */
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const normEmail = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
const normPhone = (s: string) => {
  const d = s.replace(/[^\d+]/g, "");
  if (d.startsWith("+")) return d;
  if (d.startsWith("00")) return `+${d.slice(2)}`;
  if (d.startsWith("0") && d.length >= 9) return `+41${d.slice(1)}`;
  return d ? `+${d}` : "";
};
export function AudienceModifyForm({
  clientId,
  S,
  audienceId,
  identifierType,
  onDone,
  onCancel,
}: {
  clientId: string;
  S: Tokens;
  audienceId: string;
  identifierType: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [op, setOp] = useState<"add" | "remove">("add");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const isPhone = identifierType.startsWith("phone");
  const ids = useMemo(() => {
    const out = new Set<string>();
    for (const line of text.split(/[\n,;]+/)) {
      const c = line.replace(/^"|"$/g, "").trim();
      if (!c) continue;
      if (isPhone) {
        const p = normPhone(c);
        if (/^\+\d{7,15}$/.test(p)) out.add(p);
      } else {
        const e = normEmail(c);
        if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) out.add(e);
      }
    }
    return Array.from(out);
  }, [text, isPhone]);
  const submit = async () => {
    setBusy(true);
    setMsg("");
    const hashes = await Promise.all(ids.map(sha256Hex));
    const j = await adsPost({
      action: "audience-modify",
      clientId,
      audienceId,
      op,
      identifierType,
      hashes,
    });
    setBusy(false);
    if (!j.ok) {
      setMsg(j.error || "Fehler");
      return;
    }
    setMsg(
      `${hashes.length} ${op === "add" ? "hinzugefügt" : "entfernt"} — OpenAI verarbeitet die Änderung.`,
    );
    setText("");
    onDone();
  };
  return (
    <div
      style={{
        border: `1px solid ${S.line}`,
        borderRadius: 10,
        padding: 12,
        fontSize: 12.5,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
        {(["add", "remove"] as const).map((k) => (
          <label
            key={k}
            style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}
          >
            <input type="radio" checked={op === k} onChange={() => setOp(k)} />{" "}
            {k === "add" ? "Ergänzen" : "Entfernen"}
          </label>
        ))}
        <span style={{ color: S.mut }}>
          {isPhone ? "Telefonnummern" : "E-Mail-Adressen"} — werden im Browser gehasht
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder={isPhone ? "eine Nummer pro Zeile" : "eine Adresse pro Zeile"}
        style={{ ...inputStyle(S), fontFamily: "ui-monospace, monospace", resize: "vertical" }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ color: S.mut }}>{ids.length} gültig</span>
        <button
          onClick={submit}
          disabled={busy || ids.length === 0}
          style={btnStyle(S, true, busy || ids.length === 0)}
        >
          {busy ? "Sende…" : op === "add" ? "Hinzufügen" : "Entfernen"}
        </button>
        <button onClick={onCancel} style={btnStyle(S, false)}>
          Schliessen
        </button>
        {msg && <span style={{ color: msg.includes("—") ? "#0f9d6c" : "#b91c1c" }}>{msg}</span>}
      </div>
    </div>
  );
}

/* ── Konto-Auswahl beim Verbinden (ein Key, mehrere Konten) ───────────────── */
export function AccountChooser({
  S,
  accounts,
  busy,
  onPick,
}: {
  S: Tokens;
  accounts: Array<{
    id: string;
    name: string;
    currency: string;
    status: string | null;
    review: string | null;
  }>;
  busy: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <div style={{ marginTop: 12, fontSize: 12.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: inkOf(S) }}>
        Dieser Key hat Zugriff auf mehrere Werbekonten — welches gehört zu diesem Kunden?
      </div>
      {accounts.map((a) => (
        <div
          key={a.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "6px 0",
            borderTop: `1px solid ${S.line}22`,
          }}
        >
          <div style={{ flex: 1 }}>
            <span style={{ fontWeight: 700, color: inkOf(S) }}>{a.name}</span>
            <span style={{ color: S.mut, marginLeft: 8, fontSize: 11 }}>
              {a.id} · {a.currency}
              {a.review ? ` · ${REVIEW_LABEL[a.review]?.[0] || a.review}` : ""}
            </span>
          </div>
          <button onClick={() => onPick(a.id)} disabled={busy} style={btnStyle(S, true, busy)}>
            Verbinden
          </button>
        </div>
      ))}
    </div>
  );
}

/* ── Kampagnen-Editoren (15.09. aus EzyAiCampaignsPanel hierher gezogen, damit
   der Ads-Manager-Nachbau sie ohne Zirkel-Import nutzen kann) ─────────────── */
export type AudienceLite = {
  openai_audience_id: string;
  name: string;
  status: string;
  matched_user_count_range?: string | null;
};
// Lokale Kopien der Label-Maps (im Panel gibt es dieselben; bewusst nicht
// exportiert — react-refresh will in Komponenten-Dateien nur Komponenten).
const AUDIENCE_STATUS: Record<string, [string, string]> = {
  ready: ["bereit", "#0f9d6c"],
  processing: ["wird verarbeitet", "#d97706"],
  upload_pending: ["Upload läuft", "#d97706"],
  publishing: ["wird veröffentlicht", "#d97706"],
  too_small: ["zu klein", "#dc2626"],
  failed: ["fehlgeschlagen", "#dc2626"],
  archived: ["archiviert", "#8b8da3"],
};
const RANGE_LABEL: Record<string, string> = {
  under_25k: "< 25'000",
  "25k_100k": "25'000 – 100'000",
  "100k_500k": "100'000 – 500'000",
  "500k_1m": "500'000 – 1 Mio.",
  "1m_5m": "1 – 5 Mio.",
  "5m_plus": "> 5 Mio.",
  none: "keine Treffer",
};

/* ── Geo-Targeting-Editor: Einschluss + Ausschluss (GeoChips, 13.09.) ─────── */
export function TargetingEditor({
  clientId,
  S,
  initial,
  initialExcluded,
  busy,
  onSave,
  onCancel,
}: {
  clientId: string;
  S: Tokens;
  initial: GeoLocation[];
  initialExcluded: GeoLocation[];
  busy: boolean;
  onSave: (locations: GeoLocation[], excludedLocations: GeoLocation[]) => void;
  onCancel: () => void;
}) {
  const [locs, setLocs] = useState<GeoLocation[]>(initial);
  const [excl, setExcl] = useState<GeoLocation[]>(initialExcluded);
  const btn = (primary: boolean): React.CSSProperties => ({
    border: primary ? "none" : `1px solid ${S.line}`,
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    background: primary ? accentOf(S) : "transparent",
    color: primary ? "#fff" : S.mut,
  });
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: inkOf(S) }}>
        Geo-Targeting{" "}
        <span style={{ fontWeight: 400, color: S.mut }}>
          — leer = weltweit; Länder, Regionen/Kantone oder Metro-Gebiete (DMA)
        </span>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: S.mut, marginBottom: 4 }}>Einschliessen:</div>
        <GeoChips
          clientId={clientId}
          S={S}
          value={locs}
          onChange={(v) => {
            setLocs(v);
            setExcl(excl.filter((e) => !v.some((x) => x.id === e.id)));
          }}
          placeholder="Land, Kanton oder Region suchen … (z.B. Schweiz, Zürich)"
          emptyLabel="Keine Einschränkung (weltweit)"
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ color: S.mut, marginBottom: 4 }}>
          Ausschliessen (optional, z.B. Regionen ohne Lieferung):
        </div>
        <GeoChips
          clientId={clientId}
          S={S}
          value={excl}
          onChange={(v) => setExcl(v.filter((e) => !locs.some((x) => x.id === e.id)))}
          placeholder="Region ausschliessen …"
          emptyLabel="keine Ausschlüsse"
        />
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => onSave(locs, excl)} disabled={busy} style={btn(true)}>
          {busy ? "Speichere…" : "Targeting speichern"}
        </button>
        <button onClick={onCancel} style={btn(false)}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}

/* ── Zielgruppen-Zuweisung je Kampagne (include / exclude) ─────────────────── */
export function AudiencesEditor({
  S,
  audiences,
  initialInclude,
  initialExclude,
  busy,
  onSave,
  onCancel,
}: {
  S: Tokens;
  audiences: AudienceLite[];
  initialInclude: string[];
  initialExclude: string[];
  busy: boolean;
  onSave: (includeIds: string[], excludeIds: string[]) => void;
  onCancel: () => void;
}) {
  const [incl, setIncl] = useState<Set<string>>(new Set(initialInclude));
  const [excl, setExcl] = useState<Set<string>>(new Set(initialExclude));
  const usable = audiences.filter((a) => a.status !== "archived");
  const toggle = (
    set: Set<string>,
    setter: (s: Set<string>) => void,
    other: Set<string>,
    otherSetter: (s: Set<string>) => void,
    id: string,
  ) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id);
    else {
      n.add(id);
      // Dieselbe Audience nie gleichzeitig ein- und ausschliessen (API-Regel).
      if (other.has(id)) {
        const o = new Set(other);
        o.delete(id);
        otherSetter(o);
      }
    }
    setter(n);
  };
  const btn = (primary: boolean): React.CSSProperties => ({
    border: primary ? "none" : `1px solid ${S.line}`,
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    background: primary ? accentOf(S) : "transparent",
    color: primary ? "#fff" : S.mut,
  });
  if (usable.length === 0)
    return (
      <div style={{ fontSize: 12.5, color: S.mut }}>
        Noch keine Zielgruppen vorhanden — im Bereich «Zielgruppen» eine Kundenliste hochladen.{" "}
        <button onClick={onCancel} style={btn(false)}>
          Schliessen
        </button>
      </div>
    );
  return (
    <div style={{ fontSize: 12.5 }}>
      <div style={{ fontWeight: 700, marginBottom: 6, color: inkOf(S) }}>
        Zielgruppen{" "}
        <span style={{ fontWeight: 400, color: S.mut }}>
          — Einschluss braucht ≥ 25'000 erreichbare Nutzer; Ausschluss (z.B. Bestandskunden) hat
          kein Minimum und Vorrang
        </span>
      </div>
      <table style={{ borderCollapse: "collapse", marginBottom: 10 }}>
        <thead>
          <tr style={{ color: S.mut, textAlign: "left", fontSize: 11.5 }}>
            <th style={{ padding: "4px 10px 4px 0" }}>Zielgruppe</th>
            <th style={{ padding: "4px 10px" }}>Grösse</th>
            <th style={{ padding: "4px 10px", textAlign: "center" }}>Einschliessen</th>
            <th style={{ padding: "4px 10px", textAlign: "center" }}>Ausschliessen</th>
          </tr>
        </thead>
        <tbody>
          {usable.map((a) => {
            const ready = a.status === "ready";
            return (
              <tr key={a.openai_audience_id} style={{ opacity: ready ? 1 : 0.6 }}>
                <td style={{ padding: "4px 10px 4px 0", color: inkOf(S), fontWeight: 600 }}>
                  {a.name}
                  {!ready && (
                    <span style={{ color: S.mut, fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
                      ({AUDIENCE_STATUS[a.status]?.[0] || a.status})
                    </span>
                  )}
                </td>
                <td style={{ padding: "4px 10px", color: S.mut }}>
                  {RANGE_LABEL[a.matched_user_count_range || ""] || "–"}
                </td>
                <td style={{ padding: "4px 10px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={incl.has(a.openai_audience_id)}
                    onChange={() => toggle(incl, setIncl, excl, setExcl, a.openai_audience_id)}
                  />
                </td>
                <td style={{ padding: "4px 10px", textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={excl.has(a.openai_audience_id)}
                    onChange={() => toggle(excl, setExcl, incl, setIncl, a.openai_audience_id)}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => onSave(Array.from(incl), Array.from(excl))}
          disabled={busy}
          style={btn(true)}
        >
          {busy ? "Speichere…" : "Zuweisung speichern"}
        </button>
        <button onClick={onCancel} style={btn(false)}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
