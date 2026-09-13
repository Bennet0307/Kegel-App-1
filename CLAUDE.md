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
    `create-event`, `enter-score`, `kasse`, `club-settings`,
    `strafenkatalog`, `enter-penalties`, `statistik`,
    `termin-statistik`, `check-in` und `announcements` als eigenen
    Screens.
    `enter-score` bedient sowohl Anlegen als auch Bearbeiten (Route-Param
    `gameId` optional), `enter-penalties` erfasst/korrigiert (ebenfalls
    per Replace) die Strafenkatalog-Buchungen eines Termins
    (Route-Param `eventId`). Nach Login/Signup prüft
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
    Mitglied mit Score eine `transaction` vom Typ `'kegelgeld'`
    (`club.kegelgeld_cents`, Default 2,00 €) – ein Vorgang, kein
    zweiter manueller Schritt. **Eindeutig pro `event_id` + `member_id`,
    nicht pro `game_id`** (Migration 15): fallen an einem Termin
    mehrere Spiele an (z.B. Kleine und Große Hausnummer am selben
    Abend), wird das Kegelgeld trotzdem nur einmal gebucht. Deshalb
    eigener Typ `'kegelgeld'` statt generischem `'einzahlung'` – so
    kann die Eindeutigkeit gezielt nur für die automatische
    Teilnahmegebühr auf `event_id` begrenzt werden, ohne manuelle
    Bareinzahlungen (weiterhin `'einzahlung'`, die pro Termin durchaus
    mehrfach vorkommen dürfen) zu beeinflussen. Bei den beiden
    Hausnummer-Spielen (siehe unten) kommt zusätzlich automatisch eine
    gestaffelte `'strafe'`-Buchung nach Platzierung dazu – die bleibt
    pro `game_id` eindeutig, da jedes Spiel seine eigene Rangfolge hat.
    Kontostände (`kasse.tsx`) werden
    client-seitig aus den `transaction`-Zeilen aufsummiert, nicht über
    eine DB-View: eine View würde (wie die security-definer Helper)
    automatisch RLS auf `transaction` umgehen und wäre für jeden
    Authenticated-User lesbar – das ist bei einer Hilfsfunktion für
    interne Policy-Checks gewollt, bei einer direkt abfragbaren View
    aber ein Datenleck (jedes Mitglied könnte alle Kontostände aller
    Clubs sehen). Deshalb bewusst kein `create view` hier.
    **Vorzeichen-Logik (wichtig, ursprünglich falsch):** `einzahlung`,
    `kegelgeld` und `strafe` sind alle Geld, das ein Mitglied in die
    Kasse einzahlt (kein Gegeneinander-Verrechnen wie bei einem
    Bankkonto) – alle drei zählen **positiv** zum Gesamtbetrag.
    `gutschrift`/`ausgabe`
    ziehen ab. Ein Mitglied, das eine hohe Strafe zahlt, soll einen
    entsprechend **höheren** Gesamtbetrag zeigen, nicht einen
    niedrigeren. `transaction.paid` (boolean, Migration 13) trackt
    zusätzlich, ob eine Buchung schon an den Kassierer bezahlt wurde –
    ändert nie den angezeigten Gesamtbetrag, nur eine separate
    "davon offen"-Anzeige plus eine Sammel-Aktion für Admin/Kassierer
    ("Als bezahlt markieren", setzt `paid=true` für alle offenen
    Buchungen eines Mitglieds auf einmal).
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
  - **Bekannter Windows-Gotcha:** Nach Schlafmodus/Docker-Neustart kann
    Windows die Standard-Supabase-Ports (54320er-Bereich) über einen
    Hyper-V/WSL2-"excluded port range" blockieren – Docker meldet dann
    `bind: An attempt was made to access a socket in a way forbidden by
    its access permissions`, obwohl `netstat` keinen belegenden Prozess
    zeigt (prüfen mit `netsh interface ipv4 show excludedportrange
    protocol=tcp`). Der eigentliche Fix (`net stop winnat` / `net start
    winnat`) braucht Admin-Rechte; als Workaround ohne Admin-Rechte
    wurden die Ports in `supabase/config.toml` auf den freien Bereich
    61320–61329 verschoben (API 61321, DB 61322, Studio 61323, SMTP/
    Mailpit 61324, Analytics 61327, Pooler 61329, Shadow-DB 61320) –
    `kegelclub-app/.env` entsprechend auf
    `EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:61321` angepasst. Bei
    `supabase status`/`supabase start` jetzt diese Ports erwarten, nicht
    mehr die Standard-54320er.

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
    Neu (Stand Migration 10, siehe Migration 12 für die aktuelle
    Version): eine Strafstaffel je Rang. Rang wird per `rank()` über
    `pins` ermittelt (Ties = gleicher Rang = gleiche Strafe), Richtung
    je nach Spielart umgedreht. Da pro Spiel jetzt zwei Buchungstypen
    pro Mitglied möglich sind (Kegelgeld **und** Strafe), wurde der
    Idempotenz-Unique-Index von `(game_id, member_id)` auf
    `(game_id, member_id, type)` erweitert.
11. **`edit_delete_game_scores`** – Ergebnisse nachträglich bearbeiten/
    löschen. Lagert die eigentliche Buchungslogik (Kegelgeld +
    Hausnummer-Strafe) aus `record_game_scores` in eine gemeinsame
    Hilfsfunktion `book_game_scores()` aus, damit der nicht-triviale
    Rang-Algorithmus nicht doppelt gepflegt werden muss. Neue RPCs:
    `update_game_scores(p_game_id, p_type, p_scores,
    p_penalty_schedule_cents)` – löscht alle bisherigen Scores/
    Buchungen dieses `game` und bucht sie mit den neuen Werten frisch
    (eine Korrektur kann die Rang-abhängige Strafe für **alle**
    Mitglieder des Spiels ändern, nicht nur für das bearbeitete);
    `delete_game(p_game_id)` – löscht ein `game` inkl. aller
    zugehörigen `transaction`-Zeilen (nötig, weil `transaction.game_id`
    "on delete set null" ist und sonst verwaiste, aber weiterhin
    gültige Buchungen zurückbleiben würden).
12. **`penalty_formula`** – ersetzt die kommagetrennte Strafstaffel
    (integer[], anfällig für die Dezimalkomma-/Listentrenner-Kollision
    aus Migration 10) durch eine einfache Formel: Maximalbetrag für
    den Verlierer (schlechtester Rang), danach pro besserem Rang eine
    feste (`club.hausnummer_penalty_step_cents`) oder prozentuale
    (`club.hausnummer_penalty_step_percent`) Reduzierung, gesteuert
    über `club.hausnummer_penalty_mode` (`'fest'`/`'prozent'`), bis 0.
    `book_game_scores()` berechnet die Strafe direkt aus der Formel
    statt aus einem Array – skaliert automatisch auf beliebig viele
    Teilnehmer, kein fester Array-Länge-Cutoff mehr nötig.
    `record_game_scores`/`update_game_scores` bekommen die vier Werte
    (`p_penalty_max_cents`, `p_penalty_mode`, `p_penalty_step_cents`,
    `p_penalty_step_percent`) jetzt als **erforderliche** Parameter
    (kein Client-seitiges "leer = Club-Standard" mehr) – die
    Vorbelegung mit dem Club-Standard passiert im Frontend beim Laden
    des Formulars, nicht mehr per Fallback in der DB-Funktion.
    `game.penalty_max_cents`/`_mode`/`_step_cents`/`_step_percent`
    speichern die tatsächlich verwendete Formel als Snapshot (ersetzt
    `game.penalty_schedule_cents`).
13. **`transaction_paid_flag`** – `transaction.paid boolean default
    false`. Reagiert auf einen echten Bug: `kasse.tsx` hat `strafe`
    bisher von `einzahlung` **abgezogen** (Bankkonto-Logik), dabei sind
    beide Geld, das ins die Kasse einzahlt wird – wer viel Strafe zahlt,
    zeigte dadurch einen **niedrigeren** Betrag statt einen höheren
    (an echten Nutzerdaten nachvollzogen: Verlierer mit 4,00 €
    Gesamteinzahlung zeigte 0,00 €, Gewinner mit 3,80 € zeigte 0,20 €).
    Fix in `kasse.tsx` (`signedCents()`): `einzahlung`/`strafe` jetzt
    beide positiv, `gutschrift`/`ausgabe` negativ. `paid` ist rein
    informativ (Kassierer hat das Geld physisch erhalten) und verändert
    den angezeigten Gesamtbetrag nicht – nur eine zusätzliche "davon
    offen"-Zeile plus Sammel-Aktion, siehe App-Code unten.
