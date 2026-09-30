# BehaviourTracker

🔗 **Seite öffnen:** https://sauterjoshua.github.io/BehaviourTracker/

---

## Anmelden

1. Link oben öffnen.
2. Mit E-Mail und Passwort anmelden (bzw. beim ersten Mal registrieren).
3. Nach dem Login erscheint das Menü mit **Klassen**, **Unterrichte** und
   **Fokus-Wald**.

---

## Was die Seite macht

BehaviourTracker hilft, das Unterrichtsverhalten von Schülerinnen und
Schülern sichtbar zu machen. Jede Person hat einen von drei Zuständen:

| Zustand | Bedeutung |
| --- | --- |
| Da geht mehr | grau |
| Du arbeitest gut | hellgrün |
| Du arbeitest großartig | dunkelgrün |

Beim Start eines Unterrichts wählt man eine von zwei Ansichten:

- **Kanban** – drei Spalten, alle Schüler starten links in „Da geht mehr“
  und werden per **Drag & Drop** in die jeweils benachbarte Spalte
  verschoben.
- **Sortierte Ansicht** – alle Schüler alphabetisch in einem Raster.
  Antippen der **linken** Boxhälfte schaltet einen Zustand zurück, die
  **rechte** Hälfte einen vor; die Position im Raster bleibt dabei fest,
  nur die Farbe wechselt. Im Header läuft eine Live-Zählung mit, z. B.
  „2 können mehr | 5 arbeiten gut | 1 arbeitet großartig“.

Beide Ansichten sind nur unterschiedliche Darstellungen derselben Daten –
die App misst in beiden automatisch, **wie lange** jede Person in
welchem Zustand war, und die Auswertung macht keinen Unterschied
zwischen ihnen.

- In der **Klassen-Ansicht** lässt sich pro Schüler auswerten, wie viel
  Zeit in welchem Zustand verbracht wurde – als Summe, in Prozent und
  aufgeschlüsselt je Unterricht.

Kurzablauf im Unterricht:

1. **Klassen** → Klasse anlegen → Schüler eintragen.
2. **Unterrichte** → *Unterricht starten* → Klasse wählen → Ansicht wählen
   (Kanban oder Sortiert).
3. Während der Stunde je nach Verhalten verschieben (Kanban) bzw. antippen
   (Sortierte Ansicht).
4. Am Ende **Unterricht beenden**, um die Zeitmessung zu stoppen.
5. Auswertung unter **Klassen** → Schüler antippen.

---

## Sitzplan

Unter **Klassen** → Klasse öffnen → **Sitzplan**.

- Oben liegen alle Schüler **ohne Platz**, darunter der Raum mit der
  **Tafel unten**.
- Tische werden per Maus oder Finger frei in den Raum gezogen. Neben, über
  oder unter einem anderen Tisch rasten sie **bündig ein**, auch wenn beim
  Loslassen noch eine kleine Lücke war – so entstehen Zweiertische,
  Reihen und Blöcke. Ohne direkten Nachbarn richtet sich ein Tisch an den
  Reihen und Spalten der übrigen Tische aus.
- Auf einem belegten Tisch losgelassen, rutscht er auf den nächsten freien
  Nachbarplatz. Zurück in die Ablage ziehen gibt den Platz frei.
- **Rest automatisch platzieren** setzt alle Übrigen in Zweierreihen von
  vorne nach hinten, **Alle leeren** räumt den Raum.

Einmalig muss dafür `supabase/migrations/0004_seating.sql` im Supabase
SQL-Editor ausgeführt werden.

---

## Fokus-Wald (Lautstärke-Monitor)

Für Stillarbeit auf dem Beamer, aufgebaut wie
[Mio's Monster Meter](https://sleepy-mio.classroomzen.com/) – nur mit einem
Baum statt eines Monsters, damit es auch bei älteren Klassen zieht.

| Lautstärke | Wirkung |
| --- | --- |
| ruhig (grün) | Timer läuft, der Baum wächst |
| unruhig (gelb) | Timer pausiert |
| zu laut (rot, länger als ca. 1,5 s) | Baum vertrocknet, ein neuer Samen startet |

- Jeder erreichte Timer pflanzt den Baum dauerhaft im **Wald der Klasse**.
  Längere Ziele ergeben seltenere Bäume (bis 5 min Laubbaum, 10–15 min Tanne,
  ab 20 min Kirschbaum). Während der Fokus-Phase steht der bisherige Wald
  der Klasse blass im Hintergrund.
- Ziel **Offen**: Der Timer zählt hoch, der Baum wird ab 10 min zur Tanne und
  ab 20 min zum Kirschbaum. Mit **Baum pflanzen** (ab 3 min) wird er mit der
  erreichten Zeit gepflanzt. Wird es ab 3 min zu laut, vertrocknet der Baum
  nicht, sondern die zuletzt erreichte Stufe wird gepflanzt und ein neuer
  Samen startet.
- Die Klassen werden in einem **Ranking** nach Fokus-Minuten verglichen.
- Pro Klasse lässt sich eine **Belohnung** festlegen, z. B. „bei 20 Bäumen:
  Musik in der Stillarbeit“.
- Beim Erklären auf **Pause** tippen (oder Leertaste), damit die eigene
  Stimme nicht mitzählt. Die Empfindlichkeit lässt sich im *Probelauf ohne
  Klasse* einstellen.

Das Mikrofon misst nur die Lautstärke direkt im Browser – es wird nichts
aufgenommen, gespeichert oder übertragen. Gespeichert wird nur der fertige
Baum. Einmalig muss dafür `supabase/migrations/0003_focus.sql` im Supabase
SQL-Editor ausgeführt werden.
