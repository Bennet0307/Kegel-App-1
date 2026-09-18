import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentMember } from '@/lib/member';
import { centsToEuroString, euroStringToCents, formatEuro } from '@/lib/money';
import { supabase } from '@/lib/supabase';
import { computeZehnerPenalties, type ZehnerMilestoneEntry } from '@/lib/zehnerSpiel';

type GameType = 'kleine_hausnummer' | 'grosse_hausnummer' | 'freitext' | 'zehner';

const GAME_TYPES: { value: GameType; label: string }[] = [
  { value: 'kleine_hausnummer', label: 'Kleine Hausnummer' },
  { value: 'grosse_hausnummer', label: 'Große Hausnummer' },
  { value: 'freitext', label: 'Freitext' },
  { value: 'zehner', label: '10er-Spiel' },
];

type Digits = { h: string; t: string; e: string };
type PenaltyMode = 'fest' | 'prozent';
type ZehnerEntry = { throwerId: string; hitExact: boolean | null };

export default function EnterScoreScreen() {
  const theme = useTheme();
  const { eventId, gameId } = useLocalSearchParams<{ eventId?: string; gameId?: string }>();
  const isEditing = Boolean(gameId);

  const [members, setMembers] = useState<{ id: string; display_name: string }[]>([]);
  const [gameType, setGameType] = useState<GameType>('grosse_hausnummer');
  const [digitsByMember, setDigitsByMember] = useState<Record<string, Digits>>({});
  const [maxEuro, setMaxEuro] = useState('');
  const [penaltyMode, setPenaltyMode] = useState<PenaltyMode>('fest');
  const [step, setStep] = useState('');
  const [stepDefaults, setStepDefaults] = useState<{ fest: string; prozent: string }>({ fest: '', prozent: '' });
  const [description, setDescription] = useState('');
  const [penaltyByMember, setPenaltyByMember] = useState<Record<string, string>>({});
  const [zehnerMaxPins, setZehnerMaxPins] = useState('');
  const [zehnerStepEuro, setZehnerStepEuro] = useState('');
  const [zehnerMilestones, setZehnerMilestones] = useState<Record<number, ZehnerEntry>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isFreitext = gameType === 'freitext';
  const isZehner = gameType === 'zehner';
  const zehnerMilestoneList = (() => {
    const max = Number(zehnerMaxPins);
    if (!Number.isFinite(max) || max < 10) return [];
    const list: number[] = [];
    for (let m = 10; m <= max; m += 10) list.push(m);
    return list;
  })();
  const zehnerPreview = (() => {
    const stepCents = euroStringToCents(zehnerStepEuro);
    if (Number.isNaN(stepCents)) return [];
    const entries: ZehnerMilestoneEntry[] = [];
    for (const milestone of zehnerMilestoneList) {
      const entry = zehnerMilestones[milestone];
      if (entry && entry.throwerId && entry.hitExact !== null) {
        entries.push({ milestone, throwerMemberId: entry.throwerId, hitExact: entry.hitExact });
      }
    }
    return computeZehnerPenalties(entries, stepCents);
  })();

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
          .or(`role.neq.gast,guest_event_id.eq.${eventId ?? ''}`)
          .order('display_name', { ascending: true }),
        supabase
          .from('club')
          .select(
            'hausnummer_penalty_max_cents, hausnummer_penalty_mode, hausnummer_penalty_step_cents, hausnummer_penalty_step_percent, zehner_max_pins, zehner_step_cents',
          )
          .eq('id', currentMember.club_id)
          .single(),
      ]);

      if (membersError) {
        setError(membersError.message);
      } else {
        setMembers(memberRows ?? []);
      }

      // Vorbelegung mit dem Club-Standard; bei Bearbeiten unten ggf.
      // durch den tatsächlichen Snapshot des Spiels überschrieben.
      if (clubRow) {
        setMaxEuro(centsToEuroString(clubRow.hausnummer_penalty_max_cents));
        setPenaltyMode(clubRow.hausnummer_penalty_mode as PenaltyMode);
        const defaults = {
          fest: centsToEuroString(clubRow.hausnummer_penalty_step_cents),
          prozent: String(clubRow.hausnummer_penalty_step_percent),
        };
        setStepDefaults(defaults);
        setStep(defaults[clubRow.hausnummer_penalty_mode as PenaltyMode]);
        setZehnerMaxPins(String(clubRow.zehner_max_pins));
        setZehnerStepEuro(centsToEuroString(clubRow.zehner_step_cents));
      }

      if (gameId) {
        const [{ data: gameRow }, { data: scoreRows }, { data: zehnerRows }] = await Promise.all([
          supabase
            .from('game')
            .select(
              'type, description, penalty_max_cents, penalty_mode, penalty_step_cents, penalty_step_percent, zehner_max_pins, zehner_step_cents',
            )
            .eq('id', gameId)
            .single(),
          supabase.from('score').select('member_id, pins').eq('game_id', gameId),
          supabase.from('zehner_milestone').select('milestone, thrower_member_id, hit_exact').eq('game_id', gameId),
        ]);

        if (gameRow) {
          setGameType(gameRow.type as GameType);

          if (gameRow.type === 'freitext') {
            setDescription(gameRow.description ?? '');
          } else if (gameRow.type === 'zehner') {
            if (gameRow.zehner_max_pins != null) setZehnerMaxPins(String(gameRow.zehner_max_pins));
            if (gameRow.zehner_step_cents != null) setZehnerStepEuro(centsToEuroString(gameRow.zehner_step_cents));
          } else if (gameRow.penalty_max_cents != null && gameRow.penalty_mode) {
            setMaxEuro(centsToEuroString(gameRow.penalty_max_cents));
            setPenaltyMode(gameRow.penalty_mode as PenaltyMode);
            setStep(
              gameRow.penalty_mode === 'prozent'
                ? String(gameRow.penalty_step_percent)
                : centsToEuroString(gameRow.penalty_step_cents ?? 0),
            );
          }
        }

        if (gameRow?.type === 'freitext') {
          const penalties: Record<string, string> = {};
          for (const row of scoreRows ?? []) {
            penalties[row.member_id] = centsToEuroString(row.pins);
          }
          setPenaltyByMember(penalties);
        } else if (gameRow?.type === 'zehner') {
          const milestones: Record<number, ZehnerEntry> = {};
          for (const row of zehnerRows ?? []) {
            milestones[row.milestone] = { throwerId: row.thrower_member_id, hitExact: row.hit_exact };
          }
          setZehnerMilestones(milestones);
        } else {
          const digits: Record<string, Digits> = {};
          for (const row of scoreRows ?? []) {
            const padded = String(row.pins).padStart(3, '0');
            digits[row.member_id] = { h: padded[0], t: padded[1], e: padded[2] };
          }
          setDigitsByMember(digits);
        }
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

  function setMilestoneThrower(milestone: number, throwerId: string) {
    setZehnerMilestones((prev) => ({
      ...prev,
      [milestone]: { throwerId, hitExact: prev[milestone]?.hitExact ?? null },
    }));
  }

  function setMilestoneHitExact(milestone: number, hitExact: boolean) {
    setZehnerMilestones((prev) => ({
      ...prev,
      [milestone]: { throwerId: prev[milestone]?.throwerId ?? '', hitExact },
    }));
  }

  async function handleSave() {
    if (!isEditing && !eventId) {
      setError('Kein Kegelabend ausgewählt.');
      return;
    }

    if (isFreitext) {
      const penalties: { member_id: string; amount_cents: number }[] = [];
      for (const memberRow of members) {
        const value = penaltyByMember[memberRow.id];
        if (value === undefined || value.trim() === '') continue;

        const cents = euroStringToCents(value);
        if (Number.isNaN(cents) || cents < 0) {
          setError(`Bitte bei ${memberRow.display_name} einen gültigen Betrag angeben.`);
          return;
        }
        penalties.push({ member_id: memberRow.id, amount_cents: cents });
      }

      if (penalties.length === 0) {
        setError('Bitte mindestens ein Mitglied eintragen (0 = teilgenommen, keine Strafe).');
        return;
      }

      setSaving(true);
      setError(null);

      const { error: rpcError } = isEditing
        ? await supabase.rpc('update_freitext_game', {
            p_game_id: gameId,
            p_description: description,
            p_penalties: penalties,
          })
        : await supabase.rpc('record_freitext_game', {
            p_event_id: eventId,
            p_description: description,
            p_penalties: penalties,
          });

      setSaving(false);

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      router.replace('/events');
      return;
    }

    if (isZehner) {
      const maxPins = Number(zehnerMaxPins);
      const stepCents = euroStringToCents(zehnerStepEuro);
      if (!Number.isInteger(maxPins) || maxPins < 10) {
        setError('Bitte eine gültige Maximalzahl an Pins angeben (mindestens 10).');
        return;
      }
      if (Number.isNaN(stepCents) || stepCents < 0) {
        setError('Bitte eine gültige Schrittweite angeben.');
        return;
      }

      const milestones: { milestone: number; thrower_member_id: string; hit_exact: boolean }[] = [];
      for (const milestone of zehnerMilestoneList) {
        const entry = zehnerMilestones[milestone];
        if (!entry || !entry.throwerId || entry.hitExact === null) {
          setError(`Bitte bei Zehnerwert ${milestone} Werfer und Genau/Drüber angeben.`);
          return;
        }
        milestones.push({ milestone, thrower_member_id: entry.throwerId, hit_exact: entry.hitExact });
      }

      setSaving(true);
      setError(null);

      const { error: rpcError } = isEditing
        ? await supabase.rpc('update_zehner_game', {
            p_game_id: gameId,
            p_max_pins: maxPins,
            p_step_cents: stepCents,
            p_milestones: milestones,
          })
        : await supabase.rpc('record_zehner_game', {
            p_event_id: eventId,
            p_max_pins: maxPins,
            p_step_cents: stepCents,
            p_milestones: milestones,
          });

      setSaving(false);

      if (rpcError) {
        setError(rpcError.message);
        return;
      }

      router.replace('/events');
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

    const maxCents = euroStringToCents(maxEuro);
    const stepValue = Number(step.replace(',', '.'));
    if (Number.isNaN(maxCents) || Number.isNaN(stepValue)) {
      setError('Bitte Maximalbetrag und Reduzierung als Zahl angeben.');
      return;
    }

    setSaving(true);
    setError(null);

    const penaltyParams = {
      p_penalty_max_cents: maxCents,
      p_penalty_mode: penaltyMode,
      p_penalty_step_cents: penaltyMode === 'fest' ? Math.round(stepValue * 100) : 0,
      p_penalty_step_percent: penaltyMode === 'prozent' ? stepValue : 0,
    };

    const { error: rpcError } = isEditing
      ? await supabase.rpc('update_game_scores', {
          p_game_id: gameId,
          p_type: gameType,
          p_scores: scores,
          ...penaltyParams,
        })
      : await supabase.rpc('record_game_scores', {
          p_event_id: eventId,
          p_type: gameType,
          p_scores: scores,
          ...penaltyParams,
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

          {isFreitext ? (
            <>
              <ThemedText type="small" themeColor="textSecondary">
                Beschreibung des Spiels
              </ThemedText>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="z.B. Kniffel-Runde"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />

              <ThemedText type="small" themeColor="textSecondary">
                Strafe je Mitglied (€, leer = hat nicht teilgenommen, 0 = teilgenommen ohne Strafe)
              </ThemedText>

              {members.map((memberRow) => (
                <ThemedView key={memberRow.id} style={styles.memberRow}>
                  <ThemedText style={styles.memberName}>{memberRow.display_name}</ThemedText>
                  <TextInput
                    value={penaltyByMember[memberRow.id] ?? ''}
                    onChangeText={(value) =>
                      setPenaltyByMember((prev) => ({ ...prev, [memberRow.id]: value }))
                    }
                    placeholder="0,00"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    style={[styles.freitextInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                </ThemedView>
              ))}
            </>
          ) : isZehner ? (
            <>
              <ThemedView style={styles.penaltyRow}>
                <ThemedView style={styles.penaltyField}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Maximalzahl an Pins
                  </ThemedText>
                  <TextInput
                    value={zehnerMaxPins}
                    onChangeText={setZehnerMaxPins}
                    placeholder="300"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                </ThemedView>

                <ThemedView style={styles.penaltyField}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Strafe je Zehnerwert (€)
                  </ThemedText>
                  <TextInput
                    value={zehnerStepEuro}
                    onChangeText={setZehnerStepEuro}
                    placeholder="0,10"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                </ThemedView>
              </ThemedView>

              <ThemedText type="small" themeColor="textSecondary">
                Pro Zehnerwert: wer hat geworfen, genau getroffen oder drübergeworfen? (genau = alle außer
                Werfer zahlen, drüber = nur Werfer zahlt)
              </ThemedText>

              {zehnerMilestoneList.length === 0 && (
                <ThemedText themeColor="textSecondary">Bitte zuerst eine Maximalzahl ab 10 angeben.</ThemedText>
              )}

              {zehnerMilestoneList.map((milestone) => {
                const entry = zehnerMilestones[milestone];
                return (
                  <ThemedView key={milestone} type="backgroundElement" style={styles.zehnerRow}>
                    <ThemedText type="smallBold">{milestone}</ThemedText>
                    <ThemedView style={styles.chipRow}>
                      {members.map((memberRow) => (
                        <Pressable
                          key={memberRow.id}
                          style={[
                            styles.chip,
                            {
                              backgroundColor:
                                entry?.throwerId === memberRow.id ? theme.backgroundSelected : theme.background,
                            },
                          ]}
                          onPress={() => setMilestoneThrower(milestone, memberRow.id)}>
                          <ThemedText type="small">{memberRow.display_name}</ThemedText>
                        </Pressable>
                      ))}
                    </ThemedView>
                    <ThemedView style={styles.typeRow}>
                      <Pressable
                        style={[
                          styles.typeButton,
                          { backgroundColor: entry?.hitExact === true ? theme.backgroundSelected : theme.background },
                        ]}
                        onPress={() => setMilestoneHitExact(milestone, true)}>
                        <ThemedText type="small">Genau getroffen</ThemedText>
                      </Pressable>
                      <Pressable
                        style={[
                          styles.typeButton,
                          { backgroundColor: entry?.hitExact === false ? theme.backgroundSelected : theme.background },
                        ]}
                        onPress={() => setMilestoneHitExact(milestone, false)}>
                        <ThemedText type="small">Drübergeworfen</ThemedText>
                      </Pressable>
                    </ThemedView>
                  </ThemedView>
                );
              })}

              {zehnerPreview.length > 0 && (
                <>
                  <ThemedText type="smallBold" style={styles.sectionSpacing}>
                    Vorschau: Strafen
                  </ThemedText>
                  {zehnerPreview.map(({ memberId, cents }) => (
                    <ThemedView key={memberId} style={styles.row}>
                      <ThemedText type="small">
                        {members.find((memberRow) => memberRow.id === memberId)?.display_name ?? '?'}
                      </ThemedText>
                      <ThemedText type="small">{formatEuro(cents)}</ThemedText>
                    </ThemedView>
                  ))}
                </>
              )}
            </>
          ) : (
            <>
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
                          selectTextOnFocus
                          style={[styles.digitInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                        />
                      ))}
                    </ThemedView>
                  </ThemedView>
                );
              })}

              <ThemedText type="small" themeColor="textSecondary">
                Strafe: Verlierer zahlt den Maximalbetrag, jeder bessere Rang zahlt weniger
              </ThemedText>

              <ThemedView style={styles.penaltyRow}>
                <ThemedView style={styles.penaltyField}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Maximalbetrag (€)
                  </ThemedText>
                  <TextInput
                    value={maxEuro}
                    onChangeText={setMaxEuro}
                    placeholder="0,50"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                </ThemedView>

                <ThemedView style={styles.penaltyField}>
                  <ThemedText type="small" themeColor="textSecondary">
                    Reduzierung pro Rang ({penaltyMode === 'prozent' ? '%' : '€'})
                  </ThemedText>
                  <TextInput
                    value={step}
                    onChangeText={setStep}
                    placeholder={penaltyMode === 'prozent' ? '20' : '0,10'}
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="decimal-pad"
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                </ThemedView>
              </ThemedView>

              <ThemedView style={styles.typeRow}>
                {(['fest', 'prozent'] as const).map((mode) => (
                  <Pressable
                    key={mode}
                    style={[
                      styles.typeButton,
                      { backgroundColor: penaltyMode === mode ? theme.backgroundSelected : theme.backgroundElement },
                    ]}
                    onPress={() => {
                      setPenaltyMode(mode);
                      setStep(stepDefaults[mode]);
                    }}>
                    <ThemedText type="small">{mode === 'fest' ? 'Fester Betrag' : 'Prozentual'}</ThemedText>
                  </Pressable>
                ))}
              </ThemedView>
            </>
          )}

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
  freitextInput: {
    width: 90,
    height: 44,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    fontSize: 16,
    textAlign: 'right',
  },
  input: {
    height: 48,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  penaltyRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  penaltyField: {
    flex: 1,
    gap: Spacing.half,
  },
  zehnerRow: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.two,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.two,
  },
  chip: {
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.one,
    borderRadius: Spacing.two,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionSpacing: {
    marginTop: Spacing.two,
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
