import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dateToGermanString, germanDateToIso } from '@/lib/date';
import { computeKingCrowns } from '@/lib/kingSurcharge';
import { getCurrentMember } from '@/lib/member';
import { formatEuro } from '@/lib/money';
import { supabase } from '@/lib/supabase';

const POSITIVE_TRANSACTION_TYPES = new Set(['einzahlung', 'kegelgeld', 'strafe']);
const HAUSNUMMER_LABELS: Record<string, string> = {
  kleine_hausnummer: 'Kleine Hausnummer',
  grosse_hausnummer: 'Große Hausnummer',
};

type ZeitraumMode = 'gesamt' | 'jahr' | 'zeitraum';
type AppliedRange = { fromDate: Date | null; toDate: Date | null; label: string };

const ZEITRAUM_MODES: { value: ZeitraumMode; label: string }[] = [
  { value: 'gesamt', label: 'Gesamte Historie' },
  { value: 'jahr', label: 'Kalenderjahr' },
  { value: 'zeitraum', label: 'Zeitraum' },
];

type KasseEntry = { memberId: string; cents: number };
type HausnummerEntry = { memberId: string; best: number };
type AttendanceEntry = {
  memberId: string;
  zusagen: number;
  teilnahmen: number;
  quoteZusage: number;
  quoteTeilnahme: number;
};
type PenaltyEntry = { memberId: string; count: number; cents: number };
type KingEntry = { memberId: string; total: number; byRule: Record<string, number> };

function formatHausnummer(pins: number) {
  return String(pins).padStart(3, '0');
}

function formatPercent(ratio: number) {
  return `${Math.round(ratio * 100)}%`;
}

function startOfYear(year: number) {
  return new Date(year, 0, 1, 0, 0, 0, 0);
}

function endOfYear(year: number) {
  return new Date(year, 11, 31, 23, 59, 59, 999);
}

