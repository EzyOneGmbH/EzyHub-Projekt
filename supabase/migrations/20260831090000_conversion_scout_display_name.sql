-- Conversion-Scout (31.08.2026): Kandidaten sind benennbar. display_name ist
-- der vom Menschen vergebene Anzeigename (z. B. "Mitglied werden"); bei der
-- Freigabe wird daraus der GA4-Eventname (slugifiziert) abgeleitet, sodass die
-- Conversion in GA4 UND im Conversions-Tab unter diesem Namen erscheint.
-- WICHTIG: Lovable wendet Repo-Migrationen NICHT automatisch an — dieses File
-- wurde am 31.08.2026 via Lovable query_database auf der Prod-DB ausgefuehrt.

alter table public.conversion_candidates
  add column if not exists display_name text;
