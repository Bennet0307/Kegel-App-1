export type TieMode = 'alle_zahlen' | 'keiner_zahlt' | 'geteilt';

export type PenaltyCountRow = {
  event_id: string;
  member_id: string;
  penalty_rule_id: string | null;
  count: number;
};

export type KingRule = {
  id: string;
  name: string;
  king_surcharge_cents: number;
};

export type KingCrown = {
  eventId: string;
  memberId: string;
  ruleName: string;
  amountCents: number;
};

/**
 * Rekonstruiert die Pumpenkönig-Zuschlag-Krönungen aus `penalty` (club-weit
 * lesbar) statt aus `transaction` (RLS-beschränkt auf eigene Buchungen für
 * reguläre Mitglieder) – ergibt dieselbe Zählung wie die tatsächlich in
 * record_event_penalties gebuchten Zuschlag-Transaktionen.
 */
export function computeKingCrowns(
  penaltyRows: PenaltyCountRow[],
  kingRules: KingRule[],
  tieMode: TieMode,
): KingCrown[] {
  const byEventRule: Record<string, { memberId: string; count: number }[]> = {};
  for (const row of penaltyRows) {
    if (!row.penalty_rule_id) continue;
    if (!kingRules.some((rule) => rule.id === row.penalty_rule_id)) continue;
    const key = `${row.event_id}::${row.penalty_rule_id}`;
    byEventRule[key] ??= [];
    byEventRule[key].push({ memberId: row.member_id, count: row.count });
  }

  const crowns: KingCrown[] = [];
  for (const [key, rows] of Object.entries(byEventRule)) {
    const [eventId, ruleId] = key.split('::');
    const rule = kingRules.find((r) => r.id === ruleId);
    if (!rule) continue;

    const maxCount = Math.max(...rows.map((row) => row.count));
    if (maxCount <= 0) continue;

    const winners = rows.filter((row) => row.count === maxCount);
    if (winners.length > 1 && tieMode === 'keiner_zahlt') continue;

    const shareCents =
      winners.length > 1 && tieMode === 'geteilt'
        ? Math.round(rule.king_surcharge_cents / winners.length)
        : rule.king_surcharge_cents;
    if (shareCents <= 0) continue;

    for (const winner of winners) {
      crowns.push({ eventId, memberId: winner.memberId, ruleName: rule.name, amountCents: shareCents });
    }
  }

  return crowns;
}
