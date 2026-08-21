-- Chancen-Workflow v2 (21.08.2026): Team-Verantwortliche, Wiedervorlage-
-- Benachrichtigungen und die dafür nötigen RLS-sicheren Funktionen.
--
-- ACHTUNG: Lovable wendet Repo-Migrationen nicht automatisch an — dieses File
-- wird manuell via Lovable-SQL ausgeführt (wie 20260818090000).

-- 1) Verantwortliche eindeutig per User-ID statt Freitext. Die alte Freitext-
--    Spalte assignee bleibt als lesbares Erbe/Anzeige-Snapshot bestehen.
alter table public.ai_opportunity_states
  add column if not exists assignee_user_id uuid;

-- 2) Dedupe-Schlüssel für app_notifications: eine Wiedervorlage-Meldung je
--    (Kunde, Fingerprint, Fälligkeitsdatum) — Reloads erzeugen keine Duplikate.
--    Unique-Index auf nullable Spalte: NULLs kollidieren in Postgres nicht,
--    bestehende Wächter-Notifications (dedupe_key NULL) bleiben unberührt.
alter table public.app_notifications
  add column if not exists dedupe_key text;
create unique index if not exists app_notifications_dedupe_key
  on public.app_notifications (dedupe_key);

-- 3) Team-Liste für die Verantwortlichen-Auswahl. profiles ist per RLS nur für
--    den eigenen User lesbar und E-Mails leben in auth.users — deshalb ein
--    SECURITY-DEFINER-Read, selbst gegated auf can_access_client (Viewer dürfen
--    die Liste SEHEN, schreiben können sie wegen der Tabellen-RLS ohnehin nicht).
create or replace function public.ezyai_team_members(_client_id uuid)
returns table(user_id uuid, name text, email text, org_role text)
language sql stable security definer set search_path to 'public'
as $$
  select au.user_id,
         coalesce(nullif(p.full_name, ''), split_part(u.email::text, '@', 1)) as name,
         u.email::text as email,
         au.role::text as org_role
  from public.clients c
  join public.app_users au on au.organization_id = c.organization_id
  left join public.profiles p on p.id = au.user_id
  left join auth.users u on u.id = au.user_id
  where c.id = _client_id
    and public.can_access_client(_client_id)
  order by 2;
$$;

-- 4) Einmalige In-App-Benachrichtigung bei fälliger Wiedervorlage. INSERT auf
--    app_notifications ist bewusst Service-Role-only — dieser schmale Definer-
--    Pfad erlaubt NUR den Wiedervorlage-Fall, nur für Schreibberechtigte
--    (can_edit_client, Viewer lösen nichts aus) und dedupliziert hart über den
--    Unique-Index. Rückgabe true = neu angelegt, false = schon vorhanden/kein Recht.
create or replace function public.ezyai_notify_resurface(
  _client_id uuid, _fingerprint text, _title text, _due date
) returns boolean
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_org uuid;
begin
  if _fingerprint is null or _due is null or not public.can_edit_client(_client_id) then
    return false;
  end if;
  select organization_id into v_org from public.clients where id = _client_id;
  if v_org is null then
    return false;
  end if;
  insert into public.app_notifications
    (organization_id, client_id, kind, severity, title, body, link_section, dedupe_key)
  values
    (v_org, _client_id, 'resurface_due', 'info',
     left(coalesce(_title, 'Wiedervorlage fällig'), 200),
     'Wiedervorlage fällig — Chance im Bereich «Chancen» prüfen.',
     'opportunities',
     'resurface:' || _client_id || ':' || left(_fingerprint, 80) || ':' || _due)
  on conflict (dedupe_key) do nothing;
  return found;
end $$;
