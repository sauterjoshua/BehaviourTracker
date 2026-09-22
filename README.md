# BehaviourTracker

Kanban-Board für Unterrichtsverhalten: Schülerinnen und Schüler wandern während
des Unterrichts zwischen drei Spalten, und die App misst, wie lange jede Person
in welcher Spalte war.

Statische Web-App (Vanilla JS, keine Build-Kette) auf GitHub Pages mit
Supabase (Postgres + Auth) als Backend.

---

## Funktionsumfang

**Menü nach dem Login**

- **Klassen** – Klassen anlegen, Schülerinnen und Schüler verwalten, Zeiten auswerten
- **Unterrichte** – bisherige Unterrichte öffnen (letzter Board-Stand) oder neuen starten

**Unterrichts-Ansicht (Board)**

| Spalte | Schlüssel | Farbe |
| --- | --- | --- |
| Da geht mehr | `links` | grau |
| Du arbeitest gut | `mitte` | hellgrün (geringe Deckkraft) |
| Du arbeitest großartig | `rechts` | dunkelgrün |

- Alle Schüler starten in `links`.
- Verschieben per **Drag & Drop** oder über die **Pfeil-Buttons** auf jeder Karte
  (Buttons funktionieren auch auf Tablets, wo HTML5-Drag-&-Drop nicht greift).
- Nur **direkt benachbarte** Spalten sind erlaubt (`links ↔ mitte ↔ rechts`).
  Das wird im Frontend *und* in der Datenbankfunktion `move_student` geprüft.
- Verschobene Karten landen **unten** in der Zielspalte (`position = max + 1`).
- Jeder Wechsel schließt den laufenden `column_time_logs`-Eintrag (`ended_at = now()`)
  und öffnet einen neuen. Auf der Karte läuft die Zeit in der aktuellen Spalte mit.

**Klassen-Ansicht**

- Schülerliste der Klasse
- Klick auf einen Namen zeigt die Summe pro Spalte, den prozentualen Anteil
  und eine Aufschlüsselung je Unterricht.

---

## Setup

### 1. Supabase-Projekt anlegen

1. Projekt auf [supabase.com](https://supabase.com) erstellen.
2. Im **SQL Editor** den Inhalt von
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql)
   ausführen. Das Skript legt an:
   - alle Tabellen inkl. Constraints und Indizes,
   - Row-Level-Security-Policies für jede Tabelle,
   - einen Trigger, der nach dem Signup automatisch eine Zeile in `teachers` anlegt,
   - die RPC-Funktionen `start_lesson`, `move_student`, `end_lesson`, `reopen_lesson`,
   - die Auswertungs-View `student_lesson_column_seconds`.

   Alternativ mit der Supabase-CLI:

   ```bash
   supabase link --project-ref <dein-project-ref>
   supabase db push
   ```

3. Unter **Project Settings → API** die *Project URL* und den
   *anon / publishable key* kopieren.

### 2. Auth konfigurieren

Unter **Authentication → Providers → Email**:

- E-Mail-Bestätigung aktiv lassen (empfohlen).
- Optional: **Authentication → Sign In / Providers → Email → Allow new users to sign up**
  abschalten, sobald alle Lehrkräfte ein Konto haben. Das ist der wirksamste
  Signup-Schutz für eine kleine Nutzergruppe.

**Captcha (hCaptcha):**

