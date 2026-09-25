// Anzeigen-Vorschau (Volkan 25.09.2026): kleine Live-Vorschau in der
// Anzeigenliste + Pop-up mit der offiziellen OpenAI-Vorschau beim Klick.
// Quelle: /api/admin/chatgpt-ads-creative (iframe-Adresse auf ads.openai.com,
// 6 h serverseitig gecacht). Das Bild selbst ist nur ueber diese Vorschau
// sichtbar — die Ads-API liefert kein Bild-File.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X, ExternalLink } from "lucide-react";
import { authedFetch } from "@/lib/authed-fetch";
import { supabase } from "@/integrations/supabase/client";

type Tokens = Record<string, string>;
type AdLike = {
  openai_ad_id: string;
  name?: string | null;
  creative: { title: string | null; body: string | null; target_url: string | null };
};
type Vorschau = { src: string; width: number; height: number };

// Sitzungs-Cache je Anzeige (auch fehlgeschlagene -> kein Dauer-Nachladen).
const memo = new Map<string, Promise<Vorschau | null>>();
function ladeVorschau(clientId: string, adId: string): Promise<Vorschau | null> {
  const k = `${clientId}:${adId}`;
  if (!memo.has(k))
    memo.set(
      k,
      (async () => {
        try {
          const session = (await supabase.auth.getSession()).data.session;
          const r = await authedFetch(
            `/api/admin/chatgpt-ads-creative?client=${encodeURIComponent(clientId)}&ad=${encodeURIComponent(adId)}`,
            { headers: { Authorization: `Bearer ${session?.access_token || ""}` } },
          );
          const j = await r.json().catch(() => ({}));
          return j?.ok && j.src
            ? { src: String(j.src), width: Number(j.width) || 390, height: Number(j.height) || 220 }
            : null;
        } catch {
          return null;
        }
      })(),
    );
  return memo.get(k)!;
}

function useVorschau(clientId: string, adId: string, aktiv: boolean) {
  const [v, setV] = useState<Vorschau | null | undefined>(undefined);
  useEffect(() => {
    if (!aktiv) return;
    let lebt = true;
    ladeVorschau(clientId, adId).then((x) => lebt && setV(x));
    return () => {
      lebt = false;
    };
  }, [clientId, adId, aktiv]);
  return v; // undefined = laedt, null = nicht verfuegbar
}

const THUMB_W = 116;

/** Kleine Live-Vorschau; Klick oeffnet das Pop-up. `fallback` = bisheriges Thumbnail. */
export function AdPreviewThumb({
  clientId,
  ad,
  S,
  fallback,
}: {
  clientId: string;
  ad: AdLike;
  S: Tokens;
  fallback: ReactNode;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [sichtbar, setSichtbar] = useState(false);
  const [offen, setOffen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || sichtbar) return;
    if (typeof IntersectionObserver === "undefined") return setSichtbar(true);
    const io = new IntersectionObserver(
      (es) => es.some((e) => e.isIntersecting) && setSichtbar(true),
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [sichtbar]);
  const v = useVorschau(clientId, ad.openai_ad_id, sichtbar);
  const scale = v ? THUMB_W / v.width : 1;
  return (
    <>
      <span
        ref={ref}
        role="button"
        tabIndex={0}
        title="Anzeigen-Vorschau öffnen"
        onClick={(e) => {
          e.stopPropagation();
          setOffen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            setOffen(true);
          }
        }}
        style={{ display: "inline-flex", cursor: "zoom-in", flexShrink: 0 }}
      >
        {v ? (
          <span
            style={{
              position: "relative",
              width: THUMB_W,
              height: Math.round(v.height * scale),
              overflow: "hidden",
              border: `1px solid ${S.line}`,
              borderRadius: 8,
              background: "#fff",
              display: "inline-block",
            }}
          >
            <iframe
              title={`Vorschau ${ad.openai_ad_id}`}
              src={v.src}
              width={v.width}
              height={v.height}
              loading="lazy"
              scrolling="no"
              tabIndex={-1}
              style={{
                border: "none",
                transform: `scale(${scale})`,
                transformOrigin: "0 0",
                pointerEvents: "none",
              }}
            />
          </span>
        ) : (
          fallback
        )}
      </span>
      {offen && (
        <AdPreviewModal clientId={clientId} ad={ad} S={S} onClose={() => setOffen(false)} />
      )}
    </>
  );
}

export function AdPreviewModal({
  clientId,
  ad,
  S,
  onClose,
}: {
  clientId: string;
  ad: AdLike;
  S: Tokens;
  onClose: () => void;
}) {
  const v = useVorschau(clientId, ad.openai_ad_id, true);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  // Breite: Vorschau 1.25x, auf dem Handy auf die Bildschirmbreite begrenzt.
  const maxW = typeof window !== "undefined" ? Math.min(window.innerWidth - 64, 520) : 520;
  const scale = v ? Math.min(1.25, maxW / v.width) : 1;
  const inhalt = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(13,13,13,.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Anzeigen-Vorschau"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: S.panel || "#fff",
          borderRadius: 16,
          padding: 20,
          maxWidth: "100%",
          boxShadow: "0 20px 60px rgba(0,0,0,.25)",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div
              style={{
                fontSize: 11,
                color: S.mut,
                textTransform: "uppercase",
                letterSpacing: ".04em",
              }}
            >
              Anzeigen-Vorschau
            </div>
            <div style={{ fontSize: 15, fontWeight: 700, color: S.txt }}>
              {ad.name || ad.creative.title || ad.openai_ad_id}
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Schliessen"
            style={{
              border: `1px solid ${S.line}`,
              background: "transparent",
              borderRadius: 8,
              padding: 6,
              cursor: "pointer",
              color: S.txt,
              display: "inline-flex",
            }}
          >
            <X size={16} />
          </button>
        </div>
        {v === undefined ? (
          <div
            style={{
              width: 390 * 1.25,
              maxWidth: "100%",
              padding: 40,
              textAlign: "center",
              color: S.mut,
              fontSize: 13,
            }}
          >
            Vorschau wird geladen…
          </div>
        ) : v === null ? (
          <div style={{ maxWidth: 420, color: S.mut, fontSize: 13, lineHeight: 1.5 }}>
            Für diese Anzeige liefert OpenAI keine Vorschau (z. B. Entwurf oder Demo-Konto).
            <div style={{ marginTop: 10, color: S.txt }}>
              <b>{ad.creative.title}</b>
              <div>{ad.creative.body}</div>
            </div>
          </div>
        ) : (
          <div
            style={{
              width: Math.round(v.width * scale),
              height: Math.round(v.height * scale),
              overflow: "hidden",
              borderRadius: 10,
              border: `1px solid ${S.line}`,
            }}
          >
            <iframe
              title={`Vorschau ${ad.openai_ad_id}`}
              src={v.src}
              width={v.width}
              height={v.height}
              scrolling="no"
              style={{ border: "none", transform: `scale(${scale})`, transformOrigin: "0 0" }}
            />
          </div>
        )}
        <div style={{ marginTop: 12, display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
          {ad.creative.target_url && (
            <a
              href={ad.creative.target_url}
              target="_blank"
              rel="noreferrer"
              style={{ color: S.app || "#77008C" }}
            >
              Zielseite öffnen <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
            </a>
          )}
          {v && (
            <a href={v.src} target="_blank" rel="noreferrer" style={{ color: S.mut }}>
              Vorschau in neuem Tab <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
  return typeof document !== "undefined" ? createPortal(inhalt, document.body) : inhalt;
}
