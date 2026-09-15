import { authedFetch } from "@/lib/authed-fetch";
import IngestCredentialsPanel from "@/ezy/IngestCredentialsPanel";
import EzyAiAdsOverview from "@/ezy/EzyAiAdsOverview";
// EzyAI — Ads-Modus (ChatGPT Ads, 26.08.2026): Conversion-Tracking über die
// OpenAI Conversions API. Eigene Datei (Bundle-Split-Muster wie LocalGrid) —
// der Organic/Ads-Schalter sitzt in der AppRail (railExtra, unter der
// Trennlinie), dieser Panel rendert die drei Ads-Bereiche.
// Dashboard (15.09.): «Leistungstrend» wie im OpenAI Ads Manager (Ausgaben/
// Impressionen/Klicks/CPC, Segmentierung, Kampagnen-Filter, 7T/14T/30T) aus
// den gesyncten Advertiser-API-Insights — EzyAiAdsOverview.tsx. Die eigenen
// Conversion-Events (openai_ads_events) leben im Bereich Conversions.
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
        const r = await authedFetch(
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

  // Dashboard = Leistungstrend aus dem Advertiser-Konto — unabhängig von der
  // Pixel-Konfiguration (15.09.).
  if (section === "ads-overview")
    return <EzyAiAdsOverview clientId={clientId} range={range} S={S} />;

  // Einstellungen (15.09.): Pixel, Server-Key, Conversion-Events und der
  // Ingest-Token (steckt in der ConfigCard) an einem Ort.
  if (section === "ads-einstellungen")
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {isOrgAdmin && (
          <ConversionSetupCard
            S={S}
            card={card}
            clientId={clientId}
            isOrgAdmin={isOrgAdmin}
            onChanged={refresh}
          />
        )}
        <ConfigCard
          clientId={clientId}
          clientName={clientName}
          S={S}
          isOrgAdmin={isOrgAdmin}
          initial={
            data.configured ? { pixelId: data.pixelId || "", enabled: !!data.enabled } : null
          }
          onSaved={refresh}
          intro={!data.configured}
        />
        <SnippetCard S={S} card={card} pixelId={data.pixelId || null} clientId={clientId} />
        <ReadinessCard S={S} card={card} clientId={clientId} clientName={clientName} />
      </div>
    );

  // Noch nicht konfiguriert: Setup-Karte (Formular nur für Owner/Admin).
  // Seit 13.09. steht die API-Setup-Karte voran: «Pixel anlegen» erzeugt das
  // Pixel im OpenAI-Konto und hinterlegt die ID gleich hier — das manuelle
  // Formular bleibt als Alternative (Pixel aus dem Ads Manager übernehmen).
  if (!data.configured)
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {isOrgAdmin && (
          <ConversionSetupCard
            S={S}
            card={card}
            clientId={clientId}
            isOrgAdmin={isOrgAdmin}
            onChanged={refresh}
          />
        )}
        <ConfigCard
          clientId={clientId}
          clientName={clientName}
          S={S}
          isOrgAdmin={isOrgAdmin}
          initial={null}
          onSaved={refresh}
          intro
        />
      </div>
    );

  const events = data.events || [];

  if (section === "ads-conversions")
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
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
        <SnippetCard S={S} card={card} pixelId={data.pixelId || null} clientId={clientId} />
        <div style={{ ...card, fontSize: 12.5, color: S.mut }}>
          Pixel, Server-Key, Conversion-Events und der Ingest-Token werden im Bereich{" "}
          <b style={{ color: S.txt }}>Einstellungen</b> eingerichtet.
        </div>
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

  // Unbekannter Bereich (sollte nicht vorkommen) — Dashboard-Hinweis.
  return <EzyAiAdsOverview clientId={clientId} range={range} S={S} />;
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

/* ── Technik-Check der Kunden-Website ────────────────────────────────────────
   Prüft die Domain gegen die Anforderungen aus
   developers.openai.com/ads/measurement-pixel: HTTPS, SDK im <head>, Pixel-ID,
   page_viewed, Conversion-Events, Deduplizierung, CSP-Freigaben, Consent-Tool.
   Zweiter Teil: der Live-Check fragt bei OpenAI die zuletzt eingegangenen
   Events ab — der sieht auch Einbauten über einen Tag-Manager, die im
   Roh-HTML unsichtbar bleiben. */
type ReadyItem = {
  id: string;
  label: string;
  status: "ok" | "warn" | "fail" | "info";
  detail: string;
  hint?: string;
};

const READY_STYLE: Record<ReadyItem["status"], { bg: string; fg: string; sign: string }> = {
  ok: { bg: "rgba(22,163,74,.12)", fg: "#15803d", sign: "✓" },
  warn: { bg: "rgba(217,119,6,.14)", fg: "#b45309", sign: "!" },
  fail: { bg: "rgba(220,38,38,.12)", fg: "#b91c1c", sign: "×" },
  info: { bg: "rgba(100,116,139,.14)", fg: "#475569", sign: "i" },
};

