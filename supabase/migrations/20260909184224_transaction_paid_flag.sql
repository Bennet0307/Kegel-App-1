-- ============================================================
-- Migration: transaction_paid_flag
-- Ergänzt die Kegelkasse um einen "bezahlt"-Status pro Buchung.
-- Kegelgeld und Strafe sind nicht automatisch bar bezahlt, sondern
-- werden zunächst nur verbucht (fällig) und später vom Kassierer als
-- bezahlt markiert. Der Gesamtbetrag (alle Buchungen) bleibt davon
-- unberührt – "bezahlt" ist eine zusätzliche Information, keine
-- Korrektur der Summe.
-- ============================================================

alter table transaction add column paid boolean not null default false;
comment on column transaction.paid is
  'Ob diese Buchung (z.B. Kegelgeld/Strafe) bereits an den Kassierer bezahlt wurde. Ändert nicht den gebuchten Betrag, nur den Bezahlt-Status.';
