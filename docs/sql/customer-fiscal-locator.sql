alter table public.agent_app_customers
 add column if not exists sole_trader boolean not null default false,
 add column if not exists store_requested boolean not null default false,
 add column if not exists store_category text not null default 'beauty';

create or replace function odr_private.customer_store_request() returns trigger
language plpgsql security invoker set search_path=public,pg_temp as $$
begin
 if TG_OP='UPDATE' and old.store_requested then
  new.store_requested:=true;
  new.store_category:=old.store_category;
  return new;
 end if;
 if not new.store_requested then return new; end if;
 if auth.uid() is null or auth.uid()<>new.agent_profile_id then
  raise exception 'Cliente non autorizzato';
 end if;
 perform public.save_store_locations(jsonb_build_array(jsonb_build_object(
  'row',jsonb_build_object('name',new.name,'address',new.address_1,'postcode',new.postcode,
   'city',new.city,'province',new.state,'country',new.country,'email',new.email,'phone',new.phone,
   'categories',jsonb_build_array(new.store_category),'active',true,'approved',false),
  'internal',jsonb_build_object('reference','Cliente app '||new.id::text))));
 return new;
end $$;
revoke all on function odr_private.customer_store_request() from public,anon,authenticated;
drop trigger if exists customer_store_request on public.agent_app_customers;
create trigger customer_store_request before insert or update on public.agent_app_customers
for each row execute function odr_private.customer_store_request();
