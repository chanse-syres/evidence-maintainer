export interface Player { id: string; name: string }

export function extractPlayers(payload: unknown): Player[] {
  const candidate = payload as { players?: Player[]; data?: { roster?: Player[] } };
  const players = candidate.players ?? candidate.data?.roster ?? [];
  return players.map(({ id, name }) => ({ id, name }));
}
