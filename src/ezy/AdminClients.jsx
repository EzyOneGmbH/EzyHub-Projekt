// Admin-Kundenverwaltung (aus EzyOneApp.jsx extrahiert, 21.08.2026 — reines
// Verschieben): Kundenliste/-detail, Onboarding, Readiness, Zugriff, Portal.
import { ServicesPanel, ServicesPicker } from "@/ezy/components/ServicesPanel.jsx";
import { Badge, Btn } from "./shared-ui";
import { Inp, LiveEmptyState, Modal, TabBar } from "./ui-kit";
import { ClientAvatar } from "@/ezy/ClientAvatar";
import GoogleClientPanel from "@/ezy/GoogleClientPanel.jsx";
import { Search } from "lucide-react";
import { Fragment } from "react";
import {
  DEFAULT_CUSTOMER_DEFAULTS,
  clientFormFromClient,
  defaultsFromStored,
  ga4PropertyText,
  normalizeClientShape,
  slugifyProjectName,
  splitCsv,
} from "./ui-kit";
import { APP_FEATURES, EZY_APPS } from "@/ezy/data/appRegistry";
import {
  STATUS_LABEL as READINESS_STATUS_LABEL,
  warneBeimAppAktivieren,
  warneBeimLocalGrid,
} from "@/ezy/data/appRequirements";
import {
  appEnabledFor,
  featureEnabledFor,
  useClientAppAccess,
} from "@/ezy/data/useClientAppAccess";
import { useEzyAgentRuns } from "@/ezy/data/useEzyAgentRuns";
import { useEzyDefaults } from "@/ezy/data/useEzyDefaults";
import { useEzyServiceSettings } from "@/ezy/data/useEzyServiceSettings";
import {
  AlertCircle,
  Bot,
  CheckCircle,
  Clock,
  DollarSign,
  Globe,
  MapPin,
  Megaphone,
  PenTool,
  Plus,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { useRef } from "react";
import { useState, useEffect, useCallback } from "react";
import { useToast } from "./shared-ui";
import { C } from "./theme";
import { appLabel as readinessAppLabel } from "@/ezy/data/appRequirements";
import { supabase } from "@/integrations/supabase/client";
import { Check } from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: CLIENTS
// ═══════════════════════════════════════════════════════════════════════════
// Per-client WordPress connection panel: enter site URL + WP username +
// Application Password, verify against the WP REST API, then store. Shows status.
export function WordPressClientPanel({ client }) {
  const toast = useToast();
  const [status, setStatus] = useState(null); // {connected, siteUrl, username}
  const [loading, setLoading] = useState(true);
  const [siteUrl, setSiteUrl] = useState("");
  const [username, setUsername] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!client?.id) return;
    setLoading(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch(`/api/wordpress/connection?clientId=${encodeURIComponent(client.id)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      });
      const j = await r.json().catch(() => ({}));
      setStatus(j.connected ? j : null);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, [client?.id]);
  useEffect(() => {
    load();
  }, [load]);

  const connect = async () => {
    if (!siteUrl.trim() || !username.trim() || !appPassword.trim()) {
      toast("Bitte URL, Benutzername und Application-Password ausfüllen", "error");
      return;
    }
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/wordpress/connection", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          clientId: client.id,
          siteUrl: siteUrl.trim(),
          username: username.trim(),
          appPassword: appPassword.trim(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        toast(`WordPress verbunden${j.seoPlugin ? ` · SEO: ${j.seoPlugin}` : ""}`, "success");
        window.dispatchEvent(new CustomEvent(READINESS_EVENT));
        setAppPassword("");
        await load();
      } else {
        toast(j.error || "Verbindung fehlgeschlagen", "error");
      }
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!window.confirm("WordPress-Verbindung wirklich trennen?")) return;
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      await fetch("/api/wordpress/connection", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientId: client.id }),
      });
      toast("WordPress getrennt", "success");
      window.dispatchEvent(new CustomEvent(READINESS_EVENT));
      setStatus(null);
      await load();
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };

  const inputStyle = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.bg,
    color: C.text,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
  };

  if (loading) return <div style={{ fontSize: 12, color: C.textDim }}>Lädt…</div>;

  if (status?.connected) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          background: C.bg,
          border: `1px solid ${C.green}44`,
          borderRadius: 10,
          padding: "12px 14px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
          <span style={{ color: C.green, flexShrink: 0 }}>
            <Check size={16} />
          </span>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                color: C.text,
                fontWeight: 600,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {status.siteUrl}
            </div>
            <div style={{ fontSize: 11, color: C.textDim }}>Benutzer: {status.username}</div>
          </div>
        </div>
        <button
          onClick={disconnect}
          disabled={busy}
          style={{
            padding: "6px 12px",
            borderRadius: 8,
            border: `1px solid ${C.border}`,
            background: "transparent",
            color: C.textMuted,
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "inherit",
            flexShrink: 0,
          }}
        >
          Trennen
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        style={inputStyle}
        placeholder="WordPress-URL (z.B. kunde.ch)"
        value={siteUrl}
        onChange={(e) => setSiteUrl(e.target.value)}
      />
      <input
        style={inputStyle}
        placeholder="WP-Benutzername"
        value={username}
        onChange={(e) => setUsername(e.target.value)}
        autoComplete="off"
      />
      <input
        style={inputStyle}
        type="password"
        placeholder="Application Password"
        value={appPassword}
        onChange={(e) => setAppPassword(e.target.value)}
        autoComplete="new-password"
      />
      <div
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
      >
        <a
          href="https://wordpress.org/documentation/article/application-passwords/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: C.accentLight, textDecoration: "none" }}
        >
          Application Password erstellen ↗
        </a>
        <button
          onClick={connect}
          disabled={busy}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: C.accent,
            color: "#fff",
            cursor: busy ? "default" : "pointer",
            fontSize: 13,
            fontWeight: 600,
            fontFamily: "inherit",
          }}
        >
          {busy ? "Verbinde…" : "Verbinden & testen"}
        </button>
      </div>
      <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.5 }}>
        In WordPress unter <strong>Benutzer → Profil → Application Passwords</strong> ein neues
        Passwort erstellen. Erfordert WordPress 5.6+ und HTTPS.
      </div>
    </div>
  );
}

export function OnboardingCard({ client, onUpdated }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(client?.id || ""),
  );
  const steps = [
    {
      ok: !!client?.domain,
      label: "Domain hinterlegt",
      hint: "Basis für Backlinks & Core Web Vitals",
    },
    {
      ok: !!client?.canonryProject,
      label: "Canonry-Projekt (GEO)",
      hint: "AI-Sichtbarkeit ChatGPT/Perplexity/…",
      action: "canonry",
    },
    {
      ok: !!client?.gscSiteUrl,
      label: "Search Console verbunden",
      hint: "Klicks, Impressionen, Position",
    },
    { ok: !!client?.ga4PropertyId, label: "GA4 verbunden", hint: "Sessions, Conversions, Revenue" },
  ];
  const done = steps.filter((s) => s.ok).length;
  const createCanonry = async () => {
    if (!isUuid) return toast("Kunde noch nicht gespeichert", "error");
    setBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch("/api/canonry/create-project", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ clientId: client.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (res.ok && j.ok) {
        toast(`Canonry-Projekt „${j.slug}" ${j.created ? "angelegt" : "aktualisiert"}`, "success");
        onUpdated?.();
      } else toast(j.error || "Canonry-Anlage fehlgeschlagen", "error");
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${done === steps.length ? C.green + "55" : C.border}`,
        borderRadius: 14,
        padding: 18,
        marginBottom: 16,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
          Onboarding / Verbindungen
        </div>
        <div style={{ fontSize: 12, color: done === steps.length ? C.green : C.textMuted }}>
          {done}/{steps.length} eingerichtet
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {steps.map((s, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: s.ok ? C.green : C.textDim, flexShrink: 0 }}>
                {s.ok ? <Check size={16} /> : <Clock size={16} />}
              </span>
              <div>
                <div style={{ fontSize: 13, color: C.text }}>{s.label}</div>
                <div style={{ fontSize: 11, color: C.textDim }}>{s.hint}</div>
              </div>
            </div>
            {s.action === "canonry" && !s.ok && (
              <button
                onClick={createCanonry}
                disabled={busy}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  border: "none",
                  background: C.accent,
                  color: "#fff",
                  cursor: busy ? "default" : "pointer",
                  fontSize: 12,
                  fontFamily: "inherit",
                  flexShrink: 0,
                }}
              >
                {busy ? "…" : "Automatisch anlegen"}
              </button>
            )}
          </div>
        ))}
      </div>
      <div
        id="anker-google-props"
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: `1px solid ${C.border}`,
          borderRadius: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>
          Google: Search Console &amp; GA4 verbinden
        </div>
        <GoogleClientPanel client={client} onSaved={onUpdated} />
      </div>
      <div
        id="anker-wordpress"
        style={{
          marginTop: 14,
          paddingTop: 14,
          borderTop: `1px solid ${C.border}`,
          borderRadius: 10,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600, color: C.textMuted, marginBottom: 8 }}>
          WordPress verbinden (Content veröffentlichen, Beiträge lesen, SEO schreiben)
        </div>
        <WordPressClientPanel client={client} />
      </div>
      <div style={{ fontSize: 11, color: C.textDim, marginTop: 10 }}>
        Semrush ist aktuell nicht verfügbar (API-Units fehlen).
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Onboarding-Wizard (User-Wunsch 2026-07-14): Jeder NEUE Kunde wird in 3
// Schritten angelegt — 1) Kundendaten, 2) Dashboards + Dienste, 3) daraus
// abgeleitete Verbindungen (GSC, GA4, Ads, Canonry, WordPress). Der Kunde wird
// nach Schritt 2 erstellt (Dienste-Seed + Dashboard-Auswahl in defaults),
// Schritt 3 sammelt Properties und verlinkt ins Kunden-Panel fuer OAuth.
// ─────────────────────────────────────────────────────────────────────────────
export const ONBOARD_TABS = [
  // "overview" entfernt (Volkan 10.08.): Übersicht-Tab existiert nicht mehr.
  { id: "seo", label: "SEO", hint: "Rankings, GSC, CWV, Backlinks" },
  { id: "blog", label: "Blog", hint: "Blog-Artikel & Refresh-Radar" },
  { id: "localgrid", label: "Local Grid", hint: "Maps-Heatmap (nur mit Standort/GBP)" },
  { id: "aivis", label: "KI-Sichtbarkeit", hint: "AI-Citations (Canonry)" },
  { id: "conversions", label: "Conversions", hint: "GA4, Kanäle, Umsatz" },
  { id: "ads", label: "Google Ads", hint: "Kampagnen, Autopilot" },
  { id: "runs", label: "Agent-Läufe", hint: "Lauf-Nachweis" },
];

export function onboardingConnections(tabsSet, servicesSet) {
  const why = (arr) => arr.filter(Boolean);
  const out = [];
  if (tabsSet.has("seo") || servicesSet.has("gsc"))
    out.push({
      key: "gsc",
      label: "Google Search Console",
      reason: why([
        tabsSet.has("seo") && "Dashboard SEO",
        servicesSet.has("gsc") && "Dienst Search Console",
      ]),
      action: "Oben „Mit Google verbinden“ klicken und die GSC-Property eintragen.",
      field: "gscSiteUrl",
      placeholder: "sc-domain:example.com",
    });
  if (tabsSet.has("conversions") || servicesSet.has("ga4"))
    out.push({
      key: "ga4",
      label: "Google Analytics 4",
      reason: why([
        tabsSet.has("conversions") && "Dashboard Conversions",
        servicesSet.has("ga4") && "Dienst GA4",
      ]),
      action: "Oben „Mit Google verbinden“ klicken und die GA4-Property-ID eintragen.",
      field: "ga4PropertyId",
      placeholder: "z. B. 123456789",
    });
  if (tabsSet.has("ads") || servicesSet.has("google-ads"))
    out.push({
      key: "google-ads",
      label: "Google Ads",
      reason: why([
        tabsSet.has("ads") && "Dashboard Google Ads",
        servicesSet.has("google-ads") && "Dienst Google Ads",
      ]),
      action:
        "Oben „Mit Google verbinden“ klicken; die Ads-Customer-ID hinterlegst du im Kunden-Panel.",
    });
  if (tabsSet.has("aivis") || servicesSet.has("canonry"))
    out.push({
      key: "canonry",
      label: "Canonry (GEO)",
      reason: why([
        tabsSet.has("aivis") && "Dashboard KI-Sichtbarkeit",
        servicesSet.has("canonry") && "Dienst Canonry",
      ]),
      action: "Wird beim Anlegen automatisch eingerichtet — keine Aktion nötig.",
      auto: true,
    });
  if (servicesSet.has("wordpress"))
    out.push({
      key: "wordpress",
      label: "WordPress",
      reason: ["Dienst WordPress"],
      action: "Site-URL + Application-Password im Kunden-Panel (WordPress) verbinden.",
    });
  if (servicesSet.has("gbp"))
    out.push({
      key: "gbp",
      label: "Google Business Profile",
      reason: ["Dienst GBP"],
      action: "Google-Konto mit Scope business.manage verbinden (Inhaberzugang nötig).",
    });
  if (servicesSet.has("bing"))
    out.push({
      key: "bing",
      label: "Bing Webmaster",
      reason: ["Dienst Bing"],
      action: "Site in Bing Webmaster Tools verifizieren (speist ChatGPT/Copilot).",
    });
  return out;
}

export function OnboardingWizard({
  open,
  onClose,
  effectiveDefaults,
  onCreate,
  onFinished,
  onOpenPanel,
}) {
  const toast = useToast();
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(clientFormFromClient());
  const [tabsSel, setTabsSel] = useState(new Set(DEFAULT_CUSTOMER_DEFAULTS.visibleTabs));
  const [created, setCreated] = useState(null);
  // Google-OAuth direkt im Wizard (User-Wunsch 2026-07-15): sobald der Kunde
  // angelegt ist, kann die Google-Verbindung (GSC/GA4/Ads) hier gestartet
  // werden — gleicher Flow wie im Kunden-Panel (Popup + Status-Poll).
  const [gConn, setGConn] = useState(null); // null=unbekannt, {connected,email}
  const [gBusy, setGBusy] = useState(false);
  // Aus Google geladene Auswahllisten (User-Wunsch 2026-07-15): nach dem
  // Verbinden GSC-Properties + GA4-Properties abrufen, damit sie per Dropdown
  // ausgewaehlt statt manuell eingetippt werden. null=noch nicht geladen.
  const [gRes, setGRes] = useState({ gsc: null, ga4: null });
  const [gResBusy, setGResBusy] = useState(false);
  const [gResErr, setGResErr] = useState("");
  useEffect(() => {
    if (open) {
      setStep(1);
      setBusy(false);
      setDraft(clientFormFromClient());
      setTabsSel(new Set(DEFAULT_CUSTOMER_DEFAULTS.visibleTabs));
      setCreated(null);
      setGConn(null);
      setGBusy(false);
      setGRes({ gsc: null, ga4: null });
      setGResBusy(false);
      setGResErr("");
    }
  }, [open]);
  const loadGoogleConn = async (clientId) => {
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch("/api/google/connection", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ clientId }),
      });
      const j = await r.json().catch(() => null);
      if (r.ok && j) setGConn(j);
    } catch {
      /* Status unbekannt */
    }
  };
  useEffect(() => {
    if (step === 3 && created?.id) loadGoogleConn(created.id);
  }, [step, created?.id]);
  const connectGoogle = async () => {
    if (!created?.id || gBusy) return;
    setGBusy(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const res = await fetch(
        `/api/google/oauth/start?client_id=${encodeURIComponent(created.id)}`,
        {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        },
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.url) throw new Error(json.error || `HTTP ${res.status}`);
      const popup = window.open(json.url, "google-oauth", "width=520,height=640");
      const t = setInterval(async () => {
        if (popup?.closed) {
          clearInterval(t);
          await loadGoogleConn(created.id);
          setGBusy(false);
        }
      }, 800);
    } catch (e) {
      toast(String(e?.message || e), "error");
      setGBusy(false);
    }
  };
  const set = (k) => (v) => setDraft((p) => ({ ...p, [k]: v }));
  const toggleTab = (id) =>
    setTabsSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (next.size === 0) next.add(id); // mindestens ein Dashboard
      return next;
    });
  const connections = onboardingConnections(tabsSel, draft.services || new Set());

  // Laedt die verfuegbaren Google-Ressourcen (GSC-Sites, GA4-Properties) des
  // verbundenen Kontos, damit sie ausgewaehlt statt eingetippt werden koennen.
  const loadGoogleResources = async () => {
    if (!created?.id || gResBusy) return;
    setGResBusy(true);
    setGResErr("");
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const headers = {
        Authorization: `Bearer ${session?.access_token || ""}`,
        "Content-Type": "application/json",
      };
      const body = JSON.stringify({ clientId: created.id });
      const needGsc = connections.some((c) => c.key === "gsc");
      const needGa4 = connections.some((c) => c.key === "ga4");
      const [gsc, ga4] = await Promise.all([
        needGsc
          ? fetch("/api/google/gsc-sites", { method: "POST", headers, body })
              .then((r) => r.json())
              .catch(() => null)
          : Promise.resolve(null),
        needGa4
          ? fetch("/api/google/ga4-properties", { method: "POST", headers, body })
              .then((r) => r.json())
              .catch(() => null)
          : Promise.resolve(null),
      ]);
      setGRes({
        gsc: gsc?.ok ? gsc.sites || [] : needGsc ? [] : null,
        ga4: ga4?.ok ? ga4.properties || [] : needGa4 ? [] : null,
      });
      const errs = [];
      if (needGsc && gsc && !gsc.ok) errs.push(`GSC: ${gsc.error}`);
      if (needGa4 && ga4 && !ga4.ok) errs.push(`GA4: ${ga4.error}`);
      if (errs.length) setGResErr(errs.join(" · "));
    } catch (e) {
      setGResErr(String(e?.message || e));
    } finally {
      setGResBusy(false);
    }
  };
  // Sobald in Schritt 3 verbunden ist, Auswahllisten einmal automatisch laden.
  useEffect(() => {
    if (
      step === 3 &&
      gConn?.connected &&
      created?.id &&
      gRes.gsc === null &&
      gRes.ga4 === null &&
      !gResBusy
    ) {
      void loadGoogleResources();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, gConn?.connected, created?.id]);

  const createClient = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = normalizeClientShape({
        defaults: { ...effectiveDefaults, visibleTabs: [...tabsSel] },
        name: draft.name,
        domain: draft.domain,
        industry: draft.industry,
        status: draft.status,
        contactEmail: draft.contactEmail,
        contactPhone: draft.contactPhone,
        monthlyBudget: Number(draft.monthlyBudget || 0),
        tags: splitCsv(draft.tags),
        targetLocations: splitCsv(draft.targetLocations),
        notes: draft.notes,
        canonryProject: slugifyProjectName(draft.domain),
        brandTerms: splitCsv(draft.brandTerms),
        revenueMode: draft.revenueMode === "clicks" ? "clicks" : "revenue",
      });
      next.services = [...(draft.services || [])];
      const mapped = await onCreate(next);
      if (!mapped?.id) return; // Fehler-Toast kommt aus dem Upsert-Wrapper
      setCreated(mapped);
      setStep(3);
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };

  const finish = async (openPanel) => {
    if (busy) return;
    setBusy(true);
    try {
      const patch = {};
      if (draft.gscSiteUrl.trim()) patch.gscSiteUrl = draft.gscSiteUrl.trim();
      if (draft.ga4PropertyId.trim()) patch.ga4PropertyId = draft.ga4PropertyId.trim();
      let final = created;
      if (created && Object.keys(patch).length)
        final = (await onCreate({ ...created, ...patch })) || created;
      onFinished?.(final);
      if (openPanel && final) onOpenPanel?.(final);
      onClose();
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  };

  const StepDots = () => (
    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16 }}>
      {[1, 2, 3].map((s) => (
        <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              fontWeight: 700,
              background: s === step ? C.accent : s < step ? `${C.green}33` : C.surface,
              color: s === step ? "#fff" : s < step ? C.green : C.textDim,
              border: `1px solid ${s <= step ? "transparent" : C.border}`,
            }}
          >
            {s < step ? "✓" : s}
          </div>
          <span
            style={{
              fontSize: 12,
              color: s === step ? C.text : C.textDim,
              fontWeight: s === step ? 600 : 400,
            }}
          >
            {s === 1 ? "Kundendaten" : s === 2 ? "Dashboards & Dienste" : "Verbindungen"}
          </span>
          {s < 3 && <div style={{ width: 24, height: 1, background: C.border }} />}
        </div>
      ))}
    </div>
  );

  return (
    <Modal open={open} onClose={onClose} title="Neuen Kunden onboarden" width={680}>
      <StepDots />
      {step === 1 && (
        <>
          {/* Verschlankt (Volkan 06.08.): nur die Pflicht-Essentials. E-Mail/
              Telefon/Budget/Standorte/Tags/Brand-Begriffe/Notizen bleiben im
              Kunden-Editor („Bearbeiten") pflegbar; Umsatz-Modus ist fix
              "revenue" (Umsatz-Tracking vollständig, Draft-Default) — keine
              Auswahl mehr beim Onboarding. */}
          <div
            className="ezy-form-grid"
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
          >
            <Inp label="Name" value={draft.name} onChange={set("name")} required />
            <Inp
              label="Domain"
              value={draft.domain}
              onChange={set("domain")}
              placeholder="example.com"
              required
            />
            <Inp label="Branche" value={draft.industry} onChange={set("industry")} />
            <Inp
              label="Status"
              value={draft.status}
              onChange={set("status")}
              options={["active", "paused"]}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <Btn variant="secondary" onClick={onClose}>
              Abbrechen
            </Btn>
            <Btn
              onClick={() => {
                if (!draft.name.trim() || !draft.domain.trim()) {
                  toast("Name und Domain sind erforderlich", "error");
                  return;
                }
                setStep(2);
              }}
            >
              Weiter: Dashboards & Dienste
            </Btn>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>
            Dashboards
          </div>
          <p style={{ fontSize: 11, color: C.textMuted, margin: "0 0 10px" }}>
            Welche Bereiche soll dieser Kunde im Dashboard sehen?
          </p>
          <div
            style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 18 }}
          >
            {ONBOARD_TABS.map((t) => {
              const on = tabsSel.has(t.id);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => toggleTab(t.id)}
                  style={{
                    textAlign: "left",
                    padding: "10px 12px",
                    borderRadius: 10,
                    cursor: "pointer",
                    border: `1px solid ${on ? C.accent : C.border}`,
                    background: on ? C.accentDim : "transparent",
                  }}
                >
                  <div
                    style={{ fontSize: 13, fontWeight: 600, color: on ? C.accentLight : C.text }}
                  >
                    {on ? "☑" : "☐"} {t.label}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim }}>{t.hint}</div>
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: "0 0 6px" }}>
            Dienste
          </div>
          <p style={{ fontSize: 11, color: C.textMuted, margin: "0 0 10px" }}>
            Aktivierte Dienste werden fuer diesen Kunden freigeschaltet (client_integrations).
          </p>
          <ServicesPicker
            C={C}
            value={draft.services}
            onChange={(next) => setDraft((p) => ({ ...p, services: next }))}
          />
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
            <Btn variant="secondary" onClick={() => setStep(1)}>
              Zurück
            </Btn>
            <Btn onClick={createClient} disabled={busy}>
              {busy ? "Wird angelegt…" : "Kunde anlegen & weiter: Verbindungen"}
            </Btn>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <p style={{ fontSize: 12, color: C.textMuted, margin: "0 0 12px" }}>
            Basierend auf deiner Auswahl braucht{" "}
            <strong style={{ color: C.text }}>{created?.name || draft.name}</strong> diese
            Verbindungen. Properties kannst du direkt hier eintragen.
          </p>
          {connections.some((c) => ["gsc", "ga4", "google-ads", "gbp"].includes(c.key)) && (
            <div
              style={{
                border: `1px solid ${gConn?.connected ? C.green : C.accent}`,
                borderRadius: 12,
                padding: "12px 14px",
                background: gConn?.connected ? `${C.green}14` : C.accentDim,
                marginBottom: 12,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                  Google-Konto {gConn?.connected ? "verbunden ✓" : "verbinden"}
                </div>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 2 }}>
                  {gConn?.connected
                    ? `Verbunden${gConn?.email ? ` als ${gConn.email}` : ""} — GSC, GA4 & Ads können jetzt Daten liefern.`
                    : "Eine Verbindung deckt Search Console, Analytics (GA4) und Google Ads gemeinsam ab."}
                </div>
              </div>
              {gConn?.connected ? (
                <Btn variant="secondary" onClick={connectGoogle} disabled={gBusy}>
                  {gBusy ? "Wartet auf Google…" : "Neu verbinden"}
                </Btn>
              ) : (
                <Btn onClick={connectGoogle} disabled={gBusy}>
                  {gBusy ? "Wartet auf Google…" : "Mit Google verbinden"}
                </Btn>
              )}
            </div>
          )}
          {gResErr && (
            <div style={{ fontSize: 12, color: C.red, marginBottom: 10 }}>
              Google-Ressourcen konnten nicht geladen werden: {gResErr}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {connections.length === 0 && (
              <div
                style={{
                  fontSize: 13,
                  color: C.textMuted,
                  padding: 12,
                  background: C.surface,
                  borderRadius: 10,
                }}
              >
                Keine Verbindungen nötig — dieser Kunde nutzt nur globale Dienste.
              </div>
            )}
            {connections.map((c) => (
              <div
                key={c.key}
                style={{
                  border: `1px solid ${C.border}`,
                  borderRadius: 12,
                  padding: "12px 14px",
                  background: C.card,
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{c.label}</span>
                  {c.auto && <Badge color={C.green}>automatisch</Badge>}
                  {c.reason.map((r) => (
                    <Badge key={r} color={C.blue}>
                      {r}
                    </Badge>
                  ))}
                </div>
                <div style={{ fontSize: 12, color: C.textMuted, marginTop: 4 }}>{c.action}</div>
                {c.field &&
                  (() => {
                    const list = c.key === "gsc" ? gRes.gsc : c.key === "ga4" ? gRes.ga4 : null;
                    const hasList = Array.isArray(list) && list.length > 0;
                    const fieldLabel = c.key === "gsc" ? "GSC Property" : "GA4 Property ID";
                    return (
                      <div style={{ marginTop: 8, maxWidth: 440 }}>
                        {gConn?.connected && hasList ? (
                          <label style={{ display: "block" }}>
                            <span style={{ fontSize: 12, color: C.textMuted }}>
                              {fieldLabel} — aus Google wählen
                            </span>
                            <select
                              value={draft[c.field]}
                              onChange={(e) => set(c.field)(e.target.value)}
                              style={{
                                width: "100%",
                                marginTop: 4,
                                background: C.card,
                                color: C.text,
                                border: `1px solid ${C.border}`,
                                borderRadius: 8,
                                padding: "8px 10px",
                                fontSize: 13,
                              }}
                            >
                              <option value="">— auswählen —</option>
                              {list.map((o) => {
                                const val = c.key === "gsc" ? o.url : o.id;
                                const lbl =
                                  c.key === "gsc"
                                    ? o.url
                                    : `${o.account ? `${o.account} · ` : ""}${o.displayName || o.id} (${o.id})`;
                                return (
                                  <option key={val} value={val}>
                                    {lbl}
                                  </option>
                                );
                              })}
                            </select>
                          </label>
                        ) : (
                          <Inp
                            label={fieldLabel}
                            value={draft[c.field]}
                            onChange={set(c.field)}
                            placeholder={c.placeholder}
                          />
                        )}
                        {gConn?.connected && (
                          <div
                            style={{
                              marginTop: 6,
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              flexWrap: "wrap",
                            }}
                          >
                            <button
                              type="button"
                              onClick={loadGoogleResources}
                              disabled={gResBusy}
                              style={{
                                fontSize: 11,
                                color: C.accentLight,
                                background: "none",
                                border: "none",
                                cursor: gResBusy ? "default" : "pointer",
                                padding: 0,
                              }}
                            >
                              {gResBusy
                                ? "Lädt aus Google…"
                                : hasList
                                  ? "↻ Neu aus Google laden"
                                  : "Aus Google laden"}
                            </button>
                            {Array.isArray(list) && list.length === 0 && !gResBusy && (
                              <span style={{ fontSize: 11, color: C.textDim }}>
                                Keine gefunden — manuell eintragen.
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: C.textDim, margin: "12px 0 0" }}>
            DataForSEO & Co. laufen über globale Schlüssel — dafür ist nichts zu tun.
          </p>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 16 }}>
            <Btn variant="secondary" onClick={() => finish(false)} disabled={busy}>
              Später verbinden — fertig
            </Btn>
            <Btn onClick={() => finish(true)} disabled={busy}>
              {busy ? "Speichert…" : "Speichern & Kunden-Panel öffnen"}
            </Btn>
          </div>
        </>
      )}
    </Modal>
  );
}

// Tech-Stack-Erkennung (06.08., DataForSEO Domain Analytics): erkennt CMS/
// Page-Builder/Server/Analytics der Kunden-Website auf Knopfdruck — fuer
// Onboarding (welcher Connector passt?) und Speed-Empfehlungen (LiteSpeed?
// Elementor = Minify-Sperre). Kein Auto-Fetch: kostet erst beim Klick.
export function TechStackCard({ domain }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const detect = async () => {
    setBusy(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch(`/api/admin/tech-detect?domain=${encodeURIComponent(domain)}`, {
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      setData(await r.json().catch(() => ({ ok: false, error: "Antwort ungültig" })));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 14,
        padding: 18,
        marginBottom: 16,
      }}
    >
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: data?.ok ? 10 : 0 }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>Tech-Stack</div>
        <Btn
          variant="secondary"
          size="sm"
          style={{ marginLeft: "auto" }}
          onClick={detect}
          disabled={busy || !domain}
        >
          {busy ? "Erkenne…" : data ? "Neu erkennen" : "Erkennen"}
        </Btn>
      </div>
      {data && !data.ok && (
        <div style={{ fontSize: 12, color: C.textMuted }}>
          Nicht erkennbar: {data.error || "unbekannter Fehler"}
        </div>
      )}
      {data?.ok &&
        ((data.groups || []).length === 0 ? (
          <div style={{ fontSize: 12, color: C.textMuted }}>
            Keine Technologien in der Datenbank für {data.domain}.
          </div>
        ) : (
          (data.groups || []).map((g) => (
            <div key={g.group} style={{ marginBottom: 8 }}>
              <div
                style={{
                  fontSize: 11,
                  color: C.textDim,
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                  marginBottom: 4,
                }}
              >
                {g.group}
              </div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                {g.items.map((t) => (
                  <Badge key={t} color={C.blue}>
                    {t}
                  </Badge>
                ))}
              </div>
            </div>
          ))
        ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-Umbau Teil 2 (06.08.): kundenbezogene Einstellungen im Kunden-Detail —
// Sprache/Tonalität/Report-Template/Tab-Auswahl + Conversion-Werte. Vorher
// unter Einstellungen (nur über den Kunden-Umschalter erreichbar), jetzt direkt
// beim Kunden. Speichern schreibt wie die alte Settings-Seite DOPPELT:
// customer_defaults (Hook, localStorage+DB) UND clients.metadata.defaults —
// Letzteres ist die maßgebliche, geräteübergreifende Quelle des Tab-Filters
// (fix 2026-07-14).
// ─────────────────────────────────────────────────────────────────────────────
export function ClientSettingsPanel({ client, onUpsertClient }) {
  const toast = useToast();
  const defaultsHook = useEzyDefaults(client.id);
  const [draft, setDraft] = useState(defaultsFromStored(defaultsHook.defaults));
  useEffect(() => {
    // Kunden-Datensatz bevorzugen (maßgebliche Quelle), sonst Hook-Stand.
    const fromClient =
      client?.defaults && Object.keys(client.defaults).length ? client.defaults : null;
    setDraft(defaultsFromStored(fromClient || defaultsHook.defaults));
  }, [client.id, client?.defaults, defaultsHook.defaults]);
  const saveAll = async () => {
    const saved = await defaultsHook.save(draft);
    try {
      await onUpsertClient?.({
        ...client,
        defaults: { ...(client.defaults || {}), ...(saved || draft) },
      });
    } catch {
      /* customer_defaults/localStorage haben bereits gespeichert */
    }
    toast(`Einstellungen für ${client.name} gespeichert`, "success");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 10 }}>
          Kunden-Einstellungen
        </div>
        <Inp
          label="Standard-Sprache"
          value={draft.language}
          onChange={(v) => setDraft((p) => ({ ...p, language: v }))}
          options={["Deutsch", "Englisch", "Französisch"]}
        />
        <Inp
          label="Standard-Tonalität"
          value={draft.tone}
          onChange={(v) => setDraft((p) => ({ ...p, tone: v }))}
          options={["Professionell", "Informativ", "Conversational"]}
        />
        <Inp
          label="Report-Template"
          value={draft.reportTemplate}
          onChange={(v) => setDraft((p) => ({ ...p, reportTemplate: v }))}
          options={["Standard", "Detailliert", "Executive Summary"]}
        />
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: C.text, marginBottom: 8 }}>
            Sichtbare Dashboard-Tabs
          </div>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[
              // "overview" entfernt (Volkan 10.08.): Übersicht-Tab existiert nicht mehr.
              { id: "seo", label: "SEO", icon: Globe },
              { id: "blog", label: "Blog", icon: PenTool },
              { id: "localgrid", label: "Local Grid", icon: MapPin },
              { id: "aivis", label: "KI-Sichtbarkeit", icon: Bot },
              { id: "conversions", label: "Conversions", icon: DollarSign },
              { id: "ads", label: "Ads", icon: Megaphone },
            ].map((t) => {
              const on = (
                draft.visibleTabs || ["overview", "seo", "aivis", "conversions", "ads"]
              ).includes(t.id);
              return (
                <label
                  key={t.id}
                  style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const cur = draft.visibleTabs || [
                        "overview",
                        "seo",
                        "aivis",
                        "conversions",
                        "ads",
                      ];
                      const next = on ? cur.filter((x) => x !== t.id) : [...cur, t.id];
                      setDraft((p) => ({ ...p, visibleTabs: next.length > 0 ? next : [t.id] }));
                    }}
                    style={{ accentColor: C.accent }}
                  />
                  <t.icon size={14} style={{ color: C.textMuted }} />
                  <span style={{ fontSize: 13, color: C.text }}>{t.label}</span>
                </label>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: C.textMuted, marginTop: 6 }}>
            Nur ausgewählte Tabs werden im Dashboard dieses Kunden angezeigt.
          </div>
        </div>
        <Btn icon={Save} style={{ marginTop: 14 }} onClick={saveAll}>
          Speichern
        </Btn>
      </div>
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 16px" }}>
        <ConversionValuesPanel client={client} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin-Umbau 06.08.: App-Zugriff & Portal je Kunde. Stufe 1 = App an/aus,
// Stufe 2 = Funktions-Freischaltung (APP_FEATURES), Stufe 3 = Portal-Logins
// (Rolle viewer, fest an diesen Kunden gebunden). Keine DB-Zeile = App aktiv
// mit allen Funktionen (Legacy) — Häkchen materialisieren erst beim Ändern.
// ─────────────────────────────────────────────────────────────────────────────
// ── Einsatzbereitschaft (Admin-Ausbau 17.08.2026) ────────────────────────────
// Zeigt je App, ob der Kunde WIRKLICH einsatzbereit ist (App-Zugriff, Services,
// Integration, letzter Datenlauf, Portalzugang) — serverseitig berechnet
// (/api/admin/client-readiness, nur Owner/Admin), Anforderungen zentral in
// appRequirements.ts. Jede Luecke hat eine konkrete, rollensichere Aktion.
// Gezielte Navigation (21.08.): scrollt zum konkreten Feld (Anker-Id) im
// Kunden-Detail, hebt es kurz hervor und fokussiert den Eingabe-Input.
export function fokusFeld(ankerId) {
  const el = document.getElementById(ankerId);
  if (!el) return false;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  const input = el.querySelector("input, select, button");
  setTimeout(() => input?.focus?.(), 450);
  el.style.transition = "box-shadow .3s";
  el.style.boxShadow = `0 0 0 3px ${C.accent}66`;
  setTimeout(() => {
    el.style.boxShadow = "none";
  }, 2200);
  return true;
}

// Nach jedem Verbindungs-/Property-Speichern feuern die Panels dieses Event —
// die Einsatzbereitschaft berechnet sich dann automatisch neu.
export const READINESS_EVENT = "ezy:readiness-refresh";

export async function fetchReadiness(clientId) {
  const token = (await supabase.auth.getSession()).data.session?.access_token;
  const r = await fetch(`/api/admin/client-readiness?client=${encodeURIComponent(clientId)}`, {
    headers: { Authorization: `Bearer ${token || ""}` },
  });
  return r.json().catch(() => ({ ok: false, error: "Antwort ungültig" }));
}

// Portal-Einladung (21.08.): validierter Dialog statt window.prompt — E-Mail,
// Rolle, Kundenzuweisung und optionale Nachricht; doppelte Einladungen weist
// der Server mit einem verstaendlichen 409 ab.
export function PortalEinladungDialog({ client, onClose, onInvited }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [rolle, setRolle] = useState("viewer");
  const [nachricht, setNachricht] = useState("");
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState("");
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
  const senden = async () => {
    if (!emailOk) {
      setFehler("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }
    setBusy(true);
    setFehler("");
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/admin/team", {
        method: "POST",
        headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "invite",
          email: email.trim(),
          role: rolle,
          clientIds: [client.id],
          ...(nachricht.trim() ? { nachricht: nachricht.trim() } : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) {
        setFehler(String(j.error || `Einladung fehlgeschlagen (HTTP ${r.status})`));
        return;
      }
      toast(`Einladung an ${email.trim()} verschickt`, "success");
      onInvited?.();
    } catch (e) {
      setFehler(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const feld = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.bg,
    color: C.text,
    fontSize: 13,
    fontFamily: "inherit",
    boxSizing: "border-box",
  };
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,10,25,.55)",
        zIndex: 400,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 22,
          width: "min(440px, 100%)",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 15, fontWeight: 700 }}>Portalzugang einladen</div>
        <div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 4 }}>
            E-Mail-Adresse *
          </div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="person@firma.ch"
            style={feld}
            autoFocus
          />
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 4 }}>Rolle</div>
          <select value={rolle} onChange={(e) => setRolle(e.target.value)} style={feld}>
            <option value="viewer">Kunde (Portal, nur zugewiesene Kunden)</option>
            <option value="member">Mitarbeiter (Team, zugewiesene Kunden)</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 4 }}>Kundenzuweisung</div>
          <div
            style={{
              fontSize: 12.5,
              color: C.text,
              background: C.bg,
              border: `1px solid ${C.border}`,
              borderRadius: 8,
              padding: "8px 12px",
            }}
          >
            {client.name} <span style={{ color: C.textDim }}>({client.domain})</span>
          </div>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
            Weitere Kunden lassen sich danach unter App-Zugriff bzw. Team zuweisen.
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11.5, color: C.textMuted, marginBottom: 4 }}>
            Nachricht (optional)
          </div>
          <textarea
            value={nachricht}
            onChange={(e) => setNachricht(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Persönliche Zeile in der Einladungs-Mail…"
            style={{ ...feld, resize: "vertical" }}
          />
        </div>
        {fehler && <div style={{ fontSize: 12.5, color: C.red }}>{fehler}</div>}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Btn variant="secondary" onClick={onClose}>
            Abbrechen
          </Btn>
          <Btn onClick={senden} disabled={busy || !emailOk}>
            {busy ? "Sende…" : "Einladung senden"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export function ClientReadinessPanel({ client, onOpenSettings }) {
  const toast = useToast();
  const caa = useClientAppAccess();
  const svc = useEzyServiceSettings(client.id);
  const [data, setData] = useState(null); // { snapshot, readiness }
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(""); // `${app}:${checkId}` der laufenden Aktion
  const reload = useCallback(async () => {
    const j = await fetchReadiness(client.id);
    if (j?.ok) {
      setData(j);
      setErr("");
    } else setErr(j?.error || "Laden fehlgeschlagen");
  }, [client.id]);
  useEffect(() => {
    setData(null);
    void reload();
  }, [reload]);
  // Nach Speicherungen in den Verbindungs-Panels automatisch neu berechnen.
  useEffect(() => {
    const h = () => void reload();
    window.addEventListener(READINESS_EVENT, h);
    return () => window.removeEventListener(READINESS_EVENT, h);
  }, [reload]);
  const [einladungOffen, setEinladungOffen] = useState(false);
  const [lauf, setLauf] = useState(null); // { jobId, status }
  const laufRef = useRef(false);
  // Async-Datenlauf (21.08.): sofortige jobId, danach Status-Polling — kein
  // minutenlang blockierender Request mehr.
  const pollJob = useCallback(
    async (jobId) => {
      if (laufRef.current) return;
      laufRef.current = true;
      try {
        for (;;) {
          const token = (await supabase.auth.getSession()).data.session?.access_token;
          const r = await fetch(`/api/admin/client-readiness?job=${encodeURIComponent(jobId)}`, {
            headers: { Authorization: `Bearer ${token || ""}` },
          });
          const j = await r.json().catch(() => ({}));
          if (j?.ok) {
            setLauf({ jobId, status: j.job.status, error: j.job.error });
            if (j.job.status === "fertig") {
              toast("Datenlauf abgeschlossen", "success");
              setLauf(null);
              await reload();
              return;
            }
            if (j.job.status === "fehler") {
              toast(`Datenlauf fehlgeschlagen: ${j.job.error || "unbekannt"}`, "error");
              setLauf(null);
              return;
            }
          }
          await new Promise((res) => setTimeout(res, 5000));
        }
      } finally {
        laufRef.current = false;
      }
    },
    [reload, toast],
  );

  const statusColor = (st) =>
    st === "bereit"
      ? C.green
      : st === "unvollstaendig"
        ? C.orange
        : st === "fehler"
          ? C.red
          : C.textDim;

  const connectGoogle = async () => {
    const session = (await supabase.auth.getSession()).data.session;
    const res = await fetch(`/api/google/oauth/start?client_id=${encodeURIComponent(client.id)}`, {
      headers: { Authorization: `Bearer ${session?.access_token || ""}` },
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.url) throw new Error(json.error || `HTTP ${res.status}`);
    const popup = window.open(json.url, "google-oauth", "width=520,height=640");
    await new Promise((resolve) => {
      const t = setInterval(() => {
        if (popup?.closed) {
          clearInterval(t);
          resolve();
        }
      }, 800);
    });
  };

  const doAktion = async (app, check) => {
    const key = `${app}:${check.id}`;
    if (busy) return;
    setBusy(key);
    try {
      switch (check.aktion?.id) {
        case "app_freischalten": {
          const e = await caa.setAccess(client.id, app, { enabled: true });
          if (e) throw new Error(e);
          toast(`${readinessAppLabel(app)} freigeschaltet`, "success");
          break;
        }
        case "service_aktivieren": {
          // Sinnvoller Default je App: ads -> google-ads, geo -> perplexity
          // (DFS-Korpus-Standard seit 06.08.; Canonry bleibt optional zuschaltbar).
          const provider = app === "ads" ? "google-ads" : "perplexity";
          await svc.setEnabled(provider, true);
          toast(`Service ${provider} aktiviert`, "success");
          break;
        }
        case "google_verbinden":
          await connectGoogle();
          break;
        case "property_waehlen": {
          // Gezielt zum konkreten Feld (21.08.): Ads-Kundennummer bzw. GSC/GA4.
          const anker = app === "ads" ? "anker-google-ads" : "anker-google-props";
          if (!fokusFeld(anker)) onOpenSettings?.();
          return;
        }
        case "wordpress_verbinden":
          if (!fokusFeld("anker-wordpress")) onOpenSettings?.();
          return;
        case "portal_einladen":
          // Validierter Dialog statt window.prompt (21.08.).
          setEinladungOffen(true);
          return;
        case "datenlauf_starten": {
          const token = (await supabase.auth.getSession()).data.session?.access_token;
          const r = await fetch("/api/admin/client-readiness", {
            method: "POST",
            headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
            body: JSON.stringify({ action: "datenlauf", client: client.id }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
          setLauf({ jobId: j.jobId, status: j.status });
          toast(
            j.bereitsLaufend
              ? "Für diesen Kunden läuft bereits ein Datenlauf — Fortschritt wird angezeigt."
              : "Datenlauf eingeplant — läuft im Hintergrund (1–4 Minuten).",
            "info",
          );
          void pollJob(j.jobId);
          break;
        }
        default:
          return;
      }
      await reload();
    } catch (e) {
      toast(String(e?.message || e), "error");
    } finally {
      setBusy("");
    }
  };

  if (err) return <div style={{ fontSize: 13, color: C.red }}>{err}</div>;
  if (!data)
    return <div style={{ fontSize: 13, color: C.textMuted }}>Prüfe Einsatzbereitschaft…</div>;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 12, color: C.textMuted, margin: 0, lineHeight: 1.5 }}>
        Serverseitig geprüft: App-Zugriff, Services, Integrationen, Datenläufe und Portalzugang —
        jede Lücke hat eine direkte Aktion.
      </p>
      {lauf && (
        <div
          style={{
            background: C.blueDim,
            border: `1px solid ${C.blue}30`,
            borderRadius: 10,
            padding: "9px 14px",
            fontSize: 12.5,
            color: C.text,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <RefreshCw size={13} color={C.blue} style={{ animation: "spin 1.2s linear infinite" }} />
          Datenlauf läuft im Hintergrund ({lauf.status}) — die Ansicht aktualisiert sich
          automatisch.
        </div>
      )}
      {einladungOffen && (
        <PortalEinladungDialog
          client={client}
          onClose={() => setEinladungOffen(false)}
          onInvited={async () => {
            setEinladungOffen(false);
            await reload();
          }}
        />
      )}
      {data.readiness.map((r) => (
        <div
          key={r.app}
          style={{
            background: C.card,
            border: `1px solid ${C.border}`,
            borderRadius: 12,
            padding: 14,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>{readinessAppLabel(r.app)}</span>
            <span
              style={{
                marginLeft: "auto",
                fontSize: 12,
                fontWeight: 700,
                color: statusColor(r.status),
                background: `${statusColor(r.status)}1a`,
                borderRadius: 99,
                padding: "3px 10px",
              }}
            >
              {READINESS_STATUS_LABEL[r.status] || r.status}
            </span>
          </div>
          {r.checks.map((c) => (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 0",
                borderTop: `1px solid ${C.hairline}`,
                fontSize: 13,
              }}
            >
              <span
                style={{
                  width: 18,
                  textAlign: "center",
                  fontWeight: 800,
                  color: c.ok ? C.green : c.severity === "kritisch" ? C.red : C.orange,
                }}
              >
                {c.ok ? "✓" : c.severity === "kritisch" ? "✕" : "△"}
              </span>
              <span style={{ color: C.text }}>{c.label}</span>
              <span
                style={{
                  color: C.textMuted,
                  fontSize: 12,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {c.detail}
              </span>
              {!c.ok && c.aktion && (
                <button
                  onClick={() => doAktion(r.app, c)}
                  disabled={!!busy}
                  style={{
                    marginLeft: "auto",
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 600,
                    color: C.accent,
                    background: C.accentDim,
                    border: "none",
                    borderRadius: 8,
                    padding: "5px 10px",
                    cursor: busy ? "default" : "pointer",
                    fontFamily: "inherit",
                    opacity: busy && busy !== `${r.app}:${c.id}` ? 0.5 : 1,
                  }}
                >
                  {busy === `${r.app}:${c.id}` ? "läuft…" : c.aktion.label}
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// Aenderungsprotokoll des Kunden (admin_audit_log via DB-Trigger; nur Whitelist-
// Felder — keine Secrets). Lesezugriff ausschliesslich Owner/Admin.
export function ClientAuditLogPanel({ client }) {
  const [entries, setEntries] = useState(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let alive = true;
    (async () => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch(
        `/api/admin/audit-log?client=${encodeURIComponent(client.id)}&limit=80`,
        {
          headers: { Authorization: `Bearer ${token || ""}` },
        },
      );
      const j = await r.json().catch(() => ({}));
      if (!alive) return;
      if (j?.ok) setEntries(j.entries);
      else setErr(j?.error || "Laden fehlgeschlagen");
    })();
    return () => {
      alive = false;
    };
  }, [client.id]);

  const diffText = (e) => {
    const o = e.old_value || {},
      n = e.new_value || {};
    const keys = [...new Set([...Object.keys(o), ...Object.keys(n)])];
    const parts = [];
    for (const k of keys) {
      const ov = JSON.stringify(o[k] ?? null),
        nv = JSON.stringify(n[k] ?? null);
      if (e.action === "update" && ov === nv) continue;
      parts.push(
        e.action === "update" ? `${k}: ${ov} → ${nv}` : `${k}: ${nv !== "null" ? nv : ov}`,
      );
    }
    return parts.join(" · ") || "—";
  };

  if (err) return <div style={{ fontSize: 13, color: C.red }}>{err}</div>;
  if (!entries) return <div style={{ fontSize: 13, color: C.textMuted }}>Lade Protokoll…</div>;
  if (!entries.length)
    return (
      <div style={{ fontSize: 13, color: C.textMuted }}>
        Noch keine protokollierten Änderungen — das Protokoll läuft seit dem 17.08.2026.
      </div>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {entries.map((e) => (
        <div
          key={e.id}
          style={{ padding: "9px 0", borderBottom: `1px solid ${C.hairline}`, fontSize: 12.5 }}
        >
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ color: C.textMuted, fontVariantNumeric: "tabular-nums" }}>
              {new Date(e.at).toLocaleString("de-CH", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
            <Badge color={C.accent}>{e.bereich}</Badge>
            <span style={{ color: C.textMuted }}>
              {e.action === "insert" ? "angelegt" : e.action === "delete" ? "entfernt" : "geändert"}
            </span>
            <span style={{ color: C.textDim, fontSize: 11.5, marginLeft: "auto" }}>
              {e.userEmail || "System/Automation"}
            </span>
          </div>
          <div style={{ color: C.text, marginTop: 3, wordBreak: "break-word" }}>{diffText(e)}</div>
        </div>
      ))}
    </div>
  );
}

export function ClientAppAccessPanel({ client }) {
  const toast = useToast();
  const caa = useClientAppAccess();
  const apps = EZY_APPS.filter((a) => !a.adminOnly && !a.internalOnly);
  const catalogOf = (appId) => APP_FEATURES[appId] || [];
  const entryOf = (appId) => caa.map.get(client.id)?.get(appId) || null;

  const toggleApp = async (appId) => {
    const enabled = appEnabledFor(caa.map, client.id, appId);
    // Konfigurationsvalidierung (17.08.): App aktivieren, obwohl kritische
    // Voraussetzungen fehlen -> verstaendliche Warnung statt stiller Widerspruch.
    if (!enabled) {
      try {
        const j = await fetchReadiness(client.id);
        const warnungen = j?.ok ? warneBeimAppAktivieren(appId, j.snapshot) : [];
        if (warnungen.length) {
          const text = `Für ${readinessAppLabel(appId)} fehlen Voraussetzungen:\n\n${warnungen
            .map((w) => `• ${w.text}`)
            .join(
              "\n",
            )}\n\nDie App erscheint sonst leer bzw. der Kunde taucht dort nicht auf. Trotzdem freischalten?`;
          if (!window.confirm(text)) return;
        }
      } catch {
        /* Validierung best effort — Freischalten nicht blockieren */
      }
    }
    const err = await caa.setAccess(client.id, appId, { enabled: !enabled });
    if (err) toast(err, "error");
  };
  const toggleFeature = async (appId, featureId) => {
    const cat = catalogOf(appId).map((f) => f.id);
    const e = entryOf(appId);
    // [] = alle Funktionen → beim ersten Abwählen die volle Liste materialisieren.
    const current = e && e.features.length ? e.features : cat;
    const next = current.includes(featureId)
      ? current.filter((f) => f !== featureId)
      : [...current, featureId];
    // Local Grid braucht einen Standort (GBP) — vor dem Aktivieren pruefen.
    if (featureId === "localgrid" && next.includes("localgrid") && !current.includes("localgrid")) {
      try {
        const j = await fetchReadiness(client.id);
        const warnungen = j?.ok ? warneBeimLocalGrid(j.snapshot) : [];
        if (warnungen.length && !window.confirm(`${warnungen[0].text}\n\nTrotzdem aktivieren?`))
          return;
      } catch {
        /* best effort */
      }
    }
    const err = await caa.setAccess(client.id, appId, { features: next });
    if (err) toast(err, "error");
  };

  // Portal-Logins (Rolle viewer) dieses Kunden über die Team-API.
  const [portalUsers, setPortalUsers] = useState(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const callTeam = useCallback(async (body) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const r = await fetch("/api/admin/team", {
      method: "POST",
      headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json().catch(() => ({ error: "Antwort ungültig" }));
  }, []);
  const loadPortal = useCallback(async () => {
    const j = await callTeam({ action: "list" });
    if (j.ok)
      setPortalUsers(
        (j.users || []).filter(
          (u) => u.role === "viewer" && (u.clientIds || []).includes(client.id),
        ),
      );
  }, [callTeam, client.id]);
  useEffect(() => {
    void loadPortal();
  }, [loadPortal]);
  const invitePortal = async () => {
    if (!inviteEmail.trim()) return;
    setBusy(true);
    const j = await callTeam({
      action: "invite",
      email: inviteEmail.trim(),
      role: "viewer",
      clientIds: [client.id],
    });
    setBusy(false);
    if (j.ok) {
      toast(`Portal-Einladung an ${inviteEmail} gesendet`, "success");
      setInviteEmail("");
      await loadPortal();
    } else toast(j.error || "Einladung fehlgeschlagen", "error");
  };
  const removePortal = async (u) => {
    if (!window.confirm(`Portal-Zugang von ${u.email || "Nutzer"} entfernen?`)) return;
    const j = await callTeam({ action: "remove", userId: u.userId });
    if (j.ok) {
      toast("Portal-Zugang entfernt", "success");
      await loadPortal();
    } else toast(j.error || "Fehlgeschlagen", "error");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {caa.legacy && (
        <div
          style={{
            fontSize: 12,
            color: C.orange,
            border: `1px solid ${C.orange}44`,
            background: `${C.orange}11`,
            borderRadius: 10,
            padding: "8px 12px",
          }}
        >
          Die Datenbank-Migration <code>client_app_portal</code> ist noch nicht angewendet —
          Freischaltungen können noch nicht gespeichert werden (aktuell gilt: alle Apps/Funktionen
          aktiv).
        </div>
      )}
      {apps.map((a) => {
        const enabled = appEnabledFor(caa.map, client.id, a.id);
        const cat = catalogOf(a.id);
        return (
          <div
            key={a.id}
            style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15 }}>{a.icon}</span>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: C.text }}>{a.name}</span>
              {!cat.length && <Badge color={C.textDim}>nur intern</Badge>}
              <button
                type="button"
                onClick={() => toggleApp(a.id)}
                disabled={caa.legacy}
                title={
                  enabled
                    ? "App für diesen Kunden deaktivieren"
                    : "App für diesen Kunden aktivieren"
                }
                style={{
                  marginLeft: "auto",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "4px 12px",
                  borderRadius: 99,
                  cursor: caa.legacy ? "default" : "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                  border: `1px solid ${enabled ? a.color : C.border}`,
                  background: enabled ? a.tint : "transparent",
                  color: enabled ? a.color : C.textDim,
                }}
              >
                {enabled ? "aktiv" : "inaktiv"}
              </button>
            </div>
            {enabled && cat.length > 0 && (
              <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                {cat.map((f) => {
                  const on = featureEnabledFor(caa.map, client.id, a.id, f.id);
                  return (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => toggleFeature(a.id, f.id)}
                      disabled={caa.legacy}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 5,
                        padding: "4px 10px",
                        borderRadius: 99,
                        cursor: caa.legacy ? "default" : "pointer",
                        fontSize: 11.5,
                        border: `1px solid ${on ? C.accent : C.border}`,
                        background: on ? C.accentDim : "transparent",
                        color: on ? C.accentLight : C.textDim,
                      }}
                    >
                      {on ? "☑" : "☐"} {f.label}
                    </button>
                  );
                })}
                {!entryOf(a.id)?.features?.length && (
                  <span style={{ fontSize: 11, color: C.textDim, alignSelf: "center" }}>
                    alle Funktionen (Standard)
                  </span>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Portal-Zugänge (Kunden-Logins, Rolle viewer) */}
      <div style={{ border: `1px solid ${C.border}`, borderRadius: 12, padding: "12px 14px" }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 8 }}>
          Portal-Zugänge
        </div>
        <p style={{ fontSize: 11.5, color: C.textMuted, margin: "0 0 10px" }}>
          Kunden-Logins sehen ausschließlich die oben freigeschalteten Funktionen dieses Kunden —
          read-only, ohne Agenten, Einstellungen oder interne Notizen.
        </p>
        {portalUsers === null ? (
          <div style={{ fontSize: 12, color: C.textMuted }}>Lädt…</div>
        ) : portalUsers.length === 0 ? (
          <div style={{ fontSize: 12, color: C.textDim, marginBottom: 8 }}>
            Noch keine Portal-Zugänge.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
            {portalUsers.map((u) => (
              <div key={u.userId} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Badge color={C.green}>aktiv</Badge>
                <span style={{ fontSize: 12.5, color: C.text }}>
                  {u.email || u.userId.slice(0, 8)}
                </span>
                <Btn
                  variant="danger"
                  size="sm"
                  style={{ marginLeft: "auto" }}
                  onClick={() => removePortal(u)}
                >
                  Sperren
                </Btn>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
          <div style={{ flex: 1 }}>
            <Inp
              label="E-Mail"
              value={inviteEmail}
              onChange={setInviteEmail}
              placeholder="kunde@firma.ch"
            />
          </div>
          <Btn size="sm" onClick={invitePortal} disabled={busy || !inviteEmail.trim()}>
            {busy ? "…" : "Kunden-Login einladen"}
          </Btn>
        </div>
      </div>
    </div>
  );
}

// Zugriffs-Matrix (Admin-Umbau 06.08.): Kunden × Apps auf einen Blick.
// Zelle klicken = App an/aus; Kunde aufklappen = Funktions-Details + Portal.
export function MatrixPage({ clients }) {
  const toast = useToast();
  const caa = useClientAppAccess();
  const [expanded, setExpanded] = useState(null); // clientId
  const apps = EZY_APPS.filter((a) => !a.adminOnly && !a.internalOnly);
  const toggle = async (clientId, appId) => {
    const err = await caa.setAccess(clientId, appId, {
      enabled: !appEnabledFor(caa.map, clientId, appId),
    });
    if (err) toast(err, "error");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Zugriffs-Matrix</h2>
        <p style={{ fontSize: 12, color: C.textMuted, margin: "4px 0 0" }}>
          Welcher Kunde erscheint in welcher App — Änderungen gelten sofort. Kunde aufklappen für
          Funktions-Freischaltung und Portal-Zugänge.
        </p>
      </div>
      {caa.legacy && (
        <div
          style={{
            fontSize: 12,
            color: C.orange,
            border: `1px solid ${C.orange}44`,
            background: `${C.orange}11`,
            borderRadius: 10,
            padding: "8px 12px",
          }}
        >
          Migration <code>client_app_portal</code> noch nicht angewendet — die Matrix ist read-only
          (alle Apps gelten als aktiv).
        </div>
      )}
      {/* Redesign 1b (Screen 3e): Full-Bleed-Tabelle, App-farbige Kopfzeile,
        Pill-Schalter statt Häkchen-Kacheln. */}
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: C.rCard,
          boxShadow: C.cardShadow,
          overflow: "hidden",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 560 }}>
            <thead>
              <tr style={{ background: "rgba(43,0,51,.025)" }}>
                <th
                  style={{
                    textAlign: "left",
                    fontSize: 11,
                    color: C.textDim,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: ".06em",
                    padding: "12px 18px",
                    borderBottom: `1px solid ${C.border}`,
                  }}
                >
                  Kunde
                </th>
                {apps.map((a) => (
                  <th
                    key={a.id}
                    style={{
                      fontSize: 11,
                      color: a.color,
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: ".06em",
                      padding: "12px 10px",
                      whiteSpace: "nowrap",
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    {a.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <Fragment key={c.id}>
                  <tr>
                    <td style={{ padding: "13px 18px", borderBottom: `1px solid ${C.hairline}` }}>
                      <button
                        type="button"
                        onClick={() => setExpanded(expanded === c.id ? null : c.id)}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          background: "none",
                          border: "none",
                          cursor: "pointer",
                          color: C.text,
                          fontSize: 13,
                          fontWeight: 600,
                          padding: 0,
                          fontFamily: "inherit",
                        }}
                      >
                        <span style={{ width: 12 }}>{expanded === c.id ? "▾" : "▸"}</span>
                        <ClientAvatar
                          name={c.name}
                          domain={c.domain}
                          size={22}
                          radius={6}
                          bg={C.accentDim}
                          fg={C.accentLight}
                          fontSize={9}
                        />
                        {c.name}
                      </button>
                    </td>
                    {apps.map((a) => {
                      const on = appEnabledFor(caa.map, c.id, a.id);
                      return (
                        <td
                          key={a.id}
                          style={{
                            textAlign: "center",
                            padding: "13px 10px",
                            borderBottom: `1px solid ${C.hairline}`,
                          }}
                        >
                          {/* Pill-Schalter (Hi-Fi 7) in App-Farbe */}
                          <button
                            type="button"
                            onClick={() => toggle(c.id, a.id)}
                            disabled={caa.legacy}
                            title={`${a.name} für ${c.name} ${on ? "deaktivieren" : "aktivieren"}`}
                            style={{
                              width: 38,
                              height: 22,
                              borderRadius: C.rPill,
                              border: "none",
                              cursor: caa.legacy ? "default" : "pointer",
                              background: on ? a.color : "rgba(43,0,51,.12)",
                              position: "relative",
                              transition: "background .15s",
                              padding: 0,
                              verticalAlign: "middle",
                            }}
                          >
                            <span
                              style={{
                                position: "absolute",
                                top: 2,
                                left: on ? 18 : 2,
                                width: 18,
                                height: 18,
                                borderRadius: "50%",
                                background: "#fff",
                                boxShadow: "0 1px 3px rgba(0,0,0,.25)",
                                transition: "left .15s",
                              }}
                            />
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                  {expanded === c.id && (
                    <tr>
                      <td colSpan={apps.length + 1} style={{ padding: "4px 18px 14px" }}>
                        <ClientAppAccessPanel client={c} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p style={{ fontSize: 11.5, color: C.textDim, margin: 0 }}>
        Mitarbeiter-Rechte verwaltest du auf der Team-Seite; Portal-Freigaben laufen über
        App-Zugriff im Kunden-Detail.
      </p>
    </div>
  );
}

export function ClientsPage({
  clients,
  selectedClientId,
  onSelectClient,
  onUpsertClient,
  onDeleteClient,
  onReload,
  customerDefaults = DEFAULT_CUSTOMER_DEFAULTS,
}) {
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [sf, setSf] = useState("all");
  const [detailId, setDetailId] = useState(null);
  // Deep-Link (18.08.): /admin?client=<uuid> oeffnet das Kundendetail direkt in
  // der Bereitschafts-Ansicht — genutzt von der Analyse-Lead-Uebernahme.
  useEffect(() => {
    try {
      const cid = new URLSearchParams(window.location.search).get("client");
      if (cid && /^[0-9a-f-]{36}$/i.test(cid)) {
        setDetailId(cid);
        setDt("readiness");
        window.history.replaceState(null, "", window.location.pathname);
      }
    } catch {
      /* egal */
    }
  }, []);
  const [dt, setDt] = useState("overview");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorMode, setEditorMode] = useState("create");
  const [draft, setDraft] = useState(clientFormFromClient());
  const detail = clients.find((c) => c.id === detailId) || null;
  const effectiveDefaults = defaultsFromStored(customerDefaults);
  useEffect(() => {
    if (detailId && !clients.some((c) => c.id === detailId)) setDetailId(null);
  }, [clients, detailId]);
  // Kundenuebersicht-Readiness (21.08.): ein Batch-Call fuer alle Kunden.
  const [readyAll, setReadyAll] = useState(null); // Map id -> {status, luecke}
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch("/api/admin/client-readiness?all=1", {
          headers: { Authorization: `Bearer ${token || ""}` },
        });
        const j = await r.json().catch(() => null);
        if (alive && j?.ok) {
          const m = {};
          for (const k of j.kunden || []) m[k.id] = { status: k.status, luecke: k.luecke };
          setReadyAll(m);
        }
      } catch {
        /* Readiness ist Zusatzinfo — Liste funktioniert auch ohne */
      }
    })();
    return () => {
      alive = false;
    };
  }, [clients.length]);
  const READY_FILTER = ["bereit", "unvollstaendig", "fehler", "deaktiviert"];
  const fl = clients.filter(
    (c) =>
      (sf === "all" ||
        (READY_FILTER.includes(sf) ? (readyAll?.[c.id]?.status || "") === sf : c.status === sf)) &&
      (c.name.toLowerCase().includes(search.toLowerCase()) || c.domain.includes(search)),
  );
  const [wizardOpen, setWizardOpen] = useState(false);
  // Neuanlage laeuft seit 2026-07-14 ueber den 3-Schritte-Onboarding-Wizard;
  // der klassische Editor bleibt fuer "Bearbeiten" bestehen.
  const openCreate = () => setWizardOpen(true);
  const openEdit = (client) => {
    setEditorMode("edit");
    setDraft(clientFormFromClient(client));
    setEditorOpen(true);
  };
  const saveClient = () => {
    if (!draft.name.trim() || !draft.domain.trim()) {
      toast("Name und Domain sind erforderlich", "error");
      return;
    }
    const existing = editorMode === "edit" && detail ? detail : null;
    const next = normalizeClientShape({
      ...existing,
      defaults: existing?.defaults || effectiveDefaults,
      name: draft.name,
      domain: draft.domain,
      industry: draft.industry,
      status: draft.status,
      contactEmail: draft.contactEmail,
      contactPhone: draft.contactPhone,
      monthlyBudget: Number(draft.monthlyBudget || 0),
      tags: splitCsv(draft.tags),
      targetLocations: splitCsv(draft.targetLocations),
      notes: draft.notes,
      gscSiteUrl: draft.gscSiteUrl,
      ga4PropertyId: draft.ga4PropertyId,
      ga4MeasurementId: draft.ga4MeasurementId,
      canonryProject: draft.canonryProject || slugifyProjectName(draft.domain),
      brandTerms: splitCsv(draft.brandTerms),
      revenueMode: draft.revenueMode === "clicks" ? "clicks" : "revenue",
    });
    // Beim Anlegen die gewaehlten Dienste mitgeben (transient -> client_integrations-Seed).
    if (editorMode === "create") next.services = [...(draft.services || [])];
    onUpsertClient(next);
    onSelectClient?.(next);
    setDetailId(next.id);
    setDt("overview");
    setEditorOpen(false);
    toast(editorMode === "create" ? "Kunde erstellt" : "Kunde gespeichert", "success");
  };
  const removeClient = () => {
    if (!detail) return;
    if (clients.length <= 1) {
      toast("Mindestens ein Kunde muss bestehen bleiben", "error");
      return;
    }
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Kunde "${detail.name}" wirklich löschen?`)
    )
      return;
    onDeleteClient(detail.id);
    setDetailId(null);
    toast("Kunde entfernt", "success");
  };
  const detailDefaults = defaultsFromStored(detail?.defaults ?? effectiveDefaults);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>Clients</h1>
          <p style={{ color: C.textMuted, fontSize: 13, margin: "4px 0 0" }}>
            {clients.length} Kunden
          </p>
        </div>
        <Btn icon={Plus} onClick={openCreate}>
          Neuer Kunde
        </Btn>
      </div>
      <div className="client-toolbar" style={{ display: "flex", gap: 12 }}>
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
            { id: "active", label: "Aktiv" },
            { id: "paused", label: "Pausiert" },
            // Einsatzbereitschafts-Filter (21.08.)
            { id: "bereit", label: "Bereit" },
            { id: "unvollstaendig", label: "Unvollständig" },
            { id: "fehler", label: "Fehler" },
            { id: "deaktiviert", label: "Deaktiviert" },
          ]}
          active={sf}
          onChange={setSf}
        />
      </div>
      <div
        className="client-grid"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))",
          gap: 14,
        }}
      >
        {fl.map((c) => (
          <div
            key={c.id}
            onClick={() => {
              setDetailId(c.id);
              setDt("overview");
            }}
            style={{
              background: C.card,
              border: `1px solid ${c.id === selectedClientId ? C.accent : C.border}`,
              borderRadius: 14,
              padding: "20px 22px",
              cursor: "pointer",
              transition: "border-color .2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = C.borderHover)}
            onMouseLeave={(e) =>
              (e.currentTarget.style.borderColor = c.id === selectedClientId ? C.accent : C.border)
            }
          >
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14 }}>
              <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                {/* Favicon der Kundendomain, Fallback auf Initialen (Volkan 13.08.). */}
                <ClientAvatar
                  name={c.name}
                  domain={c.domain}
                  size={42}
                  radius={10}
                  bg={C.accentDim}
                  fg={C.accentLight}
                  fontSize={16}
                />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: C.text }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>{c.domain}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {c.id === selectedClientId && <Badge color={C.accent}>Aktiv</Badge>}
                <Badge color={c.status === "active" ? C.green : C.textMuted}>
                  {c.status === "active" ? "Aktiv" : "Pausiert"}
                </Badge>
                {readyAll?.[c.id] && (
                  <Badge
                    color={
                      readyAll[c.id].status === "bereit"
                        ? C.green
                        : readyAll[c.id].status === "unvollstaendig"
                          ? C.orange
                          : readyAll[c.id].status === "fehler"
                            ? C.red
                            : C.textDim
                    }
                  >
                    {READINESS_STATUS_LABEL[readyAll[c.id].status] || readyAll[c.id].status}
                  </Badge>
                )}
              </div>
            </div>
            {readyAll?.[c.id]?.luecke && readyAll[c.id].status !== "bereit" && (
              <div
                style={{
                  fontSize: 11.5,
                  color: readyAll[c.id].status === "fehler" ? C.red : C.orange,
                  margin: "-6px 0 10px",
                }}
              >
                Wichtigste Lücke: {readyAll[c.id].luecke}
              </div>
            )}
            <div style={{ display: "flex", gap: 5, marginBottom: 14, flexWrap: "wrap" }}>
              <Badge color={C.textDim}>{c.industry || "—"}</Badge>
              {c.tags.map((t) => (
                <Badge key={t} color={C.blue}>
                  {t}
                </Badge>
              ))}
            </div>
            {/* Score/Keywords/Budget-Kacheln entfernt (2026-07-14): waren statische
                metadata-Platzhalter (ueberall 0) — die echten Zahlen zeigt das
                Dashboard aus audit_runs. Budget bleibt im Detail/Editor pflegbar. */}
          </div>
        ))}
      </div>
      {detail && (
        <div
          className="client-drawer"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            width: "min(560px,100vw)",
            background: C.surface,
            borderLeft: `1px solid ${C.border}`,
            boxShadow: "-24px 0 60px -36px rgba(43,0,51,.35)",
            zIndex: 100,
            overflowY: "auto",
            animation: "slideIn .2s ease",
          }}
        >
          {/* Redesign 1b (Screen 4k): 48er-Avatar-Kachel + grosser Name + Meta-Zeile */}
          <div
            style={{
              padding: "20px 24px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              {/* Favicon der Kundendomain, Fallback auf Initialen (Volkan 13.08.). */}
              <ClientAvatar
                name={detail.name}
                domain={detail.domain}
                size={48}
                radius={14}
                bg={C.accentDim}
                fg={C.accent}
                fontSize={16}
              />
              <div>
                <div
                  style={{
                    fontWeight: 700,
                    fontSize: 19,
                    letterSpacing: "-.02em",
                    color: C.text,
                    fontFamily: "'Kamerik 105',Poppins,sans-serif",
                  }}
                >
                  {detail.name}
                </div>
                <div style={{ fontSize: 12.5, color: C.textMuted, marginTop: 2 }}>
                  {[detail.domain, detail.industry].filter(Boolean).join(" · ")}
                </div>
              </div>
            </div>
            <button
              onClick={() => setDetailId(null)}
              style={{
                background: "none",
                border: "none",
                color: C.textMuted,
                cursor: "pointer",
                fontSize: 18,
              }}
            >
              ✕
            </button>
          </div>
          <div
            style={{
              padding: "14px 22px",
              borderBottom: `1px solid ${C.border}`,
              display: "flex",
              justifyContent: "space-between",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <TabBar
              tabs={[
                { id: "overview", label: "Übersicht" },
                // Admin-Ausbau 17.08.: Einsatzbereitschaft + Änderungsprotokoll.
                { id: "readiness", label: "Bereitschaft" },
                { id: "kpis", label: "KPIs" },
                { id: "notes", label: "Notizen" },
                // Admin-Umbau 06.08.: Lauf-Nachweis + App-/Portal-Freischaltung
                // + Kunden-Einstellungen leben jetzt beim Kunden (statt eigenem
                // Admin-Dashboard bzw. Einstellungen-mit-Kunden-Umschalter).
                { id: "runs", label: "Agent-Läufe" },
                { id: "access", label: "App-Zugriff" },
                { id: "log", label: "Protokoll" },
                { id: "settings", label: "Einstellungen" },
              ]}
              active={dt}
              onChange={setDt}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <Btn variant="secondary" size="sm" onClick={() => onSelectClient?.(detail)}>
                Als aktiven Kunden wählen
              </Btn>
              <Btn variant="secondary" size="sm" icon={PenTool} onClick={() => openEdit(detail)}>
                Bearbeiten
              </Btn>
              <Btn variant="danger" size="sm" icon={X} onClick={removeClient}>
                Löschen
              </Btn>
            </div>
          </div>
          <div style={{ padding: "18px 22px" }}>
            <OnboardingCard client={detail} onUpdated={onReload} />
            <TechStackCard domain={detail.domain} />
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 18,
                marginBottom: 16,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, margin: "0 0 12px" }}>
                Integrationen / Dienste
              </div>
              <ServicesPanel C={C} clientId={detail.id} />
            </div>
            {dt === "overview" && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[
                  ["Branche", detail.industry || "—"],
                  ["Status", detail.status],
                  ["E-Mail", detail.contactEmail || "—"],
                  ["Telefon", detail.contactPhone || "—"],
                  ["Budget", `CHF ${detail.monthlyBudget.toLocaleString("de-CH")}/Mt`],
                  ["Standorte", detail.targetLocations?.join(", ") || "—"],
                  ["Report-Sprache", detailDefaults.language],
                  ["Tonalität", detailDefaults.tone],
                  ["Report-Template", detailDefaults.reportTemplate],
                  ["GSC Property", detail.gscSiteUrl || "—"],
                  ["GA4 Property", ga4PropertyText(detail)],
                  detail.ga4MeasurementId ? ["GA4 Measurement ID", detail.ga4MeasurementId] : null,
                  ["Canonry Projekt", detail.canonryProject || "—"],
                  ["Start", detail.startDate || "—"],
                ]
                  .filter(Boolean)
                  .map(([l, v]) => (
                    <div
                      key={l}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "8px 0",
                        borderBottom: `1px solid ${C.hairline}`,
                      }}
                    >
                      <span style={{ fontSize: 12, color: C.textMuted }}>{l}</span>
                      <span
                        style={{
                          fontSize: 13,
                          color: C.text,
                          fontWeight: 500,
                          textAlign: "right",
                          wordBreak: "break-word",
                        }}
                      >
                        {v}
                      </span>
                    </div>
                  ))}
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 4 }}>Tags</div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
                    {detail.tags.length ? (
                      detail.tags.map((t) => (
                        <Badge key={t} color={C.blue}>
                          {t}
                        </Badge>
                      ))
                    ) : (
                      <Badge color={C.textDim}>Keine Tags</Badge>
                    )}
                  </div>
                </div>
              </div>
            )}
            {dt === "readiness" && (
              <ClientReadinessPanel client={detail} onOpenSettings={() => setDt("settings")} />
            )}
            {dt === "log" && <ClientAuditLogPanel client={detail} />}
            {dt === "runs" && <AgentRunsPanel selectedClient={detail} />}
            {dt === "access" && <ClientAppAccessPanel client={detail} />}
            {dt === "settings" && (
              <ClientSettingsPanel client={detail} onUpsertClient={onUpsertClient} />
            )}
            {dt === "kpis" &&
              (() => {
                const hasData =
                  (detail.score || 0) +
                    (detail.keywords || 0) +
                    (detail.traffic || 0) +
                    (detail.aiVisitors || 0) +
                    (detail.revenue || 0) >
                  0;
                if (!hasData) {
                  return (
                    <div
                      style={{
                        background: C.card,
                        borderRadius: 10,
                        padding: 20,
                        textAlign: "center",
                        fontSize: 13,
                        color: C.textMuted,
                      }}
                    >
                      Noch keine Live-Daten — verbinde GSC/GA4 oder starte einen Audit-Lauf.
                    </div>
                  );
                }
                return (
                  <div
                    className="kpi-grid"
                    style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}
                  >
                    {[
                      [detail.score, detail.score >= 70 ? C.green : C.orange, "SEO Score"],
                      [detail.keywords.toLocaleString("de-CH"), C.text, "Keywords"],
                      [detail.traffic.toLocaleString("de-CH"), C.accent, "Traffic"],
                      [detail.aiVisitors.toLocaleString("de-CH"), C.green, "AI Visitors"],
                    ].map(([v, co, l], i) => (
                      <div
                        key={i}
                        style={{
                          background: C.card,
                          borderRadius: 10,
                          padding: 14,
                          textAlign: "center",
                        }}
                      >
                        <div style={{ fontSize: 24, fontWeight: 800, color: co }}>{v}</div>
                        <div style={{ fontSize: 11, color: C.textMuted }}>{l}</div>
                      </div>
                    ))}
                    <div
                      style={{
                        background: C.card,
                        borderRadius: 10,
                        padding: 14,
                        textAlign: "center",
                        gridColumn: "1/3",
                      }}
                    >
                      <div style={{ fontSize: 24, fontWeight: 800, color: C.text }}>
                        CHF {detail.revenue.toLocaleString("de-CH")}
                      </div>
                      <div style={{ fontSize: 11, color: C.textMuted }}>Revenue (30d)</div>
                    </div>
                  </div>
                );
              })()}
            {dt === "notes" && (
              <div
                style={{
                  background: C.card,
                  borderRadius: 10,
                  padding: 14,
                  fontSize: 13,
                  color: C.text,
                  lineHeight: 1.6,
                }}
              >
                {detail.notes || "Noch keine Notizen hinterlegt."}
              </div>
            )}
          </div>
        </div>
      )}
      <OnboardingWizard
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        effectiveDefaults={effectiveDefaults}
        onCreate={onUpsertClient}
        onFinished={(c) => {
          if (!c) return;
          onSelectClient?.(c);
          setDetailId(c.id);
          // Onboarding-Abschluss (17.08.): direkt zeigen, welche Apps bereit sind.
          setDt("readiness");
        }}
        onOpenPanel={(c) => {
          setDetailId(c.id);
          setDt("readiness");
        }}
      />
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editorMode === "create" ? "Neuen Kunden anlegen" : "Kunden bearbeiten"}
        width={620}
      >
        <div
          className="ezy-form-grid"
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}
        >
          <Inp
            label="Name"
            value={draft.name}
            onChange={(v) => setDraft((p) => ({ ...p, name: v }))}
            required
          />
          <Inp
            label="Domain"
            value={draft.domain}
            onChange={(v) => setDraft((p) => ({ ...p, domain: v }))}
            placeholder="example.com"
            required
          />
          <Inp
            label="Branche"
            value={draft.industry}
            onChange={(v) => setDraft((p) => ({ ...p, industry: v }))}
          />
          <Inp
            label="Status"
            value={draft.status}
            onChange={(v) => setDraft((p) => ({ ...p, status: v }))}
            options={["active", "paused"]}
          />
          <Inp
            label="E-Mail"
            value={draft.contactEmail}
            onChange={(v) => setDraft((p) => ({ ...p, contactEmail: v }))}
          />
          <Inp
            label="Telefon"
            value={draft.contactPhone}
            onChange={(v) => setDraft((p) => ({ ...p, contactPhone: v }))}
          />
          <Inp
            label="Monatsbudget (CHF)"
            value={draft.monthlyBudget}
            onChange={(v) => setDraft((p) => ({ ...p, monthlyBudget: v }))}
            type="number"
          />
          <Inp
            label="Canonry Projekt"
            value={draft.canonryProject}
            onChange={(v) => setDraft((p) => ({ ...p, canonryProject: v }))}
            placeholder="wird aus Domain abgeleitet"
          />
          <Inp
            label="Tags"
            value={draft.tags}
            onChange={(v) => setDraft((p) => ({ ...p, tags: v }))}
            placeholder="SEO, GEO, Content"
          />
          <Inp
            label="Standorte"
            value={draft.targetLocations}
            onChange={(v) => setDraft((p) => ({ ...p, targetLocations: v }))}
            placeholder="Schweiz, Zürich"
          />
          <Inp
            label="GSC Property"
            value={draft.gscSiteUrl}
            onChange={(v) => setDraft((p) => ({ ...p, gscSiteUrl: v }))}
            placeholder="sc-domain:example.com"
          />
          <Inp
            label="GA4 Property ID"
            value={draft.ga4PropertyId}
            onChange={(v) => setDraft((p) => ({ ...p, ga4PropertyId: v }))}
          />
        </div>
        <Inp
          label="GA4 Measurement ID"
          value={draft.ga4MeasurementId}
          onChange={(v) => setDraft((p) => ({ ...p, ga4MeasurementId: v }))}
        />
        {/* B5d (Dashboard-Ausbau): Brand-Terms fuer den GSC-Split + Umsatz-Modus */}
        <Inp
          label="Brand-Begriffe (GSC Brand/Non-Brand)"
          value={draft.brandTerms}
          onChange={(v) => setDraft((p) => ({ ...p, brandTerms: v }))}
          placeholder="hotel ava, hotelava, hotel-ava"
        />
        <div style={{ margin: "4px 0 8px" }}>
          <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 6 }}>Umsatz-Modus</div>
          <div style={{ display: "flex", gap: 8 }}>
            {[
              ["revenue", "Umsatz-Tracking vollstaendig"],
              ["clicks", "nur Buchungsklicks"],
            ].map(([val, label]) => (
              <button
                key={val}
                type="button"
                onClick={() => setDraft((p) => ({ ...p, revenueMode: val }))}
                style={{
                  padding: "6px 14px",
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${draft.revenueMode === val ? C.accent : C.border}`,
                  background: draft.revenueMode === val ? C.accentDim : "transparent",
                  color: draft.revenueMode === val ? C.accentLight : C.textMuted,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <Inp
          label="Notizen"
          value={draft.notes}
          onChange={(v) => setDraft((p) => ({ ...p, notes: v }))}
          textarea
        />
        {editorMode === "create" && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: C.text, margin: "0 0 4px" }}>
              Dienste auswählen
            </div>
            <p style={{ fontSize: 11, color: C.textMuted, margin: "0 0 10px", lineHeight: 1.4 }}>
              Aktivierte Dienste werden automatisch verbunden. Nicht gewählte bleiben deaktiviert,
              bis du sie später unter „Integrationen" einschaltest.
            </p>
            <ServicesPicker
              C={C}
              value={draft.services}
              onChange={(s) => setDraft((p) => ({ ...p, services: s }))}
            />
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, marginTop: 8 }}>
          <Btn variant="secondary" onClick={() => setEditorOpen(false)}>
            Abbrechen
          </Btn>
          <Btn icon={Save} onClick={saveClient}>
            {editorMode === "create" ? "Kunden anlegen" : "Änderungen speichern"}
          </Btn>
        </div>
      </Modal>
    </div>
  );
}

// Conversions je Kunde (05.08.2026): zeigt die in GA4 erkannten Key-Events
// (Anzahl 30 Tage, ob GA4 selbst Werte liefert) und erlaubt, pro Conversion
// einen manuellen Wert zu hinterlegen. Der wirkt in der Attribution als
// letzte Stufe der Betrags-Kaskade (dl_value > Umsatz > value > manuell).
export function ConversionValuesPanel({ client }) {
  const toast = useToast();
  const [state, setState] = useState({
    loading: true,
    error: "",
    ga4: false,
    events: [],
    setup: null,
  });
  const [drafts, setDrafts] = useState({}); // event -> { value, currency }
  const [saving, setSaving] = useState(false);

  const clientIdStabil = client?.id;
  const load = useCallback(async () => {
    if (!clientIdStabil) return;
    setState((s) => ({ ...s, loading: true, error: "" }));
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const r = await fetch(
        `/api/admin/ga4-conversions?client=${encodeURIComponent(clientIdStabil)}`,
        {
          headers: { Authorization: `Bearer ${session?.access_token || ""}` },
        },
      );
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setState({
        loading: false,
        error: "",
        ga4: !!j.ga4,
        events: j.events || [],
        setup: j.setup || null,
      });
      setDrafts({});
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: String(e?.message || e) }));
    }
  }, [clientIdStabil]);
  useEffect(() => {
    load();
  }, [load]);

  const draftOf = (ev) =>
    drafts[ev.name] ?? { value: ev.manualValue || "", currency: ev.currency || "CHF" };
  const setDraft = (name, patch) =>
    setDrafts((d) => ({ ...d, [name]: { ...(d[name] ?? {}), ...patch } }));
  const dirty = Object.keys(drafts).length > 0;

  const save = async () => {
    setSaving(true);
    try {
      const session = (await supabase.auth.getSession()).data.session;
      const values = Object.entries(drafts).map(([event, d]) => ({
        event,
        value: Number(d.value) || 0,
        currency: /^[A-Z]{3}$/.test(String(d.currency || "")) ? d.currency : "CHF",
      }));
      const r = await fetch("/api/admin/ga4-conversions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session?.access_token || ""}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ client: client.id, values }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      toast("Conversion-Werte gespeichert — wirken ab dem nächsten Daten-Lauf", "success");
      await load();
    } catch (e) {
      toast("Speichern fehlgeschlagen: " + String(e?.message || e), "error");
    } finally {
      setSaving(false);
    }
  };

  const inpStyle = {
    width: 90,
    padding: "6px 8px",
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.bg,
    color: C.text,
    fontSize: 13,
    fontFamily: "inherit",
    textAlign: "right",
  };
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 6px" }}>
        Conversions{client?.name ? ` — ${client.name}` : ""}
      </h2>
      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
        Alle Conversions (Key-Events), die GA4 für diesen Kunden erkennt. Liefert GA4 selbst keinen
        Betrag, kannst du hier pro Conversion einen Wert hinterlegen — er wird ab dem nächsten
        Daten-Lauf automatisch angewendet.
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          padding: 22,
        }}
      >
        {state.loading ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>Lade GA4-Conversions…</div>
        ) : state.error ? (
          <div style={{ color: C.red || "#e05d5d", fontSize: 13 }}>{state.error}</div>
        ) : !state.ga4 && !state.events.length ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>
            Für diesen Kunden ist kein GA4 verbunden — sobald die Verbindung steht, erscheinen die
            erkannten Conversions hier automatisch.
          </div>
        ) : (
          <>
            {state.setup?.dlValue && (
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 12 }}>
                ✓ Diese Property sendet Buchungswerte bereits selbst (dl_value) — manuelle Werte
                sind nur für Events nötig, die keinen eigenen Betrag tragen.
              </div>
            )}
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr
                    style={{
                      color: C.textMuted,
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: ".04em",
                      textAlign: "left",
                    }}
                  >
                    <th style={{ padding: "6px 8px" }}>Conversion</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>30 Tage</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Wert aus GA4</th>
                    <th style={{ padding: "6px 8px", textAlign: "right" }}>Manueller Wert</th>
                    <th style={{ padding: "6px 8px" }}>Währung</th>
                  </tr>
                </thead>
                <tbody>
                  {state.events.map((ev) => {
                    const d = draftOf(ev);
                    return (
                      <tr key={ev.name} style={{ borderTop: `1px solid ${C.border}` }}>
                        <td style={{ padding: "8px", color: C.text, fontWeight: 600 }}>
                          {ev.name}
                          {!ev.isKeyEvent && (
                            <span
                              style={{
                                marginLeft: 8,
                                fontSize: 10.5,
                                color: C.textMuted,
                                fontWeight: 400,
                              }}
                            >
                              nicht als Key-Event markiert
                            </span>
                          )}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            textAlign: "right",
                            color: C.text,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {ev.count30d.toLocaleString("de-CH")}
                        </td>
                        <td
                          style={{
                            padding: "8px",
                            textAlign: "right",
                            color: ev.ga4Value > 0 ? C.green : C.textMuted,
                            fontVariantNumeric: "tabular-nums",
                          }}
                        >
                          {ev.ga4Value > 0 ? Math.round(ev.ga4Value).toLocaleString("de-CH") : "—"}
                        </td>
                        <td style={{ padding: "8px", textAlign: "right" }}>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            value={d.value}
                            placeholder="0"
                            onChange={(e) =>
                              setDraft(ev.name, { value: e.target.value, currency: d.currency })
                            }
                            style={inpStyle}
                          />
                        </td>
                        <td style={{ padding: "8px" }}>
                          <select
                            value={d.currency}
                            onChange={(e) =>
                              setDraft(ev.name, { value: d.value, currency: e.target.value })
                            }
                            style={{ ...inpStyle, width: 74, textAlign: "left" }}
                          >
                            {["CHF", "EUR", "USD", "GBP"].map((cu) => (
                              <option key={cu} value={cu}>
                                {cu}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", gap: 12 }}>
              <Btn icon={Save} onClick={save} disabled={!dirty || saving}>
                {saving ? "Speichert…" : "Werte speichern"}
              </Btn>
              <span style={{ fontSize: 11.5, color: C.textMuted }}>
                Wert 0 entfernt einen hinterlegten Betrag wieder.
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// Agent-Läufe: deterministischer Lauf-Nachweis pro Kunde (Quelle: agent_runs,
// befüllt vom agent-service nach JEDEM Lauf — auch an Tagen ohne Änderung).
export function AgentRunsPanel({ selectedClient }) {
  const { runs, loading, refresh } = useEzyAgentRuns(selectedClient?.id, 50);
  const stCo = { ok: C.green, fehler: C.red, partial: C.orange };
  const stIc = { ok: CheckCircle, fehler: AlertCircle, partial: Clock };
  const stLbl = { ok: "OK", fehler: "Fehler", partial: "Teilweise" };

  useEffect(() => {
    const iv = setInterval(refresh, 2 * 60 * 1000);
    return () => clearInterval(iv);
  }, [refresh]);

  if (loading && runs.length === 0)
    return (
      <div style={{ textAlign: "center", padding: 40, color: C.textMuted }}>Lade Agent-Läufe …</div>
    );

  if (!runs.length)
    return (
      <LiveEmptyState
        title="Noch keine Agent-Läufe"
        hint="Sobald der Autopilot für diesen Kunden läuft, erscheint hier jeder Lauf — auch an Tagen ohne Änderung."
      />
    );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: C.text }}>
          Agent-Läufe ({runs.length})
        </h3>
        <Btn size="sm" variant="ghost" icon={RefreshCw} onClick={refresh}>
          Aktualisieren
        </Btn>
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {runs.map((r, i) => {
          const st = String(r.status || "ok").toLowerCase();
          const SI = stIc[st] || Clock;
          const d = new Date(r.run_at || r.created_at);
          const dur = r.duration_ms ? `${Math.max(1, Math.round(r.duration_ms / 1000))}s` : "—";
          return (
            <div
              key={r.id}
              style={{
                padding: "13px 20px",
                borderBottom: i < runs.length - 1 ? `1px solid ${C.border}` : "none",
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <SI
                size={16}
                color={stCo[st] || C.textMuted}
                style={{ marginTop: 2, flexShrink: 0 }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
                    {r.agent_name || "Agent"}
                  </span>
                  <span style={{ fontSize: 11, color: C.textMuted }}>
                    {d.toLocaleDateString("de-CH")}{" "}
                    {d.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} · {dur}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: 11.5,
                    color: C.textMuted,
                    marginTop: 3,
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span>
                    {r.deploy_count > 0
                      ? `${r.deploy_count} Deploy${r.deploy_count === 1 ? "" : "s"}`
                      : "0 Deploys"}
                  </span>
                  {r.health_score != null && <span>Health {r.health_score}/100</span>}
                </div>
                {r.summary && (
                  <div
                    style={{
                      fontSize: 12,
                      color: C.textMuted,
                      marginTop: 6,
                      lineHeight: 1.5,
                      display: "-webkit-box",
                      WebkitLineClamp: 3,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {r.summary}
                  </div>
                )}
                {r.error_message && (
                  <div style={{ fontSize: 11, color: C.red, marginTop: 4 }}>{r.error_message}</div>
                )}
              </div>
              <Badge color={stCo[st] || C.textMuted}>{stLbl[st] || st}</Badge>
            </div>
          );
        })}
      </div>
    </div>
  );
}
