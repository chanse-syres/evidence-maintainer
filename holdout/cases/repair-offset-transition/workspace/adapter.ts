export interface ClosureInput {
  id: string;
  start: string;
  end: string;
  startOffsetMinutes?: number;
  endOffsetMinutes?: number;
}

export interface Closure { id: string; startUtc: string; endUtc: string }

function toUtc(value: string, offsetMinutes?: number): string {
  if (value.endsWith("Z")) return new Date(value).toISOString();
  const wallClockAsUtc = Date.parse(`${value}Z`);
  return new Date(wallClockAsUtc - (offsetMinutes ?? 0) * 60_000).toISOString();
}

export function normalizeClosures(rows: ClosureInput[]): Closure[] {
  return rows.map((row) => ({
    id: row.id,
    startUtc: toUtc(row.start, row.startOffsetMinutes),
    endUtc: toUtc(row.end, row.startOffsetMinutes),
  }));
}
