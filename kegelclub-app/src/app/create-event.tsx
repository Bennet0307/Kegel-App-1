import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentMember } from '@/lib/member';
import { supabase } from '@/lib/supabase';

type Frequency = 'woechentlich' | 'monatlich';

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 'woechentlich', label: 'Wöchentlich' },
  { value: 'monatlich', label: 'Monatlich' },
];

function isoWeekday(date: Date) {
  const day = date.getDay();
  return day === 0 ? 7 : day;
}

const WEEKDAY_NAMES = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];
const OCCURRENCE_NAMES = ['', 'ersten', 'zweiten', 'dritten', 'vierten', 'fünften'];

export default function CreateEventScreen() {
  const theme = useTheme();
  const { eventId } = useLocalSearchParams<{ eventId?: string }>();
  const isEditing = Boolean(eventId);

  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [location, setLocation] = useState('');
  const [isSeries, setIsSeries] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('woechentlich');
  const [intervalWeeks, setIntervalWeeks] = useState('1');
  const [lastWeekdayOfMonth, setLastWeekdayOfMonth] = useState(false);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [loading, setLoading] = useState(isEditing);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!eventId) return;

    (async () => {
      const { data, error: loadError } = await supabase
        .from('event')
        .select('title, starts_at, location, series_id')
        .eq('id', eventId)
        .single();

      if (loadError || !data) {
        setError(loadError?.message ?? 'Termin nicht gefunden.');
        setLoading(false);
        return;
      }

      const startsAt = new Date(data.starts_at);
      const pad = (n: number) => String(n).padStart(2, '0');
      setTitle(data.title);
      setDate(`${startsAt.getFullYear()}-${pad(startsAt.getMonth() + 1)}-${pad(startsAt.getDate())}`);
      setTime(`${pad(startsAt.getHours())}:${pad(startsAt.getMinutes())}`);
      setLocation(data.location ?? '');
      setSeriesId(data.series_id);
      setLoading(false);
    })();
  }, [eventId]);

  async function handleSave() {
    if (!title || !date || !time) {
      setError('Bitte Titel, Datum und Uhrzeit angeben.');
      return;
    }

    const startsAt = new Date(`${date}T${time}`);
    if (Number.isNaN(startsAt.getTime())) {
      setError('Datum/Uhrzeit ungültig. Format: JJJJ-MM-TT und HH:MM.');
      return;
    }

    setSaving(true);
    setError(null);

    if (isEditing) {
      const { error: updateError } = await supabase
        .from('event')
        .update({
          title,
          starts_at: startsAt.toISOString(),
          location: location || null,
          ...(seriesId ? { series_overridden: true } : {}),
        })
        .eq('id', eventId);

      setSaving(false);

      if (updateError) {
        setError(updateError.message);
        return;
      }

      router.replace('/events');
      return;
    }

    const member = await getCurrentMember();
    if (!member) {
      setSaving(false);
      setError('Kein Club gefunden.');
      return;
    }

    if (!isSeries) {
      const { error: insertError } = await supabase.from('event').insert({
        club_id: member.club_id,
        title,
        starts_at: startsAt.toISOString(),
        location: location || null,
      });

      setSaving(false);

      if (insertError) {
        setError(insertError.message);
        return;
      }

      router.replace('/events');
      return;
    }

    const weeks = Number(intervalWeeks);
    if (frequency === 'woechentlich' && (Number.isNaN(weeks) || weeks < 1)) {
      setSaving(false);
      setError('Bitte eine gültige Wochenanzahl angeben.');
      return;
    }

    const weekday = isoWeekday(startsAt);
    const monthlyOccurrence = lastWeekdayOfMonth ? -1 : Math.min(5, Math.ceil(startsAt.getDate() / 7));

    const { error: rpcError } = await supabase.rpc('create_event_series', {
      p_title: title,
      p_location: location || null,
      p_frequency: frequency,
      p_interval_weeks: frequency === 'woechentlich' ? weeks : 1,
      p_weekday: weekday,
      p_monthly_occurrence: frequency === 'monatlich' ? monthlyOccurrence : null,
      p_time_of_day: time,
      p_starts_on: date,
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

  const startsAtPreview = date ? new Date(`${date}T00:00`) : null;
  const previewValid = startsAtPreview && !Number.isNaN(startsAtPreview.getTime());

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          {isEditing ? 'Kegelabend bearbeiten' : 'Kegelabend anlegen'}
        </ThemedText>

        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder="Titel"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <TextInput
          value={date}
          onChangeText={setDate}
          placeholder={isSeries ? 'Startdatum (JJJJ-MM-TT)' : 'Datum (JJJJ-MM-TT)'}
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <TextInput
          value={time}
          onChangeText={setTime}
          placeholder="Uhrzeit (HH:MM)"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <TextInput
          value={location}
          onChangeText={setLocation}
          placeholder="Ort (optional)"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        {!isEditing && (
          <>
            <Pressable style={styles.checkboxRow} onPress={() => setIsSeries((prev) => !prev)}>
              <ThemedView
                style={[
                  styles.checkbox,
                  { backgroundColor: isSeries ? theme.backgroundSelected : theme.backgroundElement },
                ]}
              />
              <ThemedText type="small">Regeltermin (wiederholt sich)</ThemedText>
            </Pressable>

            {isSeries && (
              <>
                <ThemedView style={styles.typeRow}>
                  {FREQUENCIES.map((option) => (
                    <Pressable
                      key={option.value}
                      style={[
                        styles.typeButton,
                        { backgroundColor: frequency === option.value ? theme.backgroundSelected : theme.backgroundElement },
                      ]}
                      onPress={() => setFrequency(option.value)}>
                      <ThemedText type="small">{option.label}</ThemedText>
                    </Pressable>
                  ))}
                </ThemedView>

                {frequency === 'woechentlich' ? (
                  <TextInput
                    value={intervalWeeks}
                    onChangeText={setIntervalWeeks}
                    placeholder="Alle wie viele Wochen? (z.B. 1)"
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="number-pad"
                    style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
                  />
                ) : (
                  <>
                    <Pressable style={styles.checkboxRow} onPress={() => setLastWeekdayOfMonth((prev) => !prev)}>
                      <ThemedView
                        style={[
                          styles.checkbox,
                          { backgroundColor: lastWeekdayOfMonth ? theme.backgroundSelected : theme.backgroundElement },
                        ]}
                      />
                      <ThemedText type="small">Letzter Wochentag im Monat (statt n-tes Vorkommen)</ThemedText>
                    </Pressable>

                    {previewValid && (
                      <ThemedText type="small" themeColor="textSecondary">
                        Wiederholt sich jeden{' '}
                        {lastWeekdayOfMonth
                          ? 'letzten'
                          : OCCURRENCE_NAMES[Math.min(5, Math.ceil(startsAtPreview!.getDate() / 7))]}{' '}
                        {WEEKDAY_NAMES[isoWeekday(startsAtPreview!)]} im Monat.
                      </ThemedText>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {saving ? (
          <ActivityIndicator />
        ) : (
          <Pressable style={[styles.button, { backgroundColor: theme.backgroundElement }]} onPress={handleSave}>
            <ThemedText type="smallBold">{isEditing ? 'Änderungen speichern' : 'Kegelabend anlegen'}</ThemedText>
          </Pressable>
        )}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    flexDirection: 'row',
  },
  safeArea: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.four,
    gap: Spacing.three,
    alignSelf: 'stretch',
    maxWidth: 400,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.three,
  },
  input: {
    height: 48,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
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
