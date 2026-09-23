-- =====================================================================
-- BehaviourTracker – Unterrichts-Modus ("kanban" | "sortiert")
-- =====================================================================
-- Fuehrt eine zweite Unterrichts-Ansicht ein ("Sortierte Ansicht": alle
-- Schueler alphabetisch in einem Raster statt in drei Spalten). Beide
-- Modi nutzen dieselben Tabellen (lesson_students, column_time_logs) und
-- dieselbe move_student()-Funktion; der "Zustand" 0/1/2 der sortierten
-- Ansicht ist 1:1 auf die bestehenden Spalten links/mitte/rechts gemappt,
-- damit die Auswertungs-View unveraendert weiterverwendet werden kann.
-- =====================================================================

alter table public.lessons
  add column if not exists mode text not null default 'kanban'
    check (mode in ('kanban', 'sortiert'));

-- Signaturaenderung (neuer Parameter) erfordert DROP vor CREATE OR REPLACE.
drop function if exists public.start_lesson(uuid, text, date);

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

  -- RLS sorgt dafuer, dass hier nur eigene Klassen gefunden werden.
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

  insert into public.lesson_students (lesson_id, student_id, "column", position)
  select v_lesson_id, s.id, 'links', row_number() over (order by s.name, s.id)
  from public.students s
  where s.class_id = p_class_id;

  insert into public.column_time_logs (lesson_id, student_id, "column", started_at)
  select v_lesson_id, s.id, 'links', now()
  from public.students s
  where s.class_id = p_class_id;

  return v_lesson_id;
end;
$$;

grant execute on function public.start_lesson(uuid, text, date, text) to authenticated;

-- PostgREST haelt einen Schema-Cache und erkennt neue Funktionssignaturen
-- nach einer per SQL-Editor ausgefuehrten Migration nicht immer sofort.
notify pgrst, 'reload schema';
