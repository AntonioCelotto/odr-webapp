grant delete on table public.agent_app_customers to authenticated;

create policy "Agents delete their own app customers"
on public.agent_app_customers
for delete
to authenticated
using ((select auth.uid()) = agent_profile_id);
