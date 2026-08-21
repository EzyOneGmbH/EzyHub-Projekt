// Admin-Einstellungen (aus EzyOneApp.jsx extrahiert, 21.08.2026 — reines
// Verschieben): SettingsPage inkl. Systemcheck/Worker-/Secret-Karten.
import { ExternalLink, GitBranch } from "lucide-react";
import { useState, useEffect, useCallback } from "react";
import { Badge, Btn, useToast } from "./shared-ui";
import { C } from "./theme";
import {
  CANONRY_SERVICE,
  Inp,
  Skeleton,
  ga4PropertyText,
  initialsFromName,
  useLiveIntegrations,
} from "./ui-kit";
import { useEzyDashboardConfig } from "@/ezy/data/useEzyDashboardConfig";
import { supabase } from "@/integrations/supabase/client";
import {
  Activity,
  BarChart3,
  Bot,
  Check,
  Database,
  Globe,
  Info,
  Key,
  Link2,
  RefreshCw,
  Save,
  Sparkles,
  ToggleLeft,
  ToggleRight,
  Users,
  Zap,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════════
// PAGE: SETTINGS (5 tabs)
// ═══════════════════════════════════════════════════════════════════════════
// Security-Runde 2 (21.08.): Zustand der WordPress-Secrets — NUR Zaehler
// (aktuell/veraltet/Klartext/fehlerhaft), niemals Inhalte. Quelle:
// /api/admin/secret-status (owner/admin, Org-gebunden).
export function WpSecretStatusCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch("/api/admin/secret-status", {
          headers: { Authorization: `Bearer ${token || ""}` },
        });
        const j = await r.json().catch(() => null);
        if (j?.ok) setData(j);
      } catch {}
    })();
  }, []);
  if (!data) return null;
  const pill = (label, n, color) => (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 10px",
        borderRadius: 8,
        background: `${color}18`,
        color,
      }}
    >
      {label}: {n}
    </span>
  );
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        WordPress-Zugänge (verschlüsselt gespeichert)
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {pill("Aktuell", data.aktuell, C.green)}
        {pill("Veraltete Version", data.veraltet, C.orange)}
        {pill("Klartext", data.klartext, data.klartext ? C.red : C.textMuted)}
        {pill("Fehlerhaft", data.fehlerhaft, data.fehlerhaft ? C.red : C.textMuted)}
        <span style={{ fontSize: 11, color: C.textMuted }}>
          {data.gesamt} Verbindung(en)
          {data.strictModus ? " · Klartext-Fallback deaktiviert" : ""}
          {!data.dedizierterSchluessel ? " · Hinweis: WP_SECRET_KEY_V1 noch nicht gesetzt" : ""}
        </span>
      </div>
    </div>
  );
}

// Analyse-Worker-Ueberwachung (21.08.): letzter Lauf, Laufzeit, bearbeitete
// Jobs und Fehler des EzyAI-Analyse-Workers — Zustand aktiv/verzoegert/
// ausgefallen. Quelle: /api/agent/analyse?worker=1 (Heartbeat-Tabelle).
export function AnalyseWorkerCard() {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch("/api/agent/analyse?worker=1", {
          headers: { Authorization: `Bearer ${token || ""}` },
        });
        const j = await r.json().catch(() => null);
        if (alive && j?.ok) setData(j);
      } catch {}
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (!data) return null;
  const farbe =
    data.zustand === "aktiv" ? C.green : data.zustand === "verzoegert" ? C.orange : C.red;
  const label =
    data.zustand === "aktiv"
      ? "aktiv"
      : data.zustand === "verzoegert"
        ? "verzögert"
        : "ausgefallen";
  const hb = data.heartbeat || {};
  return (
    <div
      style={{
        background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        padding: "12px 16px",
        marginBottom: 16,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        Analyse-Worker (EzyAI Analyse)
      </div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 10px",
            borderRadius: 8,
            background: `${farbe}18`,
            color: farbe,
          }}
        >
          {label}
        </span>
        <span style={{ fontSize: 11, color: C.textMuted }}>
          {hb.last_run_at
            ? `Letzter Lauf ${new Date(hb.last_run_at).toLocaleString("de-CH")} · ${hb.duration_ms} ms · ${hb.jobs_processed} Etappe(n) · ${hb.errors} Fehler`
            : "Noch kein Lauf registriert"}
          {" · Zeitplan: Task «EzyOne-Analyse-Worker», minütlich"}
        </span>
      </div>
      {data.zustand !== "aktiv" && (
        <div style={{ marginTop: 8, fontSize: 12, color: farbe, fontWeight: 600 }}>
          Der Worker lief länger als das erlaubte Intervall nicht — Analysen bleiben in der
          Warteschlange. Task-Scheduler auf dem Cloud-PC prüfen.
        </div>
      )}
    </div>
  );
}

