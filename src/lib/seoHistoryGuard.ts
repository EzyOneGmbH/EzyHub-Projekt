// Monats-Guard fuer die Sichtbarkeits-Historie (seo_history): ein Lauf ab dem
// 3. des laufenden Monats gilt als frisch — dann haben GA4/GSC den Vormonat
// fertig verarbeitet. Vor dem 3. zaehlt noch der Stichtag des Vormonats.
export function seoHistoryGuardAb(now: Date): Date {
  const ab = new Date(now.getFullYear(), now.getMonth(), 3);
  return now < ab ? new Date(now.getFullYear(), now.getMonth() - 1, 3) : ab;
}
