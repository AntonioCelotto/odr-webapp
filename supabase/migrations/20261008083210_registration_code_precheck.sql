-- Anonymous registration precheck: exposes only a boolean, never code records.
create or replace function public.check_registration_code(supplied_code text)
returns boolean language sql stable security definer set search_path = ''
as $$
 select exists (
  select 1 from public.validation_codes c
  where c.code = upper(trim(supplied_code))
    and length(supplied_code) between 1 and 64
    and c.active
    and (c.starts_at is null or c.starts_at <= now())
    and (c.ends_at is null or c.ends_at >= now())
    and (c.audience_role is null or c.audience_role = 'patient')
    and (c.max_uses is null or c.current_uses < c.max_uses)
 );
$$;
revoke all on function public.check_registration_code(text) from public;
grant execute on function public.check_registration_code(text) to anon, authenticated;
