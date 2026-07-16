create table public.hospitals (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code_prefix text,
  contact_email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.patient_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  first_name text,
  last_name text,
  birth_date date,
  fiscal_code text,
  hospital_id uuid references public.hospitals(id) on delete set null,
  last_validated_code_id uuid references public.validation_codes(id) on delete set null,
  privacy_accepted_at timestamptz,
  marketing_accepted_at timestamptz,
  wordpress_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(profile_id)
);

create table public.registration_events (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  email text,
  role public.odr_role not null default 'patient',
  validation_code text,
  status text not null default 'started',
  failure_reason text,
  user_agent text,
  created_at timestamptz not null default now()
);

create table public.user_consents (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  consent_type text not null,
  accepted boolean not null,
  accepted_at timestamptz,
  source text not null default 'odr_webapp',
  created_at timestamptz not null default now()
);

create index hospitals_active_idx on public.hospitals(active);
create index patient_profiles_profile_id_idx on public.patient_profiles(profile_id);
create index patient_profiles_hospital_id_idx on public.patient_profiles(hospital_id);
create index registration_events_email_idx on public.registration_events(email);
create index registration_events_created_at_idx on public.registration_events(created_at);
create index user_consents_profile_id_idx on public.user_consents(profile_id);

alter table public.hospitals enable row level security;
alter table public.patient_profiles enable row level security;
alter table public.registration_events enable row level security;
alter table public.user_consents enable row level security;

create policy "Authenticated can read active hospitals"
on public.hospitals
for select
to authenticated
using (active is true);

create policy "Patients can read own patient profile"
on public.patient_profiles
for select
to authenticated
using ((select auth.uid()) = profile_id);

create policy "Patients can update own patient profile"
on public.patient_profiles
for update
to authenticated
using ((select auth.uid()) = profile_id)
with check ((select auth.uid()) = profile_id);

create policy "Patients can insert own patient profile"
on public.patient_profiles
for insert
to authenticated
with check ((select auth.uid()) = profile_id);

create policy "Authenticated can insert own registration events"
on public.registration_events
for insert
to authenticated
with check (profile_id is null or (select auth.uid()) = profile_id);

create policy "Users can read own consents"
on public.user_consents
for select
to authenticated
using ((select auth.uid()) = profile_id);

create policy "Users can insert own consents"
on public.user_consents
for insert
to authenticated
with check ((select auth.uid()) = profile_id);
