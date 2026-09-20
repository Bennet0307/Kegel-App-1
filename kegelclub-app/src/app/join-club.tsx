import AsyncStorage from '@react-native-async-storage/async-storage';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { PENDING_INVITE_CODE_KEY } from '@/lib/config';
import { supabase } from '@/lib/supabase';

export default function JoinClubScreen() {
  const theme = useTheme();
  // Ein per club-settings.tsx geteilter Link (?code=...) füllt das Feld
  // direkt vor, statt dass der Code manuell abgetippt werden muss.
  const { code } = useLocalSearchParams<{ code?: string }>();
  const [inviteCode, setInviteCode] = useState(code ?? '');
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [club, setClub] = useState<{ club_id: string; club_name: string } | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        // Ein geteilter Link wird meist von jemandem ohne aktive Session
        // geöffnet (join_club_by_invite_code ist ohnehin nur für
        // eingeloggte User freigegeben) – der Code muss den Umweg über
        // Login/Registrierung überstehen, statt verloren zu gehen.
        if (code) {
          await AsyncStorage.setItem(PENDING_INVITE_CODE_KEY, code);
        }
        setNeedsLogin(true);
      }
      setCheckingAuth(false);
    })();
  }, [code]);

  async function handleJoin() {
    if (!inviteCode) {
      setError('Bitte einen Einladungscode eingeben.');
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc('join_club_by_invite_code', {
      p_invite_code: inviteCode,
    });

    setLoading(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    const joined = data?.[0];
    if (joined) {
      setClub({ club_id: joined.club_id, club_name: joined.club_name });
    }
  }

  if (checkingAuth) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ActivityIndicator />
        </SafeAreaView>
      </ThemedView>
    );
  }

  if (needsLogin) {
    return <Redirect href="/login" />;
  }

  if (club) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Beigetreten
          </ThemedText>
          <ThemedText>
            Du bist jetzt Mitglied von <ThemedText type="smallBold">{club.club_name}</ThemedText>.
          </ThemedText>

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
          Club beitreten
        </ThemedText>

        <TextInput
          value={inviteCode}
          onChangeText={setInviteCode}
          placeholder="Einladungscode"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {loading ? (
          <ActivityIndicator />
        ) : (
          <Pressable
            style={[styles.button, { backgroundColor: theme.backgroundElement }]}
            onPress={handleJoin}>
            <ThemedText type="smallBold">Beitreten</ThemedText>
          </Pressable>
        )}

        <Pressable onPress={() => router.replace('/create-club')}>
          <ThemedText type="link" themeColor="textSecondary">
            Stattdessen einen neuen Club anlegen
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
