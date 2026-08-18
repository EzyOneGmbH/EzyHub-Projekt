// Kunden-Avatar mit echtem Favicon (Volkan 13.08.): lädt das Favicon der
// Kundendomain über den Google-Favicon-Dienst und fällt bei fehlender Domain
// oder Ladefehler sauber auf die Initialen zurück. Ein Modul für alle Apps —
// Kacheln, Sidebar, Listen sehen dadurch überall gleich aus.
import { useState, useEffect } from "react";

function initialsFromName(name = ""): string {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  const chars = (parts.length === 1 ? [parts[0][0]] : [parts[0][0], parts[parts.length - 1][0]])
    .filter(Boolean)
    .join("");
  return chars.toUpperCase().slice(0, 2) || "—";
}

/** Blanke Host-Form aus einem Domain-/URL-String (ohne Protokoll, www, Pfad). */
export function hostOf(domain?: string | null): string | null {
  if (!domain) return null;
  const d = String(domain)
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0]
    .split("?")[0];
  // Muss wie eine Domain aussehen (mind. ein Punkt) — sonst kein Favicon-Versuch.
  return d && d.includes(".") ? d : null;
}

export function faviconUrl(domain?: string | null, size = 64): string | null {
  const host = hostOf(domain);
  return host
    ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=${size}`
    : null;
}

export function ClientAvatar({
  name,
  domain,
  size = 38,
  radius = 10,
  bg = "rgba(119,0,140,0.09)",
  fg = "#B9009C",
  fontSize,
}: {
  name?: string;
  domain?: string | null;
  size?: number;
  radius?: number;
  bg?: string;
  fg?: string;
  fontSize?: number;
}) {
  const src = faviconUrl(domain, size >= 32 ? 64 : 32);
  const [failed, setFailed] = useState(false);
  // Domainwechsel (z. B. Filter/Neuladen): Fehlerzustand zurücksetzen.
  useEffect(() => setFailed(false), [src]);
  const showImg = Boolean(src) && !failed;

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        flexShrink: 0,
        background: bg,
        color: fg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: fontSize ?? Math.max(10, Math.round(size * 0.34)),
        fontWeight: 700,
        overflow: "hidden",
      }}
    >
      {showImg ? (
        <img
          src={src as string}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          style={{
            width: "72%",
            height: "72%",
            objectFit: "contain",
            display: "block",
            borderRadius: 4,
          }}
        />
      ) : (
        initialsFromName(name)
      )}
    </div>
  );
}
