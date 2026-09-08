import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { supabase } from '@/lib/supabase';

export default function CreateClubScreen() {
  const theme = useTheme();
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [club, setClub] = useState<{ id: string; invite_code: string } | null>(null);

  async function handleCreateClub() {
    if (!name) {
      setError('Bitte einen Vereinsnamen eingeben.');
      return;
    }

    setLoading(true);
    setError(null);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      setLoading(false);
      setError('Nicht eingeloggt.');
      return;
    }

    const { data: newClub, error: clubError } = await supabase
      .from('club')
      .insert({ name })
      .select('id, invite_code')
      .single();

    if (clubError || !newClub) {
      setLoading(false);
      setError(clubError?.message ?? 'Club konnte nicht angelegt werden.');
      return;
    }

    const { error: memberError } = await supabase.from('member').insert({
      club_id: newClub.id,
      user_id: userData.user.id,
      display_name: userData.user.email ?? 'Admin',
      role: 'admin',
    });

    setLoading(false);

    if (memberError) {
      setError(memberError.message);
      return;
    }

    setClub(newClub);
  }

  if (club) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Club angelegt
          </ThemedText>
          <ThemedText>Club-ID: {club.id}</ThemedText>
          <ThemedText type="smallBold">Einladungscode: {club.invite_code}</ThemedText>

          <Pressable
            style={[styles.button, { backgroundColor: theme.backgroundElement }]}
            onPress={() => router.replace('/events')}>
            <ThemedText type="smallBold">Weiter zu den Kegelabenden</ThemedText>
          </Pressable>
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          Club anlegen
        </ThemedText>

        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Vereinsname"
          placeholderTextColor={theme.textSecondary}
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {loading ? (
          <ActivityIndicator />
        ) : (
          <Pressable
            style={[styles.button, { backgroundColor: theme.backgroundElement }]}
            onPress={handleCreateClub}>
            <ThemedText type="smallBold">Club anlegen</ThemedText>
          </Pressable>
        )}

        <Pressable onPress={() => router.replace('/join-club')}>
          <ThemedText type="link" themeColor="textSecondary">
            Ich habe einen Einladungscode
          </ThemedText>
        </Pressable>
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
