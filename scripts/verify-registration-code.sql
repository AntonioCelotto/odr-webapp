-- Run after the registration-code migration. All fixtures are rolled back.
begin;
do $test$
declare
 fixture text := 'ODR-TEST-' || replace(gen_random_uuid()::text,'-','');
 uid uuid;
 rejected boolean;
 variant text;
 vcode text;
begin
 foreach variant in array array['missing','inactive','expired','future','wrong-role','exhausted','valid'] loop
  vcode := fixture || '-' || variant;
  if variant <> 'missing' then
    insert into public.validation_codes(code,label,active,starts_at,ends_at,audience_role,max_uses,current_uses)
    values(upper(vcode),'Rollback-only registration test',variant <> 'inactive',
      case when variant='future' then now()+interval '1 day' else null end,
      case when variant='expired' then now()-interval '1 day' else null end,
      case when variant='wrong-role' then 'agent'::public.odr_role else 'patient'::public.odr_role end,
      1,case when variant='exhausted' then 1 else 0 end);
  end if;
  uid := gen_random_uuid();
  rejected := false;
  begin
    insert into auth.users(id,email,raw_user_meta_data)
    values(uid,uid||'@example.invalid',jsonb_build_object('requested_role','patient','validation_code',' '||lower(vcode)||' '));
  exception when check_violation then rejected := true;
  end;
  if rejected <> (variant <> 'valid') then raise exception 'Wrong registration result: %', variant; end if;
  if rejected and exists(select 1 from auth.users where id=uid) then raise exception 'Rejected account persisted'; end if;
  if variant='valid' then
    if not exists(select 1 from public.profiles where id=uid and approval_status='approved') then raise exception 'Valid account not approved'; end if;
    if not exists(select 1 from public.code_validations where patient_id=uid and valid) then raise exception 'Code association missing'; end if;
    if (select current_uses from public.validation_codes where code=upper(vcode))<>1 then raise exception 'Usage not consumed'; end if;
    rejected:=false;
    begin
      insert into auth.users(id,email,raw_user_meta_data)
      values(gen_random_uuid(),'second-'||uid||'@example.invalid',jsonb_build_object('requested_role','patient','validation_code',vcode));
    exception when check_violation then rejected:=true; end;
    if not rejected then raise exception 'Single-use code reused'; end if;
  end if;
 end loop;
 uid:=gen_random_uuid();
 insert into auth.users(id,email,raw_user_meta_data)
 values(uid,uid||'@example.invalid','{"requested_role":"agent"}');
 if not exists(select 1 from public.profiles where id=uid and approval_status='pending') then raise exception 'Professional registration regressed'; end if;
end $test$;
rollback;
