create table if not exists public.package_documents (
  id uuid primary key default gen_random_uuid(),
  product_id bigint not null,
  title text not null check (char_length(btrim(title)) between 1 and 160),
  file_name text not null,
  storage_path text not null unique,
  file_size bigint not null default 0 check (file_size >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists package_documents_product_id_idx on public.package_documents(product_id, created_at);
create index if not exists package_documents_created_by_idx on public.package_documents(created_by);
alter table public.package_documents enable row level security;
grant select, insert, update, delete on public.package_documents to authenticated;

drop policy if exists "Approved commercial users read package documents" on public.package_documents;
create policy "Approved commercial users read package documents" on public.package_documents for select to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role in ('admin', 'agent', 'distributor')));
drop policy if exists "Admins insert package documents" on public.package_documents;
create policy "Admins insert package documents" on public.package_documents for insert to authenticated
with check (created_by = (select auth.uid()) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'));
drop policy if exists "Admins update package documents" on public.package_documents;
create policy "Admins update package documents" on public.package_documents for update to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'))
with check (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'));
drop policy if exists "Admins delete package documents" on public.package_documents;
create policy "Admins delete package documents" on public.package_documents for delete to authenticated
using (exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('package-documents', 'package-documents', false, 20971520, array['application/pdf'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Commercial users download package PDFs" on storage.objects;
create policy "Commercial users download package PDFs" on storage.objects for select to authenticated
using (bucket_id = 'package-documents' and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role in ('admin', 'agent', 'distributor')));
drop policy if exists "Admins upload package PDFs" on storage.objects;
create policy "Admins upload package PDFs" on storage.objects for insert to authenticated
with check (bucket_id = 'package-documents' and owner_id = (select auth.uid()::text) and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'));
drop policy if exists "Admins update package PDFs" on storage.objects;
create policy "Admins update package PDFs" on storage.objects for update to authenticated
using (bucket_id = 'package-documents' and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'))
with check (bucket_id = 'package-documents' and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'));
drop policy if exists "Admins delete package PDFs" on storage.objects;
create policy "Admins delete package PDFs" on storage.objects for delete to authenticated
using (bucket_id = 'package-documents' and exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.approval_status = 'approved' and p.role = 'admin'));
