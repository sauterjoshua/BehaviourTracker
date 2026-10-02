-- =====================================================================
-- BehaviourTracker – nur positive Zeiten speichern, Loeschung zum
-- Schuljahresende, Live-Updates fuer die Klassenansicht
-- =====================================================================
-- Setzt 0001, 0002 und 0007 voraus. Einmalig im Supabase SQL-Editor
-- ausfuehren – ERST, wenn die passende App-Version (Auswertung nur mit
-- positiven Zeiten) ausgeliefert ist.
--
-- 1. column_time_logs enthaelt nur noch "mitte" (gut) und "rechts"
--    (grossartig). Der Startzustand "links" ist nur noch die aktuelle
--    Position in lesson_students, seine Dauer wird nicht gespeichert.
--    ACHTUNG: Bereits gespeicherte "links"-Zeiten werden geloescht.
-- 2. Unterrichte (samt Zustaenden und Zeiten) werden zum Ende des
--    Schuljahres am 31. Juli geloescht: taeglich per pg_cron und
--    zusaetzlich beim Oeffnen der App fuer das eigene Konto.
--    Klassen, Schueler, Sitzplan und Fokus-Wald bleiben erhalten.
-- 3. lesson_students und lessons kommen in die Realtime-Publication,
--    damit die Klassenansicht live mitlaeuft (RLS greift weiterhin).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Nur positive Zeiten
-- ---------------------------------------------------------------------

delete from public.column_time_logs where "column" = 'links';

alter table public.column_time_logs drop constraint if exists column_time_logs_column_check;
alter table public.column_time_logs drop constraint if exists column_time_logs_positive_only;
alter table public.column_time_logs
  add constraint column_time_logs_positive_only check ("column" in ('mitte', 'rechts'));

create or replace function public.start_lesson(
  p_class_id uuid,
  p_name     text default null,
  p_date     date default null,
  p_mode     text default 'kanban'
)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lesson_id  uuid;
  v_date       date := coalesce(p_date, current_date);
  v_name       text := nullif(btrim(coalesce(p_name, '')), '');
  v_class_name text;
  v_mode       text := coalesce(p_mode, 'kanban');
begin
  if v_mode not in ('kanban', 'sortiert') then
    raise exception 'Ungueltiger Modus: %', v_mode;
  end if;

  select c.name into v_class_name from public.classes c where c.id = p_class_id;
  if v_class_name is null then
    raise exception 'Klasse nicht gefunden oder kein Zugriff';
  end if;

  if v_name is null then
    v_name := v_class_name || ' ' || to_char(v_date, 'DD.MM.YYYY');
  end if;

  insert into public.lessons (class_id, name, date, mode)
  values (p_class_id, left(v_name, 120), v_date, v_mode)
  returning id into v_lesson_id;

  -- Alle starten im Startzustand; dafuer wird keine Zeit erfasst.
  insert into public.lesson_students (lesson_id, student_id, "column", position)
  select v_lesson_id, s.id, 'links', row_number() over (order by s.name, s.id)
  from public.students s
  where s.class_id = p_class_id;

  return v_lesson_id;
end;
$$;

-- Verschieben: offenes Log schliessen, ein neues nur fuer positive Zustaende.
create or replace function public.move_student(
  p_lesson_id  uuid,
  p_student_id uuid,
  p_column     text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current text;
  v_next    integer;
begin
  if p_column not in ('links', 'mitte', 'rechts') then
    raise exception 'Ungueltige Spalte: %', p_column;
  end if;

  select ls."column" into v_current
  from public.lesson_students ls
  where ls.lesson_id = p_lesson_id and ls.student_id = p_student_id
  for update;

  if v_current is null then
    raise exception 'Schueler gehoert nicht zu diesem Unterricht';
  end if;

  if v_current = p_column then
    return;
  end if;

  if abs(public.column_rank(p_column) - public.column_rank(v_current)) <> 1 then
    raise exception 'Nur ein Schritt in die direkt benachbarte Spalte erlaubt';
  end if;

  update public.column_time_logs
     set ended_at = now()
   where lesson_id = p_lesson_id
     and student_id = p_student_id
     and ended_at is null;

  if p_column <> 'links' then
    insert into public.column_time_logs (lesson_id, student_id, "column", started_at)
    values (p_lesson_id, p_student_id, p_column, now());
  end if;

  select coalesce(max(ls.position), 0) + 1 into v_next
  from public.lesson_students ls
  where ls.lesson_id = p_lesson_id and ls."column" = p_column;

  update public.lesson_students
     set "column" = p_column, position = v_next
   where lesson_id = p_lesson_id and student_id = p_student_id;
end;
$$;

-- Fortsetzen: offene Logs nur fuer Schueler in positiven Zustaenden.
create or replace function public.reopen_lesson(p_lesson_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from public.lessons l where l.id = p_lesson_id) then
    raise exception 'Unterricht nicht gefunden oder kein Zugriff';
  end if;

  insert into public.column_time_logs (lesson_id, student_id, "column", started_at)
  select ls.lesson_id, ls.student_id, ls."column", now()
  from public.lesson_students ls
  where ls.lesson_id = p_lesson_id
    and ls."column" <> 'links'
    and not exists (
      select 1 from public.column_time_logs c
      where c.lesson_id = ls.lesson_id and c.student_id = ls.student_id and c.ended_at is null
    );

  update public.lessons set ended_at = null, auto_end_at = null where id = p_lesson_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 2. Loeschung zum Schuljahresende (Schuljahr: 1. August bis 31. Juli)
-- ---------------------------------------------------------------------

create or replace function public.school_year_start(p_day date)
returns date
language sql
immutable
as $$
  select make_date(
    extract(year from p_day)::int - case when extract(month from p_day) < 8 then 1 else 0 end,
    8, 1);
$$;

-- security invoker: Aus der App loescht RLS nur eigene Unterrichte; der
-- Cron-Job laeuft als Tabelleneigentuemer und erfasst alle Konten.
-- Zustaende und Zeiten haengen per ON DELETE CASCADE am Unterricht.
create or replace function public.delete_past_school_years()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.lessons
   where date < public.school_year_start((now() at time zone 'Europe/Berlin')::date);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.school_year_start(date) to authenticated;
grant execute on function public.delete_past_school_years() to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

select cron.unschedule(jobid) from cron.job where jobname = 'loesche-vergangene-schuljahre';
select cron.schedule('loesche-vergangene-schuljahre', '17 2 * * *',
                     $$select public.delete_past_school_years()$$);

-- ---------------------------------------------------------------------
-- 3. Realtime fuer die Klassenansicht
-- ---------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lesson_students') then
    alter publication supabase_realtime add table public.lesson_students;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lessons') then
    alter publication supabase_realtime add table public.lessons;
  end if;
end $$;

grant execute on function public.start_lesson(uuid, text, date, text) to authenticated;
grant execute on function public.move_student(uuid, uuid, text) to authenticated;
grant execute on function public.reopen_lesson(uuid) to authenticated;

notify pgrst, 'reload schema';
