create table if not exists public.agent_app_customers (
  id uuid primary key default gen_random_uuid(),
  agent_profile_id uuid not null references public.profiles(id) on delete cascade,
  name text not null,
  company text,
  email text not null,
  phone text,
  address_1 text,
  address_2 text,
  postcode text,
  city text,
  state text,
  country text not null default 'IT',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists agent_app_customers_agent_idx
  on public.agent_app_customers(agent_profile_id, active);

create unique index if not exists agent_app_customers_agent_email_idx
  on public.agent_app_customers(agent_profile_id, lower(email));

alter table public.agent_app_customers enable row level security;

revoke all on table public.agent_app_customers from anon, authenticated;
