const MINUTES_PER_DAY = 24 * 60;
export const toMinutes = (t: string): number => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
/** Minutes from start to end; an end at or before the start is on the next day (22:00 to 02:00 is 240). Equal times give 0. */
export const spanMinutes = (start: string, end: string): number => {
  const diff = toMinutes(end) - toMinutes(start);
  return diff <= 0 ? diff + MINUTES_PER_DAY : diff;
};
export const hoursBetween = (start: string, end: string): number => {
  if (toMinutes(start) === toMinutes(end)) return 0;
  return Math.round((spanMinutes(start, end) / 60) * 4) / 4;
};
export const isQuarterStep = (n: number): boolean => Number.isFinite(n) && Math.abs(n * 4 - Math.round(n * 4)) < 1e-9;
export const weighted = (hours: number, multiplier: number): number => Math.round(hours * multiplier * 100) / 100;

/** Absolute minute interval of an entry relative to an arbitrary epoch day, so entries on adjacent dates can be compared. */
export const entryInterval = (date: string, start: string, end: string): { from: number; to: number } => {
  const day = Math.round(Date.parse(`${date}T00:00:00Z`) / 60_000);
  const from = day + toMinutes(start);
  return { from, to: from + spanMinutes(start, end) };
};
export const intervalsOverlap = (a: { from: number; to: number }, b: { from: number; to: number }): boolean => a.from < b.to && b.from < a.to;
