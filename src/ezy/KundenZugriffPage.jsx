// Kunden-Zugriff (Volkan 14.09.2026): eigener Admin-Tab für alle Kunden-Accounts
// (Rolle viewer = Kundenportal). Bisher lagen diese Logins gemischt mit den
// Mitarbeitern in der Team-Sektion — jetzt sind sie hier gesammelt, Team zeigt
// nur noch owner/admin/member. Datenquelle bleibt die Team-API
// (/api/admin/team: list/invite/assign/remove), Filter auf role === "viewer".
import { useCallback, useEffect, useMemo, useState } from "react";
import { authedFetch } from "@/lib/authed-fetch";
import { supabase } from "@/integrations/supabase/client";
import { ClientAvatar } from "@/ezy/ClientAvatar";
import { Badge, Btn, useToast } from "./shared-ui";
import { Inp } from "./ui-kit";
import { C } from "./theme";
import { EZY_APPS } from "@/ezy/data/appRegistry";
import { useClientAppAccess } from "@/ezy/data/useClientAppAccess";
import { appLabel, warneBeimAppAktivieren } from "@/ezy/data/appRequirements";
import {
  kundenDetailLink,
  kundenfaehigeApps,
  nurKundenAccounts,
  sichtbareAppsFuerKunde,
  zugewieseneKunden,
} from "./data/kundenZugriff";

// Apps, die ein Kunde im Portal überhaupt bekommen kann (EzyRank, EzyAI,
// EzyPerformance, Reaktivierung) — Analyse/Admin sind bewusst intern.
const PORTAL_APPS = kundenfaehigeApps(EZY_APPS);