1. Bei [hCaptcha](https://www.hcaptcha.com/) eine Site registrieren → *Sitekey* und *Secret*.
2. In Supabase unter **Authentication → Settings → Bot and Abuse Protection**
   „Enable Captcha protection“ aktivieren, Provider `hCaptcha`, *Secret* eintragen.
3. Den *Sitekey* in `config.js` als `HCAPTCHA_SITE_KEY` hinterlegen.

Bleibt `HCAPTCHA_SITE_KEY` leer, zeigt die App kein Captcha an. Ist in Supabase
Captcha aktiv, der Sitekey aber nicht gesetzt, schlagen Login und Registrierung
serverseitig fehl — beide Schalter müssen zusammenpassen.

### 3. Lokale Konfiguration

```bash
cp config.example.js config.js
# SUPABASE_URL, SUPABASE_ANON_KEY (und ggf. HCAPTCHA_SITE_KEY) eintragen
```

`config.js` und `.env` stehen in `.gitignore` und werden nicht committet.
`.env.example` dokumentiert dieselben Variablen für die GitHub-Actions-Secrets
und für lokale Tools wie die Supabase-CLI.

Lokal testen (ES-Module brauchen HTTP, `file://` reicht nicht):

```bash
python3 -m http.server 5173
# http://localhost:5173 öffnen
```

Für den lokalen Betrieb muss `http://localhost:5173` in Supabase unter
**Authentication → URL Configuration → Redirect URLs** eingetragen sein.

### 4. Deploy auf GitHub Pages

Der Workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
erzeugt `config.js` beim Build aus Repository-Secrets und veröffentlicht das
Repository als Pages-Site.

1. **Settings → Secrets and variables → Actions → New repository secret:**
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `HCAPTCHA_SITE_KEY` (optional)
2. **Settings → Pages → Source:** `GitHub Actions`.
3. Nach `git push` auf `main` läuft der Deploy automatisch.
4. Die Pages-URL (z. B. `https://sauterjoshua.github.io/BehaviourTracker.github.io/`)
   in Supabase unter **Authentication → URL Configuration** als *Site URL* und
   *Redirect URL* eintragen.

---

## Datenmodell

```
teachers ──< classes ──< students
                │           │
                └──< lessons ──< lesson_students >── students
                        │
                        └──< column_time_logs >── students
```

| Tabelle | Zweck |
| --- | --- |
| `teachers` | Lehrkraft, verknüpft über `auth_user_id` mit `auth.users` |
| `classes` | Klasse einer Lehrkraft (`name` je Lehrkraft eindeutig) |
| `students` | Schülerin/Schüler einer Klasse |
| `lessons` | Unterrichtsstunde einer Klasse, `ended_at` markiert beendete Stunden |
| `lesson_students` | aktuelle Spalte und Position je Schüler im Board |
| `column_time_logs` | Zeitspannen: `started_at` / `ended_at` je Spaltenaufenthalt |

**Beim Start eines Unterrichts** (`start_lesson`) wird für jeden Schüler der
Klasse in einer Transaktion ein `lesson_students`-Eintrag (Spalte `links`) und
ein offener `column_time_logs`-Eintrag (`started_at = now()`, `ended_at = NULL`)
angelegt. Der Name entsteht automatisch als `[Klasse] [Datum]`.

**Ein Teilindex** stellt sicher, dass pro Unterricht und Schüler immer nur ein
Zeit-Log offen ist:

```sql
create unique index column_time_logs_one_open_idx
  on column_time_logs (lesson_id, student_id) where ended_at is null;
```

### Hinweis zum Spaltennamen `column`

`COLUMN` ist in PostgreSQL ein **reserviertes Schlüsselwort**. Die Spalte heißt
wie im Konzept vorgesehen `column`, muss in SQL aber überall als `"column"`
gequotet werden. PostgREST/`supabase-js` quoten Bezeichner automatisch; im
Frontend wird das Feld per Alias (`col:column`) gelesen, damit der Code lesbar
bleibt. Wer sich Quoting sparen will, benennt die Spalte in der Migration in
`column_key` um und passt die drei Stellen in `app.js` an.

---

## Sicherheit

**Row Level Security** ist auf allen sechs Tabellen aktiviert. Der Zugriff wird
über die Kette `lesson_id → class_id → teacher_id → auth.uid()` aufgelöst,
gekapselt in den `STABLE SECURITY DEFINER`-Hilfsfunktionen `current_teacher_id()`,
`owns_class()`, `owns_student()` und `owns_lesson()` (jeweils mit gepinntem
`search_path`). Eine Lehrkraft sieht und ändert damit ausschließlich eigene
Klassen, Schüler, Unterrichte und Zeiten.

Die RPC-Funktionen laufen bewusst als `SECURITY INVOKER` — sie sind atomar,
umgehen RLS aber **nicht**.

**Weitere Maßnahmen:**

- **Input-Validierung** doppelt: im Frontend (`cleanName()` entfernt Steuerzeichen,
  normalisiert Whitespace, kürzt auf 80 Zeichen) und in der Datenbank
  (`CHECK (char_length(btrim(name)) between 1 and 80)`).
- **Kein XSS-Risiko durch Nutzerdaten:** Die App setzt Text ausschließlich über
  `textContent`; `innerHTML` wird nirgends mit Daten aus der Datenbank benutzt.
- **Captcha** (hCaptcha) bei Registrierung und Login, siehe Setup-Schritt 2.
- **Keine Secrets im Frontend:** Nur die Projekt-URL und der Anon-/Publishable-Key
  liegen im Browser — beide sind öffentlich und genau dafür gedacht. Der
  `service_role`-Key gehört **niemals** ins Repository oder in `config.js`.

---

## Projektstruktur

```
index.html                          Einstiegspunkt
app.js                              gesamte App-Logik (Router, Views, Datenzugriff)
style.css                           Styles inkl. Dark Mode
config.example.js                   Vorlage für config.js (gitignored)
.env.example                        Vorlage für die Actions-Secrets
.github/workflows/deploy.yml        Pages-Deploy, erzeugt config.js aus Secrets
supabase/migrations/0001_init.sql   Schema, RLS-Policies, RPC-Funktionen, View
```

---

## Bedienung im Unterricht

1. **Klassen** → Klasse anlegen → Schüler eintragen.
2. **Unterrichte** → *Unterricht starten* → Klasse wählen.
   Alle Schüler stehen in „Da geht mehr“, die Zeitmessung läuft.
3. Während der Stunde Karten nach rechts (Lob) oder links verschieben.
4. Am Ende **Unterricht beenden** — das stoppt alle laufenden Zeiten.
   Ohne Beenden laufen die Zeiten weiter und verfälschen die Auswertung.
   Versehentlich beendet? *Fortsetzen* öffnet neue Logs in der aktuellen Spalte.
5. **Klassen** → Schüler antippen zeigt die Auswertung.
