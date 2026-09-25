// Zentraler Modell-Katalog fuer die EzyOne-Agenten (25.09.2026).
//
// Der agent-service kennt zwei Runner: "claude" (Claude-Abo) und "codex"
// (OpenAI Codex ueber das ChatGPT-Abo des Inhabers). Die verbindliche Liste
// liefert der agent-service unter GET /models (Proxy: /api/agent/runs?view=models);
// dieser Katalog ist der Fallback, falls der Dienst nicht erreichbar ist, und
// die einzige Stelle fuer Defaults und Anzeige-Labels (auch alter Modell-Ids).

export type AgentProvider = "claude" | "codex";

export interface AgentModel {
  id: string;
  /** Anzeige-Label im Auswahlfeld. */
  label: string;
  /** Kurzform fuer Badges («Sonnet 5»). */
  kurz?: string;
  hinweis?: string;
}

export interface ProviderInfo {
  id: AgentProvider;
  label: string;
  abrechnung: string;
  verfuegbar: boolean;
  modelle: AgentModel[];
}

export interface AufgabenEmpfehlung {
  id: string;
  label: string;
  empfehlung: { provider: AgentProvider; model: string };
  begruendung: string;
}

export interface CodexHealth {
  installiert?: boolean;
  angemeldet?: boolean;
}

export const DEFAULT_AGENT_MODEL: { provider: AgentProvider; model: string } = {
  provider: "claude",
  model: "claude-sonnet-5",
};

export const PROVIDER_KURZ: Record<AgentProvider, string> = { claude: "Claude", codex: "Codex" };

export const FALLBACK_PROVIDERS: ProviderInfo[] = [
  {
    id: "claude",
    label: "Claude-Abo",
    abrechnung: "Claude-Abo",
    verfuegbar: true,
    modelle: [
      {
        id: "claude-sonnet-5",
        label: "Sonnet 5 (Standard)",
        kurz: "Sonnet 5",
        hinweis: "Schnell und stark — Standard für die meisten Agenten.",
      },
      {
        id: "claude-opus-4-8",
        label: "Opus 4.8 (stärkstes)",
        kurz: "Opus 4.8",
        hinweis: "Für anspruchsvolle Analysen; langsamer, belastet das Abo-Kontingent stärker.",
      },
      {
        id: "claude-haiku-4-5",
        label: "Haiku 4.5 (schnell, leicht)",
        kurz: "Haiku 4.5",
        hinweis: "Für einfache Routineaufgaben.",
      },
      {
        id: "claude-fable-5-1",
        label: "Fable 5.1",
        kurz: "Fable 5.1",
        hinweis: "Neuestes Modell der Fable-Reihe.",
      },
    ],
  },
  {
    id: "codex",
    label: "ChatGPT-Abo (Codex)",
    abrechnung: "ChatGPT-Abo",
    verfuegbar: true,
    modelle: [
      {
        id: "standard",
        label: "Standard (Codex-Standardmodell)",
        kurz: "Standard",
        hinweis: "Codex-Standardmodell über das ChatGPT-Abo.",
      },
    ],
  },
];

/** Alte Ids bestehender Agenten — nur zur Anzeige, nicht mehr auswählbar. */
export const LEGACY_MODELS: (AgentModel & { provider: AgentProvider })[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Sonnet 4.6 (ältere Version)",
    kurz: "Sonnet 4.6",
    provider: "claude",
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Haiku 4.5 (ältere Version)",
    kurz: "Haiku 4.5",
    provider: "claude",
  },
  { id: "claude-fable-5", label: "Fable 5 (ältere Version)", kurz: "Fable 5", provider: "claude" },
];

export const PROVIDER_HINWEIS: Record<AgentProvider, string> = {
  claude: "Abrechnung über das Claude-Abo (keine API-Kosten).",
  codex:
    "Abrechnung über das ChatGPT-Abo — nutzt das ChatGPT-Kontingent (Nutzungsfenster); bei Limit Rückfall auf Claude.",
};

export const CODEX_NICHT_ANGEMELDET = "Codex nicht angemeldet (auf dem Cloud-PC `codex login`)";

const isProvider = (v: unknown): v is AgentProvider => v === "claude" || v === "codex";

