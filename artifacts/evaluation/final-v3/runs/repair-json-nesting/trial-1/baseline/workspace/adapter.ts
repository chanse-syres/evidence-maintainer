export interface Player { id: string; name: string }

export function extractPlayers(payload: unknown): Player[] {
  const source = payload as { players?: Player[]; data?: { roster?: Player[] } };
  const players = source.players ?? source.data?.roster ?? [];
  return players.map(({ id, name }) => ({ id, name }));
}
