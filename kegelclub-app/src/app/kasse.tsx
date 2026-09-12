import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentMember, type CurrentMember } from '@/lib/member';
import { euroStringToCents, formatEuro } from '@/lib/money';
import { supabase } from '@/lib/supabase';

type ManualType = 'einzahlung' | 'ausgabe' | 'strafe' | 'gutschrift';

const MANUAL_TYPES: { value: ManualType; label: string }[] = [
  { value: 'einzahlung', label: 'Einzahlung' },
  { value: 'ausgabe', label: 'Ausgabe' },
  { value: 'strafe', label: 'Strafe' },
  { value: 'gutschrift', label: 'Gutschrift' },
];

type TransactionRow = {
  id: string;
  member_id: string | null;
  type: 'einzahlung' | 'ausgabe' | 'strafe' | 'gutschrift' | 'kegelgeld';
  amount_cents: number;
  note: string | null;
  created_at: string;
  paid: boolean;
};

const TYPE_LABELS: Record<TransactionRow['type'], string> = {
  einzahlung: 'Einzahlung',
  ausgabe: 'Ausgabe',
  strafe: 'Strafe',
  gutschrift: 'Gutschrift',
  kegelgeld: 'Kegelgeld',
};

// Kegelgeld und Strafe sind beides Geld, das Mitglieder in die Kasse
// einzahlen (kein Gegeneinander-Verrechnen wie bei einem Bankkonto) –
// beide zählen positiv zum Gesamtbetrag. Gutschrift/Ausgabe reduzieren
// ihn (Korrektur bzw. Auszahlung aus der Kasse).
function signedCents(row: TransactionRow) {
  return row.type === 'einzahlung' || row.type === 'strafe' || row.type === 'kegelgeld'
    ? row.amount_cents
    : -row.amount_cents;
}

