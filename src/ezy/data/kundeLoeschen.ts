// Verstaendliche Meldung, wenn das Loeschen eines Kunden in der Datenbank
// scheitert (28.09.2026) — statt der rohen Postgres-Meldung.

const ADS_PROTOKOLL =
  /ads_(changelog|approvals|guardian_log|change_events|recommendations|recommendation_outcomes)/;

export function loeschFehlerText(e: unknown): string {
  const err = (e ?? {}) as { code?: string; message?: string; details?: string };
  const text = `${err.message ?? ""} ${err.details ?? ""}`;
  // 23503 = Fremdschluessel verhindert das Loeschen (RESTRICT)
  if (err.code === "23503" || /violates foreign key constraint/i.test(text)) {
    if (ADS_PROTOKOLL.test(text))
      return "Kunde kann nicht gelöscht werden: Es gibt ein Google-Ads-Änderungsprotokoll (Autopilot), das aus Nachweisgründen erhalten bleibt. Bitte «Deaktivieren» verwenden.";
    return "Kunde kann nicht gelöscht werden: Es hängen noch Daten an diesem Kunden. Bitte «Deaktivieren» verwenden.";
  }
  // 23502 = Pflichtfeld wuerde beim Loeschen geleert (fehlerhafte Datenbankregel)
  if (err.code === "23502" || /violates not-null constraint/i.test(text))
    return "Löschen fehlgeschlagen: Eine Datenbankregel verhindert das Entfernen der zugehörigen Daten. Der Kunde ist unverändert vorhanden.";
  return err.message || "Löschen fehlgeschlagen";
}
