-- ============================================================
-- Migration: fix_member_write_admin_recursion
-- "member_write_admin" (member) und "club_update_admin" (club)
-- haben member bisher direkt abgefragt (select ... from member
-- where user_id = auth.uid() and role = 'admin'), statt über die
-- security-definer Hilfsfunktion. Sobald diese Policies tatsächlich
-- ausgewertet werden (z.B. beim Lesen von member), erzeugt das
-- "infinite recursion detected in policy for relation member",
-- weil die Auswertung der Policy selbst wieder RLS auf member
-- auslöst. Analog zu auth_club_ids() lösen wir das über eine
-- weitere security-definer Funktion.
-- ============================================================

create or replace function auth_admin_club_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select club_id from member where user_id = auth.uid() and role = 'admin';
$$;

drop policy "club_update_admin" on club;
create policy "club_update_admin"
  on club for update
  using (id in (select auth_admin_club_ids()));

drop policy "member_write_admin" on member;
create policy "member_write_admin"
  on member for all
  using (club_id in (select auth_admin_club_ids()))
  with check (club_id in (select auth_admin_club_ids()));
