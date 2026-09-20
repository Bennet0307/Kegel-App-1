import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { WEB_APP_URL } from '@/lib/config';
import { centsToEuroString, euroStringToCents } from '@/lib/money';
import { getCurrentMember } from '@/lib/member';
import { supabase } from '@/lib/supabase';

function generateInviteCode() {
  const chars = '0123456789abcdef';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

type PenaltyMode = 'fest' | 'prozent';
type TieMode = 'alle_zahlen' | 'keiner_zahlt' | 'geteilt';
type LatePenaltyMode = 'pauschal' | 'intervall';

const TIE_MODES: { value: TieMode; label: string }[] = [
  { value: 'alle_zahlen', label: 'Alle zahlen' },
  { value: 'keiner_zahlt', label: 'Keiner zahlt' },
  { value: 'geteilt', label: 'Zuschlag wird geteilt' },
];

const LATE_PENALTY_MODES: { value: LatePenaltyMode; label: string }[] = [
  { value: 'pauschal', label: 'Pauschal' },
  { value: 'intervall', label: 'Pro Intervall' },
];

export default function ClubSettingsScreen() {
  const theme = useTheme();
  const [clubId, setClubId] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);
  const [inviteCode, setInviteCode] = useState('');
  const [confirmingRegenerate, setConfirmingRegenerate] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [kegelgeldEuro, setKegelgeldEuro] = useState('');
  const [maxEuro, setMaxEuro] = useState('');
  const [penaltyMode, setPenaltyMode] = useState<PenaltyMode>('fest');
  const [step, setStep] = useState('');
  const [stepDefaults, setStepDefaults] = useState<{ fest: string; prozent: string }>({ fest: '', prozent: '' });
  const [tieMode, setTieMode] = useState<TieMode>('alle_zahlen');
  const [autoArchiveDays, setAutoArchiveDays] = useState('');
  const [latePenaltyEnabled, setLatePenaltyEnabled] = useState(false);
  const [latePenaltyMode, setLatePenaltyMode] = useState<LatePenaltyMode>('pauschal');
  const [latePenaltyEuro, setLatePenaltyEuro] = useState('');
  const [latePenaltyIntervalMinutes, setLatePenaltyIntervalMinutes] = useState('');
  const [latePenaltyIntervalEuro, setLatePenaltyIntervalEuro] = useState('');
  const [zehnerMaxPins, setZehnerMaxPins] = useState('');
  const [zehnerStepEuro, setZehnerStepEuro] = useState('');
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
          'invite_code, kegelgeld_cents, hausnummer_penalty_max_cents, hausnummer_penalty_mode, hausnummer_penalty_step_cents, hausnummer_penalty_step_percent, king_surcharge_tie_mode, auto_archive_days, late_penalty_mode, late_penalty_cents, late_penalty_interval_minutes, late_penalty_interval_cents, zehner_max_pins, zehner_step_cents',
        )
        .eq('id', currentMember.club_id)
        .single();

      if (clubError) {
        setError(clubError.message);
        setLoading(false);
        return;
      }

      setInviteCode(clubRow.invite_code);
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

      setLatePenaltyEnabled(clubRow.late_penalty_mode != null);
      if (clubRow.late_penalty_mode) {
        setLatePenaltyMode(clubRow.late_penalty_mode as LatePenaltyMode);
      }
      setLatePenaltyEuro(clubRow.late_penalty_cents != null ? centsToEuroString(clubRow.late_penalty_cents) : '');
      setLatePenaltyIntervalMinutes(
        clubRow.late_penalty_interval_minutes != null ? String(clubRow.late_penalty_interval_minutes) : '',
      );
      setLatePenaltyIntervalEuro(
        clubRow.late_penalty_interval_cents != null ? centsToEuroString(clubRow.late_penalty_interval_cents) : '',
      );
      setZehnerMaxPins(String(clubRow.zehner_max_pins));
      setZehnerStepEuro(centsToEuroString(clubRow.zehner_step_cents));

      setLoading(false);
    })();
  }, []);

  async function handleCopyCode() {
    await Clipboard.setStringAsync(inviteCode);
    setCopied('code');
  }

  async function handleCopyLink() {
    await Clipboard.setStringAsync(`${WEB_APP_URL}/join-club?code=${inviteCode}`);
    setCopied('link');
  }

  async function handleRegenerateCode() {
    if (!clubId) return;

    setRegenerating(true);
    setError(null);
    setCopied(null);

    const newCode = generateInviteCode();
    const { error: updateError } = await supabase.from('club').update({ invite_code: newCode }).eq('id', clubId);

    setRegenerating(false);
    setConfirmingRegenerate(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setInviteCode(newCode);
  }

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

    let latePenaltyCentsValue: number | null = null;
    let latePenaltyIntervalMinutesValue: number | null = null;
    let latePenaltyIntervalCentsValue: number | null = null;

    if (latePenaltyEnabled) {
      if (latePenaltyMode === 'pauschal') {
        latePenaltyCentsValue = euroStringToCents(latePenaltyEuro);
        if (Number.isNaN(latePenaltyCentsValue) || latePenaltyCentsValue <= 0) {
          setError('Bitte bei der Verspätungsstrafe einen gültigen Betrag angeben.');
          return;
        }
      } else {
        latePenaltyIntervalMinutesValue = Number(latePenaltyIntervalMinutes);
        latePenaltyIntervalCentsValue = euroStringToCents(latePenaltyIntervalEuro);
        if (
          Number.isNaN(latePenaltyIntervalMinutesValue) ||
          latePenaltyIntervalMinutesValue <= 0 ||
          Number.isNaN(latePenaltyIntervalCentsValue) ||
          latePenaltyIntervalCentsValue <= 0
        ) {
          setError('Bitte bei der Verspätungsstrafe Minuten und Betrag gültig angeben.');
          return;
        }
      }
    }

    const zehnerMaxPinsValue = Number(zehnerMaxPins);
    const zehnerStepCentsValue = euroStringToCents(zehnerStepEuro);
    if (
      !Number.isInteger(zehnerMaxPinsValue) ||
      zehnerMaxPinsValue < 10 ||
      Number.isNaN(zehnerStepCentsValue) ||
      zehnerStepCentsValue < 0
    ) {
      setError('Bitte beim 10er-Spiel eine gültige Maximalzahl (mind. 10) und Schrittweite angeben.');
      return;
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
        late_penalty_mode: latePenaltyEnabled ? latePenaltyMode : null,
        late_penalty_cents: latePenaltyCentsValue,
        late_penalty_interval_minutes: latePenaltyIntervalMinutesValue,
        late_penalty_interval_cents: latePenaltyIntervalCentsValue,
        zehner_max_pins: zehnerMaxPinsValue,
        zehner_step_cents: zehnerStepCentsValue,
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
            Einladungscode
          </ThemedText>
          <ThemedView type="backgroundElement" style={styles.inviteCodeBox}>
            <ThemedText type="smallBold">{inviteCode}</ThemedText>
          </ThemedView>
          <ThemedView style={styles.typeRow}>
            <Pressable
              style={[styles.typeButton, { backgroundColor: theme.backgroundElement }]}
              onPress={handleCopyCode}>
              <ThemedText type="small">{copied === 'code' ? 'Kopiert!' : 'Code kopieren'}</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.typeButton, { backgroundColor: theme.backgroundElement }]}
              onPress={handleCopyLink}>
              <ThemedText type="small">{copied === 'link' ? 'Kopiert!' : 'Link kopieren'}</ThemedText>
            </Pressable>
          </ThemedView>
          {regenerating ? (
            <ActivityIndicator />
          ) : (
            <Pressable
              onPress={() => (confirmingRegenerate ? handleRegenerateCode() : setConfirmingRegenerate(true))}>
              <ThemedText type="small" style={styles.deleteLink}>
                {confirmingRegenerate
                  ? 'Wirklich neuen Code generieren? Alte Codes/Links werden ungültig.'
                  : 'Neuen Code generieren'}
              </ThemedText>
            </Pressable>
          )}

          <ThemedText type="small" themeColor="textSecondary">
            Kegelgeld pro Teilnahme (€)
          </ThemedText>
          <TextInput
            value={kegelgeldEuro}
            onChangeText={setKegelgeldEuro}
            placeholder="2,00"
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

          <Pressable style={styles.checkboxRow} onPress={() => setLatePenaltyEnabled((prev) => !prev)}>
            <ThemedView
              style={[
                styles.checkbox,
                { backgroundColor: latePenaltyEnabled ? theme.backgroundSelected : theme.backgroundElement },
              ]}
            />
            <ThemedText type="small">Verspätungsstrafe aktivieren (beim Einchecken automatisch gebucht)</ThemedText>
          </Pressable>

          {latePenaltyEnabled && (
            <>
              <ThemedView style={styles.typeRow}>
                {LATE_PENALTY_MODES.map((option) => (
                  <Pressable
                    key={option.value}
                    style={[
                      styles.typeButton,
                      {
                        backgroundColor:
                          latePenaltyMode === option.value ? theme.backgroundSelected : theme.backgroundElement,
                      },
                    ]}
                    onPress={() => setLatePenaltyMode(option.value)}>
                    <ThemedText type="small">{option.label}</ThemedText>
                  </Pressable>
                ))}
              </ThemedView>

              {latePenaltyMode === 'pauschal' ? (
                <TextInput
                  value={latePenaltyEuro}
                  onChangeText={setLatePenaltyEuro}
                  placeholder="Betrag in € (z.B. 1,00)"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="decimal-pad"
                  style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                />
              ) : (
                <ThemedView style={styles.penaltyRow}>
                  <ThemedView style={styles.penaltyField}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Alle wie viele Minuten
                    </ThemedText>
                    <TextInput
                      value={latePenaltyIntervalMinutes}
                      onChangeText={setLatePenaltyIntervalMinutes}
                      placeholder="z.B. 5"
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="number-pad"
                      style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                  </ThemedView>
                  <ThemedView style={styles.penaltyField}>
                    <ThemedText type="small" themeColor="textSecondary">
                      Betrag je Intervall (€)
                    </ThemedText>
                    <TextInput
                      value={latePenaltyIntervalEuro}
                      onChangeText={setLatePenaltyIntervalEuro}
                      placeholder="z.B. 0,50"
                      placeholderTextColor={theme.textSecondary}
                      keyboardType="decimal-pad"
                      style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                    />
                  </ThemedView>
                </ThemedView>
              )}
            </>
          )}

          <ThemedText type="small" themeColor="textSecondary">
            10er-Spiel: Standardwerte (pro Ergebniserfassung überschreibbar)
          </ThemedText>
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
  inviteCodeBox: {
    height: 48,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    justifyContent: 'center',
  },
  deleteLink: {
    color: '#d33',
  },
  penaltyRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  penaltyField: {
    flex: 1,
    gap: Spacing.half,
  },
  checkboxRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.two,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: Spacing.half,
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
