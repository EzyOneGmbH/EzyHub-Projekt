// Read-only REST-API v1 fuer ChatGPT (Custom-GPT-Action) — 28.09.2026.
//
// Zweck: kundenuebergreifende SEO-Analysen («welche Kunden haben seit dem
// 24.09. Ranking-Verluste und welche Gemeinsamkeiten?»). Die API liefert NUR
// Daten, keine Interpretation, und kennt nur GET (plus OPTIONS fuer CORS).
//
// Ablauf je Anfrage (readApiHandler):
//   Auth (Bearer ezyi_ra_…, authenticateReadApi) → Parameter validieren (zod)
//   → Projekt gegen die Organisation des Tokens pruefen (Mandantentrennung)
//   → Ausfuehren → einheitliche Antwort {data, pagination, meta}
//   → Header (no-store, X-Request-Id, CORS) → logReadApi (fail-soft).
// Fehlerformat immer {error:{code,message}}; 500er sind redaktiert (nie
// PostgREST-Details, nie Stacktraces).
//
// Sicherheit: Es werden ausschliesslich die unten explizit gemappten Felder
// ausgegeben — nie clients.metadata, Passwoerter, Google-/OAuth-Tokens,
// api_key_enc o. ae. Jede Abfrage ist ueber organization_id (bzw. einen vorher
// gegen die Organisation geprueften Kunden) eingeschraenkt.
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { authenticateReadApi, logReadApi } from "@/server/ingest-auth.server";
import { clientIp } from "@/server/rate-limit.server";
import { ZeitraumFehler, addDays, heuteYmd, istYmd, zeitraum } from "@/lib/date-range";

// rank_daily / rank_changes / visibility_daily sind (noch) nicht in den
// generierten Supabase-Typen — bewusst untypisierter Zugriff.
const sb = (): any => supabaseAdmin as any;

// ── Konstanten ───────────────────────────────────────────────────────────────
export const MAX_TAGE = 400;
export const DEFAULT_TAGE = 28;
export const LIMIT_DEFAULT = 100;
export const LIMIT_MAX = 1000;
/** PostgREST liefert je Anfrage hoechstens 1000 Zeilen → seitenweise lesen. */
const SEITE = 1000;
/** Obergrenze gelesener Rohzeilen fuer serverseitige Aggregationen. */
export const SCAN_MAX = 100_000;
/** previous_position: so weit wird vor dem aeltesten Seiten-Datum zurueckgeschaut. */
export const VORWERT_LOOKBACK_TAGE = 60;
const HISTORIE_MAX = 50_000;

export const FLAG_FIRST_PARTY = "first_party_kpi";

// ── Fehler und Antworten ─────────────────────────────────────────────────────
export class ApiFehler extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const CORS_HEADER: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Request-Id",
  "Access-Control-Expose-Headers": "X-Request-Id, Retry-After",
  "Access-Control-Max-Age": "86400",
};

function basisHeader(requestId: string): Headers {
  const h = new Headers(CORS_HEADER);
  h.set("Cache-Control", "no-store");
  h.set("X-Request-Id", requestId);
  return h;
}

function jsonAntwort(status: number, body: unknown, requestId: string, extra?: Headers): Response {
  const h = basisHeader(requestId);
  h.set("Content-Type", "application/json; charset=utf-8");
  extra?.forEach((v, k) => h.set(k, v));
  return new Response(JSON.stringify(body), { status, headers: h });
}

export function fehlerAntwort(
  status: number,
  code: string,
  message: string,
  requestId: string,
  extra?: Headers,
): Response {
  return jsonAntwort(status, { error: { code, message } }, requestId, extra);
}

const AUTH_CODES: Record<number, [string, string]> = {
  401: ["unauthorized", "Missing or invalid bearer token."],
  403: ["forbidden", "Token is not allowed to access this API."],
  429: ["rate_limited", "Too many requests. Please retry later."],
};

// ── Parameter ────────────────────────────────────────────────────────────────
const ganz = (name: string, min: number, max: number) =>
  z
    .string()
    .regex(/^\d+$/, `${name} must be an integer`)
    .transform(Number)
    .refine((n) => n >= min && n <= max, `${name} must be between ${min} and ${max}`);

export const PaginationSchema = z.object({
  limit: ganz("limit", 1, LIMIT_MAX).optional(),
  offset: ganz("offset", 0, 10_000_000).optional(),
});

const kurzText = (name: string, max = 200) =>
  z.string().trim().min(1, `${name} must not be empty`).max(max, `${name} is too long`);

export const DeviceSchema = z.enum(["desktop", "mobile", "tablet"]);
export const CountrySchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/, "country must be an ISO 3166-1 alpha-2 code")
  .transform((s) => s.toUpperCase());
