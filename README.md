# BehaviourTracker

🔗 **Seite öffnen:** https://sauterjoshua.github.io/BehaviourTracker/

---

## Anmelden

1. Link oben öffnen – das ist die Startseite. Oben rechts auf **Anmelden**
   (oder auf **Kostenlos starten**, um ein Konto anzulegen). Die App selbst
   liegt unter `app.html`; alte Lesezeichen auf `…/#/…` werden automatisch
   dorthin weitergeleitet.
2. Mit E-Mail und Passwort anmelden (bzw. beim ersten Mal registrieren).
3. Nach dem Login erscheint **Heute**. Oben in der Kopfzeile:
   - Navigation **Heute · Klassen · Unterrichte · Fokus-Wald**,
   - **Jetzt: 7b** – die Klasse der aktuellen Stunde laut Stundenplan,
   - **+ Starten** – Unterricht oder Fokus-Phase starten, die aktuelle Klasse
     steht zuerst,
   - das **Konto-Menü** (Name) mit Einstellungen, Datenexport und Abmelden.

   Eine Klasse hat die Reiter **Schüler · Sitzplan · Auswertung · Wald**.
   Während eines Unterrichts ist die Kopfzeile auf das Nötigste reduziert.

---

## Was die Seite macht

BehaviourTracker hilft, das Unterrichtsverhalten von Schülerinnen und
Schülern sichtbar zu machen. Jede Person hat einen von drei Zuständen:

| Zustand | Darstellung |
| --- | --- |
| Da geht mehr | neutral grau |
| Du arbeitest gut | helle Akzentfarbe |
| Du arbeitest großartig | kräftige Akzentfarbe |

Die Farben hängen von der gewählten **Farbwelt** ab: Standard ist
*Salbei* (gedämpftes Waldgrün), unter **Konto-Menü → Einstellungen** lassen
sich *Tafelgrün*, *Tinte* und *Bernstein* wählen. Die Wahl
wird im Konto gespeichert und gilt auf allen Geräten.

Beim Start eines Unterrichts wählt man eine von zwei Ansichten:

- **Kanban** – drei Spalten, alle Schüler starten links in „Da geht mehr“
  und werden per **Drag & Drop** in die jeweils benachbarte Spalte
  verschoben – mit Maus, Touch oder Stift.
- **Sortierte Ansicht** – alle Schüler alphabetisch in einem Raster.
  Antippen der **linken** Boxhälfte schaltet einen Zustand zurück, die
  **rechte** Hälfte einen vor; die Position im Raster bleibt dabei fest,
  nur die Farbe wechselt. Im Header läuft eine Live-Zählung mit, z. B.
  „2 können mehr | 5 arbeiten gut | 1 arbeitet großartig“.

Beide Ansichten sind nur unterschiedliche Darstellungen derselben Daten –
die App misst in beiden automatisch, **wie lange** jede Person in
welchem Zustand war, und die Auswertung macht keinen Unterschied
zwischen ihnen.

- Unter **Klasse → Auswertung** steht die Verteilung der ganzen Klasse und
  jeder Person; ein Name führt zu den Zeiten je Unterricht.

Kurzablauf im Unterricht:

1. **Klassen** → Klasse anlegen → Schüler eintragen.
2. **Unterrichte** → *Unterricht starten* → Klasse wählen → Ansicht wählen
   (Kanban oder Sortiert).
3. Während der Stunde je nach Verhalten verschieben (Kanban) bzw. antippen
   (Sortierte Ansicht).
4. Am Ende **Unterricht beenden**, um die Zeitmessung zu stoppen – oder er
   endet automatisch (siehe unten).
5. Auswertung unter **Klassen** → Klasse → **Auswertung**.

---

## Stundenplan und automatisches Unterrichtsende

Unter **Konto-Menü → Einstellungen**. Wer nichts einrichtet, bei dem bleibt
alles wie gewohnt (außer dem 50-Minuten-Ende, siehe unten).

