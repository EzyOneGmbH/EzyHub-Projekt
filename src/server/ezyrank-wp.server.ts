// Blog-Autopilot: Client für die EzyRank-Schnittstelle des EzyHub Connectors
// (Plugin ab 2.0, REST-Namespace ezyrank/v1, Bauanleitung Kap. 7). Auth über
// den Verbindungsschlüssel ezr_… (im Plugin erzeugt, in EzyHub nur als
// secretbox-Chiffrat in wp_connections.key_enc). Der Schlüssel wird doppelt
// gesendet: Authorization: Bearer (Standard) und X-EzyRank-Key (manche Hoster
// bzw. Apache-CGI entfernen den Authorization-Header).
import { normalizeSiteUrl } from "@/server/wordpress.server";

export const EZR_NS = "/wp-json/ezyrank/v1";
export const EZR_KEY_RE = /^ezr_[a-f0-9]{44}$/;

/** Fehlercodes aus Kap. 7.10 plus drei EzyHub-seitige (Plugin fehlt,
 *  nicht erreichbar, unerwartete Antwort). */
export type EzrFehlerCode =
  | "ezr_auth_missing"
  | "ezr_auth_invalid"
  | "ezr_rate_limited"
  | "ezr_scope_missing"
  | "ezr_image_failed"
  | "ezr_https_required"
  | "ezr_blocked"
  | "ezr_plugin_missing"
  | "ezr_unreachable"
  | "ezr_unexpected";

export const EZR_HILFE: Record<EzrFehlerCode, string> = {
  ezr_auth_missing:
    "Es kam kein Schlüssel an. Im Plugin unter Einstellungen › EzyRank einen Verbindungsschlüssel erzeugen und hier eintragen.",
  ezr_auth_invalid:
    "Der Schlüssel passt nicht. Im Plugin einen neuen Schlüssel erzeugen und vollständig kopieren.",
  ezr_rate_limited: "Zu viele Anfragen in kurzer Zeit. Bitte in 15 Minuten erneut versuchen.",
  ezr_scope_missing:
    "Dem Schlüssel fehlt eine Berechtigung. Im Plugin unter Einstellungen › EzyRank die nötige Berechtigung aktivieren.",
  ezr_image_failed:
    "Ein Bild konnte nicht geladen werden. Bild-URL und Firewall der Website prüfen.",
  ezr_https_required: "Die Website läuft ohne HTTPS. Bitte SSL aktivieren.",
  ezr_blocked:
    "Der Hoster oder eine Firewall blockiert die Anfrage von EzyHub. Im Plugin den Pull-Modus aktivieren oder EzyHub in der Firewall freigeben.",
  ezr_plugin_missing:
    "Die EzyRank-Schnittstelle antwortet nicht. Bitte den EzyHub Connector ab Version 2.0 installieren und aktivieren.",
  ezr_unreachable: "Die Website ist nicht erreichbar. Adresse prüfen und erneut versuchen.",
  ezr_unexpected:
    "Die Website hat unerwartet geantwortet. Bitte erneut versuchen oder Ezy One melden.",
};

const BEKANNT = new Set(Object.keys(EZR_HILFE));

export type EzrVerbindung = { siteUrl: string; key: string };

export type EzrAntwort<T = any> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: EzrFehlerCode; message: string };

/** Pure (vitest): ordnet eine HTTP-Antwort einem Fehlercode zu. */
export function ordneFehler(status: number, body: unknown, contentType: string): EzrFehlerCode {
  const code = typeof (body as any)?.code === "string" ? String((body as any).code) : "";
  if (BEKANNT.has(code)) return code as EzrFehlerCode;
  if (code === "rest_no_route") return "ezr_plugin_missing";
  // Sicherheits-Plugins, die die REST-API für Gäste sperren, antworten mit
  // eigenen Codes, bevor unsere Schlüsselprüfung überhaupt läuft.
  if (/^(rest_not_logged_in|rest_cannot_access|rest_disabled|rest_forbidden)/.test(code))
    return "ezr_blocked";
  if (status === 404) return "ezr_plugin_missing";
  if (status === 429) return "ezr_rate_limited";
  // HTML statt JSON bei 401/403/406/503 = WAF, ModSecurity, Cloudflare, Hoster
  if ([401, 403, 406, 503].includes(status) && !/json/i.test(contentType)) return "ezr_blocked";
  if (status === 401) return "ezr_auth_invalid";
  return "ezr_unexpected";
}

