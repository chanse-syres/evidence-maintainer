export interface DeltaEvent {
  epoch: number;
  sequence: number;
  kind: "BEGIN" | "UPSERT" | "DELETE" | "COMMIT";
  key?: string;
  value?: number;
}

export function materializeEpoch(events: DeltaEvent[]): Array<{ key: string; value: number }> {
  const byEpoch = new Map<number, DeltaEvent[]>();
  for (const event of events) {
    const epochEvents = byEpoch.get(event.epoch) ?? [];
    epochEvents.push(event);
    byEpoch.set(event.epoch, epochEvents);
  }

  const completeEpochs = [...byEpoch.entries()].filter(([, epochEvents]) => {
    const ordered = [...epochEvents].sort((left, right) => left.sequence - right.sequence);
    return ordered.length > 0
      && ordered[0].sequence === 0
      && ordered[0].kind === "BEGIN"
      && ordered.at(-1)?.kind === "COMMIT"
      && ordered.every((event, index) => event.sequence === index)
      && ordered.slice(1, -1).every((event) =>
        event.kind === "UPSERT" || event.kind === "DELETE",
      );
  });

  if (completeEpochs.length === 0) {
    throw new Error("No complete valid epoch");
  }

  const [, selectedEvents] = completeEpochs.reduce((greatest, candidate) =>
    candidate[0] > greatest[0] ? candidate : greatest,
  );
  const state = new Map<string, number>();
  for (const event of [...selectedEvents].sort((left, right) => left.sequence - right.sequence)) {
    if (event.kind === "UPSERT" && event.key !== undefined && event.value !== undefined) {
      state.set(event.key, event.value);
    } else if (event.kind === "DELETE" && event.key !== undefined) {
      state.delete(event.key);
    }
  }

  return [...state]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({ key, value }));
}
