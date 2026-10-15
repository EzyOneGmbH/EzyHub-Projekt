// Conversion-Log (15.10.2026, Volkan): telefonische Leads je Kunde erfassen —
// Datum, Firma, Telefonnummer, Person, Grund für den Anruf + «eingetragen von».
// Genutzt auf /conversion-log (beschränkte Kunden-Logins, z. B. Studioforma-
// Mitarbeitende) und als Team-Tab in EzyRank. Direkt gegen Supabase (RLS:
// Zugriff auf den Kunden; ändern/löschen nur eigene Einträge, Team alle).
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { C } from "./theme";

const heute = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Zurich" });
const LEER = { datum: "", firma: "", telefon: "", person: "", grund: "" };
const datumCH = (d) => (d ? d.split("-").reverse().join(".") : "");

const eingabe = {
  fontSize: 13,
  padding: "7px 9px",
  borderRadius: 8,
  border: `1px solid ${C.inputBorder}`,
  background: C.surface,
  color: C.text,
  width: "100%",
  boxSizing: "border-box",
  fontFamily: "inherit",
};
const th = {
  textAlign: "left",
  fontSize: 11.5,
  fontWeight: 600,
  color: C.textMuted,
  padding: "8px 10px",
  borderBottom: `1px solid ${C.border}`,
  whiteSpace: "nowrap",
};
const td = {
  fontSize: 13,
  color: C.text,
  padding: "8px 10px",
  borderBottom: `1px solid ${C.hairline}`,
  verticalAlign: "top",
};
const knopf = (primaer) => ({
  padding: "7px 14px",
  fontSize: 12.5,
  fontWeight: 600,
  borderRadius: 8,
  border: `1px solid ${C.accent}`,
  background: primaer ? C.accent : "transparent",
  color: primaer ? "#fff" : C.accent,
  cursor: "pointer",
  whiteSpace: "nowrap",
});
const mini = {
  fontSize: 11.5,
  padding: "3px 8px",
  borderRadius: 6,
  border: `1px solid ${C.border}`,
  background: "transparent",
  color: C.textMuted,
  cursor: "pointer",
};