- **Stundenzeiten**: Beginn der 1. Stunde und dann der Tagesablauf als Folge
  von Stunden und Pausen mit Dauer in Minuten; die Uhrzeiten werden daraus
  berechnet. Eine Vorlage (6 × 45 min, Pausen nach der 2. und 4. Stunde)
  hilft beim Start.
- **Wochenplan**: Je Wochentag und Stunde eine Klasse auswählen.
  Aufeinanderfolgende Stunden derselben Klasse gelten als Doppelstunde.
- Ab 5 Minuten vor Stundenbeginn steht die Klasse überall zuerst: als
  **Jetzt**-Hinweis in der Kopfzeile, auf **Heute**, unter **+ Starten**, in
  der Klassenliste und beim Unterricht-Starten.

**Unterricht automatisch beenden** (gilt für Kanban und sortierte Ansicht):

| Einstellung | Wirkung |
| --- | --- |
| Spätestens 50 min nach dem Start (Standard) | eine Schulstunde + 5 min |
| Ende der Stunde laut Stundenplan + n min | z. B. 7a dienstags 11:00–11:45, n = 5 → Ende 11:50; ohne passende Stunde nach 50 min |
| Nicht nach Zeit beenden | läuft, bis man ihn selbst beendet |
| zusätzlich: beim Schließen der Seite | beendet die im Tab geöffneten Unterrichte; bloßes Neuladen setzt sie fort |

Das zeitliche Ende passiert auf dem Server: Ist die Seite zu, wird der
Unterricht beim nächsten Öffnen der App rückwirkend genau zum Endzeitpunkt
abgeschlossen, und die Auswertung zählt ohnehin nur bis dahin.
**Fortsetzen** setzt einen neuen Endzeitpunkt nach derselben Regel.

Einmalig muss dafür `supabase/migrations/0007_schedule_autoend.sql` im
Supabase SQL-Editor ausgeführt werden.

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
- **Antippen** dreht einen Tisch **hochkant** (und zurück). Hochkant
  stehende Tische rasten ebenfalls bündig an, z. B. an der Stirnseite
  einer Tischreihe oder mittig unter einem Zweiertisch.
- Auf einem belegten Tisch losgelassen, rutscht er auf den nächsten freien
  Nachbarplatz. Zurück in die Ablage ziehen gibt den Platz frei.
- **Rest automatisch platzieren** setzt alle Übrigen in Zweierreihen von
  vorne nach hinten, **Alle leeren** räumt den Raum.

Einmalig müssen dafür `supabase/migrations/0004_seating.sql` und
`0005_seat_rotation.sql` im Supabase SQL-Editor ausgeführt werden.

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
  Während der Fokus-Phase steht der bisherige Wald der Klasse blass im
  Hintergrund.
- Jedes Ziel hat eine eigene heimische Baumart mit **Steckbrief** (Höhe,
  Alter, ein Fakt zum Vorlesen). Wie in einem echten Wald kommen zuerst die
  schnell wachsenden Pionierbäume, zuletzt die langsamen Riesen:

  | Ziel | Baum |
  | --- | --- |
  | 3 min | Hänge-Birke |
  | 5 min | Vogelkirsche |
  | 10 min | Berg-Ahorn |
  | 15 min | Gemeine Fichte |
  | 20 min | Rotbuche |
  | 30 min | Stiel-Eiche |
  | 45 min | Riesenmammutbaum |

  Der Fakt zur aktuellen Art steht während der Fokus-Phase dezent unter dem
  Timer und beim Pflanzen in der Erfolgsmeldung.
- Ziel **Offen**: Der Timer zählt hoch, der Baum wird an den Schwellen oben
  zur nächsten Art. Mit **Baum pflanzen** (ab 3 min) wird er mit der
  erreichten Zeit gepflanzt. Wird es ab 3 min zu laut, vertrocknet der Baum
  nicht, sondern die zuletzt erreichte Stufe wird gepflanzt und ein neuer
  Samen startet.
