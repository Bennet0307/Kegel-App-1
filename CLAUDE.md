# Kegelclub-App – Projektkontext für Claude Code

Dieses Dokument beschreibt Zweck, Architektur, Entscheidungen und den
aktuellen Stand des Projekts. Claude Code soll diesen Kontext bei
jeder Session berücksichtigen.

## Projektstruktur

Das eigentliche Expo-Projekt liegt in [kegelclub-app/](kegelclub-app),
nicht im Repo-Root. Der Root enthält zusätzlich die versionierten
Supabase-Migrationen (`supabase/`). App-Code liegt unter
`kegelclub-app/src/` (Alias `@/*` in `tsconfig.json`).

## Projektziel

Eine App, mit der Kegelclubs/Kegelvereine ihren Verein verwalten können:
Mitgliederverwaltung, Kegelabend-Erfassung mit automatischer Kegelkasse,
Terminplanung, Statistiken/Ranglisten, Turnier-/Saisonverwaltung, Ankündigungen.

Zielplattformen: **Mobile (iOS/Android) und Web**, eine gemeinsame Codebase.

## Tech-Stack (Entscheidung)

- **Frontend:** React Native mit **Expo** (Managed Workflow), TypeScript.
  - Grund: Entwickler ist erfahren in JS/TS, nicht in Dart/Flutter.
  - Web-Abdeckung über `react-native-web` (`npm run web` /
    `expo start --web`) für das eingeloggte Vereins-Dashboard – nicht
    für eine SEO-relevante öffentliche Marketing-Seite gedacht (die
    würde separat laufen). `app.json` setzt `web.output: "static"`,
    d.h. Expo Router rendert Seiten auch im Dev-Betrieb serverseitig
    vor – Client-only-Code (z.B. `window`/`localStorage`) darf daher
    nicht unconditional auf Modulebene ausgeführt werden, siehe
    `lib/supabase.ts` unten.
  - Routing: **Expo Router** (dateibasiert, `src/app/`). Tabs liegen
    in der Gruppe `src/app/(tabs)/` (Home, Explore); das Root-Layout
    `src/app/_layout.tsx` ist ein `Stack` mit der `(tabs)`-Gruppe
    sowie `login`, `create-club`, `join-club`, `events`,
    `create-event`, `enter-score` und `kasse` als eigenen Screens.
    Nach Login/Signup prüft
    `login.tsx` per `getCurrentMember()` (`lib/member.ts`), ob der
    User schon Mitglied irgendeines Clubs ist, und leitet dann direkt
    zu `/events` weiter statt zu `/create-club`.
  - State-Management: leichtgewichtig halten (z.B. Zustand für Client-State,
    TanStack Query für Server-State/Caching der Supabase-Queries) –
    kein Redux-Overhead für dieses Projektformat.
  - Builds/Releases: **EAS Build** (Cloud-Build, kein lokales
    Xcode/Android-Studio-Setup nötig für Releases).
  - Push: `expo-notifications` (Abstraktion über FCM/APNs).
  - Env-Variablen: `EXPO_PUBLIC_`-Präfix nötig, damit Werte im Client
    verfügbar sind. Die `.env` muss in `kegelclub-app/` liegen (Expo
    lädt sie nur aus dem eigenen Projekt-Root, nicht aus dem Repo-Root)
    – siehe `kegelclub-app/env.example`.

