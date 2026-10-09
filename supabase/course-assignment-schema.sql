create table public.odr_courses (
 id uuid primary key default gen_random_uuid(), title text not null check(length(trim(title)) between 1 and 180),
 material_ids uuid[] not null check(cardinality(material_ids)>0), active boolean not null default true, created_at timestamptz not null default now()
);
create table public.odr_course_products (
 product_id bigint not null check(product_id>0), course_id uuid not null references public.odr_courses(id),
 accesses_per_unit integer not null default 1 check(accesses_per_unit between 1 and 100),
 primary key(product_id,course_id)
);
create table public.odr_course_accesses (
 id uuid primary key default gen_random_uuid(), course_id uuid not null references public.odr_courses(id),
 owner_id uuid not null references public.profiles(id), source_order text not null, product_id bigint not null default 0,
 slot integer not null check(slot>0), active boolean not null default true,
 recipient_email text check(recipient_email is null or recipient_email=lower(trim(recipient_email))),
 recipient_name text, assigned_by uuid references public.profiles(id), assigned_at timestamptz,
 created_at timestamptz not null default now(), unique(source_order,product_id,course_id,slot)
);
create unique index odr_course_recipient_unique on public.odr_course_accesses(course_id,recipient_email) where active and recipient_email is not null;
create index odr_course_access_owner on public.odr_course_accesses(owner_id);
create index odr_course_access_recipient on public.odr_course_accesses(recipient_email) where active;
create table public.odr_course_audit (
 id bigint generated always as identity primary key, actor_id uuid references public.profiles(id),
 action text not null, access_id uuid references public.odr_course_accesses(id), details jsonb not null default '{}', created_at timestamptz not null default now()
);
alter table public.odr_courses enable row level security;
alter table public.odr_course_products enable row level security;
alter table public.odr_course_accesses enable row level security;
alter table public.odr_course_audit enable row level security;
revoke all on public.odr_courses,public.odr_course_products,public.odr_course_accesses,public.odr_course_audit from anon,authenticated;
grant all on public.odr_courses,public.odr_course_products,public.odr_course_accesses,public.odr_course_audit to service_role;
grant usage,select on sequence public.odr_course_audit_id_seq to service_role;
