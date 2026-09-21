// First-Party-KPIs, Phase 2b (22.09.2026, Volkan): Datenanbindung und
// Speicherung — reine, testbare Logik (Fake-fetch, Fake-DB), keine Route.
//
//  syncGsc        Search Analytics (date x query x page, dataState final),
//                 startRow-Pagination bis leer → gsc_daily (Upsert, 1000er-Bloecke)
//  syncGa4        runReport (date x landingPage x Kanal x Quelle x Medium),
//                 offset-Pagination → ga4_landing_daily (Upsert, 1000er-Bloecke)
//  laufTaeglich   alle freigeschalteten Kunden: Tagesfenster «letzte 3 Tage»
//                 (GSC heute-4..heute-2 wegen Nachlauf, GA4 heute-3..heute-1)
//  backfillSchritt je Kunde/Quelle den naechsten Monatsblock rueckwaerts,
//                 so viele Bloecke, wie das Zeitbudget erlaubt
//  backfillStarten setzt das Ziel (GSC 16 Monate, GA4 14 Monate, Monatsanfang)
//
// Grundsaetze: 429/5xx mit exponentiellem Backoff (1,2,4,8,16 s, max 5
// Versuche, Retry-After hat Vorrang); 401/403 = keine_berechtigung ohne Retry;
// ein Fehler eines Kunden/einer Quelle bricht NIE den Lauf; Status je
// Kunde/Quelle in first_party_sync_status; Fehlertexte redaktiert (max 300).
import { addDays, heuteYmd, istYmd } from "@/lib/date-range";
import { GSC_API, GSC_PAGE_MAX, baueGscRequest } from "./gsc.server";
import { ga4RunReportUrl, ga4Coverage, type Ga4Coverage } from "./ga4.server";
import {
  firstPartyProvider,
  ladeServiceAccountKey,
  redaktiereAuth,
  type AuthArt,
  type GoogleToken,
} from "./google-auth-provider.server";

export type Quelle = "gsc" | "ga4";
export type Zustand = "ok" | "keine_berechtigung" | "fehler" | "ausstehend";

/** Kunden-Flag in clients.metadata (Phase 1). */
export const FLAG_FELD = "first_party_kpi";
/** Backfill-Ziel in Monaten ab heute (Monatsanfang). */
export const BACKFILL_MONATE: Record<Quelle, number> = { gsc: 16, ga4: 14 };
/** Upsert-Blockgroesse. */
export const BLOCK = 1000;
/** GA4 runReport: Zeilen je Seite (API-Maximum 250'000, wir bleiben bei 100'000). */
export const GA4_LIMIT = 100_000;
/** Zeitbudget je Cron-Aufruf (pg_net-Timeout 295 s). */
export const BUDGET_MS = 240_000;
/** Backoff-Stufen fuer 429/5xx (ms). */
export const BACKOFF_MS = [1000, 2000, 4000, 8000, 16000] as const;
export const MAX_VERSUCHE = 5;
export const FEHLER_MAX = 300;

/** Minimaler Supabase-Vertrag (supabaseAdmin oder In-Memory-Double im Test). */
export type Db = { from: (table: string) => any };

export type TokenHolen = (clientId: string) => Promise<GoogleToken>;
export type Schlaf = (ms: number) => Promise<void>;

export type Abhaengigkeiten = {
  fetch?: typeof fetch;
  schlaf?: Schlaf;
  jetztMs?: () => number;
  token?: TokenHolen;
};

export class SyncFehler extends Error {
  constructor(
    message: string,
    public status: number,
    public zustand: Zustand = "fehler",
  ) {
    super(message);
  }
}

const schlafEcht: Schlaf = (ms) => new Promise((r) => setTimeout(r, ms));

/** Standard-Token: Service Account, sonst OAuth des Kunden (Phase 1). */
const tokenStandard: TokenHolen = (clientId) => firstPartyProvider().accessToken(clientId);

