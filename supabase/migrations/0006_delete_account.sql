-- =====================================================================
-- BehaviourTracker – Konto selbst loeschen (Art. 17 DSGVO)
-- =====================================================================
-- Setzt 0001_init.sql voraus. Einmalig im Supabase SQL-Editor ausfuehren.
--
-- Die App ruft delete_own_account() per RPC auf. Die Funktion loescht
-- ausschliesslich den eigenen Auth-User (auth.uid()). Alle Daten haengen
-- per ON DELETE CASCADE daran:
--   auth.users -> teachers -> classes -> students / lessons / focus_trees
--   -> lesson_students / column_time_logs
-- SECURITY DEFINER ist noetig, weil die Rolle "authenticated" keine
-- Rechte auf auth.users hat; die Funktion laeuft mit den Rechten ihres
-- Erstellers (postgres im SQL-Editor).
-- =====================================================================

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  delete from auth.users where id = v_uid;
end;
$$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

notify pgrst, 'reload schema';
