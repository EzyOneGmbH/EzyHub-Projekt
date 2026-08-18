import React from "react";
import { SERVICE_CATALOG } from "@/lib/services";
import { useEzyServiceSettings } from "@/ezy/data/useEzyServiceSettings";
import { supabase } from "@/integrations/supabase/client";
import { warneBeimServiceDeaktivieren } from "@/ezy/data/appRequirements";

// Service-Auswahl pro Kunde. Zwei Varianten:
//  - <ServicesPicker> : kontrolliert, fuer das Anlegen-Formular (noch keine clientId)
//  - <ServicesPanel>  : live-Toggles fuer einen bestehenden Kunden (clientId)
// Beide rendern aus SERVICE_CATALOG; Google-Dienste werden gruppiert.

const FALLBACK_C = {
  card: "#0f1629",
  border: "#243049",
  text: "#e6edf7",
  textMuted: "#93a1bd",
  textDim: "#6b7894",
  accent: "#6aa6ff",
};

function groupCatalog() {
  const google = SERVICE_CATALOG.filter((s) => s.parent === "google");
  const standalone = SERVICE_CATALOG.filter((s) => s.parent !== "google");
  return { google, standalone };
}

function Row({ C, def, checked, onToggle, busy }) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 10,
        padding: "10px 12px",
        borderRadius: 10,
        border: `1px solid ${C.border}`,
        background: C.card,
        cursor: busy ? "default" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={!!checked}
        disabled={busy}
        onChange={(e) => onToggle(def.key, e.target.checked)}
        style={{ marginTop: 2, accentColor: C.accent, width: 16, height: 16 }}
      />
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>
          {def.label}
          <span
            style={{
              marginLeft: 8,
              fontSize: 10,
              fontWeight: 600,
              color: C.textDim,
              border: `1px solid ${C.border}`,
              borderRadius: 6,
              padding: "1px 6px",
            }}
          >
            {def.connect === "auto" ? "auto" : def.connect === "oauth" ? "OAuth" : "Zugang"}
          </span>
        </span>
        <span style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.4 }}>{def.hint}</span>
      </span>
    </label>
  );
}

function Section({ C, title, defs, isOn, onToggle, busyKey }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 0.4,
          color: C.textDim,
          textTransform: "uppercase",
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        {defs.map((def) => (
          <Row
            key={def.key}
            C={C}
            def={def}
            checked={isOn(def.key)}
            busy={busyKey === def.key}
            onToggle={onToggle}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * Kontrollierte Auswahl fuer das Anlegen-Formular.
 * @param value Set<string> der aktivierten Service-Keys
 * @param onChange (nextSet) => void
 */
export function ServicesPicker({ C = FALLBACK_C, value, onChange }) {
  const { google, standalone } = groupCatalog();
  const isOn = (key) => value?.has?.(key) ?? false;
  const toggle = (key, checked) => {
    const next = new Set(value || []);
    if (checked) next.add(key);
    else next.delete(key);
    onChange?.(next);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Section C={C} title="Google" defs={google} isOn={isOn} onToggle={toggle} />
      <Section C={C} title="Weitere Dienste" defs={standalone} isOn={isOn} onToggle={toggle} />
    </div>
  );
}

/**
 * Live-Toggle-Panel fuer einen bestehenden Kunden (nachtraegliches Aktivieren).
 */
export function ServicesPanel({ C = FALLBACK_C, clientId }) {
  const { enabled, loading, setEnabled } = useEzyServiceSettings(clientId);
  const { google, standalone } = groupCatalog();
  const [busyKey, setBusyKey] = React.useState(null);
  const isOn = (key) => !!enabled[key];
  const toggle = async (key, value) => {
    // Konfigurationsvalidierung (17.08.): Service deaktivieren, den eine aktive
    // App braucht (z. B. google-ads bei aktivem EzyPerformance) -> Warnung
    // statt stillem Widerspruch. Anforderungen zentral in appRequirements.ts.
    if (!value) {
      try {
        const token = (await supabase.auth.getSession()).data.session?.access_token;
        const r = await fetch(`/api/admin/client-readiness?client=${encodeURIComponent(clientId)}`, {
          headers: { Authorization: `Bearer ${token || ""}` },
        });
        const j = await r.json().catch(() => null);
        if (j?.ok) {
          const warnungen = warneBeimServiceDeaktivieren(key, j.snapshot);
          if (warnungen.length) {
            const text = `Achtung — dieser Service wird gebraucht:\n\n${warnungen
              .map((w) => `• ${w.text}`)
              .join("\n")}\n\nTrotzdem deaktivieren?`;
            if (!window.confirm(text)) return;
          }
        }
      } catch { /* Validierung best effort — Toggle nicht blockieren */ }
    }
    setBusyKey(key);
    try {
      await setEnabled(key, value);
    } finally {
      setBusyKey(null);
    }
  };
  if (loading) {
    return <div style={{ fontSize: 13, color: C.textMuted }}>Lade Dienste…</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ fontSize: 12, color: C.textMuted, margin: 0, lineHeight: 1.5 }}>
        Aktivierte Dienste werden automatisch verbunden (sofern die Zugangsdaten/Property hinterlegt
        sind). Deaktivierte Dienste werden ignoriert, bis du sie hier einschaltest.
      </p>
      <Section C={C} title="Google" defs={google} isOn={isOn} onToggle={toggle} busyKey={busyKey} />
      <Section
        C={C}
        title="Weitere Dienste"
        defs={standalone}
        isOn={isOn}
        onToggle={toggle}
        busyKey={busyKey}
      />
    </div>
  );
}