14. **`club_settings_staff_write`** – `club_update_admin` erlaubte
    bisher nur `admin`, den Club zu bearbeiten. `kegelgeld_cents` und
    `hausnummer_penalty_*` sind finanzielle Einstellungen, die auch
    der Kassierer anpassen darf (er hat bereits Schreibrechte auf
    game/score/transaction) – Policy umbenannt zu `club_update_staff`,
    jetzt über `auth_staff_club_ids()` statt `auth_admin_club_ids()`.
15. **`kegelgeld_per_termin`** – Kegelgeld war bisher pro `game`
    fällig, nicht pro `event` ("Termin"): mehrere Spiele an einem
    Kegelabend (z.B. Kleine und Große Hausnummer am selben Abend)
    führten zu mehrfacher Kegelgeld-Buchung. Neuer Transaction-Typ
    `'kegelgeld'` (statt `'einzahlung'` + Note-Text) speziell für die
    automatische Teilnahmegebühr, mit eigenem partiellen Unique-Index
    `(event_id, member_id) WHERE type = 'kegelgeld'` – jetzt genau
    einmal pro Termin und Mitglied, unabhängig von der Spielanzahl.
    Bekannte Einschränkung: Das Kegelgeld ist trotzdem an ein
    konkretes `game_id` gebunden (welches Spiel es zuerst ausgelöst
    hat); löscht man genau dieses `game` über `delete_game`, während
    für denselben Termin noch ein anderes `game` desselben Mitglieds
    existiert, verschwindet die Kegelgeld-Buchung mit – wird nicht
    automatisch auf das verbleibende Spiel "umgehängt". Noch offen,
    siehe "Offene Punkte".
16. **`freitext_game`** – dritter Spieltyp `'freitext'`: kein Ranking/
    keine Formel, sondern ein freier Beschreibungstext fürs Spiel
    (`game.description`) plus frei eingegebene Strafe pro Mitglied
    (auch 0 € = teilgenommen, keine Strafe). `score.pins` wird für
    diesen Typ als Strafe in Cent zweckentfremdet (statt Hausnummer-
    Ziffern) – vermeidet eine weitere Tabelle nur für diesen simplen
    Fall. Neue Hilfsfunktion `book_freitext_game()` (analog zu
    `book_game_scores()`, aber ohne Rang-Logik) sowie die RPCs
    `record_freitext_game(p_event_id, p_description, p_penalties)` /
    `update_freitext_game(p_game_id, p_description, p_penalties)`.
    Kegelgeld wird genauso automatisch gebucht wie bei den Hausnummer-
    Spielen (über dieselbe `event_id`-Eindeutigkeit aus Migration 15).
17. **`penalty_catalog`** – freier Strafenkatalog pro Club, umsetzt die
    entsprechende Idee aus "Offene Punkte" (Grundfunktion, ohne die
    "Pumpenkönig"-Zuschlag-Idee, die weiterhin offen bleibt). Neue
    Tabelle `penalty_rule` (club_id, name, amount_cents) – freie
    Strafarten wie "Pumpe"/"Klingen", verwaltet über eine eigene
    Katalog-Seite. Neue Tabelle `penalty` (club_id, event_id, member_id,
    penalty_rule_id, rule_name, unit_amount_cents, count) – Erfassung
    **pro Termin** (nicht pro Spiel): für jedes Mitglied wird gezählt,
    wie oft welche Strafart an diesem Kegelabend fällig wurde. `rule_name`/
    `unit_amount_cents` sind ein Snapshot analog zur Hausnummer-
    Strafformel (Migration 12) – spätere Änderungen/Löschungen im
    Katalog verändern alte Buchungen nicht (`penalty_rule_id` ist
    `on delete set null`). Neue Spalte `transaction.penalty_id` (on
    delete cascade) verknüpft die automatisch erzeugte Kassenbuch-Zeile
    mit ihrer `penalty`-Buchung. Security-definer RPC
    `record_event_penalties(p_event_id, p_penalties)` löscht+bucht alle
    Strafenkatalog-Einträge eines Termins in einem Schritt (idempotent
    für ErstErfassung und Korrektur, analog zum Replace-Muster aus
    `update_game_scores`/`update_freitext_game`). Bewusst **kein**
    Kegelgeld in dieser RPC – das bleibt ausschließlich an die
    Spiel-Teilnahme gebunden (Migration 15/16).
18. **`king_surcharge`** – "Pumpenkönig"-Zuschlag, die letzte offene
    Zusatzidee zum Strafenkatalog (Migration 17). Neue Spalten
    `penalty_rule.has_king_surcharge boolean` / `.king_surcharge_cents`:
    eine Strafart kann markiert werden, dass zusätzlich ein Zuschlag
    für den "Abend-Verlierer" dieser Strafart fällig wird. Neue Spalte
    `club.king_surcharge_tie_mode` (`'alle_zahlen'` / `'keiner_zahlt'` /
    `'geteilt'`) – **Club-Einstellung** statt fest codiertem Verhalten,
    da unterschiedliche Clubs Gleichstand (mehrere Mitglieder mit
    gleich vielen Buchungen einer Strafart am selben Abend)
    unterschiedlich handhaben wollen. `record_event_penalties` berechnet
    den Zuschlag **automatisch bei jedem Speichern** neu (kein
    separater "Abend abschließen"-Schritt, bewusste Vereinfachung
    gegenüber der ursprünglichen Idee in "Offene Punkte" – Ergebnis ist
    ohnehin nach jedem Speichern vollständig neu abgeleitet, genau wie
    bei den anderen Replace-Mustern in dieser App): pro Strafart mit
    `has_king_surcharge` wird der Maximalwert von `penalty.count` für
    diesen Termin ermittelt, alle Mitglieder mit diesem Maximum sind
    "König"; bei `'alle_zahlen'` zahlt jeder von ihnen den vollen
    Zuschlag, bei `'geteilt'` den Zuschlag geteilt durch die Anzahl der
    Gleichständigen (gerundet), bei `'keiner_zahlt'` entfällt der
    Zuschlag bei mehr als einem Gewinner komplett. Neue Spalte
    `transaction.king_surcharge_penalty_rule_id` (statt Wiederverwendung
    von `penalty_id`, da der Zuschlag keine eigene Zählbuchung ist,
    sondern eine abgeleitete Summenbetrachtung) erlaubt, vor dem
    Neuberechnen gezielt nur die alten Zuschlag-Buchungen eines Termins
    zu löschen, ohne die eigentlichen Strafenkatalog-Buchungen
    anzufassen.
19. **`king_surcharge_note_format`** – der Note-Text der Zuschlag-
    Buchung folgt immer dem Muster `"<Strafart>-König"` (z.B. Strafart
    "Klingel" → `"Klingel-König"`, Strafart "Pumpen" → `"Pumpen-König"`)
    statt eines fest codierten `"Pumpenkönig: <Strafart>"` – der
    generische "Pumpenkönig"-Name in Doku/UI-Labels bezieht sich nur auf
    das Feature selbst, nicht auf den tatsächlich gebuchten Namen, der
    immer von der jeweiligen Strafart abgeleitet wird.
20. **`event_series`** – Regeltermine / Serien-Kegelabende (Idee aus
    "Offene Punkte" umgesetzt). Neue Tabelle `event_series` (club_id,
    title, location, frequency `'woechentlich'`/`'monatlich'`,
    interval_weeks, weekday [ISO 1=Montag..7=Sonntag],
    monthly_occurrence [1-5 = "n-ter Wochentag im Monat", oder -1 =
    "letzter Wochentag im Monat", siehe Migration 22], time_of_day,
    starts_on, active). Neue Spalten auf `event`: `series_id`,
    `series_occurrence_date` (das ursprünglich geplante Datum dieses
    Vorkommens, stabil auch wenn `starts_at` später verschoben wird –
    genau das Ausnahme-Muster wiederkehrender Termine aus Kalender-Apps)
    und `series_overridden` (Anzeige-Flag: true, wenn dieses Vorkommen
    manuell verschoben oder abgesagt wurde). Ein partieller Unique-Index
    auf `(series_id, series_occurrence_date)` sorgt dafür, dass der
    Generator (`generate_series_events`) ein Vorkommen nie doppelt
    anlegt, selbst wenn es längst verschoben/abgesagt wurde – er prüft
    nur gegen `series_occurrence_date`, nie gegen `starts_at`. RPCs:
    `create_event_series(...)` legt die Serie an und erzeugt sofort die
    ersten 6 Monate an Terminen; `generate_series_events(p_series_id,
    p_until)` erzeugt fehlende Vorkommen bis zu einem Stichtag
    (idempotent, wird bei jedem Laden von `events.tsx` durch Admin/
    Kassierer erneut mit "heute + 6 Monate" aufgerufen, damit eine Serie
    nie "ausläuft", ohne dass dafür ein Cron-Job nötig ist). Die
    monatliche Regel wird nicht über einen separaten Wochentag-/
    Vorkommen-Picker im Formular abgefragt, sondern aus dem gewählten
    ersten Termin abgeleitet (z.B. "3. Oktober, ein Freitag" →
    automatisch "jeden ersten Freitag im Monat") – siehe App-Code.
    **Zeitzone:** `time_of_day` wird über `AT TIME ZONE 'Europe/Berlin'`
    in `timestamptz` umgerechnet statt über einen bloßen `::timestamptz`-
    Cast (der die DB-Session-Zeitzone UTC verwendet hätte und z.B.
    19:30 Uhr als 19:30 UTC statt 19:30 Uhr Ortszeit gespeichert hätte –
    ein echter Bug, live im Browser gefunden: Termine erschienen 2h
    zu spät). `Europe/Berlin` ist damit die einzige von der App
    unterstützte Zeitzone (kein `tz`-Feld auf `club`), was für dieses
    Projekt (Region Frankfurt/EU, siehe Tech-Stack) ausreicht.