export default function ConversionLog({ clientId }) {
  const { user, role } = useAuth();
  const team = role === "owner" || role === "admin" || role === "member";
  const [zeilen, setZeilen] = useState([]);
  const [laedt, setLaedt] = useState(true);
  const [neu, setNeu] = useState({ ...LEER, datum: heute() });
  const [bearbeiten, setBearbeiten] = useState(null); // {id, ...felder}
  const [loeschen, setLoeschen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState(null);
  const [suche, setSuche] = useState("");

  const laden = async () => {
    const { data, error } = await supabase
      .from("conversion_log")
      .select("id, datum, firma, telefon, person, grund, created_by, created_by_email, created_at")
      .eq("client_id", clientId)
      .order("datum", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1000);
    if (error) setFehler("Einträge konnten nicht geladen werden.");
    setZeilen(data || []);
    setLaedt(false);
  };

  useEffect(() => {
    setZeilen([]);
    setLaedt(true);
    setFehler(null);
    setBearbeiten(null);
    if (clientId) laden();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const darfAendern = (z) => team || (user && z.created_by === user.id);
  const gueltig = (f) => f.datum && (f.firma.trim() || f.person.trim() || f.telefon.trim());

  const speichern = async () => {
    if (busy || !gueltig(neu)) return;
    setBusy(true);
    setFehler(null);
    const row = {
      client_id: clientId,
      datum: neu.datum,
      firma: neu.firma.trim(),
      telefon: neu.telefon.trim(),
      person: neu.person.trim(),
      grund: neu.grund.trim(),
    };
    const { error } = await supabase.from("conversion_log").insert(row);
    setBusy(false);
    if (error) {
      setFehler("Speichern fehlgeschlagen — bitte erneut versuchen.");
      return;
    }
    setNeu({ ...LEER, datum: neu.datum });
    laden();
  };

  const aendern = async () => {
    if (busy || !bearbeiten || !gueltig(bearbeiten)) return;
    setBusy(true);
    setFehler(null);
    const { id, datum, firma, telefon, person, grund } = bearbeiten;
    const { error } = await supabase
      .from("conversion_log")
      .update({
        datum,
        firma: firma.trim(),
        telefon: telefon.trim(),
        person: person.trim(),
        grund: grund.trim(),
      })
      .eq("id", id);
    setBusy(false);
    if (error) {
      setFehler("Änderung fehlgeschlagen.");
      return;
    }
    setBearbeiten(null);
    laden();
  };

  const entfernen = async (id) => {
    setBusy(true);
    setFehler(null);
    const { error } = await supabase.from("conversion_log").delete().eq("id", id);
    setBusy(false);
    setLoeschen(null);
    if (error) setFehler("Löschen fehlgeschlagen.");
    laden();
  };

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    if (!q) return zeilen;
    return zeilen.filter((z) =>
      [z.firma, z.telefon, z.person, z.grund, z.created_by_email]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [zeilen, suche]);

  const csv = () => {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const kopf = [
      "Datum",
      "Firma",
      "Telefonnummer",
      "Person",
      "Grund für den Anruf",
      "Eingetragen von",
    ];
    const linien = gefiltert.map((z) =>
      [datumCH(z.datum), z.firma, z.telefon, z.person, z.grund, z.created_by_email]
        .map(esc)
        .join(";"),
    );
    const blob = new Blob(["﻿" + [kopf.map(esc).join(";"), ...linien].join("\r\n")], {
      type: "text/csv;charset=utf-8",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `conversion-log-${heute()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const feld = (obj, set, key, props = {}) => (
    <input
      value={obj[key]}
      onChange={(e) => set({ ...obj, [key]: e.target.value })}
      style={eingabe}
      {...props}
    />
  );

  return (
    <div
      style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16 }}
    >
      <div style={{ fontSize: 15, fontWeight: 700, color: C.text, marginBottom: 4 }}>
        Conversion-Log
      </div>
      <div style={{ fontSize: 12, color: C.textDim, marginBottom: 14 }}>
        Relevante Telefonanrufe erfassen. Jeder Eintrag zeigt, mit welchem Login er erfasst wurde.
      </div>

      {/* Neuer Eintrag */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
          gap: 8,
          alignItems: "end",
          padding: 12,
          background: C.bg,
          border: `1px solid ${C.hairline}`,
          borderRadius: 10,
        }}
      >
        <label style={{ fontSize: 11.5, color: C.textMuted }}>
          Datum
          {feld(neu, setNeu, "datum", { type: "date", max: heute() })}
        </label>
        <label style={{ fontSize: 11.5, color: C.textMuted }}>
          Firma
          {feld(neu, setNeu, "firma", { maxLength: 200 })}
        </label>
        <label style={{ fontSize: 11.5, color: C.textMuted }}>
          Telefonnummer
          {feld(neu, setNeu, "telefon", { maxLength: 60, type: "tel" })}
        </label>
        <label style={{ fontSize: 11.5, color: C.textMuted }}>
          Person
          {feld(neu, setNeu, "person", { maxLength: 200 })}
        </label>
        <label style={{ fontSize: 11.5, color: C.textMuted, gridColumn: "1 / -1" }}>
          Grund für den Anruf
          <textarea
            value={neu.grund}
            onChange={(e) => setNeu({ ...neu, grund: e.target.value })}
            maxLength={2000}
            rows={2}
            style={{ ...eingabe, resize: "vertical" }}
          />
        </label>
        <div style={{ gridColumn: "1 / -1", display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            onClick={speichern}
            disabled={busy || !gueltig(neu)}
            style={{ ...knopf(true), opacity: busy || !gueltig(neu) ? 0.5 : 1 }}
          >
            {busy ? "Speichert…" : "Eintrag speichern"}
          </button>
          <span style={{ fontSize: 11.5, color: C.textDim }}>
            Mindestens Firma, Person oder Telefonnummer angeben.
          </span>
        </div>
      </div>

      {fehler && <div style={{ fontSize: 12.5, color: C.red, marginTop: 10 }}>{fehler}</div>}

      {/* Liste */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          justifyContent: "space-between",
          margin: "16px 0 8px",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 12.5, color: C.textMuted }}>
          {laedt ? "Lädt…" : `${gefiltert.length} Einträge`}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            placeholder="Suchen…"
            style={{ ...eingabe, width: 200 }}
          />
          {gefiltert.length > 0 && (
            <button type="button" onClick={csv} style={knopf(false)}>
              CSV exportieren
            </button>
          )}
        </div>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={th}>Datum</th>
              <th style={th}>Firma</th>
              <th style={th}>Telefonnummer</th>
              <th style={th}>Person</th>
              <th style={th}>Grund für den Anruf</th>
              <th style={th}>Eingetragen von</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {gefiltert.map((z) =>
              bearbeiten?.id === z.id ? (
                <tr key={z.id}>
                  <td style={td}>
                    {feld(bearbeiten, setBearbeiten, "datum", { type: "date", max: heute() })}
                  </td>
                  <td style={td}>{feld(bearbeiten, setBearbeiten, "firma", { maxLength: 200 })}</td>
                  <td style={td}>
                    {feld(bearbeiten, setBearbeiten, "telefon", { maxLength: 60 })}
                  </td>
                  <td style={td}>
                    {feld(bearbeiten, setBearbeiten, "person", { maxLength: 200 })}
                  </td>
                  <td style={td}>
                    <textarea
                      value={bearbeiten.grund}
                      onChange={(e) => setBearbeiten({ ...bearbeiten, grund: e.target.value })}
                      maxLength={2000}
                      rows={2}
                      style={{ ...eingabe, resize: "vertical" }}
                    />
                  </td>
                  <td style={{ ...td, color: C.textMuted }}>{z.created_by_email || "—"}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    <button type="button" onClick={aendern} disabled={busy} style={mini}>
                      Speichern
                    </button>{" "}
                    <button type="button" onClick={() => setBearbeiten(null)} style={mini}>
                      Abbrechen
                    </button>
                  </td>
                </tr>
              ) : (
                <tr key={z.id}>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>{datumCH(z.datum)}</td>
                  <td style={td}>{z.firma}</td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {z.telefon ? (
                      <a href={`tel:${z.telefon.replace(/\s+/g, "")}`}>{z.telefon}</a>
                    ) : (
                      ""
                    )}
                  </td>
                  <td style={td}>{z.person}</td>
                  <td style={{ ...td, whiteSpace: "pre-wrap", maxWidth: 360 }}>{z.grund}</td>
                  <td style={{ ...td, color: C.textMuted, fontSize: 12 }}>
                    {z.created_by_email || "—"}
                  </td>
                  <td style={{ ...td, whiteSpace: "nowrap" }}>
                    {darfAendern(z) &&
                      (loeschen === z.id ? (
                        <>
                          <button
                            type="button"
                            onClick={() => entfernen(z.id)}
                            disabled={busy}
                            style={{ ...mini, color: C.red, borderColor: C.red }}
                          >
                            Wirklich löschen
                          </button>{" "}
                          <button type="button" onClick={() => setLoeschen(null)} style={mini}>
                            Nein
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => {
                              setLoeschen(null);
                              setBearbeiten({
                                id: z.id,
                                datum: z.datum,
                                firma: z.firma || "",
                                telefon: z.telefon || "",
                                person: z.person || "",
                                grund: z.grund || "",
                              });
                            }}
                            style={mini}
                          >
                            Bearbeiten
                          </button>{" "}
                          <button type="button" onClick={() => setLoeschen(z.id)} style={mini}>
                            Löschen
                          </button>
                        </>
                      ))}
                  </td>
                </tr>
              ),
            )}
            {!laedt && gefiltert.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...td, color: C.textDim, textAlign: "center" }}>
                  {suche ? "Keine Treffer." : "Noch keine Einträge."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
