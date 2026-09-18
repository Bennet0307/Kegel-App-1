-- ============================================================
-- Migration: push_notifications
-- Terminplanung mit Push (Idee aus "Offene Punkte"/Roadmap Phase 2
-- umgesetzt) – Grundfunktion: Push-Benachrichtigung sofort beim
-- Anlegen eines neuen Kegelabends/Regeltermins. Eine Erinnerung vor
-- dem Termin selbst (zeitgesteuert) ist bewusst zurückgestellt (auf
-- Nutzerwunsch), da das einen Hintergrund-Job (pg_cron + Edge
-- Function) bräuchte statt eines simplen Client-seitigen Aufrufs.
--
-- Ein Gerätetoken pro Mitglied (einfachste erste Version, siehe
-- Kern-Datenmodell/App-Code) statt einer eigenen Tabelle für mehrere
-- Geräte – bei einem neuen Login auf einem anderen Gerät wird der
-- alte Token überschrieben.
-- ============================================================

alter table member add column push_token text;
comment on column member.push_token is
  'Expo-Push-Token des zuletzt für Push registrierten Geräts dieses Mitglieds (NULL = keine Push-Benachrichtigungen). Ein Token pro Mitglied, kein Multi-Geräte-Tracking.';

-- Kein direktes `update` auf `member` möglich (member_write_admin
-- erlaubt nur Admins, member zu schreiben) – eigene RPC, damit ein
-- Mitglied gezielt nur seinen eigenen push_token setzen kann, ohne
-- eine generische "eigene Zeile beschreibbar"-Policy einzuführen (die
-- sonst auch role/display_name für Selbst-Änderungen öffnen würde).
create or replace function register_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Nicht eingeloggt';
  end if;

  update member set push_token = p_token where user_id = auth.uid();
end;
$$;

revoke all on function register_push_token(text) from public;
grant execute on function register_push_token(text) to authenticated;
