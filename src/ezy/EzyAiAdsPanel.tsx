// EzyAI — Ads-Modus (ChatGPT Ads, 26.08.2026): Conversion-Tracking über die
// OpenAI Conversions API. Eigene Datei (Bundle-Split-Muster wie LocalGrid) —
// der Organic/Ads-Schalter sitzt in der AppRail (railExtra, unter der
// Trennlinie), dieser Panel rendert die drei Ads-Bereiche.
// WICHTIG (Konzept): OpenAI bietet KEINE Reporting-API — Impressions/Clicks/
// Spend gibt es nur im OpenAI Ads Manager; hier zählen wir die EIGENEN
// Conversion-Events (Tabelle openai_ads_events).
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  cacheGet,
  cachePut,
  RANGE_TTL_MS,
  isoDay,
  type ResolvedRange,
} from "@/ezy/data/rangeStore";

type Tokens = Record<string, string>;

type AdsEvent = {
  id: string;
  event_id: string;
  event_type: string;
  oppref: string | null;
  obref: string | null;
  amount_cents: number | null;
  currency: string | null;
  source_url: string | null;
  action_source: string;
  openai_status: string;
  retry_count: number;
  created_at: string;
  sent_at: string | null;
};

type AdsData = {
  ok: boolean;
  error?: string;
  configured?: boolean;
  enabled?: boolean;
  pixelId?: string | null;
  totals?: {
    events: number;
    sent: number;
    failed: number;
    withOppref: number;
    leads: number;
    orders: number;
    revenueCents: number;
    currency: string;
  };
  byDay?: Record<string, number>;
  events?: AdsEvent[];
};

const fmtMoney = (cents: number, currency: string) =>
  `${currency} ${(cents / 100).toLocaleString("de-CH", { minimumFractionDigits: 2 })}`;
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const STATUS_LABEL: Record<string, [string, string]> = {
  sent: ["zugestellt", "#0f9d6c"],
  failed: ["fehlgeschlagen", "#dc2626"],
  pending: ["ausstehend", "#d97706"],
};

