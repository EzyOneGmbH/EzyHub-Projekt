/**
 * Normalizes CANONRY_BASE_URL so it always ends with a versioned API root.
 * Accepts:
 *   https://api.canonry.ai
 *   https://api.canonry.ai/
 *   https://api.canonry.ai/api/v1
 *   https://api.canonry.ai/api/v1/
 * Returns base without trailing slash, with /api/v1 suffix if no path was present.
 */
export function normalizeCanonryBase(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (!u.pathname || u.pathname === "/" || u.pathname === "") {
      return `${trimmed}/api/v1`;
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

export function canonryUrl(base: string, path: string): string {
  return `${normalizeCanonryBase(base)}/${path.replace(/^\/+/, "")}`;
}