function alleModelle(providers: ProviderInfo[] = FALLBACK_PROVIDERS) {
  const out: (AgentModel & { provider: AgentProvider })[] = [];
  for (const p of [...providers, ...FALLBACK_PROVIDERS])
    for (const m of p.modelle || []) out.push({ ...m, provider: p.id });
  return [...out, ...LEGACY_MODELS];
}

/**
 * Anbieter eines Modells bzw. Agenten. Ein explizites `provider`-Feld gewinnt;
 * sonst wird aus der Modell-Id abgeleitet. Unbekanntes faellt auf Claude
 * (der bisherige einzige Runner).
 */
export function providerVon(
  x: string | { provider?: unknown; model?: unknown } | null | undefined,
  providers: ProviderInfo[] = FALLBACK_PROVIDERS,
): AgentProvider {
  if (x && typeof x === "object") {
    if (isProvider(x.provider)) return x.provider;
    return providerVon(typeof x.model === "string" ? x.model : "", providers);
  }
  const id = String(x || "").trim();
  if (!id) return DEFAULT_AGENT_MODEL.provider;
  const bekannt = alleModelle(providers).find((m) => m.id === id);
  if (bekannt) return bekannt.provider;
  if (/^claude/i.test(id)) return "claude";
  if (/^(codex|gpt|o\d)/i.test(id)) return "codex";
  return DEFAULT_AGENT_MODEL.provider;
}

/** Kurzes Anzeige-Label einer Modell-Id («Sonnet 5»); Unbekanntes = Id. */
export function labelFuer(
  id: string | null | undefined,
  providers: ProviderInfo[] = FALLBACK_PROVIDERS,
): string {
  const s = String(id || "").trim();
  if (!s) return "";
  const katalog = [...FALLBACK_PROVIDERS.flatMap((p) => p.modelle), ...LEGACY_MODELS].find(
    (m) => m.id === s,
  );
  if (katalog) return katalog.kurz || katalog.label;
  const server = alleModelle(providers).find((m) => m.id === s);
  return server ? server.kurz || server.label : s;
}

/** Badge fuer die Agentenliste: «Claude · Sonnet 5» bzw. «Codex · Standard». */
export function badgeFuer(
  agent: { provider?: unknown; model?: unknown } | null | undefined,
  providers: ProviderInfo[] = FALLBACK_PROVIDERS,
): string {
  const p = providerVon(agent, providers);
  const model =
    typeof agent?.model === "string" && agent.model ? agent.model : defaultModelFuer(p, providers);
  return `${PROVIDER_KURZ[p]} · ${labelFuer(model, providers)}`;
}

/** Auswaehlbare Modelle eines Anbieters (ohne Legacy-Ids). */
export function modelleFuer(
  provider: AgentProvider,
  providers: ProviderInfo[] = FALLBACK_PROVIDERS,
): AgentModel[] {
  const p =
    providers.find((x) => x.id === provider) || FALLBACK_PROVIDERS.find((x) => x.id === provider);
  return p?.modelle?.length
    ? p.modelle
    : FALLBACK_PROVIDERS.find((x) => x.id === provider)!.modelle;
}

/** Standardmodell eines Anbieters (Claude: claude-sonnet-5). */
export function defaultModelFuer(
  provider: AgentProvider,
  providers: ProviderInfo[] = FALLBACK_PROVIDERS,
): string {
  if (provider === DEFAULT_AGENT_MODEL.provider) {
    const liste = modelleFuer(provider, providers);
    if (liste.some((m) => m.id === DEFAULT_AGENT_MODEL.model)) return DEFAULT_AGENT_MODEL.model;
  }
  return modelleFuer(provider, providers)[0]?.id || DEFAULT_AGENT_MODEL.model;
}

/**
 * Antwort von /api/agent/runs?view=models robust normalisieren: gueltige
 * Server-Daten gewinnen, sonst Fallback-Katalog. Aufgaben ohne gueltige
 * Empfehlung werden verworfen.
 */
