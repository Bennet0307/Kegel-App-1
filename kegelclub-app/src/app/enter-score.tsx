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

type GameType = 'kleine_hausnummer' | 'grosse_hausnummer';

const GAME_TYPES: { value: GameType; label: string }[] = [
  { value: 'kleine_hausnummer', label: 'Kleine Hausnummer' },
  { value: 'grosse_hausnummer', label: 'Große Hausnummer' },
];

type Digits = { h: string; t: string; e: string };

// Bewusst mit Punkt als Dezimaltrennzeichen (nicht toLocaleString('de-DE')):
// Komma trennt hier die Liste der Beträge, ein deutsches Dezimalkomma würde
// mit diesem Listentrenner kollidieren und die Staffel falsch zerlegen.
function formatSchedule(centsList: number[]) {
  return centsList.map((cents) => (cents / 100).toFixed(2)).join(', ');
}

function parseSchedule(text: string): number[] | null {
  if (text.trim() === '') return null;
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => Math.round(Number(part) * 100));
}

export default function EnterScoreScreen() {
  const theme = useTheme();
  const { eventId, gameId } = useLocalSearchParams<{ eventId?: string; gameId?: string }>();
  const isEditing = Boolean(gameId);

  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [gameType, setGameType] = useState<GameType>('grosse_hausnummer');
  const [digitsByMember, setDigitsByMember] = useState<Record<string, Digits>>({});
  const [defaultSchedule, setDefaultSchedule] = useState<number[]>([]);
  const [scheduleOverride, setScheduleOverride] = useState('');
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

      const [{ data: memberRows, error: membersError }, { data: clubRow }] = await Promise.all([
        supabase
          .from('member')
          .select('id, display_name')
          .eq('club_id', currentMember.club_id)
          .order('display_name', { ascending: true }),
        supabase
          .from('club')
          .select('hausnummer_penalty_schedule_cents')
          .eq('id', currentMember.club_id)
          .single(),
      ]);

      if (membersError) {
        setError(membersError.message);
      } else {
        setMembers(memberRows ?? []);
      }
      setDefaultSchedule(clubRow?.hausnummer_penalty_schedule_cents ?? []);

      if (gameId) {
        const [{ data: gameRow }, { data: scoreRows }] = await Promise.all([
          supabase.from('game').select('type, penalty_schedule_cents').eq('id', gameId).single(),
          supabase.from('score').select('member_id, pins').eq('game_id', gameId),
        ]);

        if (gameRow) {
          setGameType(gameRow.type as GameType);
          if (gameRow.penalty_schedule_cents?.length) {
            setScheduleOverride(formatSchedule(gameRow.penalty_schedule_cents));
          }
        }

        const digits: Record<string, Digits> = {};
        for (const row of scoreRows ?? []) {
          const padded = String(row.pins).padStart(3, '0');
          digits[row.member_id] = { h: padded[0], t: padded[1], e: padded[2] };
        }
        setDigitsByMember(digits);
      }

      setLoading(false);
    })();
  }, [gameId]);

  function setDigit(memberId: string, key: keyof Digits, value: string) {
    const digit = value.replace(/[^0-9]/g, '').slice(0, 1);
    setDigitsByMember((prev) => {
      const current = prev[memberId] ?? { h: '', t: '', e: '' };
      return { ...prev, [memberId]: { ...current, [key]: digit } };
    });
  }

  async function handleSave() {
    if (!isEditing && !eventId) {
      setError('Kein Kegelabend ausgewählt.');
      return;
    }

    const scores: { member_id: string; pins: number }[] = [];
    for (const memberRow of members) {
      const digits = digitsByMember[memberRow.id];
      if (!digits || (!digits.h && !digits.t && !digits.e)) continue;

      if (digits.h === '' || digits.t === '' || digits.e === '') {
        setError(`Bitte bei ${memberRow.display_name} alle drei Ziffern eintragen (oder alle leer lassen).`);
        return;
      }

      scores.push({
        member_id: memberRow.id,
        pins: Number(digits.h) * 100 + Number(digits.t) * 10 + Number(digits.e),
      });
    }

    if (scores.length === 0) {
      setError('Bitte mindestens ein Ergebnis eintragen.');
      return;
    }

    const overrideSchedule = parseSchedule(scheduleOverride);
    if (scheduleOverride.trim() !== '' && (!overrideSchedule || overrideSchedule.some(Number.isNaN))) {
      setError('Strafstaffel ungültig. Bitte Beträge durch Komma getrennt angeben, z.B. 0.50, 0.30, 0.20');
      return;
    }

    setSaving(true);
    setError(null);

    const { error: rpcError } = isEditing
      ? await supabase.rpc('update_game_scores', {
          p_game_id: gameId,
          p_type: gameType,
          p_scores: scores,
          p_penalty_schedule_cents: overrideSchedule,
        })
      : await supabase.rpc('record_game_scores', {
          p_event_id: eventId,
          p_type: gameType,
          p_scores: scores,
          p_penalty_schedule_cents: overrideSchedule,
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
            {isEditing ? 'Ergebnisse bearbeiten' : 'Ergebnisse erfassen'}
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

          <ThemedText type="small" themeColor="textSecondary">
            Hunderter / Zehner / Einer je Mitglied (0–9, leer = hat nicht gespielt)
          </ThemedText>

          {members.map((memberRow) => {
            const digits = digitsByMember[memberRow.id] ?? { h: '', t: '', e: '' };
            return (
              <ThemedView key={memberRow.id} style={styles.memberRow}>
                <ThemedText style={styles.memberName}>{memberRow.display_name}</ThemedText>
                <ThemedView style={styles.digitRow}>
                  {(['h', 't', 'e'] as const).map((key) => (
                    <TextInput
                      key={key}
                      value={digits[key]}
                      onChangeText={(value) => setDigit(memberRow.id, key, value)}
                      keyboardType="number-pad"
                      maxLength={1}
                      style={[styles.digitInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                  ))}
                </ThemedView>
              </ThemedView>
            );
          })}

          <ThemedText type="small" themeColor="textSecondary">
            Strafstaffel überschreiben (optional, Beträge in €, absteigend vom Verlierer, durch Komma
            getrennt){defaultSchedule.length > 0 ? ` – Standard: ${formatSchedule(defaultSchedule)}` : ''}
          </ThemedText>
          <TextInput
            value={scheduleOverride}
            onChangeText={setScheduleOverride}
            placeholder="z.B. 0.50, 0.30, 0.20, 0.10"
            placeholderTextColor={theme.textSecondary}
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          {saving ? (
            <ActivityIndicator />
          ) : (
            <Pressable
              style={[styles.button, { backgroundColor: theme.backgroundElement }]}
              onPress={handleSave}>
              <ThemedText type="smallBold">{isEditing ? 'Änderungen speichern' : 'Ergebnisse speichern'}</ThemedText>
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
  digitRow: {
    flexDirection: 'row',
    gap: Spacing.one,
  },
  digitInput: {
    width: 40,
    height: 44,
    borderRadius: Spacing.two,
    fontSize: 16,
    textAlign: 'center',
  },
  input: {
    height: 48,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
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