/** Fehlertext ohne Schluessel/Tokens, auf FEHLER_MAX gekuerzt. */
export function redaktiereFehler(e: unknown): string {
  const roh = e instanceof Error ? e.message : String(e ?? "");
  let key: ReturnType<typeof ladeServiceAccountKey> = null;
  try {
    key = ladeServiceAccountKey();
  } catch {
    key = null;
  }
  return redaktiereAuth(roh, key).replace(/\s+/g, " ").trim().slice(0, FEHLER_MAX);
}

/** Retry-After (Sekunden oder HTTP-Datum) in ms; null wenn nicht auswertbar. */
export function retryAfterMs(wert: string | null, jetztMs: number): number | null {
  if (!wert) return null;
  const s = wert.trim();
  if (/^\d+$/.test(s)) return Number(s) * 1000;
  const t = Date.parse(s);
  return Number.isFinite(t) ? Math.max(0, t - jetztMs) : null;
}

/**
 * fetch mit Backoff: 429/5xx → warten (Retry-After, sonst 1,2,4,8,16 s), max 5
 * Versuche; 401/403 → SyncFehler keine_berechtigung OHNE Retry; andere
 * Fehlercodes → SyncFehler (fehler). Liefert nur OK-Antworten zurueck.
 */
export async function fetchMitRetry(
  url: string,
  init: RequestInit,
  dep: Abhaengigkeiten = {},
  label = "Google",
): Promise<Response> {
  const f = dep.fetch ?? globalThis.fetch;
  const schlaf = dep.schlaf ?? schlafEcht;
  const jetzt = dep.jetztMs ?? Date.now;
  let letzter: { status: number; text: string } | null = null;
  for (let versuch = 0; versuch < MAX_VERSUCHE; versuch++) {
    const r = await f(url, init);
    if (r.ok) return r;
    const text = await r.text().catch(() => "");
    if (r.status === 401 || r.status === 403)
      throw new SyncFehler(
        `${label} HTTP ${r.status}: keine Berechtigung — ${text.slice(0, 160)}`,
        r.status,
        "keine_berechtigung",
      );
    const wiederholbar = r.status === 429 || r.status >= 500;
    if (!wiederholbar)
      throw new SyncFehler(`${label} HTTP ${r.status}: ${text.slice(0, 200)}`, r.status);
    letzter = { status: r.status, text };
    if (versuch + 1 >= MAX_VERSUCHE) break;
    const ra = retryAfterMs(r.headers.get("retry-after"), jetzt());
    await schlaf(ra ?? BACKOFF_MS[Math.min(versuch, BACKOFF_MS.length - 1)]);
  }
  throw new SyncFehler(
    `${label} HTTP ${letzter?.status ?? "?"} nach ${MAX_VERSUCHE} Versuchen: ${(letzter?.text ?? "").slice(0, 160)}`,
    letzter?.status ?? 0,
  );
}

/** Upsert in Bloecken zu BLOCK Zeilen; Duplikate innerhalb eines Aufrufs zusammengefasst. */
export async function upsertBloecke(
  sb: Db,
  table: string,
  rows: Record<string, unknown>[],
  onConflict: string,
  schluessel: (r: Record<string, unknown>) => string,
): Promise<number> {
  const eindeutig = new Map<string, Record<string, unknown>>();
  for (const r of rows) eindeutig.set(schluessel(r), r);
  const liste = [...eindeutig.values()];
  for (let i = 0; i < liste.length; i += BLOCK) {
    const { error } = await sb
      .from(table)
      .upsert(liste.slice(i, i + BLOCK), { onConflict, ignoreDuplicates: false });
    if (error) throw new SyncFehler(`Upsert ${table}: ${error.message ?? String(error)}`, 0);
  }
  return liste.length;
}

// ── Status je Kunde/Quelle ──────────────────────────────────────────────────
export type StatusPatch = {
  auth_art?: AuthArt | null;
  zustand?: Zustand;
  letzter_lauf_at?: string;
  letzter_erfolg_at?: string;
  letzter_fehler?: string | null;
  backfill_bis?: string | null;
  backfill_ziel?: string | null;
  /** wird ADDIERT auf zeilen_gesamt */
  zeilenPlus?: number;
};

