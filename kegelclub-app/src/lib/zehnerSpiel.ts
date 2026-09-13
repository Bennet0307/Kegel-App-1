export type ZehnerMilestoneEntry = {
  milestone: number;
  throwerMemberId: string;
  hitExact: boolean;
};

// Spiegelt exakt die Strafenverteilung aus book_zehner_game()
// (Migration zehner_spiel): genau getroffen -> alle Teilnehmer außer
// dem Werfer zahlen, drübergeworfen -> nur der Werfer zahlt.
// "Teilnehmer" = jeder, der laut den Meilenstein-Einträgen mindestens
// einmal geworfen hat. Wird sowohl für die Anzeige (events.tsx,
// termin-statistik.tsx, ohne dafür `transaction` lesen zu müssen, das
// für reguläre Mitglieder per RLS auf eigene Buchungen beschränkt
// ist) als auch für die Live-Vorschau beim Erfassen (enter-score.tsx)
// verwendet.
export function computeZehnerPenalties(milestones: ZehnerMilestoneEntry[], stepCents: number) {
  const participants = Array.from(new Set(milestones.map((entry) => entry.throwerMemberId)));
  const totals: Record<string, number> = {};

  for (const entry of milestones) {
    const penaltyCents = (entry.milestone / 10) * stepCents;
    if (penaltyCents <= 0) continue;

    if (entry.hitExact) {
      for (const memberId of participants) {
        if (memberId !== entry.throwerMemberId) {
          totals[memberId] = (totals[memberId] ?? 0) + penaltyCents;
        }
      }
    } else {
      totals[entry.throwerMemberId] = (totals[entry.throwerMemberId] ?? 0) + penaltyCents;
    }
  }

  return Object.entries(totals)
    .filter(([, cents]) => cents > 0)
    .map(([memberId, cents]) => ({ memberId, cents }));
}
