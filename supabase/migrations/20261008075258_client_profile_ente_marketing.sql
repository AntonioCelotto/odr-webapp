-- Keep the stored patient role for compatibility; the app displays Cliente.
-- Existing accounts are retained. Require ENTE only for new Cliente registrations.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  requested public.odr_role;
  requested_parent uuid;
  supplied_code text;
begin
  requested := case new.raw_user_meta_data ->> 'requested_role'
    when 'distributor' then 'distributor'::public.odr_role
    when 'agent' then 'agent'::public.odr_role
    when 'center' then 'center'::public.odr_role
    else 'patient'::public.odr_role
  end;
  supplied_code := upper(trim(coalesce(new.raw_user_meta_data ->> 'validation_code', '')));
  if requested = 'patient' and supplied_code = '' then
    raise exception 'Il codice ENTE è obbligatorio per il profilo Cliente.' using errcode = '23514';
  end if;
  if requested = 'center' and supplied_code <> '' then
    select network_entities.id into requested_parent
    from public.network_entities
    where network_entities.type = 'center'
      and network_entities.is_primary_center is true
      and network_entities.active is true
      and upper(trim(coalesce(network_entities.external_code, ''))) = supplied_code
    limit 1;
  end if;
  insert into public.profiles (
    id, email, full_name, phone, role, requested_role,
    requested_parent_entity_id, approval_status
  ) values (
    new.id, new.email,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'phone'), ''),
    'patient', requested, requested_parent,
    case when requested = 'patient' then 'approved'::public.odr_approval_status
      else 'pending'::public.odr_approval_status end
  ) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

alter policy "Assigned users read marketing materials" on public.marketing_materials
using (exists (
  select 1 from public.profiles p
  where p.id = (select auth.uid()) and p.approval_status = 'approved'
    and p.role in ('admin', 'agent', 'distributor', 'center')
    and (p.role = 'admin' or p.role = any (audience_roles))
));

alter policy "Assigned users download marketing PDFs" on storage.objects
using (
  bucket_id = 'marketing-materials'
  and exists (
    select 1 from public.marketing_materials m
    join public.profiles p on p.id = (select auth.uid())
    where m.storage_path = name and p.approval_status = 'approved'
      and p.role in ('admin', 'agent', 'distributor', 'center')
      and (p.role = 'admin' or p.role = any (m.audience_roles))
  )
);