export default function KasseScreen() {
  const theme = useTheme();
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [settlingMemberId, setSettlingMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [bookingMemberId, setBookingMemberId] = useState<string | null>(null);
  const [bookingType, setBookingType] = useState<ManualType>('einzahlung');
  const [bookingAmount, setBookingAmount] = useState('');
  const [bookingNote, setBookingNote] = useState('');
  const [booking, setBooking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const currentMember = await getCurrentMember();
    if (!currentMember) {
      setLoading(false);
      setError('Kein Club gefunden.');
      return;
    }
    setMember(currentMember);

    const isStaff = currentMember.role === 'admin' || currentMember.role === 'kassierer';

    const { data: transactionRows, error: transactionsError } = await supabase
      .from('transaction')
      .select('id, member_id, type, amount_cents, note, created_at, paid')
      .order('created_at', { ascending: false });

    if (transactionsError) {
      setLoading(false);
      setError(transactionsError.message);
      return;
    }

    if (isStaff) {
      const { data: memberRows } = await supabase
        .from('member')
        .select('id, display_name')
        .eq('club_id', currentMember.club_id);

      const nameMap: Record<string, string> = {};
      for (const row of memberRows ?? []) {
        nameMap[row.id] = row.display_name;
      }
      setMemberNames(nameMap);
      setMembers(memberRows ?? []);
    }

    setTransactions(transactionRows ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function markMemberAsPaid(memberId: string) {
    setSettlingMemberId(memberId);

    const { error: updateError } = await supabase
      .from('transaction')
      .update({ paid: true })
      .eq('member_id', memberId)
      .eq('paid', false);

    setSettlingMemberId(null);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    load();
  }

  async function handleAddBooking() {
    if (!member) return;
    if (!bookingMemberId) {
      setError('Bitte ein Mitglied auswählen.');
      return;
    }

    const cents = euroStringToCents(bookingAmount);
    if (Number.isNaN(cents) || cents <= 0) {
      setError('Bitte einen gültigen Betrag angeben.');
      return;
    }

    setBooking(true);
    setError(null);

    const { error: insertError } = await supabase.from('transaction').insert({
      club_id: member.club_id,
      member_id: bookingMemberId,
      type: bookingType,
      amount_cents: cents,
      note: bookingNote.trim() || null,
    });

    setBooking(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setBookingMemberId(null);
    setBookingType('einzahlung');
    setBookingAmount('');
    setBookingNote('');
    load();
  }

  if (loading) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ActivityIndicator />
        </SafeAreaView>
      </ThemedView>
    );
  }

  const isStaff = member?.role === 'admin' || member?.role === 'kassierer';

  if (isStaff) {
    const totalByMember: Record<string, number> = {};
    const openByMember: Record<string, number> = {};
    for (const row of transactions) {
      if (!row.member_id) continue;
      totalByMember[row.member_id] = (totalByMember[row.member_id] ?? 0) + signedCents(row);
      if (!row.paid) {
        openByMember[row.member_id] = (openByMember[row.member_id] ?? 0) + signedCents(row);
      }
    }

    return (
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <SafeAreaView style={styles.safeArea}>
            <ThemedText type="title" style={styles.title}>
              Kegelkasse
            </ThemedText>

            {error && <ThemedText style={styles.error}>{error}</ThemedText>}

            {Object.entries(totalByMember).map(([memberId, cents]) => {
              const openCents = openByMember[memberId] ?? 0;
              return (
                <ThemedView key={memberId} type="backgroundElement" style={styles.memberCard}>
                  <ThemedView style={styles.row}>
                    <ThemedText>{memberNames[memberId] ?? '?'}</ThemedText>
                    <ThemedText type="smallBold">{formatEuro(cents)}</ThemedText>
                  </ThemedView>

                  {openCents > 0 && (
                    <ThemedView style={styles.row}>
                      <ThemedText type="small" themeColor="textSecondary">
                        davon offen: {formatEuro(openCents)}
                      </ThemedText>
                      {settlingMemberId === memberId ? (
                        <ActivityIndicator />
                      ) : (
                        <Pressable onPress={() => markMemberAsPaid(memberId)}>
                          <ThemedText type="link">Als bezahlt markieren</ThemedText>
                        </Pressable>
                      )}
                    </ThemedView>
                  )}
                </ThemedView>
              );
            })}

            {Object.keys(totalByMember).length === 0 && (
              <ThemedText themeColor="textSecondary">Noch keine Buchungen.</ThemedText>
            )}

            <ThemedView style={styles.bookingSection}>
              <ThemedText type="smallBold">Buchung erfassen</ThemedText>

              <ThemedView style={styles.chipRow}>
                {members.map((memberRow) => (
                  <Pressable
                    key={memberRow.id}
                    style={[
                      styles.chip,
                      {
                        backgroundColor:
                          bookingMemberId === memberRow.id ? theme.backgroundSelected : theme.backgroundElement,
                      },
                    ]}
                    onPress={() => setBookingMemberId(memberRow.id)}>
                    <ThemedText type="small">{memberRow.display_name}</ThemedText>
                  </Pressable>
                ))}
              </ThemedView>

              <ThemedView style={styles.chipRow}>
                {MANUAL_TYPES.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[
                      styles.chip,
                      { backgroundColor: bookingType === option.value ? theme.backgroundSelected : theme.backgroundElement },
                    ]}
                    onPress={() => setBookingType(option.value)}>
                    <ThemedText type="small">{option.label}</ThemedText>
                  </Pressable>
                ))}
              </ThemedView>

              <TextInput
                value={bookingAmount}
                onChangeText={setBookingAmount}
                placeholder="Betrag in € (z.B. 10,00)"
                placeholderTextColor={theme.textSecondary}
                keyboardType="decimal-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />

              <TextInput
                value={bookingNote}
                onChangeText={setBookingNote}
                placeholder="Notiz (optional)"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />

              {booking ? (
                <ActivityIndicator />
              ) : (
                <Pressable style={[styles.button, { backgroundColor: theme.backgroundElement }]} onPress={handleAddBooking}>
                  <ThemedText type="smallBold">Buchung speichern</ThemedText>
                </Pressable>
              )}
            </ThemedView>
          </SafeAreaView>
        </ScrollView>
      </ThemedView>
    );
  }

  const ownTotal = transactions.reduce((sum, row) => sum + signedCents(row), 0);
  const ownOpen = transactions.filter((row) => !row.paid).reduce((sum, row) => sum + signedCents(row), 0);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Kegelkasse
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <ThemedText type="subtitle" style={styles.title}>
            {formatEuro(ownTotal)}
          </ThemedText>
          {ownOpen > 0 && (
            <ThemedText type="small" themeColor="textSecondary" style={styles.title}>
              davon offen: {formatEuro(ownOpen)}
            </ThemedText>
          )}

          {transactions.map((row) => (
            <ThemedView key={row.id} style={styles.row}>
              <ThemedText type="small">
                {TYPE_LABELS[row.type]}
                {row.note ? ` · ${row.note}` : ''}
                {row.paid ? '' : ' (offen)'}
              </ThemedText>
              <ThemedText type="small">{formatEuro(signedCents(row))}</ThemedText>
            </ThemedView>
          ))}

          {transactions.length === 0 && (
            <ThemedText themeColor="textSecondary">Noch keine Buchungen.</ThemedText>
          )}
        </SafeAreaView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
    alignSelf: 'stretch',
    maxWidth: 500,
  },
  title: {
    textAlign: 'center',
  },
  error: {
    color: '#d33',
  },
  memberCard: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  bookingSection: {
    gap: Spacing.two,
    marginTop: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
  input: {
    height: 48,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  button: {
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