export async function schreibeStatus(
  sb: Db,
  clientId: string,
  quelle: Quelle,
  patch: StatusPatch,
  jetztIso: string = new Date().toISOString(),
): Promise<void> {
  const { zeilenPlus, ...rest } = patch;
  const zeile: Record<string, unknown> = {
    client_id: clientId,
    quelle,
    ...rest,
    updated_at: jetztIso,
  };
  if (zeilenPlus) {
    const { data } = await sb
      .from("first_party_sync_status")
      .select("zeilen_gesamt")
      .eq("client_id", clientId)
      .eq("quelle", quelle)
      .maybeSingle();
    zeile.zeilen_gesamt = Number(data?.zeilen_gesamt ?? 0) + zeilenPlus;
  }
  const { error } = await sb
    .from("first_party_sync_status")
    .upsert(zeile, { onConflict: "client_id,quelle" });
  if (error) throw new SyncFehler(`Status: ${error.message ?? String(error)}`, 0);
}

// ── GSC ─────────────────────────────────────────────────────────────────────
export type GscSyncErgebnis = {
  zeilen: number;
  seiten: number;
  coverage: { rowLimit: number; rows: number; pages: number; truncated: false; dataState: "final" };
};

type GscApiRow = {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};

export async function syncGsc(p: {
  clientId: string;
  siteUrl: string;
  von: string;
  bis: string;
  token: string;
  sb: Db;
  fetch?: typeof fetch;
  schlaf?: Schlaf;
  jetztMs?: () => number;
}): Promise<GscSyncErgebnis> {
  const url = `${GSC_API}/${encodeURIComponent(p.siteUrl)}/searchAnalytics/query`;
  const basis = {
    site: p.siteUrl,
    accessToken: p.token,
    startDate: p.von,
    endDate: p.bis,
    filter: { dataState: "final" as const },
  };
  let startRow = 0;
  let seiten = 0;
  let zeilen = 0;
  for (;;) {
    const body = baueGscRequest(basis, {
      dimensions: ["date", "query", "page"],
      rowLimit: GSC_PAGE_MAX,
      startRow,
    });
    const r = await fetchMitRetry(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${p.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      },
      { fetch: p.fetch, schlaf: p.schlaf, jetztMs: p.jetztMs },
      "GSC",
    );
    const j = (await r.json().catch(() => ({}))) as { rows?: GscApiRow[] };
    seiten++;
    const seite = j.rows ?? [];
    if (seite.length) {
      const rows = seite
        .filter((z) => Array.isArray(z.keys) && z.keys.length >= 3 && istYmd(z.keys[0]))
        .map((z) => ({
          client_id: p.clientId,
          date: z.keys[0],
          query: String(z.keys[1] ?? ""),
          page: String(z.keys[2] ?? ""),
          clicks: Math.round(Number(z.clicks) || 0),
          impressions: Math.round(Number(z.impressions) || 0),
          ctr: Number(z.ctr) || 0,
          position: Number(z.position) || 0,
        }));
      zeilen += await upsertBloecke(
        p.sb,
        "gsc_daily",
        rows,
        "client_id,date,query,page",
        (z) => `${z.date} ${z.query} ${z.page}`,
      );
    }
    if (seite.length < GSC_PAGE_MAX) break;
    startRow += seite.length;
  }
  return {
    zeilen,
    seiten,
    coverage: {
      rowLimit: GSC_PAGE_MAX,
      rows: zeilen,
      pages: seiten,
      truncated: false,
      dataState: "final",
    },
  };
}

// ── GA4 ─────────────────────────────────────────────────────────────────────
export type Ga4SyncErgebnis = { zeilen: number; seiten: number; coverage: Ga4Coverage };

type Ga4ApiRow = {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
};