export function normalisiereModelle(j: any): {
  providers: ProviderInfo[];
  aufgaben: AufgabenEmpfehlung[];
  codex: CodexHealth | null;
  ausFallback: boolean;
} {
  // agent-service liefert providers als Objekt {claude:{…}, codex:{…}} und
  // Empfehlungen als Objekt {audit:{…}} — beide Formen (Objekt/Liste) annehmen.
  // Codex-Standardmodell kommt als leere Id "" → intern "standard".
  const modellId = (id: unknown) => (id === "" ? "standard" : id);
  const roh = Array.isArray(j?.providers)
    ? j.providers
    : j?.providers && typeof j.providers === "object"
      ? Object.entries(j.providers).map(([id, p]: [string, any]) => ({
          id,
          ...p,
          modelle: Array.isArray(p?.modelle)
            ? p.modelle.map((m: any) => ({ ...m, id: modellId(m?.id) }))
            : p?.modelle,
        }))
      : null;
  const providers: ProviderInfo[] = roh
    ? roh
        .filter((p: any) => isProvider(p?.id))
        .map((p: any) => {
          const fb = FALLBACK_PROVIDERS.find((x) => x.id === p.id)!;
          const modelle = Array.isArray(p.modelle)
            ? p.modelle
                .filter((m: any) => typeof m?.id === "string" && m.id)
                .map((m: any) => ({
                  id: m.id,
                  label: String(m.label || m.id),
                  kurz: fb.modelle.find((x) => x.id === m.id)?.kurz,
                  hinweis: m.hinweis ? String(m.hinweis) : undefined,
                }))
            : [];
          return {
            id: p.id,
            label: String(p.label || fb.label),
            abrechnung: String(p.abrechnung || fb.abrechnung),
            verfuegbar: p.verfuegbar !== false,
            modelle: modelle.length ? modelle : fb.modelle,
          };
        })
    : [];
  // Fehlende Anbieter aus dem Fallback ergaenzen (Reihenfolge: claude, codex).
  const vollstaendig = FALLBACK_PROVIDERS.map((fb) => providers.find((p) => p.id === fb.id) || fb);
  const AUFGABEN_LABEL: Record<string, string> = {
    audit: "SEO-Audit & Analyse",
    content: "Content / Blog schreiben",
    ads: "Google Ads steuern",
    recherche_geo: "Recherche & KI-Sichtbarkeit (GEO)",
    reaktivierung: "Reaktivierung / Kampagnen-Entwürfe",
    freigabe: "Freigaben umsetzen",
  };
  const rohAufgaben: any[] | null = Array.isArray(j?.aufgaben)
    ? j.aufgaben
    : j?.empfehlungen && typeof j.empfehlungen === "object"
      ? Object.entries(j.empfehlungen).map(([id, e]: [string, any]) => ({
          id,
          label: AUFGABEN_LABEL[id] || id,
          empfehlung: { provider: e?.provider, model: modellId(e?.model) },
          begruendung: e?.begruendung,
        }))
      : null;
  const aufgaben: AufgabenEmpfehlung[] = rohAufgaben
    ? rohAufgaben
        .filter(
          (a: any) =>
            typeof a?.id === "string" &&
            isProvider(a?.empfehlung?.provider) &&
            typeof a?.empfehlung?.model === "string",
        )
        .map((a: any) => ({
          id: a.id,
          label: String(a.label || a.id),
          empfehlung: { provider: a.empfehlung.provider, model: a.empfehlung.model },
          begruendung: String(a.begruendung || ""),
        }))
    : [];
  const codex = j?.codex && typeof j.codex === "object" ? (j.codex as CodexHealth) : null;
  return { providers: vollstaendig, aufgaben, codex, ausFallback: !roh || !providers.length };
}

/**
 * Grund, warum Codex nicht waehlbar ist — oder null. Nur ein explizites
 * `angemeldet === false` (bzw. `verfuegbar === false`) sperrt; unbekannter
 * Status (Dienst nicht erreichbar) sperrt nicht.
 */
export function codexSperre(
  codex: CodexHealth | null | undefined,
  providers: ProviderInfo[] = FALLBACK_PROVIDERS,
): string | null {
  if (codex?.angemeldet === false) return CODEX_NICHT_ANGEMELDET;
  if (codex?.installiert === false) return "Codex ist auf dem Cloud-PC nicht installiert.";
  if (providers.find((p) => p.id === "codex")?.verfuegbar === false)
    return "Codex ist derzeit nicht verfügbar.";
  return null;
}
