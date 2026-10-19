const toMinutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
export const hoursBetween = (start: string, end: string): number => Math.round(((toMinutes(end) - toMinutes(start)) / 60) * 4) / 4 || 0;
export const isQuarterStep = (n: number): boolean => Number.isFinite(n) && Math.abs(n * 4 - Math.round(n * 4)) < 1e-9;
export const weighted = (hours: number, multiplier: number): number => Math.round(hours * multiplier * 100) / 100;