21. **`delete_event`** – Termine löschen. `game`, `attendance` und
    `penalty` hängen bereits per `on delete cascade` an `event`, aber
    `transaction.event_id` ist bewusst `on delete set null` (Migration
    9) – ein reines `delete from event` hätte deshalb verwaiste, aber
    weiterhin gültige Kegelgeld-/Strafe-/Pumpenkönig-Buchungen
    zurückgelassen, die in der Kasse fälschlich weiterzählen (dieselbe
    Klasse Bug wie beim ursprünglichen `delete_game`, siehe Migration
    11). Neue security-definer RPC `delete_event(p_event_id)` löscht
    deshalb zuerst explizit alle `transaction`-Zeilen mit diesem
    `event_id`, danach das `event` selbst (Rest kaskadiert). Nur Admin/
    Kassierer. **Bekannte Einschränkung bei Serienterminen:** Löschen
    entfernt nur die Zeile – da `generate_series_events` beim nächsten
    Lauf ausschließlich prüft, ob für ein `series_occurrence_date`
    bereits eine Zeile existiert (nicht, ob sie zuvor gelöscht wurde),
    kann ein gelöschter Serientermin beim nächsten Laden durch
    Admin/Kassierer erneut erzeugt werden, solange die Serie noch aktiv
    ist und das Datum innerhalb des 6-Monats-Horizonts liegt. Für einen
    einzelnen Serientermin, der dauerhaft verschwinden soll, ist
    "Absagen" (setzt `status='abgesagt'`, bleibt aber als Zeile
    bestehen und wird nicht neu generiert) die richtige Wahl; "Löschen"
    eignet sich für Einzeltermine oder Terminserien, die zuvor über
    "Serie beenden" gestoppt wurden.
22. **`event_series_last_weekday`** – reagiert auf eine Nutzerfrage
    ("geht auch jeder letzter Freitag im Monat?"): Die bisherige
    Ableitung von `monthly_occurrence` als reines "n-tes Vorkommen"
    (1–5) konnte "letzter Wochentag im Monat" nicht korrekt abbilden –
    nicht jeder Monat hat ein 5. Vorkommen eines Wochentags, und ein
    als "5." gespeicherter Monat wäre in jedem 4-Vorkommen-Monat (z.B.
    November/Dezember 2026 mit nur 4 Freitagen) komplett übersprungen
    worden, statt trotzdem am letzten Freitag stattzufinden. Neuer,
    eigener Modus `monthly_occurrence = -1` = "letztes Vorkommen im
    Monat": `generate_series_events` läuft dafür vom Monatsletzten
    rückwärts zum passenden Wochentag statt vorwärts vom Monatsersten –
    dadurch garantiert genau ein Treffer in jedem Monat, unabhängig
    davon, ob der Wochentag darin 4× oder 5× vorkommt. Live im Browser
    über 7 Monate verifiziert (30.10./27.11./25.12./29.01./26.02./
    26.03./30.04. – alle korrekt, keine Lücke in den 4-Freitag-Monaten).