export function KundenZugriffPage({ clients }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [suche, setSuche] = useState("");
  const [filterClient, setFilterClient] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteClient, setInviteClient] = useState("");
  const [expanded, setExpanded] = useState(null); // userId mit offener Kunden-Zuweisung
  const [draftAccess, setDraftAccess] = useState(new Set());

  const callTeam = useCallback(async (body) => {
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const r = await authedFetch("/api/admin/team", {
      method: "POST",
      headers: { Authorization: `Bearer ${token || ""}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return r.json().catch(() => ({ error: "Antwort ungültig" }));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const j = await callTeam({ action: "list" });
    if (j.ok) setUsers(nurKundenAccounts(j.users));
    else toast(j.error || "Laden fehlgeschlagen", "error");
    setLoading(false);
  }, [callTeam, toast]);
  useEffect(() => {
    void load();
  }, [load]);

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(inviteEmail.trim());
  const invite = async () => {
    if (!emailOk || !inviteClient) return;
    setBusy(true);
    const j = await callTeam({
      action: "invite",
      email: inviteEmail.trim(),
      role: "viewer",
      clientIds: [inviteClient],
    });
    setBusy(false);
    if (j.ok) {
      toast(`Kunden-Login-Einladung an ${inviteEmail.trim()} gesendet`, "success");
      setInviteEmail("");
      await load();
    } else toast(j.error || "Einladung fehlgeschlagen", "error");
  };
  const remove = async (u) => {
    if (!window.confirm(`Kunden-Zugang von ${u.email || "Nutzer"} entfernen?`)) return;
    const j = await callTeam({ action: "remove", userId: u.userId });
    if (j.ok) {
      toast("Kunden-Zugang entfernt", "success");
      await load();
    } else toast(j.error || "Fehlgeschlagen", "error");
  };
  const openAssign = (u) => {
    setExpanded(u.userId);
    setDraftAccess(new Set(u.clientIds || []));
  };
  const saveAssign = async (userId) => {
    setBusy(true);
    const j = await callTeam({ action: "assign", userId, clientIds: [...draftAccess] });
    setBusy(false);
    if (j.ok) {
      toast(`${j.assigned} Kunden zugewiesen`, "success");
      setExpanded(null);
      await load();
    } else toast(j.error || "Fehlgeschlagen", "error");
  };

  // App-Freischaltung je Kunde (client_app_access) — gilt für ALLE Logins des
  // Kunden, nicht je Login (Portal-Gating hängt am Kunden). Voraussetzungen
  // (Dienste/Verbindungen) kommen aus der serverseitigen Einsatzbereitschaft.
  const caa = useClientAppAccess();
  const [readiness, setReadiness] = useState({}); // clientId -> AppReadiness[] | null
  const ladeReadiness = useCallback(async (clientId) => {
    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      const r = await authedFetch(
        `/api/admin/client-readiness?client=${encodeURIComponent(clientId)}`,
        { headers: { Authorization: `Bearer ${token || ""}` } },
      );
      const j = await r.json().catch(() => ({}));
      setReadiness((prev) => ({ ...prev, [clientId]: j?.ok ? j : null }));
      return j?.ok ? j : null;
    } catch {
      setReadiness((prev) => ({ ...prev, [clientId]: null }));
      return null;
    }
  }, []);
  // Readiness nur für Kunden laden, die tatsächlich Portal-Logins haben.
  const kundenMitLogins = useMemo(
    () => [...new Set(users.flatMap((u) => u.clientIds || []))],
    [users],
  );
  useEffect(() => {
    for (const id of kundenMitLogins) if (!(id in readiness)) void ladeReadiness(id);
    // readiness bewusst nicht als Dependency: nur fehlende Kunden nachladen
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kundenMitLogins, ladeReadiness]);
  const luecke = (clientId, appId) => {
    const r = readiness[clientId]?.readiness?.find((x) => x.app === appId);
    if (!r || r.status === "deaktiviert") return null;
    const c = r.checks?.find((ch) => ch.id !== "app" && !ch.ok && ch.severity === "kritisch");
    return c ? `${c.label}: ${c.detail}` : null;
  };
  const toggleApp = async (c, app) => {
    if (caa.legacy) {
      toast("App-Zugriff-Tabelle fehlt (Migration client_app_portal)", "error");
      return;
    }
    if (!app.enabled) {
      // Wie im Kunden-Detail: vor dem Freischalten auf fehlende Voraussetzungen hinweisen.
      const snap = readiness[c.id]?.snapshot || (await ladeReadiness(c.id))?.snapshot;
      const warnungen = snap ? warneBeimAppAktivieren(app.id, snap) : [];
      if (
        warnungen.length &&
        !window.confirm(
          `Für ${appLabel(app.id)} fehlen bei ${c.name} Voraussetzungen:\n\n${warnungen
            .map((w) => `• ${w.text}`)
            .join("\n")}\n\nDer Kunde sieht den Bereich sonst leer. Trotzdem freischalten?`,
        )
      )
        return;
    }
    const err = await caa.setAccess(c.id, app.id, { enabled: !app.enabled });
    if (err) toast(err, "error");
    else {
      toast(
        `${app.name} für ${c.name} ${app.enabled ? "gesperrt" : "freigeschaltet"} (alle Logins dieses Kunden)`,
        "success",
      );
      void ladeReadiness(c.id);
    }
  };

  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return users.filter((u) => {
      if (filterClient && !(u.clientIds || []).includes(filterClient)) return false;
      if (!q) return true;
      const kunden = zugewieseneKunden(u.clientIds, clients)
        .map((c) => c.name.toLowerCase())
        .join(" ");
      return (u.email || "").toLowerCase().includes(q) || kunden.includes(q);
    });
  }, [users, suche, filterClient, clients]);

  const ohneKunde = users.filter((u) => !(u.clientIds || []).length).length;
  const selectStyle = {
    width: "100%",
    padding: "9px 10px",
    borderRadius: 8,
    background: C.surface,
    color: C.text,
    border: `1px solid ${C.border}`,
    fontSize: 13,
  };
  const karte = {
    background: C.card,
    border: `1px solid ${C.border}`,
    borderRadius: 14,
    padding: 16,
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Kunden-Zugriff</h2>
        <p style={{ fontSize: 12, color: C.textMuted, margin: "4px 0 0" }}>
          Alle Kunden-Accounts (Portal-Logins) an einem Ort. Welche Apps ein Login sieht, hängt am
          Kunden (gilt für alle seine Logins): Chips anklicken schaltet EzyRank, EzyAI,
          EzyPerformance und Reaktivierung frei — Analyse und Admin sind intern. ⚠ = freigeschaltet,
          aber Voraussetzung fehlt (Dienst/Verbindung), der Bereich bliebe leer. Mitarbeiter und
          Admins verwaltest du weiterhin unter «Team».
        </p>
      </div>

      {/* Einladen */}
      <div style={karte}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Kunden-Login einladen</div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Inp
              label="E-Mail"
              value={inviteEmail}
              onChange={setInviteEmail}
              placeholder="kunde@firma.ch"
            />
          </div>
          <div style={{ minWidth: 220 }}>
            <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 4 }}>Kunde</div>
            <select
              aria-label="Kunde für Einladung"
              value={inviteClient}
              onChange={(e) => setInviteClient(e.target.value)}
              style={selectStyle}
            >
              <option value="">– Kunde wählen –</option>
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <Btn onClick={invite} disabled={busy || !emailOk || !inviteClient}>
            {busy ? "…" : "Einladen"}
          </Btn>
        </div>
        <p style={{ fontSize: 11, color: C.textDim, margin: "8px 0 0" }}>
          Die Person erhält eine E-Mail zum Passwort-Setzen und ist fest an den gewählten Kunden
          gebunden. Welche Funktionen sie sieht, steuerst du im Kunden-Detail unter App-Zugriff.
        </p>
      </div>

      {/* Liste */}
      <div style={karte}>
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            Kunden-Accounts ({sichtbar.length}
            {sichtbar.length !== users.length ? ` von ${users.length}` : ""})
          </div>
          {ohneKunde > 0 && <Badge color={C.orange}>{ohneKunde} ohne Kunden-Zuweisung</Badge>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              aria-label="Kunden-Accounts durchsuchen"
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder="E-Mail oder Kunde suchen"
              style={{ ...selectStyle, width: 220, padding: "7px 10px", fontSize: 12.5 }}
            />
            <select
              aria-label="Nach Kunde filtern"
              value={filterClient}
              onChange={(e) => setFilterClient(e.target.value)}
              style={{ ...selectStyle, width: 200, padding: "7px 10px", fontSize: 12.5 }}
            >
              <option value="">Alle Kunden</option>
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div style={{ color: C.textMuted, fontSize: 13 }}>Lädt…</div>
        ) : sichtbar.length === 0 ? (
          <div style={{ color: C.textDim, fontSize: 13 }}>
            {users.length === 0
              ? "Noch keine Kunden-Accounts. Lade oben den ersten Kunden-Login ein."
              : "Keine Treffer für diesen Filter."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {sichtbar.map((u) => {
              const kunden = zugewieseneKunden(u.clientIds, clients);
              return (
                <div
                  key={u.userId}
                  style={{
                    border: `1px solid ${C.hairline}`,
                    borderRadius: 12,
                    padding: "12px 14px",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                    <span
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: "50%",
                        background: `${C.textDim}1a`,
                        color: C.textDim,
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: 12,
                        fontWeight: 800,
                        flexShrink: 0,
                      }}
                    >
                      {(u.email || u.userId).slice(0, 2).toUpperCase()}
                    </span>
                    <span style={{ fontSize: 13, color: C.text, fontWeight: 700 }}>
                      {u.email || u.userId.slice(0, 8)}
                    </span>
                    <Badge color={C.textDim}>Kunde (Portal)</Badge>
                    <div
                      style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}
                    >
                      {kunden.length === 0 ? (
                        <span style={{ fontSize: 11, color: C.pink }}>kein Kunde zugewiesen</span>
                      ) : (
                        kunden.map((c) => (
                          <span
                            key={c.id}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 5,
                              fontSize: 11.5,
                              color: C.text,
                              border: `1px solid ${C.border}`,
                              borderRadius: 99,
                              padding: "2px 8px 2px 3px",
                            }}
                          >
                            <ClientAvatar
                              name={c.name}
                              domain={c.domain}
                              size={18}
                              radius={9}
                              bg={C.accentDim}
                              fg={C.accentLight}
                              fontSize={8}
                            />
                            {c.name}
                          </span>
                        ))
                      )}
                    </div>
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <Btn
                        variant="secondary"
                        size="sm"
                        onClick={() => (expanded === u.userId ? setExpanded(null) : openAssign(u))}
                      >
                        Kunden zuweisen
                      </Btn>
                      <Btn variant="danger" size="sm" onClick={() => remove(u)}>
                        Zugang entfernen
                      </Btn>
                    </div>
                  </div>
                  {/* Sichtbare Apps (14.09.): je zugewiesenem Kunden die Portal-Apps —
                      Klick schaltet die App für den KUNDEN (alle seine Logins). */}
                  {kunden.length > 0 && (
                    <div
                      style={{
                        marginTop: 8,
                        display: "flex",
                        flexDirection: "column",
                        gap: 4,
                      }}
                    >
                      {kunden.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            flexWrap: "wrap",
                          }}
                        >
                          <span style={{ fontSize: 11, color: C.textMuted, minWidth: 110 }}>
                            Apps {kunden.length > 1 ? `für ${c.name}` : "für den Kunden"}:
                          </span>
                          {sichtbareAppsFuerKunde(c.id, PORTAL_APPS, caa.map).map((a) => {
                            const fehlt = a.enabled ? luecke(c.id, a.id) : null;
                            return (
                              <button
                                key={a.id}
                                type="button"
                                onClick={() => toggleApp(c, a)}
                                title={
                                  fehlt
                                    ? `${a.name} ist freigeschaltet, erscheint aber leer — ${fehlt}`
                                    : a.enabled
                                      ? `${a.name} für ${c.name} sperren (alle Logins)`
                                      : `${a.name} für ${c.name} freischalten (alle Logins)`
                                }
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 4,
                                  padding: "3px 9px",
                                  borderRadius: 99,
                                  cursor: "pointer",
                                  fontSize: 11,
                                  border: `1px solid ${a.enabled ? (fehlt ? C.orange : a.color) : C.border}`,
                                  background: a.enabled
                                    ? fehlt
                                      ? C.orangeDim
                                      : a.tint
                                    : "transparent",
                                  color: a.enabled ? (fehlt ? C.orange : a.color) : C.textDim,
                                  textDecoration: a.enabled ? "none" : "line-through",
                                }}
                              >
                                {a.icon} {a.name}
                                {fehlt ? " ⚠" : ""}
                              </button>
                            );
                          })}
                          <a
                            href={kundenDetailLink(c.id)}
                            style={{ fontSize: 11, color: C.accent, textDecoration: "none" }}
                            title="Funktionen im Detail freischalten (Kunden-Detail → App-Zugriff)"
                          >
                            Funktionen →
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                  {expanded === u.userId && (
                    <div
                      style={{
                        marginTop: 10,
                        borderTop: `1px solid ${C.border}`,
                        paddingTop: 10,
                      }}
                    >
                      <div style={{ fontSize: 12, color: C.textMuted, marginBottom: 8 }}>
                        Welche Kunden darf {u.email || "dieser Login"} sehen? Portal-Logins gehören
                        in der Regel zu genau EINEM Kunden.
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
                          gap: 6,
                          marginBottom: 10,
                        }}
                      >
                        {(clients || []).map((c) => {
                          const on = draftAccess.has(c.id);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() =>
                                setDraftAccess((prev) => {
                                  const n = new Set(prev);
                                  if (n.has(c.id)) n.delete(c.id);
                                  else n.add(c.id);
                                  return n;
                                })
                              }
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 7,
                                textAlign: "left",
                                padding: "6px 10px",
                                borderRadius: 8,
                                cursor: "pointer",
                                fontSize: 12,
                                border: `1px solid ${on ? C.accent : C.border}`,
                                background: on ? C.accentDim : "transparent",
                                color: on ? C.accentLight : C.text,
                              }}
                            >
                              <span>{on ? "☑" : "☐"}</span>
                              <ClientAvatar
                                name={c.name}
                                domain={c.domain}
                                size={20}
                                radius={5}
                                bg={C.accentDim}
                                fg={C.accentLight}
                                fontSize={9}
                              />
                              <span
                                style={{
                                  minWidth: 0,
                                  whiteSpace: "nowrap",
                                  overflow: "hidden",
                                  textOverflow: "ellipsis",
                                }}
                              >
                                {c.name}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                        <Btn variant="secondary" size="sm" onClick={() => setExpanded(null)}>
                          Abbrechen
                        </Btn>
                        <Btn size="sm" onClick={() => saveAssign(u.userId)} disabled={busy}>
                          Speichern
                        </Btn>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
