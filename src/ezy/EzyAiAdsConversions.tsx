// EzyAI Ads — Bereich «Conversions» im Aufbau des OpenAI Ads Managers
// (Volkan 12.10.2026, Vorlage ads.openai.com/settings/conversions):
// Kennzahlen-Leiste (Ereignisse · Nutzung des Conversion-Ziels · Warnungen)
// und Tabs Datenquelle / Conversion-Ereignisse / Ereignisstream / Diagnose.
//
// Datenlage: Event-Settings, Pixel und Kampagnen kommen live aus der
// Advertiser API (action conv-setup-get). Die Ereignis-Zaehlung je Event des
// Ads Managers stammt aus internen /v1/ui-Endpunkten, die OpenAI fuer
// API-Keys sperrt («API keys cannot access Ads Manager UI endpoints») —
// hier zaehlen daher die ueber EzyHub (Server/CAPI) gesendeten Ereignisse;
// Pixel-Ereignisse zeigt der Ereignisstream (Live-Stichprobe von OpenAI).
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";

type Tokens = Record<string, string>;

export type HubEvent = {
  id: string;
  event_type: string;
  oppref: string | null;
  openai_status: string;
  created_at: string;
};

type Pixel = { id: string; name: string; pixel_id: string; client_type?: string };
type EventSetting = {
  id: string;
  name: string;
  event_type: string;
  custom_event_name: string | null;
  attribution_window_days: number;
  view_through_days?: number;
  source_ids: string[];
  sources?: Array<{ id: string; name: string }>;
  archived: boolean;
};
type Campaign = {
  id: string;
  name: string;
  status: string;
  objective?: string | null;
  eventSettingIds: string[];
};
type Setup = {
  pixels: Pixel[];
  eventSettings: EventSetting[];
  campaigns: Campaign[];
  configuredPixelId: string | null;
  hasCapiKey: boolean;
  adAccountId?: string | null;
  isMock?: boolean;
};
type StreamEvent = {
  event_type: string | null;
  custom_event_name: string | null;
  api_channel: string | null;
  event_timestamp_ms: number | null;
  received_at_ms: number | null;
  action_source: string | null;
};

type Tab = "quelle" | "ereignisse" | "stream" | "diagnose";
const TABS: Array<[Tab, string]> = [
  ["quelle", "Datenquelle"],
  ["ereignisse", "Conversion-Ereignisse"],
  ["stream", "Ereignisstream"],
  ["diagnose", "Diagnose"],
];

const nf = (n: number) => n.toLocaleString("de-CH");
const zeit = (ms: number | null) =>
  ms
    ? new Date(ms).toLocaleString("de-CH", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : "—";

async function adsPost(clientId: string, body: Record<string, unknown>) {
  const session = (await supabase.auth.getSession()).data.session;
  const r = await authedFetch("/api/admin/chatgpt-ads", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session?.access_token || ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ clientId, ...body }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, ...j };
}

