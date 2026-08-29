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

  const completeEpochs = [...byEpoch.entries()]
    .map(([epoch, epochEvents]) => ({
      epoch,
      events: [...epochEvents].sort((left, right) => left.sequence - right.sequence),
    }))
    .filter(({ events }) =>
      events.length > 0 &&
      events[0].sequence === 0 &&
      events[0].kind === "BEGIN" &&
      events[events.length - 1].kind === "COMMIT" &&
      events.every((event, index) => event.sequence === index),
    );

  if (completeEpochs.length === 0) {
    throw new Error("No complete valid epoch");
  }

  const selected = completeEpochs.reduce((greatest, candidate) =>
    candidate.epoch > greatest.epoch ? candidate : greatest,
  );
  const state = new Map<string, number>();
  for (const event of selected.events) {
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
