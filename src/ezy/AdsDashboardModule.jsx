// EzyPerformance / Google-Ads-Dashboard. Seit 06.10.2026 Tab-Container nach
// Mockup «Google Ads Report · Erweiterung» (Ablösung des Data-Studio-Dashboards):
// Übersicht · Kampagnen (auch Kunden-Logins) · Massnahmen · Autopilot · Freigaben (Team).
import { authedFetch } from "@/lib/authed-fetch";
import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Btn } from "./shared-ui";
import { C } from "./theme";
import { LiveEmptyState } from "./ui-kit";
import { googleAdsFromResult, useEzyLatestRun } from "@/ezy/data/useEzyLatestRun";
import { useEzyAdsAutopilot } from "@/ezy/data/useEzyAdsAutopilot";
import { supabase } from "@/integrations/supabase/client";
import AdsUebersicht from "./ads/AdsUebersicht";

const AdsKampagnen = lazy(() => import("./ads/AdsKampagnen"));
const AdsAutopilotPanel = lazy(() => import("./AdsAutopilotPanel.jsx"));

// Lokales Datum (toISOString kippt ab Mitternacht CH in den Vortag).
const ymd = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const standText = (iso) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}., ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
// Handy-Layout (Karte unter Städteliste, Hero linksbündig, kompakte Tabs).
const MOBIL_CSS = `
        @media (max-width: 860px) {
          .ads-report .ads-herkunft { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 560px) {
          .ads-report .ads-hero-rechts { text-align: left !important; }
          .ads-report .ads-tabs button { padding: 10px 11px 11px !important; font-size: 14px !important; }
        }
      `;
const VERGLEICH = { prevPeriod: "Vorperiode", prevMonth: "Vormonat", prevYear: "Vorjahr" };

/** Zaehler fuer die Tab-Titel aus dem Autopilot-Stand. */
function autopilotZaehler(ap) {
  const offeneFreigaben = (ap?.approvals || []).filter(
    (a) => !a.expires_at || new Date(a.expires_at).getTime() > Date.now(),
  ).length;
  const befunde = (ap?.changelog || []).filter(
    (c) => c.action_class === "report-only" && c.status === "report-only",
  );
  const letzterLauf = befunde[0]?.run_id;
  return {
    massnahmen: (ap?.recommendations || []).length,
    autopilot: befunde.filter((b) => b.run_id === letzterLauf).length,
    freigaben: offeneFreigaben,
  };
}

function Tabs({ tabs, aktiv, onChange, rechts }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
        borderBottom: `1px solid ${C.border}`,
        marginBottom: 22,
      }}
    >
      <div
        role="tablist"
        className="ads-tabs"
        style={{ display: "flex", gap: 4, overflowX: "auto", maxWidth: "100%" }}
      >
        {tabs.map((t) => {
          const an = t.id === aktiv;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={an}
              onClick={() => onChange(t.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                border: "none",
                background: "none",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: 15,
                fontWeight: an ? 700 : 500,
                color: an ? C.accent : C.textMuted,
                padding: "12px 16px 13px",
                borderBottom: `2.5px solid ${an ? C.accent : "transparent"}`,
                marginBottom: -1,
                whiteSpace: "nowrap",
              }}
            >
              {t.label}
              {t.zaehler != null && (
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.textMuted,
                    background: C.segBg,
                    borderRadius: 999,
                    padding: "2px 8px",
                  }}
                >
                  {t.zaehler}
                </span>
              )}
            </button>
          );
        })}
      </div>
      {rechts}
    </div>
  );
}