/** GA4-Datum YYYYMMDD → YYYY-MM-DD (null bei Sonderwerten wie «(other)»). */
export function ga4Datum(roh: string | undefined): string | null {
  const s = String(roh ?? "");
  if (!/^\d{8}$/.test(s)) return null;
  const ymd = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return istYmd(ymd) ? ymd : null;
}

export async function syncGa4(p: {
  clientId: string;
  propertyId: string;
  von: string;
  bis: string;
  token: string;
  sb: Db;
  fetch?: typeof fetch;
  schlaf?: Schlaf;
  jetztMs?: () => number;
}): Promise<Ga4SyncErgebnis> {
  const url = ga4RunReportUrl(p.propertyId);
  let offset = 0;
  let seiten = 0;
  let zeilen = 0;
  let coverage: Ga4Coverage = ga4Coverage({});
  for (;;) {
    const body = {
      dateRanges: [{ startDate: p.von, endDate: p.bis }],
      dimensions: [
        { name: "date" },
        { name: "landingPage" },
        { name: "sessionDefaultChannelGroup" },
        { name: "sessionSource" },
        { name: "sessionMedium" },
      ],
      metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
      limit: GA4_LIMIT,
      offset,
      keepEmptyRows: false,
    };
    const r = await fetchMitRetry(
      url,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${p.token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      },
      { fetch: p.fetch, schlaf: p.schlaf, jetztMs: p.jetztMs },
      "GA4",
    );
    const j = (await r.json().catch(() => ({}))) as { rows?: Ga4ApiRow[]; rowCount?: number };
    seiten++;
    if (seiten === 1) coverage = ga4Coverage(j);
    const seite = j.rows ?? [];
    if (seite.length) {
      const rows: Record<string, unknown>[] = [];
      for (const z of seite) {
        const d = z.dimensionValues ?? [];
        const m = z.metricValues ?? [];
        const date = ga4Datum(d[0]?.value);
        if (!date) continue;
        rows.push({
          client_id: p.clientId,
          date,
          landing_page: String(d[1]?.value ?? ""),
          channel_group: String(d[2]?.value ?? ""),
          session_source: String(d[3]?.value ?? ""),
          session_medium: String(d[4]?.value ?? ""),
          sessions: Math.round(Number(m[0]?.value) || 0),
          engaged_sessions: Math.round(Number(m[1]?.value) || 0),
          key_events: Number(m[2]?.value) || 0,
        });
      }
      zeilen += await upsertBloecke(
        p.sb,
        "ga4_landing_daily",
        rows,
        "client_id,date,landing_page,channel_group,session_source,session_medium",
        (z) =>
          [z.date, z.landing_page, z.channel_group, z.session_source, z.session_medium].join(" "),
      );
    }
    offset += seite.length;
    const total = Number(j.rowCount);
    if (seite.length < GA4_LIMIT || (Number.isFinite(total) && offset >= total)) break;
  }
  return { zeilen, seiten, coverage };
}

// ── Fenster/Zeitrechnung (pure) ─────────────────────────────────────────────
/** Tagesfenster «letzte 3 Tage»: GSC heute-4..heute-2 (Nachlauf), GA4 heute-3..heute-1. */
export function tagesfenster(quelle: Quelle, heute: string): { von: string; bis: string } {
  return quelle === "gsc"
    ? { von: addDays(heute, -4), bis: addDays(heute, -2) }
    : { von: addDays(heute, -3), bis: addDays(heute, -1) };
}

export function monatsanfang(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

/** Monatsanfang des Monats «heute minus n Monate» (UTC). */
export function monateZurueck(heute: string, n: number): string {
  const d = new Date(`${heute}T00:00:00Z`);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - n);
  return d.toISOString().slice(0, 10);
}

/** Backfill-Ziel je Quelle: Monatsanfang von heute − 16 (GSC) bzw. 14 (GA4) Monaten. */
export function backfillZiel(quelle: Quelle, heute: string): string {
  return monateZurueck(heute, BACKFILL_MONATE[quelle]);
}

