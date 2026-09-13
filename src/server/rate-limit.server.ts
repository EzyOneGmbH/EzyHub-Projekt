// Sliding-Window-Rate-Limiter (Security-Runde 3, 13.09.2026) fuer die
// externen Ingest-Schnittstellen. Bewusst in-memory und rein: pro Instanz
// gueltig (Lovable-Serverless startet mehrere Instanzen — das Limit ist
// damit eine OBERGRENZE je Instanz, kein globaler Zaehler; fuer Brute-Force-
// Bremse und Missbrauchs-Deckel reicht das, fuer Abrechnung nicht).
// Schluessel: Credential-ID (Nutzlast) bzw. Client-IP (401-Fehlversuche).

export type LimitErgebnis = { ok: boolean; remaining: number; retryAfterMs: number };

export class SlidingWindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    public readonly limit: number,
    public readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  /** Zaehlt einen Treffer und sagt, ob er noch im Limit liegt. */
  hit(key: string, now = Date.now()): LimitErgebnis {
    const grenze = now - this.windowMs;
    let ts = this.hits.get(key);
    if (!ts) {
      // Speicherdeckel: bei zu vielen Schluesseln die aeltesten verwerfen.
      if (this.hits.size >= this.maxKeys) {
        const first = this.hits.keys().next().value;
        if (first !== undefined) this.hits.delete(first);
      }
      ts = [];
      this.hits.set(key, ts);
    }
    // Abgelaufene Treffer vorne abschneiden (Liste ist chronologisch).
    let i = 0;
    while (i < ts.length && ts[i] <= grenze) i++;
    if (i) ts.splice(0, i);
    if (ts.length >= this.limit) {
      return { ok: false, remaining: 0, retryAfterMs: Math.max(1, ts[0] + this.windowMs - now) };
    }
    ts.push(now);
    return { ok: true, remaining: this.limit - ts.length, retryAfterMs: 0 };
  }

  /** Stand lesen OHNE zu zaehlen (fuer "bereits gesperrt?"-Pruefungen). */
  peek(key: string, now = Date.now()): LimitErgebnis {
    const grenze = now - this.windowMs;
    const ts = (this.hits.get(key) || []).filter((t) => t > grenze);
    if (ts.length >= this.limit)
      return { ok: false, remaining: 0, retryAfterMs: Math.max(1, ts[0] + this.windowMs - now) };
    return { ok: true, remaining: this.limit - ts.length, retryAfterMs: 0 };
  }

  /** Nur fuer Tests/Diagnose. */
  reset(): void {
    this.hits.clear();
  }
}

const num = (v: string | undefined, def: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : def;
};

/** Nutzlast-Limit je Credential (Default 600 Requests/Minute). */
export const ingestLimiter = new SlidingWindowLimiter(
  num(process.env.INGEST_RATE_LIMIT_PER_MIN, 600),
  60_000,
);

/** Fehlversuchs-Limit je Client-IP (Default 20 abgelehnte Tokens/Minute). */
export const authFailLimiter = new SlidingWindowLimiter(
  num(process.env.INGEST_AUTH_FAIL_LIMIT_PER_MIN, 20),
  60_000,
);

/** Client-IP aus den ueblichen Proxy-Headern; nie leer (Fallback "unknown"). */
export function clientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for") || "";
  const first = xff.split(",")[0].trim();
  return first || request.headers.get("x-real-ip") || "unknown";
}

export function antwort429(retryAfterMs: number): Response {
  return Response.json(
    { ok: false, error: "Zu viele Anfragen — bitte kurz warten." },
    {
      status: 429,
      headers: { "Retry-After": String(Math.ceil(retryAfterMs / 1000)) },
    },
  );
}