export default function EzyAiAdsConversions({
  clientId,
  S,
  hubEvents,
  pixelIdHub,
  rangeLabel,
  snippet,
  readiness,
  hubLog,
}: {
  clientId: string;
  S: Tokens;
  hubEvents: HubEvent[];
  pixelIdHub: string | null;
  rangeLabel: string;
  snippet?: ReactNode;
  readiness?: ReactNode;
  hubLog?: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("ereignisse");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [setupErr, setSetupErr] = useState("");
  const [stream, setStream] = useState<StreamEvent[] | null>(null);
  const [streamErr, setStreamErr] = useState("");
  const [streamBusy, setStreamBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    setSetup(null);
    setSetupErr("");
    adsPost(clientId, { action: "conv-setup-get" }).then((j) => {
      if (!alive) return;
      if (j.ok) setSetup(j as Setup);
      else setSetupErr(j.error || `HTTP ${j.status}`);
    });
    return () => {
      alive = false;
    };
  }, [clientId]);

  const ladeStream = useCallback(async () => {
    setStreamBusy(true);
    setStreamErr("");
    const j = await adsPost(clientId, { action: "conv-sample" });
    setStreamBusy(false);
    if (j.ok) setStream(j.events || []);
    else {
      setStream([]);
      setStreamErr(j.error || `HTTP ${j.status}`);
    }
  }, [clientId]);
  useEffect(() => {
    setStream(null);
  }, [clientId]);
  useEffect(() => {
    if (tab === "stream" && stream === null && !streamBusy) void ladeStream();
  }, [tab, stream, streamBusy, ladeStream]);

  // ── Kennzahlen ────────────────────────────────────────────────────────────
  const events = useMemo(() => (setup?.eventSettings || []).filter((e) => !e.archived), [setup]);
  const aktive = (setup?.campaigns || []).filter((c) => c.status === "active");
  const aufConv = aktive.filter((c) => c.objective === "conversions");
  const nutzung = aktive.length ? Math.round((aufConv.length / aktive.length) * 100) : null;

  const hubJeTyp = useMemo(() => {
    const m = new Map<string, { n: number; mitKlick: number }>();
    for (const e of hubEvents) {
      const x = m.get(e.event_type) || { n: 0, mitKlick: 0 };
      x.n += 1;
      if (e.oppref) x.mitKlick += 1;
      m.set(e.event_type, x);
    }
    return m;
  }, [hubEvents]);

  const warnungen = useMemo(() => {
    const w: Array<{ titel: string; text: string }> = [];
    if (!setup) return w;
    const fehl = hubEvents.filter((e) => e.openai_status === "failed").length;
    if (fehl)
      w.push({
        titel: `${fehl} Ereignis${fehl === 1 ? "" : "se"} nicht zugestellt`,
        text: "Über EzyHub gesendete Ereignisse wurden von OpenAI abgelehnt — im Event-Log erneut senden.",
      });
    if (!setup.configuredPixelId)
      w.push({
        titel: "Keine Pixel-ID im Hub hinterlegt",
        text: "Unter Einstellungen das Pixel übernehmen, sonst kann EzyHub keine Server-Ereignisse senden.",
      });
    else if (!setup.pixels.some((p) => p.pixel_id === setup.configuredPixelId))
      w.push({
        titel: "Hinterlegte Pixel-ID nicht im Konto",
        text: `Die Pixel-ID ${setup.configuredPixelId} gehört zu keinem Pixel dieses Ads-Kontos.`,
      });
    if (!setup.hasCapiKey)
      w.push({
        titel: "Kein Conversions-API-Schlüssel",
        text: "Ohne Server-Schlüssel kommen nur Browser-Ereignisse (Pixel) an — Werbeblocker und Consent kosten Daten.",
      });
    for (const c of aufConv)
      if (!c.eventSettingIds.length)
        w.push({
          titel: `«${c.name}» ohne Conversion-Ereignis`,
          text: "Die Kampagne ist auf Conversions optimiert, hat aber kein Conversion-Ereignis zugewiesen.",
        });
    if (!events.length)
      w.push({
        titel: "Keine Conversion-Ereignisse",
        text: "Im Ads-Konto ist noch kein Conversion-Ereignis angelegt.",
      });
    return w;
  }, [setup, hubEvents, aufConv, events.length]);

  const verwendetVon = (e: EventSetting) =>
    (setup?.campaigns || []).filter((c) => c.eventSettingIds.includes(e.id));
  const pixelName = (e: EventSetting) => {
    if (e.sources?.length) return e.sources.map((s) => s.name).join(", ");
    const ns = (setup?.pixels || []).filter((p) => e.source_ids.includes(p.id)).map((p) => p.name);
    return ns.length ? ns.join(", ") : "—";
  };

  // ── Stil ──────────────────────────────────────────────────────────────────
  const rahmen: React.CSSProperties = {
    background: S.panel,
    border: `1px solid ${S.line}`,
    borderRadius: 14,
  };
  const th: React.CSSProperties = {
    textAlign: "left",
    fontSize: 12,
    fontWeight: 500,
    color: S.mut,
    padding: "12px 16px",
    borderBottom: `1px solid ${S.line}`,
    whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = {
    fontSize: 13,
    color: S.txt,
    padding: "16px",
    borderBottom: `1px solid ${S.line}`,
    verticalAlign: "middle",
  };
  const leer = (text: string) => (
    <div style={{ fontSize: 12.5, color: S.mut, padding: "28px 16px", textAlign: "center" }}>
      {text}
    </div>
  );
  const managerUrl = setup?.adAccountId
    ? `https://ads.openai.com/settings/conversions?act=${encodeURIComponent(setup.adAccountId)}&tab=conversion-events`
    : null;
  const hubTotal = hubEvents.length;

  const kachel = (titel: string, wert: ReactNode, sub: ReactNode, letzte = false) => (
    <div
      style={{
        flex: "1 1 200px",
        padding: "18px 22px",
        borderRight: letzte ? "none" : `1px solid ${S.line}`,
        minWidth: 0,
      }}
    >
      <div style={{ fontSize: 12.5, color: S.mut, marginBottom: 6 }}>{titel}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color: S.txt, lineHeight: 1.2 }}>{wert}</div>
      <div style={{ fontSize: 12, color: S.mut, marginTop: 10, lineHeight: 1.45 }}>{sub}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ fontSize: 18, fontWeight: 700, color: S.txt }}>Conversions</div>
        {managerUrl && (
          <a
            href={managerUrl}
            target="_blank"
            rel="noreferrer"
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: S.txt,
              border: `1px solid ${S.line}`,
              borderRadius: 999,
              padding: "6px 14px",
              textDecoration: "none",
            }}
          >
            Im Ads Manager öffnen ↗
          </a>
        )}
      </div>

      {/* Kennzahlen-Leiste */}
      <div style={{ ...rahmen, display: "flex", flexWrap: "wrap" }}>
        {kachel(
          "Ereignisse insgesamt",
          nf(hubTotal),
          <>über EzyHub gesendet · {rangeLabel}. Pixel-Ereignisse zählt nur der Ads Manager.</>,
        )}
        {kachel(
          "Nutzung des Conversion-Ziels",
          nutzung === null ? "—" : `${nutzung} %`,
          aktive.length
            ? `${aufConv.length} von ${aktive.length} aktiven Kampagne${aktive.length === 1 ? "" : "n"} auf Conversions optimiert`
            : "keine aktive Kampagne",
        )}
        {kachel(
          "Aktive Warnungen",
          setup ? nf(warnungen.length) : "—",
          warnungen.length ? (
            <button
              onClick={() => setTab("diagnose")}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: S.app,
                fontWeight: 600,
                fontSize: 12,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              Warnungen anzeigen
            </button>
          ) : (
            "keine"
          ),
          true,
        )}
      </div>

      {/* Tabs */}
      <div style={{ ...rahmen, overflow: "hidden" }}>
        <div
          style={{
            display: "flex",
            gap: 22,
            padding: "0 16px",
            borderBottom: `1px solid ${S.line}`,
            overflowX: "auto",
          }}
        >
          {TABS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              style={{
                background: "none",
                border: "none",
                borderBottom: `2px solid ${tab === id ? S.txt : "transparent"}`,
                color: tab === id ? S.txt : S.mut,
                fontWeight: tab === id ? 600 : 500,
                fontSize: 13,
                padding: "13px 0 11px",
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontFamily: "inherit",
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {setupErr && tab !== "stream" && leer(`Conversions nicht ladbar: ${setupErr}`)}
        {!setup && !setupErr && tab !== "stream" && leer("Lade Conversions aus dem Ads-Konto…")}

        {/* Conversion-Ereignisse */}
        {setup && tab === "ereignisse" && (
          <>
            {events.length === 0 ? (
              leer(
                "Im Ads-Konto ist noch kein Conversion-Ereignis angelegt (Bereich Einstellungen).",
              )
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                  <thead>
                    <tr>
                      <th style={th}>Ereignisse</th>
                      <th style={th}>Basisereignis</th>
                      <th style={th}>Pixel</th>
                      <th style={th}>Verwendet von</th>
                      <th style={th}>Attribution</th>
                      <th
                        style={th}
                        title="Über EzyHub (Server) gesendete Ereignisse im gewählten Zeitraum"
                      >
                        Ereignisse (Hub)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((e) => {
                      const kamp = verwendetVon(e);
                      const hub =
                        e.event_type !== "custom" ? hubJeTyp.get(e.event_type) : undefined;
                      return (
                        <tr key={e.id}>
                          <td style={{ ...td, fontWeight: 500 }}>{e.name}</td>
                          <td
                            style={{
                              ...td,
                              color: S.mut,
                              fontFamily: "ui-monospace, monospace",
                              fontSize: 12,
                            }}
                          >
                            {e.custom_event_name || e.event_type}
                          </td>
                          <td
                            style={{
                              ...td,
                              maxWidth: 220,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                            title={pixelName(e)}
                          >
                            {pixelName(e)}
                          </td>
                          <td style={td} title={kamp.map((k) => k.name).join("\n")}>
                            {kamp.length
                              ? `${kamp.length} Kampagne${kamp.length === 1 ? "" : "n"}`
                              : "-"}
                          </td>
                          <td style={{ ...td, color: S.mut, whiteSpace: "nowrap" }}>
                            {e.attribution_window_days} T. Klick
                            {e.view_through_days ? ` · ${e.view_through_days} T. Ansicht` : ""}
                          </td>
                          <td
                            style={{
                              ...td,
                              fontVariantNumeric: "tabular-nums",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {hub ? (
                              <>
                                {nf(hub.n)}
                                <span style={{ color: S.mut, fontSize: 11.5, marginLeft: 8 }}>
                                  {Math.round((hub.mitKlick / hub.n) * 100)} % mit Klick-ID
                                </span>
                              </>
                            ) : (
                              <span
                                style={{ color: S.mut }}
                                title="Dieses Ereignis kommt über das Pixel — die Zählung zeigt nur der Ads Manager"
                              >
                                Pixel
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontSize: 12.5, color: S.mut, padding: "12px 16px" }}>
              {events.length} Conversion-Ereignis{events.length === 1 ? "" : "se"} insgesamt
            </div>
          </>
        )}

        {/* Datenquelle */}
        {setup && tab === "quelle" && (
          <div>
            {setup.pixels.length === 0 ? (
              leer("Kein Pixel im Ads-Konto.")
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={th}>Name</th>
                      <th style={th}>Pixel-ID</th>
                      <th style={th}>Typ</th>
                      <th style={th}>Im Hub hinterlegt</th>
                    </tr>
                  </thead>
                  <tbody>
                    {setup.pixels.map((p) => (
                      <tr key={p.id}>
                        <td style={{ ...td, fontWeight: 500 }}>{p.name || p.id}</td>
                        <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                          {p.pixel_id}
                        </td>
                        <td style={{ ...td, color: S.mut }}>{p.client_type || "Web"}</td>
                        <td style={td}>
                          {p.pixel_id && p.pixel_id === (setup.configuredPixelId || pixelIdHub) ? (
                            <span style={{ color: "#0f9d6c", fontWeight: 700 }}>✓ ja</span>
                          ) : (
                            <span style={{ color: S.mut }}>—</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div style={{ fontSize: 12.5, color: S.mut, padding: "12px 16px" }}>
              Conversions-API (Server):{" "}
              <b style={{ color: setup.hasCapiKey ? "#0f9d6c" : S.txt }}>
                {setup.hasCapiKey ? "Schlüssel hinterlegt" : "kein Schlüssel hinterlegt"}
              </b>
            </div>
            {snippet && <div style={{ padding: "0 16px 16px" }}>{snippet}</div>}
          </div>
        )}

        {/* Ereignisstream */}
        {tab === "stream" && (
          <div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "12px 16px",
                fontSize: 12,
                color: S.mut,
                gap: 12,
              }}
            >
              <span>
                Zuletzt bei OpenAI eingegangene Ereignisse (Pixel und Server, ca. 15 Minuten)
              </span>
              <button
                onClick={() => void ladeStream()}
                disabled={streamBusy}
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: S.txt,
                  background: "none",
                  border: `1px solid ${S.line}`,
                  borderRadius: 999,
                  padding: "5px 12px",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {streamBusy ? "Lade…" : "Aktualisieren"}
              </button>
            </div>
            {streamErr && leer(`Stream nicht ladbar: ${streamErr}`)}
            {stream === null || (streamBusy && !stream.length) ? (
              leer("Lade Ereignisstream…")
            ) : stream.length === 0 ? (
              !streamErr && leer("In den letzten Minuten ist kein Ereignis eingegangen.")
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                  <thead>
                    <tr>
                      <th style={th}>Eingegangen</th>
                      <th style={th}>Ereignis</th>
                      <th style={th}>Kanal</th>
                      <th style={th}>Quelle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stream.map((e, i) => (
                      <tr key={i}>
                        <td
                          style={{
                            ...td,
                            whiteSpace: "nowrap",
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {zeit(e.received_at_ms ?? e.event_timestamp_ms)}
                        </td>
                        <td style={{ ...td, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                          {e.custom_event_name || e.event_type || "—"}
                        </td>
                        <td style={td}>
                          {e.api_channel === "server_to_server"
                            ? "Server"
                            : e.api_channel === "pixel_sdk"
                              ? "Pixel"
                              : e.api_channel || "—"}
                        </td>
                        <td style={{ ...td, color: S.mut }}>{e.action_source || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {hubLog && (
              <div style={{ borderTop: `1px solid ${S.line}`, padding: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: S.txt, marginBottom: 8 }}>
                  Über EzyHub gesendet · {rangeLabel}
                </div>
                {hubLog}
              </div>
            )}
          </div>
        )}

        {/* Diagnose */}
        {setup && tab === "diagnose" && (
          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
            {warnungen.length === 0 ? (
              <div style={{ fontSize: 12.5, color: S.mut }}>Keine aktiven Warnungen.</div>
            ) : (
              warnungen.map((w, i) => (
                <div
                  key={i}
                  style={{
                    border: `1px solid ${S.line}`,
                    borderLeft: "3px solid #d97706",
                    borderRadius: 10,
                    padding: "10px 14px",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, color: S.txt }}>{w.titel}</div>
                  <div style={{ fontSize: 12, color: S.mut, marginTop: 3 }}>{w.text}</div>
                </div>
              ))
            )}
            {readiness}
          </div>
        )}
      </div>
    </div>
  );
}