// Systemcheck (Admin-Ausbau 21.08.): zeigt serverseitig geprueft, ob die
// erwarteten Tabellen/Spalten/RLS wirklich existieren (fehlende Migrationen
// erschienen frueher als "leere Daten"), plus Worker-Heartbeat und
// WP-Secret-Migrationsstatus. Quelle: /api/admin/system-check (owner/admin).
export function SystemCheckPanel() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const lade = useCallback(async () => {
    setBusy(true);
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await fetch("/api/admin/system-check", {
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      const j = await r.json().catch(() => null);
      if (j?.ok) {
        setData(j);
        setErr("");
      } else setErr(j?.error || `HTTP ${r.status}`);
    } catch (e) {
      setErr(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    void lade();
  }, [lade]);
  const farbe = (st) =>
    st === "vorhanden" ? C.green : st === "fehlt" ? C.red : st === "fehlerhaft" ? C.red : C.orange;
  const label = (st) =>
    st === "vorhanden"
      ? "vorhanden"
      : st === "fehlt"
        ? "FEHLT"
        : st === "fehlerhaft"
          ? "FEHLERHAFT"
          : "nicht prüfbar";
  if (err) return <div style={{ fontSize: 13, color: C.red }}>{err}</div>;
  if (!data) return <div style={{ fontSize: 13, color: C.textMuted }}>Prüfe System…</div>;
  const workerFarbe =
    data.worker?.zustand === "aktiv"
      ? C.green
      : data.worker?.zustand === "verzoegert"
        ? C.orange
        : C.red;
  const pill = (bg, txt) => (
    <span
      style={{
        fontSize: 11,
        fontWeight: 700,
        padding: "3px 10px",
        borderRadius: 8,
        background: `${bg}18`,
        color: bg,
        whiteSpace: "nowrap",
      }}
    >
      {txt}
    </span>
  );
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Systemcheck</h2>
        <Btn size="sm" variant="secondary" icon={RefreshCw} onClick={lade} disabled={busy}>
          {busy ? "Prüft…" : "Neu prüfen"}
        </Btn>
        <span style={{ fontSize: 11, color: C.textDim }}>
          Stand {new Date(data.stand).toLocaleTimeString("de-CH")}
        </span>
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>Analyse-Worker</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {pill(workerFarbe, data.worker?.zustand || "nicht prüfbar")}
          <span style={{ fontSize: 11.5, color: C.textMuted }}>
            {data.worker?.lastRunAt
              ? `Letzter Lauf ${new Date(data.worker.lastRunAt).toLocaleString("de-CH")} · ${data.worker.jobsProcessed} Etappe(n) · ${data.worker.errors} Fehler`
              : "Noch kein Lauf registriert"}
          </span>
        </div>
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "12px 16px",
          marginBottom: 14,
        }}
      >
        <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>WordPress-Secrets</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {pill(C.green, `Aktuell: ${data.secrets.aktuell}`)}
          {pill(
            data.secrets.veraltet ? C.orange : C.textMuted,
            `Veraltet: ${data.secrets.veraltet}`,
          )}
          {pill(data.secrets.klartext ? C.red : C.textMuted, `Klartext: ${data.secrets.klartext}`)}
          {pill(
            data.secrets.fehlerhaft ? C.red : C.textMuted,
            `Fehlerhaft: ${data.secrets.fehlerhaft}`,
          )}
          <span style={{ fontSize: 11, color: C.textDim }}>
            {data.secrets.dedizierterSchluessel
              ? "dedizierter Schlüssel aktiv"
              : "WP_SECRET_KEY_V1 noch nicht gesetzt"}
            {data.secrets.strictModus ? " · Klartext-Fallback deaktiviert" : ""}
          </span>
        </div>
      </div>
      <div
        style={{
          background: C.card,
          border: `1px solid ${C.border}`,
          borderRadius: 10,
          padding: "6px 16px",
        }}
      >
        {data.checks.map((c) => (
          <div
            key={c.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "9px 0",
              borderBottom: `1px solid ${C.border}55`,
              fontSize: 13,
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>{c.name}</span>
            <span
              style={{
                fontSize: 11.5,
                color: C.textDim,
                maxWidth: 360,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={c.detail}
            >
              {c.detail !== "ok" ? c.detail : ""}
            </span>
            {pill(farbe(c.status), label(c.status))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function SettingsPage({
  tools,
  onToggleTool,
  selectedClient,
  profile,
  onSaveProfile,
  customerDefaults,
  onSaveDefaults,
  onClientUpdated,
  onOpenAgents = null,
}) {
  const toast = useToast();
  const [sec, setSec] = useState("profil");
  const [profileDraft, setProfileDraft] = useState(profile);
  const live = useLiveIntegrations();
  const dash = useEzyDashboardConfig();
  useEffect(() => setProfileDraft(profile), [profile]);
  // Admin-Umbau Teil 2 (06.08.): "Kunden-Einstellungen" + "Conversions" sind
  // ins Kunden-Detail gezogen (Kunden → Kunde → Einstellungen) — hier bleiben
  // nur noch organisationsweite Einstellungen, der Kunden-Umschalter entfällt.
  const sects = [
    ["profil", "Profil", Users],
    ["api", "API-Schlüssel", Key],
    ["skills", "Skills / Tools", Zap],
    ["dashboard", "Dashboard-Metriken", BarChart3],
    // Admin-Umbau 06.08.: Agenten-Verwaltung wohnt jetzt hier (statt eigenem
    // Nav-Punkt) — der Eintrag springt auf die (unveränderte) Agents-Seite.
    ...(onOpenAgents ? [["agents", "Agenten & Automatisierung", Bot]] : []),
    ["system", "Systemcheck", Activity],
    ["about", "Über Ezy One", Info],
  ];
  const providerRows = [
    ["Gemini", live.data?.providers?.gemini, C.green, Bot],
    ["OpenAI", live.data?.providers?.openai, C.blue, Bot],
    ["Anthropic", live.data?.providers?.anthropic, C.pink, Bot],
    ["Perplexity", live.data?.providers?.perplexity, C.orange, Sparkles],
    ["DataForSEO", live.data?.providers?.dataforseo, C.green, Link2],
    ["Moz", null, C.textMuted, Database],
  ];
  const googleRows = [
    ["Google Search Console", live.data?.google?.searchConsole, Globe],
    ["Google Analytics 4", live.data?.google?.analytics, BarChart3],
  ];
  return (
    <div className="settings-shell" style={{ display: "flex", gap: 24 }}>
      <div className="settings-nav" style={{ width: 200, flexShrink: 0 }}>
        {sects.map(([id, l, I]) => (
          <button
            key={id}
            onClick={() => (id === "agents" && onOpenAgents ? onOpenAgents() : setSec(id))}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              borderRadius: 10,
              border: "none",
              cursor: "pointer",
              background: sec === id ? C.accentDim : "transparent",
              color: sec === id ? C.accentLight : C.textMuted,
              fontSize: 13,
              fontWeight: sec === id ? 600 : 400,
              marginBottom: 2,
              fontFamily: "inherit",
            }}
          >
            <I size={16} />
            {l}
          </button>
        ))}
        <div style={{ fontSize: 11, color: C.textDim, padding: "10px 14px", lineHeight: 1.5 }}>
          Kundenbezogene Einstellungen (Sprache, Tabs, Conversions, App-Zugriff) findest du im
          Kunden-Detail: Kunden → Kunde anklicken.
        </div>
      </div>
      <div className="settings-panel" style={{ flex: 1, maxWidth: 640 }}>
        {sec === "profil" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>Profil</h2>
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 22,
              }}
            >
              <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 20 }}>
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 14,
                    background: C.accent,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    fontWeight: 800,
                    color: "#fff",
                  }}
                >
                  {initialsFromName(profileDraft.name)}
                </div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16, color: C.text }}>
                    {profileDraft.name}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>{profileDraft.role}</div>
                </div>
              </div>
              <Inp
                label="Name"
                value={profileDraft.name}
                onChange={(v) => setProfileDraft((p) => ({ ...p, name: v }))}
              />
              <Inp
                label="E-Mail"
                value={profileDraft.email}
                onChange={(v) => setProfileDraft((p) => ({ ...p, email: v }))}
              />
              <Inp
                label="Rolle"
                value={profileDraft.role}
                onChange={(v) => setProfileDraft((p) => ({ ...p, role: v }))}
              />
              <Inp
                label="Sprache"
                value={profileDraft.language}
                onChange={(v) => setProfileDraft((p) => ({ ...p, language: v }))}
                options={["Deutsch", "Englisch"]}
              />
              <Btn
                icon={Save}
                onClick={() => {
                  onSaveProfile(profileDraft);
                  toast("Profil gespeichert", "success");
                }}
              >
                Speichern
              </Btn>
            </div>
          </div>
        )}

        {sec === "api" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>API-Schlüssel</h2>
            <div
              style={{
                background: C.blueDim,
                border: `1px solid ${C.blue}30`,
                borderRadius: 10,
                padding: "12px 16px",
                marginBottom: 16,
                display: "flex",
                gap: 10,
                alignItems: "center",
              }}
            >
              <Info size={16} color={C.blue} />
              <span style={{ fontSize: 12, color: C.text }}>
                Secrets liegen jetzt serverseitig in einer lokalen Env-Datei. Nichts davon wird ins
                Frontend-Bundle geschrieben.
              </span>
            </div>
            <WpSecretStatusCard />
            <AnalyseWorkerCard />
            {live.loading && (
              <div
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 14,
                  padding: 18,
                  marginBottom: 14,
                }}
              >
                <Skeleton w="38%" h={14} />
                <div style={{ marginTop: 12 }}>
                  <Skeleton w="100%" h={12} />
                </div>
                <div style={{ marginTop: 8 }}>
                  <Skeleton w="86%" h={12} />
                </div>
              </div>
            )}
            {!live.loading && live.error && (
              <div
                style={{
                  background: C.redDim,
                  border: `1px solid ${C.red}35`,
                  borderRadius: 12,
                  padding: "14px 16px",
                  marginBottom: 14,
                  fontSize: 13,
                  color: C.text,
                }}
              >
                Live-Prüfung fehlgeschlagen:{" "}
                <span style={{ color: C.textMuted }}>{live.error}</span>
              </div>
            )}
            {!live.loading && !live.error && (
              <>
                <div
                  style={{
                    background: `linear-gradient(135deg,${live.data?.canonry?.configured && live.data?.canonry?.reachable && live.data?.canonry?.authenticated ? C.greenDim : C.orangeDim},${C.blueDim}), ${C.card}`,
                    border: `1px solid ${live.data?.canonry?.configured && live.data?.canonry?.reachable && live.data?.canonry?.authenticated ? C.green : C.orange}35`,
                    borderRadius: 12,
                    padding: "16px 18px",
                    marginBottom: 14,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 8,
                    }}
                  >
                    <div style={{ fontWeight: 700, fontSize: 14, color: C.text }}>
                      Canonry Service
                    </div>
                    <Badge
                      color={
                        live.data?.canonry?.configured &&
                        live.data?.canonry?.reachable &&
                        live.data?.canonry?.authenticated
                          ? C.green
                          : C.orange
                      }
                    >
                      {live.data?.canonry?.configured &&
                      live.data?.canonry?.reachable &&
                      live.data?.canonry?.authenticated
                        ? "Live"
                        : "Fehlt noch"}
                    </Badge>
                  </div>
                  <div
                    style={{ fontSize: 12, color: C.textMuted, lineHeight: 1.6, marginBottom: 10 }}
                  >
                    {live.data?.canonry?.detail || "Canonry-Status unbekannt"}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                    {(live.data?.canonry?.missing || []).length
                      ? live.data.canonry.missing.map((bit) => (
                          <Badge key={bit} color={C.orange}>
                            {bit}
                          </Badge>
                        ))
                      : CANONRY_SERVICE.providers.map((p) => (
                          <Badge key={p} color={C.green}>
                            {p}
                          </Badge>
                        ))}
                  </div>
                  <div style={{ fontSize: 12, color: C.textMuted }}>
                    OpenAPI: {CANONRY_SERVICE.openApi} • letzter Check:{" "}
                    {live.data?.checkedAt
                      ? new Date(live.data.checkedAt).toLocaleString("de-CH")
                      : "—"}
                  </div>
                </div>
                {providerRows.map(([n, status, co, I]) => (
                  <div
                    key={n}
                    style={{
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: "14px 20px",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: `${co}18`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <I size={18} color={co} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{n}</div>
                      <div style={{ fontSize: 12, color: C.textMuted }}>
                        {status?.detail || "Nicht konfiguriert"}
                      </div>
                      {status?.error && (
                        <div style={{ fontSize: 11, color: C.orange, marginTop: 4 }}>
                          {status.error}
                        </div>
                      )}
                    </div>
                    <Badge
                      color={
                        status?.verified ? C.green : status?.configured ? C.orange : C.textMuted
                      }
                    >
                      {status?.verified
                        ? "Verifiziert"
                        : status?.configured
                          ? "Konfiguriert"
                          : "Inaktiv"}
                    </Badge>
                  </div>
                ))}
                <div
                  style={{
                    marginTop: 18,
                    marginBottom: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: C.textMuted,
                    textTransform: "uppercase",
                  }}
                >
                  Google Integrationen
                </div>
                {googleRows.map(([n, status, I]) => (
                  <div
                    key={n}
                    style={{
                      background: C.card,
                      border: `1px solid ${C.border}`,
                      borderRadius: 12,
                      padding: "14px 20px",
                      marginBottom: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 14,
                    }}
                  >
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 10,
                        background: `${C.blue}18`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <I size={18} color={C.blue} />
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: C.text }}>{n}</div>
                      <div style={{ fontSize: 12, color: C.textMuted }}>
                        {status?.detail || "Noch nicht geprüft"}
                      </div>
                      {status?.missing?.length > 0 && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                          {status.missing.map((bit) => (
                            <Badge
                              key={`${n}-${bit}`}
                              color={status.apiKeyOnly ? C.orange : C.textDim}
                            >
                              {bit}
                            </Badge>
                          ))}
                        </div>
                      )}
                    </div>
                    <Badge
                      color={
                        status?.configured ? C.green : status?.apiKeyOnly ? C.orange : C.textMuted
                      }
                    >
                      {status?.configured
                        ? "OAuth bereit"
                        : status?.apiKeyOnly
                          ? "API-Key only"
                          : "Fehlt"}
                    </Badge>
                  </div>
                ))}
                <div
                  style={{
                    marginTop: 18,
                    marginBottom: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    color: C.textMuted,
                    textTransform: "uppercase",
                  }}
                >
                  Aktiver Kunde
                </div>
                <div
                  style={{
                    background: C.card,
                    border: `1px solid ${C.border}`,
                    borderRadius: 12,
                    padding: "14px 20px",
                    display: "flex",
                    flexDirection: "column",
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                    {selectedClient.name}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: C.textMuted }}>GSC Property</span>
                    <span style={{ color: C.text, fontWeight: 500 }}>
                      {selectedClient.gscSiteUrl}
                    </span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: C.textMuted }}>GA4 Property</span>
                    <span style={{ color: C.text, fontWeight: 500 }}>
                      {ga4PropertyText(selectedClient)}
                    </span>
                  </div>
                  {selectedClient.ga4MeasurementId && (
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        fontSize: 12,
                      }}
                    >
                      <span style={{ color: C.textMuted }}>GA4 Measurement ID</span>
                      <span style={{ color: C.text, fontWeight: 500 }}>
                        {selectedClient.ga4MeasurementId}
                      </span>
                    </div>
                  )}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 12,
                    }}
                  >
                    <span style={{ color: C.textMuted }}>Canonry Projekt</span>
                    <span style={{ color: C.text, fontWeight: 500 }}>
                      {selectedClient.canonryProject}
                    </span>
                  </div>
                </div>
                <div style={{ fontSize: 12, color: C.textDim, marginTop: 8 }}>
                  Google verbinden &amp; Verbindungen verwalten: im{" "}
                  <strong style={{ color: C.textMuted }}>Kunden-Detail → Onboarding-Karte</strong>.
                </div>
              </>
            )}
          </div>
        )}

        {sec === "skills" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>Skills / Tools</h2>
            <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 16px" }}>
              Tools ein-/ausschalten
            </p>
            {tools.map((t) => (
              <div
                key={t.id}
                style={{
                  background: C.card,
                  border: `1px solid ${C.border}`,
                  borderRadius: 10,
                  padding: "12px 16px",
                  marginBottom: 6,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.label}</span>
                <button
                  onClick={() => onToggleTool(t.id)}
                  style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    color: t.enabled ? C.green : C.textDim,
                  }}
                >
                  {t.enabled ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                </button>
              </div>
            ))}
          </div>
        )}

        {sec === "dashboard" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 8px" }}>Dashboard-Metriken</h2>
            <p style={{ fontSize: 13, color: C.textMuted, margin: "0 0 16px" }}>
              Lege fest, welche Kennzahlen in den Dashboards erscheinen. Standard: alles an —
              schalte einfach ab, was du nicht brauchst. Gilt für die ganze Organisation (nur
              Admins).
            </p>
            {[
              [
                "SEO",
                [
                  ["seo.ahrefs", "Backlink-KPIs (Traffic, Visibility, Authority, Keywords)"],
                  ["seo.gsc", "Search Console (Klicks, Impressionen, CTR, Position, Top-Queries)"],
                  ["seo.cwv", "Core Web Vitals (LCP, INP, CLS, Performance)"],
                  ["seo.trend", "SEO-Trend-Chart"],
                ],
              ],
              [
                "Conversion",
                [
                  ["conv.custom", "Conversion-Aktionen (Calls, Mail, Maps, Forms)"],
                  ["conv.ga4", "GA4-KPIs (Sessions, Users, Conversions, Revenue, …)"],
                  ["conv.revenue", "Revenue-Banner"],
                  ["conv.trend", "GA4-Traffic-Trend"],
                ],
              ],
              [
                "GEO",
                [
                  ["geo.kpis", "AI-KPIs (Coverage, Referrals, Citations, Health)"],
                  ["geo.trend", "Citation-Trend je Provider"],
                  ["geo.evidence", "Latest Evidence"],
                ],
              ],
            ].map(([group, items]) => (
              <div key={group} style={{ marginBottom: 18 }}>
                <div
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    color: C.textDim,
                    textTransform: "uppercase",
                    marginBottom: 8,
                  }}
                >
                  {group}
                </div>
                {items.map(([key, label]) => {
                  const on = dash.isOn(key);
                  return (
                    <button
                      key={key}
                      onClick={() => dash.setKey(key, !on)}
                      style={{
                        width: "100%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 14px",
                        borderRadius: 10,
                        border: `1px solid ${C.border}`,
                        background: C.card,
                        color: C.text,
                        cursor: "pointer",
                        marginBottom: 6,
                        fontFamily: "inherit",
                        fontSize: 13,
                      }}
                    >
                      <span>{label}</span>
                      <span style={{ color: on ? C.green : C.textDim, flexShrink: 0 }}>
                        {on ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
        {sec === "system" && <SystemCheckPanel />}
        {sec === "about" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: "0 0 16px" }}>Über Ezy One</h2>
            <div
              style={{
                background: C.card,
                border: `1px solid ${C.border}`,
                borderRadius: 14,
                padding: 22,
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 }}>
                Ezy One Platform
              </div>
              <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 16 }}>
                Version 3.0 • Build 2026-04-20
              </div>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: 600,
                  color: C.textMuted,
                  marginBottom: 8,
                  textTransform: "uppercase",
                }}
              >
                GitHub Repositories
              </div>
              {[
                ["claude-seo", "https://github.com/AgriciDaniel/claude-seo"],
                ["claude-blog", "https://github.com/AgriciDaniel/claude-blog"],
                ["claude-obsidian", "https://github.com/AgriciDaniel/claude-obsidian"],
                ["open-seo", "https://github.com/every-app/open-seo"],
                ["canonry", "https://github.com/AINYC/canonry"],
              ].map(([n, u]) => (
                <a
                  key={n}
                  href={u}
                  target="_blank"
                  rel="noopener"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 0",
                    color: C.accent,
                    fontSize: 13,
                    textDecoration: "none",
                    borderBottom: `1px solid ${C.border}08`,
                  }}
                >
                  <GitBranch size={14} />
                  {n}
                  <ExternalLink size={11} style={{ marginLeft: "auto", color: C.textDim }} />
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
