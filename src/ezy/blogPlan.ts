// Blog-Autopilot: einen festen Themenplan aus eingefügtem Text lesen.
// Eine Zeile je Thema, Felder mit «|» oder Tabulator getrennt:
// Datum | Titel | Zielgruppe | Zielfrage | Zitierfähiges Element | Keyword
// Nur Datum und Titel sind Pflicht. Datum als 2027-01-12 oder 12.01.2027.

export type PlanThema = {
  title: string;
  date: string;
  audience: string;
  target_question: string;
  citable_element: string;
  keyword: string;
};

export const PLAN_MAX = 24;
const GRENZEN = { title: 200, audience: 300, target_question: 300, citable_element: 500 };

/** «12.01.2027» oder «2027-01-12» → «2027-01-12»; sonst null. */
export function planDatum(roh: string): string | null {
  const t = roh.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  const ch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t);
  const [j, m, d] = iso
    ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
    : ch
      ? [Number(ch[3]), Number(ch[2]), Number(ch[1])]
      : [0, 0, 0];
  if (!j) return null;
  const dt = new Date(Date.UTC(j, m - 1, d));
  if (dt.getUTCFullYear() !== j || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${j}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function lesePlan(text: string): { themen: PlanThema[]; fehler: string[] } {
  const themen: PlanThema[] = [];
  const fehler: string[] = [];
  const zeilen = text
    .split(/\r?\n/)
    .map((z, i) => ({ z: z.trim(), nr: i + 1 }))
    .filter((x) => x.z && !x.z.startsWith("#"));
  for (const { z, nr } of zeilen) {
    const f = z.split(z.includes("|") ? "|" : "\t").map((x) => x.trim());
    const date = planDatum(f[0] ?? "");
    const title = f[1] ?? "";
    // Kopfzeile («Datum | Titel | …») still überspringen
    if (!date && /^datum$/i.test(f[0] ?? "")) continue;
    if (!date) fehler.push(`Zeile ${nr}: Datum fehlt oder ist ungültig`);
    else if (title.length < 3) fehler.push(`Zeile ${nr}: Titel fehlt`);
    else if (title.length > GRENZEN.title) fehler.push(`Zeile ${nr}: Titel ist zu lang`);
    else
      themen.push({
        date,
        title,
        audience: (f[2] ?? "").slice(0, GRENZEN.audience),
        target_question: (f[3] ?? "").slice(0, GRENZEN.target_question),
        citable_element: (f[4] ?? "").slice(0, GRENZEN.citable_element),
        keyword: (f[5] ?? "").slice(0, 120),
      });
  }
  if (themen.length > PLAN_MAX) fehler.push(`Höchstens ${PLAN_MAX} Themen auf einmal`);
  return { themen, fehler };
}
