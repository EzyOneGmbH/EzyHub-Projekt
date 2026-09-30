// Sistrix-Land je Kunde (30.09.2026): welcher Sistrix-Sichtbarkeitsindex fuer
// den Visibility Index gilt (Standard Schweiz, z. B. Frankreich fuer Romandie-
// Websites). Nur Owner/Admin; wirkt ab der naechsten Backlink-Messung.
import { useEffect, useState } from "react";
import { ezyFetch } from "@/ezy/data/api";
import { SISTRIX_LAENDER, sistrixLandVon } from "@/lib/sistrixLand";
import { CLIENTS_CHANGED_EVENT } from "./AdsPaketTag";
import { C } from "./theme";

export function SistrixLandWahl({ client, onGeaendert = null }) {
  const [land, setLand] = useState(() => sistrixLandVon(client?.metadata));
  const [busy, setBusy] = useState(false);
  const [meldung, setMeldung] = useState("");
  useEffect(() => setLand(sistrixLandVon(client?.metadata)), [client?.id, client?.metadata]);

  const waehle = async (neu) => {
    if (!client?.id || neu === land) return;
    const alt = land;
    setLand(neu);
    setBusy(true);
    setMeldung("");
    try {
      const res = await ezyFetch("/api/sistrix-land", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, land: neu }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || `HTTP ${res.status}`);
      setMeldung("Gespeichert — gilt ab der nächsten Backlink-Messung.");
      try {
        window.dispatchEvent(new Event(CLIENTS_CHANGED_EVENT));
      } catch {
        /* ohne window (Tests) */
      }
      onGeaendert?.(neu);
    } catch (e) {
      setLand(alt);
      setMeldung(`Nicht gespeichert: ${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-end",
        flexWrap: "wrap",
        gap: 8,
        fontSize: 12,
        color: C.textMuted,
      }}
    >
      <label
        htmlFor="sistrix-land"
        title="Welcher Sistrix-Länderindex für den Visibility Index gilt"
      >
        Sistrix-Land für den Visibility Index
      </label>
      <select
        id="sistrix-land"
        value={land}
        disabled={busy}
        onChange={(e) => waehle(e.target.value)}
        style={{
          padding: "4px 8px",
          border: `1px solid ${C.inputBorder}`,
          borderRadius: 7,
          fontSize: 12,
          fontFamily: "inherit",
          background: "#fff",
          color: C.text,
        }}
      >
        {SISTRIX_LAENDER.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      {meldung && (
        <span
          style={{ color: meldung.startsWith("Nicht") ? C.red : C.green, fontWeight: 600 }}
          role="status"
        >
          {meldung}
        </span>
      )}
    </div>
  );
}
