create type public.odr_admin_level as enum (
  'owner',
  'admin'
);

create table public.admin_members (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  level public.odr_admin_level not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.admin_members enable row level security;

create policy "Administrators can read own membership"
on public.admin_members
for select
to authenticated
using ((select auth.uid()) = profile_id);

revoke all on public.admin_members from anon, authenticated;
grant select on public.admin_members to authenticated;

insert into public.admin_members (profile_id, level)
select id, 'owner'
from public.profiles
where lower(email) = lower('a.celotto@newdigitalapp.com')
on conflict (profile_id) do update
set level = 'owner', updated_at = now();