function StatusPill({ status }: { status: string }) {
  const [label, color] = STATUS_LABEL[status] || [status, "#8b8da3"];
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

export default function EzyAiAdsPanel({
  clientId,
  clientName,
  section,
  range,
  S,
  isOrgAdmin,
}: {
  clientId: string;
  clientName: string;
  section: string;
  range: ResolvedRange;
  S: Tokens;
  isOrgAdmin: boolean;
}) {
  const [data, setData] = useState<AdsData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const startKey = isoDay(range.start);
  const endKey = isoDay(range.end);

  useEffect(() => {
    let alive = true;
    const cacheKey = `openai-ads:${clientId}:${startKey}:${endKey}`;
    const cached = reloadKey === 0 ? cacheGet(cacheKey) : null;
    // Cache liefert unknown — an dieser Stelle ist es immer die AdsData-Antwort
    // der openai-ads-Route (tsc-Fix 26.08., EzyRank-Session).
    setData(cached ? (cached.data as AdsData) : null);
    if (cached && Date.now() - cached.at < RANGE_TTL_MS) return;
    (async () => {
      try {
        const session = (await supabase.auth.getSession()).data.session;
        const r = await fetch(
          `/api/admin/openai-ads?client=${encodeURIComponent(clientId)}&start=${startKey}&end=${endKey}`,
          { headers: { Authorization: `Bearer ${session?.access_token || ""}` } },
        );
        const j = await r.json().catch(() => ({}));
        if (j.ok) cachePut(cacheKey, j);
        if (alive && (j.ok || !cached))
          setData(j.ok ? j : { ok: false, error: j.error || `HTTP ${r.status}` });
      } catch (e: any) {
        if (alive && !cached) setData({ ok: false, error: String(e?.message || e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [clientId, startKey, endKey, reloadKey]);

  const refresh = useCallback(() => setReloadKey((k) => k + 1), []);

  const card: React.CSSProperties = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };

  if (data === null)
    return (
      <div style={{ color: S.mut, fontSize: 13, padding: 60, textAlign: "center" }}>
        Lade ChatGPT-Ads-Daten…
      </div>
    );
  if (!data.ok)
    return (
      <div style={{ ...card, maxWidth: 560, margin: "40px auto 0", textAlign: "center" }}>
        <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>Daten nicht ladbar</div>
        <div style={{ fontSize: 12.5, color: S.mut }}>{data.error}</div>
      </div>
    );

  // Noch nicht konfiguriert: Setup-Karte (Formular nur für Owner/Admin).
  if (!data.configured)
    return (
      <ConfigCard
        clientId={clientId}
        clientName={clientName}
        S={S}
        isOrgAdmin={isOrgAdmin}
        initial={null}
        onSaved={refresh}
        intro
      />
    );

  const t = data.totals!;
  const events = data.events || [];

  if (section === "ads-conversions")
    return (
      <div style={card}>
        <SectionTitle
          S={S}
          title="Conversions"
          sub="Leads und Käufe, die an OpenAI gemeldet wurden"
        />
        {events.length === 0 ? (
          <Empty S={S} />
        ) : (
          <EventsTable S={S} events={events} mode="conversions" />
        )}
      </div>
    );

  if (section === "ads-events")
    return (
      <div style={card}>
        <SectionTitle
          S={S}
          title="Event-Log"
          sub="jede Einlieferung inkl. Zustell-Status an die Conversions API"
        />
        {events.length === 0 ? (
          <Empty S={S} />
        ) : (
          <EventsTable
            S={S}
            events={events}
            mode="log"
            clientId={clientId}
            canRetry={isOrgAdmin}
            onRetried={refresh}
          />
        )}
      </div>
    );

  // Übersicht (Default)
  const dayKeys = Object.keys(data.byDay || {}).sort();
  const maxDay = Math.max(1, ...dayKeys.map((k) => data.byDay![k]));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {!data.enabled && (
        <div
          style={{
            ...card,
            borderColor: "#d9770655",
            background: "rgba(217,119,6,.06)",
            fontSize: 12.5,
            color: "#92400e",
          }}
        >
          ChatGPT Ads ist für diesen Kunden konfiguriert, aber pausiert — neue Conversions werden
          nicht an OpenAI gesendet.
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
          gap: 12,
        }}
      >
        {(
          [
            ["Conversions", String(t.events), "im gewählten Zeitraum"],
            ["Leads", String(t.leads), "lead / signup / contact"],
            [
              "Käufe",
              String(t.orders),
              t.revenueCents > 0 ? fmtMoney(t.revenueCents, t.currency) : "kein Umsatz erfasst",
            ],
            [
              "Ad-Attribution",
              t.events ? `${Math.round((t.withOppref / t.events) * 100)} %` : "—",
              "Events mit oppref (Klick auf Anzeige)",
            ],
            [
              "Zustellung",
              t.events ? `${t.sent}/${t.events}` : "—",
              t.failed > 0 ? `${t.failed} fehlgeschlagen` : "alle bei OpenAI angekommen",
            ],
          ] as Array<[string, string, string]>
        ).map(([title, val, sub]) => (
          <div key={title} style={card}>
            <div
              style={{
                fontSize: 11,
                color: S.mut,
                textTransform: "uppercase",
                letterSpacing: ".05em",
              }}
            >
              {title}
            </div>
            <div
              style={{
                fontSize: 26,
                fontWeight: 800,
                color: S.txt,
                marginTop: 4,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {val}
            </div>
            <div style={{ fontSize: 11, color: S.mut, marginTop: 2 }}>{sub}</div>
          </div>
        ))}
      </div>

      <div style={card}>
        <SectionTitle S={S} title="Conversions pro Tag" sub={`${startKey} – ${endKey}`} />
        {dayKeys.length === 0 ? (
          <Empty S={S} />
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "flex-end",
              gap: 3,
              height: 120,
              overflowX: "auto",
              paddingTop: 6,
            }}
          >
            {dayKeys.map((k) => (
              <div
                key={k}
                title={`${k}: ${data.byDay![k]} Conversions`}
                style={{
                  flex: "1 0 10px",
                  maxWidth: 34,
                  height: `${Math.max(6, (data.byDay![k] / maxDay) * 100)}%`,
                  background: S.app,
                  borderRadius: "3px 3px 0 0",
                  opacity: 0.85,
                }}
              />
            ))}
          </div>
        )}
      </div>

      <div style={{ ...card, fontSize: 12.5, color: S.mut, lineHeight: 1.55 }}>
        <b style={{ color: S.txt }}>Hinweis zu Kampagnen-Zahlen:</b> OpenAI bietet aktuell keine
        Reporting-API — Impressions, Klicks, Spend und CPC stehen nur im OpenAI Ads Manager. Hier
        siehst du die eigenen Conversion-Events (Pixel-ID {data.pixelId}); die Attribution im Ads
        Manager kann 24–48 Stunden nachlaufen.
      </div>

      <ConfigCard
        clientId={clientId}
        clientName={clientName}
        S={S}
        isOrgAdmin={isOrgAdmin}
        initial={{ pixelId: data.pixelId || "", enabled: !!data.enabled }}
        onSaved={refresh}
      />
    </div>
  );
}

function SectionTitle({ S, title, sub }: { S: Tokens; title: string; sub?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
      <div style={{ fontWeight: 700, fontSize: 13.5, color: S.txt }}>{title}</div>
      {sub && <span style={{ fontSize: 11, color: S.mut }}>{sub}</span>}
    </div>
  );
}

function Empty({ S }: { S: Tokens }) {
  return (
    <div style={{ fontSize: 12.5, color: S.mut, padding: 12 }}>
      Im gewählten Zeitraum wurden keine Conversions eingeliefert. Conversions kommen über den
      Ingest-Endpoint (<code>/api/admin/openai-ads-ingest</code>) von der Kunden-Website bzw. dem
      CRM — wichtig: den <code>?oppref=…</code>-Parameter beim Anzeigen-Klick erfassen und bis zur
      Conversion mitführen.
    </div>
  );
}

function EventsTable({
  S,
  events,
  mode,
  clientId,
  canRetry = false,
  onRetried,
}: {
  S: Tokens;
  events: AdsEvent[];
  mode: "conversions" | "log";
  clientId?: string;
  canRetry?: boolean;
  onRetried?: () => void;
}) {
  const [busy, setBusy] = useState<string>("");
  const retry = async (ev: AdsEvent) => {
    setBusy(ev.id);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/admin/openai-ads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "retry", clientId, eventId: ev.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!j.ok) alert(j.error || "Retry fehlgeschlagen");
      onRetried?.();
    } finally {
      setBusy("");
    }
  };
  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: 10.5,
    textTransform: "uppercase",
    letterSpacing: ".05em",
    color: S.mut,
    padding: "6px 10px 6px 0",
    borderBottom: `1px solid ${S.line}`,
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    fontSize: 12,
    color: S.txt,
    padding: "7px 10px 7px 0",
    borderBottom: `1px solid ${S.line}`,
    verticalAlign: "top",
  };
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
        <thead>
          <tr>
            <th style={th}>Zeit</th>
            <th style={th}>Typ</th>
            {mode === "conversions" && <th style={th}>Betrag</th>}
            <th style={th}>Quelle</th>
            <th style={th}>Ad-Klick</th>
            <th style={th}>Status</th>
            {mode === "log" && <th style={th} />}
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <tr key={ev.id}>
              <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                {fmtTime(ev.created_at)}
              </td>
              <td style={td}>
                {ev.event_type}
                {mode === "log" && (
                  <span style={{ display: "block", fontSize: 10, color: S.mut }}>
                    {ev.event_id}
                  </span>
                )}
              </td>
              {mode === "conversions" && (
                <td style={{ ...td, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>
                  {ev.amount_cents != null && ev.currency
                    ? fmtMoney(ev.amount_cents, ev.currency)
                    : "—"}
                </td>
              )}
              <td
                style={{
                  ...td,
                  maxWidth: 260,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={ev.source_url || ""}
              >
                {ev.source_url || "—"}
              </td>
              <td style={td}>
                {ev.oppref ? (
                  <span style={{ color: "#0f9d6c", fontWeight: 700, fontSize: 11.5 }}>
                    ✓ oppref
                  </span>
                ) : (
                  <span style={{ color: S.mut, fontSize: 11.5 }}>—</span>
                )}
              </td>
              <td style={td}>
                <StatusPill status={ev.openai_status} />
                {ev.retry_count > 0 && (
                  <span style={{ fontSize: 10, color: S.mut, marginLeft: 6 }}>
                    {ev.retry_count}× Retry
                  </span>
                )}
              </td>
              {mode === "log" && (
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  {canRetry && ev.openai_status === "failed" && (
                    <button
                      onClick={() => retry(ev)}
                      disabled={busy === ev.id}
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: S.app,
                        background: "none",
                        border: `1px solid ${S.app}55`,
                        borderRadius: 8,
                        padding: "4px 10px",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      {busy === ev.id ? "Sende…" : "Erneut senden"}
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Konfiguration (Pixel-ID + Conversions-API-Key aus dem OpenAI Ads Manager,
// Bereich „Conversions"). Der Key wird serverseitig verschluesselt gespeichert
// und NIE wieder angezeigt — leeres Key-Feld beim Speichern = Key behalten.
function ConfigCard({
  clientId,
  clientName,
  S,
  isOrgAdmin,
  initial,
  onSaved,
  intro = false,
}: {
  clientId: string;
  clientName: string;
  S: Tokens;
  isOrgAdmin: boolean;
  initial: { pixelId: string; enabled: boolean } | null;
  onSaved: () => void;
  intro?: boolean;
}) {
  const [pixelId, setPixelId] = useState(initial?.pixelId || "");
  const [apiKey, setApiKey] = useState("");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const post = async (body: Record<string, unknown>) => {
    const session = (await supabase.auth.getSession()).data.session;
    const r = await fetch("/api/admin/openai-ads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session?.access_token || ""}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ clientId, ...body }),
    });
    return r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  };

  const save = async () => {
    setBusy(true);
    setMsg("");
    const j = await post({ action: "config", pixelId, apiKey, enabled });
    setBusy(false);
    if (j.ok) {
      setMsg("Gespeichert.");
      setApiKey("");
      onSaved();
    } else setMsg(j.error || "Speichern fehlgeschlagen");
  };
  const test = async () => {
    setBusy(true);
    setMsg("");
    const j = await post({ action: "test" });
    setBusy(false);
    setMsg(
      j.ok
        ? "Verbindung ok — OpenAI hat das Testevent validiert (validate_only)."
        : `Test fehlgeschlagen (HTTP ${j.status || "?"}): ${JSON.stringify(j.response || j.error).slice(0, 200)}`,
    );
  };

  const card: React.CSSProperties = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
    padding: 18,
  };
  const inp: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    background: S.bg,
    color: S.txt,
    border: `1px solid ${S.line}`,
    fontSize: 12.5,
    fontFamily: "inherit",
    boxSizing: "border-box",
  };

  return (
    <div style={intro ? { ...card, maxWidth: 620, margin: "24px auto 0" } : card}>
      {intro && (
        <>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
            ChatGPT Ads für {clientName} einrichten
          </div>
          <div style={{ fontSize: 12.5, color: S.mut, lineHeight: 1.55, marginBottom: 14 }}>
            Pixel-ID und Conversions-API-Key findest du im OpenAI Ads Manager unter „Conversions".
            Danach Conversions serverseitig an{" "}
            <code style={{ fontSize: 11.5 }}>/api/admin/openai-ads-ingest</code> einliefern —
            wichtig: den <code style={{ fontSize: 11.5 }}>?oppref=…</code>-Parameter vom
            Anzeigen-Klick bis zur Conversion mitführen, sonst kann OpenAI nicht attribuieren.
          </div>
        </>
      )}
      {!intro && <SectionTitle S={S} title="Konfiguration" sub={`Kunde: ${clientName}`} />}
      {!isOrgAdmin ? (
        <div style={{ fontSize: 12.5, color: S.mut }}>
          {intro
            ? "ChatGPT Ads ist für diesen Kunden noch nicht eingerichtet — die Konfiguration (Pixel-ID + API-Key) kann nur ein Admin vornehmen."
            : "Änderungen an der Konfiguration kann nur ein Admin vornehmen."}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 460 }}>
          <label style={{ fontSize: 11.5, color: S.mut }}>
            Pixel-ID
            <input
              value={pixelId}
              onChange={(e) => setPixelId(e.target.value)}
              placeholder="pid aus dem Ads Manager"
              style={{ ...inp, marginTop: 4 }}
            />
          </label>
          <label style={{ fontSize: 11.5, color: S.mut }}>
            Conversions-API-Key {initial ? "(leer lassen = bestehenden behalten)" : ""}
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              type="password"
              autoComplete="off"
              placeholder={initial ? "••••••••" : "API-Key aus dem Ads Manager"}
              style={{ ...inp, marginTop: 4 }}
            />
          </label>
          <label
            style={{
              fontSize: 12.5,
              color: S.txt,
              display: "flex",
              alignItems: "center",
              gap: 8,
            }}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Aktiv — Conversions an OpenAI weiterleiten
          </label>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              onClick={save}
              disabled={busy || !pixelId}
              style={{
                padding: "8px 16px",
                borderRadius: 9,
                border: "none",
                background: S.app,
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                opacity: busy || !pixelId ? 0.6 : 1,
              }}
            >
              {busy ? "Speichere…" : "Speichern"}
            </button>
            {initial && (
              <button
                onClick={test}
                disabled={busy}
                style={{
                  padding: "8px 16px",
                  borderRadius: 9,
                  border: `1px solid ${S.app}55`,
                  background: "none",
                  color: S.app,
                  fontSize: 12.5,
                  fontWeight: 700,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                Verbindung testen
              </button>
            )}
          </div>
          {msg && (
            <div
              style={{
                fontSize: 12,
                color: /ok|Gespeichert/i.test(msg) ? "#0f9d6c" : "#dc2626",
              }}
            >
              {msg}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
