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
    sowie `login`, `create-club`, `join-club`, `events` und
    `create-event` als eigenen Screens. Nach Login/Signup prüft
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
- `game`/`session` – ein gespieltes Spiel pro Event — noch offen
- `score`/`throw` – Ergebnis-/Wurferfassung — noch offen
- `penalty_rule` / `penalty` – frei konfigurierbare Strafregeln — noch offen
- `transaction` – Kassenbuch — noch offen
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
  sehen zusätzlich einen Link zu `/create-event`.
- `kegelclub-app/src/app/create-event.tsx` – legt einen Kegelabend
  (`event`, `type: 'kegelabend'`) für den eigenen Club an; Datum/
  Uhrzeit aktuell als zwei Text-Felder (`JJJJ-MM-TT` / `HH:MM`), kein
  Date-Picker-Package eingebunden.
- `kegelclub-app/src/lib/member.ts` – `getCurrentMember()`: liest die
  `member`-Zeile des eingeloggten Users (id, club_id, role,
  display_name). Nimmt aktuell die erste gefundene Zeile – Mitglieder
  in mehreren Clubs (Schema erlaubt das) werden noch nicht
  unterstützt, es gibt keine Club-Auswahl/-Switching-UI.
- `kegelclub-app/src/app/(tabs)/` – ursprüngliches Expo-Router-Tabs-Template
  (Home/Explore), unverändert bis auf den Umzug in die `(tabs)`-Gruppe.

Damit sind die Pfade Auth → Club anlegen → RLS-geschütztes Schreiben,
Auth → Club per Einladungscode beitreten sowie Kegelabend anlegen →
Zu-/Absage je einmal end-to-end verdrahtet und im Browser mit
mehreren Test-Accounts gegen die lokale Supabase-Instanz getestet.

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
   ✅ Kegelabend anlegen + Zu-/Absage. Noch offen: einfache
   Session-Erfassung (1–2 Spieltypen) + automatische Kegelkasse mit
   Salden.
3. **Phase 2 – Ausbau:** weitere Spieltypen + konfigurierbare
   Strafregeln, Statistiken/Ranglisten, Terminplanung mit Push,
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

- Konkrete Spielregeln/Strafregeln-Konfiguration (wie flexibel muss die
  Regel-Engine sein?)
- SEPA-Lastschrift-Anbindung im Detail (Gläubiger-ID, Mandatsverwaltung)
- Ob/wann self-hosted Supabase (Hetzner) statt Managed Supabase nötig wird
- Separate öffentliche Marketing-/Landingpage (Format noch offen)