export default function StatistikScreen() {
  const theme = useTheme();
  const currentYear = new Date().getFullYear();

  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterError, setFilterError] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);

  const [zeitraumMode, setZeitraumMode] = useState<ZeitraumMode>('gesamt');
  const [yearInput, setYearInput] = useState(String(currentYear));
  const [vonInput, setVonInput] = useState('');
  const [bisInput, setBisInput] = useState('');
  const [appliedRange, setAppliedRange] = useState<AppliedRange>({
    fromDate: null,
    toDate: null,
    label: 'gesamte Historie',
  });

  const [kasseRanking, setKasseRanking] = useState<KasseEntry[]>([]);
  const [hausnummerRanking, setHausnummerRanking] = useState<Record<string, HausnummerEntry[]>>({});
  const [attendanceRanking, setAttendanceRanking] = useState<AttendanceEntry[]>([]);
  const [penaltyRanking, setPenaltyRanking] = useState<PenaltyEntry[]>([]);
  const [kingRanking, setKingRanking] = useState<KingEntry[]>([]);

  const load = useCallback(async (range: AppliedRange) => {
    setLoading(true);
    setError(null);

    const currentMember = await getCurrentMember();
    if (!currentMember) {
      setLoading(false);
      setError('Kein Club gefunden.');
      return;
    }

    const clubId = currentMember.club_id;
    const staff = currentMember.role === 'admin' || currentMember.role === 'kassierer';
    setIsStaff(staff);

    const [{ data: memberRows }, { data: eventRows }, { data: ruleRows }, { data: clubRow }] = await Promise.all([
      supabase.from('member').select('id, display_name').eq('club_id', clubId),
      supabase.from('event').select('id, starts_at').eq('club_id', clubId),
      supabase
        .from('penalty_rule')
        .select('id, name, king_surcharge_cents')
        .eq('club_id', clubId)
        .eq('has_king_surcharge', true),
      supabase.from('club').select('king_surcharge_tie_mode').eq('id', clubId).single(),
    ]);

    const nameMap: Record<string, string> = {};
    for (const row of memberRows ?? []) nameMap[row.id] = row.display_name;
    setMemberNames(nameMap);

    // Zeitraum-Filter: nur Termine im gewählten Fenster berücksichtigen –
    // alles Weitere (attendance/game/score/penalty, über event_id verknüpft)
    // ist dadurch automatisch mitgefiltert.
    const filteredEventRows = (eventRows ?? []).filter((row) => {
      const startsAt = new Date(row.starts_at);
      if (range.fromDate && startsAt < range.fromDate) return false;
      if (range.toDate && startsAt > range.toDate) return false;
      return true;
    });
    const eventIds = filteredEventRows.map((row) => row.id);
    const isFiltered = range.fromDate !== null || range.toDate !== null;

    const [{ data: attendanceRows }, { data: gameRows }, { data: penaltyRows }] = await Promise.all([
      eventIds.length > 0
        ? supabase.from('attendance').select('event_id, member_id, status').in('event_id', eventIds)
        : Promise.resolve({ data: [] as { event_id: string; member_id: string; status: string }[] }),
      eventIds.length > 0
        ? supabase.from('game').select('id, event_id, type').in('event_id', eventIds)
        : Promise.resolve({ data: [] as { id: string; event_id: string; type: string }[] }),
      eventIds.length > 0
        ? supabase
            .from('penalty')
            .select('event_id, member_id, penalty_rule_id, unit_amount_cents, count')
            .in('event_id', eventIds)
        : Promise.resolve({
            data: [] as {
              event_id: string;
              member_id: string;
              penalty_rule_id: string | null;
              unit_amount_cents: number;
              count: number;
            }[],
          }),
    ]);

    const gameIds = (gameRows ?? []).map((row) => row.id);
    const { data: scoreRows } =
      gameIds.length > 0
        ? await supabase.from('score').select('game_id, member_id, pins').in('game_id', gameIds)
        : { data: [] as { game_id: string; member_id: string; pins: number }[] };

    // -- Hausnummer-Bestleistungen: pro Mitglied der beste Wert je Spielart --
    const gameTypeById: Record<string, string> = {};
    const gameEventById: Record<string, string> = {};
    for (const game of gameRows ?? []) {
      gameTypeById[game.id] = game.type;
      gameEventById[game.id] = game.event_id;
    }

    const bestByType: Record<string, Record<string, number>> = { kleine_hausnummer: {}, grosse_hausnummer: {} };
    for (const row of scoreRows ?? []) {
      const type = gameTypeById[row.game_id];
      if (type !== 'kleine_hausnummer' && type !== 'grosse_hausnummer') continue;
      const current = bestByType[type][row.member_id];
      if (current === undefined) {
        bestByType[type][row.member_id] = row.pins;
      } else {
        bestByType[type][row.member_id] =
          type === 'grosse_hausnummer' ? Math.max(current, row.pins) : Math.min(current, row.pins);
      }
    }

    const hausnummerResult: Record<string, HausnummerEntry[]> = {};
    for (const type of ['kleine_hausnummer', 'grosse_hausnummer']) {
      const entries = Object.entries(bestByType[type]).map(([memberId, best]) => ({ memberId, best }));
      entries.sort((a, b) => (type === 'grosse_hausnummer' ? b.best - a.best : a.best - b.best));
      hausnummerResult[type] = entries;
    }
    setHausnummerRanking(hausnummerResult);

    // -- Teilnahmequote: Zusagen vs. tatsächliche Teilnahme (Ergebnis in irgendeinem Spiel) --
    const zusagenByMember: Record<string, number> = {};
    for (const row of attendanceRows ?? []) {
      if (row.status === 'zugesagt') {
        zusagenByMember[row.member_id] = (zusagenByMember[row.member_id] ?? 0) + 1;
      }
    }

    const participatedEventsByMember: Record<string, Set<string>> = {};
    for (const row of scoreRows ?? []) {
      const eventId = gameEventById[row.game_id];
      if (!eventId) continue;
      participatedEventsByMember[row.member_id] ??= new Set();
      participatedEventsByMember[row.member_id].add(eventId);
    }

    const totalEvents = eventIds.length;
    const attendanceResult: AttendanceEntry[] = (memberRows ?? []).map((row) => {
      const zusagen = zusagenByMember[row.id] ?? 0;
      const teilnahmen = participatedEventsByMember[row.id]?.size ?? 0;
      return {
        memberId: row.id,
        zusagen,
        teilnahmen,
        quoteZusage: totalEvents > 0 ? zusagen / totalEvents : 0,
        quoteTeilnahme: totalEvents > 0 ? teilnahmen / totalEvents : 0,
      };
    });
    attendanceResult.sort((a, b) => b.quoteTeilnahme - a.quoteTeilnahme);
    setAttendanceRanking(attendanceResult);

    // -- Strafenkatalog-Rangliste: Gesamtsumme über alle Strafarten pro Mitglied --
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

    // -- Königs-Bilanz: wie oft war wer schon "<Strafart>-König"? Aus penalty
    // (club-weit lesbar) rekonstruiert statt aus transaction (RLS-beschränkt
    // auf eigene Buchungen für reguläre Mitglieder) – ergibt identische
    // Zählung zur tatsächlich gebuchten Zuschlag-Transaktion.
    const kingRules = ruleRows ?? [];
    const tieMode = (clubRow?.king_surcharge_tie_mode ?? 'alle_zahlen') as
      | 'alle_zahlen'
      | 'keiner_zahlt'
      | 'geteilt';

    const crowns = computeKingCrowns(penaltyRows ?? [], kingRules, tieMode);
    const kingTotals: Record<string, { total: number; byRule: Record<string, number> }> = {};
    for (const crown of crowns) {
      const existing = kingTotals[crown.memberId] ?? { total: 0, byRule: {} };
      existing.total += 1;
      existing.byRule[crown.ruleName] = (existing.byRule[crown.ruleName] ?? 0) + 1;
      kingTotals[crown.memberId] = existing;
    }

    const kingResult: KingEntry[] = Object.entries(kingTotals)
      .map(([memberId, { total, byRule }]) => ({ memberId, total, byRule }))
      .sort((a, b) => b.total - a.total);
    setKingRanking(kingResult);

    // -- Kegelkasse-Ranking: nur Admin/Kassierer, da `transaction` per RLS
    // reguläre Mitglieder nur ihre eigenen Buchungen sehen lässt (siehe
    // kasse.tsx) – eine öffentliche Rangliste würde das umgehen. Bei
    // aktivem Zeitraum-Filter zusätzlich auf Buchungen dieser Termine
    // beschränkt (`event_id in eventIds`) – manuelle Ad-hoc-Buchungen ohne
    // Termin-Bezug (Jahresbeitrag, Ausgabe, siehe kasse.tsx) fließen dann
    // nur bei "Gesamte Historie" mit ein.
    if (staff) {
      const transactionQuery = supabase.from('transaction').select('member_id, type, amount_cents').eq('club_id', clubId);
      const { data: transactionRows } = isFiltered
        ? eventIds.length > 0
          ? await transactionQuery.in('event_id', eventIds)
          : { data: [] as { member_id: string; type: string; amount_cents: number }[] }
        : await transactionQuery;

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
  }, []);

  useEffect(() => {
    load(appliedRange);
  }, [load, appliedRange]);

  function applyMode(mode: ZeitraumMode) {
    setZeitraumMode(mode);
    setFilterError(null);

    if (mode === 'gesamt') {
      setAppliedRange({ fromDate: null, toDate: null, label: 'gesamte Historie' });
    } else if (mode === 'jahr') {
      const year = Number(yearInput);
      if (!Number.isInteger(year) || year < 1900) {
        setFilterError('Bitte ein gültiges Jahr angeben.');
        return;
      }
      setAppliedRange({ fromDate: startOfYear(year), toDate: endOfYear(year), label: String(year) });
    }
    // 'zeitraum': erst über "Anwenden" nach Eingabe von Von/Bis, siehe unten.
  }

  function applyZeitraum() {
    setFilterError(null);
    const fromIso = germanDateToIso(vonInput);
    const toIso = germanDateToIso(bisInput);
    if (!fromIso || !toIso) {
      setFilterError('Bitte Von und Bis im Format TT.MM.JJJJ angeben.');
      return;
    }

    const fromDate = new Date(`${fromIso}T00:00:00`);
    const toDate = new Date(`${toIso}T23:59:59.999`);
    if (fromDate > toDate) {
      setFilterError('"Von" darf nicht nach "Bis" liegen.');
      return;
    }

    setAppliedRange({
      fromDate,
      toDate,
      label: `${dateToGermanString(fromDate)} – ${dateToGermanString(toDate)}`,
    });
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Statistik &amp; Ranglisten
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          <ThemedView style={styles.typeRow}>
            {ZEITRAUM_MODES.map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.typeButton,
                  { backgroundColor: zeitraumMode === option.value ? theme.backgroundSelected : theme.backgroundElement },
                ]}
                onPress={() => applyMode(option.value)}>
                <ThemedText type="small">{option.label}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>

          {zeitraumMode === 'jahr' && (
            <ThemedView style={styles.filterRow}>
              <TextInput
                value={yearInput}
                onChangeText={setYearInput}
                placeholder={String(currentYear)}
                placeholderTextColor={theme.textSecondary}
                keyboardType="number-pad"
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable
                style={[styles.button, { backgroundColor: theme.backgroundElement }]}
                onPress={() => applyMode('jahr')}>
                <ThemedText type="small">Anwenden</ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {zeitraumMode === 'zeitraum' && (
            <ThemedView style={styles.filterRow}>
              <TextInput
                value={vonInput}
                onChangeText={setVonInput}
                placeholder="Von (TT.MM.JJJJ)"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, styles.dateInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <TextInput
                value={bisInput}
                onChangeText={setBisInput}
                placeholder="Bis (TT.MM.JJJJ)"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, styles.dateInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <Pressable style={[styles.button, { backgroundColor: theme.backgroundElement }]} onPress={applyZeitraum}>
                <ThemedText type="small">Anwenden</ThemedText>
              </Pressable>
            </ThemedView>
          )}

          {filterError && <ThemedText style={styles.error}>{filterError}</ThemedText>}

          <ThemedText type="small" themeColor="textSecondary">
            Zeitraum: {appliedRange.label}
          </ThemedText>

          {loading ? (
            <ActivityIndicator />
          ) : (
            <>
              {isStaff && (
                <ThemedView style={styles.section}>
                  <ThemedText type="smallBold">Kegelkasse-Ranking</ThemedText>
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
                <ThemedText type="smallBold">Hausnummer-Bestleistungen</ThemedText>
                {(['grosse_hausnummer', 'kleine_hausnummer'] as const).map((type) => (
                  <ThemedView key={type} style={styles.subSection}>
                    <ThemedText type="small" themeColor="textSecondary">
                      {HAUSNUMMER_LABELS[type]}
                    </ThemedText>
                    {(hausnummerRanking[type] ?? []).length === 0 ? (
                      <ThemedText themeColor="textSecondary">Noch keine Ergebnisse.</ThemedText>
                    ) : (
                      (hausnummerRanking[type] ?? []).map((entry, index) => (
                        <ThemedText key={entry.memberId} type="small">
                          {index + 1}. {memberNames[entry.memberId] ?? '?'} — {formatHausnummer(entry.best)}
                        </ThemedText>
                      ))
                    )}
                  </ThemedView>
                ))}
              </ThemedView>

              <ThemedView style={styles.section}>
                <ThemedText type="smallBold">Teilnahmequote</ThemedText>
                {attendanceRanking.length === 0 ? (
                  <ThemedText themeColor="textSecondary">Noch keine Termine.</ThemedText>
                ) : (
                  attendanceRanking.map((entry, index) => (
                    <ThemedText key={entry.memberId} type="small">
                      {index + 1}. {memberNames[entry.memberId] ?? '?'} — {formatPercent(entry.quoteTeilnahme)}{' '}
                      teilgenommen (Zusage-Quote: {formatPercent(entry.quoteZusage)})
                    </ThemedText>
                  ))
                )}
              </ThemedView>

              <ThemedView style={styles.section}>
                <ThemedText type="smallBold">Strafenkatalog-Rangliste</ThemedText>
                {penaltyRanking.length === 0 ? (
                  <ThemedText themeColor="textSecondary">Noch keine Strafen erfasst.</ThemedText>
                ) : (
                  penaltyRanking.map((entry, index) => (
                    <ThemedText key={entry.memberId} type="small">
                      {index + 1}. {memberNames[entry.memberId] ?? '?'} — {entry.count}× ({formatEuro(entry.cents)})
                    </ThemedText>
                  ))
                )}

                {kingRanking.length > 0 && (
                  <ThemedView style={styles.subSection}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Königs-Bilanz
                    </ThemedText>
                    {kingRanking.map((entry, index) => (
                      <ThemedText key={entry.memberId} type="small">
                        {index + 1}. {memberNames[entry.memberId] ?? '?'} — {entry.total}× König (
                        {Object.entries(entry.byRule)
                          .map(([ruleName, count]) => `${count}× ${ruleName}-König`)
                          .join(', ')}
                        )
                      </ThemedText>
                    ))}
                  </ThemedView>
                )}
              </ThemedView>
            </>
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
    gap: Spacing.four,
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
  filterRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  input: {
    height: 48,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
    flex: 1,
  },
  dateInput: {
    flex: 1,
  },
  button: {
    height: 48,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
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
