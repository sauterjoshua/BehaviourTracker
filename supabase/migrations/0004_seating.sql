-- =====================================================================
-- BehaviourTracker – Sitzplan je Klasse
-- =====================================================================
-- Setzt 0001_init.sql voraus (Tabelle students).
--
-- Jede Schuelerin / jeder Schueler hat optional einen Platz im Raum.
-- seat_x/seat_y sind die linke obere Ecke des Tisches in virtuellen
-- Raumeinheiten (Raum 1200 x 700, Tisch 120 x 60, siehe SEAT_* in
-- app.js). NULL = noch ohne Platz. RLS und Rechte von students gelten
-- fuer die neuen Spalten mit.
-- =====================================================================

alter table public.students
  add column if not exists seat_x real,
  add column if not exists seat_y real;

alter table public.students
  drop constraint if exists students_seat_check;
alter table public.students
  add constraint students_seat_check check (
    (seat_x is null and seat_y is null)
    or (seat_x between 0 and 1200 and seat_y between 0 and 700)
  );

notify pgrst, 'reload schema';
