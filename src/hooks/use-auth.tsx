/* eslint-disable react-refresh/only-export-components -- shadcn/template files intentionally export non-component helpers (variants/contexts/hooks) alongside components. */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import {
  leseAktiveOrg,
  speichereAktiveOrg,
  waehleAktiveOrg,
  type Mitgliedschaft,
  type OrgRole,
} from "@/lib/active-org";

export type { OrgRole };

export type Membership = {
  organization_id: string;
  role: OrgRole;
};

export type Organisation = { id: string; name: string };

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  /** ALLE Mitgliedschaften des Nutzers (Mehrfach-Organisationen, 13.09.2026). */
  memberships: Membership[];
  /** Organisationen zu den Mitgliedschaften (fuer die Auswahl), Name best-effort. */
  organizations: Organisation[];
  /** Aktive Mitgliedschaft — Rolle gilt EXAKT in dieser Organisation. */
  membership: Membership | null;
  role: OrgRole | null;
  organizationId: string | null;
  /** Mehrere Organisationen, aber (noch) keine gueltige Wahl. */
  auswahlNoetig: boolean;
  /** Aktive Organisation waehlen (nur eigene Mitgliedschaften; wird gespeichert). */
  setActiveOrganization: (organizationId: string) => boolean;
  /** legacy global admin (kept for backwards compat with /admin/users) */
  isAdmin: boolean;
  /** owner or admin in current org */
  isOrgAdmin: boolean;
  /** owner | admin | member */
  canRunAudits: boolean;
  hasRole: (...roles: OrgRole[]) => boolean;
  loading: boolean;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const ROLLE_LABEL: Record<OrgRole, string> = {
  owner: "SuperAdmin",
  admin: "Admin",
  member: "Mitarbeiter",
  viewer: "Kunde",
};

/** Auswahl-Karte bei mehreren Organisationen ohne gueltige Wahl. */
function OrgAuswahl({
  organizations,
  memberships,
  onWahl,
  onAbmelden,
}: {
  organizations: Organisation[];
  memberships: Membership[];
  onWahl: (id: string) => void;
  onAbmelden: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f6f2f8",
        padding: 20,
        fontFamily: "Poppins, system-ui, sans-serif",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#fff",
          border: "1px solid #eae4ee",
          borderRadius: 16,
          padding: 28,
          boxShadow: "0 10px 40px rgba(119,0,140,.08)",
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 700, color: "#161217" }}>Organisation wählen</div>
        <div style={{ fontSize: 13, color: "#6d6473", margin: "6px 0 18px", lineHeight: 1.5 }}>
          Du bist in mehreren Organisationen Mitglied. Wähle, in welcher du jetzt arbeiten möchtest
          — Rechte und Kunden gelten nur innerhalb dieser Organisation.
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {memberships.map((m) => {
            const org = organizations.find((o) => o.id === m.organization_id);
            return (
              <button
                key={m.organization_id}
                onClick={() => onWahl(m.organization_id)}
                style={{
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 10,
                  border: "1px solid #eae4ee",
                  background: "#fbf9fc",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{ fontWeight: 700, fontSize: 14, color: "#161217" }}>
                  {org?.name || "Organisation"}
                </div>
                <div style={{ fontSize: 12, color: "#77008C", marginTop: 2 }}>
                  Rolle: {ROLLE_LABEL[m.role] || m.role}
                </div>
              </button>
            );
          })}
        </div>
        <button
          onClick={onAbmelden}
          style={{
            marginTop: 16,
            background: "none",
            border: "none",
            color: "#6d6473",
            fontSize: 12.5,
            cursor: "pointer",
            fontFamily: "inherit",
            padding: 0,
          }}
        >
          Abmelden
        </button>
      </div>
    </div>
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [organizations, setOrganizations] = useState<Organisation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [auswahlNoetig, setAuswahlNoetig] = useState(false);
  const [legacyAdmin, setLegacyAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  // Mehrfach-Organisationen (13.09.2026): ALLE Mitgliedschaften laden, die
  // gespeicherte Wahl gegen den frischen Bestand validieren — nie
  // order("role").limit(1) (das nahm die hoechste Rolle irgendeiner Org).
  const loadProfile = useCallback(async (userId: string) => {
    const [m, r] = await Promise.all([
      supabase.from("app_users").select("organization_id, role").eq("user_id", userId),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    const alle: Membership[] = (m.data ?? [])
      .filter((x: any) => x?.organization_id)
      .map((x: any) => ({ organization_id: String(x.organization_id), role: x.role as OrgRole }));
    setMemberships(alle);
    setLegacyAdmin((r.data ?? []).some((x: { role: string }) => x.role === "admin"));

    const wahl = waehleAktiveOrg(
      alle.map<Mitgliedschaft>((x) => ({ organizationId: x.organization_id, role: x.role })),
      leseAktiveOrg(),
    );
    setActiveId(wahl.organizationId);
    setAuswahlNoetig(wahl.auswahlNoetig);
    // Gespeicherte Wahl nachziehen bzw. ungueltige Wahl verwerfen.
    speichereAktiveOrg(wahl.organizationId);

    // Namen fuer die Auswahl (best effort — RLS erlaubt Mitgliedern das Lesen).
    if (alle.length > 1) {
      const { data: orgs } = await (supabase as any)
        .from("organizations")
        .select("id, name")
        .in(
          "id",
          alle.map((x) => x.organization_id),
        );
      setOrganizations(
        (orgs ?? []).map((o: any) => ({ id: String(o.id), name: String(o.name || "") })),
      );
    } else {
      setOrganizations([]);
    }
  }, []);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => loadProfile(s.user.id), 0);
      } else {
        setMemberships([]);
        setOrganizations([]);
        setActiveId(null);
        setAuswahlNoetig(false);
        setLegacyAdmin(false);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, [loadProfile]);

  const setActiveOrganization = useCallback(
    (organizationId: string): boolean => {
      const hit = memberships.find((m) => m.organization_id === organizationId);
      if (!hit) return false; // nur eigene Mitgliedschaften — nie fremde Orgs
      speichereAktiveOrg(hit.organization_id);
      setActiveId(hit.organization_id);
      setAuswahlNoetig(false);
      return true;
    },
    [memberships],
  );

  const membership = memberships.find((m) => m.organization_id === activeId) ?? null;
  const role = membership?.role ?? null;
  const isOrgAdmin = role === "owner" || role === "admin";
  const canRunAudits = role === "owner" || role === "admin" || role === "member";

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    memberships,
    organizations,
    membership,
    role,
    organizationId: membership?.organization_id ?? null,
    auswahlNoetig,
    setActiveOrganization,
    isAdmin: legacyAdmin || isOrgAdmin,
    isOrgAdmin,
    canRunAudits,
    hasRole: (...roles) => (role ? roles.includes(role) : false),
    loading,
    signOut: async () => {
      speichereAktiveOrg(null);
      await supabase.auth.signOut();
    },
    refresh: async () => {
      if (session?.user) await loadProfile(session.user.id);
    },
  };

  return (
    <AuthContext.Provider value={value}>
      {session && auswahlNoetig ? (
        <OrgAuswahl
          organizations={organizations}
          memberships={memberships}
          onWahl={(id) => setActiveOrganization(id)}
          onAbmelden={() => void value.signOut()}
        />
      ) : (
        children
      )}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
