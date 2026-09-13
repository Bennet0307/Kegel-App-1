import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { getCurrentMember, type CurrentMember } from '@/lib/member';
import { supabase } from '@/lib/supabase';

type Announcement = {
  id: string;
  author_member_id: string | null;
  title: string;
  body: string;
  created_at: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export default function AnnouncementsScreen() {
  const theme = useTheme();
  const [member, setMember] = useState<CurrentMember | null>(null);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [memberNames, setMemberNames] = useState<Record<string, string>>({});
  const [newTitle, setNewTitle] = useState('');
  const [newBody, setNewBody] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isStaff = member?.role === 'admin' || member?.role === 'kassierer';

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const currentMember = await getCurrentMember();
    if (!currentMember) {
      setLoading(false);
      setError('Kein Club gefunden.');
      return;
    }
    setMember(currentMember);

    const [{ data: announcementRows, error: announcementsError }, { data: memberRows }] = await Promise.all([
      supabase
        .from('announcement')
        .select('id, author_member_id, title, body, created_at')
        .eq('club_id', currentMember.club_id)
        .order('created_at', { ascending: false }),
      supabase.from('member').select('id, display_name').eq('club_id', currentMember.club_id),
    ]);

    if (announcementsError) {
      setError(announcementsError.message);
      setLoading(false);
      return;
    }

    const nameMap: Record<string, string> = {};
    for (const row of memberRows ?? []) {
      nameMap[row.id] = row.display_name;
    }

    setAnnouncements(announcementRows ?? []);
    setMemberNames(nameMap);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleAdd() {
    if (!member) return;
    if (!newTitle.trim() || !newBody.trim()) {
      setError('Bitte Titel und Text angeben.');
      return;
    }

    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from('announcement').insert({
      club_id: member.club_id,
      author_member_id: member.id,
      title: newTitle.trim(),
      body: newBody.trim(),
    });

    setSaving(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    setNewTitle('');
    setNewBody('');
    load();
  }

  function startEdit(announcement: Announcement) {
    setEditingId(announcement.id);
    setEditTitle(announcement.title);
    setEditBody(announcement.body);
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    if (!editTitle.trim() || !editBody.trim()) {
      setError('Bitte Titel und Text angeben.');
      return;
    }

    setSaving(true);
    setError(null);

    const { error: updateError } = await supabase
      .from('announcement')
      .update({ title: editTitle.trim(), body: editBody.trim() })
      .eq('id', editingId);

    setSaving(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setEditingId(null);
    load();
  }

  async function handleDelete(id: string) {
    const { error: deleteError } = await supabase.from('announcement').delete().eq('id', id);
    if (deleteError) {
      setError(deleteError.message);
      return;
    }
    setConfirmingDeleteId(null);
    load();
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

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <SafeAreaView style={styles.safeArea}>
          <ThemedText type="title" style={styles.title}>
            Ankündigungen
          </ThemedText>

          {error && <ThemedText style={styles.error}>{error}</ThemedText>}

          {isStaff && (
            <ThemedView style={styles.formBlock}>
              <TextInput
                value={newTitle}
                onChangeText={setNewTitle}
                placeholder="Titel"
                placeholderTextColor={theme.textSecondary}
                style={[styles.input, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              <TextInput
                value={newBody}
                onChangeText={setNewBody}
                placeholder="Text der Ankündigung"
                placeholderTextColor={theme.textSecondary}
                multiline
                style={[styles.input, styles.bodyInput, { color: theme.text, backgroundColor: theme.backgroundElement }]}
              />
              {saving ? (
                <ActivityIndicator />
              ) : (
                <Pressable style={[styles.button, { backgroundColor: theme.backgroundElement }]} onPress={handleAdd}>
                  <ThemedText type="smallBold">Ankündigung posten</ThemedText>
                </Pressable>
              )}
            </ThemedView>
          )}

          {announcements.length === 0 && (
            <ThemedText themeColor="textSecondary">Noch keine Ankündigungen.</ThemedText>
          )}

          {announcements.map((announcement) => (
            <ThemedView key={announcement.id} type="backgroundElement" style={styles.card}>
              {editingId === announcement.id ? (
                <>
                  <TextInput
                    value={editTitle}
                    onChangeText={setEditTitle}
                    placeholder="Titel"
                    placeholderTextColor={theme.textSecondary}
                    style={[styles.input, { color: theme.text, backgroundColor: theme.background }]}
                  />
                  <TextInput
                    value={editBody}
                    onChangeText={setEditBody}
                    placeholder="Text der Ankündigung"
                    placeholderTextColor={theme.textSecondary}
                    multiline
                    style={[styles.input, styles.bodyInput, { color: theme.text, backgroundColor: theme.background }]}
                  />
                  <ThemedView style={styles.actionsRow}>
                    {saving ? (
                      <ActivityIndicator />
                    ) : (
                      <>
                        <Pressable onPress={handleSaveEdit}>
                          <ThemedText type="small">Speichern</ThemedText>
                        </Pressable>
                        <Pressable onPress={() => setEditingId(null)}>
                          <ThemedText type="small" themeColor="textSecondary">
                            Abbrechen
                          </ThemedText>
                        </Pressable>
                      </>
                    )}
                  </ThemedView>
                </>
              ) : (
                <>
                  <ThemedView style={styles.row}>
                    <ThemedText type="smallBold">{announcement.title}</ThemedText>
                    <ThemedText type="small" themeColor="textSecondary">
                      {formatDate(announcement.created_at)}
                    </ThemedText>
                  </ThemedView>
                  <ThemedText type="small">{announcement.body}</ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {memberNames[announcement.author_member_id ?? ''] ?? 'Unbekannt'}
                  </ThemedText>

                  {isStaff && (
                    <ThemedView style={styles.actionsRow}>
                      <Pressable onPress={() => startEdit(announcement)}>
                        <ThemedText type="small">Bearbeiten</ThemedText>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          confirmingDeleteId === announcement.id
                            ? handleDelete(announcement.id)
                            : setConfirmingDeleteId(announcement.id)
                        }>
                        <ThemedText type="small" style={styles.deleteLink}>
                          {confirmingDeleteId === announcement.id ? 'Wirklich löschen?' : 'Löschen'}
                        </ThemedText>
                      </Pressable>
                    </ThemedView>
                  )}
                </>
              )}
            </ThemedView>
          ))}
        </SafeAreaView>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    flexDirection: 'row',
    justifyContent: 'center',
  },
  safeArea: {
    flex: 1,
    paddingHorizontal: Spacing.four,
    paddingVertical: Spacing.four,
    gap: Spacing.three,
    alignSelf: 'stretch',
    maxWidth: 500,
  },
  title: {
    textAlign: 'center',
    marginBottom: Spacing.two,
  },
  formBlock: {
    gap: Spacing.two,
  },
  input: {
    height: 48,
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    fontSize: 16,
  },
  bodyInput: {
    height: 90,
    paddingTop: Spacing.two,
    textAlignVertical: 'top',
  },
  button: {
    height: 48,
    borderRadius: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    gap: Spacing.one,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: Spacing.two,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: Spacing.three,
    marginTop: Spacing.one,
  },
  deleteLink: {
    color: '#d33',
  },
  error: {
    color: '#d33',
  },
});