23. **`event_archiving`** – Termine archivieren (Idee aus "Offene
    Punkte" umgesetzt), zwei Mechanismen, beide rein clientseitig
    ausgewertet (kein Cron-Job/Edge-Function nötig): (1) manuell über
    neue Spalte `event.archived_at` (Button "Archivieren"/"Aus Archiv
    holen" pro Termin); (2) automatisch über neue Spalte
    `club.auto_archive_days` (nullable integer, Club-Einstellung) – ist
    sie gesetzt, gilt ein Termin automatisch als archiviert, sobald
    `starts_at` länger als so viele Tage zurückliegt, ganz ohne dass
    dafür `archived_at` geschrieben werden müsste (spart eine
    geschriebene Spalte + Job; die Grenze lässt sich jederzeit ändern,
    ohne bestehende Zeilen zu migrieren). Archivierte Termine
    verschwinden standardmäßig aus der Terminliste in `events.tsx`
    (historische Daten in `kasse.tsx`/`statistik.tsx`/
    `termin-statistik.tsx` bleiben unverändert, die aggregieren
    unabhängig vom Archiv-Status), ein Umschalter "Archivierte Termine
    anzeigen" blendet sie wieder ein. Live im Browser mit beiden
    Mechanismen getestet: manuelles Archivieren/Aus-Archiv-holen sowie
    automatisches Ausblenden allein durch `club.auto_archive_days`
    (verifiziert per psql, dass `archived_at` dabei `null` bleibt).
24. **`check_in`** – Einchecken/Ankunftszeit erfassen (Idee aus "Offene
    Punkte" umgesetzt, Grundfunktion ohne automatische
    Verspätungsstrafe – bewusst auf Nutzerwunsch zurückgestellt, bleibt
    als eigener nächster Schritt offen). Neue Spalte
    `attendance.checked_in_at timestamptz`, getrennt von `status`
    (Zu-/Absage), damit z.B. ein "zugesagtes" Mitglied trotzdem nicht
    erscheinen kann oder jemand spontan ohne vorherige Zusage einchecken
    kann. Einchecken funktioniert sowohl als Self-Check-in (jedes
    Mitglied für sich selbst) als auch durch Admin/Kassierer für
    beliebige Mitglieder des Clubs (z.B. am Tisch für wen ohne
    Smartphone) – dafür brauchte es eine neue Policy
    `attendance_write_staff` (auf `attendance` gab es bisher nur
    `attendance_write_own`, keinerlei Staff-Schreibrecht). Kein RPC
    nötig, reines `upsert` auf `attendance` (`onConflict:
    'event_id,member_id'`), RLS regelt die Berechtigung. **Seit
    Migration 25 läuft das Setzen von `checked_in_at` nicht mehr über
    ein direktes `upsert`, sondern über die neue RPC `check_in`** (die
    dort automatisch mitberechnete Verspätungsstrafe brauchte ohnehin
    eine security-definer-Funktion, siehe Migration 25).
25. **`late_penalty`** – zwei Ergänzungen zum Einchecken (Migration 24)
    auf Nutzerwunsch: (1) Admin/Kassierer können die Check-in-Zeit
    eines Mitglieds nachträglich auf einen beliebigen Zeitpunkt setzen,
    nicht nur "jetzt" umschalten; (2) automatische Verspätungsstrafe,
    konfigurierbar in den Club-Einstellungen, entweder `'pauschal'`
    (fester Betrag unabhängig davon, wie spät) oder `'intervall'` (X
    Cent pro angefangenem Y-Minuten-Intervall). Neue Spalten auf `club`:
    `late_penalty_mode` (NULL = deaktiviert, Default – kein Club zahlt
    automatisch, bis das explizit aktiviert wird), `late_penalty_cents`
    (Pauschal-Betrag), `late_penalty_interval_minutes` /
    `late_penalty_interval_cents` (Intervall-Variante). Neue RPC
    `check_in(p_event_id, p_member_id, p_checked_in_at)` vereinheitlicht
    Self-Check-in und Staff-Check-in/-Bearbeitung: setzt
    `attendance.checked_in_at` per `insert ... on conflict do update`
    (beliebiger Zeitpunkt, nicht nur "jetzt"; NULL = Check-in rückgängig
    machen) und berechnet danach die Verspätungsstrafe komplett neu
    (Replace-Muster: alte automatische Buchung für genau dieses
    Einchecken erst per `late_checkin_attendance_id`-Marker löschen,
    dann bei Bedarf neu bilden – so bleibt eine Korrektur der Check-in-
    Zeit oder ein Rückgängigmachen immer korrekt, ohne doppelte oder
    verwaiste Kassenbuchungen). Neue Spalte
    `transaction.late_checkin_attendance_id` (on delete cascade von
    `attendance`) ist genau dieser Marker – analog zu
    `king_surcharge_penalty_rule_id` (Migration 18) und `penalty_id`
    (Migration 17), aus demselben Grund: mehrere `'strafe'`-Buchungen
    pro Termin/Mitglied aus unterschiedlichen Quellen (Hausnummer,
    Strafenkatalog, Pumpenkönig, jetzt Verspätung) müssen unabhängig
    voneinander ersetzbar sein, ohne sich gegenseitig zu überschreiben.
    Berechtigung: nur die eigene Zeile oder, wenn Admin/Kassierer,
    beliebige Zeilen desselben Clubs – geprüft direkt in der
    plpgsql-Funktion (security definer, umgeht dafür bewusst RLS).
    Live im Browser mit beiden Modi verifiziert: Pauschal 1,00 €
    (bleibt bei Korrektur der Uhrzeit unverändert 1,00 €, solange noch
    verspätet), Intervall 5 Min./0,50 € bei 37 Min. Verspätung →
    exakt 4,00 € (ceil(37/5) × 0,50 €), Rückgängig entfernt die Buchung
    wieder vollständig.
26. **`zehner_spiel`** – vierter Spieltyp `'zehner'` ("10er-Spiel", Idee
    aus "Offene Punkte" umgesetzt): alle Mitglieder werfen reihum, die
    Pins jedes einzelnen Wurfs werden auf eine gemeinsame laufende
    Summe addiert; jedes Mal, wenn diese Summe einen Zehnerwert (10,
    20, 30, …) erreicht/überschreitet, wird eine nach Zehnerwert
    gestaffelte Strafe fällig (Strafe bei Zehnerwert N = (N/10) ×
    Schrittweite, Default 0,10 €). Wird der Zehnerwert **genau**
    getroffen, zahlen **alle Teilnehmer außer dem Werfer**; wird
    **drübergeworfen**, zahlt **nur der Werfer**. Da ein Wurf beim
    Kegeln höchstens 9 Pins umwirft, löst jeder Wurf höchstens einen
    Zehnerwert aus. Erfassung bewusst simpel gehalten (Nutzerwunsch):
    pro Zehnerwert wird nur Werfer + genau/drüber eingetragen, nicht
    jeder einzelne Wurf aller Mitglieder – der Rest wird automatisch
    abgeleitet. "Teilnehmer" eines Spiels = jedes Mitglied, das laut
    den Einträgen mindestens einmal geworfen hat (nicht die volle
    Club-Mitgliederliste); ein Mitglied, das rein rechnerisch nie
    Auslöser eines Zehnerwerts wird, zahlt entsprechend auch nie mit
    (und bekommt auch kein Kegelgeld) – bei einem vollständig
    gespielten Abend mit realistisch vielen Zehnerwerten kommt das
    praktisch nicht vor, ist aber die bewusste Vereinfachung, die diese
    Definition mit sich bringt. Neue Spalten `club.zehner_max_pins`
    (Default 300) / `club.zehner_step_cents` (Default 10) als
    Club-Standard, `game.zehner_max_pins` / `game.zehner_step_cents`
    als Snapshot (analog zur Hausnummer-Strafformel, Migration 12).
    Neue Tabelle `zehner_milestone` (club_id, game_id, milestone,
    thrower_member_id, hit_exact) – ein Eintrag pro erreichtem
    Zehnerwert, club-weit lesbar (analog `score`/`penalty`), nur
    Admin/Kassierer schreibbar. Neue RPCs `record_zehner_game`/
    `update_zehner_game` (Replace-Muster wie bei den anderen
    Spieltypen) rufen die gemeinsame `book_zehner_game()` auf: bucht
    Kegelgeld (einmal pro Teilnehmer) und summiert die Zehner-Strafen
    **pro Mitglied auf** zu **einer einzigen** `'strafe'`-Buchung (statt
    einer Buchung pro Zehnerwert) – zum einen für eine übersichtliche
    Kassenbuch-Historie, zum anderen weil der bestehende Unique-Index
    `transaction_game_member_type_unique` (game_id, member_id, type)
    ohnehin nur eine `'strafe'`-Zeile pro Spiel und Mitglied erlaubt.
    Neue gemeinsame Hilfsfunktion `computeZehnerPenalties()`
    (`src/lib/zehnerSpiel.ts`) spiegelt exakt dieselbe
    Strafenverteilungs-Logik auf Client-Seite (für Anzeige in
    `events.tsx`/`termin-statistik.tsx` **ohne** `transaction` lesen zu
    müssen – dieselbe Motivation wie bei `kingSurcharge.ts`, siehe dort:
    reguläre Mitglieder sähen sonst wegen `transaction_select_own`
    nicht die Beträge anderer Mitglieder) sowie für eine Live-Vorschau
    beim Erfassen in `enter-score.tsx`. Live im Browser mit 4
    Mitgliedern und 3 Zehnerwerten getestet: Vorschau beim Erfassen,
    tatsächlich gebuchte `transaction`-Zeilen und Anzeige in
    `events.tsx`/`termin-statistik.tsx` stimmen exakt überein; nach
    Bearbeiten (ein Zehnerwert von "drüber" auf "genau" geändert)
    wurden die `strafe`-Beträge korrekt ersetzt (keine Duplikate, altes
    Kegelgeld blieb unverändert bestehen); nach Löschen des Termins
    (`delete_event`) waren `game`/`zehner_milestone`/`transaction`
    vollständig und ohne Reste entfernt.
27. **`announcements`** – Ankündigungen (letzter noch fehlender
    Kernbereich aus dem ursprünglichen Projektziel). Neue Tabelle
    `announcement` (club_id, author_member_id, title, body,
    created_at). Reines CRUD wie `penalty_rule` (Migration 17) – kein
    RPC nötig, RLS regelt die Berechtigung direkt:
    `announcement_select_same_club` (alle Mitglieder des Clubs lesen),
    `announcement_write_staff` (nur Admin/Kassierer schreiben/
    bearbeiten/löschen, über die bestehende `auth_staff_club_ids()`).
    `author_member_id` ist `on delete set null` – eine Ankündigung
    bleibt auch erhalten, wenn das verfassende Mitglied später aus dem
    Club entfernt wird (zeigt dann "Unbekannt" als Autor, siehe
    App-Code). Live im Browser mit Admin- und regulärem Mitglied-
    Account verifiziert: Admin kann posten/bearbeiten/löschen,
    reguläres Mitglied sieht dieselbe Ankündigung, aber weder
    Erfassungsformular noch Bearbeiten-/Löschen-Links (RLS +
    `isStaff`-Check greifen beide korrekt).

## Kern-Datenmodell (Ausgangspunkt, teils noch nicht als Migration umgesetzt)

- `club` – Mandant/Verein (id, name, invite_code, created_at) ✅ umgesetzt
- `member` – Mitglied (id, club_id, user_id→auth.users, display_name,
  role, joined_at) ✅ umgesetzt
- `event` – Termin (id, club_id, type, title, starts_at, location, status,
  series_id, series_occurrence_date, series_overridden, archived_at)
  ✅ umgesetzt. `status` ('geplant'/'abgeschlossen'/'abgesagt') ist seit
  Migration 20 auch tatsächlich in der UI setzbar (Termin absagen). Die
  drei `series_*`-Spalten verknüpfen einen generierten Termin optional
  mit seiner Serie (siehe `event_series` unten). `archived_at`
  (Migration 23) trackt manuelles Archivieren; `club.auto_archive_days`
  steuert zusätzlich automatisches Archivieren nach Alter, siehe
  Migration 23.
- `event_series` – Regeltermine/Serien-Kegelabende (id, club_id, title,
  location, frequency, interval_weeks, weekday, monthly_occurrence,
  time_of_day, starts_on, active) ✅ umgesetzt (Migration 20).
- `guest` – Gastkegler ohne Konto — noch offen
- `attendance` – Zu-/Absage pro Event und Mitglied (id, event_id,
  member_id, status, responded_at, checked_in_at) ✅ umgesetzt. Die
  echte "war wirklich da"-Anwesenheitserfassung ist seit Migration 24
  über `checked_in_at` (unabhängig von `status`) ebenfalls umgesetzt.
- `game` – ein gespieltes Spiel pro Event (id, club_id, event_id, type,
  description, penalty_max_cents, penalty_mode, penalty_step_cents,
  penalty_step_percent, zehner_max_pins, zehner_step_cents) ✅
  umgesetzt. Vier Spieltypen: `kleine_hausnummer`/`grosse_hausnummer`
  (3 Würfe zu einer 3-stelligen Zahl, Sieger = größte bzw. kleinste
  Zahl, Rang-abhängige Strafformel), `freitext` (`description` = freier
  Spielname/-beschreibung, keine Formel – Strafe pro Mitglied wird
  direkt eingegeben) und `zehner` ("10er-Spiel", Migration 26 –
  gemeinsame laufende Pin-Summe, gestaffelte Strafe je erreichtem
  Zehnerwert, Details siehe dort und `zehner_milestone` unten).
- `zehner_milestone` – ein Eintrag pro erreichtem Zehnerwert im
  10er-Spiel (id, club_id, game_id, milestone, thrower_member_id,
  hit_exact) ✅ umgesetzt (Migration 26). Ersetzt für diesen Spieltyp
  `score` (dort keine per-Mitglied-Ergebnisse, sondern per-Zehnerwert-
  Einträge).
- `score` – Ergebnis pro Mitglied und Spiel (id, club_id, game_id,
  member_id, pins) ✅ umgesetzt (nicht für `type = 'zehner'` genutzt,
  siehe `zehner_milestone` oben). Bei den Hausnummer-Spielen steht hier
  die fertige 3-stellige Zahl (0–999), nicht die einzelnen Würfe.
- `penalty_rule` – freier Strafenkatalog pro Club (id, club_id, name,
  amount_cents, has_king_surcharge, king_surcharge_cents) ✅ umgesetzt
  (Migration 17, Zuschlag-Spalten Migration 18). Unabhängig von der
  Hausnummer-Strafformel (Maximalbetrag + feste/prozentuale Reduzierung
  pro Rang, `club.hausnummer_penalty_*`, pro Aufruf über
  `record_game_scores`/`update_game_scores` überschreibbar), die weiterhin
  nur die zwei Hausnummer-Spiele bedient. `has_king_surcharge`/
  `king_surcharge_cents` steuern den "Pumpenkönig"-Zuschlag: wer an
  einem Termin die meisten Buchungen dieser Strafart hat, zahlt
  zusätzlich diesen Betrag (siehe `club.king_surcharge_tie_mode` unten
  für das Gleichstand-Verhalten).
- `penalty` – Strafenkatalog-Buchung pro Termin und Mitglied (id,
  club_id, event_id, member_id, penalty_rule_id, rule_name,
  unit_amount_cents, count) ✅ umgesetzt (Migration 17). Snapshot von
  Name/Betrag zum Buchungszeitpunkt, `count` = wie oft diese Strafart an
  diesem Kegelabend fällig wurde. Sonstige manuelle Ad-hoc-Buchungen
  laufen weiterhin direkt über `transaction`.
- `transaction` – Kassenbuch (id, club_id, member_id, event_id, game_id,
  type, amount_cents, note, paid, penalty_id,
  king_surcharge_penalty_rule_id, late_checkin_attendance_id)
  ✅ umgesetzt. Typen:
  `einzahlung` (manuelle Bareinzahlung), `kegelgeld` (automatische
  Teilnahmegebühr, eindeutig pro Termin), `strafe` (automatisch über
  Hausnummer-Formel/Freitext/Strafenkatalog oder manuell), `ausgabe`,
  `gutschrift`. `einzahlung`/`kegelgeld`/`strafe`
  zählen alle **positiv** zum Gesamtbetrag eines Mitglieds (alles Geld,
  das in die Kasse eingezahlt wird), `gutschrift`/`ausgabe` negativ –
  kein Bankkonto-Gegeneinander-Verrechnen (siehe Migration 13). `paid`
  trackt unabhängig davon, ob physisch bezahlt wurde. `penalty_id`
  (Migration 17) verknüpft eine automatische Strafenkatalog-Buchung mit
  ihrer `penalty`-Zeile; `king_surcharge_penalty_rule_id` (Migration 18)
  markiert eine automatische Pumpenkönig-Zuschlag-Buchung (keine eigene
  `penalty`-Zeile, da abgeleitet); `late_checkin_attendance_id`
  (Migration 25) markiert eine automatische Verspätungsstrafe-Buchung
  (ebenfalls keine eigene `penalty`-Zeile) und verknüpft sie mit der
  `attendance`-Zeile, deren Check-in-Zeit sie ausgelöst hat. Automatische
  Buchung von Kegelgeld/Hausnummer-Strafe über
  `record_game_scores`/`update_game_scores`, Strafenkatalog +
  Pumpenkönig-Zuschlag über
  `record_event_penalties`, Verspätungsstrafe über `check_in`; manuelle
  Buchungen
  (Bareinzahlung, Ausgabe, Ad-hoc-Strafe) sind über die
  `transaction_write_staff`-Policy möglich, aber noch ohne eigenen
  Screen (bisher nur die automatischen Buchungen haben eine UI).
- `fee`/`invoice` – Beiträge/Rechnungen inkl. SEPA-Status — noch offen
- `team` / `team_member` – Mannschaften — noch offen
- `announcement` – Ankündigungen (id, club_id, author_member_id,
  title, body, created_at) ✅ umgesetzt (Migration 27). Admin/
  Kassierer posten, alle Mitglieder des Clubs lesen.

Statistiken/Ranglisten (`statistik.tsx`) werden entgegen der
ursprünglichen Planung **clientseitig** aus `score`/`game`/`attendance`/
`penalty`/`penalty_rule` aggregiert, nicht über Postgres Views – analog
zum bereits etablierten Muster in `kasse.tsx`/`strafenkatalog.tsx`
("Gesamtliste"): eine View würde automatisch RLS umgehen (siehe
Kegelkasse-Hinweis oben) und ist bei den hier verwendeten, ohnehin
club-weit lesbaren Tabellen (`score`, `game`, `attendance`, `penalty`,
`penalty_rule` – alle mit "sichtbar für alle Mitglieder desselben
Clubs"-Policy) auch nicht nötig. Einzige Ausnahme: das
Kegelkasse-Ranking braucht `transaction`, das per RLS nur Admin/
Kassierer vollständig sehen (`transaction_select_staff`) – diese
Sektion ist deshalb clientseitig auf Admin/Kassierer beschränkt,
genau wie in `kasse.tsx`.

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
  führenden Nullen auf 3 Stellen, bei `freitext`/`zehner` als
  Euro-Betrag formatiert (`formatScore()`); bei `freitext` steht
  zusätzlich die `game.description` in der Kopfzeile des
  Ergebnisblocks. Bei `zehner` sind die "Scores" pro Mitglied keine
  `score`-Zeilen (die gibt es für diesen Spieltyp nicht), sondern
  client-seitig aus den club-weit lesbaren `zehner_milestone`-Zeilen
  über `computeZehnerPenalties()` berechnete Strafbeträge – bewusst
  nicht aus `transaction` gelesen, aus demselben Grund wie beim
  Pumpenkönig-Zuschlag (siehe `kingSurcharge.ts` unten).
  Admins/Kassierer sehen pro `game` zusätzlich "Bearbeiten" (→
  `/enter-score` mit `gameId`-Param) und "Löschen" (zwei Taps als
  Bestätigung – lokaler `confirmingGameId`-State statt `Alert`/Modal,
  ruft die RPC `delete_game`). Erfasste Strafenkatalog-Buchungen
  (`penalty`) werden pro Termin ebenfalls angezeigt (Name der Strafart,
  Anzahl, Gesamtbetrag); Admins/Kassierer sehen zusätzlich den Link
  "Strafen erfassen" (→ `/enter-penalties` mit `eventId`-Param). Links
  zu "Ankündigungen" (Migration 27), "Kegelkasse", "Strafenkatalog" und
  "Statistik" (für alle Mitglieder sichtbar) stehen oberhalb der
  Terminliste. Pumpenkönig-
  Krönungen werden ebenfalls pro Termin angezeigt (👑-Symbol,
  `<Strafart>-König`) – über `computeKingCrowns()` aus `penalty`
  berechnet, **nicht** aus `transaction` gelesen (siehe
  `kingSurcharge.ts` unten: ein früherer Bug hier ließ reguläre
  Mitglieder Krönungen anderer Mitglieder nicht sehen, da
  `transaction` per RLS auf eigene Buchungen beschränkt ist). Jeder
  Termin hat außerdem einen Link "Statistik" (für alle Mitglieder
  sichtbar, → `/termin-statistik` mit `eventId`-Param). Admins/
  Kassierer sehen pro Termin zusätzlich "Verschieben" (→
  `/create-event` mit `eventId`-Param, siehe dort), "Absagen" (zwei
  Taps als Bestätigung, setzt `event.status = 'abgesagt'` direkt per
  `update` – RLS erlaubt das bereits über `event_write_admin_kassierer`,
  keine RPC nötig) und, falls der Termin zu einer noch aktiven Serie
  gehört, "Serie beenden" (setzt `event_series.active = false`, zwei
  Taps als Bestätigung; stoppt nur künftige Generierung, bestehende
  Termine bleiben). Ein abgesagter Termin zeigt "(abgesagt)" im Titel
  und blendet RSVP sowie "Ergebnisse/Strafen erfassen" aus; ein
  verschobener oder abgesagter Serientermin zeigt zusätzlich "weicht
  von Serie ab" (`event.series_overridden`). Bei jedem Laden rufen
  Admins/Kassierer für alle aktiven Serien des Clubs
  `generate_series_events(seriesId, heute + 6 Monate)` auf, damit eine
  Serie nie ausläuft (idempotent, siehe Migration 20). Admins/
  Kassierer sehen außerdem "Löschen" (zwei Taps als Bestätigung, ruft
  die RPC `delete_event` – entfernt den Termin inkl. aller zugehörigen
  Kassenbuchungen, siehe Migration 21 für die bekannte Einschränkung
  bei aktiven Serienterminen). Ein Umschalter "Archivierte Termine
  anzeigen" oben in der Liste blendet archivierte Termine ein/aus
  (`isEventArchived()`: `event.archived_at` gesetzt ODER
  `club.auto_archive_days` überschritten, siehe Migration 23); pro
  Termin zusätzlich "Archivieren"/"Aus Archiv holen" (direktes `update`
  auf `event.archived_at`, keine RPC nötig). Ein archivierter Termin
  zeigt "(archiviert)" im Titel. In der RSVP-Zeile gibt es zusätzlich
  einen dritten Button "Einchecken" (Self-Check-in, zeigt danach
  "Eingecheckt HH:MM"); für Admin/Kassierer zusätzlich der Link
  "Anwesenheit erfassen" (→ `/check-in` mit `eventId`-Param, siehe
  dort) zum Einchecken anderer Mitglieder und zum nachträglichen
  Anpassen der Check-in-Zeit. Das Self-Check-in ruft seit Migration 25
  die RPC `check_in` auf (statt eines direkten `upsert` auf
  `attendance`, siehe Migration 24) – nötig, weil dieselbe RPC danach
  die automatische Verspätungsstrafe neu berechnet (siehe Migration
  25).
- `kegelclub-app/src/app/check-in.tsx` – Admin/Kassierer sehen alle
  Mitglieder des Clubs mit RSVP-Status und Check-in-Zeit für den
  gegebenen Termin (Route-Param `eventId`) – ermöglicht Einchecken für
  Mitglieder ohne eigenes Smartphone am Tisch. Pro Mitglied ein
  Uhrzeit-Textfeld ("HH:MM") mit "Übernehmen" (setzt einen beliebigen,
  auch nachträglich korrigierten Zeitpunkt, kombiniert mit dem
  Termin-Datum), "Jetzt" (setzt die aktuelle Uhrzeit) und, falls schon
  eingecheckt, "Rückgängig" (setzt auf NULL zurück). Alle drei Aktionen
  laufen über dieselbe RPC `check_in(p_event_id, p_member_id,
  p_checked_in_at)` (Migration 25) statt eines direkten `upsert` auf
  `attendance` (frühere, jetzt überholte Beschreibung aus Migration 24)
  – die RPC prüft die Berechtigung (eigene Zeile oder Admin/Kassierer)
  selbst per eingebettetem Rollen-Check statt über RLS, da sie
  zusätzlich `security definer` die automatische Verspätungsstrafe
  (Replace-Muster über `transaction.late_checkin_attendance_id`) neu
  berechnen muss, was ein normaler Member per RLS nicht dürfte.
- `kegelclub-app/src/app/announcements.tsx` – Ankündigungen (Migration
  27), verlinkt von `events.tsx`. Alle Mitglieder sehen die Liste
  (neueste zuerst, Titel/Text/Autor/Datum). Admin/Kassierer sehen
  zusätzlich ein Formular zum Posten (Titel + mehrzeiliger Text, reines
  `insert` in `announcement`, keine RPC nötig) sowie pro Ankündigung
  "Bearbeiten" (klappt dieselben zwei Felder inline in-place auf,
  lokaler `editingId`-State statt Route-Param, da es sich um eine Liste
  und nicht einen einzelnen Datensatz handelt) und "Löschen" (zwei Taps
  als Bestätigung, analog zu `confirmingGameId` in `events.tsx`).
- `kegelclub-app/src/app/create-event.tsx` – legt einen Kegelabend
  (`event`, `type: 'kegelabend'`) für den eigenen Club an; Datum/
  Uhrzeit aktuell als zwei Text-Felder (`TT.MM.JJJJ` / `HH:MM`, siehe
  `@/lib/date`), kein Date-Picker-Package eingebunden – das Feld
  akzeptiert nur noch das deutsche Datumsformat (vorher `JJJJ-MM-TT`);
  intern wird per `germanDateToIso()` weiterhin mit ISO-Datumsstrings
  gearbeitet (u.a. für `create_event_series`). Bedient drei Modi über das optionale
  Router-Param `eventId`: ohne `eventId` und ohne "Regeltermin"-Haken →
  einzelner Termin (`insert` in `event`); ohne `eventId` mit
  "Regeltermin"-Haken → ruft `create_event_series` (Frequenz-Umschalter
  Wöchentlich/Monatlich; bei Wöchentlich zusätzlich "Alle wie viele
  Wochen?"; bei Monatlich wird der Wochentag automatisch aus dem
  gewählten Startdatum abgeleitet (kein eigener Wochentag-Picker
  nötig), das Vorkommen im Monat ist standardmäßig ebenfalls abgeleitet
  ("n-tes Vorkommen"), per zusätzlicher Checkbox "Letzter Wochentag im
  Monat" aber auf den eigenen Modus `monthly_occurrence = -1`
  umschaltbar (für "jeden letzten Freitag im Monat" o.ä., siehe
  Migration 22 – ohne diesen Modus würde ein als "5." abgeleiteter
  Monat in jedem 4-Vorkommen-Monat übersprungen). Vorschautext zeigt
  die abgeleitete Regel an, z.B. "Wiederholt sich jeden ersten Freitag
  im Monat." bzw. "…jeden letzten Freitag im Monat."); mit `eventId` → bearbeitet einen
  einzelnen (ggf. generierten) Termin direkt per `update` auf `event`
  (Titel/Datum/Uhrzeit/Ort) und setzt `series_overridden = true`, falls
  er zu einer Serie gehört. Beim Laden zum Bearbeiten werden Datum/
  Uhrzeit bewusst über lokale `Date`-Getter (`getFullYear`/`getHours`/…)
  statt über `toISOString()` gebildet – letzteres liefert UTC und zeigte
  im Formular eine falsche (um die Zeitzone verschobene) Uhrzeit an,
  echter Bug, live im Browser gefunden und gefixt.
- `kegelclub-app/src/app/enter-score.tsx` – Admin/Kassierer wählen
  Kleine/Große Hausnummer und tragen pro Mitglied drei Ziffern
  (Hunderter/Zehner/Einer) ein, die zur 3-stelligen Hausnummer
  zusammengerechnet werden (leere Mitglieder werden nicht
  mitgeschickt). Die drei Ziffernfelder haben `selectTextOnFocus`: eine
  bereits gefüllte Ziffer wird beim Antippen automatisch markiert, ein
  neuer Tastendruck überschreibt sie direkt (vorher musste man erst
  manuell leeren – behobene UX-Kleinigkeit, siehe "Offene Punkte"
  früherer Stand). Strafe wird über drei Felder eingegeben:
  Maximalbetrag (€), ein Umschalter "Fester Betrag"/"Prozentual" und
  ein Reduzierungswert (dessen Einheit sich mit dem Umschalter
  ändert – beim Wechsel wird der Wert automatisch auf den zum neuen
  Modus passenden Club-Standard zurückgesetzt, um eine falsch
  interpretierte Zahl zu vermeiden). Alle drei Felder werden beim
  Laden mit `club.hausnummer_penalty_*` vorbelegt und beim Speichern
  immer explizit mitgeschickt (keine "leer = Standard"-Logik mehr).
  Bedient zwei Modi über das optionale Router-Param `gameId`: ohne
  `gameId` → anlegen, ruft `record_game_scores` (Event-ID kommt als
  Router-Param von `events.tsx`); mit `gameId` → bearbeiten, lädt
  zuerst Typ/Scores/Strafformel-Snapshot des bestehenden `game` zum
  Vorausfüllen und ruft `update_game_scores`. Dritte Spieltyp-Option
  "Freitext" schaltet auf ein komplett anderes Eingabe-Layout um
  (`isFreitext`-Zweig): ein Textfeld für die Spielbeschreibung statt
  Hunderter/Zehner/Einer, und pro Mitglied ein einzelnes Euro-Feld für
  die Strafe statt der Formel-Felder (leer = nicht teilgenommen, 0 =
  teilgenommen ohne Strafe) – ruft `record_freitext_game`/
  `update_freitext_game` statt `record_game_scores`/`update_game_scores`.
  Vierte Spieltyp-Option "10er-Spiel" (`isZehner`-Zweig, Migration 26):
  zwei Felder "Maximalzahl an Pins"/"Strafe je Zehnerwert (€)" (beim
  Laden mit `club.zehner_max_pins`/`zehner_step_cents` vorbelegt),
  danach eine Zeile pro Zehnerwert (aus der Maximalzahl abgeleitet,
  `zehnerMilestoneList`) mit Mitglieder-Chips zur Werfer-Auswahl plus
  zwei Buttons "Genau getroffen"/"Drübergeworfen". Eine Live-Vorschau
  darunter zeigt die daraus resultierenden Strafbeträge pro Mitglied
  (`computeZehnerPenalties()` aus `@/lib/zehnerSpiel`, dieselbe
  Funktion, die auch server-seitig – als SQL nachgebaut, siehe
  Migration 26 – tatsächlich bucht, damit Vorschau und Buchung
  garantiert übereinstimmen). Ruft `record_zehner_game`/
  `update_zehner_game`; beim Bearbeiten werden zusätzlich die
  bestehenden `zehner_milestone`-Zeilen des Spiels geladen und
  vorausgefüllt.
- `kegelclub-app/src/app/kasse.tsx` – Admin/Kassierer sehen den
  Gesamtbetrag aller Mitglieder (aus `transaction` client-seitig
  aufsummiert, `einzahlung`/`kegelgeld`/`strafe` positiv), reguläre
  Mitglieder
  sehen nur ihren eigenen Gesamtbetrag + eigene Buchungshistorie
  (RLS-Trennung, siehe `transaction_select_own`/`_staff`). Zeigt
  zusätzlich "davon offen: X €" wenn nicht alles bezahlt ist; Admin/
  Kassierer haben einen "Als bezahlt markieren"-Button pro Mitglied
  (setzt `paid=true` für alle offenen Buchungen dieses Mitglieds auf
  einmal – kein Einzel-Toggle pro Buchung). Admin/Kassierer sehen
  zusätzlich das Formular "Buchung erfassen": Mitglied (Chip-Auswahl),
  Typ (Einzahlung/Ausgabe/Strafe/Gutschrift), Betrag, optionale Notiz
  – speichert direkt per `insert` in `transaction` (keine RPC nötig,
  reines CRUD über die bereits vorhandene `transaction_write_staff`-
  Policy) für Fälle außerhalb der automatischen Buchungen (z.B.
  Bareinzahlung des Jahresbeitrags, Ausgabe für neue Kegel,
  Ad-hoc-Korrektur). Eine Buchung pro Formular-Absenden, bewusst ohne
  Sammelbuchungs-Funktion (z.B. "Jahresbeitrag für alle auf einmal")
  als erste, einfache Version.
- `kegelclub-app/src/app/club-settings.tsx` – Admin/Kassierer
  bearbeiten `club.kegelgeld_cents` und die Hausnummer-Strafformel-
  Standardwerte (Maximalbetrag, Modus, Reduzierung) direkt in der App
  – vorher nur über die Datenbank änderbar. Selbes Formel-Formular
  wie in `enter-score.tsx` (Maximalbetrag/Modus-Umschalter/Reduzierung
  mit Reset beim Moduswechsel), nur dass hier der Club-**Standard**
  selbst gespeichert wird statt eines Overrides für ein einzelnes
  Spiel. Zusätzlich `club.king_surcharge_tie_mode` (Migration 18): drei
  Buttons "Alle zahlen"/"Keiner zahlt"/"Zuschlag wird geteilt" für das
  Gleichstand-Verhalten des Pumpenkönig-Zuschlags. Zusätzlich
  `club.auto_archive_days` (Migration 23): Zahlenfeld "Termine
  automatisch archivieren nach (Tage, leer = deaktiviert)". Zusätzlich
  (Migration 25) eine Checkbox "Verspätungsstrafe aktivieren (beim
  Einchecken automatisch gebucht)": aktiviert, schaltet einen
  Modus-Umschalter "Pauschal"/"Pro Intervall" frei
  (`club.late_penalty_mode`) – bei "Pauschal" ein Euro-Feld
  (`late_penalty_cents`), bei "Pro Intervall" zwei Felder "Alle wie
  viele Minuten"/"Betrag je Intervall (€)"
  (`late_penalty_interval_minutes`/`_cents`). Deaktiviert setzt
  `late_penalty_mode` auf NULL (keine automatische Strafe). Zusätzlich
  (Migration 26) zwei Felder "Maximalzahl an Pins"/"Strafe je
  Zehnerwert (€)" als Club-Standard fürs 10er-Spiel
  (`zehner_max_pins`/`zehner_step_cents`, pro Ergebniserfassung in
  `enter-score.tsx` überschreibbar). Verlinkt
  von `events.tsx` (nur für Admin/Kassierer sichtbar).
- `kegelclub-app/src/app/strafenkatalog.tsx` – Verwaltung des freien
  Strafenkatalogs: alle Mitglieder sehen die Liste der `penalty_rule`-
  Einträge (Name + Betrag) sowie die "Gesamtliste" (Summe Anzahl/Betrag
  je Strafart und Mitglied über alle Termine, client-seitig aus
  `penalty` aggregiert). Admin/Kassierer sehen zusätzlich ein Formular
  zum Anlegen neuer Strafarten (`insert` direkt in `penalty_rule`, keine
  RPC nötig – reines CRUD ohne Query-übergreifende Logik) und einen
  "Löschen"-Link pro Strafart (historische `penalty`-Buchungen bleiben
  durch den Snapshot in `rule_name`/`unit_amount_cents` unverändert
  lesbar, siehe Migration 17). Das Formular hat zusätzlich eine
  Checkbox "Pumpenkönig-Zuschlag" mit Betragsfeld (Migration 18); Regeln
  mit aktivem Zuschlag zeigen ihn in der Liste mit 👑-Symbol an.
- `kegelclub-app/src/app/enter-penalties.tsx` – Admin/Kassierer tragen
  pro Termin (Route-Param `eventId`) für jedes Mitglied und jede
  Strafart eine Anzahl ein (Grid: Zeilen = Mitglieder, Spalten =
  `penalty_rule`); leer/0 = keine Buchung. Lädt bestehende `penalty`-
  Zeilen des Termins zum Vorausfüllen (unterstützt Korrektur). Speichern
  ruft immer `record_event_penalties` (Delete-und-Neu-Buchen, dieselbe
  RPC für Erst- und Korrekturerfassung). Ohne Strafarten im Club zeigt
  die Seite einen Hinweis, zuerst den Strafenkatalog zu befüllen.
- `kegelclub-app/src/app/statistik.tsx` – Club-weite Statistik/
  Ranglisten in vier Abschnitten, mit **Zeitraum-Filter** oben auf der
  Seite (Idee aus "Offene Punkte" umgesetzt): drei Modus-Buttons
  "Gesamte Historie"/"Kalenderjahr"/"Zeitraum". Bei "Kalenderjahr" ein
  Jahres-Textfeld (Default: aktuelles Jahr), bei "Zeitraum" zwei
  "Von"/"Bis"-Felder im Format `TT.MM.JJJJ` (`@/lib/date`) – beide
  Modi mit explizitem "Anwenden"-Button (kein Reload pro Tastendruck).
  Der Filter wirkt technisch nur auf `event.starts_at` (client-seitig
  gegen die geladenen `event`-Zeilen geprüft, nicht per SQL-`gte`/`lte`
  – einfacher als eine zweite Query-Variante zu pflegen): daraus
  ergibt sich die gefilterte `eventIds`-Liste, an der alle anderen
  Abfragen (attendance/game/score/penalty, ohnehin schon per
  `event_id in (...)` gescoped) automatisch hängen, sowie – nur bei
  aktivem Filter – zusätzlich die `transaction`-Abfrage fürs
  Kegelkasse-Ranking (`event_id in eventIds`); bei "Gesamte Historie"
  bleibt die Kegelkasse-Abfrage ungefiltert wie zuvor. **Bekannte
  Einschränkung:** manuelle Ad-hoc-Buchungen ohne Termin-Bezug
  (Jahresbeitrag, Ausgabe, siehe `kasse.tsx`) haben kein `event_id` und
  fließen deshalb nur bei "Gesamte Historie" ins Kegelkasse-Ranking
  ein, nicht in eine Jahres-/Zeitraum-Auswertung. Die vier Abschnitte
  selbst unverändert: **Kegelkasse-Ranking** (Gesamtbetrag je Mitglied
  absteigend, nur Admin/Kassierer sichtbar, siehe Hinweis oben);
  **Hausnummer-Bestleistungen** (persönlicher Bestwert je Mitglied und
  Spielart – höchster Wert bei `grosse_hausnummer`, niedrigster bei
  `kleine_hausnummer` –, für alle sichtbar); **Teilnahmequote**
  (Zusage-Quote aus `attendance` vs. tatsächliche Teilnahme = Anteil
  der Termine mit mindestens einem `score`-Eintrag in irgendeinem
  Spiel, sortiert nach Teilnahme-Quote); **Strafenkatalog-Rangliste**
  (Gesamtzahl/-betrag aller `penalty`-Buchungen je Mitglied
  absteigend, plus "Königs-Bilanz": wie oft war wer schon
  "`<Strafart>`-König", über `computeKingCrowns()` berechnet).
- `kegelclub-app/src/app/termin-statistik.tsx` – dieselbe Idee wie
  `statistik.tsx`, aber auf **einen einzelnen Termin** beschränkt
  (Route-Param `eventId`, verlinkt von `events.tsx`), Reihenfolge der
  Abschnitte: **Anwesenheit** (Zugesagt/Abgesagt/Offen je mit
  Namensliste – Mitglieder ohne `attendance`-Zeile gelten als "Offen";
  eingecheckte Mitglieder zeigen zusätzlich "(✓ HH:MM)" hinter dem
  Namen, siehe Migration 24); **Strafen dieses Abends** (Ranking + "Königs des
  Abends"); **Kassen-Auswirkung dieses Abends** (nur Admin/Kassierer,
  analog zum Kegelkasse-Ranking in `statistik.tsx`); **Ergebnisse**
  je `game` dieses Termins (bewusst zuletzt), bei den Hausnummer-Typen
  mit Platzierung (1./2./...) sortiert nach Sieg-Richtung, bei
  `freitext` unsortiert (kein kompetitiver Vergleich), bei `zehner`
  absteigend nach Strafbetrag (aus `zehner_milestone` über
  `computeZehnerPenalties()` berechnet, analog zu `events.tsx`).
- `kegelclub-app/src/lib/kingSurcharge.ts` – `computeKingCrowns()`:
  gemeinsam genutzte Hilfsfunktion, die Pumpenkönig-Krönungen aus
  `penalty` + `penalty_rule` (has_king_surcharge/king_surcharge_cents)
  + `club.king_surcharge_tie_mode` rekonstruiert (alle drei club-weit
  lesbar) – spiegelt exakt die Gleichstand-Logik aus
  `record_event_penalties` (Migration 18), liefert aber dasselbe
  Ergebnis **ohne** `transaction` zu lesen. Bewusst ausgelagert und von
  `events.tsx`, `statistik.tsx` und `termin-statistik.tsx` gemeinsam
  genutzt, nachdem `events.tsx` ursprünglich fälschlich direkt aus
  `transaction` las: `transaction_select_own` beschränkt reguläre
  Mitglieder dort auf eigene Buchungen, wodurch sie Krönungen anderer
  Mitglieder nicht sahen (echter RLS-Bug, per Migration nicht nötig zu
  fixen, da rein clientseitig – siehe Commit-Historie).
- `kegelclub-app/src/lib/member.ts` – `getCurrentMember()`: liest die
  `member`-Zeile des eingeloggten Users (id, club_id, role,
  display_name). Nimmt aktuell die erste gefundene Zeile – Mitglieder
  in mehreren Clubs (Schema erlaubt das) werden noch nicht
  unterstützt, es gibt keine Club-Auswahl/-Switching-UI.
- `kegelclub-app/src/lib/money.ts` – `formatEuro()`/`centsToEuroString()`/
  `euroStringToCents()`, ausgelagert aus fünf Screens, die zuvor jeweils
  eigene (identische) Kopien dieser Funktionen hatten
  (`kasse.tsx`/`strafenkatalog.tsx`/`enter-penalties.tsx`/
  `events.tsx`/`statistik.tsx`/`termin-statistik.tsx`/`club-settings.tsx`/
  `enter-score.tsx`). Eingabefelder (z.B. Kegelgeld, Strafformel,
  Verspätungsstrafe) zeigen vorbelegte Beträge jetzt einheitlich mit
  Komma als Dezimaltrenner (`centsToEuroString`, z.B. "1,50" statt
  "1.50"); die Eingabe akzeptiert weiterhin sowohl Komma als auch Punkt
  (`euroStringToCents`).
- `kegelclub-app/src/lib/date.ts` – `dateToGermanString()`/
  `germanDateToIso()`: Datumsfelder, die der Nutzer direkt eintippt
  (aktuell nur `create-event.tsx`), verwenden das Format `TT.MM.JJJJ`
  statt des vorherigen `JJJJ-MM-TT` – näher an der in Deutschland
  üblichen Schreibweise. Intern wird weiterhin mit ISO-Datumsstrings
  (`JJJJ-MM-TT`) gearbeitet (u.a. für die RPC `create_event_series` und
  `new Date(...)`-Konstruktion), `germanDateToIso()` übersetzt die
  Nutzereingabe dorthin und liefert `null` bei ungültigem Format.
- `kegelclub-app/src/lib/zehnerSpiel.ts` – `computeZehnerPenalties()`
  (Migration 26): rekonstruiert die Strafenverteilung des 10er-Spiels
  (genau getroffen -> alle Teilnehmer außer Werfer zahlen,
  drübergeworfen -> nur der Werfer zahlt) aus einer Liste von
  Zehnerwert-Einträgen + der Schrittweite – spiegelt exakt die Logik
  aus `book_zehner_game()` in SQL. Gemeinsam genutzt von
  `enter-score.tsx` (Live-Vorschau beim Erfassen) sowie `events.tsx`/
  `termin-statistik.tsx` (Anzeige aus dem club-weit lesbaren
  `zehner_milestone`, ohne `transaction` lesen zu müssen – siehe
  `kingSurcharge.ts` für dieselbe Motivation).
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
   Hausnummer-Strafe als Maximalbetrag-minus-Reduzierung-Formel,
   fest oder prozentual, Kontostände nach Rolle getrennt sichtbar),
   ✅ Ergebnisse nachträglich bearbeiten/löschen, ✅ Freitext-Spieltyp,
   ✅ freier Strafenkatalog pro Club (erfasst pro Termin, mit
   Gesamtübersicht), ✅ "Pumpenkönig"-Zuschlag (Gleichstand-Verhalten
   als Club-Einstellung). Damit ist der
   MVP-Umfang aus dem ursprünglichen Plan erreicht.
3. **Phase 2 – Ausbau:** ✅ Statistiken/Ranglisten (Kegelkasse-Ranking,
   Hausnummer-Bestleistungen, Teilnahmequote, Strafenkatalog-Rangliste
   inkl. Königs-Bilanz – über die gesamte Historie, noch ohne Saison-/
   Zeitraum-Filter, siehe "Offene Punkte"), ✅ Regeltermine/Serien-
   Kegelabende (wöchentlich/monatlich, mit Verschieben/Absagen einzelner
   Vorkommen und "Serie beenden"), ✅ Termine löschen + archivieren
   (manuell und automatisch nach Alter), ✅ Einchecken/Ankunftszeit
   erfassen (Self-Check-in + Staff-Check-in, admin-seitig nachträglich
   korrigierbare Check-in-Zeit) inkl. ✅ automatischer
   Verspätungsstrafe (pauschal oder pro Intervall, konfigurierbar in
   den Club-Einstellungen), ✅ "10er-Spiel" als vierter Spieltyp
   (gemeinsame laufende Pin-Summe, nach Zehnerwert gestaffelte Strafe),
   ✅ Ankündigungen (letzter noch fehlender Kernbereich aus dem
   ursprünglichen Projektziel, siehe Migration 27). Noch offen: weitere
   Spieltypen, Terminplanung mit Push, Live-Tafelmodus (Realtime).
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

- SEPA-Lastschrift-Anbindung im Detail (Gläubiger-ID, Mandatsverwaltung)
- Ob/wann self-hosted Supabase (Hetzner) statt Managed Supabase nötig wird
- Separate öffentliche Marketing-/Landingpage (Format noch offen)
