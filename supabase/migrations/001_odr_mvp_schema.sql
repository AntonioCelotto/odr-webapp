create extension if not exists "pgcrypto";

create type public.odr_role as enum (
  'admin',
  'distributor',
  'agent',
  'center',
  'patient'
);

create type public.odr_network_type as enum (
  'distributor',
  'agent',
  'center'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.odr_role not null default 'patient',
  full_name text,
  email text,
  phone text,
  network_entity_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.network_entities (
  id uuid primary key default gen_random_uuid(),
  type public.odr_network_type not null,
  name text not null,
  email text,
  phone text,
  area text,
  parent_id uuid references public.network_entities(id) on delete set null,
  external_code text,
  active boolean not null default true,
  import_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add constraint profiles_network_entity_id_fkey
  foreign key (network_entity_id)
  references public.network_entities(id)
  on delete set null;

create table public.validation_codes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  label text not null,
  hospital text,
  discount_label text,
  woo_coupon text,
  starts_at timestamptz,
  ends_at timestamptz,
  active boolean not null default true,
  max_uses integer,
  current_uses integer not null default 0,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.code_validations (
  id uuid primary key default gen_random_uuid(),
  validation_code_id uuid references public.validation_codes(id) on delete set null,
  patient_id uuid references public.profiles(id) on delete set null,
  code text not null,
  valid boolean not null,
  failure_reason text,
  woo_redirect_url text,
  created_at timestamptz not null default now()
);

create table public.woocommerce_orders (
  id uuid primary key default gen_random_uuid(),
  woo_order_id text not null unique,
  woo_customer_id text,
  customer_email text,
  customer_name text,
  order_status text,
  payment_status text,
  currency text not null default 'EUR',
  total_amount numeric(12, 2) not null default 0,
  coupon_code text,
  validation_code_id uuid references public.validation_codes(id) on delete set null,
  distributor_id uuid references public.network_entities(id) on delete set null,
  agent_id uuid references public.network_entities(id) on delete set null,
  center_id uuid references public.network_entities(id) on delete set null,
  ordered_at timestamptz,
  raw_payload jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.wordpress_settings (
  id uuid primary key default gen_random_uuid(),
  base_url text not null,
  shop_path text not null default '/shop',
  coupon_param text not null default 'coupon',
  code_param text not null default 'odr_code',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index network_entities_type_idx on public.network_entities(type);
create index network_entities_parent_id_idx on public.network_entities(parent_id);
create index validation_codes_active_idx on public.validation_codes(active);
create index code_validations_patient_id_idx on public.code_validations(patient_id);
create index code_validations_created_at_idx on public.code_validations(created_at);
create index woocommerce_orders_coupon_code_idx on public.woocommerce_orders(coupon_code);
create index woocommerce_orders_ordered_at_idx on public.woocommerce_orders(ordered_at);
create index woocommerce_orders_network_idx on public.woocommerce_orders(distributor_id, agent_id, center_id);

alter table public.profiles enable row level security;
alter table public.network_entities enable row level security;
alter table public.validation_codes enable row level security;
alter table public.code_validations enable row level security;
alter table public.woocommerce_orders enable row level security;
alter table public.wordpress_settings enable row level security;

create policy "Profiles can read own profile"
on public.profiles
for select
to authenticated
using ((select auth.uid()) = id);

create policy "Profiles can update own profile"
on public.profiles
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

create policy "Authenticated can read active validation codes"
on public.validation_codes
for select
to authenticated
using (active is true);

create policy "Authenticated can insert validation logs"
on public.code_validations
for insert
to authenticated
with check ((select auth.uid()) = patient_id);

create policy "Authenticated can read own validation logs"
on public.code_validations
for select
to authenticated
using ((select auth.uid()) = patient_id);

-- MVP read policies. Tighten these when admin role enforcement is implemented.
create policy "Authenticated can read network entities"
on public.network_entities
for select
to authenticated
using (active is true);

create policy "Authenticated can read WooCommerce order snapshots"
on public.woocommerce_orders
for select
to authenticated
using (true);

create policy "Authenticated can read active WordPress settings"
on public.wordpress_settings
for select
to authenticated
using (active is true);
