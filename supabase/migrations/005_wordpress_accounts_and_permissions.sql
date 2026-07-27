create table public.wordpress_accounts (
  id uuid primary key default gen_random_uuid(),
  wordpress_user_id bigint not null unique,
  email text not null,
  full_name text,
  wordpress_roles text[] not null default '{}',
  mapped_role public.odr_role not null,
  connected_profile_id uuid unique references public.profiles(id) on delete set null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index wordpress_accounts_email_lower_idx
  on public.wordpress_accounts(lower(email));

create index wordpress_accounts_mapped_role_idx
  on public.wordpress_accounts(mapped_role);

alter table public.wordpress_accounts enable row level security;

create policy "Administrators can read WordPress accounts"
on public.wordpress_accounts
for select
to authenticated
using (((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin');

revoke all on public.wordpress_accounts from anon, authenticated;
grant select on public.wordpress_accounts to authenticated;

create table public.role_permissions (
  role public.odr_role not null,
  module text not null,
  can_view boolean not null default false,
  can_create boolean not null default false,
  can_edit boolean not null default false,
  can_delete boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (role, module)
);

alter table public.role_permissions enable row level security;

create policy "Authenticated users can read role permissions"
on public.role_permissions
for select
to authenticated
using (true);

revoke all on public.role_permissions from anon, authenticated;
grant select on public.role_permissions to authenticated;

insert into public.role_permissions (role, module, can_view, can_create, can_edit, can_delete)
values
  ('admin', 'dashboard', true, true, true, true),
  ('admin', 'codes', true, true, true, true),
  ('admin', 'promotions', true, true, true, true),
  ('admin', 'network', true, true, true, true),
  ('admin', 'wordpress', true, true, true, true),
  ('admin', 'reports', true, true, true, true),
  ('admin', 'users', true, true, true, true),
  ('admin', 'permissions', true, true, true, true),
  ('distributor', 'dashboard', true, false, false, false),
  ('distributor', 'codes', false, false, false, false),
  ('distributor', 'promotions', true, false, false, false),
  ('distributor', 'network', true, false, false, false),
  ('distributor', 'wordpress', true, false, false, false),
  ('distributor', 'reports', true, false, false, false),
  ('distributor', 'users', false, false, false, false),
  ('distributor', 'permissions', false, false, false, false),
  ('agent', 'dashboard', true, false, false, false),
  ('agent', 'codes', false, false, false, false),
  ('agent', 'promotions', true, false, false, false),
  ('agent', 'network', true, false, false, false),
  ('agent', 'wordpress', true, false, false, false),
  ('agent', 'reports', true, false, false, false),
  ('agent', 'users', false, false, false, false),
  ('agent', 'permissions', false, false, false, false),
  ('center', 'dashboard', true, false, false, false),
  ('center', 'codes', false, false, false, false),
  ('center', 'promotions', true, false, false, false),
  ('center', 'network', false, false, false, false),
  ('center', 'wordpress', true, false, false, false),
  ('center', 'reports', false, false, false, false),
  ('center', 'users', false, false, false, false),
  ('center', 'permissions', false, false, false, false),
  ('patient', 'dashboard', true, false, false, false),
  ('patient', 'codes', true, true, false, false),
  ('patient', 'promotions', true, false, false, false),
  ('patient', 'network', false, false, false, false),
  ('patient', 'wordpress', true, false, false, false),
  ('patient', 'reports', false, false, false, false),
  ('patient', 'users', false, false, false, false),
  ('patient', 'permissions', false, false, false, false);