- **Backend:** **Supabase** (PostgreSQL, Auth, Realtime, Storage, Edge
  Functions), Region **Frankfurt (EU)** für die Cloud-Instanz.
  - Grund: relationales Datenmodell passt zu Mitgliedern/Beiträgen/
    Ergebnissen; kein eigener Server-Code nötig; Open Source →
    kein Lock-in, jederzeit migrierbar (z.B. auf self-hosted Supabase
    auf Hetzner, falls DSGVO-Anforderungen das später nötig machen).
  - **Automatische Kegelkasse:** die RPC `record_game_scores` erfasst
    Ergebnisse (`game`/`score`) und bucht dabei automatisch pro
    Mitglied mit Score eine `transaction` vom Typ `'einzahlung'`
    (`club.kegelgeld_cents`, Default 2,00 €) – ein Vorgang, kein
    zweiter manueller Schritt. Bei den beiden Hausnummer-Spielen
    (siehe unten) kommt zusätzlich automatisch eine gestaffelte
    `'strafe'`-Buchung nach Platzierung dazu. Kontostände (`kasse.tsx`) werden
    client-seitig aus den `transaction`-Zeilen aufsummiert, nicht über
    eine DB-View: eine View würde (wie die security-definer Helper)
    automatisch RLS auf `transaction` umgehen und wäre für jeden
    Authenticated-User lesbar – das ist bei einer Hilfsfunktion für
    interne Policy-Checks gewollt, bei einer direkt abfragbaren View
    aber ein Datenleck (jedes Mitglied könnte alle Kontostände aller
    Clubs sehen). Deshalb bewusst kein `create view` hier.
  - Client: `@supabase/supabase-js`, mit
    `@react-native-async-storage/async-storage` als Storage-Adapter für
    Session-Persistenz in RN (Setup in `kegelclub-app/src/lib/supabase.ts`).
    Auf Web wird bewusst **kein** AsyncStorage übergeben (`Platform.OS
    === 'web' ? undefined : AsyncStorage`), sondern der Default-Storage
    von supabase-js verwendet – AsyncStorages Web-Implementierung greift
    beim Static-Rendering sofort auf `window` zu und crasht sonst den
    Dev-Server (`ReferenceError: window is not defined`).
  - **Row Level Security (RLS)** von Anfang an aktiv – "default deny",
    dann explizite Policies. Multi-Tenancy über `club_id` in jeder
    relevanten Tabelle.
  - Rollen (in der `member`-Tabelle, nicht nur im JWT):
    `admin`, `kassierer`, `mitglied`, `gast`.
  - Beitritt zu einem Club über **Einladungscode-Flow** (`invite_code`
    auf `club`, wird beim Anlegen automatisch generiert). Weitere
    Mitglieder treten über die RPC-Funktion `join_club_by_invite_code`
    bei (Migration `join_club_by_invite_code`) – bewusst als
    security-definer RPC statt als RLS-Policy, weil der Invite-Code
    keine Spalte der `member`-Zeile ist und RLS ihn daher nicht direkt
    prüfen kann. Die Funktion löst den Code zur `club_id` auf, prüft
    auf Doppel-Mitgliedschaft und trägt danach mit Rolle `'mitglied'`
    ein.
  - **Wichtig bei RLS-Policies auf `member`:** Policies auf einer
    Tabelle dürfen sich niemals direkt (per Subquery) selbst
    referenzieren – das erzeugt `infinite recursion detected in
    policy for relation "member"`, sobald die Policy tatsächlich
    ausgewertet wird. Stattdessen immer über eine `security definer
    stable`-Hilfsfunktion gehen (`auth_club_ids()`,
    `auth_admin_club_ids()`, `club_member_count()`), die als
    Tabellenbesitzer läuft und damit RLS auf `member` umgeht. Drei
    Migrationen (`fix_member_write_admin_recursion`,
    `fix_member_insert_first_admin_recursion`) beheben genau das für
    die ursprünglichen Policies – bei neuen Policies auf `member`
    von Anfang an diese Helper verwenden.

- **Lokale Entwicklung:** Supabase CLI lokal via Docker
  (`supabase init` / `supabase start`), Migrationen als SQL-Dateien
  versioniert (`supabase migration new ...`, `supabase migration up`
  für neue Migrationen ohne Datenverlust, `supabase db reset` für
  einen kompletten Neuaufbau). Später identischer Client-Code gegen
  Cloud-/self-hosted Projekt, nur URL/Keys wechseln. Lokale
  Zugangsdaten kommen aus `supabase status` (im Repo-Root ausführen,
  dort liegt `supabase/`).
  - Voraussetzung auf Windows: Docker Desktop mit aktivierter
    Virtualisierung (BIOS/Firmware) und funktionierendem WSL2-Backend
    (`wsl --status` sollte fehlerfrei laufen).

