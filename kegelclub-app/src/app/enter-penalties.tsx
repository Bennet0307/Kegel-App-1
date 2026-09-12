import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentMember } from '@/lib/member';
import { formatEuro } from '@/lib/money';
import { supabase } from '@/lib/supabase';

type Rule = { id: string; name: string; amount_cents: number };

export default function EnterPenaltiesScreen() {
  const theme = useTheme();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [counts, setCounts] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const currentMember = await getCurrentMember();
      if (!currentMember) {
        setLoading(false);
        setError('Kein Club gefunden.');
        return;
      }

      const [{ data: memberRows, error: membersError }, { data: ruleRows }, { data: penaltyRows }] =
        await Promise.all([
          supabase
            .from('member')
            .select('id, display_name')
            .eq('club_id', currentMember.club_id)
            .order('display_name', { ascending: true }),
          supabase
            .from('penalty_rule')
            .select('id, name, amount_cents')
            .eq('club_id', currentMember.club_id)
            .order('name', { ascending: true }),
          supabase
            .from('penalty')
            .select('member_id, penalty_rule_id, count')
            .eq('event_id', eventId),
        ]);

      if (membersError) {
        setError(membersError.message);
      } else {
        setMembers(memberRows ?? []);
      }

      setRules(ruleRows ?? []);

      const prefill: Record<string, Record<string, string>> = {};
      for (const row of penaltyRows ?? []) {
        if (!row.penalty_rule_id) continue;
        prefill[row.member_id] ??= {};
        prefill[row.member_id][row.penalty_rule_id] = String(row.count);
      }
      setCounts(prefill);

      setLoading(false);
    })();
  }, [eventId]);

  function setCount(memberId: string, ruleId: string, value: string) {
    const digits = value.replace(/[^0-9]/g, '');
    setCounts((prev) => ({
      ...prev,
      [memberId]: { ...(prev[memberId] ?? {}), [ruleId]: digits },
    }));
  }

  async function handleSave() {
    if (!eventId) {
      setError('Kein Kegelabend ausgewählt.');
      return;
    }

    const penalties: { member_id: string; penalty_rule_id: string; count: number }[] = [];
    for (const memberRow of members) {
      for (const rule of rules) {
        const value = counts[memberRow.id]?.[rule.id];
        if (!value) continue;
        const count = Number(value);
        if (count > 0) {
          penalties.push({ member_id: memberRow.id, penalty_rule_id: rule.id, count });
        }
      }
    }

    setSaving(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc('record_event_penalties', {
      p_event_id: eventId,
      p_penalties: penalties,
    });

    setSaving(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    router.replace('/events');
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

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Strafen erfassen
          </ThemedText>

          {rules.length === 0 ? (
            <ThemedText themeColor="textSecondary">
              Noch keine Strafarten im Club angelegt. Bitte zuerst im Strafenkatalog anlegen.
            </ThemedText>
          ) : (
            <>
              <ThemedView style={styles.headerRow}>
                <ThemedText style={styles.memberName} />
                {rules.map((rule) => (
                  <ThemedText key={rule.id} type="small" style={styles.ruleHeader}>
                    {rule.name}
                    {'\n'}
                    {formatEuro(rule.amount_cents)}
                  </ThemedText>
                ))}
              </ThemedView>

              {members.map((memberRow) => (
                <ThemedView key={memberRow.id} style={styles.memberRow}>
                  <ThemedText style={styles.memberName}>{memberRow.display_name}</ThemedText>
                  {rules.map((rule) => (
                    <TextInput
                      key={rule.id}
                      value={counts[memberRow.id]?.[rule.id] ?? ''}
                      onChangeText={(value) => setCount(memberRow.id, rule.id, value)}
                      placeholder="0"
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="number-pad"
                      style={[styles.countInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                  ))}
                </ThemedView>
              ))}
            </>
          )}

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          {rules.length > 0 &&
            (saving ? (
              <ActivityIndicator />
            ) : (
              <Pressable style={[styles.button, { backgroundColor: theme.backgroundElement }]} onPress={handleSave}>
                <ThemedText type="smallBold">Strafen speichern</ThemedText>
              </Pressable>
            ))}
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
    marginBottom: Spacing.two,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  ruleHeader: {
    width: 56,
    textAlign: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  memberName: {
    flex: 1,
  },
  countInput: {
    width: 56,
    height: 44,
    borderRadius: Spacing.two,
    fontSize: 16,
    textAlign: 'center',
  },
  error: {
    color: '#d33',
  },
  button: {
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
