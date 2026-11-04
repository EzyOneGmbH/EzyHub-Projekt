import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// Neuen Einladungs-/Passwort-Link senden (04.11.2026). Gemeinsam genutzt von
// /api/auth/neuer-link (Nutzer selbst, Link abgelaufen) und /api/admin/team
// action "resend" (Admin verschickt den Link erneut).
// Noch nie bestaetigt -> Einladung erneut; sonst -> Passwort-Link.

export type LinkArt = "einladung" | "passwort";

export function linkStatus(u: Pick<User, "email_confirmed_at" | "last_sign_in_at">) {
  if (!u.email_confirmed_at) return "eingeladen" as const;
  if (!u.last_sign_in_at) return "bestaetigt" as const;
  return "aktiv" as const;
}

/** Zeitpunkt der letzten von Supabase verschickten Auth-Mail (ms), 0 = nie. */
export function zuletztGesendet(
  u: Pick<User, "invited_at" | "confirmation_sent_at" | "recovery_sent_at">,
) {
  return Math.max(
    0,
    ...[u.invited_at, u.confirmation_sent_at, u.recovery_sent_at]
      .filter(Boolean)
      .map((t) => new Date(t as string).getTime()),
  );
}

export function originVon(request: Request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return "https://ezyhub.ch";
  }
}

export async function sendeNeuenLink(
  u: Pick<User, "email" | "email_confirmed_at">,
  origin: string,
): Promise<{ art: LinkArt; error?: string }> {
  const email = (u.email || "").toLowerCase();
  if (!email) return { art: "passwort", error: "Konto ohne E-Mail-Adresse" };
  const redirectTo = `${origin}/set-password`;
  if (!u.email_confirmed_at) {
    const { error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (!error) return { art: "einladung" };
  }
  const { error } = await supabaseAdmin.auth.resetPasswordForEmail(email, { redirectTo });
  return { art: "passwort", error: error?.message };
}
