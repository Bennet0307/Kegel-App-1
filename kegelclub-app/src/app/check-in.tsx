import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

type AttendanceStatus = 'offen' | 'zugesagt' | 'abgesagt';

const STATUS_LABELS: Record<AttendanceStatus, string> = {
  offen: 'Offen',
  zugesagt: 'Zugesagt',
  abgesagt: 'Abgesagt',
};

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export default function CheckInScreen() {
  const theme = useTheme();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const [eventTitle, setEventTitle] = useState('');
  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [attendanceStatus, setAttendanceStatus] = useState<Record<string, AttendanceStatus>>({});
  const [checkedIn, setCheckedIn] = useState<Record<string, string | null>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    if (!eventId) {
      setLoading(false);
      setError('Kein Kegelabend ausgewählt.');
      return;
    }

    const { data: eventRow, error: eventError } = await supabase
      .from('event')
      .select('title, club_id')
      .eq('id', eventId)
      .single();

    if (eventError || !eventRow) {
      setLoading(false);
      setError(eventError?.message ?? 'Termin nicht gefunden.');
      return;
    }

    setEventTitle(eventRow.title);

    const [{ data: memberRows }, { data: attendanceRows }] = await Promise.all([
      supabase.from('member').select('id, display_name').eq('club_id', eventRow.club_id).order('display_name'),
      supabase.from('attendance').select('member_id, status, checked_in_at').eq('event_id', eventId),
    ]);

    const statusMap: Record<string, AttendanceStatus> = {};
    const checkedInMap: Record<string, string | null> = {};
    for (const row of attendanceRows ?? []) {
      statusMap[row.member_id] = row.status as AttendanceStatus;
      checkedInMap[row.member_id] = row.checked_in_at;
    }

    setMembers(memberRows ?? []);
    setAttendanceStatus(statusMap);
    setCheckedIn(checkedInMap);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggleCheckIn(memberId: string) {
    const newValue = checkedIn[memberId] ? null : new Date().toISOString();
    setCheckedIn((prev) => ({ ...prev, [memberId]: newValue }));

    const { error: upsertError } = await supabase
      .from('attendance')
      .upsert(
        { event_id: eventId, member_id: memberId, checked_in_at: newValue },
        { onConflict: 'event_id,member_id' },
      );

    if (upsertError) {
      setError(upsertError.message);
      load();
    }
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
            Anwesenheit: {eventTitle}
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          {members.map((memberRow) => {
            const status = attendanceStatus[memberRow.id] ?? 'offen';
            const checkedInAt = checkedIn[memberRow.id];
            return (
              <ThemedView key={memberRow.id} type="backgroundElement" style={styles.memberCard}>
                <ThemedView style={styles.row}>
                  <ThemedText>{memberRow.display_name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {STATUS_LABELS[status]}
                  </ThemedText>
                </ThemedView>
                <Pressable
                  style={[
                    styles.checkInButton,
                    { backgroundColor: checkedInAt ? theme.backgroundSelected : theme.background },
                  ]}
                  onPress={() => toggleCheckIn(memberRow.id)}>
                  <ThemedText type="small">
                    {checkedInAt ? `Eingecheckt ${formatTime(checkedInAt)} · rückgängig` : 'Einchecken'}
                  </ThemedText>
                </Pressable>
              </ThemedView>
            );
          })}

          {members.length === 0 && (
            <ThemedText themeColor="textSecondary">Keine Mitglieder gefunden.</ThemedText>
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
  error: {
    color: '#d33',
  },
  memberCard: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  checkInButton: {
    height: 40,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
