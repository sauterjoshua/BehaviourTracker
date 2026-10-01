# Verzeichnis von Verarbeitungstätigkeiten (Art. 30 DSGVO)

Internes Dokument des Betreibers. Muss nicht veröffentlicht werden, ist aber
der Aufsichtsbehörde auf Anfrage vorzulegen. Bei Änderungen an App, Diensten
oder Datenschutzerklärung mit anpassen.

- **Stand:** 1. Oktober 2026
- **Verantwortlicher / Auftragsverarbeiter:** {{NAME}}, {{STRASSE}}, {{PLZ_ORT}}, {{EMAIL}}
- **Datenschutzbeauftragter:** nicht benannt (keine Pflicht nach Art. 37 DSGVO / § 38 BDSG)

---

## A. Verarbeitungen als Verantwortlicher (Art. 30 Abs. 1)

### A1. Bereitstellung der Website

| | |
| --- | --- |
| Zweck | Auslieferung der Website, Schutz vor Angriffen |
| Rechtsgrundlage | Art. 6 Abs. 1 lit. f DSGVO |
| Betroffene | Besucherinnen und Besucher |
| Daten | IP-Adresse, Zeitpunkt, aufgerufene Datei, Datenmenge, Referrer, Browser/Betriebssystem |
| Empfänger | GitHub, Inc. (GitHub Pages); Netlify, Inc. |
| Drittland | USA – beide unter dem EU-US Data Privacy Framework zertifiziert (Art. 45 DSGVO) |
| Löschung | nach den Fristen der Anbieter; keine eigene Auswertung |

### A2. Benutzerkonten

| | |
| --- | --- |
| Zweck | Registrierung, Anmeldung, E-Mail-Bestätigung, Missbrauchsschutz |
| Rechtsgrundlage | Art. 6 Abs. 1 lit. b DSGVO; Sicherheitsprotokolle: lit. f |
| Betroffene | Lehrkräfte (Nutzerinnen und Nutzer) |
| Daten | E-Mail, Passwort-Hash, Anzeigename, Registrierungs- und Anmeldezeitpunkte, akzeptierte Fassung der Nutzungsbedingungen mit Zeitpunkt, IP/Browser in Auth-Protokollen |
| Empfänger | Supabase Pte. Ltd. (Auftragsverarbeiter, DPA mit SCC) |
| Drittland | Speicherung in der EU; mögliche Zugriffe aus Drittländern über EU-Standardvertragsklauseln (Art. 46 DSGVO) |
| Löschung | sofort bei Kontolöschung (Funktion `delete_own_account`), Backups nach Fristen von Supabase |

### A3. Anfragen per E-Mail

| | |
| --- | --- |
| Zweck | Beantwortung von Anfragen, Betroffenenrechte, Schulen, die die AV-Vereinbarung unterzeichnet anfordern |
| Rechtsgrundlage | Art. 6 Abs. 1 lit. b, c bzw. f DSGVO |
| Betroffene | Anfragende |
| Daten | E-Mail-Adresse, Name, Inhalt der Anfrage |
| Empfänger | eigener E-Mail-Anbieter |
| Löschung | nach Erledigung, soweit keine Aufbewahrungspflicht besteht |

---

## B. Verarbeitungen als Auftragsverarbeiter (Art. 30 Abs. 2)

| | |
| --- | --- |
| Verantwortliche | Schulen, an denen registrierte Lehrkräfte die App einsetzen (Schulen, die die AV-Vereinbarung unterzeichnet angefordert haben, hier eintragen) |
| Kategorien der Verarbeitung | Speichern, Anzeigen, Auswerten und Löschen von Klassen-, Schüler-, Unterrichts- und Fokus-Wald-Daten |
| Betroffene | Schülerinnen und Schüler; Lehrkräfte |
| Daten | Namen/Kürzel, Klassenzugehörigkeit, Sitzplatz, Zustände mit Zeitstempeln, Zeiten, Unterrichtsdaten (inkl. automatischem Endzeitpunkt), Fokus-Wald-Ergebnisse, Belohnungstexte, Stundenplan der Lehrkraft (Stundenzeiten, Zuordnung Klasse–Wochentag–Stunde) |
| Unterauftragsverarbeiter | Supabase Pte. Ltd., Singapur – Rechenzentrum in der EU, DPA mit SCC |
| Drittland | siehe A2 |
| Vertrag | § 5 der Nutzungsbedingungen (`nutzungsbedingungen.html`) |

---

## C. Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

- Datenbank in einem EU-Rechenzentrum (Supabase)
- HTTPS für alle Verbindungen
- Passwörter nur als Hash (Supabase Auth)
- Row Level Security: jedes Konto sieht nur eigene Daten (`supabase/migrations/0001_init.sql`)
- Nur öffentlicher Anon-Key im Frontend, `service_role`-Key nie im Code
- Keine Drittanbieter-Ressourcen beim Seitenaufruf (Schrift und Supabase-Bibliothek lokal unter `fonts/` und `vendor/`)
- Mikrofon: Lautstärke nur lokal im Browser, keine Aufnahme, keine Übertragung
- Zwei-Faktor-Authentifizierung für die Konten bei Supabase, GitHub und Netlify
- Löschfunktion und Datenexport für Nutzerinnen und Nutzer in der App
