-- Keep the stored patient role for compatibility; the app displays Cliente.
-- Existing accounts are retained. Require ENTE only for new Cliente registrations.
create or replace function private.handle_new_user()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  requested public.odr_role;
  requested_parent uuid;
  supplied_code text;
  matched_code public.validation_codes%rowtype;
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
  if requested = 'patient' then
    select * into matched_code from public.validation_codes
    where code = supplied_code
    for update;
    if not found or not matched_code.active
      or (matched_code.starts_at is not null and matched_code.starts_at > now())
      or (matched_code.ends_at is not null and matched_code.ends_at < now())
      or (matched_code.audience_role is not null and matched_code.audience_role <> 'patient')
      or (matched_code.max_uses is not null and matched_code.current_uses >= matched_code.max_uses)
    then
      raise exception 'Codice ENTE non valido o non attivo per il profilo Cliente.' using errcode = '23514';
    end if;
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
  if requested = 'patient' then
    insert into public.code_validations(validation_code_id, patient_id, code, valid)
    values(matched_code.id, new.id, supplied_code, true);
    update public.validation_codes
    set current_uses = current_uses + 1, updated_at = now()
    where id = matched_code.id;
  end if;
  return new;
end;
$$;
revoke all on function private.handle_new_user() from public, anon, authenticated;

