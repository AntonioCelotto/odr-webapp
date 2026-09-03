alter table public.agent_app_customers
  add column if not exists tax_code text,
  add column if not exists vat_number text,
  add column if not exists pec text,
  add column if not exists sdi_code text,
  add column if not exists shipping_name text,
  add column if not exists shipping_company text,
  add column if not exists shipping_address_1 text,
  add column if not exists shipping_address_2 text,
  add column if not exists shipping_postcode text,
  add column if not exists shipping_city text,
  add column if not exists shipping_state text,
  add column if not exists shipping_country text default 'IT',
  add column if not exists payment_terms integer[] not null default array[30],
  add column if not exists notes text;

grant update on table public.agent_app_customers to authenticated;

create policy "Agents update their own app customers"
on public.agent_app_customers for update to authenticated
using ((select auth.uid()) = agent_profile_id)
with check ((select auth.uid()) = agent_profile_id);

create policy "Admins read app customers"
on public.agent_app_customers for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin'));

create table if not exists public.order_payment_entries (
  id uuid primary key default gen_random_uuid(),
  woo_order_id bigint not null,
  agent_profile_id uuid not null references public.profiles(id) on delete cascade,
  installment_number integer not null check (installment_number > 0),
  due_date date not null,
  amount numeric(12,2) not null check (amount >= 0),
  paid boolean not null default false,
  paid_at date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (woo_order_id, installment_number)
);

create index if not exists order_payment_entries_agent_order_idx
  on public.order_payment_entries(agent_profile_id, woo_order_id);

alter table public.order_payment_entries enable row level security;
revoke all on table public.order_payment_entries from anon, authenticated;
grant select, insert, update on table public.order_payment_entries to authenticated;

create policy "Agents read their order payments"
on public.order_payment_entries for select to authenticated
using (
  (select auth.uid()) = agent_profile_id
  or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.role = 'admin')
);

create policy "Agents create their order payments"
on public.order_payment_entries for insert to authenticated
with check ((select auth.uid()) = agent_profile_id);

create policy "Agents update their order payments"
on public.order_payment_entries for update to authenticated
using ((select auth.uid()) = agent_profile_id)
with check ((select auth.uid()) = agent_profile_id);
