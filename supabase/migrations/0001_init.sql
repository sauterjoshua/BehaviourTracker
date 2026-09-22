-- =====================================================================
-- BehaviourTracker – Initiales Schema, RLS-Policies und RPC-Funktionen
-- =====================================================================
-- Ausfuehren im Supabase SQL-Editor (oder via `supabase db push`).
--
-- HINWEIS zum Spaltennamen "column":
--   COLUMN ist in PostgreSQL ein reserviertes Schluesselwort. Die Spalte
--   heisst wie im Konzept gefordert "column", muss dafuer aber ueberall in
--   doppelte Anfuehrungszeichen gesetzt werden. PostgREST/supabase-js
--   quoten Bezeichner automatisch, im Frontend ist also `column` als
--   normaler Feldname nutzbar.
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- 1. Tabellen
-- ---------------------------------------------------------------------

create table if not exists public.teachers (
  id            uuid primary key default gen_random_uuid(),
  auth_user_id  uuid not null unique references auth.users(id) on delete cascade,
  nickname      text not null check (char_length(btrim(nickname)) between 1 and 60),
  created_at    timestamptz not null default now()
);

create table if not exists public.classes (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid not null references public.teachers(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  created_at  timestamptz not null default now(),
  unique (teacher_id, name)
);
create index if not exists classes_teacher_id_idx on public.classes (teacher_id);

create table if not exists public.students (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 80),
  created_at  timestamptz not null default now()
);
create index if not exists students_class_id_idx on public.students (class_id);

create table if not exists public.lessons (
  id          uuid primary key default gen_random_uuid(),
  class_id    uuid not null references public.classes(id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  date        date not null default current_date,
  ended_at    timestamptz,           -- gesetzt, sobald der Unterricht beendet wurde
  created_at  timestamptz not null default now()
);
create index if not exists lessons_class_id_idx on public.lessons (class_id);
create index if not exists lessons_created_at_idx on public.lessons (created_at desc);

create table if not exists public.lesson_students (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.lessons(id)  on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  "column"    text not null default 'links'
                check ("column" in ('links', 'mitte', 'rechts')),
  position    integer not null default 0,
  unique (lesson_id, student_id)
);
create index if not exists lesson_students_lesson_id_idx on public.lesson_students (lesson_id);
create index if not exists lesson_students_student_id_idx on public.lesson_students (student_id);

create table if not exists public.column_time_logs (
  id          uuid primary key default gen_random_uuid(),
  lesson_id   uuid not null references public.lessons(id)  on delete cascade,
  student_id  uuid not null references public.students(id) on delete cascade,
  "column"    text not null check ("column" in ('links', 'mitte', 'rechts')),
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  check (ended_at is null or ended_at >= started_at)
);
create index if not exists column_time_logs_lesson_id_idx  on public.column_time_logs (lesson_id);
create index if not exists column_time_logs_student_id_idx on public.column_time_logs (student_id);

-- Pro Schueler und Unterricht darf immer nur EIN Log offen sein.
create unique index if not exists column_time_logs_one_open_idx
  on public.column_time_logs (lesson_id, student_id)
  where ended_at is null;

-- ---------------------------------------------------------------------
-- 2. Hilfsfunktionen fuer Besitz-Pruefung (Kette bis auth.uid())
-- ---------------------------------------------------------------------

create or replace function public.current_teacher_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select t.id from public.teachers t where t.auth_user_id = auth.uid();
$$;

create or replace function public.owns_class(p_class_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.classes c
    join public.teachers t on t.id = c.teacher_id
    where c.id = p_class_id and t.auth_user_id = auth.uid()
  );
$$;

create or replace function public.owns_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    join public.classes  c on c.id = s.class_id
    join public.teachers t on t.id = c.teacher_id
    where s.id = p_student_id and t.auth_user_id = auth.uid()
  );
$$;

create or replace function public.owns_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lessons  l
    join public.classes  c on c.id = l.class_id
    join public.teachers t on t.id = c.teacher_id
    where l.id = p_lesson_id and t.auth_user_id = auth.uid()
  );
$$;

-- Rang einer Spalte, um "nur benachbart verschieben" zu pruefen.
create or replace function public.column_rank(p_column text)
returns integer
language sql
immutable
as $$
  select case p_column when 'links' then 1 when 'mitte' then 2 when 'rechts' then 3 end;
$$;

-- ---------------------------------------------------------------------
-- 3. Row Level Security
-- ---------------------------------------------------------------------

alter table public.teachers          enable row level security;
alter table public.classes           enable row level security;
alter table public.students          enable row level security;
alter table public.lessons           enable row level security;
alter table public.lesson_students   enable row level security;
alter table public.column_time_logs  enable row level security;

-- teachers: jeder Lehrer sieht/aendert nur seine eigene Zeile.
drop policy if exists teachers_select on public.teachers;
create policy teachers_select on public.teachers
  for select using (auth_user_id = auth.uid());

drop policy if exists teachers_insert on public.teachers;
create policy teachers_insert on public.teachers
  for insert with check (auth_user_id = auth.uid());

drop policy if exists teachers_update on public.teachers;
create policy teachers_update on public.teachers
  for update using (auth_user_id = auth.uid())
              with check (auth_user_id = auth.uid());

