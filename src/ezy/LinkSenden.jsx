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
