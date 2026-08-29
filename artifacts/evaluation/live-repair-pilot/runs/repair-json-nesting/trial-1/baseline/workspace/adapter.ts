export interface Player { id: string; name: string }

export function extractPlayers(payload: unknown): Player[] {
  const envelope = payload as { players?: Player[]; data?: { roster?: Player[] } };
  const players = envelope.players ?? envelope.data?.roster ?? [];
  return players.map(({ id, name }) => ({ id, name }));
}
