alter table public.odr_course_vouchers add column email_attempt_id uuid, add column email_attempt_at timestamptz;
create table public.odr_voucher_mail_config(id boolean primary key default true check(id),secret_hash text not null);
alter table public.odr_voucher_mail_config enable row level security;
revoke all on public.odr_voucher_mail_config from anon,authenticated;
grant all on public.odr_voucher_mail_config to service_role;
-- The server secret hash is provisioned separately; no credentials belong in git.
