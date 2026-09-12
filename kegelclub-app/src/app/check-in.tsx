import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
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

function pad(n: number) {
  return String(n).padStart(2, '0');
}

export default function CheckInScreen() {
  const theme = useTheme();
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const [eventTitle, setEventTitle] = useState('');
  const [eventDate, setEventDate] = useState(''); // JJJJ-MM-TT, für die Kombination mit der eingegebenen Uhrzeit
  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [attendanceStatus, setAttendanceStatus] = useState<Record<string, AttendanceStatus>>({});
  const [checkedIn, setCheckedIn] = useState<Record<string, string | null>>({});
  const [timeInputs, setTimeInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
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
      .select('title, club_id, starts_at')
      .eq('id', eventId)
      .single();

    if (eventError || !eventRow) {
      setLoading(false);
      setError(eventError?.message ?? 'Termin nicht gefunden.');
      return;
    }

    setEventTitle(eventRow.title);
    const startsAt = new Date(eventRow.starts_at);
    setEventDate(`${startsAt.getFullYear()}-${pad(startsAt.getMonth() + 1)}-${pad(startsAt.getDate())}`);

    const [{ data: memberRows }, { data: attendanceRows }] = await Promise.all([
      supabase.from('member').select('id, display_name').eq('club_id', eventRow.club_id).order('display_name'),
      supabase.from('attendance').select('member_id, status, checked_in_at').eq('event_id', eventId),
    ]);

    const statusMap: Record<string, AttendanceStatus> = {};
    const checkedInMap: Record<string, string | null> = {};
    const timeMap: Record<string, string> = {};
    for (const row of attendanceRows ?? []) {
      statusMap[row.member_id] = row.status as AttendanceStatus;
      checkedInMap[row.member_id] = row.checked_in_at;
      if (row.checked_in_at) {
        const checkedInDate = new Date(row.checked_in_at);
        timeMap[row.member_id] = `${pad(checkedInDate.getHours())}:${pad(checkedInDate.getMinutes())}`;
      }
    }

    setMembers(memberRows ?? []);
    setAttendanceStatus(statusMap);
    setCheckedIn(checkedInMap);
    setTimeInputs(timeMap);
    setLoading(false);
  }, [eventId]);

  useEffect(() => {
    load();
  }, [load]);

  async function applyCheckIn(memberId: string, checkedInAtIso: string | null) {
    setSaving(memberId);
    setError(null);

    const { error: rpcError } = await supabase.rpc('check_in', {
      p_event_id: eventId,
      p_member_id: memberId,
      p_checked_in_at: checkedInAtIso,
    });

    setSaving(null);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    load();
  }

  function handleNow(memberId: string) {
    applyCheckIn(memberId, new Date().toISOString());
  }

  function handleUndo(memberId: string) {
    applyCheckIn(memberId, null);
  }

  function handleApplyTime(memberId: string) {
    const time = timeInputs[memberId];
    if (!time || !eventDate) return;

    const combined = new Date(`${eventDate}T${time}`);
    if (Number.isNaN(combined.getTime())) {
      setError('Ungültige Uhrzeit. Format: HH:MM.');
      return;
    }

    applyCheckIn(memberId, combined.toISOString());
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
            const isSaving = saving === memberRow.id;
            return (
              <ThemedView key={memberRow.id} type="backgroundElement" style={styles.memberCard}>
                <ThemedView style={styles.row}>
                  <ThemedText>{memberRow.display_name}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {STATUS_LABELS[status]}
                    {checkedInAt ? ` · eingecheckt ${formatTime(checkedInAt)}` : ''}
                  </ThemedText>
                </ThemedView>

                {isSaving ? (
                  <ActivityIndicator />
                ) : (
                  <ThemedView style={styles.actionsRow}>
                    <TextInput
                      value={timeInputs[memberRow.id] ?? ''}
                      onChangeText={(value) => setTimeInputs((prev) => ({ ...prev, [memberRow.id]: value }))}
                      placeholder="HH:MM"
                      placeholderTextColor={theme.textSecondary}
                      style={[styles.timeInput, { color: theme.text, backgroundColor: theme.background }]}
                    />
                    <Pressable
                      style={[styles.actionButton, { backgroundColor: theme.background }]}
                      onPress={() => handleApplyTime(memberRow.id)}>
                      <ThemedText type="small">Übernehmen</ThemedText>
                    </Pressable>
                    <Pressable
                      style={[styles.actionButton, { backgroundColor: theme.background }]}
                      onPress={() => handleNow(memberRow.id)}>
                      <ThemedText type="small">Jetzt</ThemedText>
                    </Pressable>
                    {checkedInAt && (
                      <Pressable
                        style={[styles.actionButton, { backgroundColor: theme.background }]}
                        onPress={() => handleUndo(memberRow.id)}>
                        <ThemedText type="small" style={styles.deleteLink}>
                          Rückgängig
                        </ThemedText>
                      </Pressable>
                    )}
                  </ThemedView>
                )}
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
  actionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
    alignItems: 'center',
  },
  timeInput: {
    width: 70,
    height: 40,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    fontSize: 14,
    textAlign: 'center',
  },
  actionButton: {
    height: 40,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteLink: {
    color: '#d33',
  },
});
