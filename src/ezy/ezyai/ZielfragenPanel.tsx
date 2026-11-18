// ZielfragenPanel (18.11.2026): zeigt je Zielfrage aus der GEO-Strategie, ob
// der Kunde in den KI-Systemen genannt oder als Quelle verlinkt wird, je
// Sprache und System. Liest die Fragen (ai_visibility_prompt_defs, origin =
// "zielfrage") und die Antworten der neuesten Messung direkt über RLS. Startet
// selbst keine Messung: neue Fragen laufen im nächsten Messzyklus mit.
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  SPRACH_NAME,
  ZIEL_ORIGIN,
  ZIEL_SPRACHEN,
  zielAuswertung,
  type ZielDef,
  type ZielMessung,
  type ZielStand,
} from "@/ezy/ezyai/zielfragen";

const STAND: Record<ZielStand, { text: string; farbe: string; grund: string }> = {
  quelle: { text: "Quelle", farbe: "#0f7a43", grund: "rgba(15,122,67,.12)" },
  genannt: { text: "Genannt", farbe: "#77008C", grund: "rgba(119,0,140,.10)" },
  nicht: { text: "Nicht genannt", farbe: "#5d5563", grund: "rgba(43,0,51,.06)" },
  offen: { text: "Keine Antwort", farbe: "#8a8490", grund: "transparent" },
};

const datum = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("de-CH", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : "";

function Marke({ stand }: { stand: ZielStand }) {
  const s = STAND[stand];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 9px",
        borderRadius: 99,
        fontSize: 11.5,
        fontWeight: 600,
        whiteSpace: "nowrap",
        color: s.farbe,
        background: s.grund,
        border: stand === "offen" ? "1px dashed rgba(43,0,51,.18)" : "1px solid transparent",
      }}
    >
      {s.text}
    </span>
  );
}

function Kachel({
  S,
  titel,
  wert,
  total,
  ziel,
  hilfe,
}: {
  S: Record<string, string>;
  titel: string;
  wert: number;
  total: number;
  ziel: number;
  hilfe: string;
}) {
  const erreicht = total > 0 && wert >= ziel;
  return (
    <div
      style={{
        flex: "1 1 240px",
        minWidth: 0,
        background: S.panel,
        border: `1px solid ${S.line}`,
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ fontSize: 12.5, color: S.mut, fontWeight: 600 }}>{titel}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: 30, fontWeight: 800, lineHeight: 1 }}>{wert}</span>
        <span style={{ fontSize: 14, color: S.mut }}>von {total}</span>
        <span
          style={{
            marginLeft: "auto",
            fontSize: 11.5,
            fontWeight: 600,
            padding: "2px 9px",
            borderRadius: 99,
            color: erreicht ? "#0f7a43" : S.mut,
            background: erreicht ? "rgba(15,122,67,.12)" : "rgba(43,0,51,.06)",
          }}
        >
          Ziel {ziel} von {total}
        </span>
      </div>
      <div
        aria-hidden
        style={{ height: 6, borderRadius: 99, background: "rgba(43,0,51,.07)", overflow: "hidden" }}
      >
        <div
          style={{
            height: "100%",
            width: `${total > 0 ? Math.round((Math.min(wert, total) / total) * 100) : 0}%`,
            borderRadius: 99,
            background: erreicht ? "#0f7a43" : S.app,
          }}
        />
      </div>
      <div style={{ fontSize: 12, color: S.mut, lineHeight: 1.45 }}>{hilfe}</div>
    </div>
  );
}

