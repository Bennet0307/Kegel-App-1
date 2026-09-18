import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Push läuft über Expo's Push-Service und braucht einen echten
// Gerätetoken (iOS/Android) – auf Web nicht in derselben Form
// verfügbar, deshalb hier bewusst übersprungen (siehe lib/supabase.ts
// für dasselbe Platform.OS === 'web'-Muster).
export async function registerForPushNotificationsAsync() {
  if (Platform.OS === 'web') return;

  try {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'default',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }

    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') return;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const { data: token } = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );

    await supabase.rpc('register_push_token', { p_token: token });
  } catch {
    // Push-Registrierung ist best-effort (z.B. kein EAS-Projekt
    // konfiguriert, Simulator ohne Push-Fähigkeit, Berechtigung
    // verweigert) – darf den Rest der App nie blockieren.
  }
}

// Benachrichtigt alle Mitglieder eines Clubs über einen neu
// angelegten Kegelabend/Regeltermin (Nutzerwunsch: nur bei Anlage,
// keine zeitgesteuerte Erinnerung vor dem Termin selbst). Läuft
// direkt vom Client aus – Expo's Push-Send-Endpunkt braucht dafür
// keinen Server/Edge Function, nimmt Gerätetokens direkt entgegen.
// **Nur auf nativen Plattformen**: aus einer Web-Session heraus
// blockiert der Browser den direkten Aufruf per CORS (Expo's
// Push-Endpunkt setzt keinen Access-Control-Allow-Origin-Header,
// live getestet) – ein Termin, der über die Web-Oberfläche angelegt
// wird, löst deshalb aktuell keine Push aus, nur einer aus der
// nativen App. Für Web bräuchte es einen Server/Edge Function als
// Proxy, siehe "Offene Punkte".
export async function sendNewEventPush(clubId: string, excludeMemberId: string | null, title: string, body: string) {
  if (Platform.OS === 'web') return;

  try {
    let query = supabase.from('member').select('id, push_token').eq('club_id', clubId).not('push_token', 'is', null);
    if (excludeMemberId) {
      query = query.neq('id', excludeMemberId);
    }
    const { data: memberRows } = await query;

    const tokens = (memberRows ?? []).map((row) => row.push_token).filter((token): token is string => Boolean(token));
    if (tokens.length === 0) return;

    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(tokens.map((to) => ({ to, title, body, sound: 'default' }))),
    });
  } catch {
    // Push-Versand ist best-effort; ein Fehler hier darf das Anlegen
    // des Termins nicht blockieren.
  }
}
