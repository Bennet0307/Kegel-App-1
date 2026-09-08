# Kegelclub-App

Eine App für Kegelclubs/Kegelvereine zur Vereinsverwaltung:
Mitgliederverwaltung, Kegelabend-Planung mit Zu-/Absage, später
automatische Kegelkasse, Statistiken/Ranglisten, Turnier-/
Saisonverwaltung und Ankündigungen.

Läuft als eine gemeinsame Codebase für **Mobile (iOS/Android) und
Web** (eingeloggtes Vereins-Dashboard, keine öffentliche
Marketing-Seite).

Den vollständigen Architektur- und Entscheidungs-Hintergrund
(Rollenmodell, RLS-Policies, DSGVO-Hinweise, Roadmap, offene Ideen)
findest du in [CLAUDE.md](CLAUDE.md). Dieses README konzentriert sich
auf: Projektstruktur, lokales Testen und Self-Hosting.

## Tech-Stack

- **Frontend:** React Native mit Expo (TypeScript), Expo Router,
  `react-native-web` fürs Web.
- **Backend:** Supabase (PostgreSQL, Auth, Row Level Security).
  Open Source → jederzeit migrierbar auf eine selbst gehostete
  Supabase-Instanz.

## Projektstruktur

```
Kegel-App-1/
├── kegelclub-app/        Das eigentliche Expo-Projekt (App-Code)
│   ├── src/app/          Screens (Expo Router, dateibasiert)
│   ├── src/lib/          Supabase-Client, Helper
│   └── .env              Supabase-URL + Anon-Key (lokal, nicht committen)
└── supabase/
    └── migrations/       Versionierte SQL-Migrationen (Schema + RLS-Policies)
```

Wichtig: Die `.env` mit den Supabase-Zugangsdaten muss in
`kegelclub-app/` liegen, nicht im Repo-Root – Expo lädt sie nur aus
dem eigenen Projekt-Root.

## Voraussetzungen

- [Node.js](https://nodejs.org/) (aktuelle LTS-Version)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
  für die lokale Supabase-Instanz
  - Auf Windows: WSL2-Backend aktiviert (`wsl --status` sollte
    fehlerfrei laufen)

## Lokal entwickeln & testen

**1. Lokale Supabase-Instanz starten** (im Repo-Root, dort liegt
`supabase/`):

```bash
npx supabase start
```

Das baut Postgres + Auth + Studio lokal per Docker auf und spielt
alle Migrationen aus `supabase/migrations/` ein. Danach zeigt
`npx supabase status` die Zugangsdaten an (u.a. `API_URL` und
`ANON_KEY`).

Bei einer schon laufenden Instanz reicht es, nur neue Migrationen
einzuspielen (ohne Datenverlust):

```bash
npx supabase migration up
```

**2. Environment-Variablen setzen**

In `kegelclub-app/.env` (Vorlage in `kegelclub-app/env.example`):

```
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY aus `supabase status`>
```

**3. App starten**

```bash
cd kegelclub-app
npm install
npm run web        # Browser unter http://localhost:8081
# oder
npm run ios        # iOS-Simulator
npm run android     # Android-Emulator
npm start           # Expo Go auf echtem Gerät (siehe Hinweis unten)
```

Für Expo Go auf einem echten Smartphone muss `127.0.0.1` in der
`.env` durch die lokale Netzwerk-IP des Entwicklungsrechners ersetzt
werden, da das Handy sonst den lokalen Docker-Container nicht
erreicht.

**4. Durchklicken**

- `/login` → registrieren (lokal ist die E-Mail-Bestätigung
  deaktiviert, Login erfolgt sofort)
- landet bei bestehender Mitgliedschaft automatisch auf `/events`,
  sonst auf `/create-club`
- Club anlegen → zeigt Einladungscode; mit einem zweiten Test-Account
  über `/join-club` beitreten
- unter `/events` Kegelabende anlegen (nur Admin/Kassierer) und
  zu-/absagen

Supabase Studio (Tabellen direkt einsehen) läuft unter
`http://127.0.0.1:54323`.

**Lokale Instanz stoppen:**

```bash
npx supabase stop
```

## Self-Hosting / Deployment

Da Supabase Open Source ist, gibt es zwei Wege für eine
produktive/gehostete Umgebung – der App-Code bleibt in beiden Fällen
identisch, es ändern sich nur `EXPO_PUBLIC_SUPABASE_URL` und
`EXPO_PUBLIC_SUPABASE_ANON_KEY`:

### Option A: Supabase Cloud (Managed)

1. Projekt auf [supabase.com](https://supabase.com) anlegen (Region
   z.B. Frankfurt/EU, siehe CLAUDE.md).
2. Projekt lokal verknüpfen und Migrationen einspielen:
   ```bash
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   ```
3. `URL`/`anon key` aus den Projekt-Einstellungen in die
   Produktions-`.env` bzw. EAS-Build-Umgebungsvariablen übernehmen.

### Option B: Self-Hosted Supabase (z.B. auf Hetzner)

Supabase stellt ein offizielles Docker-Compose-Setup für
Self-Hosting bereit
([Docs](https://supabase.com/docs/guides/self-hosting/docker)). Kurz:

1. Auf dem Server `docker/` von
   [supabase/supabase](https://github.com/supabase/supabase) auschecken,
   `.env` mit eigenen Secrets (JWT-Secret, DB-Passwort, Anon-/Service-Key)
   befüllen, `docker compose up -d`.
2. Migrationen gegen die selbst gehostete Postgres-Instanz einspielen,
   z.B. direkt per `psql` mit den Dateien aus
   `supabase/migrations/` (in chronologischer Reihenfolge) oder über
   die Supabase-CLI mit der DB-Connection-URL des Servers.
3. `EXPO_PUBLIC_SUPABASE_URL`/`_ANON_KEY` auf die eigene Domain/Keys
   setzen.

Das ist der in CLAUDE.md vorgesehene Migrationspfad, falls DSGVO-
Anforderungen später rein deutsche/eigene Infrastruktur nötig machen.

### App-Builds

- **Web:** `npx expo export -p web` erzeugt einen statischen Build
  (Ordner `dist/`), der auf einen beliebigen Static-Host oder
  eigenen Server deploybar ist. Gedacht als eingeloggtes
  Vereins-Dashboard, nicht als öffentliche Marketing-Seite.
- **iOS/Android:** über [EAS Build](https://docs.expo.dev/build/introduction/)
  (Cloud-Build, kein lokales Xcode/Android-Studio-Setup nötig) –
  dafür ist noch kein `eas.json` im Projekt eingerichtet.

## Datenbank-Migrationen

Alle Schemaänderungen liegen als SQL-Dateien in
`supabase/migrations/` und werden nie manuell in einer laufenden
Instanz vorgenommen. Neue Migration erzeugen:

```bash
npx supabase migration new <name>
```

Details zu den einzelnen Migrationen (inkl. der RLS-Rekursions-Fixes)
stehen in [CLAUDE.md](CLAUDE.md#datenbank-migrationen-stand).
