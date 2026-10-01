-- =====================================================================
-- BehaviourTracker – Stundenplan und automatisches Unterrichtsende
-- =====================================================================
-- Setzt 0001_init.sql voraus. Einmalig im Supabase SQL-Editor ausfuehren.
--
-- teachers.settings (jsonb): Einstellungen der Lehrkraft, u. a.
--   schedule: { dayStart: "08:00", blocks: [{ kind: "stunde"|"pause", min }],
--               slots: { "<Wochentag 1-5>:<Stunde>": "<class_id>" } }
--   autoEnd:  { mode: "fix"|"plan"|"off", plusMin, onClose }
--
-- lessons.auto_end_at: Zeitpunkt, zu dem ein Unterricht spaetestens endet.
-- Die App setzt ihn beim Start. close_due_lessons() beendet faellige
-- Unterrichte rueckwirkend genau zu diesem Zeitpunkt – auch wenn die Seite
-- zwischendurch geschlossen war. Die Auswertungs-View kappt offene Zeiten
-- zusaetzlich am Endzeitpunkt, damit sie auch vorher schon stimmt.
-- =====================================================================

alter table public.teachers
  add column if not exists settings jsonb not null default '{}'::jsonb;

alter table public.teachers drop constraint if exists teachers_settings_check;
alter table public.teachers
  add constraint teachers_settings_check
  check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) <= 32768);

alter table public.lessons
  add column if not exists auto_end_at timestamptz;

create index if not exists lessons_open_auto_end_idx
  on public.lessons (auto_end_at)
  where ended_at is null and auto_end_at is not null;

-- Beendet alle faelligen eigenen Unterrichte (RLS: security invoker).
create or replace function public.close_due_lessons()
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.column_time_logs c
     set ended_at = greatest(c.started_at, l.auto_end_at)
    from public.lessons l
   where c.lesson_id = l.id
     and c.ended_at is null
     and l.ended_at is null
     and l.auto_end_at is not null
     and l.auto_end_at <= now();

  update public.lessons
     set ended_at = auto_end_at
   where ended_at is null
     and auto_end_at is not null
     and auto_end_at <= now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Fortsetzen hebt den alten Endzeitpunkt auf; die App setzt danach einen neuen.
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
    and not exists (
      select 1 from public.column_time_logs c
      where c.lesson_id = ls.lesson_id and c.student_id = ls.student_id and c.ended_at is null
    );

  update public.lessons set ended_at = null, auto_end_at = null where id = p_lesson_id;
end;
$$;

-- Offene Zeiten enden spaetestens am automatischen Endzeitpunkt.
create or replace view public.student_lesson_column_seconds
with (security_invoker = true) as
select
  l.class_id,
  ctl.student_id,
  ctl.lesson_id,
  l.name  as lesson_name,
  l.date  as lesson_date,
  ctl."column",
  (extract(epoch from sum(greatest(interval '0',
    least(coalesce(ctl.ended_at, now()), coalesce(l.auto_end_at, 'infinity'::timestamptz)) - ctl.started_at
  ))))::bigint as seconds
from public.column_time_logs ctl
join public.lessons l on l.id = ctl.lesson_id
group by l.class_id, ctl.student_id, ctl.lesson_id, l.name, l.date, ctl."column";

grant select on public.student_lesson_column_seconds to authenticated;
grant execute on function public.close_due_lessons() to authenticated;
grant execute on function public.reopen_lesson(uuid) to authenticated;

notify pgrst, 'reload schema';
