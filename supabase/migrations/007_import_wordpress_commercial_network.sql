insert into public.network_entities (
  type,
  name,
  email,
  external_code,
  active,
  import_source
)
select
  wordpress_accounts.mapped_role::text::public.odr_network_type,
  wordpress_accounts.full_name,
  lower(wordpress_accounts.email),
  'WP-' || wordpress_accounts.wordpress_user_id::text,
  true,
  'WordPress'
from public.wordpress_accounts
where wordpress_accounts.mapped_role::text in ('distributor', 'agent')
  and nullif(trim(wordpress_accounts.full_name), '') is not null
  and nullif(trim(wordpress_accounts.email), '') is not null
  and not exists (
    select 1
    from public.network_entities
    where network_entities.type::text = wordpress_accounts.mapped_role::text
      and lower(network_entities.email) = lower(wordpress_accounts.email)
  );

update public.profiles
set
  network_entity_id = network_entities.id,
  updated_at = now()
from public.network_entities
where profiles.network_entity_id is null
  and profiles.role::text = network_entities.type::text
  and lower(profiles.email) = lower(network_entities.email);
