alter table public.profiles
  add column wordpress_user_id bigint unique
    references public.wordpress_accounts(wordpress_user_id)
    on delete set null;
