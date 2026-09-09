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

type GameResult = {
  gameId: string;
  type: string;
  description: string | null;
  scores: { memberId: string; pins: number }[];
};

type PenaltyResult = {
  memberId: string;
  ruleName: string;
  unitAmountCents: number;
  count: number;
};

type KingSurchargeResult = {
  memberId: string;
  note: string;
  amountCents: number;
};

const GAME_TYPE_LABELS: Record<string, string> = {
  kleine_hausnummer: 'Kleine Hausnummer',
  grosse_hausnummer: 'Große Hausnummer',
  freitext: 'Freitext',
};

const HAUSNUMMER_TYPES = new Set(['kleine_hausnummer', 'grosse_hausnummer']);

function formatEuro(cents: number) {
  return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

function formatScore(type: string, pins: number) {
  if (HAUSNUMMER_TYPES.has(type)) return String(pins).padStart(3, '0');
  if (type === 'freitext') return formatEuro(pins);
  return String(pins);
}

export default function EventsScreen() {
  const theme = useTheme();
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceStatus>>({});
  const [results, setResults] = useState<Record<string, GameResult[]>>({});
  const [penalties, setPenalties] = useState<Record<string, PenaltyResult[]>>({});
  const [kingSurcharges, setKingSurcharges] = useState<Record<string, KingSurchargeResult[]>>({});
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [confirmingGameId, setConfirmingGameId] = useState<string | null>(null);

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

    const attendanceMap: Record<string, AttendanceStatus> = {};
    for (const row of attendanceRows ?? []) {
      attendanceMap[row.event_id] = row.status as AttendanceStatus;
    }

    const eventIds = (eventRows ?? []).map((event) => event.id);

    const [{ data: memberRows }, { data: gameRows }, { data: penaltyRows }, { data: kingSurchargeRows }] =
      await Promise.all([
        supabase.from('member').select('id, display_name').eq('club_id', currentMember.club_id),
        eventIds.length > 0
          ? supabase.from('game').select('id, event_id, type, description').in('event_id', eventIds)
          : Promise.resolve({
              data: [] as { id: string; event_id: string; type: string; description: string | null }[],
            }),
        eventIds.length > 0
          ? supabase
              .from('penalty')
              .select('event_id, member_id, rule_name, unit_amount_cents, count')
              .in('event_id', eventIds)
          : Promise.resolve({
              data: [] as {
                event_id: string;
                member_id: string;
                rule_name: string;
                unit_amount_cents: number;
                count: number;
              }[],
            }),
        eventIds.length > 0
          ? supabase
              .from('transaction')
              .select('event_id, member_id, note, amount_cents')
              .in('event_id', eventIds)
              .not('king_surcharge_penalty_rule_id', 'is', null)
          : Promise.resolve({
              data: [] as { event_id: string; member_id: string; note: string | null; amount_cents: number }[],
            }),
      ]);

    const nameMap: Record<string, string> = {};
    for (const row of memberRows ?? []) {
      nameMap[row.id] = row.display_name;
    }

    const gameIds = (gameRows ?? []).map((game) => game.id);
    const { data: scoreRows } =
      gameIds.length > 0
        ? await supabase.from('score').select('game_id, member_id, pins').in('game_id', gameIds)
        : { data: [] as { game_id: string; member_id: string; pins: number }[] };

    const resultMap: Record<string, GameResult[]> = {};
    for (const game of gameRows ?? []) {
      const scores = (scoreRows ?? [])
        .filter((score) => score.game_id === game.id)
        .map((score) => ({ memberId: score.member_id, pins: score.pins }));
      resultMap[game.event_id] = [
        ...(resultMap[game.event_id] ?? []),
        { gameId: game.id, type: game.type, description: game.description, scores },
      ];
    }

    const penaltyMap: Record<string, PenaltyResult[]> = {};
    for (const row of penaltyRows ?? []) {
      penaltyMap[row.event_id] = [
        ...(penaltyMap[row.event_id] ?? []),
        {
          memberId: row.member_id,
          ruleName: row.rule_name,
          unitAmountCents: row.unit_amount_cents,
          count: row.count,
        },
      ];
    }

    const kingSurchargeMap: Record<string, KingSurchargeResult[]> = {};
    for (const row of kingSurchargeRows ?? []) {
      if (!row.event_id) continue;
      kingSurchargeMap[row.event_id] = [
        ...(kingSurchargeMap[row.event_id] ?? []),
        { memberId: row.member_id, note: row.note ?? '', amountCents: row.amount_cents },
      ];
    }

    setEvents(eventRows ?? []);
    setAttendance(attendanceMap);
    setResults(resultMap);
    setPenalties(penaltyMap);
    setKingSurcharges(kingSurchargeMap);
    setMemberNames(nameMap);
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

  async function handleDeleteGame(gameId: string) {
    setConfirmingGameId(null);

    const { error: deleteError } = await supabase.rpc('delete_game', { p_game_id: gameId });

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

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Kegelabende
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <Pressable onPress={() => router.push('/kasse')}>
            <ThemedText type="link">Kegelkasse</ThemedText>
          </Pressable>

          <Pressable onPress={() => router.push('/strafenkatalog')}>
            <ThemedText type="link">Strafenkatalog</ThemedText>
          </Pressable>

          {isStaff && (
            <Pressable onPress={() => router.push('/club-settings')}>
              <ThemedText type="link">Club-Einstellungen</ThemedText>
            </Pressable>
          )}

          {isStaff && (
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

                {(results[event.id] ?? []).map((game) => (
                  <ThemedView key={game.gameId} style={styles.resultsBlock}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Ergebnisse ({GAME_TYPE_LABELS[game.type] ?? game.type}
                      {game.description ? ` · ${game.description}` : ''}):
                    </ThemedText>
                    {game.scores.map((score) => (
                      <ThemedText key={score.memberId} type="small">
                        {memberNames[score.memberId] ?? '?'}: {formatScore(game.type, score.pins)}
                      </ThemedText>
                    ))}

                    {isStaff && (
                      <ThemedView style={styles.gameActionsRow}>
                        <Pressable
                          onPress={() =>
                            router.push({
                              pathname: '/enter-score',
                              params: { eventId: event.id, gameId: game.gameId },
                            })
                          }>
                          <ThemedText type="small" themeColor="textSecondary">
                            Bearbeiten
                          </ThemedText>
                        </Pressable>
                        <Pressable
                          onPress={() =>
                            confirmingGameId === game.gameId
                              ? handleDeleteGame(game.gameId)
                              : setConfirmingGameId(game.gameId)
                          }>
                          <ThemedText type="small" style={styles.deleteLink}>
                            {confirmingGameId === game.gameId ? 'Wirklich löschen?' : 'Löschen'}
                          </ThemedText>
                        </Pressable>
                      </ThemedView>
                    )}
                  </ThemedView>
                ))}

                {(penalties[event.id] ?? []).length > 0 && (
                  <ThemedView style={styles.resultsBlock}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Strafen:
                    </ThemedText>
                    {(penalties[event.id] ?? []).map((penalty, index) => (
                      <ThemedText key={`${penalty.memberId}-${penalty.ruleName}-${index}`} type="small">
                        {memberNames[penalty.memberId] ?? '?'}: {penalty.ruleName} ×{penalty.count} (
                        {formatEuro(penalty.unitAmountCents * penalty.count)})
                      </ThemedText>
                    ))}
                  </ThemedView>
                )}

                {(kingSurcharges[event.id] ?? []).length > 0 && (
                  <ThemedView style={styles.resultsBlock}>
                    {(kingSurcharges[event.id] ?? []).map((surcharge, index) => (
                      <ThemedText key={`${surcharge.memberId}-${index}`} type="small">
                        👑 {memberNames[surcharge.memberId] ?? '?'}: {surcharge.note} ({formatEuro(surcharge.amountCents)})
                      </ThemedText>
                    ))}
                  </ThemedView>
                )}

                {isStaff && (
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: '/enter-score', params: { eventId: event.id } })
                    }>
                    <ThemedText type="link">Ergebnisse erfassen</ThemedText>
                  </Pressable>
                )}

                {isStaff && (
                  <Pressable
                    onPress={() =>
                      router.push({ pathname: '/enter-penalties', params: { eventId: event.id } })
                    }>
                    <ThemedText type="link">Strafen erfassen</ThemedText>
                  </Pressable>
                )}
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
  resultsBlock: {
    gap: Spacing.half,
  },
  gameActionsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  deleteLink: {
    color: '#d33',
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
