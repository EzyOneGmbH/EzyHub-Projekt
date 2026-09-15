// Eingabe-Validierung der externen Ingest-Schnittstellen (Security-Runde 3,
// 13.09.2026): strikte Zod-Schemata mit Allowlists statt "alles annehmen und
// kuerzen". Alles, was hier nicht explizit erlaubt ist, wird mit 400
// abgelehnt — unbekannte Felder eingeschlossen (.strict()).
import { createHash } from "node:crypto";
import { z } from "zod";

// ── Grenzen ────────────────────────────────────────────────────────────────
export const MAX_BODY_BYTES_ADS = 32 * 1024; // 1 Event je Request
export const MAX_BODY_BYTES_CRAWLER = 256 * 1024; // bis 500 Hits je Request
export const MAX_CRAWLER_HITS = 500;

// ── Allowlists ─────────────────────────────────────────────────────────────
/** Erlaubte Conversion-Typen (OpenAI-Measurement-Vokabular + unsere Leads). */
export const ADS_EVENT_TYPES = [
  "page_viewed",
  "lead_created",
  "purchase",
  "signup",
  "add_to_cart",
  "checkout_started",
  "subscribe",
  "contact",
  "download",
  "schedule",
  "start_trial",
  "submit_application",
  "view_content",
  "search",
] as const;

export const ACTION_SOURCES = ["web", "app", "offline", "crm", "other"] as const;

/** ISO-4217-Codes (aktive Waehrungen). Nur diese werden akzeptiert. */
export const ISO_4217 = new Set(
  (
    "AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BHD BIF BMD BND BOB BRL BSD BTN BWP " +
    "BYN BZD CAD CDF CHF CLP CNY COP CRC CUP CVE CZK DJF DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP " +
    "GEL GHS GIP GMD GNF GTQ GYD HKD HNL HTG HUF IDR ILS INR IQD IRR ISK JMD JOD JPY KES KGS KHR " +
    "KMF KPW KRW KWD KYD KZT LAK LBP LKR LRD LSL LYD MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK " +
    "MXN MYR MZN NAD NGN NIO NOK NPR NZD OMR PAB PEN PGK PHP PKR PLN PYG QAR RON RSD RUB RWF SAR " +
    "SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS TMT TND TOP TRY TTD TWD TZS " +
    "UAH UGX USD UYU UZS VES VND VUV WST XAF XCD XOF XPF YER ZAR ZMW ZWG"
  ).split(" "),
);

/** Bekannte KI-Crawler (User-Agent-Produktnamen). */
export const KNOWN_BOTS = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-User",
  "Claude-SearchBot",
  "anthropic-ai",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "GoogleOther",
  "Bytespider",
  "Amazonbot",
  "Applebot-Extended",
  "cohere-ai",
  "meta-externalagent",
] as const;

// ── Bausteine ──────────────────────────────────────────────────────────────
const SHA256_HEX = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "muss ein SHA-256-Hex (64 Zeichen, klein) sein");
const UUID = z.string().uuid();
const DOMAIN = z
  .string()
  .min(3)
  .max(253)
  .regex(/^[A-Za-z0-9.-]+$/, "Domain: nur Buchstaben, Ziffern, Punkt, Bindestrich");
const EVENT_ID = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Za-z0-9_.:-]+$/, "event.id: nur A-Z, 0-9, _ . : -");
// source_url: OpenAI verlangt eine bereinigte HTTP(S)-Adresse aus NUR Ursprung
// und Pfad (developers.openai.com/ads, Verification-Checklist 15.09.2026).
// z.string().url() liess bisher alles durch, was formal eine URL ist — auch
// "javascript:" und Abfrageparameter mit personenbezogenen Daten, die wir
// ungefiltert an OpenAI weitergereicht haetten.
const SOURCE_URL = z
  .string()
  .max(500)
  .superRefine((v, ctx) => {
    let u: URL;
    try {
      u = new URL(v);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source_url: keine gueltige URL" });
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:")
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "source_url: nur http:// oder https://",
      });
  })
  .transform((v) => {
    const u = new URL(v);
    // Abfrageteil und Anker verwerfen — sie transportieren regelmaessig
    // E-Mail-Adressen, Namen oder Kampagnen-Parameter.
    return u.origin + u.pathname;
  });