- **Offline-Strategie (später):** lokale SQLite-Lösung für RN
  (z.B. WatermelonDB oder op-sqlite) mit einfacher Sync-Queue
  (Last-Write-Wins reicht zunächst); bei Bedarf später PowerSync
  (hat React-Native-SDK, arbeitet mit Supabase/Postgres).

## Datenbank-Migrationen (Stand)

Liegen in `supabase/migrations/`, chronologisch:

1. **`init_schema`** – legt `club`, `member`, `event` an, aktiviert RLS,
   Hilfsfunktion `auth_club_ids()` (security definer, um rekursive
   Policy-Prüfungen auf `member` zu vermeiden), Policies für Select
   (alle Mitglieder desselben Clubs) und Write (nur Admins bzw.
   Admins/Kassierer bei `event`).
2. **`bootstrap_policies`** – löst das Henne-Ei-Problem: erlaubt jedem
   eingeloggten User, einen neuen Club anzulegen (`club_insert_authenticated`),
   und sich selbst als **ersten** Admin einzutragen, wenn der Club noch
   keine Mitglieder hat (`member_insert_self_as_first_admin`). Weitere
   Mitglieder müssen von einem bestehenden Admin über die
   `member_write_admin`-Policy hinzugefügt werden.
3. **`bootstrap_club_select`** – weiteres Henne-Ei-Problem: direkt nach
   dem Anlegen eines Clubs fragt der Client die neue Zeile per
   `INSERT ... RETURNING` ab; dafür prüft Postgres die SELECT-Policy,
   aber der anlegende User ist zu diesem Zeitpunkt noch kein Mitglied.
   Löst das analog zum Member-Bootstrap: ein Club ohne Mitglieder ist
   für jeden eingeloggten User sichtbar (`club_select_unclaimed`).
4. **`fix_member_write_admin_recursion`** – `member_write_admin` und
   `club_update_admin` fragten `member` bisher direkt ab statt über
   `auth_club_ids()`; das erzeugte `infinite recursion detected in
   policy for relation "member"`, sobald die Policy tatsächlich
   ausgewertet wurde. Fügt `auth_admin_club_ids()` hinzu und schreibt
   beide Policies darüber um.
5. **`fix_member_insert_first_admin_recursion`** – derselbe
   Rekursionsfehler in `member_insert_self_as_first_admin` (direkte
   Subquery auf `member` im `WITH CHECK`). Fügt `club_member_count()`
   hinzu und schreibt die Policy darüber um.
6. **`join_club_by_invite_code`** – Beitritts-Flow für weitere
   Mitglieder: security-definer RPC-Funktion, die einen Invite-Code
   zur `club_id` auflöst, Doppel-Mitgliedschaft ausschließt und den
   aufrufenden User als `'mitglied'` einträgt (Details siehe oben).
7. **`attendance`** – legt `attendance` an (Zu-/Absage pro Event und
   Mitglied, `status` ∈ `offen`/`zugesagt`/`abgesagt`, unique auf
   `(event_id, member_id)`). Sichtbar für alle Mitglieder desselben
   Clubs (`attendance_select_same_club`, über `auth_club_ids()` via
   `event`); jedes Mitglied darf nur seine eigene Zu-/Absage schreiben
   (`attendance_write_own`, über die neue Hilfsfunktion
   `auth_member_ids()` – analog zu `auth_club_ids()`, um RLS-Rekursion
   auf `member` zu vermeiden, siehe oben).
