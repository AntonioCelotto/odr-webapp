create type public.odr_approval_status as enum (
  'approved',
  'pending',
  'rejected'
);

alter table public.profiles
  add column requested_role public.odr_role not null default 'patient',
  add column approval_status public.odr_approval_status not null default 'approved';

create index profiles_approval_status_idx
  on public.profiles(approval_status);

create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested public.odr_role;
begin
  requested := case new.raw_user_meta_data ->> 'requested_role'
    when 'distributor' then 'distributor'::public.odr_role
    when 'agent' then 'agent'::public.odr_role
    when 'center' then 'center'::public.odr_role
    else 'patient'::public.odr_role
  end;

  insert into public.profiles (
    id,
    email,
    full_name,
    phone,
    role,
    requested_role,
    approval_status
  )
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    'patient',
    requested,
    case
      when requested = 'patient' then 'approved'::public.odr_approval_status
      else 'pending'::public.odr_approval_status
    end
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;
