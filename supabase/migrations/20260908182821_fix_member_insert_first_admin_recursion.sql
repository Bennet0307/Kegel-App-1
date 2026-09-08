-- ============================================================
-- Migration: fix_member_insert_first_admin_recursion
-- "member_insert_self_as_first_admin" prüft im WITH CHECK direkt
-- per Subquery auf member, ob der Club noch keine Mitglieder hat
-- (not exists (select 1 from member m where m.club_id = ...)).
-- Das ist derselbe Rekursions-Fehler wie in
-- fix_member_write_admin_recursion: die Auswertung der Policy auf
-- member löst wieder RLS auf member aus ("infinite recursion
-- detected in policy for relation member"). Lösung: Mitgliederzahl
-- über eine security-definer Funktion ermitteln, die RLS auf
-- member umgeht.
-- ============================================================

create or replace function club_member_count(target_club_id uuid)
returns bigint
language sql
security definer
stable
as $$
  select count(*) from member where club_id = target_club_id;
$$;

drop policy "member_insert_self_as_first_admin" on member;
create policy "member_insert_self_as_first_admin"
  on member for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and role = 'admin'
    and club_member_count(club_id) = 0
  );
