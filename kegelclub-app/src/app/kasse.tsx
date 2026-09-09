import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { getCurrentMember, type CurrentMember } from '@/lib/member';
import { supabase } from '@/lib/supabase';

type TransactionRow = {
  member_id: string | null;
  type: 'einzahlung' | 'ausgabe' | 'strafe' | 'gutschrift';
  amount_cents: number;
  note: string | null;
  created_at: string;
};

const TYPE_LABELS: Record<TransactionRow['type'], string> = {
  einzahlung: 'Einzahlung',
  ausgabe: 'Ausgabe',
  strafe: 'Strafe',
  gutschrift: 'Gutschrift',
};

function signedCents(row: TransactionRow) {
  return row.type === 'einzahlung' || row.type === 'gutschrift' ? row.amount_cents : -row.amount_cents;
}

function formatEuro(cents: number) {
  return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export default function KasseScreen() {
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [transactions, setTransactions] = useState<TransactionRow[]>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
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
        .select('member_id, type, amount_cents, note, created_at')
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
    })();
  }, []);

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
    const balanceByMember: Record<string, number> = {};
    for (const row of transactions) {
      if (!row.member_id) continue;
      balanceByMember[row.member_id] = (balanceByMember[row.member_id] ?? 0) + signedCents(row);
    }

    return (
      <ThemedView style={styles.container}>
        <ScrollView contentContainerStyle={styles.scrollContent}>
          <SafeAreaView style={styles.safeArea}>
            <ThemedText type="title" style={styles.title}>
              Kegelkasse
            </ThemedText>

            {error && <ThemedText style={styles.error}>{error}</ThemedText>}

            {Object.entries(balanceByMember).map(([memberId, cents]) => (
              <ThemedView key={memberId} type="backgroundElement" style={styles.row}>
                <ThemedText>{memberNames[memberId] ?? '?'}</ThemedText>
                <ThemedText type="smallBold">{formatEuro(cents)}</ThemedText>
              </ThemedView>
            ))}

            {Object.keys(balanceByMember).length === 0 && (
              <ThemedText themeColor="textSecondary">Noch keine Buchungen.</ThemedText>
            )}
          </SafeAreaView>
        </ScrollView>
      </ThemedView>
    );
  }

  const ownBalance = transactions.reduce((sum, row) => sum + signedCents(row), 0);

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Kegelkasse
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <ThemedText type="subtitle" style={styles.title}>
            {formatEuro(ownBalance)}
          </ThemedText>

          {transactions.map((row, index) => (
            <ThemedView key={index} type="backgroundElement" style={styles.row}>
              <ThemedText type="small">
                {TYPE_LABELS[row.type]}
                {row.note ? ` · ${row.note}` : ''}
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
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
});