export function ZielfragenPanel({
  clientId,
  S,
  darfPflegen,
}: {
  clientId: string;
  S: Record<string, string>;
  darfPflegen: boolean;
}) {
  const [defs, setDefs] = useState<ZielDef[] | null>(null);
  const [messungen, setMessungen] = useState<ZielMessung[]>([]);
  const [fehler, setFehler] = useState("");
  const [beschaeftigt, setBeschaeftigt] = useState("");
  const [thema, setThema] = useState("");
  const [sprache, setSprache] = useState<string>("de");
  const [frage, setFrage] = useState("");

  const ladeDefs = useCallback(async () => {
    const { data, error } = await (supabase as any)
      .from("ai_visibility_prompt_defs")
      .select("id, prompt, topic, language, active")
      .eq("client_id", clientId)
      .eq("origin", ZIEL_ORIGIN)
      .order("created_at", { ascending: true });
    if (error) {
      setFehler("Die Zielfragen liessen sich nicht laden.");
      return null;
    }
    return (data ?? []) as ZielDef[];
  }, [clientId]);

  useEffect(() => {
    let alive = true;
    setDefs(null);
    setMessungen([]);
    setFehler("");
    (async () => {
      const d = await ladeDefs();
      if (!alive) return;
      setDefs(d ?? []);
      if (!d?.length) return;
      const { data: rep } = await (supabase as any)
        .from("ai_visibility_reports")
        .select("id")
        .eq("client_id", clientId)
        .order("snapshot_date", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!rep?.id) return;
      const zeilen: ZielMessung[] = [];
      for (let from = 0; ; from += 1000) {
        const { data } = await (supabase as any)
          .from("ai_visibility_prompts")
          .select("prompt, platform, status, checked_at")
          .eq("report_id", rep.id)
          .range(from, from + 999);
        zeilen.push(...((data ?? []) as ZielMessung[]));
        if (!data || data.length < 1000) break;
      }
      if (alive) setMessungen(zeilen);
    })();
    return () => {
      alive = false;
    };
  }, [clientId, ladeDefs]);

  const a = useMemo(() => zielAuswertung(defs ?? [], messungen), [defs, messungen]);
  const zielGenannt = Math.ceil((a.total * 2) / 3);
  const zielQuelle = Math.ceil(a.total / 2);
  const themenNamen = useMemo(() => a.themen.map((t) => t.thema), [a]);

  const neuLaden = async () => {
    const d = await ladeDefs();
    if (d) setDefs(d);
  };

  const hinzufuegen = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = frage.trim();
    const th = thema.trim();
    if (!text || !th) return;
    if ((defs ?? []).some((d) => d.prompt.trim() === text)) {
      setFehler("Diese Frage gibt es schon.");
      return;
    }
    setBeschaeftigt("neu");
    setFehler("");
    const { error } = await (supabase as any).from("ai_visibility_prompt_defs").insert({
      client_id: clientId,
      prompt: text,
      topic: th,
      language: sprache,
      country: "Schweiz",
      active: true,
      needs_review: false,
      prompt_type: "markt",
      origin: ZIEL_ORIGIN,
    });
    if (error) setFehler("Die Frage liess sich nicht speichern.");
    else {
      setFrage("");
      await neuLaden();
    }
    setBeschaeftigt("");
  };

  const schalte = async (d: ZielDef) => {
    setBeschaeftigt(d.id);
    setFehler("");
    const { error } = await (supabase as any)
      .from("ai_visibility_prompt_defs")
      .update({ active: !d.active })
      .eq("id", d.id);
    if (error) setFehler("Die Änderung liess sich nicht speichern.");
    else await neuLaden();
    setBeschaeftigt("");
  };

  const feld: React.CSSProperties = {
    padding: "8px 10px",
    borderRadius: 8,
    border: `1px solid ${S.line}`,
    background: S.panel,
    color: S.txt,
    fontSize: 13,
    minWidth: 0,
  };
  const zelle: React.CSSProperties = {
    padding: "9px 12px",
    borderTop: `1px solid ${S.line}`,
    fontSize: 12.5,
    verticalAlign: "middle",
  };
  const kopf: React.CSSProperties = {
    padding: "8px 12px",
    textAlign: "left",
    fontSize: 11.5,
    fontWeight: 600,
    color: S.mut,
    whiteSpace: "nowrap",
  };

  if (defs === null) return <div style={{ color: S.mut, fontSize: 13, padding: 20 }}>Lade…</div>;

  const offen = a.total - a.gemessen;
  const formular = darfPflegen && (
    <form
      onSubmit={hinzufuegen}
      style={{
        background: S.panel,
        border: `1px solid ${S.line}`,
        borderRadius: 14,
        padding: "16px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 14.5, fontWeight: 700 }}>Zielfrage hinzufügen</div>
      <div style={{ fontSize: 12, color: S.mut, lineHeight: 1.45 }}>
        Das Thema bündelt die Sprachfassungen einer Frage. Für eine Übersetzung wählst du dasselbe
        Thema und eine andere Sprache. Neue Fragen laufen ab der nächsten Messung mit.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          aria-label="Thema"
          placeholder="Thema, z. B. Generalversammlung"
          list="zielfragen-themen"
          value={thema}
          onChange={(e) => setThema(e.target.value)}
          maxLength={120}
          style={{ ...feld, flex: "1 1 220px" }}
        />
        <datalist id="zielfragen-themen">
          {themenNamen.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
        <select
          aria-label="Sprache"
          value={sprache}
          onChange={(e) => setSprache(e.target.value)}
          style={{ ...feld, flex: "0 0 150px" }}
        >
          {ZIEL_SPRACHEN.map((s) => (
            <option key={s} value={s}>
              {SPRACH_NAME[s]}
            </option>
          ))}
        </select>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <input
          aria-label="Frage"
          placeholder="Frage, wie sie jemand einem KI-System stellt"
          value={frage}
          onChange={(e) => setFrage(e.target.value)}
          maxLength={400}
          style={{ ...feld, flex: "1 1 320px" }}
        />
        <button
          type="submit"
          disabled={!frage.trim() || !thema.trim() || beschaeftigt === "neu"}
          style={{
            padding: "8px 16px",
            borderRadius: 8,
            border: "none",
            background: S.app,
            color: "#fff",
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
            opacity: !frage.trim() || !thema.trim() || beschaeftigt === "neu" ? 0.5 : 1,
          }}
        >
          Hinzufügen
        </button>
      </div>
    </form>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 1100 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 800 }}>Zielfragen</div>
        <div style={{ fontSize: 13, color: S.mut, lineHeight: 1.5, marginTop: 4, maxWidth: 720 }}>
          Die Fragen aus der Strategie, bei denen du in den KI-Antworten genannt werden sollst. Eine
          Frage zählt, sobald sie in mindestens einer Sprache von mindestens einem KI-System
          beantwortet und du dabei genannt wirst.
        </div>
      </div>

      {fehler && (
        <div
          role="alert"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid rgba(190,30,45,.35)",
            color: "#b3261e",
            fontSize: 12.5,
          }}
        >
          {fehler}
        </div>
      )}

      {a.themen.length === 0 ? (
        <div
          style={{
            background: S.panel,
            border: `1px solid ${S.line}`,
            borderRadius: 14,
            padding: "28px 22px",
            fontSize: 13.5,
            color: S.mut,
            lineHeight: 1.5,
          }}
        >
          {darfPflegen
            ? "Noch keine Zielfragen erfasst. Trag unten die Fragen aus der Strategie ein."
            : "Für dich sind noch keine Zielfragen erfasst."}
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16 }}>
            <Kachel
              S={S}
              titel="Genannt"
              wert={a.genannt}
              total={a.total}
              ziel={zielGenannt}
              hilfe="Zielfragen, bei denen ein KI-System dich in der Antwort nennt."
            />
            <Kachel
              S={S}
              titel="Als Quelle verlinkt"
              wert={a.quelle}
              total={a.total}
              ziel={zielQuelle}
              hilfe="Zielfragen, bei denen ein KI-System deine Website als Quelle angibt."
            />
          </div>

          <div style={{ fontSize: 12.5, color: S.mut, lineHeight: 1.5 }}>
            {a.stand
              ? `Stand der Messung: ${datum(a.stand)}. Geantwortet ${
                  a.systeme.length === 1 ? "hat" : "haben"
                }: ${a.systeme.join(", ")}.`
              : "Zu diesen Fragen gibt es noch keine Messung. Sie laufen im nächsten Messzyklus mit."}
            {a.stand && offen > 0
              ? ` ${offen} von ${a.total} ${offen === 1 ? "Frage ist" : "Fragen sind"} noch nicht gemessen.`
              : ""}
          </div>

          <div
            style={{
              background: S.panel,
              border: `1px solid ${S.line}`,
              borderRadius: 14,
              overflowX: "auto",
            }}
          >
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
              <thead>
                <tr>
                  <th style={kopf}>Frage</th>
                  <th style={kopf}>Sprache</th>
                  {a.systeme.map((s) => (
                    <th key={s} style={kopf}>
                      {s}
                    </th>
                  ))}
                  {darfPflegen && <th style={kopf} />}
                </tr>
              </thead>
              {a.themen.map((t) => (
                <tbody key={t.thema}>
                  <tr>
                    <td
                      colSpan={2 + a.systeme.length + (darfPflegen ? 1 : 0)}
                      style={{
                        ...zelle,
                        background: "rgba(43,0,51,.03)",
                        fontWeight: 700,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ marginRight: 10 }}>{t.thema}</span>
                      <Marke
                        stand={
                          t.quelle
                            ? "quelle"
                            : t.genannt
                              ? "genannt"
                              : t.gemessen
                                ? "nicht"
                                : "offen"
                        }
                      />
                    </td>
                  </tr>
                  {t.zeilen.map((z) => (
                    <tr key={z.def.id} style={{ opacity: z.def.active ? 1 : 0.55 }}>
                      <td style={{ ...zelle, minWidth: 260, lineHeight: 1.45 }}>
                        {z.def.prompt}
                        {!z.def.active && (
                          <span style={{ color: S.mut, marginLeft: 8, fontSize: 11.5 }}>
                            pausiert
                          </span>
                        )}
                      </td>
                      <td style={{ ...zelle, whiteSpace: "nowrap", color: S.mut }}>
                        {SPRACH_NAME[z.sprache] ?? z.sprache}
                      </td>
                      {a.systeme.map((s) => (
                        <td key={s} style={zelle}>
                          <Marke stand={z.zellen[s] ?? "offen"} />
                        </td>
                      ))}
                      {darfPflegen && (
                        <td style={{ ...zelle, textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={() => void schalte(z.def)}
                            disabled={beschaeftigt === z.def.id}
                            style={{
                              border: "none",
                              background: "transparent",
                              color: S.app,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: "pointer",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {z.def.active ? "Pausieren" : "Aktivieren"}
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </>
      )}

      {formular}
    </div>
  );
}
