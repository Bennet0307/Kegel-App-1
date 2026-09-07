# Kegelclub-App – Projektkontext für Claude Code

Dieses Dokument beschreibt Zweck, Architektur und Entscheidungen des Projekts.
Claude Code soll diesen Kontext bei jeder Session berücksichtigen.

## Projektziel

Eine App, mit der Kegelclubs/Kegelvereine ihren Verein verwalten können:
Mitgliederverwaltung, Kegelabend-Erfassung mit automatischer Kegelkasse,
Terminplanung, Statistiken/Ranglisten, Turnier-/Saisonverwaltung, Ankündigungen.

Zielplattformen: **Mobile (iOS/Android) und Web**, eine gemeinsame Codebase.

## Tech-Stack (Entscheidung)

- **Frontend:** React Native mit **Expo** (Managed Workflow), TypeScript.
  - Grund: Entwickler ist erfahren in JS/TS, nicht in Dart/Flutter.
  - Web-Abdeckung über `react-native-web` (`expo start --web`) für das
    eingeloggte Vereins-Dashboard – nicht für eine SEO-relevante
    öffentliche Marketing-Seite gedacht (die würde separat laufen).
  - Routing: **Expo Router** (dateibasiert, ähnlich Next.js `app/`).
  - State-Management: leichtgewichtig halten (z.B. Zustand für Client-State,
    TanStack Query für Server-State/Caching der Supabase-Queries) –
    kein Redux-Overhead für dieses Projektformat.
  - Builds/Releases: **EAS Build** (Cloud-Build, kein lokales
    Xcode/Android-Studio-Setup nötig für Releases).
  - Push: `expo-notifications` (Abstraktion über FCM/APNs).

- **Backend:** **Supabase** (PostgreSQL, Auth, Realtime, Storage, Edge
  Functions), Region **Frankfurt (EU)**.
  - Grund: relationales Datenmodell passt zu Mitgliedern/Beiträgen/
    Ergebnissen; kein eigener Server-Code nötig; Open Source →
    kein Lock-in, jederzeit migrierbar (z.B. auf self-hosted Supabase
    auf Hetzner, falls DSGVO-Anforderungen das später nötig machen).
  - Client: `@supabase/supabase-js`, mit
    `@react-native-async-storage/async-storage` als Storage-Adapter für
    Session-Persistenz in RN.
  - **Row Level Security (RLS)** von Anfang an aktiv – "default deny",
    dann explizite Policies. Multi-Tenancy über `club_id` in jeder
    relevanten Tabelle.
  - Rollen (`app_metadata` im JWT bzw. `memberships`-Tabelle):
    `admin`/`vorstand`, `kassierer`, `mitglied`, `gast`.
  - Beitritt zu einem Club über **Einladungscode-Flow** (kein offenes
    Self-Signup in bestehende Clubs).

- **Lokale Entwicklung:** Supabase CLI lokal via Docker
  (`supabase init` / `supabase start`), Migrationen als SQL-Dateien
  versioniert (`supabase migration new ...`, `supabase db reset`).
  Später identischer Client-Code gegen Cloud-/self-hosted Projekt,
  nur URL/Keys wechseln.

- **Offline-Strategie (später):** lokale SQLite-Lösung für RN
  (z.B. WatermelonDB oder op-sqlite) mit einfacher Sync-Queue
  (Last-Write-Wins reicht zunächst); bei Bedarf später PowerSync
  (hat React-Native-SDK, arbeitet mit Supabase/Postgres).

## Kern-Datenmodell (Ausgangspunkt)

- `club` – Mandant/Verein (id, name, gläubiger_id, einstellungen)
- `member` – Mitglied (id, club_id, user_id→auth.users, name, kontakt,
  rolle, eintrittsdatum, status, sepa_mandat)
- `guest` – Gastkegler ohne Konto
- `event` – Termin (id, club_id, typ [kegelabend/turnier/sitzung], datum, ort, status)
- `attendance` – Zu-/Absage/Anwesenheit pro Event und Mitglied
- `game`/`session` – ein gespieltes Spiel pro Event (spieltyp, regel_config)
- `score`/`throw` – Ergebnis-/Wurferfassung
- `penalty_rule` / `penalty` – frei konfigurierbare Strafregeln + Buchungen
- `transaction` – Kassenbuch (Einzahlung/Ausgabe/Strafe/Gutschrift);
  Mitglieder-Saldo wird daraus aggregiert
- `fee`/`invoice` – Beiträge/Rechnungen (inkl. SEPA-Status)
- `team` / `team_member` – Mannschaften
- `announcement` – Ankündigungen an Mitglieder

Statistiken/Ranglisten werden als Postgres Views bzw. Funktionen über
`score`, `penalty`, `attendance` berechnet, nicht clientseitig.

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

1. **Phase 0 – Fundament:** Supabase-Projekt + Migrationen versioniert,
   RLS von Anfang an, Expo-Projekt mit Supabase-Client verbunden.
2. **Phase 1 – MVP:** Mitgliederverwaltung + Einladungscode, Kegelabend
   anlegen + Anwesenheit, einfache Session-Erfassung (1–2 Spieltypen)
   + automatische Kegelkasse mit Salden.
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
  nachträglich ergänzen.
- Bevorzugt "vertikale Durchstiche" bauen (eine Funktion komplett
  End-to-End), statt breit an vielen Features gleichzeitig zu arbeiten.

## Offene Punkte / noch nicht entschieden

- Konkrete Spielregeln/Strafregeln-Konfiguration (wie flexibel muss die
  Regel-Engine sein?)
- SEPA-Lastschrift-Anbindung im Detail (Gläubiger-ID, Mandatsverwaltung)
- Ob/wann self-hosted Supabase (Hetzner) statt Managed Supabase nötig wird
- Separate öffentliche Marketing-/Landingpage (Format noch offen)
