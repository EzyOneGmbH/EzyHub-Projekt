alter table public.clients add column if not exists brand_terms text[] not null default '{}';

alter table public.clients add column if not exists revenue_mode text not null default 'revenue';