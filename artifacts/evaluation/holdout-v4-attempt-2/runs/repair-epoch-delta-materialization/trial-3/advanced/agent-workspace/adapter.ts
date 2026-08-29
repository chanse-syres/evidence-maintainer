export interface DeltaEvent {
  epoch: number;
  sequence: number;
  kind: "BEGIN" | "UPSERT" | "DELETE" | "COMMIT";
  key?: string;
  value?: number;
}

export function materializeEpoch(events: DeltaEvent[]): Array<{ key: string; value: number }> {
  const state = new Map<string, number>();
  for (const event of events) {
    if (event.kind === "UPSERT" && event.key !== undefined && event.value !== undefined) {
      state.set(event.key, event.value);
    } else if (event.kind === "DELETE" && event.key !== undefined) {
      state.delete(event.key);
    }
  }
  return [...state].sort(([left], [right]) => left.localeCompare(right)).map(([key, value]) => ({ key, value }));
}
