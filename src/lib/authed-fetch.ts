// Zentraler Fetch-Helfer fuer eigene API-Routen (13.09.2026).
//
// Haengt automatisch den Supabase-Bearer (aktuelle Session) und die aktive
// Organisation (X-Ezy-Active-Org, aus der validierten Browser-Wahl) an.
// Damit werten alle Server-Routen die Rolle EXAKT in der aktiven Organisation
// aus und liefern nach erfolgter Wahl nie 409 «aktive Organisation angeben».
//
// Explizit gesetzte Header des Aufrufers gewinnen (z. B. eigener Bearer in
// Tests); Content-Type wird nur ergaenzt, wenn ein String-Body ohne Angabe
// mitkommt (JSON-Konvention der Routen).
import { supabase } from "@/integrations/supabase/client";
import { leseAktiveOrg } from "@/lib/active-org";

export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  if (!headers.has("authorization")) {
    const session = (await supabase.auth.getSession()).data.session;
    if (session?.access_token) headers.set("authorization", `Bearer ${session.access_token}`);
  }
  const org = leseAktiveOrg();
  if (org && !headers.has("x-ezy-active-org")) headers.set("x-ezy-active-org", org);
  if (typeof init.body === "string" && !headers.has("content-type"))
    headers.set("content-type", "application/json");
  return fetch(input, { ...init, headers });
}

/** Bequemer JSON-Aufruf: wirft nicht, liefert { status, json }. */
export async function authedJson<T = any>(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<{ status: number; ok: boolean; json: T | null }> {
  const r = await authedFetch(input, init);
  const json = (await r.json().catch(() => null)) as T | null;
  return { status: r.status, ok: r.ok, json };
}
