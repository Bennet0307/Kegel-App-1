import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'EXPO_PUBLIC_SUPABASE_URL und EXPO_PUBLIC_SUPABASE_ANON_KEY müssen gesetzt sein (siehe .env / env.example).',
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Auf Web übernimmt supabase-js selbst einen SSR-sicheren
    // localStorage-Adapter; AsyncStorage greift dort beim
    // Static-Rendering (window ist während SSR noch nicht definiert)
    // sofort auf `window` zu und crasht den Server.
    storage: Platform.OS === 'web' ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