export async function ezrRequest<T = any>(
  conn: EzrVerbindung,
  method: "GET" | "POST" | "PATCH",
  pfad: string,
  body?: unknown,
  timeoutMs = 20_000,
): Promise<EzrAntwort<T>> {
  const site = normalizeSiteUrl(conn.siteUrl);
  if (!/^https:\/\//i.test(site))
    return { ok: false, status: 0, code: "ezr_https_required", message: "Kein HTTPS" };
  let r: Response;
  try {
    r = await fetch(`${site}${EZR_NS}${pfad}`, {
      method,
      headers: {
        Authorization: `Bearer ${conn.key}`,
        "X-EzyRank-Key": conn.key,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    return {
      ok: false,
      status: 0,
      code: "ezr_unreachable",
      message: e instanceof Error ? e.message : String(e),
    };
  }
  const ct = r.headers.get("content-type") || "";
  // Weiterleitung (z.B. http→https oder www) = falsche Site-URL bzw. kein HTTPS
  if (r.status >= 300 && r.status < 400) {
    const ziel = r.headers.get("location") || "";
    return {
      ok: false,
      status: r.status,
      code: /^http:\/\//i.test(ziel) ? "ezr_https_required" : "ezr_unexpected",
      message: `Weiterleitung nach ${ziel || "?"} – bitte die genaue Site-URL eintragen`,
    };
  }
  const data: any = /json/i.test(ct) ? await r.json().catch(() => null) : null;
  if (r.ok && data) return { ok: true, status: r.status, data };
  const code = ordneFehler(r.status, data, ct);
  return {
    ok: false,
    status: r.status,
    code,
    message: String(data?.message || `HTTP ${r.status}`).slice(0, 300),
  };
}

export type EzrTestErgebnis = {
  ok: boolean;
  dauer_ms: number;
  schritte: Array<{ schritt: "health" | "capabilities" | "test"; ok: boolean; ms: number }>;
  plugin_version: string | null;
  scopes: string[];
  capabilities: Record<string, unknown> | null;
  error_code: EzrFehlerCode | null;
  hilfe: string | null;
  message: string | null;
};

/** Verbindungstest aus Kap. 6A Schritt 6: /health → /capabilities → /test. */
export async function testeVerbindung(conn: EzrVerbindung): Promise<EzrTestErgebnis> {
  const t0 = Date.now();
  const schritte: EzrTestErgebnis["schritte"] = [];
  const fertig = (
    teil: Partial<EzrTestErgebnis> & { error_code: EzrFehlerCode | null; message?: string | null },
  ): EzrTestErgebnis => ({
    ok: !teil.error_code,
    dauer_ms: Date.now() - t0,
    schritte,
    plugin_version: teil.plugin_version ?? null,
    scopes: teil.scopes ?? [],
    capabilities: teil.capabilities ?? null,
    error_code: teil.error_code,
    hilfe: teil.error_code ? EZR_HILFE[teil.error_code] : null,
    message: teil.message ?? null,
  });

  let s = Date.now();
  const health = await ezrRequest(conn, "GET", "/health");
  schritte.push({ schritt: "health", ok: health.ok, ms: Date.now() - s });
  if (!health.ok) return fertig({ error_code: health.code, message: health.message });
  const plugin_version = String(health.data?.plugin_version || "") || null;

  s = Date.now();
  const caps = await ezrRequest(conn, "GET", "/capabilities");
  schritte.push({ schritt: "capabilities", ok: caps.ok, ms: Date.now() - s });
  if (!caps.ok) return fertig({ error_code: caps.code, message: caps.message, plugin_version });
  const scopes: string[] = Array.isArray(caps.data?.scopes) ? caps.data.scopes.map(String) : [];

  s = Date.now();
  const test = await ezrRequest(conn, "POST", "/test", {});
  schritte.push({ schritt: "test", ok: test.ok, ms: Date.now() - s });
  if (!test.ok)
    return fertig({
      error_code: test.code,
      message: test.message,
      plugin_version,
      scopes,
      capabilities: caps.data,
    });
  return fertig({ error_code: null, plugin_version, scopes, capabilities: caps.data });
}

/** Fehler, bei denen der eingegebene Schlüssel sicher nutzlos ist → nicht speichern. */
export function schluesselVerwerfen(code: EzrFehlerCode | null): boolean {
  return (
    code === "ezr_auth_missing" ||
    code === "ezr_auth_invalid" ||
    code === "ezr_plugin_missing" ||
    code === "ezr_unreachable" ||
    code === "ezr_https_required"
  );
}
