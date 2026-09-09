import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getCurrentMember, type CurrentMember } from '@/lib/member';
import { supabase } from '@/lib/supabase';

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

function formatEuro(cents: number) {
  return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export default function KasseScreen() {
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [settlingMemberId, setSettlingMemberId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
});
