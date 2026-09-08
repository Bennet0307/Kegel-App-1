-- ============================================================
-- Migration: join_club_by_invite_code
-- Beitritts-Flow für weitere Mitglieder (nicht der erste Admin):
-- Ein eingeloggter User gibt einen Einladungscode ein und wird
-- damit als 'mitglied' in den passenden Club eingetragen.
--
-- Bewusst als security-definer RPC statt als reine RLS-Policy:
-- Der Invite-Code selbst ist keine Spalte der einzufügenden
-- member-Zeile, RLS kann ihn also nicht direkt prüfen. Die
-- Funktion löst den Code atomar zur passenden club_id auf, prüft
-- Duplikate und fügt danach ein – als Tabellenbesitzer, damit sie
-- (wie auth_club_ids() etc.) nicht erneut mit member-RLS in
-- Konflikt gerät.
-- ============================================================

create or replace function join_club_by_invite_code(p_invite_code text)
returns table (club_id uuid, club_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_club_name text;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Nicht eingeloggt';
  end if;

  select id, name into v_club_id, v_club_name
  from club
  where invite_code = lower(trim(p_invite_code));

  if v_club_id is null then
    raise exception 'Ungültiger Einladungscode';
  end if;

  if exists (select 1 from member where member.club_id = v_club_id and member.user_id = auth.uid()) then
    raise exception 'Du bist bereits Mitglied in diesem Club';
  end if;

  select email into v_email from auth.users where id = auth.uid();

  insert into member (club_id, user_id, display_name, role)
  values (v_club_id, auth.uid(), coalesce(v_email, 'Mitglied'), 'mitglied');

  return query select v_club_id, v_club_name;
end;
$$;

revoke all on function join_club_by_invite_code(text) from public;
grant execute on function join_club_by_invite_code(text) to authenticated;
