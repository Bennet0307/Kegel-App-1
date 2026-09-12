import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentMember } from '@/lib/member';
import { supabase } from '@/lib/supabase';

type PenaltyMode = 'fest' | 'prozent';
type TieMode = 'alle_zahlen' | 'keiner_zahlt' | 'geteilt';

const TIE_MODES: { value: TieMode; label: string }[] = [
  { value: 'alle_zahlen', label: 'Alle zahlen' },
  { value: 'keiner_zahlt', label: 'Keiner zahlt' },
  { value: 'geteilt', label: 'Zuschlag wird geteilt' },
];

function centsToEuroString(cents: number) {
  return (cents / 100).toFixed(2);
}

function euroStringToCents(value: string) {
  return Math.round(Number(value.replace(',', '.')) * 100);
}

export default function ClubSettingsScreen() {
  const theme = useTheme();
  const [clubId, setClubId] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [kegelgeldEuro, setKegelgeldEuro] = useState('');
  const [maxEuro, setMaxEuro] = useState('');
  const [penaltyMode, setPenaltyMode] = useState<PenaltyMode>('fest');
  const [step, setStep] = useState('');
  const [stepDefaults, setStepDefaults] = useState<{ fest: string; prozent: string }>({ fest: '', prozent: '' });
  const [tieMode, setTieMode] = useState<TieMode>('alle_zahlen');
  const [autoArchiveDays, setAutoArchiveDays] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    (async () => {
      const currentMember = await getCurrentMember();
      if (!currentMember) {
        setLoading(false);
        setError('Kein Club gefunden.');
        return;
      }

      setClubId(currentMember.club_id);
      setIsStaff(currentMember.role === 'admin' || currentMember.role === 'kassierer');

      const { data: clubRow, error: clubError } = await supabase
        .from('club')
        .select(
          'kegelgeld_cents, hausnummer_penalty_max_cents, hausnummer_penalty_mode, hausnummer_penalty_step_cents, hausnummer_penalty_step_percent, king_surcharge_tie_mode, auto_archive_days',
        )
        .eq('id', currentMember.club_id)
        .single();

      if (clubError) {
        setError(clubError.message);
        setLoading(false);
        return;
      }

      setKegelgeldEuro(centsToEuroString(clubRow.kegelgeld_cents));
      setMaxEuro(centsToEuroString(clubRow.hausnummer_penalty_max_cents));
      setPenaltyMode(clubRow.hausnummer_penalty_mode as PenaltyMode);
      const defaults = {
        fest: centsToEuroString(clubRow.hausnummer_penalty_step_cents),
        prozent: String(clubRow.hausnummer_penalty_step_percent),
      };
      setStepDefaults(defaults);
      setStep(defaults[clubRow.hausnummer_penalty_mode as PenaltyMode]);
      setTieMode(clubRow.king_surcharge_tie_mode as TieMode);
      setAutoArchiveDays(clubRow.auto_archive_days != null ? String(clubRow.auto_archive_days) : '');

      setLoading(false);
    })();
  }, []);

  async function handleSave() {
    if (!clubId) return;

    const kegelgeldCents = euroStringToCents(kegelgeldEuro);
    const maxCents = euroStringToCents(maxEuro);
    const stepValue = Number(step.replace(',', '.'));

    if (Number.isNaN(kegelgeldCents) || Number.isNaN(maxCents) || Number.isNaN(stepValue)) {
      setError('Bitte alle Beträge als Zahl angeben.');
      return;
    }

    let autoArchiveDaysValue: number | null = null;
    if (autoArchiveDays.trim() !== '') {
      autoArchiveDaysValue = Number(autoArchiveDays);
      if (Number.isNaN(autoArchiveDaysValue) || autoArchiveDaysValue <= 0) {
        setError('Bitte bei "Automatisch archivieren nach" eine gültige Anzahl Tage angeben (oder leer lassen).');
        return;
      }
    }

    setSaving(true);
    setError(null);
    setSaved(false);

    const { error: updateError } = await supabase
      .from('club')
      .update({
        kegelgeld_cents: kegelgeldCents,
        hausnummer_penalty_max_cents: maxCents,
        hausnummer_penalty_mode: penaltyMode,
        hausnummer_penalty_step_cents: penaltyMode === 'fest' ? Math.round(stepValue * 100) : 0,
        hausnummer_penalty_step_percent: penaltyMode === 'prozent' ? stepValue : 0,
        king_surcharge_tie_mode: tieMode,
        auto_archive_days: autoArchiveDaysValue,
      })
      .eq('id', clubId);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSaved(true);
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

  if (!isStaff) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText>Nur Admin/Kassierer dürfen die Club-Einstellungen bearbeiten.</ThemedText>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Club-Einstellungen
          </ThemedText>

          <ThemedText type="small" themeColor="textSecondary">
            Kegelgeld pro Teilnahme (€)
          </ThemedText>
          <TextInput
            value={kegelgeldEuro}
            onChangeText={setKegelgeldEuro}
            placeholder="2.00"
            placeholderTextColor={theme.textSecondary}
            keyboardType="decimal-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          <ThemedText type="small" themeColor="textSecondary">
            Hausnummer-Strafe: Standardformel (pro Ergebniserfassung überschreibbar)
          </ThemedText>

          <ThemedView style={styles.penaltyRow}>
            <ThemedView style={styles.penaltyField}>
              <ThemedText type="small" themeColor="textSecondary">
                Maximalbetrag (€)
              </ThemedText>
              <TextInput
                value={maxEuro}
                onChangeText={setMaxEuro}
                placeholder="0.50"
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
                placeholder={penaltyMode === 'prozent' ? '20' : '0.10'}
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

          <ThemedText type="small" themeColor="textSecondary">
            Pumpenkönig-Zuschlag: Verhalten bei Gleichstand
          </ThemedText>
          <ThemedView style={styles.typeRow}>
            {TIE_MODES.map((option) => (
              <Pressable
                key={option.value}
                style={[
                  styles.typeButton,
                  { backgroundColor: tieMode === option.value ? theme.backgroundSelected : theme.backgroundElement },
                ]}
                onPress={() => setTieMode(option.value)}>
                <ThemedText type="small">{option.label}</ThemedText>
              </Pressable>
            ))}
          </ThemedView>

          <ThemedText type="small" themeColor="textSecondary">
            Termine automatisch archivieren nach (Tage, leer = deaktiviert)
          </ThemedText>
          <TextInput
            value={autoArchiveDays}
            onChangeText={setAutoArchiveDays}
            placeholder="z.B. 90"
            placeholderTextColor={theme.textSecondary}
            keyboardType="number-pad"
            style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
          />

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}
          {saved && <ThemedText themeColor="textSecondary">Gespeichert.</ThemedText>}

          {saving ? (
            <ActivityIndicator />
          ) : (
            <Pressable style={[styles.button, { backgroundColor: theme.backgroundElement }]} onPress={handleSave}>
              <ThemedText type="smallBold">Speichern</ThemedText>
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
