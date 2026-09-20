import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentMember } from '@/lib/member';
import { supabase } from '@/lib/supabase';

export default function LoginScreen() {
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAuth(mode: 'signUp' | 'signIn') {
    if (!email || !password) {
      setError('Bitte E-Mail und Passwort eingeben.');
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: authError } =
      mode === 'signUp'
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password });

    setLoading(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    // Wenn die Supabase-Instanz E-Mail-Bestätigung verlangt (Cloud-Default,
    // lokal per enable_confirmations=false deaktiviert), liefert signUp()
    // noch keine Session – ohne diese Prüfung würde die App trotzdem
    // weiterleiten und auf der nächsten Seite ein verwirrendes "Nicht
    // eingeloggt" zeigen.
    if (mode === 'signUp' && !data.session) {
      setError('Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link, den wir dir geschickt haben, und melde dich danach hier an.');
      return;
    }

    const member = await getCurrentMember();
    router.replace(member ? '/events' : '/create-club');
  }

  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="title" style={styles.title}>
          Anmelden
        </ThemedText>

        <TextInput
          value={email}
          onChangeText={setEmail}
          placeholder="E-Mail"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder="Passwort"
          placeholderTextColor={theme.textSecondary}
          autoCapitalize="none"
          secureTextEntry
          style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
        />

        {error && <ThemedText style={styles.error}>{error}</ThemedText>}

        {loading ? (
          <ActivityIndicator />
        ) : (
          <ThemedView style={styles.buttonRow}>
            <Pressable
              style={[styles.button, { backgroundColor: theme.backgroundElement }]}
              onPress={() => handleAuth('signIn')}>
              <ThemedText type="smallBold">Anmelden</ThemedText>
            </Pressable>
            <Pressable
              style={[styles.button, { backgroundColor: theme.backgroundElement }]}
              onPress={() => handleAuth('signUp')}>
              <ThemedText type="smallBold">Registrieren</ThemedText>
            </Pressable>
          </ThemedView>
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
  error: {
    color: '#d33',
  },
  buttonRow: {
    flexDirection: 'row',
    gap: Spacing.two,
  },
  button: {
    flex: 1,
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