// ── ChatGPT-Ads-Conversion ─────────────────────────────────────────────────
export const AdsEventSchema = z
  .object({
    id: EVENT_ID.optional(),
    type: z.enum(ADS_EVENT_TYPES),
    oppref: z.string().min(1).max(500).optional(),
    obref: z.string().min(1).max(120).optional(),
    // Betraege: positive GANZE Zahl in Rappen/Cents (kein Float, kein 0).
    amount_cents: z.number().int().positive().max(1_000_000_000).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/, "currency: ISO-4217-Code in Grossbuchstaben")
      .refine((c) => ISO_4217.has(c), "currency: kein gueltiger ISO-4217-Code")
      .optional(),
    source_url: SOURCE_URL.optional(),
    action_source: z.enum(ACTION_SOURCES).default("web"),
    user: z
      .object({
        email_sha256: SHA256_HEX.optional(),
        external_id_sha256: SHA256_HEX.optional(),
        country: z
          .string()
          .regex(/^[A-Z]{2}$/, "country: ISO-3166-1 alpha-2")
          .optional(),
        city: z.string().max(80).optional(),
        zip_code: z.string().max(20).optional(),
      })
      .strict()
      .optional(),
    data: z.record(z.string().max(60), z.unknown()).optional(),
    contents: z
      .array(
        z
          .object({
            item_id: z.string().min(1).max(120),
            quantity: z.number().int().positive().max(100_000).optional(),
            price: z.number().int().nonnegative().max(1_000_000_000).optional(),
          })
          .strict(),
      )
      .max(50)
      .optional(),
  })
  .strict()
  .refine((e) => (e.amount_cents == null) === (e.currency == null), {
    message: "amount_cents und currency nur gemeinsam",
  });

export const AdsIngestBodySchema = z
  .object({
    clientId: UUID.optional(),
    domain: DOMAIN.optional(),
    event: AdsEventSchema,
  })
  .strict();

export type AdsIngestBody = z.infer<typeof AdsIngestBodySchema>;

// ── KI-Crawler-Hits ────────────────────────────────────────────────────────
const HIT_URL = z
  .string()
  .min(1)
  .max(500)
  .regex(/^(https?:\/\/[^\s]+|\/[^\s]*)$/, "url: absolute http(s)-URL oder Pfad ab /");

export const CrawlerHitSchema = z
  .object({
    bot: z.enum(KNOWN_BOTS),
    url: HIT_URL,
    status: z.number().int().min(100).max(599).optional(),
    at: z.string().datetime({ offset: true }).optional(),
  })
  .strict();

export const CrawlerIngestBodySchema = z
  .object({
    clientId: UUID.optional(),
    domain: DOMAIN.optional(),
    hits: z.array(CrawlerHitSchema).min(1).max(MAX_CRAWLER_HITS),
  })
  .strict();

export type CrawlerIngestBody = z.infer<typeof CrawlerIngestBodySchema>;

/** Zeitfenster fuer Hit-Zeitstempel: max. 30 Tage alt, max. 5 Min. in der Zukunft. */
export function hitZeitpunkt(at: string | undefined, now = Date.now()): string | null {
  if (!at) return new Date(now).toISOString();
  const t = new Date(at).getTime();
  if (!Number.isFinite(t)) return null;
  if (t > now + 5 * 60_000) return null;
  if (t < now - 30 * 864e5) return null;
  return new Date(t).toISOString();
}

/** Replay-Schluessel je Hit: sekundengenau, deterministisch. */
export function hitHash(clientId: string, bot: string, url: string, atIso: string): string {
  const sek = atIso.slice(0, 19); // YYYY-MM-DDTHH:MM:SS
  return createHash("sha256").update(`${clientId}|${bot}|${url}|${sek}`).digest("hex");
}

// ── Body lesen mit Groessenlimit ───────────────────────────────────────────
export type BodyErgebnis =
  | { ok: true; body: unknown }
  | { ok: false; status: 400 | 413 | 415; error: string };

export async function leseJsonBegrenzt(request: Request, maxBytes: number): Promise<BodyErgebnis> {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (!ct.includes("application/json"))
    return { ok: false, status: 415, error: "Content-Type application/json erforderlich" };
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > maxBytes)
    return { ok: false, status: 413, error: `Payload zu gross (max. ${maxBytes} Bytes)` };
  let text: string;
  try {
    text = await request.text();
  } catch {
    return { ok: false, status: 400, error: "Body nicht lesbar" };
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes)
    return { ok: false, status: 413, error: `Payload zu gross (max. ${maxBytes} Bytes)` };
  try {
    return { ok: true, body: JSON.parse(text) };
  } catch {
    return { ok: false, status: 400, error: "Body ist kein gueltiges JSON" };
  }
}

/** Zod-Fehler kompakt und ohne Nutzdaten-Echo formulieren. */
export function zodFehlerText(err: z.ZodError): string {
  return err.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
    .join("; ");
}
