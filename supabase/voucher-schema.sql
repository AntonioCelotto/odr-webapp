create table public.odr_course_vouchers (
 id uuid primary key default gen_random_uuid(),
 code text not null unique default ('ODR-' || upper(encode(extensions.gen_random_bytes(16),'hex'))),
 owner_id uuid not null references public.profiles(id),
 source_order text not null, order_number text not null, product_id bigint not null check(product_id>0), slot integer not null check(slot>0),
 package_name text not null, course_titles text[] not null, material_ids uuid[] not null check(cardinality(material_ids)>0),
 customer_name text not null default '', customer_email text not null default '',
 recipient_name text, recipient_email text, recipient_phone text,
 assigned_at timestamptz, assigned_by uuid references public.profiles(id),
 activated_at timestamptz, activated_by uuid, activated_email text,
 active boolean not null default true,
 email_status text not null default 'not_required' check(email_status in ('not_required','pending','sent','failed','not_configured')),
 email_sent_at timestamptz, created_at timestamptz not null default now(),
 unique(source_order,product_id,slot),
 check((assigned_at is null and recipient_name is null and recipient_email is null and recipient_phone is null) or (assigned_at is not null and length(trim(recipient_name))>0 and (recipient_email is not null or recipient_phone is not null))),
 check((activated_by is null and activated_at is null) or (activated_by is not null and activated_at is not null and assigned_at is not null))
);
create index odr_voucher_owner on public.odr_course_vouchers(owner_id);
create index odr_voucher_activated on public.odr_course_vouchers(activated_by) where activated_by is not null;
alter table public.odr_course_vouchers enable row level security;
revoke all on public.odr_course_vouchers from anon,authenticated;
grant all on public.odr_course_vouchers to service_role;
create table public.odr_voucher_rate_limits(user_id uuid primary key, window_start timestamptz not null default now(), attempts integer not null default 0);
alter table public.odr_voucher_rate_limits enable row level security;
revoke all on public.odr_voucher_rate_limits from anon,authenticated;
grant all on public.odr_voucher_rate_limits to service_role;
create function public.odr_voucher_attempt(target_user uuid) returns boolean language plpgsql security invoker set search_path=public as $$
declare n integer;
begin
 insert into odr_voucher_rate_limits(user_id,attempts) values(target_user,1)
 on conflict(user_id) do update set attempts=case when odr_voucher_rate_limits.window_start<now()-interval '15 minutes' then 1 else odr_voucher_rate_limits.attempts+1 end,
 window_start=case when odr_voucher_rate_limits.window_start<now()-interval '15 minutes' then now() else odr_voucher_rate_limits.window_start end returning attempts into n;
 return n<=30;
end $$;
create function public.odr_redeem_voucher(voucher_id uuid,target_user uuid,target_email text) returns boolean language plpgsql security invoker set search_path=public as $$
declare changed uuid;
begin
 update odr_course_vouchers set activated_by=target_user,activated_email=target_email,activated_at=now()
 where id=voucher_id and active and assigned_at is not null and activated_by is null returning id into changed;
 if changed is null then return false; end if;
 insert into odr_course_audit(action,details) values('voucher-activated',jsonb_build_object('voucherId',changed,'academyUserId',target_user));
 return true;
end $$;
revoke all on function public.odr_voucher_attempt(uuid),public.odr_redeem_voucher(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.odr_voucher_attempt(uuid),public.odr_redeem_voucher(uuid,uuid,text) to service_role;