-- classes
drop policy if exists classes_all on public.classes;
create policy classes_all on public.classes
  for all using      (teacher_id = public.current_teacher_id())
      with check (teacher_id = public.current_teacher_id());

-- students
drop policy if exists students_all on public.students;
create policy students_all on public.students
  for all using      (public.owns_class(class_id))
      with check (public.owns_class(class_id));

-- lessons
drop policy if exists lessons_all on public.lessons;
create policy lessons_all on public.lessons
  for all using      (public.owns_class(class_id))
      with check (public.owns_class(class_id));

-- lesson_students
drop policy if exists lesson_students_all on public.lesson_students;
create policy lesson_students_all on public.lesson_students
  for all using      (public.owns_lesson(lesson_id) and public.owns_student(student_id))
      with check (public.owns_lesson(lesson_id) and public.owns_student(student_id));

-- column_time_logs
drop policy if exists column_time_logs_all on public.column_time_logs;
create policy column_time_logs_all on public.column_time_logs
  for all using      (public.owns_lesson(lesson_id) and public.owns_student(student_id))
      with check (public.owns_lesson(lesson_id) and public.owns_student(student_id));

-- ---------------------------------------------------------------------
-- 4. Lehrer-Zeile automatisch beim Signup anlegen
-- ---------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.teachers (auth_user_id, nickname)
  values (
    new.id,
    left(
      coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'nickname'), ''),
        split_part(coalesce(new.email, 'lehrkraft'), '@', 1)
      ),
      60
    )
  )
  on conflict (auth_user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 5. RPC-Funktionen (atomar, security invoker => RLS greift weiterhin)
-- ---------------------------------------------------------------------

-- Neuen Unterricht starten: Lesson + lesson_students ('links') +
-- offene column_time_logs fuer alle Schueler der Klasse.
create or replace function public.start_lesson(
  p_class_id uuid,
  p_name     text default null,
  p_date     date default null
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
begin
  -- RLS sorgt dafuer, dass hier nur eigene Klassen gefunden werden.
  select c.name into v_class_name from public.classes c where c.id = p_class_id;
  if v_class_name is null then
    raise exception 'Klasse nicht gefunden oder kein Zugriff';
  end if;

  if v_name is null then
    v_name := v_class_name || ' ' || to_char(v_date, 'DD.MM.YYYY');
  end if;

  insert into public.lessons (class_id, name, date)
  values (p_class_id, left(v_name, 120), v_date)
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

-- Schueler verschieben: altes Log schliessen, neues oeffnen, Position ans Ende.
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

  insert into public.column_time_logs (lesson_id, student_id, "column", started_at)
  values (p_lesson_id, p_student_id, p_column, now());

  select coalesce(max(ls.position), 0) + 1 into v_next
  from public.lesson_students ls
  where ls.lesson_id = p_lesson_id and ls."column" = p_column;

  update public.lesson_students
     set "column" = p_column, position = v_next
   where lesson_id = p_lesson_id and student_id = p_student_id;
end;
$$;

-- Unterricht beenden: alle offenen Logs schliessen.
create or replace function public.end_lesson(p_lesson_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not exists (select 1 from public.lessons l where l.id = p_lesson_id) then
    raise exception 'Unterricht nicht gefunden oder kein Zugriff';
  end if;

  update public.column_time_logs
     set ended_at = now()
   where lesson_id = p_lesson_id and ended_at is null;

  update public.lessons set ended_at = now()
   where id = p_lesson_id and ended_at is null;
end;
$$;

-- Unterricht wieder oeffnen (falls versehentlich beendet).
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

  update public.lessons set ended_at = null where id = p_lesson_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 6. Auswertungs-View (security_invoker => RLS der Basistabellen greift)
-- ---------------------------------------------------------------------
-- security_invoker setzt PostgreSQL 15+ voraus (bei Supabase Standard).
-- Ohne diese Option liefe die View mit den Rechten des Eigentuemers und
-- wuerde die RLS-Policies umgehen.

create or replace view public.student_lesson_column_seconds
with (security_invoker = true) as
select
  l.class_id,
  ctl.student_id,
  ctl.lesson_id,
  l.name  as lesson_name,
  l.date  as lesson_date,
  ctl."column",
  (extract(epoch from sum(coalesce(ctl.ended_at, now()) - ctl.started_at)))::bigint as seconds
from public.column_time_logs ctl
join public.lessons l on l.id = ctl.lesson_id
group by l.class_id, ctl.student_id, ctl.lesson_id, l.name, l.date, ctl."column";

-- ---------------------------------------------------------------------
-- 7. Rechte
-- ---------------------------------------------------------------------

grant usage on schema public to anon, authenticated;

grant select, insert, update, delete on
  public.teachers, public.classes, public.students,
  public.lessons, public.lesson_students, public.column_time_logs
to authenticated;

grant select on public.student_lesson_column_seconds to authenticated;

grant execute on function
  public.start_lesson(uuid, text, date),
  public.move_student(uuid, uuid, text),
  public.end_lesson(uuid),
  public.reopen_lesson(uuid),
  public.current_teacher_id(),
  public.owns_class(uuid),
  public.owns_student(uuid),
  public.owns_lesson(uuid),
  public.column_rank(text)
to authenticated;
