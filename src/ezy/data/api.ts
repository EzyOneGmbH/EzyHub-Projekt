import { supabase } from "@/integrations/supabase/client";
import { authedFetch } from "@/lib/authed-fetch";

const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || "").replace(/\/$/, "");

export function ezyApiUrl(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE_URL}${normalized}`;
}

export async function ezyAuthHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

// Multi-Org (13.09.2026): ezyFetch ist nur noch ein duenner Wrapper um
// authedFetch — Bearer UND X-Ezy-Active-Org kommen aus EINER Quelle. Vorher
// sendete ezyFetch keine aktive Organisation (Agenten, Tools, Ads-Autopilot,
// Conversion-Scout liefen damit bei Mehrfach-Mitgliedschaft in 409/falsche Org).
export async function ezyFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return authedFetch(ezyApiUrl(path), init);
}
