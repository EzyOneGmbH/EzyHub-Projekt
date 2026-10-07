// Schweizer Kantone fuer Karte und Top-Liste (geteilt, ohne Karten-Chunk).
// Kantonsmittelpunkte [Laenge, Breite]; Schluessel = normalisierter Google-Name
// (englisch, teils «Canton of …») und deutsche/franzoesische Varianten.
export const KANTONE = [
  [["zurich", "zuerich"], "Zürich", 8.65, 47.42],
  [["bern", "berne"], "Bern", 7.62, 46.82],
  [["lucerne", "luzern"], "Luzern", 8.11, 47.07],
  [["uri"], "Uri", 8.63, 46.77],
  [["schwyz"], "Schwyz", 8.75, 47.06],
  [["obwalden"], "Obwalden", 8.25, 46.85],
  [["nidwalden"], "Nidwalden", 8.4, 46.93],
  [["glarus"], "Glarus", 9.06, 46.98],
  [["zug"], "Zug", 8.54, 47.16],
  [["fribourg", "freiburg"], "Freiburg", 7.08, 46.7],
  [["solothurn"], "Solothurn", 7.64, 47.3],
  [["baselcity", "baselstadt"], "Basel-Stadt", 7.59, 47.56],
  [["basellandschaft", "baselcountry", "basellandschaft"], "Basel-Landschaft", 7.7, 47.45],
  [["schaffhausen"], "Schaffhausen", 8.6, 47.71],
  [["appenzellausserrhoden"], "Appenzell A.Rh.", 9.3, 47.37],
  [["appenzellinnerrhoden"], "Appenzell I.Rh.", 9.42, 47.32],
  [["stgallen", "sanktgallen"], "St. Gallen", 9.25, 47.23],
  [["grisons", "graubuenden", "graubunden"], "Graubünden", 9.63, 46.65],
  [["aargau"], "Aargau", 8.15, 47.4],
  [["thurgau"], "Thurgau", 9.1, 47.57],
  [["ticino", "tessin"], "Tessin", 8.8, 46.3],
  [["vaud", "waadt"], "Waadt", 6.55, 46.57],
  [["valais", "wallis"], "Wallis", 7.6, 46.21],
  [["neuchatel", "neuenburg"], "Neuenburg", 6.78, 47.0],
  [["geneva", "geneve", "genf"], "Genf", 6.15, 46.2],
  [["jura"], "Jura", 7.15, 47.35],
];
const normKanton = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/canton of |kanton |canton de /g, "")
    .replace(/[^a-z]/g, "");
export const kantonFuer = (name) => {
  const k = normKanton(name);
  return KANTONE.find(([keys]) => keys.includes(k)) || null;
};
