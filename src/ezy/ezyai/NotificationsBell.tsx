// NotificationsBell (QS-Runde 13.09.2026): aus src/routes/ezyai.tsx (5.7k Zeilen)
// unveraendert herausgeloest.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Bell } from "lucide-react";

// ── Benachrichtigungs-Glocke (13.08., Volkan) ────────────────────────────────
// Zeigt Sichtbarkeits-Alarme aus app_notifications (Sync-Wächter: Score-
// Einbruch, verlorene Zitierungen, SoV-Überholung). RLS filtert auf die
// Kunden, die der User sehen darf. Klick auf die Glocke öffnet die Liste;
// "Alle gelesen" setzt read_at. Kein Polling — lädt beim Mount und bei Öffnen.
const NOTIF_SEV: Record<string, string> = {
  kritisch: "#dc2626",
  hoch: "#f59e0b",
  mittel: "#6366f1",
  info: "#9ca3af",
};
export function NotificationsBell({ S }: { S: Record<string, string> }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const load = useCallback(async () => {
    const { data } = await (supabase as any)
      .from("app_notifications")
      .select("id, kind, severity, title, body, read_at, created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems(data || []);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const unread = items.filter((i) => !i.read_at).length;
  const markAll = async () => {
    const ids = items.filter((i) => !i.read_at).map((i) => i.id);
    if (!ids.length) return;
    await (supabase as any)
      .from("app_notifications")
      .update({ read_at: new Date().toISOString() })
      .in("id", ids);
    void load();
  };
  return (
    <div style={{ position: "relative" }}>
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        aria-label="Benachrichtigungen"
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 34,
          height: 34,
          borderRadius: 10,
          border: `1px solid ${S.line}`,
          background: open ? S.appTint : "transparent",
          cursor: "pointer",
        }}
      >
        <Bell size={16} color={unread ? S.app : S.mut} />
        {unread > 0 && (
          <span
            style={{
              position: "absolute",
              top: -5,
              right: -5,
              minWidth: 17,
              height: 17,
              borderRadius: 99,
              background: "#dc2626",
              color: "#fff",
              fontSize: 10,
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0 4px",
            }}
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div
            style={{
              position: "absolute",
              top: 40,
              right: 0,
              zIndex: 41,
              width: "min(400px, 90vw)",
              maxHeight: 420,
              overflowY: "auto",
              background: S.panel,
              border: `1px solid ${S.line}`,
              borderRadius: 12,
              boxShadow: "0 10px 30px rgba(0,0,0,.18)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 14px",
                borderBottom: `1px solid ${S.line}`,
                position: "sticky",
                top: 0,
                background: S.panel,
              }}
            >
              <span style={{ fontWeight: 700, fontSize: 13, color: S.txt }}>Meldungen</span>
              {unread > 0 && (
                <button
                  onClick={markAll}
                  style={{
                    marginLeft: "auto",
                    fontSize: 11.5,
                    color: S.app,
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontWeight: 600,
                  }}
                >
                  Alle als gelesen markieren
                </button>
              )}
            </div>
            {!items.length ? (
              <div
                style={{ padding: "22px 14px", textAlign: "center", fontSize: 12.5, color: S.mut }}
              >
                Keine Meldungen — der Sichtbarkeits-Wächter meldet sich bei Score-Einbrüchen,
                verlorenen Zitierungen oder SoV-Überholungen.
              </div>
            ) : (
              items.map((n) => (
                <div
                  key={n.id}
                  style={{
                    display: "flex",
                    gap: 9,
                    padding: "10px 14px",
                    borderBottom: `1px solid ${S.line}`,
                    opacity: n.read_at ? 0.55 : 1,
                  }}
                >
                  <span
                    style={{
                      flexShrink: 0,
                      marginTop: 5,
                      width: 8,
                      height: 8,
                      borderRadius: 99,
                      background: NOTIF_SEV[n.severity] || NOTIF_SEV.info,
                    }}
                  />
                  <div style={{ minWidth: 0 }}>
                    <div
                      style={{ fontSize: 12.5, fontWeight: n.read_at ? 500 : 700, color: S.txt }}
                    >
                      {n.title}
                    </div>
                    {n.body && (
                      <div style={{ fontSize: 11.5, color: S.mut, marginTop: 2 }}>{n.body}</div>
                    )}
                    <div style={{ fontSize: 10.5, color: S.mut, marginTop: 3 }}>
                      {new Date(n.created_at).toLocaleDateString("de-CH", {
                        day: "2-digit",
                        month: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ── Site Health (Searchable-Nachbau "Site Audits", 05.08.2026) ───────────────
