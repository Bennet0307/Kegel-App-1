import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { supabase } from '@/lib/supabase';

// Legt fest, wie eine ankommende Push angezeigt wird, während die App
// gerade im Vordergrund offen ist (ohne diesen Handler zeigt
// expo-notifications sie im Vordergrund u.U. gar nicht sichtbar an –
// im Hintergrund/bei geschlossener App übernimmt ohnehin das
// Betriebssystem, unabhängig von diesem Handler). Einmalig beim
// Laden dieses Moduls gesetzt, nicht bei jedem Aufruf von
// registerForPushNotificationsAsync().
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

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
// keine zeitgesteuerte Erinnerung vor dem Termin selbst). Der
// eigentliche Versand läuft über die Supabase Edge Function
// `send-push` (supabase/functions/send-push) statt direkt vom Client
// gegen Expo's Push-Endpunkt: ein direkter Browser-Aufruf scheiterte
// dort an CORS (kein Access-Control-Allow-Origin-Header, live
// getestet), die Edge Function läuft server-seitig und hat dieses
// Problem nicht – funktioniert dadurch jetzt sowohl nativ als auch
// aus der Web-Oberfläche. Die Tokens werden weiterhin hier im Client
// aufgelöst (club-weit per RLS lesbar), die Edge Function reicht sie
// nur unverändert an Expo weiter.
export async function sendNewEventPush(clubId: string, excludeMemberId: string | null, title: string, body: string) {
  try {
    let query = supabase.from('member').select('id, push_token').eq('club_id', clubId).not('push_token', 'is', null);
    if (excludeMemberId) {
      query = query.neq('id', excludeMemberId);
    }
    const { data: memberRows } = await query;

    const tokens = (memberRows ?? []).map((row) => row.push_token).filter((token): token is string => Boolean(token));
    if (tokens.length === 0) return;

    await supabase.functions.invoke('send-push', { body: { tokens, title, body } });
  } catch {
    // Push-Versand ist best-effort; ein Fehler hier darf das Anlegen
    // des Termins nicht blockieren.
  }
}
