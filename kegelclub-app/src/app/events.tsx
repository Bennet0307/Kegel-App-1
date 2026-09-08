import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentMember, type CurrentMember } from '@/lib/member';
import { supabase } from '@/lib/supabase';

type EventRow = {
  id: string;
  title: string;
  starts_at: string;
  location: string | null;
};

type AttendanceStatus = 'offen' | 'zugesagt' | 'abgesagt';

export default function EventsScreen() {
  const theme = useTheme();
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [loading, setLoading] = useState(true);
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

    const { data: eventRows, error: eventsError } = await supabase
      .from('event')
      .select('id, title, starts_at, location')
      .eq('club_id', currentMember.club_id)
      .order('starts_at', { ascending: true });

    if (eventsError) {
      setLoading(false);
      setError(eventsError.message);
      return;
    }

    const { data: attendanceRows, error: attendanceError } = await supabase
      .from('attendance')
      .select('event_id, status')
      .eq('member_id', currentMember.id);

    if (attendanceError) {
      setLoading(false);
      setError(attendanceError.message);
      return;
    }

    const map: Record<string, AttendanceStatus> = {};
    for (const row of attendanceRows ?? []) {
      map[row.event_id] = row.status as AttendanceStatus;
    }

    setEvents(eventRows ?? []);
    setAttendance(map);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function respond(eventId: string, status: AttendanceStatus) {
    if (!member) return;

    setAttendance((prev) => ({ ...prev, [eventId]: status }));

    const { error: upsertError } = await supabase
      .from('attendance')
      .upsert(
        { event_id: eventId, member_id: member.id, status, responded_at: new Date().toISOString() },
        { onConflict: 'event_id,member_id' },
      );

    if (upsertError) {
      setError(upsertError.message);
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
            Kegelabende
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          {member && (member.role === 'admin' || member.role === 'kassierer') && (
            <Pressable onPress={() => router.push('/create-event')}>
              <ThemedText type="link">+ Kegelabend anlegen</ThemedText>
            </Pressable>
          )}

          {events.length === 0 && (
            <ThemedText themeColor="textSecondary">Noch keine Kegelabende geplant.</ThemedText>
          )}

          {events.map((event) => {
            const status = attendance[event.id] ?? 'offen';
            return (
              <ThemedView key={event.id} type="backgroundElement" style={styles.eventCard}>
                <ThemedText type="smallBold">{event.title}</ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {formatDate(event.starts_at)}
                  {event.location ? ` · ${event.location}` : ''}
                </ThemedText>

                <ThemedView style={styles.rsvpRow}>
                  <Pressable
                    style={[
                      styles.rsvpButton,
                      { backgroundColor: status === 'zugesagt' ? theme.backgroundSelected : theme.background },
                    ]}
                    onPress={() => respond(event.id, 'zugesagt')}>
                    <ThemedText type="small">Zusagen</ThemedText>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.rsvpButton,
                      { backgroundColor: status === 'abgesagt' ? theme.backgroundSelected : theme.background },
                    ]}
                    onPress={() => respond(event.id, 'abgesagt')}>
                    <ThemedText type="small">Absagen</ThemedText>
                  </Pressable>
                </ThemedView>
              </ThemedView>
            );
          })}
        </SafeAreaView>
      </ScrollView>
    </ThemedView>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
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
  eventCard: {
    borderRadius: Spacing.three,
    padding: Spacing.three,
    gap: Spacing.two,
  },
  rsvpRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  rsvpButton: {
    flex: 1,
    height: 40,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
