import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentMember } from '@/lib/member';
import { supabase } from '@/lib/supabase';

type GameType = 'punktekegeln' | 'bundeskegeln';

const GAME_TYPES: { value: GameType; label: string }[] = [
  { value: 'punktekegeln', label: 'Punktekegeln' },
  { value: 'bundeskegeln', label: 'Bundeskegeln' },
];

export default function EnterScoreScreen() {
  const theme = useTheme();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [gameType, setGameType] = useState<GameType>('punktekegeln');
  const [pinsByMember, setPinsByMember] = useState<Record<string, string>>({});
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

      const { data, error: membersError } = await supabase
        .from('member')
        .select('id, display_name')
        .eq('club_id', currentMember.club_id)
        .order('display_name', { ascending: true });

      if (membersError) {
        setError(membersError.message);
      } else {
        setMembers(data ?? []);
      }
      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    if (!eventId) {
      setError('Kein Kegelabend ausgewählt.');
      return;
    }

    const scores = Object.entries(pinsByMember)
      .filter(([, value]) => value.trim() !== '')
      .map(([memberId, value]) => ({ member_id: memberId, pins: Number(value) }));

    if (scores.length === 0) {
      setError('Bitte mindestens ein Ergebnis eintragen.');
      return;
    }

    if (scores.some((score) => Number.isNaN(score.pins) || score.pins < 0)) {
      setError('Ergebnisse müssen nicht-negative Zahlen sein.');
      return;
    }

    setSaving(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc('record_game_scores', {
      p_event_id: eventId,
      p_type: gameType,
      p_scores: scores,
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
            Ergebnisse erfassen
          </ThemedText>

          <ThemedText type="small" themeColor="textSecondary">
            Spieltyp
          </ThemedText>
          <ThemedView style={styles.typeRow}>
            {GAME_TYPES.map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.typeButton,
                  { backgroundColor: gameType === option.value ? theme.backgroundSelected : theme.backgroundElement },
                ]}
                onPress={() => setGameType(option.value)}>
                <ThemedText type="small">{option.label}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>

          {members.map((memberRow) => (
            <ThemedView key={memberRow.id} style={styles.memberRow}>
              <ThemedText style={styles.memberName}>{memberRow.display_name}</ThemedText>
              <TextInput
                value={pinsByMember[memberRow.id] ?? ''}
                onChangeText={(value) => setPinsByMember((prev) => ({ ...prev, [memberRow.id]: value }))}
                placeholder="Kegel"
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
            </ThemedView>
          ))}

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          {saving ? (
            <ActivityIndicator />
          ) : (
            <Pressable
              style={[styles.button, { backgroundColor: theme.backgroundElement }]}
              onPress={handleSave}>
              <ThemedText type="smallBold">Ergebnisse speichern</ThemedText>
            </Pressable>
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
    marginBottom: Spacing.two,
  },
  typeRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  typeButton: {
    flex: 1,
    height: 40,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  memberName: {
    flex: 1,
  },
  input: {
    width: 100,
    height: 44,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    textAlign: 'right',
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