/**
 * Naechster Monatsblock rueckwaerts: endet am Tag vor backfill_bis (oder am
 * Ende des Tagesfensters, wenn noch nichts geladen), beginnt am Monatsanfang,
 * nie vor backfill_ziel. null = fertig.
 */
export function naechsterBlock(
  quelle: Quelle,
  heute: string,
  backfillBis: string | null,
  backfillZielTag: string,
): { von: string; bis: string } | null {
  const bis = backfillBis ? addDays(backfillBis, -1) : tagesfenster(quelle, heute).bis;
  if (bis < backfillZielTag) return null;
  const von = monatsanfang(bis) > backfillZielTag ? monatsanfang(bis) : backfillZielTag;
  return { von, bis };
}

// ── Kunden ──────────────────────────────────────────────────────────────────
export type Kunde = {
  id: string;
  name: string | null;
  gsc_property: string | null;
  ga4_property: string | null;
  metadata: Record<string, unknown> | null;
};

/** Kunden mit Flag first_party_kpi, nicht pausiert (optional auf einen Kunden begrenzt). */
export async function ladeKunden(sb: Db, nurClientId?: string): Promise<Kunde[]> {
  let q = sb.from("clients").select("id, name, gsc_property, ga4_property, metadata");
  if (nurClientId) q = q.eq("id", nurClientId);
  const { data, error } = await q;
  if (error) throw new SyncFehler(`clients: ${error.message ?? String(error)}`, 0);
  return ((data ?? []) as Kunde[]).filter((c) => {
    const m = (c.metadata ?? {}) as Record<string, unknown>;
    return m[FLAG_FELD] === true && m.status !== "paused";
  });
}

function property(k: Kunde, quelle: Quelle): string | null {
  const v = quelle === "gsc" ? k.gsc_property : k.ga4_property;
  return v ? String(v) : null;
}

/** Ein Fenster einer Quelle laden und den Status fortschreiben (wirft NICHT). */
async function ladeFenster(
  sb: Db,
  k: Kunde,
  quelle: Quelle,
  fenster: { von: string; bis: string },
  token: GoogleToken | null,
  tokenFehler: string | null,
  dep: Abhaengigkeiten,
  jetztIso: string,
): Promise<{ ok: boolean; zeilen: number; fehler: string | null; zustand: Zustand }> {
  const prop = property(k, quelle);
  const fehlschlag = async (zustand: Zustand, fehler: string) => {
    await schreibeStatus(
      sb,
      k.id,
      quelle,
      { auth_art: token?.art ?? null, zustand, letzter_lauf_at: jetztIso, letzter_fehler: fehler },
      jetztIso,
    ).catch(() => {});
    return { ok: false, zeilen: 0, fehler, zustand };
  };
  if (!prop) return fehlschlag("fehler", `Keine ${quelle.toUpperCase()}-Property hinterlegt`);
  if (!token) return fehlschlag("fehler", tokenFehler || "Kein Token");
  try {
    const basis = {
      clientId: k.id,
      von: fenster.von,
      bis: fenster.bis,
      token: token.accessToken,
      sb,
      fetch: dep.fetch,
      schlaf: dep.schlaf,
      jetztMs: dep.jetztMs,
    };
    const erg =
      quelle === "gsc"
        ? await syncGsc({ ...basis, siteUrl: prop })
        : await syncGa4({ ...basis, propertyId: prop });
    await schreibeStatus(
      sb,
      k.id,
      quelle,
      {
        auth_art: token.art,
        zustand: "ok",
        letzter_lauf_at: jetztIso,
        letzter_erfolg_at: jetztIso,
        letzter_fehler: null,
        zeilenPlus: erg.zeilen,
      },
      jetztIso,
    );
    return { ok: true, zeilen: erg.zeilen, fehler: null, zustand: "ok" };
  } catch (e) {
    const zustand: Zustand = e instanceof SyncFehler ? e.zustand : "fehler";
    return fehlschlag(zustand, redaktiereFehler(e));
  }
}

