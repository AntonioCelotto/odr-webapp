alter table public.network_entities
  add column if not exists commission_rate numeric(5,4);

alter table public.network_entities
  drop constraint if exists network_entities_commission_rate_check;

alter table public.network_entities
  add constraint network_entities_commission_rate_check
  check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 1));

comment on column public.network_entities.commission_rate is
  'Agent commission rate stored as a decimal fraction, for example 0.2000 = 20%.';
