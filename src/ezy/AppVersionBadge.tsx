// Dezente Versionsnummer unten rechts in jeder Web-App (Volkan 13.08.).
// Zeigt "v1.2.0" als kleines Pill; beim Hover klappt eine kurze Änderungs-
// historie auf, damit sichtbar ist, dass laufend Updates kommen.
//
// Framework-agnostisch nutzbar aus .jsx (EzyOneApp) und .tsx (ezyai) —
// Palette per Prop überschreibbar, sonst Ezy-One-CD-Defaults.
import { useState } from "react";
import { versionFor } from "@/ezy/data/appVersions";

type Palette = { accent?: string; text?: string; muted?: string; border?: string; card?: string };

export function AppVersionBadge({
  appId,
  palette = {},
}: {
  appId: string | null | undefined;
  palette?: Palette;
}) {
  const [open, setOpen] = useState(false);
  const info = versionFor(appId);
  const c = {
    accent: palette.accent ?? "#77008C",
    text: palette.text ?? "#161217",
    muted: palette.muted ?? "#6d6473",
    border: palette.border ?? "#eae4ee",
    card: palette.card ?? "#ffffff",
  };
  const log = info.changelog.slice(0, 5);

  return (
    <div
      style={{ position: "fixed", right: 14, bottom: 12, zIndex: 45 }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      {open && log.length > 0 && (
        <div
          style={{
            position: "absolute",
            right: 0,
            bottom: "calc(100% + 8px)",
            width: 268,
            background: c.card,
            border: `1px solid ${c.border}`,
            borderRadius: 12,
            boxShadow: "0 8px 28px rgba(13,13,13,.12)",
            padding: "12px 14px",
            fontFamily: "'Aceh Soft','Nunito Sans','Segoe UI',sans-serif",
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: c.accent,
              letterSpacing: ".4px",
              textTransform: "uppercase",
              marginBottom: 8,
            }}
          >
            Änderungen
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {log.map((e) => (
              <div key={e.version} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <span
                  style={{
                    flexShrink: 0,
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: c.accent,
                    fontVariantNumeric: "tabular-nums",
                    minWidth: 38,
                  }}
                >
                  v{e.version}
                </span>
                <span style={{ fontSize: 12, color: c.text, lineHeight: 1.35 }}>
                  {e.note}
                  <span style={{ color: c.muted, marginLeft: 5, fontSize: 10.5 }}>
                    {e.date.slice(8, 10)}.{e.date.slice(5, 7)}.
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 999,
          background: "rgba(255,255,255,.72)",
          border: `1px solid ${c.border}`,
          backdropFilter: "blur(6px)",
          fontSize: 11,
          fontWeight: 600,
          color: c.muted,
          fontVariantNumeric: "tabular-nums",
          cursor: "default",
          userSelect: "none",
          fontFamily: "'Aceh Soft','Nunito Sans','Segoe UI',sans-serif",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: c.accent,
            display: "inline-block",
          }}
        />
        v{info.version}
      </div>
    </div>
  );
}
