import { useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { computeKingCrowns, type TieMode } from '@/lib/kingSurcharge';
import { getCurrentMember } from '@/lib/member';
import { formatEuro } from '@/lib/money';
import { supabase } from '@/lib/supabase';

const POSITIVE_TRANSACTION_TYPES = new Set(['einzahlung', 'kegelgeld', 'strafe']);
const HAUSNUMMER_TYPES = new Set(['kleine_hausnummer', 'grosse_hausnummer']);
const GAME_TYPE_LABELS: Record<string, string> = {
  kleine_hausnummer: 'Kleine Hausnummer',
  grosse_hausnummer: 'Große Hausnummer',
  freitext: 'Freitext',
};

type AttendanceStatus = 'offen' | 'zugesagt' | 'abgesagt';
type GameRanking = {
  gameId: string;
  type: string;
  description: string | null;
  entries: { memberId: string; pins: number }[];
};
type PenaltyEntry = { memberId: string; count: number; cents: number };
type KingEntry = { memberId: string; ruleName: string; cents: number };
type KasseEntry = { memberId: string; cents: number };

function formatScore(type: string, pins: number) {
  if (HAUSNUMMER_TYPES.has(type)) return String(pins).padStart(3, '0');
  if (type === 'freitext') return formatEuro(pins);
  return String(pins);
}

export default function TerminStatistikScreen() {
  const { eventId } = useLocalSearchParams<{ eventId: string }>();

  const [eventTitle, setEventTitle] = useState('');
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);

  const [attendanceGroups, setAttendanceGroups] = useState<Record<AttendanceStatus, string[]>>({
    zugesagt: [],
    abgesagt: [],
    offen: [],
  });
  const [checkedInAt, setCheckedInAt] = useState<Record<string, string>>({});
  const [gameRankings, setGameRankings] = useState<GameRanking[]>([]);
  const [penaltyRanking, setPenaltyRanking] = useState<PenaltyEntry[]>([]);
  const [kingEntries, setKingEntries] = useState<KingEntry[]>([]);
  const [kasseRanking, setKasseRanking] = useState<KasseEntry[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);

      if (!eventId) {
        setLoading(false);
        setError('Kein Kegelabend ausgewählt.');
        return;
      }

      const currentMember = await getCurrentMember();
      if (!currentMember) {
        setLoading(false);
        setError('Kein Club gefunden.');
        return;
      }

      const clubId = currentMember.club_id;
      const staff = currentMember.role === 'admin' || currentMember.role === 'kassierer';
      setIsStaff(staff);

      const [
        { data: eventRow },
        { data: memberRows },
        { data: attendanceRows },
        { data: gameRows },
        { data: penaltyRows },
        { data: kingRuleRows },
        { data: clubRow },
      ] = await Promise.all([
        supabase.from('event').select('title').eq('id', eventId).single(),
        supabase.from('member').select('id, display_name').eq('club_id', clubId),
        supabase.from('attendance').select('member_id, status, checked_in_at').eq('event_id', eventId),
        supabase.from('game').select('id, type, description').eq('event_id', eventId),
        supabase
          .from('penalty')
          .select('member_id, penalty_rule_id, rule_name, unit_amount_cents, count')
          .eq('event_id', eventId),
        supabase
          .from('penalty_rule')
          .select('id, name, king_surcharge_cents')
          .eq('club_id', clubId)
          .eq('has_king_surcharge', true),
        supabase.from('club').select('king_surcharge_tie_mode').eq('id', clubId).single(),
      ]);

      setEventTitle(eventRow?.title ?? '');

      const nameMap: Record<string, string> = {};
      for (const row of memberRows ?? []) nameMap[row.id] = row.display_name;
      setMemberNames(nameMap);

      // -- Anwesenheit: alle Mitglieder ohne Attendance-Zeile sind "offen" --
      const statusByMember: Record<string, AttendanceStatus> = {};
      const checkedInMap: Record<string, string> = {};
      for (const row of attendanceRows ?? []) {
        statusByMember[row.member_id] = row.status as AttendanceStatus;
        if (row.checked_in_at) checkedInMap[row.member_id] = row.checked_in_at;
      }
      const groups: Record<AttendanceStatus, string[]> = { zugesagt: [], abgesagt: [], offen: [] };
      for (const row of memberRows ?? []) {
        const status = statusByMember[row.id] ?? 'offen';
        groups[status].push(row.id);
      }
      setAttendanceGroups(groups);
      setCheckedInAt(checkedInMap);

      // -- Ergebnisse je Spiel, geordnet nach Platzierung --
      const gameIds = (gameRows ?? []).map((row) => row.id);
      const { data: scoreRows } =
        gameIds.length > 0
          ? await supabase.from('score').select('game_id, member_id, pins').in('game_id', gameIds)
          : { data: [] as { game_id: string; member_id: string; pins: number }[] };

      const rankings: GameRanking[] = (gameRows ?? []).map((game) => {
        const entries = (scoreRows ?? [])
          .filter((score) => score.game_id === game.id)
          .map((score) => ({ memberId: score.member_id, pins: score.pins }));
        if (HAUSNUMMER_TYPES.has(game.type)) {
          entries.sort((a, b) => (game.type === 'grosse_hausnummer' ? b.pins - a.pins : a.pins - b.pins));
        }
        return { gameId: game.id, type: game.type, description: game.description, entries };
      });
      setGameRankings(rankings);

      // -- Strafen-Ranking für diesen Termin --
      const penaltyTotals: Record<string, { count: number; cents: number }> = {};
      for (const row of penaltyRows ?? []) {
        const existing = penaltyTotals[row.member_id] ?? { count: 0, cents: 0 };
        existing.count += row.count;
        existing.cents += row.count * row.unit_amount_cents;
        penaltyTotals[row.member_id] = existing;
      }
      const penaltyResult: PenaltyEntry[] = Object.entries(penaltyTotals)
        .map(([memberId, { count, cents }]) => ({ memberId, count, cents }))
        .sort((a, b) => b.count - a.count);
      setPenaltyRanking(penaltyResult);

      // -- Königs des Abends --
      const tieMode = (clubRow?.king_surcharge_tie_mode ?? 'alle_zahlen') as TieMode;
      const penaltyRowsWithEvent = (penaltyRows ?? []).map((row) => ({ ...row, event_id: eventId }));
      const crowns = computeKingCrowns(penaltyRowsWithEvent, kingRuleRows ?? [], tieMode);
      setKingEntries(crowns.map((crown) => ({ memberId: crown.memberId, ruleName: crown.ruleName, cents: crown.amountCents })));

      // -- Kassen-Auswirkung dieses Abends: nur Admin/Kassierer, siehe kasse.tsx --
      if (staff) {
        const { data: transactionRows } = await supabase
          .from('transaction')
          .select('member_id, type, amount_cents')
          .eq('event_id', eventId);

        const totals: Record<string, number> = {};
        for (const row of transactionRows ?? []) {
          const signed = POSITIVE_TRANSACTION_TYPES.has(row.type) ? row.amount_cents : -row.amount_cents;
          totals[row.member_id] = (totals[row.member_id] ?? 0) + signed;
        }
        const kasseResult = Object.entries(totals)
          .map(([memberId, cents]) => ({ memberId, cents }))
          .sort((a, b) => b.cents - a.cents);
        setKasseRanking(kasseResult);
      }

      setLoading(false);
    })();
  }, [eventId]);

  function formatMemberWithCheckIn(memberId: string) {
    const name = memberNames[memberId] ?? '?';
    const checkIn = checkedInAt[memberId];
    if (!checkIn) return name;
    const time = new Date(checkIn).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
    return `${name} (✓ ${time})`;
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
            Statistik: {eventTitle}
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <ThemedView style={styles.section}>
            <ThemedText type="smallBold">Anwesenheit</ThemedText>
            <ThemedText type="small">
              Zugesagt ({attendanceGroups.zugesagt.length}):{' '}
              {attendanceGroups.zugesagt.map((id) => formatMemberWithCheckIn(id)).join(', ') || '—'}
            </ThemedText>
            <ThemedText type="small">
              Abgesagt ({attendanceGroups.abgesagt.length}):{' '}
              {attendanceGroups.abgesagt.map((id) => formatMemberWithCheckIn(id)).join(', ') || '—'}
            </ThemedText>
            <ThemedText type="small">
              Offen ({attendanceGroups.offen.length}):{' '}
              {attendanceGroups.offen.map((id) => formatMemberWithCheckIn(id)).join(', ') || '—'}
            </ThemedText>
          </ThemedView>

          <ThemedView style={styles.section}>
            <ThemedText type="smallBold">Strafen dieses Abends</ThemedText>
            {penaltyRanking.length === 0 ? (
              <ThemedText themeColor="textSecondary">Noch keine Strafen erfasst.</ThemedText>
            ) : (
              penaltyRanking.map((entry, index) => (
                <ThemedText key={entry.memberId} type="small">
                  {index + 1}. {memberNames[entry.memberId] ?? '?'} — {entry.count}× ({formatEuro(entry.cents)})
                </ThemedText>
              ))
            )}

            {kingEntries.length > 0 && (
              <ThemedView style={styles.subSection}>
                {kingEntries.map((entry, index) => (
                  <ThemedText key={`${entry.memberId}-${index}`} type="small">
                    👑 {memberNames[entry.memberId] ?? '?'}: {entry.ruleName}-König ({formatEuro(entry.cents)})
                  </ThemedText>
                ))}
              </ThemedView>
            )}
          </ThemedView>

          {isStaff && (
            <ThemedView style={styles.section}>
              <ThemedText type="smallBold">Kassen-Auswirkung dieses Abends</ThemedText>
              {kasseRanking.length === 0 ? (
                <ThemedText themeColor="textSecondary">Noch keine Buchungen.</ThemedText>
              ) : (
                kasseRanking.map((entry, index) => (
                  <ThemedText key={entry.memberId} type="small">
                    {index + 1}. {memberNames[entry.memberId] ?? '?'} — {formatEuro(entry.cents)}
                  </ThemedText>
                ))
              )}
            </ThemedView>
          )}

          <ThemedView style={styles.section}>
            <ThemedText type="smallBold">Ergebnisse</ThemedText>
            {gameRankings.length === 0 ? (
              <ThemedText themeColor="textSecondary">Noch keine Ergebnisse erfasst.</ThemedText>
            ) : (
              gameRankings.map((game) => (
                <ThemedView key={game.gameId} style={styles.subSection}>
                  <ThemedText type="small" themeColor="textSecondary">
                    {GAME_TYPE_LABELS[game.type] ?? game.type}
                    {game.description ? ` · ${game.description}` : ''}
                  </ThemedText>
                  {game.entries.map((entry, index) => (
                    <ThemedText key={entry.memberId} type="small">
                      {HAUSNUMMER_TYPES.has(game.type) ? `${index + 1}. ` : ''}
                      {memberNames[entry.memberId] ?? '?'} — {formatScore(game.type, entry.pins)}
                    </ThemedText>
                  ))}
                </ThemedView>
              ))
            )}
          </ThemedView>
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
    gap: Spacing.four,
    alignSelf: 'stretch',
    maxWidth: 500,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  section: {
    gap: Spacing.one,
  },
  subSection: {
    gap: Spacing.one,
    marginTop: Spacing.two,
  },
  error: {
    color: '#d33',
  },
});