function ReadinessCard({
  S,
  card,
  clientId,
  clientName,
}: {
  S: Tokens;
  card: React.CSSProperties;
  clientId: string;
  clientName: string;
}) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{
    checkedUrl?: string;
    items?: ReadyItem[];
    score?: { ok: number; warn: number; fail: number };
    error?: string;
  } | null>(null);
  const [live, setLive] = useState<{
    events?: Array<{
      event_type: string | null;
      custom_event_name: string | null;
      api_channel: string | null;
      event_timestamp_ms: number | null;
    }>;
    error?: string;
  } | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    setRes(null);
    setLive(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await authedFetch("/api/admin/openai-ads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "readiness",
          clientId,
          ...(url.trim() ? { url: url.trim() } : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      setRes(j.ok ? j : { error: j.error || `HTTP ${r.status}` });
    } catch (e: any) {
      setRes({ error: String(e?.message || e) });
    }
    setBusy(false);
  };

  const runLive = async () => {
    setLiveBusy(true);
    setLive(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await authedFetch("/api/admin/chatgpt-ads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "conv-sample", clientId }),
      });
      const j = await r.json().catch(() => ({}));
      setLive(
        j.ok
          ? j
          : {
              error:
                r.status === 409 && /Konto/.test(j.error || "")
                  ? "Kein Advertiser-Konto verbunden — zuerst oben verbinden."
                  : j.error || `HTTP ${r.status}`,
            },
      );
    } catch (e: any) {
      setLive({ error: String(e?.message || e) });
    }
    setLiveBusy(false);
  };

  const btn: React.CSSProperties = {
    border: `1px solid ${S.line}`,
    background: "#fff",
    color: S.txt,
    borderRadius: 8,
    padding: "7px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
  };

  return (
    <div style={card}>
      <SectionTitle
        S={S}
        title="Technik-Check der Website"
        sub="prüft die Domain gegen die Anforderungen von OpenAI für den Measurement-Pixel"
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={`Startseite von ${clientName} — oder eine andere Seite, z.B. https://…/kontakt`}
          style={{
            flex: "1 1 320px",
            minWidth: 220,
            border: `1px solid ${S.line}`,
            borderRadius: 8,
            padding: "7px 10px",
            fontSize: 12.5,
            color: S.txt,
            background: "#fff",
          }}
        />
        <button onClick={run} disabled={busy} style={{ ...btn, opacity: busy ? 0.6 : 1 }}>
          {busy ? "Prüft …" : "Anforderungen prüfen"}
        </button>
      </div>

      {res?.error && (
        <div style={{ fontSize: 12.5, color: "#b91c1c", marginTop: 10 }}>{res.error}</div>
      )}

      {res?.items && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, color: S.mut, marginBottom: 8 }}>
            Geprüft: <b style={{ color: S.txt }}>{res.checkedUrl}</b> — {res.score?.ok ?? 0} erfüllt
            {(res.score?.warn ?? 0) > 0 && `, ${res.score?.warn} zu prüfen`}
            {(res.score?.fail ?? 0) > 0 && `, ${res.score?.fail} offen`}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {res.items.map((it) => {
              const st = READY_STYLE[it.status];
              return (
                <div
                  key={it.id}
                  style={{
                    display: "flex",
                    gap: 10,
                    alignItems: "flex-start",
                    border: `1px solid ${S.line}`,
                    borderRadius: 8,
                    padding: "9px 11px",
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      width: 20,
                      height: 20,
                      borderRadius: 999,
                      background: st.bg,
                      color: st.fg,
                      fontSize: 12,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      marginTop: 1,
                    }}
                  >
                    {st.sign}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 600, color: S.txt }}>{it.label}</div>
                    <div style={{ fontSize: 11.5, color: S.mut, wordBreak: "break-word" }}>
                      {it.detail}
                    </div>
                    {it.hint && (
                      <div style={{ fontSize: 11.5, color: st.fg, marginTop: 3 }}>{it.hint}</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ borderTop: `1px solid ${S.line}`, marginTop: 14, paddingTop: 12 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, color: S.txt, marginRight: "auto" }}>
            Live-Check: kommen Events bei OpenAI an?
          </div>
          <button
            onClick={runLive}
            disabled={liveBusy}
            style={{ ...btn, opacity: liveBusy ? 0.6 : 1 }}
          >
            {liveBusy ? "Fragt ab …" : "Eingegangene Events abrufen"}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: S.mut, marginTop: 4 }}>
          Stichprobe der letzten Minuten aus dem OpenAI-Konto. Das ist der verlässliche Nachweis,
          wenn der Pixel über einen Tag-Manager ausgeliefert wird und im HTML nicht zu sehen ist.
        </div>
        {live?.error && (
          <div style={{ fontSize: 12.5, color: "#b91c1c", marginTop: 8 }}>{live.error}</div>
        )}
        {live?.events && (
          <div style={{ fontSize: 12, color: S.txt, marginTop: 8 }}>
            {live.events.length === 0 ? (
              <span style={{ color: S.mut }}>
                Keine Events in der Stichprobe. Die Seite einmal im Browser aufrufen und in ein bis
                zwei Minuten erneut abrufen.
              </span>
            ) : (
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {live.events.slice(0, 10).map((e, i) => (
                  <li key={i} style={{ marginBottom: 2 }}>
                    {e.custom_event_name || e.event_type || "Event"}
                    <span style={{ color: S.mut }}>
                      {" "}
                      — {e.api_channel === "server_to_server" ? "Server" : "Pixel"}
                      {e.event_timestamp_ms
                        ? `, ${new Date(e.event_timestamp_ms).toLocaleTimeString("de-CH")}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Website-Snippet (Pixel) ─────────────────────────────────────────────────
   Offizielles oaiq-Loader-Snippet (developers.openai.com/ads/measurement-pixel)
   plus unsere Ergaenzungen. Drei Dinge, die die Doku verlangt bzw. die Praxis:
   (1) `type` ist bei JEDEM measure-Aufruf Pflicht — page_viewed/contents_viewed/
       items_added/checkout_started/order_created = "contents", lead_created/
       appointment_scheduled/registration_completed = "customer_action",
       subscription_created/trial_started = "plan_enrollment". Ohne type ist der
       Aufruf unvollstaendig (Stand 15.09.2026, developers.openai.com/ads/
       supported-events).
   (2) page_viewed muss explizit gemessen werden — das SDK sendet KEINEN
       Auto-PageView.
   (3) Leads erst bei ERFOLG zaehlen, nicht beim Klick auf Senden: sonst zaehlen
       Pflichtfeld-Fehler, Spam-Blocks und nicht zugestellte Mails mit, und bei
       einem klassischen Formular springt die Seite weg, bevor das gebuendelte
       Ereignis den Browser verlaesst. Deshalb haengen wir uns an die
       Erfolgsereignisse der gaengigen Formular-Plugins.
   Die versteckten Felder ezy_event_id/ezy_oppref stehen schon beim Laden im
   Formular, nicht erst beim Absenden — so bekommt das CRM sie in jedem Fall und
   OpenAI dedupliziert Browser- und Server-Meldung ueber dieselbe event_id. */
function buildPixelSnippet(pixelId: string): string {
  return `<!-- ChatGPT-Ads-Pixel (Ezy One) — einmal im <head> einbauen -->
<script>
  (function (w, d, s, u) {
    if (w.oaiq) return;
    var q = function () { q.q.push(arguments); };
    q.q = [];
    w.oaiq = q;
    var js = d.createElement(s);
    js.async = true;
    js.src = u;
    var f = d.getElementsByTagName(s)[0];
    f.parentNode.insertBefore(js, f);
  })(window, document, "script", "https://bzrcdn.openai.com/sdk/oaiq.min.js");

  oaiq("init", { pixelId: "${pixelId}" });
  oaiq("measure", "page_viewed", { type: "contents" });

  // Nur ausfuellen, wenn ein reines HTML-Formular ohne Plugin im Einsatz ist,
  // z.B. "form#kontakt, form.anfrage". Contact Form 7, WPForms, Elementor,
  // Gravity Forms und Ninja Forms werden unten automatisch erkannt.
  var EZY_LEAD_FORMS = "";

  (function (w, d) {
    var lastForm = null;
    var lastSent = 0;

    function hid(form, name, value) {
      var i = form.querySelector('input[data-ezy="' + name + '"]');
      if (!i) {
        i = d.createElement("input");
        i.type = "hidden";
        i.name = name;
        i.setAttribute("data-ezy", name);
        form.appendChild(i);
      }
      i.value = value;
    }

    function oppref() {
      var m = d.cookie.match(/(?:^|; )__oppref=([^;]+)/);
      return m ? decodeURIComponent(m[1]) : "";
    }

    // Ereignis-Kennung + oppref als versteckte Felder ins Formular legen.
    // Suchformulare (method="get") bleiben aussen vor.
    function prepare(form) {
      if (!form || form.nodeName !== "FORM") return "";
      if ((form.getAttribute("method") || "post").toLowerCase() === "get") return "";
      var id = form.getAttribute("data-ezy-event-id");
      if (!id) {
        id = "lead_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
        form.setAttribute("data-ezy-event-id", id);
      }
      hid(form, "ezy_event_id", id);
      var o = oppref();
      if (o) hid(form, "ezy_oppref", o);
      return id;
    }

    function prepareAll() {
      var list = d.querySelectorAll("form");
      for (var i = 0; i < list.length; i++) prepare(list[i]);
    }

    // Wird erst bei ERFOLG aufgerufen.
    function lead(form) {
      if (!form || form.nodeName !== "FORM") form = lastForm;
      var now = Date.now();
      if (now - lastSent < 2000) return; // dasselbe Absenden nicht doppelt zaehlen
      lastSent = now;
      var id = (form && prepare(form)) || "lead_" + now;
      w.oaiq("measure", "lead_created", { type: "customer_action" }, { event_id: id });
      // Kennung erneuern, damit eine zweite echte Anfrage eigenstaendig zaehlt.
      if (form) {
        form.removeAttribute("data-ezy-event-id");
        prepare(form);
      }
    }

    if (d.readyState === "loading") d.addEventListener("DOMContentLoaded", prepareAll);
    else prepareAll();

    // Beim Absenden den oppref auffrischen (das Cookie kann spaeter gesetzt
    // worden sein) und merken, welches Formular gerade laeuft.
    d.addEventListener("submit", function (e) {
      lastForm = e.target;
      prepare(e.target);
    }, true);

    // Contact Form 7 sendet ein echtes DOM-Ereignis.
    d.addEventListener("wpcf7mailsent", function (e) { lead(e.target); });

    // WPForms, Elementor, Gravity Forms und Ninja Forms laufen ueber jQuery.
    if (w.jQuery) {
      w.jQuery(d).on("wpformsAjaxSubmitSuccess", function (e) { lead(e.target); });
      w.jQuery(d).on("submit_success", function (e) { lead(e.target); });
      w.jQuery(d).on("gform_confirmation_loaded", function () { lead(null); });
      w.jQuery(d).on("nfFormSubmitResponse", function () { lead(null); });
    }

    // Reines HTML-Formular ohne Erfolgsereignis: oben EZY_LEAD_FORMS setzen.
    if (EZY_LEAD_FORMS) {
      d.addEventListener("submit", function (e) {
        var f = e.target;
        if (f && f.nodeName === "FORM" && f.matches(EZY_LEAD_FORMS)) lead(f);
      }, true);
    }
  })(window, document);
</script>`;
}

type VerifyChecks = {
  sdkFound: boolean;
  pixelIdFound: boolean;
  pageViewed: boolean;
  formHook: boolean;
};

function SnippetCard({
  S,
  card,
  pixelId,
  clientId,
}: {
  S: Tokens;
  card: React.CSSProperties;
  pixelId: string | null;
  clientId: string;
}) {
  const [copied, setCopied] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verify, setVerify] = useState<{
    checks?: VerifyChecks;
    checkedUrl?: string;
    passed?: boolean;
    error?: string;
  } | null>(null);
  // Live-Check (13.09.): Stichprobe der bei OpenAI eingegangenen Events
  // (GET /conversions/events) — sieht auch GTM-Einbauten, weil serverseitig.
  const [sampling, setSampling] = useState(false);
  const [sample, setSample] = useState<{
    events?: Array<{
      event_type: string | null;
      custom_event_name: string | null;
      api_channel: string | null;
      event_timestamp_ms: number | null;
    }>;
    mock?: boolean;
    error?: string;
  } | null>(null);
  const runSample = async () => {
    setSampling(true);
    setSample(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await authedFetch("/api/admin/chatgpt-ads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "conv-sample", clientId }),
      });
      const j = await r.json().catch(() => ({}));
      setSample(
        j.ok
          ? j
          : {
              error:
                r.status === 409 && /Konto/.test(j.error || "")
                  ? "Kein Advertiser-Konto verbunden — zuerst unter «Kampagnen» verbinden."
                  : j.error || `HTTP ${r.status}`,
            },
      );
    } catch (e: any) {
      setSample({ error: String(e?.message || e) });
    }
    setSampling(false);
  };
  const runVerify = async () => {
    setVerifying(true);
    setVerify(null);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await authedFetch("/api/admin/openai-ads", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ action: "verify-pixel", clientId }),
      });
      const j = await r.json().catch(() => ({}));
      setVerify(j.ok ? j : { error: j.error || `HTTP ${r.status}` });
    } catch (e: any) {
      setVerify({ error: String(e?.message || e) });
    }
    setVerifying(false);
  };
  if (!pixelId)
    return (
      <div style={card}>
        <SectionTitle S={S} title="Website-Snippet (Pixel)" />
        <div style={{ fontSize: 12.5, color: S.mut }}>
          Zuerst die Pixel-ID in den Einstellungen (Bereich Dashboard) hinterlegen — danach
          erscheint hier das fertige Snippet für die Kunden-Website.
        </div>
      </div>
    );
  const code = buildPixelSnippet(pixelId);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard nicht verfügbar — Nutzer markiert den Code manuell */
    }
  };
  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <SectionTitle
          S={S}
          title="Website-Snippet (Pixel)"
          sub="einmal im <head> der Kunden-Website — misst Seitenaufrufe + Formular-Leads"
        />
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={runVerify}
            disabled={verifying}
            style={{
              border: `1px solid ${S.line}`,
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              background: "transparent",
              color: S.txt,
              opacity: verifying ? 0.6 : 1,
            }}
          >
            {verifying ? "Prüfe…" : "Installation prüfen"}
          </button>
          <button
            onClick={runSample}
            disabled={sampling}
            title="Fragt bei OpenAI ab, welche Events in den letzten ~15 Minuten für diese Pixel-ID eingegangen sind"
            style={{
              border: `1px solid ${S.line}`,
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              background: "transparent",
              color: S.txt,
              opacity: sampling ? 0.6 : 1,
            }}
          >
            {sampling ? "Frage ab…" : "Live-Events (OpenAI)"}
          </button>
          <button
            onClick={copy}
            style={{
              border: `1px solid ${S.line}`,
              borderRadius: 8,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: "pointer",
              background: copied ? "#16a34a" : S.app || "#77008C",
              color: "#fff",
            }}
          >
            {copied ? "Kopiert ✓" : "Snippet kopieren"}
          </button>
        </div>
      </div>
      {verify && (
        <div
          style={{
            border: `1px solid ${verify.error ? "#dc262655" : verify.passed ? "#16a34a55" : "#d9770655"}`,
            background: verify.error
              ? "rgba(220,38,38,.05)"
              : verify.passed
                ? "rgba(22,163,74,.06)"
                : "rgba(217,119,6,.06)",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: 12.5,
          }}
        >
          {verify.error ? (
            <span style={{ color: "#b91c1c", fontWeight: 700 }}>
              Prüfung fehlgeschlagen: {verify.error}
            </span>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6, color: S.txt }}>
                {verify.passed
                  ? "Pixel korrekt eingebaut ✓"
                  : "Pixel noch nicht (vollständig) gefunden"}
                <span style={{ fontWeight: 400, color: S.mut, marginLeft: 8, fontSize: 11 }}>
                  geprüft: {verify.checkedUrl}
                </span>
              </div>
              {(
                [
                  ["SDK eingebunden (oaiq.min.js)", verify.checks?.sdkFound],
                  ["Pixel-ID korrekt", verify.checks?.pixelIdFound],
                  ["Seitenaufruf-Messung (page_viewed)", verify.checks?.pageViewed],
                  ["Formular-Hook (Lead-Tracking)", verify.checks?.formHook],
                ] as Array<[string, boolean | undefined]>
              ).map(([label, okv]) => (
                <div key={label} style={{ color: okv ? "#0f9d6c" : "#b45309", lineHeight: 1.7 }}>
                  {okv ? "✓" : "✗"} {label}
                </div>
              ))}
              <div style={{ color: S.mut, marginTop: 6, fontSize: 11.5, lineHeight: 1.6 }}>
                {verify.passed
                  ? "Sobald echte Besucher die Seite aufrufen, gehen Events bei OpenAI ein — dann lässt sich die Pixel-Verifikation im Ads Manager (ads.openai.com) abhaken."
                  : "Hinweis: Ist das Snippet über den Google Tag Manager eingebaut, kann dieser Check es nicht sehen (lädt erst zur Laufzeit) — massgeblich ist dann die Verifikation im Ads Manager selbst."}
              </div>
            </>
          )}
        </div>
      )}
      {sample && (
        <div
          style={{
            border: `1px solid ${sample.error ? "#dc262655" : (sample.events || []).length ? "#16a34a55" : "#d9770655"}`,
            background: sample.error
              ? "rgba(220,38,38,.05)"
              : (sample.events || []).length
                ? "rgba(22,163,74,.06)"
                : "rgba(217,119,6,.06)",
            borderRadius: 10,
            padding: "10px 14px",
            marginBottom: 12,
            fontSize: 12.5,
          }}
        >
          {sample.error ? (
            <span style={{ color: "#b91c1c", fontWeight: 700 }}>Live-Abfrage: {sample.error}</span>
          ) : (sample.events || []).length === 0 ? (
            <>
              <div style={{ fontWeight: 700, color: S.txt }}>
                Bei OpenAI sind in den letzten ~15 Minuten keine Events eingegangen
              </div>
              <div style={{ color: S.mut, marginTop: 4, fontSize: 11.5, lineHeight: 1.6 }}>
                Die Website einmal selbst aufrufen (page_viewed) oder ein Testformular absenden und
                erneut abfragen. Erst wenn hier Events erscheinen, ist das Pixel bei OpenAI
                verifizierbar.
              </div>
            </>
          ) : (
            <>
              <div style={{ fontWeight: 700, marginBottom: 6, color: S.txt }}>
                Events kommen bei OpenAI an ✓{" "}
                <span style={{ fontWeight: 400, color: S.mut, fontSize: 11 }}>
                  {(sample.events || []).length} in den letzten ~15 Min
                  {sample.mock ? " · Demo (eigene CAPI-Events)" : ""}
                </span>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {Object.entries(
                  (sample.events || []).reduce<Record<string, number>>((m, e) => {
                    const k = `${e.custom_event_name || e.event_type || "?"} · ${
                      e.api_channel === "pixel_sdk"
                        ? "Pixel"
                        : e.api_channel === "server_to_server"
                          ? "Server (CAPI)"
                          : e.api_channel || "?"
                    }`;
                    m[k] = (m[k] || 0) + 1;
                    return m;
                  }, {}),
                ).map(([k, n]) => (
                  <span
                    key={k}
                    style={{
                      border: `1px solid ${S.line}`,
                      borderRadius: 999,
                      padding: "2px 10px",
                      fontSize: 11.5,
                      color: S.txt,
                      background: S.panel,
                    }}
                  >
                    {k} <b>×{n}</b>
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <pre
        style={{
          margin: 0,
          padding: 12,
          fontSize: 11,
          lineHeight: 1.5,
          background: "rgba(43,0,51,.04)",
          border: `1px solid ${S.line}`,
          borderRadius: 10,
          overflowX: "auto",
          maxHeight: 320,
          color: S.txt,
        }}
      >
        {code}
      </pre>
      <div style={{ fontSize: 11.5, color: S.mut, marginTop: 10, lineHeight: 1.6 }}>
        <b>Einbau:</b> Den Block unverändert einmal in den <code>&lt;head&gt;</code> der Website
        kopieren, möglichst weit oben. Nichts anpassen nötig, solange die Formulare über Contact
        Form 7, WPForms, Elementor, Gravity Forms oder Ninja Forms laufen — die erkennt das Snippet
        selbst. Nur bei einem reinen HTML-Formular oben bei <code>EZY_LEAD_FORMS</code> den Selektor
        eintragen, z.B. <code>&quot;form#kontakt&quot;</code>.
        <br />
        <b>Warum es so aussieht:</b> OpenAI verlangt bei jedem Messaufruf das Feld <code>type</code>{" "}
        — Seitenaufruf und Kauf brauchen <code>contents</code>, Lead und Termin{" "}
        <code>customer_action</code>. Der Lead zählt erst, wenn das Formular wirklich erfolgreich
        war, nicht schon beim Klick auf Senden. So zählen Pflichtfeld-Fehler, Spam-Blocks und nicht
        zugestellte Mails nicht als Conversion.
        <br />
        <b>Attribution:</b> Das SDK erfasst den <code>oppref</code>-Parameter vom Anzeigen-Klick
        automatisch (First-Party-Cookie <code>__oppref</code>). Die versteckten Felder{" "}
        <code>ezy_event_id</code> und <code>ezy_oppref</code> liegen schon beim Laden im Formular —
        sendet das CRM sie an unseren Ingest-Endpoint (<code>/api/admin/openai-ads-ingest</code>),
        dedupliziert OpenAI Browser- und Server-Meldung über dieselbe event_id. Kauf-Events (
        <code>order_created</code> mit Betrag und <code>type: &quot;contents&quot;</code>) bei
        Bedarf zusätzlich manuell messen.
      </div>
    </div>
  );
}

/* ── Conversions-Setup per Advertiser API (13.09.): Pixel, CAPI-Key,
   Event-Settings + Zuweisung an Kampagnen ─────────────────────────────────── */
type ConvPixel = { id: string; name: string; pixel_id: string };
type ConvEventSetting = {
  id: string;
  name: string;
  event_type: string;
  custom_event_name: string | null;
  attribution_window_days: number;
  source_ids: string[];
  archived: boolean;
};
type ConvCampaign = { id: string; name: string; status: string; eventSettingIds: string[] };
type ConvSetup = {
  pixels: ConvPixel[];
  eventSettings: ConvEventSetting[];
  campaigns: ConvCampaign[];
  configuredPixelId: string | null;
  hasCapiKey: boolean;
  isMock?: boolean;
};
const CONV_EVENT_OPTIONS: Array<[string, string]> = [
  ["lead_created", "Lead (Formular/Anfrage)"],
  ["appointment_scheduled", "Termin gebucht"],
  ["order_created", "Kauf / Bestellung"],
  ["registration_completed", "Registrierung"],
  ["subscription_created", "Abo abgeschlossen"],
  ["trial_started", "Test gestartet"],
  ["checkout_started", "Checkout gestartet"],
  ["contents_viewed", "Inhalt angesehen"],
  ["items_added", "In den Warenkorb"],
  ["custom", "Eigenes Event …"],
];

function ConversionSetupCard({
  S,
  card,
  clientId,
  isOrgAdmin,
  onChanged,
}: {
  S: Tokens;
  card: React.CSSProperties;
  clientId: string;
  isOrgAdmin: boolean;
  onChanged: () => void;
}) {
  const [setup, setSetup] = useState<ConvSetup | null | "none">(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [f, setF] = useState({
    name: "",
    eventType: "lead_created",
    customEventName: "",
    windowDays: "30",
    sourceIds: [] as string[],
  });
  const [assign, setAssign] = useState<string | null>(null); // eventSetting-ID, dessen Kampagnen bearbeitet werden

  const post = async (body: any) => {
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
  };
  const load = useCallback(async () => {
    const j = await post({ action: "conv-setup-get" });
    if (j.ok) setSetup(j);
    else if (j.status === 409) setSetup("none");
    else {
      setSetup("none");
      setErr(j.error || `HTTP ${j.status}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, body: any) => {
    setBusy(key);
    setErr("");
    const j = await post(body);
    setBusy("");
    if (!j.ok) {
      setErr(j.error || `HTTP ${j.status}`);
      return false;
    }
    await load();
    onChanged();
    return true;
  };

  const btn = (primary: boolean, disabled = false): React.CSSProperties => ({
    border: primary ? "none" : `1px solid ${S.line}`,
    borderRadius: 8,
    padding: "6px 14px",
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? "default" : "pointer",
    background: primary ? S.app || "#77008C" : "transparent",
    color: primary ? "#fff" : S.txt,
    opacity: disabled ? 0.5 : 1,
  });
  const input: React.CSSProperties = {
    border: `1px solid ${S.line}`,
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 12.5,
    background: S.bg,
    color: S.txt,
    boxSizing: "border-box",
    width: "100%",
  };

  if (setup === null)
    return (
      <div style={card}>
        <SectionTitle S={S} title="Pixel & Conversion-Events (OpenAI-Konto)" />
        <div style={{ fontSize: 12.5, color: S.mut }}>Lade Setup…</div>
      </div>
    );
  if (setup === "none")
    return (
      <div style={card}>
        <SectionTitle S={S} title="Pixel & Conversion-Events (OpenAI-Konto)" />
        <div style={{ fontSize: 12.5, color: S.mut, lineHeight: 1.6 }}>
          {err ||
            "Kein Advertiser-Konto verbunden. Unter «Kampagnen» den API-Key des OpenAI-Ads-Kontos hinterlegen — danach lassen sich Pixel, Server-Key und Conversion-Events hier direkt anlegen."}
        </div>
      </div>
    );

  const pixelIds = new Set(setup.pixels.map((p) => p.pixel_id));
  const configuredOk = !!setup.configuredPixelId && pixelIds.has(setup.configuredPixelId);
  const usable = setup.eventSettings.filter((e) => !e.archived);
  const typeLabel = (e: ConvEventSetting) =>
    e.event_type === "custom"
      ? `custom: ${e.custom_event_name || "?"}`
      : CONV_EVENT_OPTIONS.find(([k]) => k === e.event_type)?.[1] || e.event_type;

  return (
    <div style={card}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <SectionTitle
          S={S}
          title="Pixel & Conversion-Events (OpenAI-Konto)"
          sub="direkt über die Advertiser API — kein Wechsel in den Ads Manager nötig"
        />
        {isOrgAdmin && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => run("pixel", { action: "conv-pixel-create" })}
              disabled={busy === "pixel"}
              style={btn(false, busy === "pixel")}
            >
              {busy === "pixel" ? "Lege an…" : "Pixel anlegen"}
            </button>
            <button
              onClick={() => setShowForm((v) => !v)}
              style={btn(true)}
              disabled={!setup.pixels.length}
            >
              Conversion-Event anlegen
            </button>
          </div>
        )}
      </div>
      {err && <div style={{ color: "#b91c1c", fontSize: 12.5, marginBottom: 8 }}>{err}</div>}

      {/* Schritt 1: Pixel */}
      <div style={{ fontSize: 12.5, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, color: S.txt, marginBottom: 4 }}>
          1 · Pixel (Datenquelle)
        </div>
        {setup.pixels.length === 0 ? (
          <div style={{ color: S.mut }}>
            Noch kein Pixel im Konto — «Pixel anlegen» erzeugt eines und hinterlegt die Pixel-ID
            gleich hier beim Kunden (Snippet-Karte unten).
          </div>
        ) : (
          setup.pixels.map((p) => {
            const active = p.pixel_id === setup.configuredPixelId;
            return (
              <div
                key={p.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "3px 0" }}
              >
                <code style={{ fontSize: 11.5, color: S.txt }}>{p.pixel_id}</code>
                <span style={{ color: S.mut }}>{p.name}</span>
                {active ? (
                  <span style={{ color: "#0f9d6c", fontWeight: 700, fontSize: 11.5 }}>
                    ✓ beim Kunden hinterlegt
                  </span>
                ) : (
                  isOrgAdmin && (
                    <button
                      onClick={() =>
                        run(`adopt:${p.id}`, { action: "conv-pixel-adopt", pixelId: p.pixel_id })
                      }
                      style={{ ...btn(false), padding: "2px 8px", fontSize: 11 }}
                    >
                      als Kunden-Pixel übernehmen
                    </button>
                  )
                )}
              </div>
            );
          })
        )}
        {setup.configuredPixelId && !configuredOk && (
          <div style={{ color: "#b45309", marginTop: 4 }}>
            Hinterlegte Pixel-ID {setup.configuredPixelId} gehört nicht zu diesem OpenAI-Konto.
          </div>
        )}
      </div>

      {/* Schritt 2: Server-Key */}
      <div style={{ fontSize: 12.5, marginBottom: 12 }}>
        <div style={{ fontWeight: 700, color: S.txt, marginBottom: 4 }}>
          2 · Server-Key (Conversions API)
        </div>
        {setup.hasCapiKey ? (
          <span style={{ color: "#0f9d6c", fontWeight: 700 }}>
            ✓ hinterlegt — CRM-/Formular-Events laufen über den Ingest-Endpoint
          </span>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ color: S.mut }}>
              Noch kein Server-Key — nötig, damit EzyHub Conversions serverseitig an OpenAI meldet.
            </span>
            {isOrgAdmin && (
              <button
                onClick={() => run("key", { action: "conv-key-create" })}
                disabled={busy === "key" || !setup.configuredPixelId}
                style={btn(false, busy === "key" || !setup.configuredPixelId)}
                title={!setup.configuredPixelId ? "Zuerst ein Pixel anlegen/übernehmen" : undefined}
              >
                {busy === "key" ? "Erzeuge…" : "Key erzeugen & sicher speichern"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Schritt 3: Events */}
      <div style={{ fontSize: 12.5 }}>
        <div style={{ fontWeight: 700, color: S.txt, marginBottom: 4 }}>
          3 · Conversion-Events ({usable.length})
          <span style={{ fontWeight: 400, color: S.mut, marginLeft: 8 }}>
            — was als Conversion zählt; conversions-optimierte Kampagnen brauchen mindestens eines
          </span>
        </div>
        {showForm && isOrgAdmin && (
          <div
            style={{
              border: `1px solid ${S.line}`,
              borderRadius: 10,
              padding: 12,
              marginBottom: 10,
              display: "grid",
              gap: 8,
              gridTemplateColumns: "1fr 1fr",
            }}
          >
            <input
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
              placeholder="Name (z.B. Kontaktanfrage)"
              style={input}
            />
            <select
              value={f.eventType}
              onChange={(e) => setF({ ...f, eventType: e.target.value })}
              style={input}
            >
              {CONV_EVENT_OPTIONS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
            {f.eventType === "custom" && (
              <input
                value={f.customEventName}
                onChange={(e) => setF({ ...f, customEventName: e.target.value })}
                placeholder="Eigener Event-Name (wie im Snippet gemessen)"
                style={input}
              />
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8, color: S.mut }}>
              Attributionsfenster
              <input
                value={f.windowDays}
                onChange={(e) => setF({ ...f, windowDays: e.target.value })}
                style={{ ...input, width: 70 }}
              />{" "}
              Tage
            </label>
            <div
              style={{
                gridColumn: "1 / -1",
                display: "flex",
                gap: 14,
                flexWrap: "wrap",
                color: S.mut,
              }}
            >
              Datenquelle:
              {setup.pixels.map((p) => (
                <label
                  key={p.id}
                  style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={f.sourceIds.includes(p.id)}
                    onChange={(e) =>
                      setF({
                        ...f,
                        sourceIds: e.target.checked
                          ? [...f.sourceIds, p.id]
                          : f.sourceIds.filter((x) => x !== p.id),
                      })
                    }
                  />
                  {p.name || p.pixel_id}
                </label>
              ))}
            </div>
            <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
              <button
                onClick={async () => {
                  const ok = await run("event", {
                    action: "conv-event-create",
                    name: f.name,
                    eventType: f.eventType,
                    customEventName: f.customEventName,
                    attributionWindowDays: Number(f.windowDays) || 30,
                    sourceIds: f.sourceIds.length ? f.sourceIds : setup.pixels.map((p) => p.id),
                  });
                  if (ok) {
                    setShowForm(false);
                    setF({ ...f, name: "", customEventName: "" });
                  }
                }}
                disabled={busy === "event" || f.name.trim().length < 2}
                style={btn(true, busy === "event" || f.name.trim().length < 2)}
              >
                {busy === "event" ? "Lege an…" : "Event anlegen"}
              </button>
              <button onClick={() => setShowForm(false)} style={btn(false)}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
        {usable.length === 0 ? (
          <div style={{ color: S.mut }}>Noch keine Conversion-Events definiert.</div>
        ) : (
          usable.map((e) => {
            const assigned = setup.campaigns.filter((c) => c.eventSettingIds.includes(e.id));
            const editing = assign === e.id;
            return (
              <div key={e.id} style={{ borderTop: `1px solid ${S.line}22`, padding: "6px 0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700, color: S.txt }}>{e.name}</span>
                  <span style={{ color: S.mut }}>
                    {typeLabel(e)} · {e.attribution_window_days} Tage
                  </span>
                  <span style={{ marginLeft: "auto", color: S.mut, fontSize: 11.5 }}>
                    {assigned.length === 0
                      ? "keiner Kampagne zugewiesen"
                      : `Kampagnen: ${assigned.map((c) => c.name).join(", ")}`}
                  </span>
                  {isOrgAdmin && setup.campaigns.length > 0 && (
                    <button
                      onClick={() => setAssign(editing ? null : e.id)}
                      style={{ ...btn(false), padding: "2px 8px", fontSize: 11 }}
                    >
                      {editing ? "Schliessen" : "Kampagnen zuweisen"}
                    </button>
                  )}
                </div>
                {editing && (
                  <div
                    style={{
                      display: "flex",
                      gap: 14,
                      flexWrap: "wrap",
                      marginTop: 6,
                      paddingLeft: 4,
                    }}
                  >
                    {setup.campaigns.map((c) => {
                      const on = c.eventSettingIds.includes(e.id);
                      return (
                        <label
                          key={c.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 5,
                            cursor: "pointer",
                            color: S.txt,
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={on}
                            disabled={busy === `assign:${c.id}`}
                            onChange={() =>
                              run(`assign:${c.id}`, {
                                action: "command",
                                cmd: "set_conversion_events",
                                targetType: "campaign",
                                targetId: c.id,
                                eventSettingIds: on
                                  ? c.eventSettingIds.filter((x) => x !== e.id)
                                  : [...c.eventSettingIds, e.id],
                              })
                            }
                          />
                          {c.name}
                          <span style={{ color: S.mut, fontSize: 11 }}>({c.status})</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
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
      const r = await authedFetch("/api/admin/openai-ads", {
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
    const r = await authedFetch("/api/admin/openai-ads", {
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
      {/* Kundenspezifischer Ingest-Token (13.09.): ersetzt das globale
          OPENAI_ADS_INGEST_SECRET — Klartext erscheint genau einmal. */}
      {initial && (
        <IngestCredentialsPanel
          clientId={clientId}
          purpose="openai_ads"
          S={S as unknown as Record<string, string>}
          isOrgAdmin={isOrgAdmin}
          titel="Ingest-Zugang für CRM/Website (Server-Token)"
        />
      )}
    </div>
  );
}
