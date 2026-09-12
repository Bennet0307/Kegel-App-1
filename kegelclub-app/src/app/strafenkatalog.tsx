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

type PenaltyRule = {
  id: string;
  name: string;
  amount_cents: number;
  has_king_surcharge: boolean;
  king_surcharge_cents: number;
};
type PenaltyRow = { member_id: string; penalty_rule_id: string | null; rule_name: string; unit_amount_cents: number; count: number };

export default function StrafenkatalogScreen() {
  const theme = useTheme();
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [rules, setRules] = useState<PenaltyRule[]>([]);
  const [penalties, setPenalties] = useState<PenaltyRow[]>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newHasKingSurcharge, setNewHasKingSurcharge] = useState(false);
  const [newKingSurchargeAmount, setNewKingSurchargeAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStaff = member?.role === 'admin' || member?.role === 'kassierer';

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

    const [{ data: ruleRows, error: rulesError }, { data: penaltyRows }, { data: memberRows }] = await Promise.all([
      supabase
        .from('penalty_rule')
        .select('id, name, amount_cents, has_king_surcharge, king_surcharge_cents')
        .eq('club_id', currentMember.club_id)
        .order('name', { ascending: true }),
      supabase
        .from('penalty')
        .select('member_id, penalty_rule_id, rule_name, unit_amount_cents, count')
        .eq('club_id', currentMember.club_id),
      supabase.from('member').select('id, display_name').eq('club_id', currentMember.club_id),
    ]);

    if (rulesError) {
      setError(rulesError.message);
      setLoading(false);
      return;
    }

    const nameMap: Record<string, string> = {};
    for (const row of memberRows ?? []) {
      nameMap[row.id] = row.display_name;
    }

    setRules(ruleRows ?? []);
    setPenalties(penaltyRows ?? []);
    setMemberNames(nameMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAddRule() {
    if (!member) return;
    if (!newName.trim()) {
      setError('Bitte einen Namen für die Strafart angeben.');
      return;
    }

    const amountCents = euroStringToCents(newAmount);
    if (Number.isNaN(amountCents) || amountCents < 0) {
      setError('Bitte einen gültigen Betrag angeben.');
      return;
    }

    let kingSurchargeCents = 0;
    if (newHasKingSurcharge) {
      kingSurchargeCents = euroStringToCents(newKingSurchargeAmount);
      if (Number.isNaN(kingSurchargeCents) || kingSurchargeCents <= 0) {
        setError('Bitte einen gültigen Pumpenkönig-Zuschlag angeben.');
        return;
      }
    }

    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from('penalty_rule').insert({
      club_id: member.club_id,
      name: newName.trim(),
      amount_cents: amountCents,
      has_king_surcharge: newHasKingSurcharge,
      king_surcharge_cents: kingSurchargeCents,
    });

    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setNewName('');
    setNewAmount('');
    setNewHasKingSurcharge(false);
    setNewKingSurchargeAmount('');
    load();
  }

  async function handleDeleteRule(ruleId: string) {
    const { error: deleteError } = await supabase.from('penalty_rule').delete().eq('id', ruleId);
    if (deleteError) {
      setError(deleteError.message);
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

  // Gesamtliste: Summe je Strafart und Mitglied über alle Termine.
  const totalsByRuleAndMember: Record<string, Record<string, { count: number; cents: number }>> = {};
  for (const row of penalties) {
    const ruleKey = row.penalty_rule_id ?? row.rule_name;
    totalsByRuleAndMember[ruleKey] ??= {};
    const existing = totalsByRuleAndMember[ruleKey][row.member_id] ?? { count: 0, cents: 0 };
    existing.count += row.count;
    existing.cents += row.count * row.unit_amount_cents;
    totalsByRuleAndMember[ruleKey][row.member_id] = existing;
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Strafenkatalog
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <ThemedText type="smallBold">Strafarten</ThemedText>

          {rules.length === 0 && (
            <ThemedText themeColor="textSecondary">Noch keine Strafarten angelegt.</ThemedText>
          )}

          {rules.map((rule) => (
            <ThemedView key={rule.id} type="backgroundElement" style={styles.ruleCard}>
              <ThemedView style={styles.row}>
                <ThemedText>{rule.name}</ThemedText>
                <ThemedView style={styles.row}>
                  <ThemedText type="smallBold">{formatEuro(rule.amount_cents)}</ThemedText>
                  {isStaff && (
                    <Pressable onPress={() => handleDeleteRule(rule.id)}>
                      <ThemedText type="small" style={styles.deleteLink}>
                        Löschen
                      </ThemedText>
                    </Pressable>
                  )}
                </ThemedView>
              </ThemedView>
              {rule.has_king_surcharge && (
                <ThemedText type="small" themeColor="textSecondary">
                  👑 {rule.name}-König: {formatEuro(rule.king_surcharge_cents)}
                </ThemedText>
              )}
            </ThemedView>
          ))}

          {isStaff && (
            <>
              <ThemedView style={styles.penaltyRow}>
                <TextInput
                  value={newName}
                  onChangeText={setNewName}
                  placeholder="Name (z.B. Pumpe)"
                  placeholderTextColor={theme.textSecondary}
                  style={[styles.input, styles.nameInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
                <TextInput
                  value={newAmount}
                  onChangeText={setNewAmount}
                  placeholder="0,50"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                  style={[styles.input, styles.amountInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
              </ThemedView>

              <Pressable
                style={styles.checkboxRow}
                onPress={() => setNewHasKingSurcharge((prev) => !prev)}>
                <ThemedView
                  style={[
                    styles.checkbox,
                    { backgroundColor: newHasKingSurcharge ? theme.backgroundSelected : theme.backgroundElement },
                  ]}
                />
                <ThemedText type="small">
                  {newName.trim() || 'Diese Strafart'}-König-Zuschlag (wer die meisten hat, zahlt extra)
                </ThemedText>
              </Pressable>

              {newHasKingSurcharge && (
                <TextInput
                  value={newKingSurchargeAmount}
                  onChangeText={setNewKingSurchargeAmount}
                  placeholder="Zuschlag in € (z.B. 1,00)"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
              )}

              {saving ? (
                <ActivityIndicator />
              ) : (
                <Pressable style={[styles.button, { backgroundColor: theme.backgroundElement }]} onPress={handleAddRule}>
                  <ThemedText type="smallBold">Strafart hinzufügen</ThemedText>
                </Pressable>
              )}
            </>
          )}

          <ThemedText type="smallBold" style={styles.sectionSpacing}>
            Gesamtliste
          </ThemedText>

          {Object.keys(totalsByRuleAndMember).length === 0 && (
            <ThemedText themeColor="textSecondary">Noch keine Strafen erfasst.</ThemedText>
          )}

          {rules.map((rule) => {
            const totals = totalsByRuleAndMember[rule.id];
            if (!totals || Object.keys(totals).length === 0) return null;

            return (
              <ThemedView key={rule.id} style={styles.ruleTotalsBlock}>
                <ThemedText type="small" themeColor="textSecondary">
                  {rule.name}:
                </ThemedText>
                {Object.entries(totals).map(([memberId, { count, cents }]) => (
                  <ThemedText key={memberId} type="small">
                    {memberNames[memberId] ?? '?'}: {count}× ({formatEuro(cents)})
                  </ThemedText>
                ))}
              </ThemedView>
            );
          })}
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
  sectionSpacing: {
    marginTop: Spacing.three,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  ruleCard: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: Spacing.half,
  },
  deleteLink: {
    color: '#d33',
  },
  penaltyRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    height: 48,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  nameInput: {
    flex: 2,
  },
  amountInput: {
    flex: 1,
  },
  button: {
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: {
    color: '#d33',
  },
  ruleTotalsBlock: {
    gap: Spacing.half,
  },
});
