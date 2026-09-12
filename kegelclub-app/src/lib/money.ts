export function formatEuro(cents: number) {
  return (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export function centsToEuroString(cents: number) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function euroStringToCents(value: string) {
  return Math.round(Number(value.replace(',', '.')) * 100);
}
