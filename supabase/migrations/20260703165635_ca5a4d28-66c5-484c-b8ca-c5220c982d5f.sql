drop index if exists public.uq_ci_client_url;

create unique index uq_ci_client_url on public.content_items (client_id, target_url);