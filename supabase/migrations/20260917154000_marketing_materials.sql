create table if not exists public.marketing_materials (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  description text,
  file_name text not null,
  storage_path text not null unique,
  file_size bigint not null default 0 check (file_size >= 0),
  audience_roles public.odr_role[] not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (cardinality(audience_roles) > 0),
  check (audience_roles <@ array['agent', 'distributor', 'center', 'patient']::public.odr_role[])
);

create index if not exists marketing_materials_created_at_idx on public.marketing_materials(created_at desc);
create index if not exists marketing_materials_created_by_idx on public.marketing_materials(created_by);
alter table public.marketing_materials enable row level security;
grant select, insert, update, delete on public.marketing_materials to authenticated;

create policy "Assigned users read marketing materials" on public.marketing_materials for select to authenticated
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.approval_status = 'approved'
    and (p.role = 'admin' or p.role = any (audience_roles))
));

create policy "Admins insert marketing materials" on public.marketing_materials for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin')
);

create policy "Admins update marketing materials" on public.marketing_materials for update to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'));

create policy "Admins delete marketing materials" on public.marketing_materials for delete to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marketing-materials', 'marketing-materials', false, 20971520, array['application/pdf'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "Assigned users download marketing PDFs" on storage.objects for select to authenticated
using (
  bucket_id = 'marketing-materials'
  and exists (
    select 1 from public.marketing_materials m
    join public.profiles p on p.id = (select auth.uid())
    where m.storage_path = name and p.approval_status = 'approved'
      and (p.role = 'admin' or p.role = any (m.audience_roles))
  )
);

create policy "Admins upload marketing PDFs" on storage.objects for insert to authenticated
with check (
  bucket_id = 'marketing-materials'
  and owner_id = (select auth.uid()::text)
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin')
);

create policy "Admins update marketing PDFs" on storage.objects for update to authenticated
using (
  bucket_id = 'marketing-materials'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin')
)
with check (
  bucket_id = 'marketing-materials'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin')
);

create policy "Admins delete marketing PDFs" on storage.objects for delete to authenticated
using (
  bucket_id = 'marketing-materials'
  and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin')
);
