import { Redirect } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedView } from '@/components/themed-view';
import { getCurrentMember } from '@/lib/member';
import { supabase } from '@/lib/supabase';

type Destination = '/login' | '/create-club' | '/events';

// Ersetzt den ursprünglichen "Welcome to Expo"-Template-Screen: prüft
// beim App-Start Session + Club-Mitgliedschaft und leitet direkt zum
// richtigen Screen weiter, statt dass Nutzer auf diesem unbenutzten
// Tabs-Template landen (siehe CLAUDE.md).
export default function IndexScreen() {
  const [destination, setDestination] = useState<Destination | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        setDestination('/login');
        return;
      }

      const member = await getCurrentMember();
      setDestination(member ? '/events' : '/create-club');
    })();
  }, []);

  if (!destination) {
    return (
      <ThemedView style={styles.container}>
        <SafeAreaView style={styles.safeArea}>
          <ActivityIndicator />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return <Redirect href={destination} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
