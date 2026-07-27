create index profiles_network_entity_id_idx
  on public.profiles(network_entity_id);

create index validation_codes_created_by_idx
  on public.validation_codes(created_by);

create index code_validations_validation_code_id_idx
  on public.code_validations(validation_code_id);

create index woocommerce_orders_validation_code_id_idx
  on public.woocommerce_orders(validation_code_id);

create index woocommerce_orders_agent_id_idx
  on public.woocommerce_orders(agent_id);

create index woocommerce_orders_center_id_idx
  on public.woocommerce_orders(center_id);

create index patient_profiles_last_validated_code_id_idx
  on public.patient_profiles(last_validated_code_id);

create index registration_events_profile_id_idx
  on public.registration_events(profile_id);

drop policy "Profiles can read own profile" on public.profiles;
drop policy "Administrators can read all profiles" on public.profiles;

create policy "Authorized users can read profiles"
on public.profiles
for select
to authenticated
using (
  id = (select auth.uid())
  or ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
);

drop policy "Authorized users can read active validation codes"
  on public.validation_codes;

create policy "Authorized users can read active validation codes"
on public.validation_codes
for select
to authenticated
using (
  active is true
  and (
    ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
    or exists (
      select 1
      from public.profiles
      where profiles.id = (select auth.uid())
        and profiles.role in ('distributor', 'agent', 'center')
    )
  )
);

drop policy "Authorized users can read network entities"
  on public.network_entities;

create policy "Authorized users can read network entities"
on public.network_entities
for select
to authenticated
using (
  ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  or id = (
    select profiles.network_entity_id
    from public.profiles
    where profiles.id = (select auth.uid())
  )
);

drop policy "Authorized users can read WooCommerce order snapshots"
  on public.woocommerce_orders;

create policy "Authorized users can read WooCommerce order snapshots"
on public.woocommerce_orders
for select
to authenticated
using (
  ((select auth.jwt()) -> 'app_metadata' ->> 'role') = 'admin'
  or patient_id = (select auth.uid())
  or exists (
    select 1
    from public.profiles
    where profiles.id = (select auth.uid())
      and profiles.network_entity_id is not null
      and profiles.network_entity_id in (distributor_id, agent_id, center_id)
  )
);