// kundenansicht: Kunden-Login (viewer) — nur Übersicht + Kampagnen, kein Abruf.
export function AdsDashboard({ selectedClient, dateRange, kundenansicht = false }) {
  const clientId = selectedClient?.id;
  const { run, loading, refresh } = useEzyLatestRun(clientId, "google_ads", dateRange?.end || null);
  const ap = useEzyAdsAutopilot(kundenansicht ? undefined : clientId, 80);
  const [tab, setTab] = useState("uebersicht");
  const [pulling, setPulling] = useState(false);
  const [pullFehler, setPullFehler] = useState("");

  const start = dateRange?.start ? ymd(dateRange.start) : null;
  const ende = dateRange?.end ? ymd(dateRange.end) : null;
  const cStart = dateRange?.compare?.start ? ymd(dateRange.compare.start) : null;
  const cEnde = dateRange?.compare?.end ? ymd(dateRange.compare.end) : null;

  const pull = useCallback(async () => {
    if (!clientId || kundenansicht) return;
    setPulling(true);
    setPullFehler("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const body = { clientId, days: dateRange?.days || 30 };
      if (start && ende) Object.assign(body, { startDate: start, endDate: ende });
      if (cStart && cEnde) Object.assign(body, { compareStart: cStart, compareEnd: cEnde });
      const res = await authedFetch("/api/google/ads-data", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!json?.ok) setPullFehler(json?.error || `Abruf fehlgeschlagen (HTTP ${res.status})`);
      await refresh();
    } catch (e) {
      setPullFehler(e?.message || String(e));
    } finally {
      setPulling(false);
    }
  }, [clientId, kundenansicht, dateRange?.days, start, ende, cStart, cEnde, refresh]);

  // Gespeicherter Stand passt nicht zum gewaehlten Zeitraum (oder hat noch keinen
  // Report-Block) -> einmal je Zeitraum still neu abrufen (nur Team).
  const result = run?.result;
  const zeitraumKey = `${clientId}|${start}|${ende}|${cStart}|${cEnde}`;
  const abgerufen = useRef(new Set());
  const passt =
    !!result &&
    !!result.extras?.report &&
    result.range?.from === start &&
    result.range?.to === ende &&
    (!cStart || (result.prevRange?.from === cStart && result.prevRange?.to === cEnde));
  useEffect(() => {
    if (kundenansicht || loading || pulling || !clientId || !start || passt) return;
    if (!selectedClient?.googleAdsCustomer) return;
    if (abgerufen.current.has(zeitraumKey)) return;
    abgerufen.current.add(zeitraumKey);
    void pull();
  }, [
    kundenansicht,
    loading,
    pulling,
    clientId,
    start,
    passt,
    zeitraumKey,
    pull,
    selectedClient?.googleAdsCustomer,
  ]);

  const ads = googleAdsFromResult(result);
  const snap = { ...ads, report: result?.extras?.report || null };
  const hasData =
    ads.totals.cost + ads.totals.clicks + ads.totals.impressions + ads.totals.conversions > 0;
  const z = autopilotZaehler(ap);
  const aktiveKampagnen = ads.campaigns.filter(
    (c) => c.status === "ENABLED" && (c.impressions > 0 || c.cost > 0),
  ).length;

  const tabs = [
    { id: "uebersicht", label: "Übersicht" },
    ...(kundenansicht ? [] : [{ id: "massnahmen", label: "Massnahmen", zaehler: z.massnahmen }]),
    { id: "kampagnen", label: "Kampagnen", zaehler: hasData ? `${aktiveKampagnen} aktiv` : null },
    ...(kundenansicht
      ? []
      : [
          { id: "autopilot", label: "Autopilot", zaehler: `${z.autopilot} offen` },
          { id: "freigaben", label: "Freigaben", zaehler: z.freigaben },
        ]),
  ];

  const stand = run?.created_at ? (
    <span
      title={result?.range ? `Daten für ${result.range.from} – ${result.range.to}` : undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: C.textMuted,
        border: `1px solid ${C.border}`,
        borderRadius: 999,
        padding: "6px 14px",
        background: C.card,
        marginBottom: 8,
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: pulling ? C.orange : passt ? C.green : C.textDim,
        }}
      />
      {pulling
        ? "Google Ads · wird aktualisiert …"
        : `Google Ads · Stand ${standText(run.created_at)}`}
    </span>
  ) : null;

  const aktion = kundenansicht ? null : (
    <Btn variant="secondary" size="sm" icon={RefreshCw} onClick={() => pull()} disabled={pulling}>
      {pulling ? "Lädt…" : "Aktualisieren"}
    </Btn>
  );

  const tageLabel = dateRange?.label || `Letzte ${dateRange?.days || 30} Tage`;
  const vergleichLabel = VERGLEICH[dateRange?.compareMode] || "Vorperiode";

  let inhalt;
  if (tab === "massnahmen" || tab === "autopilot" || tab === "freigaben") {
    inhalt = (
      <Suspense fallback={<div style={{ color: C.textMuted, padding: 20 }}>Lädt…</div>}>
        <AdsAutopilotPanel selectedClient={selectedClient} section={tab} data={ap} />
      </Suspense>
    );
  } else if (loading && !result) {
    inhalt = <div style={{ color: C.textMuted, padding: 20 }}>Lade Ads-Daten…</div>;
  } else if (!hasData) {
    inhalt = (
      <LiveEmptyState
        title={pulling ? "Ads-Daten werden geladen …" : "Noch keine Ads-Daten"}
        hint={
          selectedClient?.googleAdsCustomer
            ? kundenansicht
              ? "Die Daten werden in Kürze bereitgestellt."
              : "Google Ads Customer ID ist hinterlegt. «Aktualisieren» lädt die Daten."
            : "Bitte zuerst eine Google Ads Customer ID hinterlegen."
        }
        action={selectedClient?.googleAdsCustomer && aktion}
      />
    );
  } else if (tab === "kampagnen") {
    inhalt = (
      <Suspense fallback={<div style={{ color: C.textMuted, padding: 20 }}>Lädt…</div>}>
        <AdsKampagnen snap={snap} />
      </Suspense>
    );
  } else {
    inhalt = (
      <AdsUebersicht
        snap={snap}
        client={selectedClient}
        tageLabel={tageLabel}
        vergleichLabel={vergleichLabel}
        aktion={aktion}
      />
    );
  }

  return (
    <div className="ads-report">
      <style>{MOBIL_CSS}</style>
      <Tabs tabs={tabs} aktiv={tab} onChange={setTab} rechts={stand} />
      {pullFehler && !kundenansicht && (
        <div
          style={{
            marginBottom: 16,
            fontSize: 13,
            color: C.red,
            background: C.redDim,
            borderRadius: 10,
            padding: "10px 14px",
          }}
        >
          Aktualisierung fehlgeschlagen: {pullFehler}
        </div>
      )}
      {inhalt}
    </div>
  );
}
