create schema if not exists odr_private;
revoke all on schema odr_private from public;
grant usage on schema odr_private to authenticated;
alter table public.store_location_internal add column if not exists owner_profile_id uuid references public.profiles(id);
create or replace function odr_private.can_manage_store(target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from public.profiles p where p.id=auth.uid() and p.approval_status='approved' and (p.role='admin' or (p.role in ('agent','distributor') and exists(select 1 from public.store_location_internal i where i.store_id=target and ((i.owner_entity_id is not null and i.owner_entity_id=p.network_entity_id) or (i.owner_entity_id is null and i.owner_profile_id=p.id))))));
$$;
revoke all on function odr_private.can_manage_store(uuid) from public,anon;
grant execute on function odr_private.can_manage_store(uuid) to authenticated;
create policy "Network reads own stores" on public.store_locations for select to authenticated using(odr_private.can_manage_store(id));
create or replace function odr_private.save_store_locations(entries jsonb) returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare entry jsonb; data public.store_locations; target uuid; saved integer:=0; actor public.profiles; is_admin boolean; owner uuid;
begin
 select * into actor from public.profiles where id=auth.uid();
 if actor.id is null or coalesce(actor.approval_status::text,'')<>'approved' or coalesce(actor.role::text,'') not in ('admin','agent','distributor') then raise exception 'Account non abilitato'; end if;
 is_admin:=actor.role='admin';
 if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>500 then raise exception 'Massimo 500 righe per importazione'; end if;
 for entry in select value from jsonb_array_elements(entries) loop
  data:=jsonb_populate_record(null::public.store_locations,entry->'row');
  if data.id is not null then
   perform 1 from public.store_locations where id=data.id for update;
   perform 1 from public.store_location_internal where store_id=data.id for update;
  end if;
  if not is_admin then
   if data.id is not null and not odr_private.can_manage_store(data.id) then raise exception 'Scheda non autorizzata'; end if;
   data.approved:=false;
  end if;
  if data.id is null then
   insert into public.store_locations(name,address,city,country,postcode,province,region,categories,email,phone,mobile,website,facebook,instagram,tiktok,youtube,whatsapp,latitude,longitude,active,approved)
   values(data.name,data.address,data.city,data.country,coalesce(data.postcode,''),coalesce(data.province,''),coalesce(data.region,''),data.categories,coalesce(data.email,''),coalesce(data.phone,''),coalesce(data.mobile,''),coalesce(data.website,''),coalesce(data.facebook,''),coalesce(data.instagram,''),coalesce(data.tiktok,''),coalesce(data.youtube,''),coalesce(data.whatsapp,''),data.latitude,data.longitude,coalesce(data.active,false),coalesce(data.approved,false)) returning id into target;
  else
   target:=data.id;
   update public.store_locations set name=data.name,address=data.address,city=data.city,country=data.country,postcode=data.postcode,province=data.province,region=data.region,categories=data.categories,email=data.email,phone=data.phone,mobile=data.mobile,website=data.website,facebook=data.facebook,instagram=data.instagram,tiktok=data.tiktok,youtube=data.youtube,whatsapp=data.whatsapp,latitude=data.latitude,longitude=data.longitude,active=data.active,approved=data.approved where id=target;
   if not found then raise exception 'Scheda non trovata'; end if;
  end if;
  if is_admin then
   owner:=nullif(entry->'internal'->>'owner_entity_id','')::uuid;
   if owner is not null and not exists(select 1 from public.network_entities where id=owner and type in ('agent','distributor')) then raise exception 'Assegnazione non valida'; end if;
   insert into public.store_location_internal(store_id,reference,contact,notes,owner_entity_id) values(target,coalesce(entry->'internal'->>'reference',''),coalesce(entry->'internal'->>'contact',''),coalesce(entry->'internal'->>'notes',''),nullif(entry->'internal'->>'owner_entity_id','')::uuid)
  on conflict(store_id) do update set reference=excluded.reference,contact=excluded.contact,notes=excluded.notes,owner_entity_id=excluded.owner_entity_id;
   if owner is not null then update public.store_location_internal set owner_profile_id=null where store_id=target; end if;
  else
   insert into public.store_location_internal(store_id,owner_entity_id,owner_profile_id,reference,contact,notes) values(target,actor.network_entity_id,case when actor.network_entity_id is null then actor.id else null end,coalesce(entry->'internal'->>'reference',''),coalesce(entry->'internal'->>'contact',''),coalesce(entry->'internal'->>'notes','')) on conflict(store_id) do nothing;
  end if;
  saved:=saved+1;
 end loop;
 return saved;
end $$;
revoke all on function odr_private.save_store_locations(jsonb) from public,anon;
grant execute on function odr_private.save_store_locations(jsonb) to authenticated;
create or replace function public.save_store_locations(entries jsonb) returns integer language sql security invoker set search_path=public,pg_temp as $$ select odr_private.save_store_locations(entries); $$;
revoke all on function public.save_store_locations(jsonb) from public,anon;
grant execute on function public.save_store_locations(jsonb) to authenticated;
create or replace function public.my_store_locations() returns setof public.store_locations language sql stable security invoker set search_path=public,pg_temp as $$ select * from public.store_locations where odr_private.can_manage_store(id) order by name,id; $$;
revoke all on function public.my_store_locations() from public,anon;
grant execute on function public.my_store_locations() to authenticated;
