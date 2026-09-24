create table if not exists public.store_locations (
 id uuid primary key default gen_random_uuid(),
 name text not null check(length(trim(name)) between 1 and 250),
 address text not null check(length(trim(address))>0), city text not null check(length(trim(city))>0), country text not null check(length(trim(country))>0),
 postcode text not null default '', province text not null default '', region text not null default '',
 categories text[] not null check(cardinality(categories)>0 and categories <@ array['beauty','problem_skin','oncology','hair','distributor']::text[]),
 email text not null default '',phone text not null default '',mobile text not null default '', website text not null default '', facebook text not null default '',instagram text not null default '', tiktok text not null default '',youtube text not null default '',whatsapp text not null default '',
 latitude double precision, longitude double precision,
 active boolean not null default false, approved boolean not null default false,
 check((latitude is null and longitude is null) or (latitude between -90 and 90 and longitude between -180 and 180 and latitude is not null and longitude is not null))
);
create unique index if not exists store_locations_identity on public.store_locations (lower(trim(name)),lower(trim(address)),lower(trim(city)),lower(trim(country)));
alter table public.store_locations enable row level security;
revoke all on public.store_locations from anon,authenticated;
grant select on public.store_locations to anon,authenticated;
grant insert,update on public.store_locations to authenticated;
create policy "Public active approved stores" on public.store_locations for select to anon,authenticated using(active and approved);
create policy "Admin reads stores" on public.store_locations for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and approval_status='approved'));
create policy "Admin inserts stores" on public.store_locations for insert to authenticated with check(exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and approval_status='approved'));
create policy "Admin updates stores" on public.store_locations for update to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and approval_status='approved')) with check(exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and approval_status='approved'));
create table if not exists public.store_location_internal (
 store_id uuid primary key references public.store_locations(id) on delete cascade,
 reference text not null default '',contact text not null default '',notes text not null default '',owner_entity_id uuid references public.network_entities(id)
);
alter table public.store_location_internal enable row level security;
revoke all on public.store_location_internal from anon,authenticated;
grant select,insert,update on public.store_location_internal to authenticated;
create policy "Admin reads store internal" on public.store_location_internal for select to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and approval_status='approved'));
create policy "Admin inserts store internal" on public.store_location_internal for insert to authenticated with check(exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and approval_status='approved'));
create policy "Admin updates store internal" on public.store_location_internal for update to authenticated using(exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and approval_status='approved')) with check(exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and approval_status='approved'));
create or replace function public.save_store_locations(entries jsonb) returns integer language plpgsql security invoker set search_path=public as $$
declare entry jsonb; data public.store_locations; target uuid; saved integer:=0;
begin
 if not exists(select 1 from public.profiles where id=(select auth.uid()) and role='admin' and approval_status='approved') then raise exception 'Amministratore richiesto'; end if;
 if jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>500 then raise exception 'Massimo 500 righe per importazione'; end if;
 for entry in select value from jsonb_array_elements(entries) loop
  data:=jsonb_populate_record(null::public.store_locations,entry->'row');
  if data.id is null then
   insert into public.store_locations(name,address,city,country,postcode,province,region,categories,email,phone,mobile,website,facebook,instagram,tiktok,youtube,whatsapp,latitude,longitude,active,approved)
   values(data.name,data.address,data.city,data.country,coalesce(data.postcode,''),coalesce(data.province,''),coalesce(data.region,''),data.categories,coalesce(data.email,''),coalesce(data.phone,''),coalesce(data.mobile,''),coalesce(data.website,''),coalesce(data.facebook,''),coalesce(data.instagram,''),coalesce(data.tiktok,''),coalesce(data.youtube,''),coalesce(data.whatsapp,''),data.latitude,data.longitude,coalesce(data.active,false),coalesce(data.approved,false)) returning id into target;
  else
   target:=data.id;
   update public.store_locations set name=data.name,address=data.address,city=data.city,country=data.country,postcode=data.postcode,province=data.province,region=data.region,categories=data.categories,email=data.email,phone=data.phone,mobile=data.mobile,website=data.website,facebook=data.facebook,instagram=data.instagram,tiktok=data.tiktok,youtube=data.youtube,whatsapp=data.whatsapp,latitude=data.latitude,longitude=data.longitude,active=data.active,approved=data.approved where id=target;
   if not found then raise exception 'Scheda non trovata'; end if;
  end if;
  insert into public.store_location_internal(store_id,reference,contact,notes,owner_entity_id) values(target,coalesce(entry->'internal'->>'reference',''),coalesce(entry->'internal'->>'contact',''),coalesce(entry->'internal'->>'notes',''),nullif(entry->'internal'->>'owner_entity_id','')::uuid)
  on conflict(store_id) do update set reference=excluded.reference,contact=excluded.contact,notes=excluded.notes,owner_entity_id=excluded.owner_entity_id;
  saved:=saved+1;
 end loop;
 return saved;
end $$;
revoke all on function public.save_store_locations(jsonb) from public,anon;
grant execute on function public.save_store_locations(jsonb) to authenticated;
