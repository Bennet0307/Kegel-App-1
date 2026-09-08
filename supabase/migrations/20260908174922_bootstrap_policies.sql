-- ============================================================
-- Migration: bootstrap_policies
-- Erlaubt: (1) jeder eingeloggte User darf einen neuen Club
-- anlegen, (2) der User darf sich selbst als ersten Admin
-- eintragen, wenn der Club noch keine Mitglieder hat.
-- ============================================================

-- Jeder eingeloggte User darf einen Club anlegen.
create policy "club_insert_authenticated"
  on club for insert
  to authenticated
  with check (true);

-- Ein User darf sich selbst als Mitglied eintragen, aber nur
-- als 'admin' und nur, solange der Club noch keine Mitglieder hat
-- (bootstrap des allerersten Admins). Für alle weiteren Mitglieder
-- greift stattdessen die bestehende "member_write_admin"-Policy
-- (ein existierender Admin muss sie hinzufügen).
create policy "member_insert_self_as_first_admin"
  on member for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'admin'
    and not exists (
      select 1 from member m where m.club_id = member.club_id
    )
  );