8. **`game_and_score`** – legt `game` (ein Spiel pro Kegelabend) und
   `score` (Kegel-Ergebnis pro Mitglied und Spiel, unique auf
   `(game_id, member_id)`) an. Sichtbar für alle Mitglieder desselben
   Clubs; schreibbar nur für Admin/Kassierer über die neue
   Hilfsfunktion `auth_staff_club_ids()` (admin **oder** kassierer,
   analog zu `auth_admin_club_ids()`). Ursprünglich mit den
   Platzhalter-Spieltypen `punktekegeln`/`bundeskegeln` (siehe
   Migration 10, ersetzt).
9. **`kegelkasse`** – legt `transaction` an (Kassenbuch: `einzahlung`/
   `ausgabe`/`strafe`/`gutschrift`, `amount_cents`, optional `event_id`/
   `game_id`) sowie die Spalte `club.kegelgeld_cents` (Default 200 =
   2,00 €). Jedes Mitglied sieht nur seine eigenen Buchungen
   (`transaction_select_own`, über `auth_member_ids()`), Admin/
   Kassierer sehen alle Buchungen ihres Clubs
   (`transaction_select_staff`); Schreiben nur für Admin/Kassierer.
   Fügt die security-definer RPC `record_game_scores(p_event_id,
   p_type, p_scores)` hinzu: legt ein `game` an, speichert die
   übergebenen Scores und bucht pro Mitglied mit Score automatisch
   das Kegelgeld als `'einzahlung'` (idempotent über einen partiellen
   Unique-Index auf `(game_id, member_id) WHERE game_id IS NOT NULL`).
10. **`hausnummer`** – ersetzt die funktionslosen Platzhalter-Spieltypen
    durch zwei echte Spiele: `kleine_hausnummer`/`grosse_hausnummer`
    (3 Würfe à 0–9, zu einer 3-stelligen Zahl angeordnet – die
    Anordnung passiert am Tisch selbst, die App erfasst nur das
    fertige Ergebnis in `score.pins`, 0–999). Die alte
    `game_type_check`-Constraint wird mit `NOT VALID` ersetzt, damit
    bereits vorhandene Alt-Zeilen (falls welche existieren) nicht
    validiert werden müssen und die Migration nicht daran scheitert.
    Neu: `club.hausnummer_penalty_schedule_cents integer[]` (Default
    `{50,30,20,10}`) als Standard-Strafstaffel, Index 1 = Verlierer
    (höchste bzw. niedrigste Hausnummer, je nach Spielart), absteigend
    – Ränge ohne Eintrag zahlen nichts. `game.penalty_schedule_cents`
    speichert die tatsächlich verwendete Staffel als Snapshot.
    `record_game_scores` bekommt einen vierten, optionalen Parameter
    `p_penalty_schedule_cents` zum Überschreiben pro Termin/Aufruf;
    ohne Override gilt der Club-Standard. Rang wird per `rank()` über
    `pins` ermittelt (Ties = gleicher Rang = gleiche Strafe), Richtung
    je nach Spielart umgedreht. Da pro Spiel jetzt zwei Buchungstypen
    pro Mitglied möglich sind (Kegelgeld **und** Strafe), wurde der
    Idempotenz-Unique-Index von `(game_id, member_id)` auf
    `(game_id, member_id, type)` erweitert.

## Kern-Datenmodell (Ausgangspunkt, teils noch nicht als Migration umgesetzt)

- `club` – Mandant/Verein (id, name, invite_code, created_at) ✅ umgesetzt
- `member` – Mitglied (id, club_id, user_id→auth.users, display_name,
  role, joined_at) ✅ umgesetzt
- `event` – Termin (id, club_id, type, title, starts_at, location, status) ✅ umgesetzt
- `guest` – Gastkegler ohne Konto — noch offen
- `attendance` – Zu-/Absage pro Event und Mitglied (id, event_id,
  member_id, status, responded_at) ✅ umgesetzt. Echte "war wirklich
  da"-Anwesenheitserfassung (Check-in am Kegelabend selbst, unabhängig
  von der Zusage) ist bewusst noch nicht Teil dieser Tabelle — noch
  offen, siehe unten.
