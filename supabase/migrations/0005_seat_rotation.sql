-- =====================================================================
-- BehaviourTracker – Sitzplan: Tische hochkant drehen
-- =====================================================================
-- Setzt 0004_seating.sql voraus. seat_rot = true heisst, der Tisch steht
-- hochkant (60 x 120 statt 120 x 60 Raumeinheiten), z. B. an der
-- Stirnseite einer Tischreihe.
-- =====================================================================

alter table public.students
  add column if not exists seat_rot boolean not null default false;

notify pgrst, 'reload schema';