async function tokenSicher(
  dep: Abhaengigkeiten,
  clientId: string,
): Promise<{ token: GoogleToken | null; fehler: string | null }> {
  try {
    return { token: await (dep.token ?? tokenStandard)(clientId), fehler: null };
  } catch (e) {
    return { token: null, fehler: redaktiereFehler(e) };
  }
}

// ── Tageslauf ───────────────────────────────────────────────────────────────
export type LaufErgebnis = {
  clientId: string;
  quelle: Quelle;
  ok: boolean;
  zeilen: number;
  fehler: string | null;
  fenster: { von: string; bis: string } | null;
};

export async function laufTaeglich(p: {
  sb: Db;
  heute?: string;
  nurClientId?: string;
  budgetMs?: number;
  dep?: Abhaengigkeiten;
}): Promise<{ ergebnisse: LaufErgebnis[]; kunden: number; abgebrochen: boolean }> {
  const dep = p.dep ?? {};
  const jetzt = dep.jetztMs ?? Date.now;
  const start = jetzt();
  const heute = p.heute ?? heuteYmd(start);
  const budget = p.budgetMs ?? BUDGET_MS;
  const ergebnisse: LaufErgebnis[] = [];
  let abgebrochen = false;
  const kunden = await ladeKunden(p.sb, p.nurClientId);
  for (const k of kunden) {
    if (jetzt() - start > budget) {
      abgebrochen = true;
      for (const quelle of ["gsc", "ga4"] as Quelle[])
        ergebnisse.push({
          clientId: k.id,
          quelle,
          ok: false,
          zeilen: 0,
          fehler: "Zeitbudget erschoepft — Rest im naechsten Lauf",
          fenster: null,
        });
      continue;
    }
    const { token, fehler: tokenFehler } = await tokenSicher(dep, k.id);
    for (const quelle of ["gsc", "ga4"] as Quelle[]) {
      const fenster = tagesfenster(quelle, heute);
      const jetztIso = new Date(jetzt()).toISOString();
      const r = await ladeFenster(p.sb, k, quelle, fenster, token, tokenFehler, dep, jetztIso);
      ergebnisse.push({
        clientId: k.id,
        quelle,
        ok: r.ok,
        zeilen: r.zeilen,
        fehler: r.fehler,
        fenster,
      });
    }
  }
  return { ergebnisse, kunden: kunden.length, abgebrochen };
}

// ── Backfill ────────────────────────────────────────────────────────────────
export async function backfillStarten(
  sb: Db,
  clientId: string,
  quelle?: Quelle,
  heute: string = heuteYmd(),
): Promise<Array<{ quelle: Quelle; backfill_ziel: string }>> {
  const quellen: Quelle[] = quelle ? [quelle] : ["gsc", "ga4"];
  const out: Array<{ quelle: Quelle; backfill_ziel: string }> = [];
  for (const q of quellen) {
    const ziel = backfillZiel(q, heute);
    await schreibeStatus(sb, clientId, q, {
      backfill_ziel: ziel,
      backfill_bis: null,
      zustand: "ausstehend",
      letzter_fehler: null,
    });
    out.push({ quelle: q, backfill_ziel: ziel });
  }
  return out;
}

export type BackfillBlock = {
  clientId: string;
  quelle: Quelle;
  von: string;
  bis: string;
  ok: boolean;
  zeilen: number;
  fehler: string | null;
  dauerMs: number;
};