- `game` – ein gespieltes Spiel pro Event (id, club_id, event_id,
  type, penalty_schedule_cents) ✅ umgesetzt. Genau zwei Spieltypen:
  `kleine_hausnummer`/`grosse_hausnummer` (3 Würfe zu einer 3-stelligen
  Zahl, Sieger = größte bzw. kleinste Zahl). Weitere Spieltypen mit
  eigener Regel-Engine sind bewusst noch nicht gebaut (siehe "Offene
  Punkte").
- `score` – Ergebnis pro Mitglied und Spiel (id, club_id, game_id,
  member_id, pins) ✅ umgesetzt. Bei den Hausnummer-Spielen steht hier
  die fertige 3-stellige Zahl (0–999), nicht die einzelnen Würfe.
- `penalty_rule` / `penalty` – als eigene, konfigurierbare Tabellen
  weiterhin — noch offen (siehe "Offene Punkte": Freier Strafenkatalog
  pro Club). Die Hausnummer-Strafstaffel
  (`club.hausnummer_penalty_schedule_cents`, pro Aufruf über
  `record_game_scores` überschreibbar) deckt den aktuellen Bedarf für
  die zwei Hausnummer-Spiele bereits ab, ohne eine generische
  Regel-Engine zu brauchen. Sonstige manuelle Ad-hoc-Buchungen laufen
  direkt über `transaction`.
- `transaction` – Kassenbuch (id, club_id, member_id, event_id, game_id,
  type, amount_cents, note) ✅ umgesetzt. Automatische Buchung von
  Kegelgeld über `record_game_scores`; manuelle Buchungen (Bareinzahlung,
  Ausgabe, Ad-hoc-Strafe) sind über die `transaction_write_staff`-Policy
  möglich, aber noch ohne eigenen Screen (bisher nur die automatische
  Kegelgeld-Buchung hat eine UI).
- `fee`/`invoice` – Beiträge/Rechnungen inkl. SEPA-Status — noch offen
- `team` / `team_member` – Mannschaften — noch offen
- `announcement` – Ankündigungen — noch offen

Statistiken/Ranglisten werden als Postgres Views bzw. Funktionen über
`score`, `penalty`, `attendance` berechnet, nicht clientseitig.

## App-Code (Stand: erster vertikaler Durchstich)

- `kegelclub-app/src/lib/supabase.ts` – Supabase-Client mit
  AsyncStorage-Adapter (nur native, siehe Hinweis oben zu Web/SSR).
- `kegelclub-app/src/app/login.tsx` – Registrierung/Login per E-Mail/Passwort
  (`supabase.auth.signUp` / `signInWithPassword`), leitet nach Erfolg
  zu `/create-club` weiter.
- `kegelclub-app/src/app/create-club.tsx` – legt einen Club an (`insert` in `club`) und
  trägt den eingeloggten User direkt danach als ersten Admin in
  `member` ein; zeigt anschließend Club-ID und Einladungscode an.
  Verlinkt auf `/join-club` für User mit vorhandenem Einladungscode.
- `kegelclub-app/src/app/join-club.tsx` – nimmt einen Einladungscode
  entgegen, ruft die RPC `join_club_by_invite_code` auf und zeigt den
  Club-Namen bei Erfolg an. Verlinkt zurück auf `/create-club`.
- `kegelclub-app/src/app/events.tsx` – listet die Kegelabende des
  eigenen Clubs (`getCurrentMember()` → `club_id`), zeigt pro Event
  die eigene Zu-/Absage und erlaubt sie per Tap zu ändern (Upsert auf
  `attendance`, `onConflict: 'event_id,member_id'`). Admins/Kassierer
  sehen zusätzlich einen Link zu `/create-event`. Erfasste Ergebnisse
  werden pro `game` angezeigt; bei den Hausnummer-Typen mit
  führenden Nullen auf 3 Stellen formatiert (`formatScore()`).
- `kegelclub-app/src/app/create-event.tsx` – legt einen Kegelabend
  (`event`, `type: 'kegelabend'`) für den eigenen Club an; Datum/
  Uhrzeit aktuell als zwei Text-Felder (`JJJJ-MM-TT` / `HH:MM`), kein
  Date-Picker-Package eingebunden.
- `kegelclub-app/src/app/enter-score.tsx` – Admin/Kassierer wählen
  Kleine/Große Hausnummer und tragen pro Mitglied drei Ziffern
  (Hunderter/Zehner/Einer) ein, die zur 3-stelligen Hausnummer
  zusammengerechnet werden (leere Mitglieder werden nicht
  mitgeschickt); zusätzlich ein optionales Freitext-Feld, um die
  Strafstaffel für diesen einen Aufruf zu überschreiben (Beträge in
  €, kommagetrennt, sonst gilt `club.hausnummer_penalty_schedule_cents`
  – wird zur Orientierung als Hinweistext angezeigt). Ruft die RPC
  `record_game_scores` auf (Event-ID kommt als Router-Param von
  `events.tsx`). Legt bei jedem Speichern ein **neues** `game` an –
  bestehende Ergebnisse eines Events lassen sich damit noch nicht
  nachträglich bearbeiten, nur ergänzen.
- `kegelclub-app/src/app/kasse.tsx` – Admin/Kassierer sehen die
  Kontostände aller Mitglieder (aus `transaction` client-seitig
  aufsummiert), reguläre Mitglieder sehen nur ihren eigenen
  Kontostand + eigene Buchungshistorie (RLS-Trennung, siehe
  `transaction_select_own`/`_staff`).
- `kegelclub-app/src/lib/member.ts` – `getCurrentMember()`: liest die
  `member`-Zeile des eingeloggten Users (id, club_id, role,
  display_name). Nimmt aktuell die erste gefundene Zeile – Mitglieder
  in mehreren Clubs (Schema erlaubt das) werden noch nicht
  unterstützt, es gibt keine Club-Auswahl/-Switching-UI.
- `kegelclub-app/src/app/(tabs)/` – ursprüngliches Expo-Router-Tabs-Template
  (Home/Explore), unverändert bis auf den Umzug in die `(tabs)`-Gruppe.

Damit sind die Pfade Auth → Club anlegen → RLS-geschütztes Schreiben,
Auth → Club per Einladungscode beitreten, Kegelabend anlegen →
Zu-/Absage sowie Ergebnisse erfassen → automatische Kegelgeld-Buchung
je einmal end-to-end verdrahtet und im Browser mit mehreren
Test-Accounts (inkl. RLS-Sichtbarkeitsprüfung zwischen Admin und
regulärem Mitglied) gegen die lokale Supabase-Instanz getestet.

## DSGVO-Hinweise (gilt für die gesamte Entwicklung)

- Mitgliederdaten sind personenbezogene Daten – Verarbeitung zur
  Mitgliederverwaltung ist über Art. 6 Abs. 1 lit. b DSGVO gedeckt.
- Für jeden Dienstleister mit Datenzugriff (Supabase, Push-Anbieter,
  Hoster) muss ein **AVV (Art. 28 DSGVO)** vorliegen.
- Datenminimierung: nur notwendige Felder erheben.
- Zugriffsbeschränkung nach Rolle deckt sich mit dem RLS-Rollenmodell
  ("Kenntnis nur soweit erforderlich").
- Falls DSGVO-Bedenken (z.B. CLOUD-Act-Restrisiko bei Supabase/AWS)
  später relevant werden: Migrationspfad zu self-hosted Supabase auf
  Hetzner (rein deutsche Infrastruktur) ist eingeplant.
- Diese Hinweise sind allgemeine Orientierung, keine Rechtsberatung.

## Entwicklungs-Roadmap (grob)

1. **Phase 0 – Fundament:** ✅ Supabase-Projekt + erste Migrationen
   versioniert, RLS von Anfang an, Expo-Projekt mit Supabase-Client
   verbunden, erster vertikaler Durchstich (Auth + Club anlegen) steht.
2. **Phase 1 – MVP:** ✅ Einladungscode-Beitritt für weitere Mitglieder,
   ✅ Kegelabend anlegen + Zu-/Absage, ✅ Ergebniserfassung (2
   Spieltypen: Kleine/Große Hausnummer) + automatische Kegelkasse
   (Kegelgeld pro Teilnahme + nach Platzierung gestaffelte
   Hausnummer-Strafe, Kontostände nach Rolle getrennt sichtbar).
   Damit ist der MVP-Umfang aus dem ursprünglichen Plan erreicht.
3. **Phase 2 – Ausbau:** weitere Spieltypen + konfigurierbare
   Strafregeln, Statistiken/Ranglisten, Terminplanung mit Push
   (inkl. Regeltermine/Serien, siehe "Offene Punkte"),
   Live-Tafelmodus (Realtime).
4. **Phase 3 – Finanzen & Turniere:** SEPA-XML-Export (Edge Function),
   Beitrags-/Rechnungswesen, Mannschaften/Turniere, Offline-Sync
   ausbauen, App-Store-Release.

## Konventionen / Arbeitsweise

- Sprache im Code: Englisch (Variablen-/Funktionsnamen), Kommentare
  und Doku können Deutsch sein.
- Neue DB-Änderungen immer als Migration, nie manuell in der
  Cloud-Instanz.
- RLS-Policy für jede neue Tabelle direkt mitliefern, nicht
  nachträglich ergänzen. Bei Bootstrap-Problemen (erster Datensatz
  ohne bestehende Berechtigung) analog zu `bootstrap_policies` lösen.
  Bei Policies auf `member` immer über die security-definer Helper
  gehen (siehe oben), nie direkt auf `member` selbst subqueryen.
- Bevorzugt "vertikale Durchstiche" bauen (eine Funktion komplett
  End-to-End), statt breit an vielen Features gleichzeitig zu arbeiten.

## Offene Punkte / noch nicht entschieden

- **Regeltermine / Serien-Kegelabende** (Idee, noch nicht umgesetzt):
  Wiederkehrende Termine konfigurierbar machen, z.B. "monatlich, erster
  Freitag im Monat". Zusätzlich sollen einzelne Termine der Serie
  nachträglich verschoben oder abgesagt werden können, ohne die
  restliche Serie zu beeinflussen (Ausnahmen/Exceptions pro Termin,
  ähnlich wiederkehrenden Terminen in Kalender-Apps: eine
  Wiederholungsregel + pro `event` optional ein Verweis auf die
  erzeugende Serie und ein "abweicht von Serie"-Flag). Betrifft
  `event` (siehe Kern-Datenmodell) und die Screens `events.tsx` /
  `create-event.tsx`. Gehört in Phase 2 (Terminplanung), siehe Roadmap.
- **Einchecken / Ankunftszeit erfassen** (Idee, noch nicht umgesetzt):
  Zusätzlich zur Zu-/Absage (bereits in `attendance` umgesetzt) die
  tatsächliche Ankunftszeit am Kegelabend festhalten – entweder
  Self-Check-in durch das Mitglied selbst oder gesteuert durch den
  Admin/Kassierer. Das ist genau die "echte Anwesenheitserfassung",
  die beim `attendance`-Eintrag im Kern-Datenmodell schon als noch
  offen vermerkt ist (vermutlich ein `checked_in_at timestamptz` auf
  `attendance`, getrennt von `status`, damit Zusage/Absage und
  tatsächliches Erscheinen unabhängig bleiben). Darauf aufbauend:
  automatische Verspätungsstrafe über die geplanten `penalty_rule`/
  `penalty`-Tabellen (z.B. 0,10 €/Minute nach `event.starts_at`), die
  dann als `transaction` in die Kegelkasse einfließt. Gehört fachlich
  zu Phase 1/2 (Kegelkasse) bzw. Phase 3 (Strafregeln), siehe Roadmap.
- **Freier Strafenkatalog pro Club** (Idee, noch nicht umgesetzt): ein
  Club soll seinen eigenen Katalog an Straf**arten** pflegen können
  (z.B. "Pumpe", "Klingen"), jeweils mit Name + Strafbetrag – das ist
  genau die schon vermerkte `penalty_rule`-Tabelle (club_id, name,
  amount_cents), aber jetzt mit konkretem UI-Bedarf: eine Verwaltungs-
  seite für Admin/Kassierer, um Strafarten anzulegen/zu ändern.
  Zusätzlich: an einem Kegelabend soll pro Mitglied hochgezählt werden
  können, wie oft welche Strafart fällig wurde (nicht nur ja/nein,
  sondern eine Stückzahl) – d.h. `penalty` bräuchte mindestens
  `event_id`, `member_id`, `penalty_rule_id`, `count`. Beim Speichern
  entsteht daraus automatisch `count * amount_cents` als `'strafe'`-
  `transaction`, analog zum bestehenden Muster in `record_game_scores`
  (Kegelgeld/Hausnummer-Strafe). Sollte Name/Betrag der Regel zum
  Buchungszeitpunkt in die `transaction`/`penalty`-Zeile mitkopiert
  werden (Snapshot), damit spätere Änderungen am Katalog alte
  Buchungen nicht nachträglich verändern? Noch offen.
  Zusätzliche Idee für `penalty_rule`: eine Markierung, ob es zu
  dieser Strafart einen "Abend-Verlierer"-Zuschlag gibt (z.B.
  `has_king_surcharge boolean` + `king_surcharge_cents`) – wer an
  diesem Kegelabend die meisten Buchungen dieser einen Strafart hat
  (z.B. die meisten "Pumpe"), zahlt am Ende zusätzlich Betrag X
  obendrauf (z.B. als "Pumpenkönig"). Auswertung passiert also erst
  nach Ende des Abends über alle `penalty`-Zeilen dieses `event_id` +
  `penalty_rule_id`, nicht pro Buchung – vermutlich ein eigener
  "Abend abschließen"-Schritt statt automatisch bei jeder Buchung.
  Offene Frage: Gleichstand bei den meisten Buchungen (mehrere
  potenzielle Könige) – alle zahlen? Keiner zahlt? Noch offen. Betrifft
  `enter-score.tsx` (naheliegender Ort, um Strafen direkt neben den
  Ergebnissen des Abends zu erfassen) und einen neuen Screen für die
  Katalog-Verwaltung. Gehört fachlich zu Phase 1/2 (Kegelkasse) bzw.
  Phase 3 (Strafregeln), siehe Roadmap.
- **Ergebnisse nachträglich bearbeiten:** `record_game_scores` legt bei
  jedem Aufruf ein neues `game` an; es gibt noch keine Möglichkeit,
  ein bereits erfasstes Ergebnis zu korrigieren oder ein `game` zu
  löschen (inkl. der zugehörigen automatischen Kegelgeld-Buchung).
- **Manuelle Kegelkasse-Buchungen:** `transaction_write_staff`
  erlaubt Admin/Kassierer bereits beliebige Buchungen (Bareinzahlung,
  Ausgabe, Ad-hoc-Strafe), aber `kasse.tsx` hat noch kein Formular
  dafür – bisher nur Lesen + die automatische Kegelgeld-Buchung.
- Konkrete Spielregeln/Strafregeln-Konfiguration für **weitere**
  Spieltypen über Kleine/Große Hausnummer hinaus (wie flexibel muss
  die Regel-Engine sein?) – für die zwei aktuellen Spiele reicht die
  feste Hausnummer-Logik + frei konfigurierbare Strafstaffel.
- SEPA-Lastschrift-Anbindung im Detail (Gläubiger-ID, Mandatsverwaltung)
- Ob/wann self-hosted Supabase (Hetzner) statt Managed Supabase nötig wird
- Separate öffentliche Marketing-/Landingpage (Format noch offen)
