// Blog-Autopilot: fester Themenplan in der Einrichtung (Schritt 7). Die
// Agentur fügt einen ganzen Plan ein (eine Zeile je Thema) oder erfasst ein
// einzelnes Thema. Die Themen gelten als freigegeben und werden am Termin
// geschrieben.
import { useMemo, useState } from "react";
import { api, Feld, Hinweis, Karte, Knopf, P, eingabe } from "@/ezy/BlogUi";
import { lesePlan, PLAN_MAX } from "@/ezy/blogPlan";

const LEER = {
  title: "",
  date: "",
  audience: "",
  target_question: "",
  citable_element: "",
  keyword: "",
};
const datum = (iso: string) => {
  const [j, m, t] = String(iso).split("-");
  return t ? `${t}.${m}.${j}` : iso;
};

export default function BlogPlanEingabe({
  projektId,
  geplant,
  onGeplant,
}: {
  projektId: string;
  /** Bereits von Hand geplante Themen (keyword, scheduled_for). */
  geplant: any[];
  onGeplant: (art: "plan" | "einzeln") => Promise<void> | void;
}) {
  const [text, setText] = useState("");
  const [einzeln, setEinzeln] = useState(false);
  const [thema, setThema] = useState(LEER);
  const [busy, setBusy] = useState<"plan" | "einzeln" | null>(null);
  const [meldung, setMeldung] = useState<{ ton: "ok" | "fehler"; text: string } | null>(null);
  const gelesen = useMemo(() => lesePlan(text), [text]);

  const sende = async (art: "plan" | "einzeln", body: unknown) => {
    setBusy(art);
    setMeldung(null);
    const r = await api(`/api/blog/projects/${projektId}/topics`, "POST", body);
    setBusy(null);
    if (!r.ok || !r.json?.ok) {
      setMeldung({
        ton: "fehler",
        text: r.json?.error || "Das hat nicht geklappt. Bitte nochmals versuchen.",
      });
      return;
    }
    const neu = Number(r.json.neu ?? 1);
    const doppelt = Number(r.json.doppelt ?? 0);
    setMeldung({
      ton: "ok",
      text:
        `${neu} ${neu === 1 ? "Thema ist" : "Themen sind"} geplant.` +
        (doppelt ? ` ${doppelt} waren schon im Plan und wurden übersprungen.` : ""),
    });
    if (art === "plan") setText("");
    else {
      setThema(LEER);
      setEinzeln(false);
    }
    await onGeplant(art);
  };

  const feld = (k: keyof typeof LEER) => ({
    value: thema[k],
    onChange: (e: { target: { value: string } }) => setThema({ ...thema, [k]: e.target.value }),
    style: eingabe,
  });

  return (
    <Karte style={{ marginTop: 16 }}>
      <h2 style={{ margin: 0, fontSize: 15 }}>Fester Themenplan</h2>
      <div style={{ fontSize: 13.5, color: P.muted }}>
        Gibt es einen Plan aus einer Strategie, füge ihn hier ein. Eine Zeile je Thema, die Felder
        mit «|» getrennt. Datum und Titel genügen.
      </div>
      {geplant.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 6 }}>
          {geplant.map((t) => (
            <li
              key={t.id}
              style={{ display: "grid", gridTemplateColumns: "88px 1fr", gap: 10, fontSize: 13.5 }}
            >
              <span style={{ color: P.muted, fontVariantNumeric: "tabular-nums" }}>
                {datum(t.scheduled_for)}
              </span>
              <span>{t.keyword}</span>
            </li>
          ))}
        </ul>
      )}
      <Feld
        label="Plan einfügen"
        id="plan-text"
        hilfe="Datum | Titel | Zielgruppe | Zielfrage | Zitierfähiges Element"
      >
        <textarea
          id="plan-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="05.01.2027 | Generalversammlung organisieren | Vereine | Wo führen wir unsere GV durch? | Checkliste"
          style={{ ...eingabe, resize: "vertical", fontSize: 13.5, lineHeight: 1.5 }}
        />
      </Feld>
      {gelesen.fehler.length > 0 && (
        <Hinweis ton="fehler">{gelesen.fehler.slice(0, 5).join(" · ")}</Hinweis>
      )}
      {meldung && <Hinweis ton={meldung.ton}>{meldung.text}</Hinweis>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Knopf
          onClick={() => void sende("plan", { topics: gelesen.themen })}
          disabled={
            !!busy ||
            gelesen.themen.length === 0 ||
            gelesen.themen.length > PLAN_MAX ||
            gelesen.fehler.length > 0
          }
        >
          {busy === "plan"
            ? "Wird übernommen…"
            : `${gelesen.themen.length} ${gelesen.themen.length === 1 ? "Thema" : "Themen"} übernehmen`}
        </Knopf>
        {!einzeln && (
          <Knopf art="sekundaer" onClick={() => setEinzeln(true)}>
            Einzelnes Thema erfassen
          </Knopf>
        )}
      </div>
      {einzeln && (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            void sende("einzeln", thema);
          }}
          style={{ display: "flex", flexDirection: "column", gap: 14 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))",
              gap: 14,
            }}
          >
            <Feld label="Titel" id="e-titel">
              <input id="e-titel" maxLength={200} {...feld("title")} />
            </Feld>
            <Feld label="Erscheint am" id="e-datum">
              <input id="e-datum" type="date" {...feld("date")} />
            </Feld>
            <Feld label="Zielgruppe" id="e-zielgruppe">
              <input id="e-zielgruppe" maxLength={300} {...feld("audience")} />
            </Feld>
            <Feld label="Zielfrage" id="e-frage">
              <input id="e-frage" maxLength={300} {...feld("target_question")} />
            </Feld>
            <Feld label="Zitierfähiges Element" id="e-element">
              <input id="e-element" maxLength={500} {...feld("citable_element")} />
            </Feld>
            <Feld label="Keyword (optional)" id="e-keyword">
              <input id="e-keyword" maxLength={120} {...feld("keyword")} />
            </Feld>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Knopf type="submit" disabled={!!busy || thema.title.trim().length < 3 || !thema.date}>
              {busy === "einzeln" ? "Wird geplant…" : "Thema planen"}
            </Knopf>
            <Knopf art="text" onClick={() => setEinzeln(false)}>
              Abbrechen
            </Knopf>
          </div>
        </form>
      )}
    </Karte>
  );
}
