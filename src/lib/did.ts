// Difference-in-Differences (First-Party GEO, 22.09.2026, Volkan) nach dem
// seo-monster-Ansatz: Wirkung einer Massnahme auf behandelte Seiten gegen
// eine Kontrollgruppe unveraenderter Seiten. Isomorph, rein, ohne Rundung —
// die Aufbereitung fuer die API rundet.
//
//  ratio_i        = post_i / prae_i je Kontrollseite (nur prae >= minPraeClicks)
//  mean, se       = Mittel und Standardfehler (Stichproben-Stdabw / sqrt(n))
//  ratioLo/Hi     = mean -/+ 1.96 * se (95-%-Intervall)
//  counterfactual = treatedPrae * mean  («was waere ohne Massnahme passiert»)
//  lift           = treatedPost - counterfactual, liftLo/Hi aus ratioHi/Lo
//  Verdikt        = likely_positive (liftLo > 0), likely_negative (liftHi < 0),
//                   sonst inconclusive; insufficient_data (keine Prae-Klicks der
//                   behandelten Seiten), insufficient_control (n < minKontrollen)

export type PraePost = { prae: number; post: number };

export type DidVerdikt =
  | "likely_positive"
  | "likely_negative"
  | "inconclusive"
  | "insufficient_data"
  | "insufficient_control";

export type DidErgebnis = {
  behandelt: { seiten: number; praeClicks: number; postClicks: number };
  kontrolle: {
    /** Kontrollseiten, die in die Rechnung eingehen (prae >= minPraeClicks). */
    seiten: number;
    ratioMittel: number | null;
    ratioSe: number | null;
    ratioLo: number | null;
    ratioHi: number | null;
  };
  counterfactual: number | null;
  lift: number | null;
  liftLo: number | null;
  liftHi: number | null;
  verdikt: DidVerdikt;
};

export type DidEingabe = {
  behandelt: Map<string, PraePost>;
  kontrolle: Map<string, PraePost>;
  /** Mindestanzahl gueltiger Kontrollseiten (Default 3). */
  minKontrollen?: number;
  /** Mindest-Prae-Klicks je Kontrollseite, sonst ist die Ratio unbrauchbar (Default 5). */
  minPraeClicks?: number;
};

const Z_95 = 1.96;

export function mittel(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Stichproben-Standardabweichung (n-1); 0 bei n < 2. */
export function stdevStichprobe(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mittel(xs);
  const ss = xs.reduce((a, x) => a + (x - m) * (x - m), 0);
  return Math.sqrt(ss / (xs.length - 1));
}

const summe = (m: Map<string, PraePost>, k: keyof PraePost) =>
  [...m.values()].reduce((a, v) => a + (Number(v[k]) || 0), 0);

export function differenceInDifferences(e: DidEingabe): DidErgebnis {
  const minKontrollen = e.minKontrollen ?? 3;
  const minPraeClicks = e.minPraeClicks ?? 5;

  const behandelt = {
    seiten: e.behandelt.size,
    praeClicks: summe(e.behandelt, "prae"),
    postClicks: summe(e.behandelt, "post"),
  };
  const leer = {
    counterfactual: null,
    lift: null,
    liftLo: null,
    liftHi: null,
  };

  const ratios = [...e.kontrolle.values()]
    .filter((v) => (Number(v.prae) || 0) > 0 && (Number(v.prae) || 0) >= minPraeClicks)
    .map((v) => (Number(v.post) || 0) / Number(v.prae));
  const n = ratios.length;
  const kontrolleLeer = {
    seiten: n,
    ratioMittel: null,
    ratioSe: null,
    ratioLo: null,
    ratioHi: null,
  };

  if (behandelt.seiten === 0 || behandelt.praeClicks <= 0)
    return { behandelt, kontrolle: kontrolleLeer, ...leer, verdikt: "insufficient_data" };
  if (n < minKontrollen)
    return { behandelt, kontrolle: kontrolleLeer, ...leer, verdikt: "insufficient_control" };

  const ratioMittel = mittel(ratios);
  const ratioSe = stdevStichprobe(ratios) / Math.sqrt(n);
  const ratioLo = ratioMittel - Z_95 * ratioSe;
  const ratioHi = ratioMittel + Z_95 * ratioSe;

  const counterfactual = behandelt.praeClicks * ratioMittel;
  const lift = behandelt.postClicks - counterfactual;
  const liftLo = behandelt.postClicks - behandelt.praeClicks * ratioHi;
  const liftHi = behandelt.postClicks - behandelt.praeClicks * ratioLo;

  const verdikt: DidVerdikt =
    liftLo > 0 ? "likely_positive" : liftHi < 0 ? "likely_negative" : "inconclusive";

  return {
    behandelt,
    kontrolle: { seiten: n, ratioMittel, ratioSe, ratioLo, ratioHi },
    counterfactual,
    lift,
    liftLo,
    liftHi,
    verdikt,
  };
}
