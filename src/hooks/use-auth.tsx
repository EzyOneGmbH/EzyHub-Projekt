import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type OrgRole = "owner" | "admin" | "member" | "viewer";

export type Membership = {
  organization_id: string;
  role: OrgRole;
};

type AuthContextValue = {
  session: Session | null;
  user: User | null;
  membership: Membership | null;
  role: OrgRole | null;
  organizationId: string | null;
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [membership, setMembership] = useState<Membership | null>(null);
  const [legacyAdmin, setLegacyAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (userId: string) => {
    const [m, r] = await Promise.all([
      supabase
        .from("app_users")
        .select("organization_id, role")
        .eq("user_id", userId)
        .order("role", { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase.from("user_roles").select("role").eq("user_id", userId),
    ]);
    setMembership(m.data ? { organization_id: m.data.organization_id, role: m.data.role as OrgRole } : null);
    setLegacyAdmin((r.data ?? []).some((x: { role: string }) => x.role === "admin"));
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user) {
        setTimeout(() => loadProfile(s.user.id), 0);
      } else {
        setMembership(null);
        setLegacyAdmin(false);
      }
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session?.user) loadProfile(data.session.user.id);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const role = membership?.role ?? null;
  const isOrgAdmin = role === "owner" || role === "admin";
  const canRunAudits = role === "owner" || role === "admin" || role === "member";

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    membership,
    role,
    organizationId: membership?.organization_id ?? null,
    isAdmin: legacyAdmin || isOrgAdmin,
    isOrgAdmin,
    canRunAudits,
    hasRole: (...roles) => (role ? roles.includes(role) : false),
    loading,
    signOut: async () => {
      await supabase.auth.signOut();
    },
    refresh: async () => {
      if (session?.user) await loadProfile(session.user.id);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
