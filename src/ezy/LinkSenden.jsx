// Einladung/Passwort-Link erneut senden (04.11.2026, Volkan): Status-Badge und
// Knopf für Logins in Team, Kunden-Zugriff und Portal-Zugängen. Server:
// /api/admin/team action "resend" (unbestätigt -> Einladung, sonst Passwort-Link).
import { useState } from "react";
import { Badge, Btn, useToast } from "./shared-ui";
import { C } from "./theme";

const datum = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}.`;
};

/** Zeigt nur etwas, wenn der Login noch nicht aktiv ist. */
export function LinkStatusBadge({ u }) {
  if (u.status === "eingeladen")
    return (
      <Badge color={C.orange}>
        Einladung offen{u.linkGesendet ? ` · Link vom ${datum(u.linkGesendet)}` : ""}
      </Badge>
    );
  if (u.status === "bestaetigt") return <Badge color={C.textDim}>noch nie angemeldet</Badge>;
  return null;
}

/** Knopf «Link erneut senden». callTeam = POST /api/admin/team (liefert JSON). */
export function LinkSendenBtn({ u, callTeam, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const einladung = u.status === "eingeladen";
  const senden = async () => {
    const wen = u.email || "diesen Login";
    const frage = einladung
      ? `Einladung an ${wen} erneut senden? Der neue Link gilt 24 Stunden.`
      : `Link zum Passwort-Setzen an ${wen} senden? Der Link gilt 24 Stunden.`;
    if (!window.confirm(frage)) return;
    setBusy(true);
    const j = await callTeam({ action: "resend", userId: u.userId });
    setBusy(false);
    if (j.ok) {
      toast(
        j.art === "einladung"
          ? `Einladung an ${j.email || wen} erneut gesendet`
          : `Passwort-Link an ${j.email || wen} gesendet`,
        "success",
      );
      onDone?.();
    } else toast(j.error || "Link konnte nicht gesendet werden", "error");
  };
  return (
    <Btn variant="secondary" size="sm" disabled={busy} onClick={senden}>
      {busy ? "Sende…" : einladung ? "Einladung erneut senden" : "Passwort-Link senden"}
    </Btn>
  );
}

/**
 * Knopf «Neues Passwort» (17.11.2026): erzeugt serverseitig ein zufälliges
 * Passwort, setzt es im Konto und zeigt es EINMAL an. Es wird nirgends
 * gespeichert; nach dem Schliessen ist es nicht mehr abrufbar.
 */
export function PasswortBtn({ u, callTeam, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [neu, setNeu] = useState(null);
  const wen = u.email || "diesen Login";
  const erzeugen = async () => {
    if (
      !window.confirm(
        `Neues Passwort für ${wen} erzeugen? Das bisherige Passwort gilt danach nicht mehr.`,
      )
    )
      return;
    setBusy(true);
    const j = await callTeam({ action: "neuesPasswort", userId: u.userId });
    setBusy(false);
    if (j.ok && j.passwort) setNeu({ passwort: j.passwort, email: j.email || wen });
    else toast(j.error || "Passwort konnte nicht erzeugt werden", "error");
  };
  const kopieren = async () => {
    try {
      await navigator.clipboard.writeText(neu.passwort);
      toast("Passwort kopiert", "success");
    } catch {
      toast("Kopieren nicht möglich. Bitte von Hand markieren.", "error");
    }
  };
  const schliessen = () => {
    setNeu(null);
    onDone?.();
  };
  return (
    <>
      <Btn variant="secondary" size="sm" disabled={busy} onClick={erzeugen}>
        {busy ? "Erzeuge…" : "Neues Passwort"}
      </Btn>
      {neu && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Neues Passwort"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <div
            style={{
              background: C.surface,
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: 12,
              padding: 20,
              width: "100%",
              maxWidth: 440,
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 700 }}>Neues Passwort</div>
            <div style={{ fontSize: 13, color: C.textDim, overflowWrap: "anywhere" }}>
              Für {neu.email}. Das Passwort ist gesetzt und wird nur jetzt angezeigt. Gib es auf
              einem sicheren Weg weiter.
            </div>
            <input
              readOnly
              value={neu.passwort}
              onFocus={(e) => e.target.select()}
              aria-label="Neues Passwort"
              style={{
                padding: "10px 12px",
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                background: C.bg,
                color: C.text,
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                fontSize: 15,
                letterSpacing: 0.5,
                width: "100%",
                boxSizing: "border-box",
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Btn variant="secondary" size="sm" onClick={kopieren}>
                Kopieren
              </Btn>
              <Btn size="sm" onClick={schliessen}>
                Schliessen
              </Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
