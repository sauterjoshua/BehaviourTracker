-- =====================================================================
-- BehaviourTracker – "Wer ist da?" und Nachsenden bei schlechtem WLAN
-- =====================================================================
-- Setzt 0001, 0007 und 0008 voraus. Einmalig im Supabase SQL-Editor
-- ausfuehren.
--
-- 1. set_presence(): Wer fehlt, wird aus einem Unterricht herausgenommen
--    (Zeile in lesson_students geloescht) und sammelt keine Zeit. Eine
--    Abwesenheit wird nicht gesondert gespeichert. Bereits gesammelte
--    Zeit bleibt erhalten, z. B. wenn jemand mitten in der Stunde geht.
--    Wieder hinzugefuegt startet die Person im Startzustand.
--
-- 2. move_student() und set_presence() nehmen p_delay_ms an: wie viele
--    Millisekunden die Aenderung schon zurueckliegt. Die App sammelt
--    Aenderungen bei Verbindungsabbruechen und sendet sie danach nach;
--    die Zeiten stimmen trotzdem auf die Sekunde. Gemessen wird die
--    Verzoegerung mit der Uhr des Geraets, die Server-Uhr legt den
--    Zeitpunkt fest – eine falsch gehende Geraeteuhr spielt so keine
--    Rolle. Hoechstens 15 Minuten, nie vor dem Start des Unterrichts
--    oder der letzten Aenderung derselben Person.
-- =====================================================================

-- Zeitpunkt einer (ggf. nachgesendeten) Aenderung fuer eine Person.
create or replace function public.change_time(
  p_lesson_id  uuid,
  p_student_id uuid,
  p_delay_ms   integer
)
returns timestamptz
language sql
stable
security invoker
set search_path = public
as $$
  select greatest(
    now() - make_interval(secs => least(greatest(coalesce(p_delay_ms, 0), 0), 900000) / 1000.0),
    (select l.created_at from public.lessons l where l.id = p_lesson_id),
    (select max(c.started_at) from public.column_time_logs c
      where c.lesson_id = p_lesson_id and c.student_id = p_student_id)
  );
$$;

-- Signaturaenderung (neuer Parameter) erfordert DROP vor CREATE.
drop function if exists public.move_student(uuid, uuid, text);

create or replace function public.move_student(
  p_lesson_id  uuid,
  p_student_id uuid,
  p_column     text,
  p_delay_ms   integer default 0
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current text;
  v_next    integer;
  v_at      timestamptz;
  v_end     timestamptz;
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

  select l.ended_at into v_end from public.lessons l where l.id = p_lesson_id;
  v_at := public.change_time(p_lesson_id, p_student_id, p_delay_ms);

  -- Nachgesendet nach dem Ende: nur, was vor dem Ende passiert ist.
  if v_end is not null and v_at >= v_end then
    raise exception 'Der Unterricht ist schon beendet';
  end if;

  -- Laufende (oder beim Beenden geschlossene) Zeit zum Zeitpunkt der Aenderung beenden.
  update public.column_time_logs
     set ended_at = v_at
   where lesson_id = p_lesson_id
     and student_id = p_student_id
     and (ended_at is null or ended_at > v_at);

  if p_column <> 'links' then
    insert into public.column_time_logs (lesson_id, student_id, "column", started_at, ended_at)
    values (p_lesson_id, p_student_id, p_column, v_at, v_end);
  end if;

  select coalesce(max(ls.position), 0) + 1 into v_next
  from public.lesson_students ls
  where ls.lesson_id = p_lesson_id and ls."column" = p_column;

  update public.lesson_students
     set "column" = p_column, position = v_next
   where lesson_id = p_lesson_id and student_id = p_student_id;
end;
$$;

-- Person in einen Unterricht aufnehmen (p_present) oder herausnehmen.
create or replace function public.set_presence(
  p_lesson_id  uuid,
  p_student_id uuid,
  p_present    boolean,
  p_delay_ms   integer default 0
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_class uuid;
  v_next  integer;
begin
  -- RLS: nur eigene Unterrichte und Schueler sind sichtbar.
  select l.class_id into v_class from public.lessons l where l.id = p_lesson_id;
  if v_class is null then
    raise exception 'Unterricht nicht gefunden oder kein Zugriff';
  end if;

  if p_present then
    if not exists (select 1 from public.students s where s.id = p_student_id and s.class_id = v_class) then
      raise exception 'Schueler gehoert nicht zu dieser Klasse';
    end if;
    select coalesce(max(ls.position), 0) + 1 into v_next
    from public.lesson_students ls
    where ls.lesson_id = p_lesson_id and ls."column" = 'links';
    insert into public.lesson_students (lesson_id, student_id, "column", position)
    values (p_lesson_id, p_student_id, 'links', v_next)
    on conflict (lesson_id, student_id) do nothing;
  else
    update public.column_time_logs
       set ended_at = public.change_time(p_lesson_id, p_student_id, p_delay_ms)
     where lesson_id = p_lesson_id
       and student_id = p_student_id
       and ended_at is null;
    delete from public.lesson_students
     where lesson_id = p_lesson_id and student_id = p_student_id;
  end if;
end;
$$;

grant execute on function public.change_time(uuid, uuid, integer) to authenticated;
grant execute on function public.move_student(uuid, uuid, text, integer) to authenticated;
grant execute on function public.set_presence(uuid, uuid, boolean, integer) to authenticated;

notify pgrst, 'reload schema';
