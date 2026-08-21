// Ausgelagert aus supabase-config-error.tsx (react-refresh: Komponenten-Datei
// exportiert nur noch die Komponente; 21.08.2026).
const FALLBACK_SUPABASE_URL = "https://glrgccmujzuwnhyvwxyi.supabase.co";
const FALLBACK_SUPABASE_PUBLISHABLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdscmdjY211anp1d25oeXZ3eHlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwNzE4ODIsImV4cCI6MjA5MzY0Nzg4Mn0.AOITFOXW-8bzgMljEx7dQOd_snxoptGHKGcWLAXZqMA";

export function getMissingSupabaseEnv(): string[] {
  const env = (typeof import.meta !== "undefined" ? import.meta.env : undefined) as
    | Record<string, string | undefined>
    | undefined;
  const missing: string[] = [];
  const supabaseUrl = env?.VITE_SUPABASE_URL || process.env.SUPABASE_URL || FALLBACK_SUPABASE_URL;
  const supabasePublishableKey =
    env?.VITE_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    FALLBACK_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl) missing.push("VITE_SUPABASE_URL");
  if (!supabasePublishableKey) missing.push("VITE_SUPABASE_PUBLISHABLE_KEY");
  return missing;
}