- Die Klassen werden in einem **Ranking** nach Fokus-Minuten verglichen.
- **Alle Wälder erkunden** (Fokus-Wald → oben rechts): alle Klassenwälder
  nebeneinander in einer Landschaft, jeweils mit Schild über dem Wald. Die
  größten, am längsten erarbeiteten Bäume stehen hinten in der Mitte, die
  schnell gewachsenen vorne am Rand. Seitlich wischen oder mit der Maus
  ziehen, um durch die Wälder zu gehen; ein angetippter Baum zeigt seinen
  Steckbrief. Darunter steht das **Baum-Lexikon** mit allen Arten.
- Pro Klasse lässt sich eine **Belohnung** festlegen, z. B. „bei 20 Bäumen:
  Musik in der Stillarbeit“.
- Beim Erklären auf **Pause** tippen (oder Leertaste), damit die eigene
  Stimme nicht mitzählt. Die Empfindlichkeit lässt sich im *Probelauf ohne
  Klasse* einstellen.

Das Mikrofon misst nur die Lautstärke direkt im Browser – es wird nichts
aufgenommen, gespeichert oder übertragen. Gespeichert wird nur der fertige
Baum. Einmalig muss dafür `supabase/migrations/0003_focus.sql` im Supabase
SQL-Editor ausgeführt werden.

---

## Datenschutz & Rechtliches

- **Impressum**, **Datenschutzerklärung** und **Nutzungsbedingungen**
  (inkl. Vereinbarung zur Auftragsverarbeitung nach Art. 28 DSGVO für
  Schulen) liegen als `impressum.html`, `datenschutz.html` und
  `nutzungsbedingungen.html` im Repo und sind im Footer jeder Seite verlinkt.
  Platzhalter wie `{{NAME}}` lassen beide Deploys (GitHub Actions und
  Netlify-`build.sh`) bewusst abbrechen.
- **Offen:** Name, Anschrift, E-Mail und Telefon des Anbieters stehen noch als
  „[wird ergänzt]“ in Impressum, Datenschutzerklärung, Nutzungsbedingungen und
  `docs/verarbeitungsverzeichnis.md`. Die Seite läuft bisher nicht öffentlich
  oder kommerziell; **vor einer öffentlichen Nutzung ausfüllen.** Jeder Deploy
  gibt dazu eine Warnung aus.
- Bei der Registrierung müssen die Nutzungsbedingungen akzeptiert werden;
  Fassung und Zeitpunkt landen in den `user_metadata` des Kontos.
- Unter **Einstellungen → Konto & Daten** lassen sich alle Daten als JSON
  exportieren und das Konto samt aller Daten löschen. Für die Löschung muss
  einmalig `supabase/migrations/0006_delete_account.sql` im Supabase
  SQL-Editor ausgeführt werden.
- Beim Seitenaufruf werden keine fremden Server kontaktiert: Schrift
  (`fonts/`) und Supabase-Bibliothek (`vendor/`) liegen im Repo. hCaptcha
  wird nur geladen, wenn `HCAPTCHA_SITE_KEY` gesetzt ist – dann vorher in
  `datenschutz.html` ergänzen.
- **Sicherheit:** Jede Seite hat eine Content-Security-Policy (`<meta>` im
  Kopf): Skripte nur von hier, Verbindungen nur zu Supabase. Inline-Skripte
  sind deshalb tabu, neue Skripte als eigene Datei einbinden. Netlify
  liefert zusätzlich die Header aus `_headers`; in einem fremden Frame
  startet die App nicht (Schutz vor Clickjacking).
- Das interne Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)
  liegt in `docs/verarbeitungsverzeichnis.md`. Bei neuen Funktionen, die
  Daten speichern, diese Datei und `datenschutz.html` mitpflegen.


Erweitertungen:

Yt video geben -> Fragebogen/Quiz daraus erstellen
