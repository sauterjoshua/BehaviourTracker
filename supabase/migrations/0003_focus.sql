-- =====================================================================
-- BehaviourTracker – Fokus-Wald (Lautstaerke-Monitor mit Klassenwald)
-- =====================================================================
-- Setzt 0001_init.sql voraus (Tabelle classes, Funktion owns_class).
--
-- Audio wird ausschliesslich im Browser ausgewertet. Gespeichert wird
-- nur, dass eine Klasse ein Ruheziel erreicht hat (ein "Baum") und wie
-- lang dieses Ziel war.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Gepflanzte Baeume
-- ---------------------------------------------------------------------

create table if not exists public.focus_trees (
  id            uuid primary key default gen_random_uuid(),
  class_id      uuid not null references public.classes(id) on delete cascade,
  goal_seconds  integer not null check (goal_seconds between 60 and 7200),
  created_at    timestamptz not null default now()
);
create index if not exists focus_trees_class_id_idx on public.focus_trees (class_id);

alter table public.focus_trees enable row level security;

drop policy if exists focus_trees_all on public.focus_trees;
create policy focus_trees_all on public.focus_trees
  for all using      (public.owns_class(class_id))
      with check (public.owns_class(class_id));

grant select, insert, delete on public.focus_trees to authenticated;

-- ---------------------------------------------------------------------
-- 2. Optionale Belohnung je Klasse
-- ---------------------------------------------------------------------
-- Fortschritt = Anzahl Baeume - focus_reward_offset. Beim Einloesen
-- setzt die App den Offset auf die aktuelle Baumzahl.
-- RLS und Rechte von classes gelten fuer die neuen Spalten mit.

alter table public.classes
  add column if not exists focus_reward text
    check (focus_reward is null or char_length(btrim(focus_reward)) between 1 and 120),
  add column if not exists focus_reward_goal integer
    check (focus_reward_goal is null or focus_reward_goal between 1 and 500),
  add column if not exists focus_reward_offset integer not null default 0
    check (focus_reward_offset >= 0);

-- PostgREST soll die neue Tabelle und Beziehung sofort kennen.
notify pgrst, 'reload schema';
