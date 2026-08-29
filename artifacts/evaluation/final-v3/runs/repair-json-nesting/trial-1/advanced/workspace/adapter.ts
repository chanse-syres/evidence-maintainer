export interface Player { id: string; name: string }

export function extractPlayers(payload: unknown): Player[] {
  const { players, data } = payload as {
    players?: Player[];
    data?: { roster?: Player[] };
  };
  const roster = players ?? data?.roster ?? [];
  return roster.map(({ id, name }) => ({ id, name }));
}
