alter table public.validation_codes
  add column if not exists audience_role public.odr_role;

create index if not exists validation_codes_code_active_idx
  on public.validation_codes (code, active);

create index if not exists code_validations_patient_valid_created_idx
  on public.code_validations (patient_id, valid, created_at desc);
