-- Index-Status je Blogartikel (04.08.2026)
--
-- Anlass: Bei Faith in Humanity waren ALLE 6 publizierten Artikel Google
-- schlicht unbekannt ("URL is unknown to Google") — seit ueber 5 Wochen, ohne
-- dass es jemandem auffiel. Grund: der `inspect`-Job in
-- /api/admin/content-sync lief nie automatisch (nicht im Default-Jobset,
-- GSC-Quota), und sein Ergebnis wurde nirgends gespeichert — es existierte
-- nur im HTTP-Response des manuellen Aufrufs.
--
-- Diese Migration gibt dem Index-Urteil einen dauerhaften Platz, damit der
-- Regellauf es fortschreiben und das Dashboard es anzeigen kann.
-- Rein additiv: keine Defaults auf bestehenden Zeilen, kein Backfill noetig.

alter table public.content_items
  add column if not exists index_verdict   text,        -- PASS = indexiert, NEUTRAL/FAIL = nicht
  add column if not exists index_coverage  text,        -- z.B. "URL is unknown to Google"
  add column if not exists index_checked_at timestamptz,-- wann zuletzt geprueft
  add column if not exists index_last_crawl timestamptz;-- Googles letzter Crawl (falls bekannt)

comment on column public.content_items.index_verdict is
  'GSC-URL-Inspection: PASS = von Google indexiert. NEUTRAL/FAIL = nicht indexiert.';
comment on column public.content_items.index_coverage is
  'GSC coverageState im Klartext, z.B. "URL is unknown to Google" (= nie entdeckt) vs. "Crawled - currently not indexed".';

-- Kandidatensuche fuer den Regellauf: laengst nicht geprueft zuerst.
-- nulls first => noch nie gepruefte Artikel haben Vorrang.
create index if not exists content_items_index_checked_idx
  on public.content_items (client_id, index_checked_at nulls first)
  where status = 'published';
