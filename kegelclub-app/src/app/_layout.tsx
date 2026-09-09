import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ title: 'Anmelden' }} />
        <Stack.Screen name="create-club" options={{ title: 'Club anlegen' }} />
        <Stack.Screen name="join-club" options={{ title: 'Club beitreten' }} />
        <Stack.Screen name="events" options={{ title: 'Kegelabende' }} />
        <Stack.Screen name="create-event" options={{ title: 'Kegelabend anlegen' }} />
        <Stack.Screen name="enter-score" options={{ title: 'Ergebnisse erfassen' }} />
        <Stack.Screen name="kasse" options={{ title: 'Kegelkasse' }} />
      </Stack>
    </ThemeProvider>
  );
}
