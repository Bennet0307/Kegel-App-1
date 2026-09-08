import { supabase } from '@/lib/supabase';

export type CurrentMember = {
  id: string;
  club_id: string;
  role: string;
  display_name: string;
};

export async function getCurrentMember(): Promise<CurrentMember | null> {
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const { data } = await supabase
    .from('member')
    .select('id, club_id, role, display_name')
    .eq('user_id', userData.user.id)
    .limit(1)
    .maybeSingle();

  return data ?? null;
}
