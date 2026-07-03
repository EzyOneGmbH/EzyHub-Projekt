alter table public.content_items alter column created_by drop not null;

create unique index if not exists uq_ci_client_url
  on public.content_items (client_id, target_url) where target_url is not null;

alter table public.content_items add column if not exists source text default 'manual';