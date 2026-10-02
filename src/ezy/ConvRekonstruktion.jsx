// Karte «Organische Buchungen vor dem Tracking-Fix (Schätzung)» im
// Conversions-Tab (02.10.2026). Daten aus clients.metadata.conv_rekonstruktion,
// siehe lib/convRekonstruktion.ts. Bewusst getrennt von den Live-Kacheln.
import { History } from "lucide-react";
import { monatLabel, rekonstruktionVon } from "@/lib/convRekonstruktion";
import { C } from "./theme";

const chf = (n, w) => (n == null ? "—" : `${Math.round(n).toLocaleString("de-CH")} ${w || "CHF"}`);

export function ConvRekonstruktion({ client }) {
  const r = rekonstruktionVon(client?.metadata);
  if (!r) return null;
  const zelle = { padding: "8px 10px", borderTop: `1px solid ${C.border}`, fontSize: 12.5 };
  return (
    <div
      style={{
        background: C.card,
        border: `1px dashed ${C.border}`,
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <History size={16} color={C.textMuted} />
        <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{r.titel}</div>
      </div>
      {r.methode && (
        <div style={{ fontSize: 11.5, color: C.textDim, marginTop: 6 }}>{r.methode}</div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10 }}>
        <thead>
          <tr style={{ textAlign: "left", fontSize: 11.5, color: C.textMuted }}>
            <th style={{ padding: "6px 10px", fontWeight: 600 }}>Monat</th>
            <th style={{ padding: "6px 10px", fontWeight: 600, textAlign: "right" }}>
              Buchungen (organisch)
            </th>
            <th style={{ padding: "6px 10px", fontWeight: 600, textAlign: "right" }}>Umsatz</th>
            <th style={{ padding: "6px 10px", fontWeight: 600 }}>Zusammensetzung</th>
          </tr>
        </thead>
        <tbody>
          {r.zeilen.map((z) => (
            <tr key={z.monat} style={{ color: C.text }}>
              <td style={{ ...zelle, fontWeight: 600 }}>{monatLabel(z.monat)}</td>
              <td style={{ ...zelle, textAlign: "right" }}>
                {z.buchungen == null ? "—" : `≈ ${Math.round(z.buchungen)}`}
              </td>
              <td style={{ ...zelle, textAlign: "right" }}>
                {z.umsatz == null ? "—" : `≈ ${chf(z.umsatz, z.waehrung)}`}
              </td>
              <td style={{ ...zelle, color: C.textDim }}>{z.detail || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {(r.hinweis || r.stand) && (
        <div style={{ fontSize: 11, color: C.textDim, marginTop: 8 }}>
          {r.hinweis}
          {r.hinweis && r.stand ? " · " : ""}
          {r.stand ? `Stand ${r.stand}` : ""}
        </div>
      )}
    </div>
  );
}

export default ConvRekonstruktion;
