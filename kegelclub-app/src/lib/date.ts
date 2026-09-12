function pad(n: number) {
  return String(n).padStart(2, '0');
}

export function dateToGermanString(date: Date) {
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}`;
}

// Wandelt "TT.MM.JJJJ" in "JJJJ-MM-TT" um, oder null bei ungültigem Format.
export function germanDateToIso(value: string): string | null {
  const match = value.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return null;

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}
