// Chancen-Workflow (18.08.2026, v2 am 21.08.): Status-Modell + stabiler Fingerprint.
//
// Die Chancen-Queue in EzyAI ist ABGELEITET (Site Health, KI-Zitat-Gaps,
// Prompt-Chancen, Kurations-Aufgaben) — es gibt keine Chancen-Tabelle mit
// eigenen IDs. Damit ein gesetzter Status (in Bearbeitung, erledigt, …) einen
// Reload und den nächsten Messlauf überlebt, bekommt jede Chance einen
// deterministischen Fingerprint aus ihrer Art + ihrem stabilen Kern (z. B.
// Issue-ID, Rivalen-Name+Thema, Prompt-Text). Gleiches Signal ⇒ gleicher
// Fingerprint ⇒ gleicher Workflow-Zustand in ai_opportunity_states.

export type OppStatus = "offen" | "in_bearbeitung" | "pausiert" | "erledigt" | "verworfen";

export const OPP_STATUS: Array<{ id: OppStatus; label: string; color: string }> = [
  { id: "offen", label: "Offen", color: "#6366f1" },
  { id: "in_bearbeitung", label: "In Bearbeitung", color: "#f59e0b" },
  { id: "pausiert", label: "Pausiert", color: "#64748b" },
  { id: "erledigt", label: "Erledigt", color: "#0f9d6c" },
  { id: "verworfen", label: "Verworfen", color: "#9ca3af" },
];

// ── SHA-256 (synchron, ohne Dependencies) ────────────────────────────────────
// crypto.subtle wäre async und in nicht-secure Kontexten (http-Preview) nicht
// verfügbar — für Fingerprints reicht eine kleine, deterministische Pure-JS-
// Implementierung (FIPS 180-4, gegen Standard-Testvektoren getestet).
const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

export function sha256Hex(input: string): string {
  // UTF-8-Bytes
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c < 0xdc00 && i + 1 < input.length) {
      // Surrogatpaar
      const lo = input.charCodeAt(++i);
      c = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    } else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  const bitLen = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  // 64-Bit-Länge big-endian (obere 32 Bit reichen für JS-Strings realer Grösse)
  bytes.push(0, 0, 0, (bitLen / 0x100000000) | 0, (bitLen >>> 24) & 0xff, (bitLen >>> 16) & 0xff, (bitLen >>> 8) & 0xff, bitLen & 0xff);

  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  let h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;
  const w = new Array<number>(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < bytes.length; off += 64) {
    for (let t = 0; t < 16; t++) {
      const j = off + t * 4;
      w[t] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) >>> 0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }
    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;
    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((x) => x.toString(16).padStart(8, "0")).join("");
}

// FNV-1a (32 Bit) — NUR noch fürs Legacy-Mapping: so hiessen die Fingerprints
// bis 21.08.; bestehende ai_opportunity_states-Zeilen werden beim ersten
// Editor-Besuch auf das v2-Format migriert (siehe OpportunitiesPanel).
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Kern normalisieren, damit kosmetische Unterschiede (Whitespace, Gross-/
// Kleinschreibung) den Fingerprint nicht ändern.
function normalizeKey(key: string): string {
  return String(key || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * v2-Fingerprint: Art-Präfix + 96 Bit SHA-256 (24 Hex). 32-Bit-FNV hatte bei
 * wachsender Chancen-Zahl ein reales Geburtstagsproblem; 96 Bit sind praktisch
 * kollisionsfrei und bleiben unter dem 80-Zeichen-Kürzungslimit der
 * Notification-Dedupe-Keys.
 */
export function oppFingerprint(kind: string, key: string): string {
  return `${kind}:${sha256Hex(normalizeKey(key)).slice(0, 24)}`;
}

/** Fingerprint im alten FNV-Format (Bestandszeilen vor dem 21.08.). */
export function oppFingerprintLegacy(kind: string, key: string): string {
  return `${kind}:${fnv1a(normalizeKey(key))}`;
}

/**
 * Schlüssel eines Citation-Gaps: Rivale + Thema + Quelle + relevante Fragen.
 * Fragen werden normalisiert und SORTIERT — die Reihenfolge im Messlauf darf
 * den Fingerprint nicht ändern. Verschiedene Themen gegen denselben Rivalen
 * ergeben so getrennte Zustände (vorher kollidierte alles auf dem Rivalen).
 */
export function gapKey(
  rival: string,
  thema: string,
  quelle: string,
  questions: Array<string | null | undefined>,
): string {
  const qs = (questions || [])
    .map((q) => normalizeKey(String(q ?? "")))
    .filter(Boolean)
    .sort();
  return [normalizeKey(rival), normalizeKey(thema), normalizeKey(quelle), ...qs].join("␟");
}

/** Fällig = Wiedervorlagedatum erreicht und Chance noch nicht abgeschlossen. */
export function isResurfaceDue(
  status: string | null | undefined,
  resurfaceOn: string | null | undefined,
  today: string,
): boolean {
  if (!resurfaceOn) return false;
  if (status === "erledigt" || status === "verworfen") return false;
  return String(resurfaceOn) <= today;
}