export const DirectionSchema = z.enum(["losses", "gains", "all"]);
const positiveZahl = (name: string) =>
  z
    .string()
    .regex(/^\d+(\.\d+)?$/, `${name} must be a positive number`)
    .transform(Number)
    .refine((n) => n > 0 && n <= 1000, `${name} must be > 0 and <= 1000`);

function zodMeldung(e: z.ZodError): string {
  return e.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

export function parseQuery<S extends z.ZodTypeAny>(schema: S, q: URLSearchParams): z.infer<S> {
  const roh: Record<string, string> = {};
  q.forEach((v, k) => {
    if (!(k in roh)) roh[k] = v;
  });
  const r = schema.safeParse(roh);
  if (!r.success) throw new ApiFehler(400, "validation_error", zodMeldung(r.error));
  return r.data;
}

export type Pagination = { limit: number; offset: number };
export function paginationAus(q: URLSearchParams): Pagination {
  const p = parseQuery(PaginationSchema.passthrough(), q);
  return { limit: p.limit ?? LIMIT_DEFAULT, offset: p.offset ?? 0 };
}

export type ApiZeitraum = { from: string; to: string; days: number };

/**
 * Zeitraum aus from/to (ISO-8601 YYYY-MM-DD, inklusiv). Nur `from` → bis heute;
 * nur `to` → die DEFAULT_TAGE davor; nichts → die letzten DEFAULT_TAGE.
 * Max. MAX_TAGE Tage, `to` nicht in der Zukunft, `from` <= `to`.
 */
export function apiZeitraum(q: URLSearchParams, jetztMs?: number): ApiZeitraum {
  const from = q.get("from");
  const to = q.get("to");
  try {
    if (from && !istYmd(from)) throw new ZeitraumFehler("from must be a date (YYYY-MM-DD)");
    if (to && !istYmd(to)) throw new ZeitraumFehler("to must be a date (YYYY-MM-DD)");
    if (from && to && from > to) throw new ZeitraumFehler("from must not be after to");
    const bis = to || heuteYmd(jetztMs);
    const von = from || addDays(bis, -(DEFAULT_TAGE - 1));
    if (von > bis) throw new ZeitraumFehler("from must not be after to");
    const z = zeitraum({ startDate: von, endDate: bis, maxDays: MAX_TAGE, jetztMs });
    return { from: z.startDate, to: z.endDate, days: z.days };
  } catch (e) {
    if (e instanceof ZeitraumFehler) {
      // Deutsche Meldungen aus date-range.ts in API-Sprache (englisch) uebersetzen.
      const m = e.message;
      const msg = /Zukunft/.test(m)
        ? "to must not be in the future"
        : /zu lang/.test(m)
          ? `date range too long (max. ${MAX_TAGE} days)`
          : /nach endDate/.test(m)
            ? "from must not be after to"
            : /YYYY-MM-DD/.test(m) && !/must/.test(m)
              ? "from/to must be dates (YYYY-MM-DD)"
              : m;
      throw new ApiFehler(400, "validation_error", msg);
    }
    throw e;
  }
}

/** ilike-Muster «enthaelt», Sonderzeichen maskiert. */
export function enthaeltMuster(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
/** ilike-Muster «gleich (ohne Gross-/Kleinschreibung)». */
function gleichMuster(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

// ── Handler-Wrapper ──────────────────────────────────────────────────────────
export type Meta = {
  from: string | null;
  to: string | null;
  generated_at: string;
  source: string;
  coverage: "full" | "partial" | "none" | "not_connected";
  unavailable_fields?: string[];
  notes?: string[];
};

export type ReadApiKontext = {
  request: Request;
  url: URL;
  query: URLSearchParams;
  params: Record<string, string>;
  organizationId: string;
  credentialId: string;
};

export type ReadApiErgebnis = {
  data: Record<string, unknown>[];
  /** Gesamtanzahl; null = unbekannt (next_offset dann heuristisch). */
  total: number | null;
  pagination: Pagination;
  meta: Omit<Meta, "generated_at">;
};

type HandlerArgs = { request: Request; params?: Record<string, string> };
type Handler = (a: HandlerArgs) => Promise<Response>;

export function nextOffset(p: Pagination, total: number | null, geliefert: number): number | null {
  if (total == null) return geliefert >= p.limit ? p.offset + p.limit : null;
  return p.offset + p.limit < total ? p.offset + p.limit : null;
}

function redaktiert(e: unknown): string {
  const m = e && typeof e === "object" && "message" in e ? String((e as any).message) : String(e);
  return m.replace(/\s+/g, " ").slice(0, 160);
}

/** Pfadparameter: aus dem Router, sonst aus der URL (/api/v1/projects/<id>/…). */
function pfadParams(url: URL, params?: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...(params ?? {}) };
  if (!out.projectId) {
    const m = url.pathname.match(/\/api\/v1\/projects\/([^/]+)\//);
    if (m) out.projectId = decodeURIComponent(m[1]);
  }
  return out;
}

export function readApiHandler(fn: (ctx: ReadApiKontext) => Promise<ReadApiErgebnis>): {
  GET: Handler;
  OPTIONS: Handler;
  ANY: Handler;
} {
  const GET: Handler = async ({ request, params }) => {
    const t0 = Date.now();
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);
    const auth = await authenticateReadApi(request);
    if (auth instanceof Response) {
      const [code, message] = AUTH_CODES[auth.status] ?? ["unauthorized", AUTH_CODES[401][1]];
      const extra = new Headers();
      const ra = auth.headers.get("Retry-After");
      if (ra) extra.set("Retry-After", ra);
      return fehlerAntwort(auth.status || 401, code, message, requestId, extra);
    }
    let status = 200;
    let zeilen = 0;
    let antwort: Response;
    try {
      const erg = await fn({
        request,
        url,
        query: url.searchParams,
        params: pfadParams(url, params),
        organizationId: auth.organizationId,
        credentialId: auth.credentialId,
      });
      zeilen = erg.data.length;
      const meta: Meta = { ...erg.meta, generated_at: new Date().toISOString() } as Meta;
      if (!meta.unavailable_fields?.length) delete meta.unavailable_fields;
      if (!meta.notes?.length) delete meta.notes;
      antwort = jsonAntwort(
        200,
        {
          data: erg.data,
          pagination: {
            limit: erg.pagination.limit,
            offset: erg.pagination.offset,
            total: erg.total,
            next_offset: nextOffset(erg.pagination, erg.total, erg.data.length),
          },
          meta,
        },
        requestId,
      );
    } catch (e) {
      if (e instanceof ApiFehler) {
        status = e.status;
        antwort = fehlerAntwort(e.status, e.code, e.message, requestId);
      } else {
        status = 500;
        console.error(`[read-api] ${url.pathname} (${requestId}):`, redaktiert(e));
        antwort = fehlerAntwort(500, "internal_error", "Internal server error.", requestId);
      }
    }
    try {
      const query: Record<string, string> = {};
      url.searchParams.forEach((v, k) => (query[k] = v));
      await logReadApi({
        credentialId: auth.credentialId,
        organizationId: auth.organizationId,
        method: "GET",
        path: url.pathname,
        query,
        status,
        dauerMs: Date.now() - t0,
        zeilen,
        ip: clientIp(request),
      });
    } catch {
      // fail-soft: Logging darf die Antwort nie kippen.
    }
    return antwort;
  };
  return {
    GET,
    OPTIONS: async () =>
      new Response(null, { status: 204, headers: basisHeader(crypto.randomUUID()) }),
    ANY: async () => {
      const h = new Headers();
      h.set("Allow", "GET, OPTIONS");
      return fehlerAntwort(
        405,
        "method_not_allowed",
        "Only GET is supported.",
        crypto.randomUUID(),
        h,
      );
    },
  };
}

// ── Gemeinsame Datenzugriffe ─────────────────────────────────────────────────
const UUID = z.string().uuid();

export type Projekt = {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  language: string | null;
  metadata: Record<string, unknown> | null;
};

/** Projekt (= Kunde) NUR innerhalb der Organisation des Tokens, sonst 404. */
export async function ladeProjekt(orgId: string, projectId: string | undefined): Promise<Projekt> {
  if (!projectId || !UUID.safeParse(projectId).success)
    throw new ApiFehler(404, "not_found", "Project not found.");
  const { data, error } = await sb()
    .from("clients")
    .select("id, organization_id, name, domain, country, language, metadata")
    .eq("id", projectId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error) throw error;
  if (!data || data.organization_id !== orgId)
    throw new ApiFehler(404, "not_found", "Project not found.");
  return {
    id: data.id,
    name: data.name,
    domain: data.domain ?? null,
    country: data.country ?? null,
    language: data.language ?? null,
    metadata: (data.metadata ?? null) as Record<string, unknown> | null,
  };
}

const hatFirstParty = (p: { metadata: Record<string, unknown> | null }) =>
  p.metadata?.[FLAG_FIRST_PARTY] === true;

/** Liest eine Abfrage seitenweise (je 1000) bis max. `cap` Zeilen. */
async function alleSeiten(
  bau: () => any,
  cap: number,
): Promise<{ rows: Record<string, any>[]; abgeschnitten: boolean }> {
  const rows: Record<string, any>[] = [];
  for (let off = 0; off < cap; off += SEITE) {
    const { data, error } = await bau().range(off, Math.min(off + SEITE, cap) - 1);
    if (error) throw error;
    const d = (data ?? []) as Record<string, any>[];
    rows.push(...d);
    if (d.length < Math.min(SEITE, cap - off)) return { rows, abgeschnitten: false };
  }
  return { rows, abgeschnitten: true };
}

const num = (v: unknown): number | null =>
  v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
const rund = (v: number | null, stellen = 2): number | null =>
  v == null ? null : Math.round(v * 10 ** stellen) / 10 ** stellen;

async function hatZeilen(bau: () => any): Promise<boolean> {
  const { data, error } = await bau().limit(1);
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}

const RICHTUNG: Record<z.infer<typeof DirectionSchema>, string> = {
  losses: "verlust",
  gains: "gewinn",
  all: "alle",
};

// ── 1. GET /api/v1/projects ──────────────────────────────────────────────────
export async function listeProjekte(ctx: ReadApiKontext): Promise<ReadApiErgebnis> {
  const pg = paginationAus(ctx.query);
  const org = ctx.organizationId;
  const { data, error, count } = await sb()
    .from("clients")
    .select("id, organization_id, name, domain, country, language, metadata", { count: "exact" })
    .eq("organization_id", org)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .range(pg.offset, pg.offset + pg.limit - 1);
  if (error) throw error;
  const seit = addDays(heuteYmd(), -13);
  const kunden = ((data ?? []) as any[]).filter((c) => c.organization_id === org);
  const rows = await Promise.all(
    kunden.map(async (c) => {
      const fp = c.metadata?.[FLAG_FIRST_PARTY] === true;
      const [rank, gsc, ga4] = await Promise.all([
        hatZeilen(() =>
          sb()
            .from("rank_daily")
            .select("client_id")
            .eq("organization_id", org)
            .eq("client_id", c.id)
            .gte("date", seit),
        ),
        fp
          ? hatZeilen(() => sb().from("gsc_daily").select("client_id").eq("client_id", c.id))
          : false,
        fp
          ? hatZeilen(() =>
              sb().from("ga4_landing_daily").select("client_id").eq("client_id", c.id),
            )
          : false,
      ]);
      // Explizites Mapping — metadata & Co. werden NIE ausgegeben.
      return {
        id: c.id as string,
        name: c.name as string,
        domain: (c.domain ?? null) as string | null,
        country: (c.country ?? null) as string | null,
        language: (c.language ?? null) as string | null,
        status: c.metadata?.status === "paused" ? "paused" : "active",
        has_rank_tracking: rank,
        has_search_console: gsc,
        has_analytics: ga4,
      };
    }),
  );
  return {
    data: rows,
    total: typeof count === "number" ? count : null,
    pagination: pg,
    meta: {
      from: null,
      to: null,
      source: "clients",
      coverage: rows.length ? "full" : "none",
      notes: [
        "has_rank_tracking = rank tracking rows in the last 14 days.",
        "has_search_console / has_analytics = first-party data connected and rows present.",
      ],
    },
  };
}

// ── 2. GET /api/v1/projects/{project_id}/rankings ────────────────────────────
const RankingsSchema = z
  .object({
    keyword: kurzText("keyword").optional(),
    device: DeviceSchema.optional(),
    country: CountrySchema.optional(),
  })
  .passthrough();

const serieKey = (r: Record<string, any>) =>
  [r.keyword, r.device ?? "", String(r.country ?? "").toUpperCase(), r.pos_src ?? ""].join(
    "\u0001",
  );

export async function projektRankings(ctx: ReadApiKontext): Promise<ReadApiErgebnis> {
  const zr = apiZeitraum(ctx.query);
  const pg = paginationAus(ctx.query);
  const f = parseQuery(RankingsSchema, ctx.query);
  const org = ctx.organizationId;
  const p = await ladeProjekt(org, ctx.params.projectId);

  let q = sb()
    .from("rank_daily")
    .select("date, keyword, position, url, search_volume, pos_src, is_money, device, country", {
      count: "exact",
    })
    .eq("organization_id", org)
    .eq("client_id", p.id)
    .gte("date", zr.from)
    .lte("date", zr.to);
  if (f.keyword) q = q.ilike("keyword", enthaeltMuster(f.keyword));
  if (f.device) q = q.eq("device", f.device);
  if (f.country) q = q.ilike("country", gleichMuster(f.country));
  const { data, error, count } = await q
    .order("date", { ascending: false })
    .order("keyword", { ascending: true })
    .order("pos_src", { ascending: true })
    .range(pg.offset, pg.offset + pg.limit - 1);
  if (error) throw error;
  const seite = (data ?? []) as Record<string, any>[];

  // previous_position: letzter vorheriger Messtag derselben Serie
  // (keyword + device + country + pos_src), max. VORWERT_LOOKBACK_TAGE zurueck.
  const vorwerte = new Map<string, { date: string; position: number | null }[]>();
  const notes: string[] = [
    "position null = not ranking in the tracked top 30.",
    "change = position - previous_position; positive = worse.",
    `previous_position = last earlier measurement with the same pos_src (lookback max. ${VORWERT_LOOKBACK_TAGE} days).`,
  ];
  if (seite.length) {
    const keywords = [...new Set(seite.map((r) => String(r.keyword)))];
    const minDate = seite.reduce((m, r) => (r.date < m ? r.date : m), seite[0].date as string);
    const maxDate = seite.reduce((m, r) => (r.date > m ? r.date : m), seite[0].date as string);
    const hist = await alleSeiten(
      () =>
        sb()
          .from("rank_daily")
          .select("date, keyword, position, pos_src, device, country")
          .eq("organization_id", org)
          .eq("client_id", p.id)
          .in("keyword", keywords)
          .gte("date", addDays(minDate, -VORWERT_LOOKBACK_TAGE))
          .lt("date", maxDate)
          .order("date", { ascending: false })
          .order("keyword", { ascending: true }),
      HISTORIE_MAX,
    );
    if (hist.abgeschnitten) notes.push("previous_position history truncated (too many rows).");
    for (const h of hist.rows) {
      const k = serieKey(h);
      const arr = vorwerte.get(k) ?? [];
      arr.push({ date: h.date, position: num(h.position) });
      vorwerte.set(k, arr);
    }
    for (const arr of vorwerte.values()) arr.sort((a, b) => (a.date < b.date ? 1 : -1));
  }

  const rows = seite.map((r) => {
    const pos = num(r.position);
    const vor = (vorwerte.get(serieKey(r)) ?? []).find((h) => h.date < r.date);
    const prev = vor ? vor.position : null;
    return {
      date: r.date as string,
      keyword: r.keyword as string,
      position: pos,
      previous_position: prev,
      change: pos != null && prev != null ? rund(pos - prev) : null,
      url: (r.url ?? null) as string | null,
      search_volume: num(r.search_volume),
      pos_src: (r.pos_src ?? null) as string | null,
      is_money: r.is_money == null ? null : Boolean(r.is_money),
      device: (r.device ?? null) as string | null,
      country: (r.country ?? null) as string | null,
    };
  });
  return {
    data: rows,
    total: typeof count === "number" ? count : null,
    pagination: pg,
    meta: {
      from: zr.from,
      to: zr.to,
      source: "rank_daily",
      coverage: rows.length ? "full" : "none",
      notes,
    },
  };
}

// ── 3./7. Ranking-Veraenderungen (RPC rank_changes) ──────────────────────────
type ChangesArgs = {
  org: string;
  client: string | null;
  zr: ApiZeitraum;
  minLoss: number;
  country?: string;
  device?: string;
  richtung: z.infer<typeof DirectionSchema>;
  pg: Pagination;
};

async function rankChanges(a: ChangesArgs): Promise<{ rows: any[]; total: number | null }> {
  const { data, error } = await sb().rpc("rank_changes", {
    _org: a.org,
    _client: a.client,
    _from: a.zr.from,
    _to: a.zr.to,
    _min_loss: a.minLoss,
    _country: a.country ?? null,
    _device: a.device ?? null,
    _limit: a.pg.limit,
    _offset: a.pg.offset,
    _richtung: RICHTUNG[a.richtung],
  });
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const total = rows.length ? num(rows[0].total_count) : a.pg.offset === 0 ? 0 : null;
  return { rows, total };
}

const changeFelder = (r: any) => ({
  keyword: r.keyword as string,
  url: (r.url ?? null) as string | null,
  position_before: num(r.position_before),
  position_after: num(r.position_after),
  position_change: num(r.position_change),
  search_volume: num(r.search_volume),
  country: (r.country ?? null) as string | null,
  device: (r.device ?? null) as string | null,
  date_before: (r.date_before ?? null) as string | null,
  date_after: (r.date_after ?? null) as string | null,
  pos_src: (r.pos_src ?? null) as string | null,
  dropped_out: Boolean(r.dropped_out),
});

const CHANGES_NOTES = [
  "position_change = position_after - position_before; positive = loss (worse).",
  "position_after null with dropped_out=true = fell out of the tracked top 30.",
  "Comparisons only within the same measurement method (pos_src).",
];

const ProjektChangesSchema = z
  .object({
    direction: DirectionSchema.optional(),
    min_change: positiveZahl("min_change").optional(),
    country: CountrySchema.optional(),
    device: DeviceSchema.optional(),
  })
  .passthrough();

export async function projektRankingChanges(ctx: ReadApiKontext): Promise<ReadApiErgebnis> {
  const zr = apiZeitraum(ctx.query);
  const pg = paginationAus(ctx.query);
  const f = parseQuery(ProjektChangesSchema, ctx.query);
  const p = await ladeProjekt(ctx.organizationId, ctx.params.projectId);
  const { rows, total } = await rankChanges({
    org: ctx.organizationId,
    client: p.id,
    zr,
    minLoss: f.min_change ?? 1,
    country: f.country,
    device: f.device,
    richtung: f.direction ?? "losses",
    pg,
  });
  const data = rows.filter((r) => r.client_id == null || r.client_id === p.id).map(changeFelder);
  return {
    data,
    total,
    pagination: pg,
    meta: {
      from: zr.from,
      to: zr.to,
      source: "rank_changes",
      coverage: data.length ? "full" : "none",
      notes: CHANGES_NOTES,
    },
  };
}

const GlobalChangesSchema = z
  .object({
    direction: DirectionSchema.optional(),
    min_position_loss: positiveZahl("min_position_loss").optional(),
    country: CountrySchema.optional(),
    device: DeviceSchema.optional(),
  })
  .passthrough();

export async function globaleRankingChanges(ctx: ReadApiKontext): Promise<ReadApiErgebnis> {
  const zr = apiZeitraum(ctx.query);
  const pg = paginationAus(ctx.query);
  const f = parseQuery(GlobalChangesSchema, ctx.query);
  const org = ctx.organizationId;
  const { rows, total } = await rankChanges({
    org,
    client: null,
    zr,
    minLoss: f.min_position_loss ?? 1,
    country: f.country,
    device: f.device,
    richtung: f.direction ?? "losses",
    pg,
  });
  // Projektnamen/Domains nur aus der EIGENEN Organisation; Zeilen zu fremden
  // Kunden (duerfte die RPC nie liefern) werden defensiv verworfen.
  const ids = [...new Set(rows.map((r) => r.client_id).filter(Boolean))] as string[];
  const kunden = new Map<string, { name: string; domain: string | null }>();
  if (ids.length) {
    const { data, error } = await sb()
      .from("clients")
      .select("id, organization_id, name, domain")
      .eq("organization_id", org)
      .in("id", ids);
    if (error) throw error;
    for (const c of (data ?? []) as any[])
      if (c.organization_id === org) kunden.set(c.id, { name: c.name, domain: c.domain ?? null });
  }
  const data = rows
    .filter((r) => kunden.has(r.client_id))
    .map((r) => {
      const k = kunden.get(r.client_id)!;
      return {
        project_id: r.client_id,
        project_name: k.name,
        domain: k.domain,
        ...changeFelder(r),
      };
    });
  return {
    data,
    total,
    pagination: pg,
    meta: {
      from: zr.from,
      to: zr.to,
      source: "rank_changes",
      coverage: data.length ? "full" : "none",
      notes: CHANGES_NOTES,
    },
  };
}

// ── 4. GET /api/v1/projects/{project_id}/search-console ──────────────────────
export const GSC_DIMENSIONEN = ["query", "page", "date"] as const;
type GscDim = (typeof GSC_DIMENSIONEN)[number];

const SearchConsoleSchema = z
  .object({
    dimensions: z
      .string()
      .transform((s) =>
        s
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      )
      .refine(
        (a) => a.length > 0 && a.every((x) => (GSC_DIMENSIONEN as readonly string[]).includes(x)),
        "dimensions must be a comma-separated subset of query,page,date",
      )
      .optional(),
    query: kurzText("query").optional(),
    page: kurzText("page", 500).optional(),
  })
  .passthrough();

export async function projektSearchConsole(ctx: ReadApiKontext): Promise<ReadApiErgebnis> {
  const zr = apiZeitraum(ctx.query);
  const pg = paginationAus(ctx.query);
  const f = parseQuery(SearchConsoleSchema, ctx.query);
  const dims = [...new Set((f.dimensions ?? ["query"]) as GscDim[])];
  const p = await ladeProjekt(ctx.organizationId, ctx.params.projectId);
  const unavailable = ["device", "country"];
  const basisMeta = {
    from: zr.from,
    to: zr.to,
    source: "gsc_daily",
    unavailable_fields: unavailable,
  };
  if (!hatFirstParty(p)) {
    return {
      data: [],
      total: 0,
      pagination: pg,
      meta: {
        ...basisMeta,
        coverage: "not_connected",
        notes: ["Search Console data is not connected for this project."],
      },
    };
  }
  const filter = (q: any) => {
    let x = q.eq("client_id", p.id).gte("date", zr.from).lte("date", zr.to);
    if (f.query) x = x.ilike("query", enthaeltMuster(f.query));
    if (f.page) x = x.ilike("page", enthaeltMuster(f.page));
    return x;
  };
  const notes = [
    "Aggregated over the selected dimensions; position is impression-weighted.",
    "device and country are not stored (always null).",
  ];
  const zeile = (r: {
    query?: string | null;
    page?: string | null;
    date?: string | null;
    clicks: number;
    impressions: number;
    position: number | null;
  }) => ({
    query: dims.includes("query") ? (r.query ?? null) : null,
    page: dims.includes("page") ? (r.page ?? null) : null,
    date: dims.includes("date") ? (r.date ?? null) : null,
    clicks: r.clicks,
    impressions: r.impressions,
    ctr: r.impressions > 0 ? rund(r.clicks / r.impressions, 4) : 0,
    position: rund(r.position),
    device: null,
    country: null,
  });

  // Alle drei Dimensionen = Rohzeilen (PK) → direkt in der DB paginieren.
  if (dims.length === 3) {
    const { data, error, count } = await filter(
      sb()
        .from("gsc_daily")
        .select("date, query, page, clicks, impressions, position", { count: "exact" }),
    )
      .order("date", { ascending: false })
      .order("clicks", { ascending: false })
      .order("query", { ascending: true })
      .order("page", { ascending: true })
      .range(pg.offset, pg.offset + pg.limit - 1);
    if (error) throw error;
    const rows = ((data ?? []) as any[]).map((r) =>
      zeile({
        query: r.query,
        page: r.page,
        date: r.date,
        clicks: Number(r.clicks) || 0,
        impressions: Number(r.impressions) || 0,
        position: num(r.position),
      }),
    );
    return {
      data: rows,
      total: typeof count === "number" ? count : null,
      pagination: pg,
      meta: { ...basisMeta, coverage: rows.length ? "full" : "none", notes },
    };
  }

  const scan = await alleSeiten(
    () =>
      filter(sb().from("gsc_daily").select("date, query, page, clicks, impressions, position"))
        .order("date", { ascending: true })
        .order("query", { ascending: true })
        .order("page", { ascending: true }),
    SCAN_MAX,
  );
  type Agg = {
    query: string | null;
    page: string | null;
    date: string | null;
    clicks: number;
    impressions: number;
    posGew: number;
    posSumme: number;
    n: number;
  };
  const gruppen = new Map<string, Agg>();
  for (const r of scan.rows) {
    const key = dims.map((d) => String(r[d] ?? "")).join("\u0001");
    let g = gruppen.get(key);
    if (!g) {
      g = {
        query: r.query ?? null,
        page: r.page ?? null,
        date: r.date ?? null,
        clicks: 0,
        impressions: 0,
        posGew: 0,
        posSumme: 0,
        n: 0,
      };
      gruppen.set(key, g);
    }
    const imp = Number(r.impressions) || 0;
    const pos = num(r.position);
    g.clicks += Number(r.clicks) || 0;
    g.impressions += imp;
    if (pos != null) {
      g.posGew += pos * imp;
      g.posSumme += pos;
      g.n += 1;
    }
  }
  const liste = [...gruppen.values()];
  if (dims.length === 1 && dims[0] === "date")
    liste.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  else
    liste.sort(
      (a, b) =>
        b.clicks - a.clicks ||
        b.impressions - a.impressions ||
        String(a.query ?? a.page ?? a.date).localeCompare(String(b.query ?? b.page ?? b.date)),
    );
  const rows = liste.slice(pg.offset, pg.offset + pg.limit).map((g) =>
    zeile({
      ...g,
      position: g.impressions > 0 ? g.posGew / g.impressions : g.n ? g.posSumme / g.n : null,
    }),
  );
  if (scan.abgeschnitten)
    notes.push(
      `Only the first ${SCAN_MAX} raw rows were aggregated; narrow the date range or filter by query/page for complete totals.`,
    );
  return {
    data: rows,
    total: liste.length,
    pagination: pg,
    meta: {
      ...basisMeta,
      coverage: scan.abgeschnitten ? "partial" : liste.length ? "full" : "none",
      notes,
    },
  };
}

// ── 5. GET /api/v1/projects/{project_id}/analytics ───────────────────────────
const AnalyticsSchema = z
  .object({ group_by: z.enum(["date", "landing_page"]).optional() })
  .passthrough();
export const ORGANIC_CHANNEL = "Organic Search";

export async function projektAnalytics(ctx: ReadApiKontext): Promise<ReadApiErgebnis> {
  const zr = apiZeitraum(ctx.query);
  const pg = paginationAus(ctx.query);
  const f = parseQuery(AnalyticsSchema, ctx.query);
  const groupBy = f.group_by ?? "date";
  const p = await ladeProjekt(ctx.organizationId, ctx.params.projectId);
  const basisMeta = {
    from: zr.from,
    to: zr.to,
    source: "ga4_landing_daily",
    unavailable_fields: ["users"],
  };
  if (!hatFirstParty(p)) {
    return {
      data: [],
      total: 0,
      pagination: pg,
      meta: {
        ...basisMeta,
        coverage: "not_connected",
        notes: ["Analytics (GA4) data is not connected for this project."],
      },
    };
  }
  const scan = await alleSeiten(
    () =>
      sb()
        .from("ga4_landing_daily")
        .select("date, landing_page, channel_group, sessions, key_events")
        .eq("client_id", p.id)
        .gte("date", zr.from)
        .lte("date", zr.to)
        .order("date", { ascending: true })
        .order("landing_page", { ascending: true })
        .order("channel_group", { ascending: true })
        .order("session_source", { ascending: true })
        .order("session_medium", { ascending: true }),
    SCAN_MAX,
  );
  const gruppen = new Map<
    string,
    { key: string; sessions: number; organic: number; conversions: number }
  >();
  for (const r of scan.rows) {
    const key = String(groupBy === "date" ? r.date : r.landing_page);
    const g = gruppen.get(key) ?? { key, sessions: 0, organic: 0, conversions: 0 };
    const s = Number(r.sessions) || 0;
    g.sessions += s;
    if (r.channel_group === ORGANIC_CHANNEL) g.organic += s;
    g.conversions += Number(r.key_events) || 0;
    gruppen.set(key, g);
  }
  const liste = [...gruppen.values()];
  if (groupBy === "date") liste.sort((a, b) => a.key.localeCompare(b.key));
  else liste.sort((a, b) => b.sessions - a.sessions || a.key.localeCompare(b.key));
  const rows = liste.slice(pg.offset, pg.offset + pg.limit).map((g) => ({
    date: groupBy === "date" ? g.key : null,
    landing_page: groupBy === "landing_page" ? g.key : null,
    sessions: g.sessions,
    organic_sessions: g.organic,
    users: null,
    conversions: rund(g.conversions),
  }));
  const notes = [
    `organic_sessions = sessions with channel group '${ORGANIC_CHANNEL}'.`,
    "conversions = GA4 key events. users is not stored (always null).",
  ];
  if (scan.abgeschnitten)
    notes.push(`Only the first ${SCAN_MAX} raw rows were aggregated; narrow the date range.`);
  return {
    data: rows,
    total: liste.length,
    pagination: pg,
    meta: {
      ...basisMeta,
      coverage: scan.abgeschnitten ? "partial" : liste.length ? "full" : "none",
      notes,
    },
  };
}

// ── 6. GET /api/v1/projects/{project_id}/visibility ──────────────────────────
export async function projektVisibility(ctx: ReadApiKontext): Promise<ReadApiErgebnis> {
  const zr = apiZeitraum(ctx.query);
  const pg = paginationAus(ctx.query);
  const p = await ladeProjekt(ctx.organizationId, ctx.params.projectId);
  const { data, error } = await sb().rpc("visibility_daily", {
    _org: ctx.organizationId,
    _client: p.id,
    _from: zr.from,
    _to: zr.to,
  });
  if (error) throw error;
  const alle = ((data ?? []) as any[])
    .map((r) => ({
      date: r.date as string,
      visibility_index: null,
      top3: num(r.top3),
      top10: num(r.top10),
      top30: num(r.top30),
      top100: null,
      tracked: num(r.tracked),
      keywords_ranking: num(r.keywords_ranking),
      avg_position: rund(num(r.avg_position)),
      pos_src: (r.pos_src ?? null) as string | null,
    }))
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || String(a.pos_src ?? "").localeCompare(String(b.pos_src)),
    );
  const rows = alle.slice(pg.offset, pg.offset + pg.limit);
  return {
    data: rows,
    total: alle.length,
    pagination: pg,
    meta: {
      from: zr.from,
      to: zr.to,
      source: "visibility_daily",
      coverage: alle.length ? "full" : "none",
      unavailable_fields: ["visibility_index", "top100"],
      notes: [
        "Counts per day and measurement method (pos_src). Tracking covers the top 30 only, so top100 is not available.",
      ],
    },
  };
}
