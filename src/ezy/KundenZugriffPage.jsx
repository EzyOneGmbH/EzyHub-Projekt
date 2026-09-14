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
import { nurKundenAccounts, zugewieseneKunden } from "./data/kundenZugriff";

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
          Alle Kunden-Accounts (Portal-Logins) an einem Ort. Kunden sehen nur die für ihren Kunden
          freigeschalteten Funktionen — read-only, ohne Agenten, Einstellungen oder interne Notizen.
          Mitarbeiter und Admins verwaltest du weiterhin unter «Team».
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