export async function backfillSchritt(p: {
  sb: Db;
  jetztMs?: number;
  budgetMs?: number;
  dep?: Abhaengigkeiten;
}): Promise<{
  verarbeitet: number;
  fertig: number;
  offen: number;
  abgebrochen: boolean;
  bloecke: BackfillBlock[];
}> {
  const dep = p.dep ?? {};
  const jetzt = dep.jetztMs ?? (() => p.jetztMs ?? Date.now());
  const start = jetzt();
  const heute = heuteYmd(start);
  const budget = p.budgetMs ?? BUDGET_MS;
  const bloecke: BackfillBlock[] = [];
  let fertig = 0;
  let abgebrochen = false;

  const { data, error } = await p.sb
    .from("first_party_sync_status")
    .select("client_id, quelle, backfill_bis, backfill_ziel, zustand")
    .not("backfill_ziel", "is", null);
  if (error) throw new SyncFehler(`Status lesen: ${error.message ?? String(error)}`, 0);
  const offenAlle = (
    (data ?? []) as Array<{
      client_id: string;
      quelle: Quelle;
      backfill_bis: string | null;
      backfill_ziel: string;
    }>
  ).filter(
    (s) => !!s.backfill_ziel && (s.backfill_bis == null || s.backfill_bis > s.backfill_ziel),
  );
  if (!offenAlle.length)
    return { verarbeitet: 0, fertig: 0, offen: 0, abgebrochen: false, bloecke };

  const kunden = await ladeKunden(p.sb);
  const kundeVon = new Map(kunden.map((k) => [k.id, k]));
  const tokens = new Map<string, { token: GoogleToken | null; fehler: string | null }>();
  // Nur Kunden, die (noch) freigeschaltet sind — pausierte/abgeschaltete bleiben liegen.
  // Reihenfolge: am wenigsten fortgeschritten zuerst (noch nichts geladen vor
  // allen anderen), damit beide Quellen ueber mehrere Cron-Aufrufe fair vorankommen.
  const offen = offenAlle
    .filter((s) => kundeVon.has(s.client_id))
    .sort((a, b) => (b.backfill_bis ?? "9999").localeCompare(a.backfill_bis ?? "9999"));
  let letzteDauer = 0;
  let gestoppt = false;
  // Quelle mit Fehler in diesem Aufruf: nicht erneut versuchen (naechster Cron-Lauf).
  const gesperrt = new Set<string>();

  for (let runde = 0; !gestoppt; runde++) {
    let etwasGetan = false;
    for (const s of offen) {
      const schluessel = `${s.client_id}|${s.quelle}`;
      if (gesperrt.has(schluessel)) continue;
      if (jetzt() - start + letzteDauer > budget) {
        gestoppt = true;
        abgebrochen = true;
        break;
      }
      const k = kundeVon.get(s.client_id)!;
      const block = naechsterBlock(s.quelle, heute, s.backfill_bis, s.backfill_ziel);
      if (!block) {
        if (runde === 0) fertig++;
        continue;
      }
      if (!tokens.has(k.id)) tokens.set(k.id, await tokenSicher(dep, k.id));
      const { token, fehler: tokenFehler } = tokens.get(k.id)!;
      const t0 = jetzt();
      const jetztIso = new Date(t0).toISOString();
      const r = await ladeFenster(p.sb, k, s.quelle, block, token, tokenFehler, dep, jetztIso);
      letzteDauer = jetzt() - t0;
      bloecke.push({
        clientId: k.id,
        quelle: s.quelle,
        von: block.von,
        bis: block.bis,
        ok: r.ok,
        zeilen: r.zeilen,
        fehler: r.fehler,
        dauerMs: letzteDauer,
      });
      if (r.ok) {
        s.backfill_bis = block.von;
        await schreibeStatus(p.sb, k.id, s.quelle, { backfill_bis: block.von }, jetztIso).catch(
          () => {},
        );
        if (block.von <= s.backfill_ziel) fertig++;
        else etwasGetan = true;
      } else {
        // Fehler: Block NICHT fortschreiben, Quelle in diesem Aufruf nicht erneut versuchen.
        gesperrt.add(schluessel);
      }
    }
    if (!etwasGetan) break;
  }
  const restOffen = offen.filter(
    (s) => s.backfill_bis == null || s.backfill_bis > s.backfill_ziel,
  ).length;
  return { verarbeitet: bloecke.length, fertig, offen: restOffen, abgebrochen, bloecke };
}
